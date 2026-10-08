#!/usr/bin/env python3
"""CozyMaker — tests/browser.py

The whole thing, end to end, in a real browser against the real server.
Nothing is stubbed except the model itself, and that stands in for a real one:
it reads the prompt it was actually sent and answers in the shape a model
answers in. If a change does not reach a document, or a document does not
survive a reload, this fails.

    python3 tests/browser.py
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import http.server
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8793
MODEL_PORT = 8794

passed = 0
failed = []
seen_prompts = []


def ok(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(f"{name}{' — ' + str(detail)[:300] if detail else ''}")


# --------------------------------------------------------- the stand-in model

WORKER_REPLY = """I changed the rule and had a look at the rest while I was in there.

<edits>
[
  {"file": "Plot Essential.md", "find": "- Majority is sixteen.", "replace": "- Majority is fifteen.", "reason": "the world got younger"}
]
</edits>"""

EYE_REPLY = "Read the world, the cast and the timeline. Nothing else needed changing."

MAKER_EDIT = """<edits>
[
  {"file": "Plot Essential.md", "find": "- Majority is sixteen.", "replace": "- Majority is fifteen.", "reason": "the world got younger"}
]
</edits>"""


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        sent = json.loads(self.rfile.read(n).decode())
        system = ""
        for m in sent.get("messages", []):
            if m.get("role") == "system":
                system = m.get("content", "")
        user = ""
        for m in sent.get("messages", []):
            if m.get("role") == "user":
                user = m.get("content", "")
        crew = "This is craft work on a piece of fiction" in system
        seen_prompts.append({"system": system, "user": user, "stream": bool(sent.get("stream")), "crew": crew, "body": sent})
        if crew and "Read back what was changed just now" in user:
            body = json.dumps({"choices": [{"message": {"content": "CLEAN \u2014 nothing wrong."}, "finish_reason": "stop"}]}).encode() if not sent.get("stream") else None
            if body is not None:
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": "CLEAN \u2014 nothing wrong."}}]}) + "\n\n").encode())
            self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": "stop"}]}) + "\n\ndata: [DONE]\n\n").encode()); self.wfile.flush(); return

        if sent.get("stream") and not crew:
            # the one the writer talks to (v2.0): it makes the change itself, in its reply, the
            # block cut into pieces the way a provider streams it
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            reply = "Done — majority is fifteen now." + ("\n\n" + MAKER_EDIT if "majority" in user.split("said:")[-1].lower() else "")
            for piece in [reply[i:i + 9] for i in range(0, len(reply), 9)]:
                self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": piece}}]}) + "\n\n").encode())
                self.wfile.flush()
            # the service's own count, in the last chunk, as OpenAI-shaped services send it
            self.wfile.write(("data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": 40123, "completion_tokens": 12}}) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            return

        # a worker: its call streams, as a real provider's does
        body = EYE_REPLY if "Evidenced CLEAN vs False CLEAN" in system else WORKER_REPLY
        if sent.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            third = max(1, len(body) // 3)
            pieces = [body[:third], body[third:2 * third], body[2 * third:]]
            for i, piece in enumerate(pieces):
                chunk = {"choices": [{"delta": {"content": piece}, "finish_reason": "stop" if i == len(pieces) - 1 else None}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            return
        out = {"choices": [{"message": {"content": body}, "finish_reason": "stop"}]}
        raw = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


PE_SEED = """# PLOT ESSENTIAL — The Ashwood Pact — V1.0
# STATE: Tuesday 15 April 247 AGC, 09:24 / Council Chamber
# CALENDAR: Fantasy 12-month (AGC)

## WORLD
### Rules
- Epistemic Law: NPCs know ONLY what they personally witnessed.
- Majority is sixteen.

## MC — Jovan (17)
ID: Tall, dark-haired.
CORE: Reads a room before he speaks.

### Claire (student | core | 16)
ID: Small, freckled.
CORE: Stubborn, catches detail nobody else does.
→ Jovan: refuses to back down (P:60 R:35 S:25)

## TIMELINE
e001 [Mon 14 Apr 247, 09:00] [setup]: The showcase opened in the east hall.

