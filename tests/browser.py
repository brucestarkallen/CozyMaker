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
        failed.append(f"{name}{' — ' + detail if detail else ''}")


# --------------------------------------------------------- the stand-in model

WORKER_REPLY = """I changed the rule and had a look at the rest while I was in there.

<edits>
[
  {"file": "Plot Essential.md", "find": "- Majority is sixteen.", "replace": "- Majority is fifteen.", "reason": "the world got younger"}
]
</edits>"""

EYE_REPLY = "Read the world, the cast and the timeline. Nothing else needed changing."


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
        seen_prompts.append({"system": system, "user": user, "stream": bool(sent.get("stream"))})

        if sent.get("stream"):
            # the one the writer hears
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for piece in ["Done — ", "majority is fifteen now."]:
                self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": piece}}]}) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            return

        # a worker
        body = EYE_REPLY if "THE EXPERT EYE" in system else WORKER_REPLY
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

            # -- the right people were sent, with the right reading ------------
            workers = [p for p in seen_prompts if not p["stream"]]
            fronts = [p for p in seen_prompts if p["stream"]]
            ok("a worker was sent", len(workers) >= 1, f"{len(workers)} worker calls")
            ok("the one at the front spoke once", len(fronts) == 1, f"{len(fronts)} front calls")
            ok("a one-field edit is not followed by a full read-back (the craft's *edit: required scan only)",
               not any("THE EXPERT EYE" in w["system"] for w in workers), [w["system"][:40] for w in workers])

            front = fronts[0]
            ok("the front was given the writer's own instructions first",
               front["system"].startswith("You are Eni. You are warm"), front["system"][:80])
            ok("the front was greeted like a person", "Hey Eni, this is Bruce." in front["system"])
            ok("the front was given no bracketed markers", not re.search(r"\[[A-Z][A-Z0-9_]{4,}\]", front["system"]))
            ok("the front was given no way to edit", "<edits>" not in front["system"])
            ok("the front was given no craft", "Anti-Parrot" not in front["system"] and "CBPA" not in front["system"])
            ok("the front was told what got done", "Plot Essential.md" in front["user"])

            editor = [w for w in workers if "Edit Mode Discipline" in w["system"]]
            ok("the editor was the one sent", len(editor) >= 1)
            if editor:
                ok("the editor was given its own craft", "Anti-Scope-Creep" in editor[0]["system"])
                ok("the editor was NOT given the whole craft",
                   "THE CLEANUP WORKFLOW" not in editor[0]["system"] and "SKIP WORKFLOW" not in editor[0]["system"])
                ok("the editor was shown the whole shape of the document",
                   "Claire (student | core | 16)" in editor[0]["user"])
                ok("the editor was shown the part it needed in full",
                   "- Majority is sixteen." in editor[0]["user"])
                biggest = len(editor[0]["system"])
                whole = len((ROOT / "engine" / "generalist.md").read_text())
                ok("the editor read a fraction of the craft", biggest < whole * 0.5, f"{biggest} of {whole}")

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
            ok("tidying takes a genuinely empty heading out", "## EMPTY BIT" not in after)
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
            frame_box = page.locator("#houseBody textarea.plain")
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
            ok("the house shows what each worker reads", "the whole craft" in slices, slices[:120])
            ok("including the three with a craft of their own",
               all(w in slices for w in ("worldbook", "auditor", "instructions")) and slices.count("its own craft") == 3, slices[-260:])
            ok("no native <details> is left anywhere in the house", page.locator("#houseBody details").count() == 0)
            page.click("#houseSheet [data-close]")

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
