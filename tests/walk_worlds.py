#!/usr/bin/env python3
"""CozyMaker — tests/walk_worlds.py

The second walk, for what the full history of Cozy Tavern and Cozy Chat taught.
Real Chromium at a phone's size, the real server, a stand-in model that reads
the prompts it was actually sent and can be told to answer slowly. Every check
is on what reached the model, what reached the device, or what is on screen.

    python3 tests/walk_worlds.py
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
PORT = 8805
MODEL_PORT = 8806

passed = 0
failed = []
calls = []
DELAY = {"front": 0.0, "worker": 0.0}


def ok(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(f"{name}{' — ' + str(detail)[:300] if detail else ''}")


def until(check, timeout=6.0):
    end = time.time() + timeout
    while time.time() < end:
        if check():
            return True
        time.sleep(0.2)
    return check()


def which(system):
    if "You are the one who listens." in system:
        return "listener"
    for marker, name in (("worldbook architect for SillyTavern", "worldbook"), ("PROACTIVE CO-WRITER", "builder"), ("THE CLEANUP WORKFLOW", "showrunner"),
                         ("THE EXPERT EYE", "eye"), ("Edit Mode Discipline", "editor"),
                         ("SMART COMPRESSION SYSTEM", "compressor")):
        if marker in system:
            return name
    return "front" if "craft work on a piece of fiction" not in system else "worker"


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def refuse(self, code, message):
        raw = json.dumps({"error": {"message": message}}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        sent = json.loads(self.rfile.read(n).decode())
        # an address that will not take a thinking field, and one with a bad key
        if self.path.startswith("/refuse/"):
            calls.append({"who": "refuse", "body": sent})
            if any(k in sent for k in ("thinking", "reasoning_effort", "reasoning", "enable_thinking")):
                return self.refuse(400, "Unrecognized request argument supplied: reasoning_effort")
        if self.path.startswith("/small/"):
            asked = sum(len(m.get("content") or "") for m in sent.get("messages", []) if m.get("role") != "system")
            if asked > 30000:
                calls.append({"who": "small-refused", "size": asked, "body": sent})
                return self.refuse(400, "This model's maximum context length is 8192 tokens. However, your messages resulted in "
                                        f"{asked // 4} tokens. Please reduce the length of the messages.")
        if self.path.startswith("/badkey/"):
            calls.append({"who": "badkey", "body": sent})
            return self.refuse(401, "Incorrect API key provided")
        msgs = sent.get("messages", [])
        system = next((m["content"] for m in msgs if m.get("role") == "system"), "")
        rest = [m for m in msgs if m.get("role") != "system"]
        who = which(system)
        calls.append({"who": who, "system": system, "messages": rest, "stream": bool(sent.get("stream")), "body": sent})

        if sent.get("stream") and self.path.startswith("/cut/"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for piece, fin in (("The harbour wall ", None), ("was built by the", "length")):
                self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": piece}, "finish_reason": fin}]}) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
            return

        if sent.get("stream") and sent.get("model") == "thinker":
            # a model that thinks out loud first, slowly enough to be watched, then answers
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            try:
                for piece in ["The harbour ", "wall was ", "built after ", "the flood, ", "so the answer ", "should say ", "who paid ", "for it."]:
                    self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"reasoning_content": piece}}]}) + "\n\n").encode())
                    self.wfile.flush()
                    time.sleep(0.35)
                for piece in ["The harbour wall ", "was paid for by the guild."]:
                    self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": piece}}]}) + "\n\n").encode())
                    self.wfile.flush()
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        if sent.get("stream") and "tell me something long" in json.dumps(rest[-1:] if rest else []):
            # a fast model: two hundred small pieces, 5ms apart -- the way tokens really arrive
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            try:
                for i in range(200):
                    self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": f"word {i} and done. "}}]}) + "\n\n").encode())
                    self.wfile.flush()
                    time.sleep(0.005)
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        if sent.get("stream"):
            time.sleep(DELAY["front"])
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            try:
                FRONT_N[0] += 1
                for piece in ["All ", "right — ", "done ", "and ", "done. "] + ["More words so the reply is long. "] * 30 + [f"[reply {FRONT_N[0]}]"]:
                    self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {"content": piece}}]}) + "\n\n").encode())
                    self.wfile.flush()
                    time.sleep(0.01)
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        time.sleep(DELAY["worker"])
        asked_for = rest[0]["content"].split("What the author just asked for:")[-1] if rest else ""
        if who == "listener":
            # a listener that knows two sentences; anything else it cannot read, and the house
            # falls back to the old reading, so every other scenario here is routed as before
            said = rest[0]["content"].split("just said:")[-1].lower() if rest else ""
            if "still waiting on" in rest[0]["content"].lower() and "yes, all of it" in said:
                body = '{"jobs":[{"worker":"showrunner","task":"Bruce approved the whole plan.","resumes":true}]}'
            elif "jovan should be seventeen" in said:
                body = '{"jobs":[{"worker":"editor","task":"Change the age in Jovan\'s heading from 16 to 17."}]}'
            elif "a lighthouse would suit" in said:
                body = '{"jobs":[{"worker":"editor","task":"Move the scene to the Lighthouse."}]}'
            else:
                body = "hm, hard to say"
        elif who == "editor" and "heading from 16 to 17" in asked_for:
            # like a real model: quote the heading exactly as it stands in the document it was shown
            shown = rest[0]["content"].split("The documents as they stand:")[-1]
            m = re.search(r"(?m)^## MC \u2014 Jovan \(16\)$", shown)
            body = ('Changed his age.\n\n<edits>\n' + json.dumps([{"file": "My Old PE.md", "find": m.group(0) if m else "(not shown)",
                    "replace": "## MC \u2014 Jovan (17)", "reason": "his age"}]) + '\n</edits>')
        elif who == "showrunner" and "the north arc" in asked_for and "What you put to" not in asked_for:
            # the craft's 10.2: a plan first, never executed without his say
            body = ('I read the whole plot essential and the north arc.\n\n'
                    '<ask>NORTH ARC PLAN: say the leviathan is dormant, not dead, so the arc stops reading as a funeral. Go ahead?</ask>')
        elif who == "builder":
            body = ('I started the plot essential from what you described.\n\n<edits>\n'
                    '[{"create_file":"Plot Essential.md","replace":"# PLOT ESSENTIAL — The Leviathan Quarter — V1.0\\n\\n'
                    '## WORLD\\n### Rules\\n- The city lives inside a dormant leviathan.\\n\\n## SCENE\\nWHERE: the Ribway\\n",'
                    '"reason":"the premise"}]\n</edits>')
        elif who == "showrunner":
            body = ('I tidied it: the rule now says what it means.\n\n<edits>\n'
                    '[{"file":"Plot Essential.md","find":"- The city lives inside a dormant leviathan.",'
                    '"replace":"- The city lives inside a leviathan that is dormant, not dead.","reason":"clearer"}]\n</edits>')
        elif who == "worldbook":
            # a worldbook keeper: the whole list again, with the entry it was asked for
            wb = [{"name": "The War", "keys": [], "content": "The long war is in its ninth year and every city feels it.", "strategy": "blue"},
                  {"name": "Aldric", "keys": ["Aldric"], "content": "A general of the Iron Legion.", "strategy": "green"},
                  {"name": "Brin", "keys": ["Brin", "the smith"], "content": "The smith of the Ribway.", "strategy": "green", "order": 120}]
            body = ('Added Brin.\n\n<edits>\n' + json.dumps([{"file": "Standing Lore.json", "replace_all": True,
                    "replace": json.dumps(wb, indent=2), "reason": "a new entry"}]) + '\n</edits>')
        elif who == "compressor":
            body = "<need>SCENE</need>"      # a worker that only ever asks to read more
        elif who == "editor" and "misquote test" in rest[0]["content"] and "could not be placed" not in rest[0]["content"]:
            # a model that misquotes: one word the document does not have
            body = ('I moved it.\n\n<edits>\n' + json.dumps([{"file": "Plot Essential.md", "find": "WHERE: the Ribwayy",
                    "replace": "WHERE: the Lighthouse", "reason": "moved the scene"}]) + '\n</edits>')
        elif who == "editor" and "could not be placed" in rest[0]["content"]:
            # asked to quote again: the SAME change it meant, now quoting the document as it is
            docs_part = rest[0]["content"].split("The documents as they stand:")[-1]
            m = re.search(r"(?m)^WHERE[^:\n]*: [^\n/]*", docs_part)
            body = ('Quoted exactly this time.\n\n<edits>\n' + json.dumps([{"file": "Plot Essential.md",
                    "find": m.group(0).rstrip() if m else "WHERE: the Ribway", "replace": "WHERE: the Lighthouse",
                    "reason": "moved the scene"}]) + '\n</edits>')
        elif who == "editor":
            # like a real model: quote the line that is actually in the document it was shown
            shown = rest[0]["content"] if rest else ""
            m = re.search(r"(?m)^WHERE[^:\n]*: [^\n/]*", shown)
            line = m.group(0).rstrip() if m else "WHERE: the Ribway"
            target = re.search(r"to the (\w+)", rest[0]["content"].split("What the author just asked for:")[-1]) if rest else None
            place = target.group(1) if target else "Heartworks"
            body = ('I changed the scene.\n\n<edits>\n' + json.dumps([{"file": "Plot Essential.md", "find": line,
                    "replace": "WHERE: the " + place, "reason": "moved the scene"}]) + '\n</edits>')
        else:
            body = "Read it all back; nothing else needed changing."
        calls[-1]["reply"] = body
        raw = json.dumps({"choices": [{"message": {"content": body}, "finish_reason": "stop"}]}).encode()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass


FRONT_N = [0]


class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    return json.loads(urllib.request.urlopen(req).read())


def world(pid):
    return api(f"/api/project/{pid}")


def main():
    from playwright.sync_api import sync_playwright

    home = Path(tempfile.mkdtemp(prefix="cozymaker-worlds-"))
    env = dict(os.environ, COZYMAKER_HOME=str(home), COZYMAKER_PORT=str(PORT))

    def start_server():
        s = subprocess.Popen([sys.executable, str(ROOT / "serve.py")], env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(200):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/version", timeout=1).read()
                break
            except Exception:
                time.sleep(0.1)
        return s

    srv = [start_server()]
    model = Threaded(("127.0.0.1", MODEL_PORT), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()

    try:
        house = api("/api/house")
        house["connections"] = [{"id": "c1", "name": "the good one", "url": f"http://127.0.0.1:{MODEL_PORT}/v1",
                                 "model": "test-model", "key": "k"}]
        house["agentConnections"] = {"keeper": "c1"}
        house["settings"].update({"makerName": "Eni", "yourName": "Bruce", "person": "second"})
        house["personaFrame"] = "You are {{char}}, and {{user}} is the one you build worlds with."
        api("/api/house", "PUT", house)

        # a world saved the OLD way, with its turns on the world itself
        api("/api/project/p_old", "PUT", {
            "id": "p_old", "title": "An Older World",
            "docs": [{"id": "d0", "name": "Notes.md", "kind": "notes", "text": "old notes"}],
            "turns": [{"role": "writer", "text": "an old question", "at": 1000},
                      {"role": "maker", "text": "an old answer", "at": 2000}],
        })
        time.sleep(0.05)
        api("/api/project/p_new", "PUT", {"id": "p_new", "title": "The Leviathan Quarter", "docs": [], "chats": []})

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                      is_mobile=True, has_touch=True, accept_downloads=True)
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)
            page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
            page.wait_for_timeout(800)

            # ---------------------------------------------------- the drawer
            ok("the newest world opens first", page.locator("#worldName").inner_text() == "The Leviathan Quarter",
               page.locator("#worldName").inner_text())
            ok("the button that opens the drawer says what it is",
               page.get_attribute("#menuBtn", "aria-label") == "Your worlds and conversations")
            page.click("#menuBtn")
            page.wait_for_timeout(400)
            ok("the drawer slides in from the left", page.locator("#drawer.open").count() == 1)
            text = page.locator("#drawerBody").inner_text()
            ok("the drawer lists every world", "The Leviathan Quarter" in text and "An Older World" in text, text[:300])
            ok("the drawer names its parts", "conversations" in text.lower() and "documents" in text.lower())
            ok("an empty world offers a new plot essential by name", "New plot essential" in text)
            ok("and a way to bring one in", "Bring one in" in text)
            order = [t for t in re.findall(r"(The Leviathan Quarter|An Older World)", text)]
            ok("worlds are listed newest first", order[:2] == ["The Leviathan Quarter", "An Older World"], order)

            page.mouse.click(372, 420)
            page.wait_for_timeout(300)
            ok("tapping outside closes it", page.locator("#drawer.open").count() == 0)

            page.mouse.move(0, 0)
            page.evaluate("""() => {
              const t = (x, y) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
              document.dispatchEvent(new TouchEvent('touchstart', { touches: [t(8, 400)], changedTouches: [t(8, 400)], bubbles: true }));
              document.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(150, 410)], bubbles: true }));
            }""")
            page.wait_for_timeout(350)
            ok("a swipe from the left edge opens it", page.locator("#drawer.open").count() == 1)
            page.mouse.click(372, 420)
            page.wait_for_timeout(300)

            # ---------------------------------------- the old world moves in whole
            page.click("#menuBtn")
            page.wait_for_timeout(300)
            page.locator(".world-row", has_text="An Older World").click()
            page.wait_for_timeout(700)
            ok("an old world opens", page.locator("#worldName").inner_text() == "An Older World")
            turns = page.locator(".turn .bubble").all_inner_texts()
            ok("its old conversation is all there, in order", turns[:2] == ["an old question", "an old answer"], turns)
            page.wait_for_timeout(1200)
            saved = world("p_old")
            ok("on the device it now lives in a conversation", len(saved.get("chats", [])) == 1 and "turns" not in saved,
               json.dumps(saved)[:300])
            ok("nothing of it was lost", [t["text"] for t in (saved.get("chats") or [{"turns": []}])[0]["turns"]] == ["an old question", "an old answer"])
            first_id = (saved.get("chats") or [{}])[0].get("id")
            page.locator(".world-row", has_text="The Leviathan Quarter").click() if False else None
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(700)
            ok("opening it again keeps the same conversation", (world("p_old").get("chats") or [{}])[0].get("id") == first_id)
            page.click("#menuBtn")
            page.wait_for_timeout(300)

            page.locator(".world-row", has_text="The Leviathan Quarter").click()
            page.wait_for_timeout(700)
            page.mouse.click(372, 420)
            page.wait_for_timeout(300)

            # ---------------------------------------- a new plot essential, by name
            ok("an empty world says how to begin", page.locator(".empty .btn", has_text="Start a plot essential").count() == 1)
            calls.clear()
            page.locator(".empty .btn", has_text="Start a plot essential").click()
            page.wait_for_function("() => { const b = document.querySelectorAll('.turn.maker .bubble'); return b.length && /done/.test(b[b.length-1].textContent); }", timeout=30000)
            page.wait_for_timeout(1300)
            ok("the job appears in the conversation in plain words",
               "Let's start a new plot essential" in page.locator(".turn.writer .bubble").first.inner_text())
            ok("the builder was the one sent", any(c["who"] == "builder" for c in calls), [c["who"] for c in calls])
            saved = world("p_new")
            pe = [d for d in saved["docs"] if d["name"] == "Plot Essential.md"]
            ok("the plot essential now exists on the device", pe and "dormant leviathan" in pe[0]["text"], json.dumps(saved["docs"])[:200])
            ok("the conversation took its name from what was said",
               saved["chats"][0]["title"].startswith("Let's start a new plot"), saved["chats"][0]["title"])

            front = [c for c in calls if c["who"] == "front"][-1]
            ok("the front was given his names, not SillyTavern's syntax",
               "You are Eni, and Bruce is the one" in front["system"] and "{{" not in front["system"], front["system"][:120])
            roles = [m["role"] for m in front["messages"]]
            ok("one voice on the wire: roles alternate", all(roles[i] != roles[i + 1] for i in range(len(roles) - 1)), roles)
            ok("his words reach the front exactly once",
               sum(m["content"].count("Let's start a new plot essential") for m in front["messages"]) == 1)
            ok("the front is never taught the workers' tools", "<need>" not in json.dumps(front["messages"]))
            ok("the front never calls him 'the writer'", "the writer" not in front["system"].lower())

            # ---------------------------------------- the workers hear the talk
            calls.clear()
            page.fill("#say", "move the scene to the Heartworks")
            page.click("#sendBtn")
            page.wait_for_function("() => document.querySelectorAll('.turn.maker').length >= 2 && !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(1300)
            editor = [c for c in calls if c["who"] == "editor"]
            ok("the editor was sent for a change", len(editor) == 1, [c["who"] for c in calls])
            ok("a one-field edit is not followed by a full read-back (the craft's *edit: required scan only)",
               not any(c["who"] == "eye" for c in calls), [c["who"] for c in calls])
            ok("his own request is labelled as his",
               editor and "What the author just asked for:\nmove the scene to the Heartworks" in editor[0]["messages"][0]["content"])
            if editor:
                u = editor[0]["messages"][0]["content"]
                ok("the worker hears the conversation that led here", "Let's start a new plot essential" in u)
                ok("the worker hears who said what, by name", "Bruce:" in u and "Eni:" in u)
            saved = world("p_new")
            ok("the change reached the device", "WHERE: the Heartworks" in saved["docs"][0]["text"])

            # ---------------------------------------- Tidy it up, by name, on the document
            page.click("#docsBtn")
            page.wait_for_timeout(400)
            page.locator("#docsBody .row .grow", has_text="Plot Essential.md").click()
            page.wait_for_timeout(400)
            jobs = page.locator(".doc-jobs").inner_text()
            ok("a document carries its jobs by name", all(w in jobs for w in ("Tidy it up", "Make it shorter", "Check it")), jobs)
            calls.clear()
            page.locator(".doc-jobs .btn", has_text="Tidy it up").click()
            page.wait_for_function("() => document.querySelectorAll('.turn.maker').length >= 3 && !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(1300)
            ok("Tidy it up sends the showrunner", any(c["who"] == "showrunner" for c in calls), [c["who"] for c in calls])
            ok("and shows in the conversation as his own words",
               "Tidy up Plot Essential.md." in page.locator(".turn.writer .bubble").last.inner_text())
            saved = world("p_new")
            ok("the tidy reached the device", "dormant, not dead" in saved["docs"][0]["text"])

            # ---------------------------------------- a new conversation, same documents
            page.click("#menuBtn")
            page.wait_for_timeout(300)
            page.locator(".part-head .btn", has_text="New conversation").click()
            page.wait_for_timeout(700)
            ok("a new conversation starts empty", page.locator(".turn").count() == 0)
            ok("and still has the documents", "Everything in the documents is still here" in page.locator(".empty").inner_text())
            saved = world("p_new")
            ok("the world now holds two conversations", len(saved["chats"]) == 2)

            # ---------------------------------------- the reply lands where it was asked
            DELAY["front"] = 2.5
            page.fill("#say", "change the scene to the Ribway please")
            page.click("#sendBtn")
            page.wait_for_timeout(500)
            ok("while it works, the button is a Stop and looks like one",
               page.locator("#sendBtn.stop").count() == 1 and page.get_attribute("#sendBtn", "aria-label") == "Stop")
            page.locator("#sendBtn").click()   # the same tap again, a moment later
            page.wait_for_timeout(100)
            ok("a double tap is not a Stop", page.locator("#sendBtn.stop").count() == 1)
            asking = world("p_new")["openChat"]
            page.click("#menuBtn")
            page.wait_for_timeout(300)
            page.locator(".item.chat:not(.current) .item-main").first.click()   # walk into the other conversation mid-turn
            page.wait_for_timeout(300)
            ok("elsewhere, the composer says the crew is busy and where",
               page.locator("#say").is_disabled() and "The crew is working in" in page.get_attribute("#say", "placeholder"))
            page.wait_for_function("() => !document.querySelector('#say').disabled", timeout=30000)
            page.wait_for_timeout(1300)
            DELAY["front"] = 0.0
            saved = world("p_new")
            there = [c for c in saved["chats"] if c["id"] == asking][0]
            here = [c for c in saved["chats"] if c["id"] != asking][0]
            ok("the reply landed in the conversation that asked", there["turns"][-1]["role"] == "maker" and "done" in there["turns"][-1]["text"],
               json.dumps(there["turns"][-1])[:200])
            ok("and nowhere else", not any("Ribway please" in t["text"] for t in here["turns"]))

            # ---------------------------------------- Stop stops everything
            page.click("#menuBtn")
            page.wait_for_timeout(300)
            page.locator(".item.chat .item-main", has_text="change the scene").first.click()
            page.wait_for_timeout(400)
            DELAY["worker"] = 2.0
            calls.clear()
            page.fill("#say", "change the scene to the Spire")
            page.click("#sendBtn")
            page.wait_for_timeout(1000)
            page.locator("#sendBtn").click()
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(2500)
            DELAY["worker"] = 0.0
            ok("after Stop, the front is never called", not any(c["who"] == "front" for c in calls), [c["who"] for c in calls])
            ok("the turn says it was stopped", page.locator(".turn.maker .bubble").last.inner_text() == "(stopped)")
            ok("a stopped turn is never handed back to the model as its own words",
               world("p_new")["chats"] and any(t.get("failed") for c in world("p_new")["chats"] for t in c["turns"]))

            # ---------------------------------------- his hand edit wins over the crew's
            DELAY["worker"] = 2.0
            page.fill("#say", "change the scene to the Heartworks again")
            page.click("#sendBtn")
            page.wait_for_timeout(600)
            page.click("#docsBtn")
            page.wait_for_timeout(300)
            page.locator("#docsBody .row .grow", has_text="Plot Essential.md").click()
            page.wait_for_timeout(300)
            area = page.locator("#docsBody textarea")
            area.fill(area.input_value().replace("WHERE:", "WHERE (his own hand):"))
            page.wait_for_timeout(1400)
            page.click("#docsSheet [data-close]")
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(1500)
            DELAY["worker"] = 0.0
            saved = world("p_new")
            doc = [d for d in saved["docs"] if d["name"] == "Plot Essential.md"][0]["text"]
            ok("a hand edit made while the crew worked is kept", "WHERE (his own hand):" in doc, doc[-200:])
            cards = page.locator(".cards").last.inner_text()
            ok("and the crew's change to it says why it was not used", "your version was kept" in cards, cards)

            # ---------------------------------------- he owns the scroll
            DELAY["front"] = 0.0
            page.fill("#say", "just chatting now, tell me something long")
            page.click("#sendBtn")
            page.wait_for_timeout(250)
            page.evaluate("document.getElementById('stream').scrollTop = 0")
            page.wait_for_timeout(1200)
            top = page.evaluate("document.getElementById('stream').scrollTop")
            ok("scrolling up while a reply streams is not undone", top < 40, top)

            # ---------------------------------------- bring one in
            page.click("#menuBtn")
            page.wait_for_timeout(300)
            page.locator(".world-parts .btn", has_text="Bring one in").click()
            page.wait_for_timeout(400)
            page.locator("#docsBody input[type=text]").fill("Old Worldbook.json")
            page.locator("#docsBody textarea").fill(json.dumps([
                {"name": "The Ribway", "keys": ["Ribway"], "content": "a market street", "strategy": "green", "order": 9999},
            ]))
            page.locator("#docsBody .btn", has_text="Bring it in").click()
            page.wait_for_timeout(1300)
            saved = world("p_new")
            wb = [d for d in saved["docs"] if d["name"] == "Old Worldbook.json"]
            ok("a pasted worldbook arrives as a worldbook", wb and wb[0]["kind"] == "worldbook", json.dumps(wb)[:200])
            ok("it arrives whole: its values are his, never rewritten on the way in", wb and json.loads(wb[0]["text"])[0]["order"] == 9999)

            page.locator("#docsBody .row .grow", has_text="Old Worldbook.json").click()
            page.wait_for_timeout(400)
            with page.expect_download() as dl:
                page.locator(".doc-jobs .btn", has_text="Export for SillyTavern").click()
            path = dl.value.path()
            st = json.loads(Path(path).read_text())
            ok("the export is named for SillyTavern", dl.value.suggested_filename == "Old Worldbook - SillyTavern.json", dl.value.suggested_filename)
            ok("the export is in SillyTavern's shape", st["entries"]["0"]["key"] == ["Ribway"] and st["entries"]["0"]["selective"] is True)

            # ---------------------------------------- a world can be renamed and deleted
            page.click("#docsSheet [data-close]")
            page.wait_for_timeout(300)
            page.click("#menuBtn")
            page.wait_for_timeout(400)
            page.once("dialog", lambda d: d.accept("The Leviathan Quarter, renamed"))
            # a row is found by its exact visible name: the folded menu inside every
            # row holds "Rename" and "Delete", and has_text reads hidden text too
            row_for = lambda title: page.locator(".world-line").filter(
                has=page.locator(".world-name", has_text=re.compile("^" + re.escape(title) + "$")))
            row_for("An Older World").locator(".item-menu > .iconbtn").click()
            row_for("An Older World").locator(".item-actions .btn", has_text="Rename").click()
            page.wait_for_timeout(700)
            ok("a world not on screen can be renamed", world("p_old")["title"] == "The Leviathan Quarter, renamed")
            page.once("dialog", lambda d: d.accept())
            ok("the drawer draws each world once", page.locator(".world-line").count() == 2, page.locator(".world-line").count())
            row_for("The Leviathan Quarter, renamed").locator(".item-menu > .iconbtn").click()
            row_for("The Leviathan Quarter, renamed").locator(".item-actions .btn", has_text="Delete").click()
            page.wait_for_timeout(900)
            ids = [p["id"] for p in api("/api/projects")["projects"]]
            ok("a world can be deleted from the drawer", "p_old" not in ids, ids)
            ok("the world on screen is untouched by it", page.locator("#worldName").inner_text() == "The Leviathan Quarter")

            # ---------------------------------------- the front's refusals, through the real server
            h = api("/api/house")
            h["connections"] += [
                {"id": "c2", "name": "no thinking here", "url": f"http://127.0.0.1:{MODEL_PORT}/refuse/v1",
                 "model": "test-model", "key": "k", "thinking": "high"},
                {"id": "c3", "name": "wrong key", "url": f"http://127.0.0.1:{MODEL_PORT}/badkey/v1",
                 "model": "test-model", "key": "nope"},
                {"id": "c4", "name": "an old level", "url": f"http://127.0.0.1:{MODEL_PORT}/v1",
                 "model": "test-model", "key": "k", "thinking": "minimal"},
            ]
            h["agentConnections"]["keeper"] = "c2"
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(700)
            ok("an old saved level is repaired to one that exists",
               [c for c in api("/api/house")["connections"] if c["id"] == "c4"][0].get("thinking") == "low")
            calls.clear()
            page.fill("#say", "just chatting, nothing to change")
            page.click("#sendBtn")
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(1200)
            refused = [c for c in calls if c["who"] == "refuse"]
            # This stand-in refuses EVERY thinking field but names only reasoning_effort. The house learns
            # what each refusal names (Cozy Tavern M350): the first try names reasoning_effort, the second
            # teaches nothing new, so thinking is silenced for the day (M319), and the third goes through.
            # (Before the port this was 2 tries, because the first refusal threw every field away at once.)
            # The listener rides the front's connection when nothing else is set, so it meets the refusal
            # first and learns; the front after it goes right the first time.
            THINK = ("thinking", "reasoning_effort", "reasoning", "enable_thinking")
            ok("a refused thinking level is learned from and goes again", len(refused) == 4, len(refused))
            ok("the second try left out the field that was named", len(refused) == 4 and "reasoning_effort" not in refused[1]["body"])
            ok("the third carried no thinking at all", len(refused) == 4 and not any(k in refused[2]["body"] for k in THINK))
            ok("and every call after the lesson carries none either", all(not any(k in c["body"] for k in THINK) for c in refused[2:]))
            learned = [c for c in api("/api/house")["connections"] if c["id"] == "c2"][0].get("learned") or {}
            ok("what it learned is kept on the connection", "reasoning_effort" in (learned.get("drop") or []) and learned.get("downAt"), learned)
            last = page.locator(".turn.maker .bubble").last.inner_text()
            ok("and the reply arrives instead of an empty bubble", "done" in last, last[:120])
            calls.clear()
            page.fill("#say", "and one more on the same connection")
            page.click("#sendBtn")
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(900)
            again = [c for c in calls if c["who"] == "refuse"]
            ok("the next turn goes right the first time — the listener and the front, once each, no thinking",
               len(again) == 2 and not any(any(k in c["body"] for k in THINK) for c in again), len(again))

            h["agentConnections"]["keeper"] = "c3"
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(700)
            calls.clear()
            page.fill("#say", "just chatting again")
            page.click("#sendBtn")
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(1200)
            last = page.locator(".turn.maker .bubble").last.inner_text()
            ok("a refused call says what the provider said", "did not go through" in last and "Incorrect API key" in last, last[:160])
            bad = [c for c in calls if c["who"] == "badkey"]
            ok("a bad key is asked once, not retried — once by the listener, once by the front",
               len(bad) == 2 and sum(1 for c in bad if c["body"].get("stream")) == 1, len(bad))

            # ---------------------------------------- the findable retry
            ok("a failed turn that changed nothing offers Try again",
               page.locator(".turn.maker").last.locator(".again").count() == 1)
            h["agentConnections"]["keeper"] = "c1"
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(700)
            before = len(page.locator(".turn").all())
            page.locator(".turn.maker").last.locator(".again").click()
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop') && /done/.test([...document.querySelectorAll('.turn.maker .bubble')].pop().textContent)", timeout=30000)
            page.wait_for_timeout(800)
            writers = page.locator(".turn.writer .bubble").all_inner_texts()
            ok("Try again sends his same words", writers[-1] == "just chatting again", writers[-3:])
            ok("and does not leave the failed attempt behind", writers.count("just chatting again") == 1 and len(page.locator(".turn").all()) == before)
            ok("the answer arrives", "done" in page.locator(".turn.maker .bubble").last.inner_text())

            # ---------------------------------------- a turn spent entirely on asking to read more
            calls.clear()
            page.click("#docsBtn")
            page.wait_for_timeout(300)
            page.locator("#docsBody .row .grow", has_text="Plot Essential.md").click()
            page.wait_for_timeout(300)
            page.locator(".doc-jobs .btn", has_text="Make it shorter").click()
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(800)
            comp = [c for c in calls if c["who"] == "compressor"]
            ok("a worker that only asks to read more is told to do the job with what it has",
               any("You have been shown everything" in c["messages"][0]["content"] for c in comp), len(comp))
            ok("and it is asked at most four times", len(comp) <= 4, len(comp))

            # ---------------------------------------- the drawer keeps its place when redrawn
            page.set_viewport_size({"width": 390, "height": 420})
            page.click("#menuBtn")
            page.wait_for_timeout(400)
            room = page.evaluate("(() => { const b = document.getElementById('drawerBody'); return b.scrollHeight - b.clientHeight; })()")
            ok("the drawer has somewhere to scroll at this size", room > 60, room)
            page.evaluate("document.getElementById('drawerBody').scrollTop = 60")
            page.wait_for_timeout(100)
            page.evaluate("import('/js/ui/drawer.js').then((m) => m.draw())")
            page.wait_for_timeout(600)
            kept = page.evaluate("document.getElementById('drawerBody').scrollTop")
            ok("a redraw does not throw him back to the top", kept == 60, kept)
            page.mouse.click(372, 300)
            page.wait_for_timeout(300)
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(300)

            # ---------------------------------------- a reply cut at the limit says so
            h = api("/api/house")
            h["connections"].append({"id": "c5", "name": "short", "url": f"http://127.0.0.1:{MODEL_PORT}/cut/v1",
                                     "model": "test-model", "key": "k"})
            h["agentConnections"]["keeper"] = "c5"
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)
            page.fill("#say", "tell me about the harbour")
            page.click("#sendBtn")
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(800)
            ok("a reply cut at the limit says where it was cut", page.locator(".turn.maker").last.locator(".cutnote").count() == 1)
            ok("a finished reply does not", page.locator(".turn.maker").nth(0).locator(".cutnote").count() == 0)
            h["agentConnections"]["keeper"] = "c1"
            api("/api/house", "PUT", h)

            # ---------------------------------------- the name boxes, through the real settings panel
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)
            page.click("#settingsBtn")
            page.wait_for_timeout(500)
            you_box = page.locator("input[placeholder^='Bruce, Jovan']")
            note_sel = "#houseBody p.hint:has-text('Your instructions say')"
            ok("with both names set, nothing is pointed at", page.locator(note_sel).count() == 0 or not page.locator(note_sel).first.is_visible())
            you_box.fill("")
            you_box.dispatch_event("change")
            page.wait_for_timeout(700)
            ok("an empty name under a {{user}} is pointed at, plainly",
               page.locator(note_sel).count() == 1 and page.locator(note_sel).first.is_visible()
               and "{{user}}" in page.locator(note_sel).first.inner_text(), page.locator(note_sel).all_inner_texts())
            you_box.fill("Bruce")
            you_box.dispatch_event("change")
            page.wait_for_timeout(700)
            ok("filling it in clears the pointer", not page.locator(note_sel).first.is_visible())
            ok("and the name is saved to the house", api("/api/house")["settings"]["yourName"] == "Bruce")
            page.click("#houseSheet [data-close]")
            page.wait_for_timeout(300)

            # ---------------------------------------- the essentials: versions, edit, delete, branch, go on
            page.on("dialog", lambda d: d.accept())
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(700)

            def settle():
                page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
                page.wait_for_timeout(1000)

            def last_maker():
                return page.locator(".turn.maker").last

            def pe_text():
                return [d for d in world("p_new")["docs"] if d["name"] == "Plot Essential.md"][0]["text"]

            def tag(s):
                m = re.search(r"\[reply \d+\]", s)
                return m.group(0) if m else "(none)"

            # another answer: kept beside the first, shown in its place, no message added
            page.fill("#say", "just talking about the harbour tonight")
            page.click("#sendBtn")
            settle()
            count = page.locator(".turn").count()
            first = last_maker().locator(".bubble").inner_text()
            last_maker().locator(".swipes .btn", has_text="Another answer").click()
            settle()
            second = last_maker().locator(".bubble").inner_text()
            ok("another answer is written in the old one's place", page.locator(".turn").count() == count and tag(second) != tag(first), (tag(first), tag(second)))
            ok("and the first is kept to go back to", last_maker().locator(".swipe-count").inner_text().strip() == "2 / 2")
            last_maker().locator("button[aria-label='The answer before this one']").click()
            page.wait_for_timeout(800)
            ok("the answer before it comes back with one tap", tag(last_maker().locator(".bubble").inner_text()) == tag(first)
               and last_maker().locator(".swipe-count").inner_text().strip() == "1 / 2")
            calls.clear()
            page.fill("#say", "and what comes next")
            page.click("#sendBtn")
            settle()
            fronts = [c for c in calls if c["stream"]]
            sent = json.dumps(fronts[0]["messages"]) if fronts else ""
            ok("the model is sent the answer that is shown, not the newest", tag(first) in sent and tag(second) not in sent, (tag(first), tag(second)))

            # a crew answer: another one puts its change back first; walking back makes the first one's again
            wd = world("p_new")
            for d in wd["docs"]:
                if d["name"] == "Plot Essential.md":
                    d["text"] = ("# PLOT ESSENTIAL — The Leviathan Quarter — V1.0\n\n## WORLD\n### Rules\n"
                                 "- The city lives inside a dormant leviathan.\n\n## SCENE\nWHERE: the Ribway\n")
            api("/api/project/p_new", "PUT", wd)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(700)
            calls.clear()
            page.fill("#say", "*cleanup")
            page.click("#sendBtn")
            settle()
            ok("the crew's answer changed the document", pe_text().count("dormant, not dead") == 1, pe_text()[:160])
            eyes = [c for c in calls if c["who"] == "eye"]
            ok("real work is read back afterwards, and the read-back says it is the house asking, not him",
               bool(eyes) and "What the house needs from you" in eyes[0]["messages"][0]["content"]
               and "What the author just asked for" not in eyes[0]["messages"][0]["content"], [c["who"] for c in calls])
            last_maker().locator(".diff-fold .fold-head").first.click()
            page.wait_for_timeout(300)
            was = last_maker().locator(".diff .was").first.inner_text()
            now = last_maker().locator(".diff .now").first.inner_text()
            ok("its card opens to what was there and what is there now", "dormant leviathan." in was and "dormant, not dead" in now, (was[:60], now[:60]))
            last_maker().locator(".swipes .btn", has_text="Another answer").click()
            settle()
            ok("another answer put the first one's change back before making its own — it is there once",
               pe_text().count("dormant, not dead") == 1 and "dormant leviathan." not in pe_text(), pe_text()[:200])
            last_maker().locator("button[aria-label='The answer before this one']").click()
            page.wait_for_timeout(1500)
            ok("walking back puts that change back and makes the first answer's again — still once",
               pe_text().count("dormant, not dead") == 1 and last_maker().locator(".swipe-count").inner_text().strip() == "1 / 2", pe_text()[:200])

            # ---------------------------------------- the listener, and a plan that waits on him
            wd = world("p_new")
            for d in wd["docs"]:
                if d["name"] == "Plot Essential.md":
                    d["text"] = ("# PLOT ESSENTIAL — The Leviathan Quarter — V1.0\n\n## WORLD\n### Rules\n"
                                 "- The city lives inside a dormant leviathan.\n\n## SCENE\nWHERE: the Ribway\n")
            api("/api/project/p_new", "PUT", wd)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(700)
            calls.clear()
            page.fill("#say", "Honestly a lighthouse would suit this scene far better.")
            page.click("#sendBtn")
            settle()
            ok("plain words no keyword names are heard by the listener", any(c["who"] == "listener" for c in calls), [c["who"] for c in calls])
            ok("and the one it sent changed the document on the device", "WHERE: the Lighthouse" in pe_text(), pe_text()[-60:])
            calls.clear()
            page.fill("#say", "*cleanup the north arc feels muddled")
            page.click("#sendBtn")
            settle()
            ok("a plan that needs his say changes nothing yet", "dormant leviathan." in pe_text() and "dormant, not dead" not in pe_text(), pe_text()[:200])
            chat = max(world("p_new")["chats"], key=lambda c: c.get("updated", 0))
            waiting = [t for t in chat["turns"] if t["role"] == "maker"][-1].get("asks") or []
            ok("what waits on him is kept on the turn, on the device", len(waiting) == 1 and waiting[0]["worker"] == "showrunner"
               and "NORTH ARC PLAN" in waiting[0]["ask"], waiting)
            fronts = [c for c in calls if c["who"] == "front"]
            ok("the persona was told to put all of it to him", bool(fronts) and "Still to decide" in json.dumps(fronts[-1]["messages"])
               and "NORTH ARC PLAN" in json.dumps(fronts[-1]["messages"]))
            calls.clear()
            page.fill("#say", "yes, all of it")
            page.click("#sendBtn")
            settle()
            sr = [c for c in calls if c["who"] == "showrunner"]
            ok("his yes went back to the same worker with its plan, word for word", bool(sr)
               and "What you put to Bruce last time, word for word:\nNORTH ARC PLAN" in sr[0]["messages"][0]["content"], [c["who"] for c in calls])
            ok("and the plan he approved landed on the device", pe_text().count("dormant, not dead") == 1, pe_text()[:200])
            # the scenes after this one start where the swipes left the world: the scene back at the Ribway
            wd = world("p_new")
            for d in wd["docs"]:
                if d["name"] == "Plot Essential.md":
                    d["text"] = d["text"].replace("WHERE: the Lighthouse", "WHERE: the Ribway")
            api("/api/project/p_new", "PUT", wd)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(700)

            # ---------------------------------------- his own plot essential, brought in raw, then edited in plain words
            RAW = ("# PLOT ESSENTIAL \u2014 The Ashen Coast \u2014 V2.3\r\n\r\n## WORLD\r\n### Rules\r\n- Magic costs memory.\r\n"
                   "TBD: the name of the drowned king\r\n\r\n### Calendar\r\n\r\n## MC \u2014 Jovan (16)\r\nID: a quiet salvager \u201cfrom\u201d the coast\r\n"
                   "\u2192 Mira: trusts her (P:40 R:0 S:0)\r\n\r\n### Mira (captain | active | 24)\r\nID: captain of the Gull\r\nAGENDA: [HIDDEN]\r\n")
            WHOLE = RAW.replace("\r\n", "\n")
            page.click("#menuBtn")
            page.wait_for_timeout(300)
            page.locator(".world-parts .btn", has_text="Bring one in").click()
            page.wait_for_timeout(400)
            page.locator("#docsBody input[type=text]").fill("My Old PE.md")
            page.locator("#docsBody textarea").fill(RAW)
            page.locator("#docsBody .btn", has_text="Bring it in").click()
            page.wait_for_timeout(1300)
            mine = [d for d in world("p_new")["docs"] if d["name"] == "My Old PE.md"]
            ok("his raw plot essential arrives whole, every word, [HIDDEN] and TBD and all", bool(mine) and mine[0]["text"] == WHOLE and mine[0]["kind"] == "pe",
               (mine[0]["text"][:120] if mine else "not there"))
            page.click("#docsSheet [data-close]")
            page.wait_for_timeout(300)
            calls.clear()
            page.fill("#say", "Jovan should be seventeen now, not sixteen")
            page.click("#sendBtn")
            settle()
            eds = [c for c in calls if c["who"] == "editor"]
            ok("plain words reach the editor through the listener, and it is shown his document word for word",
               any(c["who"] == "listener" for c in calls) and bool(eds) and WHOLE.split("## MC")[0] in eds[0]["messages"][0]["content"], [c["who"] for c in calls])
            after = [d for d in world("p_new")["docs"] if d["name"] == "My Old PE.md"][0]["text"]
            ok("the edit lands in his plot essential", "## MC \u2014 Jovan (17)" in after, after[:200])
            ok("and nothing else of his changed \u2014 not his TBD line, not his empty heading, not his bond, not [HIDDEN]",
               after == WHOLE.replace("## MC \u2014 Jovan (16)", "## MC \u2014 Jovan (17)"), after)

            # a quote that missed goes back to the one who wrote it, once, with exactly what missed
            calls.clear()
            page.fill("#say", "*edit misquote test: move the scene to the Lighthouse")
            page.click("#sendBtn")
            settle()
            eds = [c for c in calls if c["who"] == "editor"]
            ok("a quote that missed is sent back once", len(eds) == 2, len(eds))
            ok("with exactly what it quoted and why it missed", len(eds) == 2 and "WHERE: the Ribwayy" in eds[1]["messages"][0]["content"]
               and "not in the document as written" in eds[1]["messages"][0]["content"])
            where_line = lambda: (re.search(r"WHERE:[^\n]*", pe_text()) or re.search("", "")).group(0)
            ok("and the quote made again lands, where he asked", where_line() == "WHERE: the Lighthouse",
               {"where": where_line(), "second reply": (eds[1].get("reply") or "")[-240:] if len(eds) > 1 else None,
                "second ask tail": eds[1]["messages"][0]["content"][-420:] if len(eds) > 1 else None,
                "cards": last_maker().inner_text()[-300:]})
            ok("the miss that was put right is not left on the card", "Ribwayy" not in last_maker().inner_text())

            # his message, edited and sent again from there: the replies after it put their changes back first
            writer = page.locator(".turn.writer").last
            writer.locator(".bubble").click()
            page.wait_for_timeout(250)
            writer.locator(".turn-actions .btn", has_text="Edit").click()
            page.wait_for_timeout(250)
            writer.locator(".edit-area").fill("*edit move the scene to the Harbour")
            turns_before = page.locator(".turn").count()
            writer.locator(".btn", has_text="Send again from here").click()
            settle()
            ok("sending again from an edited message replaces what followed it", page.locator(".turn").count() == turns_before
               and page.locator(".turn.writer .bubble").last.inner_text() == "*edit move the scene to the Harbour")
            ok("and the change the old reply made was put back first", where_line() == "WHERE: the Harbour" and "Lighthouse" not in pe_text(), where_line())

            # deleting a reply that changed the documents puts its change back
            n = page.locator(".turn").count()
            last_maker().locator(".bubble").click()
            page.wait_for_timeout(250)
            last_maker().locator(".turn-actions .btn", has_text="Delete").click()
            page.wait_for_timeout(1200)
            ok("deleting a reply that changed a document puts the change back", where_line() == "WHERE: the Ribway" and "Harbour" not in pe_text(), where_line())
            ok("and the reply is gone", page.locator(".turn").count() == n - 1)

            # branch here: the talk up to there, in a new conversation beside the old one
            chats_before = len(world("p_new")["chats"])
            page.locator(".turn.writer").first.locator(".bubble").click()
            page.wait_for_timeout(250)
            page.locator(".turn.writer").first.locator(".turn-actions .btn", has_text="Branch here").click()
            page.wait_for_timeout(1200)
            wb = world("p_new")
            ok("Branch here opens a new conversation holding the talk up to there", page.locator(".turn").count() == 1
               and len(wb["chats"]) == chats_before + 1 and any(c["title"].endswith("— branch") for c in wb["chats"]), page.locator(".turn").count())

            # go on: the rest of a reply cut off at the limit joins the same reply
            h = api("/api/house")
            h["agentConnections"]["keeper"] = "c5"
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)
            page.fill("#say", "tell me more about the harbour")
            page.click("#sendBtn")
            settle()
            before_text = last_maker().locator(".bubble").inner_text()
            n = page.locator(".turn").count()
            last_maker().locator(".btn", has_text="Go on").click()
            settle()
            after_text = last_maker().locator(".bubble").inner_text()
            ok("Go on adds the rest to the same reply", after_text.startswith(before_text) and len(after_text) > len(before_text)
               and page.locator(".turn").count() == n, (len(before_text), len(after_text)))
            h["agentConnections"]["keeper"] = "c3"
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)
            kept = last_maker().locator(".bubble").inner_text()
            last_maker().locator(".btn", has_text="Go on").click()
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(300)
            said = page.locator("#toast").inner_text()
            ok("a Go on that fails says why, and the reply is left as it was", "did not go through" in said and last_maker().locator(".bubble").inner_text() == kept, said[:120])
            h["agentConnections"]["keeper"] = "c1"
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)

            # ---------------------------------------- a model too small for the whole world
            wd = world("p_new")
            wd["docs"].append({"id": "dbig", "name": "Old Drafts.md", "kind": "notes",
                               "text": "A long draft line that nobody needs right now, kept anyway.\n" * 1200})
            api("/api/project/p_new", "PUT", wd)
            h = api("/api/house")
            h["connections"].append({"id": "c6", "name": "small", "url": f"http://127.0.0.1:{MODEL_PORT}/small/v1", "model": "test-model", "key": "k"})
            h["agentConnections"]["editor"] = "c6"
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)
            calls.clear()
            page.fill("#say", "*edit move the scene to the Quay")
            page.click("#sendBtn")
            settle()
            refused_small = [c for c in calls if c["who"] == "small-refused"]
            eds = [c for c in calls if c["who"] == "editor"]
            ok("a model too small for the whole world refuses it once", len(refused_small) == 1, [c["who"] for c in calls])
            ok("the whole world was sent first, the long document with it", refused_small and "A long draft line" in refused_small[0]["body"]["messages"][-1]["content"]
               and refused_small[0]["size"] > 70000, refused_small[0]["size"] if refused_small else None)
            ok("and the worker is asked again with the outline, which fits", len(eds) == 1 and sum(len(m["content"]) for m in eds[0]["messages"]) < 30000
               and "more characters of it are not shown" in eds[0]["messages"][0]["content"], [len(m["content"]) for m in eds[0]["messages"]] if eds else None)
            ok("so the change still lands", where_line() == "WHERE: the Quay", where_line())
            wd = world("p_new")
            wd["docs"] = [d for d in wd["docs"] if d["id"] != "dbig"]
            api("/api/project/p_new", "PUT", wd)
            h = api("/api/house")
            h["agentConnections"].pop("editor", None)
            h["connections"] = [c for c in h["connections"] if c["id"] != "c6"]
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)

            # ---------------------------------------- the thinking box: above the reply, live, then how long
            h = api("/api/house")
            h["connections"].append({"id": "c7", "name": "thinks", "url": f"http://127.0.0.1:{MODEL_PORT}/v1", "model": "thinker", "key": "k"})
            h["agentConnections"]["keeper"] = "c7"
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)
            page.fill("#say", "who built the harbour wall")
            page.click("#sendBtn")
            page.wait_for_function("() => document.querySelector('.turn.maker:last-of-type .thinking-box')", timeout=15000)
            page.wait_for_timeout(1300)
            live = page.locator(".turn.maker").last
            live_head = live.locator(".thinking-head").inner_text()
            order = live.evaluate("t => [...t.children].map(c => c.className)")
            ok("while it thinks, the box says Thinking and counts the seconds", live_head.startswith("\u25b8 Thinking\u2026"), live_head)
            ok("and it sits above the reply", order.index("thinking-box") < order.index("bubble") if "thinking-box" in order and "bubble" in order else False, order)
            live.locator(".thinking-head").click()
            page.wait_for_timeout(500)
            ok("opened, it shows the thinking as it arrives", "The harbour" in live.locator(".thinking-text").inner_text())
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(900)
            done = page.locator(".turn.maker").last
            done_head = done.locator(".thinking-head").inner_text()
            ok("afterwards it says how long it thought", re.match(r"^\u25b8 Thought for \d+s$", done_head) is not None, done_head)
            order = done.evaluate("t => [...t.children].map(c => c.className)")
            ok("and it stays above the reply", order.index("thinking-box") < order.index("bubble"), order)
            ok("shut until tapped", done.locator(".thinking-body").is_hidden())
            done.locator(".thinking-head").click()
            page.wait_for_timeout(300)
            ok("tapped, the whole of it is there", done.locator(".thinking-text").inner_text() == "The harbour wall was built after the flood, so the answer should say who paid for it.")
            ok("with a way to copy it", done.locator(".thinking-body .btn", has_text="Copy the thinking").count() == 1)
            kept = [t for t in world("p_new")["chats"] if t["id"] == world("p_new")["openChat"]][0]["turns"][-1]
            ok("how long it thought is kept with the reply", isinstance(kept.get("thinkingMs"), int) and kept["thinkingMs"] >= 2000, kept.get("thinkingMs"))
            ok("and the old wording is nowhere on the page", "turning over" not in page.content())
            h = api("/api/house")
            h["agentConnections"]["keeper"] = "c1"
            h["connections"] = [c for c in h["connections"] if c["id"] != "c7"]
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)

            # ---------------------------------------- everything in one file, and back by adding only
            page.click("#settingsBtn")
            page.wait_for_timeout(500)
            worlds_before = api("/api/projects")["projects"]
            with page.expect_download() as dl:
                page.locator("#houseBody .btn", has_text="Save everything to a file").click()
            saved_path = dl.value.path()
            saved_text = Path(saved_path).read_text()
            backup = json.loads(saved_text)
            ok("everything goes into one file", backup.get("format") == "cozymaker-backup" and len(backup["worlds"]) == len(worlds_before),
               (backup.get("format"), len(backup.get("worlds", [])), len(worlds_before)))
            ok("with none of the connection keys in it", '"key": "k"' not in saved_text and '"key":"k"' not in saved_text and '"key":"nope"' not in saved_text)
            page.locator("#houseBody input[type=file]").set_input_files(saved_path)
            page.wait_for_timeout(2500)
            after = api("/api/projects")["projects"]
            restored = [x for x in after if "(restored" in x["title"]]
            ok("bringing it back adds every world beside the ones here", len(after) == 2 * len(worlds_before) and len(restored) == len(worlds_before),
               (len(worlds_before), len(after), len(restored)))
            ok("and every world already here is exactly as it was", all(any(x["id"] == o["id"] and x["title"] == o["title"] for x in after) for o in worlds_before))
            page.click("#houseSheet [data-close]")
            page.wait_for_timeout(300)
            for x in restored:
                api(f"/api/project/{x['id']}", "DELETE")

            # ---------------------------------------- a worldbook's always-on cost, and side by side
            wd = world("p_new")
            wd["docs"].append({"id": "dwb", "name": "Standing Lore.json", "kind": "worldbook", "text": json.dumps([
                {"name": "The War", "keys": [], "content": "The long war is in its ninth year and every city feels it.", "strategy": "blue"},
                {"name": "Aldric", "keys": ["Aldric"], "content": "A general of the Iron Legion.", "strategy": "green"}])})
            api("/api/project/p_new", "PUT", wd)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)
            page.click("#docsBtn")
            page.wait_for_timeout(400)
            wb_row = page.locator("#docsBody .row", has_text="Standing Lore.json").inner_text()
            ok("a worldbook shows what its always-on entries cost on every message", "always on:" in wb_row and "tokens" in wb_row, wb_row)
            page.locator("#docsBody .btn", has_text="Side by side").click()
            page.wait_for_timeout(300)
            ok("side by side puts two documents next to each other", page.locator("#docsBody .compare .pane").count() == 2)
            ok("each with its own Copy", page.locator("#docsBody .compare .pane .btn", has_text="Copy").count() == 2)
            page.locator("#docsBody .btnrow .btn.small:not(.quiet)").first.click()
            page.wait_for_timeout(300)
            ok("a tap on a shown name puts it away", page.locator("#docsBody .compare .pane").count() == 1)
            page.locator("#docsBody .btn", has_text="Back to the documents").click()
            page.wait_for_timeout(300)
            ok("and Back returns to the documents", page.locator("#docsBody .btn", has_text="Side by side").count() == 1)

            # his own version of the worldbook keeper's craft reaches the keeper, and the original is one tap away
            page.locator("#docsBody .row .grow", has_text="Standing Lore.json").click()
            page.wait_for_timeout(400)
            page.locator("#docsBody .fold-head", has_text="how the worldbook keeper works").click()
            page.wait_for_timeout(700)
            craft_box = page.locator("#docsBody .fold", has_text="how the worldbook keeper works").locator("textarea")
            ok("the worldbook keeper's craft is shown, the extension's own", "YOU OWN EVERY FIELD" in craft_box.input_value())
            craft_box.fill(craft_box.input_value() + "\nWRITE EVERY ENTRY IN BRITISH ENGLISH.")
            page.locator("#docsBody .fold", has_text="how the worldbook keeper works").locator(".btn", has_text="Save").click()
            page.wait_for_timeout(500)
            ok("his version is kept", "BRITISH ENGLISH" in ((api("/api/house").get("crafts") or {}).get("worldbook") or ""))
            page.click("#docsSheet [data-close]")
            page.wait_for_timeout(300)

            # the export reads the worldbook as it is at the tap, even with the sheet opened before the change landed
            DELAY["worker"] = 2.0
            calls.clear()
            page.fill("#say", "add Brin the smith to the worldbook")
            page.click("#sendBtn")
            page.wait_for_timeout(400)
            page.click("#docsBtn")
            page.wait_for_timeout(400)
            page.locator("#docsBody .row .grow", has_text="Standing Lore.json").click()
            page.wait_for_timeout(300)
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)
            page.wait_for_timeout(900)
            DELAY["worker"] = 0.0
            with page.expect_download() as dl:
                page.locator("#docsBody .btn", has_text="Export for SillyTavern").click()
            st = json.loads(Path(dl.value.path()).read_text())
            names = [e.get("comment") for e in st.get("entries", {}).values()]
            ok("the export holds what landed while the sheet was open", len(names) == 3 and "Brin" in names, names)
            ok("and it is SillyTavern's shape, the extension's mapping", st["entries"]["0"]["constant"] is True and st["entries"]["2"]["key"] == ["Brin", "the smith"])
            wbc = [c for c in calls if c["who"] == "worldbook"]
            ok("asking for a worldbook entry sends the worldbook keeper", len(wbc) == 1, [c["who"] for c in calls])
            ok("who reads his version of its craft", wbc and "WRITE EVERY ENTRY IN BRITISH ENGLISH." in wbc[0]["system"])
            page.locator("#docsBody .fold-head", has_text="how the worldbook keeper works").click()
            page.wait_for_timeout(700)
            page.locator("#docsBody .fold", has_text="how the worldbook keeper works").locator(".btn", has_text="Put back the original").click()
            page.wait_for_timeout(500)
            ok("and Put back the original puts the original back", "worldbook" not in (api("/api/house").get("crafts") or {}))
            page.click("#docsSheet [data-close]")
            page.wait_for_timeout(300)

            # his own edits: kept when he leaves, and put back with one tap
            pe_before = pe_text()
            page.click("#docsBtn")
            page.wait_for_timeout(400)
            page.locator("#docsBody .row .grow", has_text="Plot Essential.md").click()
            page.wait_for_timeout(300)
            page.locator("#docsBody .docedit textarea").fill(pe_before + "\nA LINE HE ADDED BY HAND.")
            page.wait_for_timeout(300)
            page.click("#docsSheet [data-close]")
            t0 = time.time()
            reached = until(lambda: "A LINE HE ADDED BY HAND." in pe_text(), 3.0)
            ok("his edit reaches the device as he leaves the document", reached and time.time() - t0 < 0.8, round(time.time() - t0, 2))
            page.click("#docsBtn")
            page.wait_for_timeout(400)
            page.locator("#docsBody .row .grow", has_text="Plot Essential.md").click()
            page.wait_for_timeout(300)
            page.locator("#docsBody .btn", has_text="Put back my edits").click()
            ok("Put back my edits returns the document to exactly how he found it", until(lambda: pe_text() == pe_before), pe_text()[-80:])
            ok("and the button goes, with nothing left to put back", page.locator("#docsBody .btn", has_text="Put back my edits").count() == 0)
            with page.expect_download() as dl:
                page.locator("#docsBody .btn", has_text="Save as a file").click()
            ok("Save as a file hands him the document exactly", Path(dl.value.path()).read_text() == pe_text() and dl.value.suggested_filename == "Plot Essential.md", dl.value.suggested_filename)
            page.locator("#docsBody .btn", has_text="Duplicate").click()
            page.wait_for_timeout(900)
            copies = [d for d in world("p_new")["docs"] if d["name"] == "Plot Essential (copy).md"]
            ok("Duplicate makes a copy beside it", len(copies) == 1 and copies[0]["text"] == pe_text() and copies[0]["kind"] == "pe")
            page.click("#docsSheet [data-close]")
            page.wait_for_timeout(300)
            wd = world("p_new")
            wd["docs"] = [d for d in wd["docs"] if d["id"] != "dwb" and d["name"] != "Plot Essential (copy).md"]
            api("/api/project/p_new", "PUT", wd)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)

            # ---------------------------------------- the server dies mid-edit; nothing is lost
            h = api("/api/house")
            h["agentConnections"]["keeper"] = "c1"
            api("/api/house", "PUT", h)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(700)
            page.click("#docsBtn")
            page.wait_for_timeout(300)
            page.locator("#docsBody .row .grow", has_text="Plot Essential.md").click()
            page.wait_for_timeout(300)
            srv[0].terminate()
            srv[0].wait(timeout=5)
            area = page.locator("#docsBody textarea")
            area.fill(area.input_value() + "\n- Written while the server was down.")
            page.wait_for_timeout(2600)
            ok("the house says plainly that it is not saved", page.locator("#saveNote").is_visible())
            on_top = page.evaluate("""() => { const n = document.getElementById('saveNote'); const r = n.getBoundingClientRect();
              return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === n; }""")
            ok("and it is on top of the document he is typing in, not behind it", on_top)
            srv[0] = start_server()
            page.wait_for_function("() => document.getElementById('saveNote').hidden", timeout=60000)
            ok("when the server is back, the note goes by itself", page.locator("#saveNote").is_hidden())
            pe = [d for d in world("p_new")["docs"] if d["name"] == "Plot Essential.md"][0]["text"]
            ok("the words written during the outage reached the device", "Written while the server was down." in pe, pe[-160:])
            # the browser's own log of refused connections during the outage is not the app throwing
            errors[:] = [e for e in errors if not re.search(r"ERR_CONNECTION_REFUSED|Failed to load resource|Failed to fetch", e)]

            ok("nothing threw the whole way through", not errors, "; ".join(errors[:4]))
            browser.close()
    finally:
        srv[0].terminate()
        try:
            srv[0].wait(timeout=5)
        except Exception:
            srv[0].kill()
        model.shutdown()
        shutil.rmtree(home, ignore_errors=True)

    print(f"\n{passed} passed, {len(failed)} failed")
    for f in failed:
        print("  ✗ " + f)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