## SCENE
WHERE: Council Chamber / PRESENT: Jovan, Emilia / ACTIVITY: waiting
"""


def wait_for(port, seconds=20):
    for _ in range(seconds * 10):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/version", timeout=1).read()
            return True
        except Exception:
            time.sleep(0.1)
    return False


def main():
    from playwright.sync_api import sync_playwright

    home = Path(tempfile.mkdtemp(prefix="cozymaker-browser-"))
    env = dict(os.environ, COZYMAKER_HOME=str(home), COZYMAKER_PORT=str(PORT))
    server = subprocess.Popen([sys.executable, str(ROOT / "serve.py")], env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    model = Threaded(("127.0.0.1", MODEL_PORT), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()

    try:
        if not wait_for(PORT):
            print("server never came up:", server.stderr.read().decode()[:1500])
            return 1

        # the house is set up the way the writer would set it up
        house = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/house").read())
        house["connections"] = [{
            "id": "c1", "name": "the good one",
            "url": f"http://127.0.0.1:{MODEL_PORT}/v1", "model": "test-model", "key": "k",
        }]
        house["agentConnections"] = {"keeper": "c1"}
        house["settings"].update({"makerName": "Eni", "yourName": "Bruce", "person": "second", "theme": "hearth"})
        house["personaFrame"] = "You are Eni. You are warm and a bit sharp and you never talk like a manual."
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/house", data=json.dumps(house).encode(), method="PUT")
        req.add_header("Content-Type", "application/json")
        urllib.request.urlopen(req).read()

        world = {
            "id": "p_walk", "title": "The Ashwood Pact",
            "docs": [{"id": "d1", "name": "Plot Essential.md", "kind": "pe", "text": PE_SEED}],
            "turns": [], "undo": [], "recentSections": [],
        }
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/project/p_walk",
                                     data=json.dumps(world).encode(), method="PUT")
        req.add_header("Content-Type", "application/json")
        urllib.request.urlopen(req).read()

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                      device_scale_factor=3, is_mobile=True, has_touch=True)
            # the house's sections fold to their names (v2.5); these walks reach into every one of
            # them, so they start open here — the folding itself is walked on its own, cold
            ctx.add_init_script("try { if (!localStorage.getItem('cozymaker:houseOpen')) localStorage.setItem('cozymaker:houseOpen', JSON.stringify(['who','connections','crew','search','shortcuts','look','floor'])); } catch (e) {}")
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)

            page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
            page.wait_for_timeout(700)

            ok("the room opens", page.locator("#worldName").inner_text() == "The Ashwood Pact",
               page.locator("#worldName").inner_text())
            ok("the header says what is in it", "1 document" in page.locator("#worldSub").inner_text())
            ok("nothing threw on the way in", not errors, "; ".join(errors[:3]))

            # -- the writer says something that means work ---------------------
            page.fill("#say", "change the majority rule to fifteen")
            t0 = time.time()
            page.click("#sendBtn")
            page.wait_for_selector(".turn.maker .bubble", timeout=30000)
            page.wait_for_function(
                "() => { const n = document.querySelectorAll('.turn.maker .bubble'); "
                "return n.length && n[n.length-1].textContent.includes('fifteen'); }",
                timeout=30000)
            took = time.time() - t0
            # the reply is read once the turn is done: with Smooth streaming its last
            # words are drawn a few frames after the first ones (v1.6.0)
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)

            said = page.locator(".turn.maker .bubble").last.inner_text()
            ok("the one at the front answers in its own voice", "majority is fifteen now" in said, said)
            ok("the writer's own words are on screen too",
               "change the majority rule to fifteen" in page.locator(".turn.writer .bubble").last.inner_text())
            ok("they are named on their turn", page.locator(".turn.maker .who").last.inner_text() == "Eni")

            # -- the change actually reached the document ----------------------
            page.wait_for_timeout(900)
            saved = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/project/p_walk").read())
            text = saved["docs"][0]["text"]
            ok("the change reached the document on the device", "- Majority is fifteen." in text, text[:200])
            ok("the old rule is gone", "- Majority is sixteen." not in text)
            ok("nothing else was disturbed", "e001 [Mon 14 Apr 247, 09:00]" in text and "→ Jovan: refuses" in text)
            ok("the plain copy on disk followed",
               "- Majority is fifteen." in (home / "exports" / "p_walk" / "Plot Essential.md").read_text())

            ok("a card shows what changed", page.locator(".card").count() >= 1)
            ok("the card names the document", "Plot Essential.md" in page.locator(".cards").last.inner_text())

            # -- the one he talks to did the work, reading everything ------------
            workers = [p for p in seen_prompts if p["crew"]]
            fronts = [p for p in seen_prompts if not p["crew"]]
            ok("the one he talks to was asked once; the only other call was the eye reading back what changed", len(fronts) == 1 and len(workers) == 1
               and "Read back what was changed just now in Plot Essential.md" in workers[0]["user"], f"{len(fronts)} / {len(workers)}")
            front = fronts[0]
            engine = (ROOT / "engine" / "generalist.md").read_text()
            ok("it was given his own instructions first", front["system"].startswith("You are Eni. You are warm"), front["system"][:80])
            ok("it was greeted like a person", "Hey Eni, this is Bruce." in front["system"])
            ok("it read his whole engine, word for word", engine in front["system"], f"{len(front['system'])} chars")
            ok("it was told how to change a document itself", "<edits>" in front["system"] and "How this room works" in front["system"])
            ok("it read the plot essential whole, word for word", PE_SEED.strip() in front["user"])
            ok("his words came after it, under his name", front["user"].rfind("Bruce said:") > front["user"].find("## SCENE"))
            ok("it streamed, with room to write a document", front["stream"] and (front["body"].get("max_tokens") or 0) >= 8000, front["body"].get("max_tokens"))
            ok("the block of changes never reached the screen", "<edits>" not in said and "find" not in said, said)

            # -- the context line (v2.4) ------------------------------------------
            page.wait_for_timeout(600)
            cl = page.locator("#contextLine").inner_text()
            m0 = re.search(r"Context ~([\d,]+) tokens", cl)
            n0 = int(m0.group(1).replace(",", "")) if m0 else 0
            ok("the context line says how much the next message reads \u2014 the engine alone is over 30,000", n0 > 30000, cl)
            ok("and what the service counted for the last reply, when it said", "last reply 40,123 counted" in cl, cl)
            page.fill("#say", "x " * 2000)
            page.wait_for_timeout(900)
            m1 = re.search(r"Context ~([\d,]+) tokens", page.locator("#contextLine").inner_text())
            n1 = int(m1.group(1).replace(",", "")) if m1 else 0
            ok("it grows with the message being typed", n1 - n0 >= 900, (n0, n1))
            page.fill("#say", "")
            page.wait_for_timeout(600)

            # -- it survives a reload, because the device holds it --------------
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(800)
            ok("the conversation is still there after a reload",
               page.locator(".turn.writer").count() >= 1 and page.locator(".turn.maker").count() >= 1)
            ok("the answer is still there word for word",
               "majority is fifteen now" in page.locator(".turn.maker .bubble").last.inner_text())

            # -- a second browser, cold, sees the same thing --------------------
            ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
            page2 = ctx2.new_page()
            page2.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
            page2.wait_for_timeout(800)
            ok("a completely fresh browser opens the same world",
               page2.locator("#worldName").inner_text() == "The Ashwood Pact")
            ok("and sees the same conversation", page2.locator(".turn").count() >= 2)
            ctx2.close()

            # -- the documents panel -------------------------------------------
            page.click("#docsBtn")
            page.wait_for_timeout(400)
            ok("the documents panel opens", page.locator("#docsSheet.open").count() == 1)
            ok("the document is listed", "Plot Essential.md" in page.locator("#docsBody").inner_text())
            ok("the list says how big it is", re.search(r"\d+ tokens", page.locator("#docsBody").inner_text()) is not None)

            page.locator("#docsBody .row .grow").first.click()
            page.wait_for_timeout(400)
            ok("the document opens for reading", page.locator("#docsBody textarea").count() == 1)
            ok("it shows the change", "- Majority is fifteen." in page.locator("#docsBody textarea").input_value())

            page.locator("#docsBody textarea").fill(PE_SEED.replace("Majority is sixteen.", "Majority is fifteen.") + "\n## GENERALIST NOTES\nby hand\n")
            landed = False
            for _ in range(60):
                page.wait_for_timeout(100)
                saved = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/project/p_walk").read())
                if "by hand" in saved["docs"][0]["text"]:
                    landed = True
                    break
            ok("an edit made by hand is kept", landed)

            # -- tidying repairs rather than reporting --------------------------
            page.locator("#docsBody textarea").fill(
                PE_SEED
                + "\n## EMPTY BIT\n\n"
                + "## STILL HERE\ne002 [Tue 15 Apr 247, 10:00] [tension]: something [EPISTEMIC_VIOLATION] happened.\n")
            page.wait_for_timeout(900)
            # "Tidy it up" is the showrunner's declutter-and-reshape, a model
            # job sent through the conversation; the checks on leaving a
            # document are code. Two different acts, one control each.
            ok("a document has exactly one Tidy it up, and it is named that",
               page.locator("#docsBody .btn", has_text="Tidy it up").count() == 1)
            # leaving the document is what runs the checks — no button, no chore
            page.locator("#docsAction").click()
            page.wait_for_timeout(700)
            page.locator("#docsBody .row .grow").first.click()
            page.wait_for_timeout(500)
            after = page.locator("#docsBody textarea").input_value()
            ok("tidying takes the working marker out", "[EPISTEMIC_VIOLATION]" not in after)
            ok("an empty heading he typed himself is kept for him to fill, never cut on leaving", "## EMPTY BIT" in after)
            ok("tidying keeps a heading that has something under it", "## STILL HERE" in after)
            ok("tidying keeps a heading whose content is subsections", "## WORLD" in after,
               "WORLD was deleted by the tidy")
            ok("tidying keeps those subsections", "### Rules" in after)
            ok("tidying keeps the main character", "## MC \u2014 Jovan (17)" in after)
            ok("tidying keeps the story", "The showcase opened in the east hall" in after)
            said = page.locator("#toast").inner_text()
            ok("leaving a document says what was put right, and names it",
               "Plot Essential.md" in said and "marker" in said, said)
            ok("it reports, it does not hand over a task",
               not any(w in said.lower() for w in ("you should", "please ", "needs your", "tap ")), said)

            page.click("#docsSheet [data-close]")
            page.wait_for_timeout(300)

            # -- the house ------------------------------------------------------
            page.click("#settingsBtn")
            page.wait_for_timeout(400)
            body = page.locator("#houseBody").inner_text()
            ok("the house shows who you are making it with", "What they are called" in body)
            ok("the house shows the connections", "the good one" in body)
            ok("the house shows the crew", "The one you talk to" in body)
            import re as _re
            ver = _re.search(r'VERSION = "([^"]+)"', (ROOT / "serve.py").read_text()).group(1)
            page.wait_for_timeout(400)
            body2 = page.locator("#houseBody").inner_text()
            ok("the house shows the version in plain sight, not in a toast", f"version {ver}" in body2, [l for l in body2.splitlines() if "version" in l.lower()][:2])
            ok("and there is no second, hidden way to read it", "Where the work lives" not in body2)
            page.locator("#houseBody .btn", has_text="Try it").first.click()
            page.wait_for_timeout(1200)
            ok("a connection can be tried for real", "Working" in page.locator("#toast").inner_text(),
               page.locator("#toast").inner_text())
            verdict = page.locator("#houseBody .conn-test").first
            ok("the test's verdict on thinking stays on the connection, not only in a toast",
               verdict.is_visible() and "Asked" in verdict.inner_text() and "thinking" in verdict.inner_text().lower(), verdict.inner_text()[:160])
            page.click("#houseSheet [data-close]")
            page.wait_for_timeout(300)
            page.click("#settingsBtn")
            page.wait_for_timeout(500)
            ok("and it is still there after the house is closed and opened again",
               "Last tried" in page.locator("#houseBody .conn-test").first.inner_text())
            page.locator("#houseBody .row .grow").first.click()
            page.wait_for_timeout(300)
            ok("a connection can list the models its provider offers", page.locator("#houseBody .btn", has_text="Show the models on offer").count() == 1)
            page.locator("#houseBody .btn", has_text="Back").first.click()
            page.wait_for_timeout(300)

            # -- what he types in the house is kept as he types it: no tap elsewhere, no Back
            def house_now():
                return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/house").read())
            frame_box = page.locator("#houseBody label.field", has_text="Their instructions, in your own words").locator("textarea")
            was_frame = frame_box.input_value()
            pasted = "I am Eni. I keep Bruce's worlds straight, and I talk like myself."
            frame_box.fill(pasted)                      # input events only: the box never loses focus
            page.wait_for_timeout(1500)
            ok("a persona pasted in is on the device without leaving the box", house_now().get("personaFrame") == pasted,
               (house_now().get("personaFrame") or "")[:60])
            maker_box = page.locator("label.field", has_text="What they are called").locator("input")
            maker_box.fill("Eni the Archivist")
            page.wait_for_timeout(1500)
            ok("a name typed in is on the device without leaving the box", house_now()["settings"].get("makerName") == "Eni the Archivist",
               house_now()["settings"].get("makerName"))
            maker_box.fill("Eni")
            frame_box.fill(was_frame)
            page.wait_for_timeout(1500)
            ok("and put back the same way", house_now()["settings"].get("makerName") == "Eni" and house_now().get("personaFrame") == was_frame)

            # -- smooth streaming, under its own name (SillyTavern's) -------------
            smooth = page.locator("label.field", has_text="Smooth streaming").locator("select")
            ok("Smooth streaming is in The look, by that name", smooth.count() == 1)
            ok("and is on when he has never set it", smooth.count() == 1 and smooth.input_value() == "on", smooth.input_value() if smooth.count() else None)
            smooth.select_option("off")
            page.wait_for_timeout(600)
            ok("turned off, it is kept on the device", house_now()["settings"].get("smoothStreaming") == "off", house_now()["settings"].get("smoothStreaming"))
            smooth = page.locator("label.field", has_text="Smooth streaming").locator("select")
            smooth.select_option("on")
            page.wait_for_timeout(600)
            ok("and on again the same way", house_now()["settings"].get("smoothStreaming") == "on", house_now()["settings"].get("smoothStreaming"))

            # -- the note at the end (v1.8.0): post-history instructions -------------
            note = page.locator("label.field", has_text="The note at the end").locator("textarea")
            ok("The note at the end is in The house, by that name, under their instructions", note.count() == 1)
            note.fill("Stay warm, {{user}}.")
            page.locator("label.field", has_text="Send the note at the end").locator("select").focus()
            page.wait_for_timeout(700)
            ok("what he writes in it is kept on the device", house_now().get("postNote") == "Stay warm, {{user}}.", house_now().get("postNote"))
            send_note = page.locator("label.field", has_text="Send the note at the end").locator("select")
            role = page.locator("label.field", has_text="Sent after your message as").locator("select")
            ok("it is sent unless he says not, as a system message unless he says otherwise", send_note.input_value() == "on" and role.input_value() == "system",
               (send_note.input_value(), role.input_value()))
            send_note.select_option("off")
            role.select_option("user")
            page.wait_for_timeout(700)
            ok("both kept as he set them", house_now()["settings"].get("sendNote") == "off" and house_now()["settings"].get("noteRole") == "user")
            send_note.select_option("on")
            role.select_option("system")
            note.fill("")
            page.locator("label.field", has_text="Send the note at the end").locator("select").focus()
            page.wait_for_timeout(700)

            # -- searching the internet (v1.7.0), his switch ------------------------
            search = page.locator("label.field", has_text="Search the internet").locator("select")
            ok("Search the internet is in The house, by that name, off until he turns it on", search.count() == 1 and search.input_value() == "off",
               search.input_value() if search.count() else None)
            search.select_option("on")
            page.wait_for_timeout(600)
            ok("turned on, it is kept on the device", house_now()["settings"].get("searchInternet") == "on")
            hint = page.locator(".group", has_text="Searching the internet").locator("p.hint", has_text="Nothing can search yet")
            ok("with nothing that can search, it says what to add, in plain words", hint.count() == 1 and hint.is_visible())
            who = page.locator("label.field", has_text="Who searches the internet").locator("select")
            first = who.locator("option").nth(1).get_attribute("value")
            who.select_option(first)
            page.wait_for_timeout(600)
            ok("the one who searches is kept", house_now()["agentConnections"].get("searcher") == first, house_now()["agentConnections"])
            ok("and the note goes once something can search", not page.locator(".group", has_text="Searching the internet").locator("p.hint", has_text="Nothing can search yet").is_visible())
            who.select_option("")
            search.select_option("off")
            page.wait_for_timeout(600)
            ok("off again, the same way", house_now()["settings"].get("searchInternet") == "off" and "searcher" not in house_now()["agentConnections"])

            # -- the coats of paint --------------------------------------------
            coat = page.locator("label.field", has_text="Coat of paint").locator("select")
            ok("the coats of paint are offered by name", coat.count() == 1)
            coat.select_option(label="The tavern at night — purple sky, a bard, somebody buying a round")
            page.wait_for_timeout(600)
            ok("a coat of paint goes on straight away",
               page.evaluate("document.documentElement.getAttribute('data-theme')") == "tavern")
            drew = page.evaluate("""() => {
              const s = getComputedStyle(document.body, '::before');
              return { img: s.backgroundImage, h: s.height };
            }""")
            ok("the night scene is actually painted", "tavern-night.svg" in drew["img"], json.dumps(drew))
            ok("the scene is given room for the whole picture", int(float(drew["h"].replace("px", ""))) > 200, drew["h"])
            scene = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/css/tavern-night.svg")
            body = scene.read().decode()
            ok("the scene is served", scene.status == 200 and body.startswith("<svg"))
            ok("the scene is served as a drawing", "image/svg" in scene.headers.get("Content-Type", ""))
            # a namespace is not a fetch; these are the things that would be
            ok("the scene fetches nothing from anywhere",
               "<image" not in body and "xlink:href" not in body
               and "@import" not in body and "url(http" not in body)
            ok("the scene has the party in it", 'the party at the long table' in body)
            ok("the scene has the bard in it", 'bard, standing, mid-song' in body)

            page.reload(wait_until="networkidle")
            page.wait_for_timeout(700)
            ok("the coat of paint is still on after a reload",
               page.evaluate("document.documentElement.getAttribute('data-theme')") == "tavern")
            # Measured off the painted pixels, not guessed: the text colour
            # against the BRIGHTEST part of the night actually sitting behind
            # that paragraph. A picture behind words is only worth having if
            # the words are still easy to read on the worst patch of it.
            bubble = page.locator(".turn.maker .bubble").first
            box = bubble.bounding_box()
            ink = page.evaluate("getComputedStyle(document.querySelector('.turn.maker .bubble')).color")
            page.screenshot(path="/tmp/cm-contrast.png")
            from PIL import Image
            im = Image.open("/tmp/cm-contrast.png").convert("RGB")
            scale = im.width / 390
            y0 = int(box["y"] * scale); y1 = int((box["y"] + box["height"]) * scale)
            # the stream's own 16px margin, which holds no text at all
            strip = im.crop((0, y0, int(13 * scale), y1))
            def lum(rgb):
                out = []
                for v in rgb:
                    v /= 255.0
                    out.append(v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4)
                return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]
            raw = strip.tobytes()
            worst = max(lum(raw[i:i + 3]) for i in range(0, len(raw), 3))
            text = lum(tuple(int(v) for v in re.findall(r"\d+", ink)[:3]))
            ratio = (max(text, worst) + 0.05) / (min(text, worst) + 0.05)
            ok("the words stay readable on the brightest part of the night",
               ratio >= 7, f"measured {ratio:.1f}:1 against the real backdrop")
            print(f"(measured text contrast over the scene: {ratio:.1f}:1)")
            page.click("#settingsBtn")
            page.wait_for_timeout(400)

            # a fold is a plain button now: <details> did not open on his phone (the extension's v0.4.1)
            page.locator("#houseBody .fold-head", has_text="what each of them reads").click()
            page.wait_for_timeout(1200)
            slices = page.locator("#houseBody .fold", has_text="what each of them reads").inner_text()
            engine_len = len((ROOT / "engine" / "generalist.md").read_text())
            ok("the house shows what each of them reads: the one you talk to, his whole engine", f"{engine_len} chars  your whole engine" in slices and "the one you talk to" in slices, slices[:160])
            ok("including the three with a craft of their own",
               all(w in slices for w in ("worldbook", "auditor", "instructions")) and slices.count("its own craft") == 3, slices[-260:])
            ok("no native <details> is left anywhere in the house", page.locator("#houseBody details").count() == 0)
            page.click("#houseSheet [data-close]")

            # -- what was sent (v2.1) -------------------------------------------
            house_api = lambda: json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/house").read())
            page.locator(".turn.maker .bubble").first.click()
            page.wait_for_timeout(300)
            ws = page.locator(".turn.maker").first.locator(".turn-actions .btn", has_text="What was sent")
            ok("a reply offers What was sent", ws.count() == 1)
            if ws.count():
                ws.click()
                page.wait_for_function("() => document.querySelector('#sentSheet.open') && !/Fetching/.test(document.getElementById('sentBody').textContent)", timeout=10000)
                sbody = page.locator("#sentBody").inner_text()
                ok("it says how many requests went out \u2014 the one he talks to, then the eye reading it back \u2014 and how many tokens went in: the service's count where it gave one, an estimate where it did not",
                   re.search(r"2 requests \u00b7 40,123 tokens in counted by the service, about [\d,]+ more estimated", sbody) is not None and "the one you talk to \u2014 step 1" in sbody and "the eye \u2014 reading it back" in sbody, sbody[:300])
                ok("in parts: his instructions, his whole engine and the room, each with its tokens",
                   "Your instructions for them" in sbody and "Your engine \u2014 engine/generalist.md" in sbody and "How this room works" in sbody
                   and len(re.findall(r"~[\d,]+ tokens", sbody)) >= 4, sbody[:400])
                page.locator("#sentBody .sent-name", has_text="Your engine").click()
                page.wait_for_timeout(200)
                ok("a part opens to its words", "You are also Generalist" in page.locator("#sentBody .sent-text").first.inner_text())
                page.locator("#sentBody .sent-tab", has_text="Raw").click()
                page.wait_for_timeout(200)
                raw = page.locator("#sentBody").inner_text()
                ok("raw: the settings and every message, exactly as they went", "settings" in raw and '"model": "test-model"' in raw and "Bruce said:" in raw and "max_tokens" in raw, raw[:300])
                page.click("#sentSheet [data-close]")
                page.wait_for_timeout(300)
            kept = list((home / "sent").rglob("*.json"))
            ok("it is kept on the device", len(kept) == 1, [str(k) for k in kept])
            kept_text = kept[0].read_text() if kept else ""
            ok("never with his key", "Bearer" not in kept_text and '"key"' not in kept_text and "Authorization" not in kept_text)

            # -- neon, Return to default, Copy and Paste (v2.1) ------------------
            page.click("#settingsBtn")
            page.wait_for_timeout(400)
            page.evaluate("""() => { const s = [...document.querySelectorAll('#houseBody select')].find((x) => [...x.options].some((o) => o.value === 'neon'));
              s.value = 'neon'; s.dispatchEvent(new Event('change')); }""")
            page.wait_for_timeout(700)
            neon = page.evaluate("""() => { const cs = getComputedStyle(document.documentElement);
              const rgb = (h) => { h = h.trim().replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
              const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
              const a = lum(rgb(cs.getPropertyValue('--ink'))), b = lum(rgb(cs.getPropertyValue('--panel')));
              return { theme: document.documentElement.dataset.theme, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), glow: cs.getPropertyValue('--glow').trim() }; }""")
            ok("the neon look is there by its name, purple light, and its words read clearly (7:1 or better)",
               neon["theme"] == "neon" and neon["glow"] == "#c86bff" and neon["ratio"] >= 7 and house_api()["settings"]["theme"] == "neon", neon)
            page.once("dialog", lambda d: d.accept())
            page.locator("#houseBody .btn", has_text="Return to default").first.click()
            page.wait_for_timeout(900)
            hh = house_api()
            ok("Return to default puts the example back, asking first, and keeps it on the device",
               hh["personaFrame"].startswith("You are {{char}}, a vampire.") and "countess" in hh["personaFrame"]
               and page.locator("#houseBody textarea").first.input_value() == hh["personaFrame"], hh["personaFrame"][:80])
            page.locator("#houseBody .btn", has_text="Return to default").nth(1).click()
            page.wait_for_timeout(900)
            ok("and under the note at the end, the example note", house_api()["postNote"].startswith("Stay {{char}}: elegant, dry and exact."), house_api()["postNote"][:60])
            page.locator("#houseBody .row .btn", has_text=re.compile("^Copy$")).first.click()
            page.wait_for_timeout(300)
            page.locator("#houseBody .btn", has_text=re.compile("^Paste$")).click()
            page.wait_for_timeout(900)
            conns = house_api()["connections"]
            ok("Paste makes another connection like the one copied, under its own name, its key and settings carried",
               len(conns) == 2 and conns[1]["name"] == (conns[0].get("name") or conns[0]["model"]) + " (copy)" and conns[1]["url"] == conns[0]["url"]
               and conns[1]["key"] == conns[0]["key"] and conns[1]["model"] == conns[0]["model"] and conns[1]["id"] != conns[0]["id"], conns)
            ok("and opens it, so only the model needs changing", page.evaluate("[...document.querySelectorAll('#houseBody input')].some((i) => i.value === 'test-model')"))
            # Lamplight (v2.3): cyberpunk purple, cozy, soft on the eyes -- readable, never glaring
            # (Paste left the new connection open in the house; the house is opened again at its top)
            page.click("#houseSheet [data-close]")
            page.wait_for_timeout(300)
            page.click("#settingsBtn")
            page.wait_for_timeout(500)
            page.evaluate("""() => { const s = [...document.querySelectorAll('#houseBody select')].find((x) => [...x.options].some((o) => o.value === 'lamplight'));
              s.value = 'lamplight'; s.dispatchEvent(new Event('change')); }""")
            page.wait_for_timeout(700)
            lamp = page.evaluate("""() => { const cs = getComputedStyle(document.documentElement);
              const rgb = (h) => { h = h.trim(); if (h.startsWith('rgb')) return h.match(/[\\d.]+/g).map(Number).slice(0, 3); h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
              const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
              const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
              const v = (n) => cs.getPropertyValue(n).trim();
              return { theme: document.documentElement.dataset.theme, ink: v('--ink'), bg: v('--bg'), body: ratio(v('--ink'), v('--bg')), faint: ratio(v('--ink-faint'), v('--bg')),
                scene: getComputedStyle(document.body, '::before').backgroundImage }; }""")
            ok("Lamplight is there by its name: words read clearly (7:1 or better, hints 4.5:1) without glaring \u2014 never pure white on pure black",
               lamp["theme"] == "lamplight" and 7 <= lamp["body"] <= 16 and lamp["faint"] >= 4.5 and lamp["ink"].lower() != "#ffffff" and lamp["bg"].lower() != "#000000", lamp)
            ok("with its lamplit city behind the conversation", "lamplight-city.svg" in lamp["scene"]
               and urllib.request.urlopen(f"http://127.0.0.1:{PORT}/css/lamplight-city.svg").status == 200, lamp["scene"][:120])
            page.click("#houseSheet [data-close]")
            page.wait_for_timeout(300)
            pads = {}
            for look in ("lamplight", "neon"):
                page.evaluate(f"document.documentElement.setAttribute('data-theme', '{look}')")
                pads[look] = page.evaluate("() => { const b = document.querySelector('.turn.maker .bubble'); const s = getComputedStyle(b); return [parseFloat(s.paddingLeft), s.borderLeftWidth !== '0px' && s.borderLeftColor !== 'rgba(0, 0, 0, 0)']; }")
            ok("a look that draws a box round a reply gives the words room inside it (Neon drew the box with no padding)",
               all(p[0] >= 10 for p in pads.values()), pads)
            page.click("#settingsBtn")
            page.wait_for_timeout(400)
            page.evaluate("""() => { const s = [...document.querySelectorAll('#houseBody select')].find((x) => [...x.options].some((o) => o.value === 'neon'));
              s.value = 'hearth'; s.dispatchEvent(new Event('change')); }""")
            page.wait_for_timeout(500)
            ok("and the look goes back to Hearth when chosen", page.evaluate("document.documentElement.dataset.theme") == "hearth")
            page.wait_for_timeout(300)
            page.click("#houseSheet [data-close]")

            # -- the line under a reply says how the read-back went, truly (v2.4.1) --
            # every verdict a reply can carry, and one kept by 2.2 (no verdict field), drawn by the real room
            lines_seen = {}
            worlds = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/projects").read())
            wl = worlds.get("projects", worlds) if isinstance(worlds, dict) else worlds
            target = sorted(wl, key=lambda x: x.get("updated", 0))[-1]["id"] if wl else None
            for label, review in [("clean", {"verdict": "clean", "clean": True, "found": False, "notes": ""}),
                                  ("found", {"verdict": "found", "clean": False, "found": True, "notes": "e002 is dated before e001."}),
                                  ("unclear", {"verdict": "unclear", "clean": False, "found": True, "notes": "It sits oddly with her bond."}),
                                  ("empty", {"verdict": "empty", "clean": False, "found": False, "notes": ""}),
                                  ("failed", {"verdict": "failed", "clean": False, "found": False, "notes": "", "failed": "the provider did not answer"}),
                                  ("kept by 2.2", {"clean": False, "found": True, "notes": "A date is out of order."})]:
                w = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/project/{target}").read())
                chat = [c for c in w["chats"] if any(t.get("role") == "maker" for t in c.get("turns", []))][0]
                t = [t for t in chat["turns"] if t.get("role") == "maker"][0]
                t["review"] = review
                req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/project/{target}", data=json.dumps(w).encode(), method="PUT", headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req).read()
                page.reload(wait_until="networkidle")
                page.wait_for_timeout(700)
                lines_seen[label] = page.evaluate("(() => { const c = document.querySelector('.turn.maker .checks'); return c ? c.innerText.split('\\n')[0].replace(/^[\u25b8\u25be]\\s*/, '') : null; })()")
            ok("the line under a reply says how the read-back went \u2014 nothing wrong, raised, notes, named nothing, could not \u2014 for every verdict, old replies included",
               lines_seen.get("clean") == "The eye read back what changed \u2014 nothing wrong"
               and (lines_seen.get("found") or "").startswith("The eye read back what changed and raised something")
               and (lines_seen.get("unclear") or "").startswith("The eye read back what changed \u2014 its notes went back")
               and lines_seen.get("empty") == "The eye read back what changed, but named nothing to put right"
               and (lines_seen.get("failed") or "").startswith("The eye could not read it back: the provider did not answer")
               and (lines_seen.get("kept by 2.2") or "").startswith("The eye read back what changed and raised something"), lines_seen)

            # -- the live thinking box, under his finger (v2.4.1) -----------------
            box = page.evaluate("""async () => {
              const { streamText } = await import('/js/ui/streamtext.js');
              const box = document.createElement('div');
              box.style.cssText = 'height:120px;overflow-y:auto;position:fixed;top:0;left:0;width:300px;';
              document.body.append(box);
              const lines = streamText(box);
              const end = () => box.scrollHeight - box.scrollTop - box.clientHeight;
              for (let i = 0; i < 40; i++) lines.append(`thought ${i}\\n`);
              const followed = end() < 2;
              const t = (y) => new Touch({ identifier: 3, target: box, clientX: 50, clientY: y });
              box.dispatchEvent(new TouchEvent('touchstart', { touches: [t(60)], changedTouches: [t(60)], bubbles: true }));
              box.scrollTop = 0;
              box.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(90)], bubbles: true }));
              lines.append('more thought\\n');
              const stayed = box.scrollTop === 0;
              /* the swipe carries it to the end after the finger is gone */
              box.scrollTop = box.scrollHeight;
              await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
              lines.append('and more\\n');
              const again = end() < 2;
              box.remove();
              return { followed, stayed, again };
            }""")
            ok("the live thinking follows its words, stays where his finger left it, and follows again once a swipe carries it to the end",
               box["followed"] and box["stayed"] and box["again"], box)

            # -- nothing threw the whole way through ----------------------------
            ok("nothing threw during the walk", not errors, "; ".join(errors[:4]))

            print(f"\n(the turn took {took:.1f}s against a local stand-in model)")
            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()
        model.shutdown()
        shutil.rmtree(home, ignore_errors=True)

    print(f"\n{passed} passed, {len(failed)} failed")
    for f in failed:
        print("  ✗ " + f)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
