#!/usr/bin/env python3
"""CozyMaker — tests/stream_flows.py

The live stream's two harder roads, in a real browser against the real serve.py
(v1.6.0). The stand-in model reads who is asking and answers the way a thinking
model does.

  1. A reply that makes a change itself (v2.0). The one he talks to thinks, says
     what it is doing, and writes its block of changes in the same reply: the
     thinking streams from its first word, the words stream, the block never
     reaches the screen (the line says it is writing the changes while it
     streams), and the change lands with its card.

  2. The quiet before the reply. While the reply has not sent its first piece
     yet (a provider that thinks without sending its thinking), the ember stays
     on screen with no words, and goes the moment the first thought is there.

    python3 tests/stream_flows.py
"""

import json
import re
import os
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
PORT = 8813
FAKE = 8814

passed = 0
failed = []
fronts = []
ANSWERS = []


def ok(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(f"{name}{' — ' + str(detail)[:300] if detail else ''}")


class Fake(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        sent = json.loads(self.rfile.read(n).decode() or "{}")
        msgs = sent.get("messages", [])
        system = next((m.get("content", "") for m in msgs if m.get("role") == "system"), "")
        said = json.dumps([m for m in msgs if m.get("role") != "system"][-1:])
        # what he said THIS time: the ask ends with his words after "said:" (the talk before it
        # rides in the same message, so a match on the whole of it would answer an older line)
        now = said.split("said:")[-1]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()

        def send(delta, fin=None):
            self.wfile.write(("data: " + json.dumps({"choices": [{"index": 0, "delta": delta, "finish_reason": fin}]}) + "\n\n").encode())
            self.wfile.flush()

        def done():
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()

        try:
            # the one he talks to
            if "stop me while you think" in now:
                # a long think, for Stop to land in the middle of
                for i in range(80):
                    send({"reasoning_content": f"Turning it over {i}. "})
                    time.sleep(0.1)
                send({"content": "too late"}, "stop")
                return done()
            if "cut me off" in now:
                for piece in ["The wall first. ", "Then who paid."]:
                    send({"reasoning_content": piece})
                    time.sleep(0.25)
                send({"content": "The harbour wall was built by"}, "length")
                return done()
            if "cut off partway through" in said:
                for piece in ["Carrying on ", "from the cut."]:
                    send({"reasoning_content": piece})
                    time.sleep(0.25)
                send({"content": " the guild of tides."}, "stop")
                return done()
            if "answer twice" in now:
                ANSWERS.append(1)
                n = len(ANSWERS)
                for piece in [f"Version {n} ", "weighing it."]:
                    send({"reasoning_content": piece})
                    time.sleep(0.25)
                send({"content": f"Answer {n}."}, "stop")
                return done()
            fronts.append(time.time())
            # a provider that thinks without a word for a while first, then thinks out loud, then
            # answers and writes its change in the same reply, slowly enough for the block to be seen
            time.sleep(1.5)
            for piece in ["With the moon in, ", "the nights change. ", "Say so warmly."]:
                send({"reasoning_content": piece})
                time.sleep(0.3)
            block = ('\n\n<edits>[{"file": "Plot Essential.md", "insert_after": "- The tide decides who rules.", '
                     '"replace": "- The kingdom has a second moon.", "reason": "a second moon"}]</edits>')
            send({"content": "Two moons it is."})
            for i in range(0, len(block), 20):
                send({"content": block[i:i + 20]})
                time.sleep(0.12)
            send({"content": ""}, "stop")
            done()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


PE_SEED = """# PLOT ESSENTIAL — Tide — V1.0

## WORLD
### Rules
- The tide decides who rules.

## SCENE
WHERE: the salt flats
"""


def call(path, method="GET", body=None):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header("Content-Type", "application/json")
    return json.loads(urllib.request.urlopen(req).read() or b"{}")


def main():
    from playwright.sync_api import sync_playwright

    home = Path(tempfile.mkdtemp(prefix="cozymaker-flows-"))
    env = dict(os.environ, COZYMAKER_HOME=str(home), COZYMAKER_PORT=str(PORT))
    server = subprocess.Popen([sys.executable, str(ROOT / "serve.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    fake = Threaded(("127.0.0.1", FAKE), Fake)
    threading.Thread(target=fake.serve_forever, daemon=True).start()
    try:
        for _ in range(200):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/version", timeout=1).read()
                break
            except Exception:
                time.sleep(0.1)
        house = call("/api/house")
        house["connections"] = [{"id": "c1", "name": "thinks", "url": f"http://127.0.0.1:{FAKE}/v1", "model": "thinker", "key": "k"}]
        house["agentConnections"] = {"keeper": "c1"}
        house["settings"].update({"makerName": "Eni", "yourName": "Bruce", "person": "second"})
        house["personaFrame"] = "You are Eni."
        call("/api/house", "PUT", house)
        call("/api/project/p_flow", "PUT", {"id": "p_flow", "title": "Tide", "docs": [{"id": "d1", "name": "Plot Essential.md", "kind": "pe", "text": PE_SEED}],
                                             "turns": [], "undo": [], "recentSections": []})

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block").new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
            page.wait_for_timeout(600)
            # what the room shows, every 50ms, from the press to the landing
            page.evaluate("""() => {
              const W = window.__watch = [];
              setInterval(() => {
                const turns = [...document.querySelectorAll('#stream .turn.maker')];
                const live = turns[turns.length - 1];
                const st = document.querySelector('#stream .status');
                const tt = live && live.querySelector('.thinking-text');
                W.push({
                  t: Date.now(),
                  running: Boolean(document.querySelector('#sendBtn.stop')),
                  thinking: tt && tt.checkVisibility() ? tt.textContent : '',
                  anyEarly: document.getElementById('stream').textContent.includes('EARLY'),
                  status: st ? st.querySelector('.label').textContent : null,
                  ember: Boolean(st && st.querySelector('.ember')),
                  words: live ? (live.querySelector('.bubble') || {}).textContent || '' : '',
                });
              }, 50);
            }""")
            page.fill("#say", "give the kingdom a second moon")
            page.click("#sendBtn")
            page.wait_for_selector("#sendBtn.stop", timeout=10000)
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=60000)
            page.wait_for_timeout(500)
            w = page.evaluate("window.__watch")
            run = [x for x in w if x["running"]]

            # 1. a reply that makes a change itself, live
            writing = [x for x in run if (x["status"] or "").startswith("writing the changes")]
            ok("while its block of changes streams, the line says it is writing the changes", bool(writing), sorted({str(x["status"]) for x in run})[:12])
            ok("the block never reaches the screen", not any("<edits" in x["words"] or "second moon\"" in x["words"] or "insert_after" in x["words"] for x in w),
               [x["words"][:80] for x in w if "<" in x["words"]][:2])
            ok("its words do, as they come", any(x["words"].startswith("Two moons it is.") for x in run))

            # 2. the quiet before the reply
            first = next((i for i, x in enumerate(run) if x["thinking"]), None)
            ok("it thinks from its own first word, in an open box", first is not None and "With the moon in, the nights change. Say so warmly.".startswith(run[first]["thinking"]),
               run[first]["thinking"][:60] if first is not None else None)
            gap = run[2:first] if first is not None else []
            ok("between the press and the first thought, the ember stays", gap and all(x["ember"] for x in gap), [(x["status"], x["ember"]) for x in gap][:8])
            ok("with no words beside it", gap and all((x["status"] or "") == "" or x["status"].startswith("0:") for x in gap), sorted({str(x["status"]) for x in gap}))
            ok("and it goes the moment the first thought is there", first is not None and run[first]["status"] is None and not run[first]["ember"], run[first] if first is not None else None)
            ok("nothing on screen stood still: every moment of the turn had the ember, the thinking or the words", all(x["ember"] or x["thinking"] or x["words"] for x in run[2:]),
               [x for x in run[2:] if not (x["ember"] or x["thinking"] or x["words"])][:2])

            if os.environ.get("SHOW"):
                for x in run:
                    print(round((x["t"] - run[0]["t"]) / 1000, 2), repr(x["status"]), x["ember"], repr(x["thinking"][:24]), repr(x["words"][:20]), x["anyEarly"])
            world = call("/api/project/p_flow")
            chat = next(c for c in world["chats"] if c["id"] == world["openChat"])
            kept = chat["turns"][-1]
            ok("the turn keeps its words and nothing of the block", kept.get("text") == "Two moons it is.", kept.get("text"))
            ok("and its thinking", kept.get("thinking") == "With the moon in, the nights change. Say so warmly.", kept.get("thinking"))
            ok("its clock is its own: from its first thought to its first word", 500 <= (kept.get("thinkingMs") or 0) < 2500, kept.get("thinkingMs"))
            ok("the change landed", "- The kingdom has a second moon." in world["docs"][0]["text"])
            ok("with its card on screen", "Plot Essential.md" in page.locator(".turn.maker").last.locator(".cards").inner_text())

            def seen(js, name, timeout=20000):
                # a wait that never comes true is a failed law, said by name, never a crash
                try:
                    page.wait_for_function(js, timeout=timeout)
                    ok(name, True)
                    return True
                except Exception:
                    ok(name, False, "never came on screen")
                    return False

            def last_turn():
                w2 = call("/api/project/p_flow")
                return next(c for c in w2["chats"] if c["id"] == w2["openChat"])["turns"][-1]

            def finished():
                # the turn has begun (the Stop button is up) and then ended
                page.wait_for_selector("#sendBtn.stop", timeout=10000)
                page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=60000)
                page.wait_for_timeout(600)

            def stopped_turn_done():
                page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=60000)
                page.wait_for_timeout(600)

            # 3. Stop while it thinks: what it thought so far stays, said for what it is
            page.fill("#say", "stop me while you think")
            page.click("#sendBtn")
            seen("() => [...document.querySelectorAll('.turn.maker .thinking-text')].some((t) => t.checkVisibility() && t.textContent.includes('Turning it over 5.'))",
                 "a long think is on screen as it comes, with no tap")
            page.click("#sendBtn")
            stopped_turn_done()
            t = last_turn()
            ok("Stop while it thinks: the turn says it stopped", t.get("text") == "(stopped)" and t.get("failed") is True, t.get("text"))
            ok("and keeps what it thought so far, from its first word", (t.get("thinking") or "").startswith("Turning it over 0. ") and "Turning it over 5." in t.get("thinking", "")
               and "Turning it over 79." not in t.get("thinking", ""), (t.get("thinking") or "")[-60:])
            ok("with how long it thought", (t.get("thinkingMs") or 0) >= 500, t.get("thinkingMs"))
            last = page.locator(".turn.maker").last
            ok("on screen: a shut box that says how long, and Try again", re.match(r"^\u25b8 Thought for \d+s$", last.locator(".thinking-head").inner_text()) is not None
               and last.locator(".btn", has_text="Try again").count() == 1, last.locator(".thinking-head").inner_text())

            # 4. Go on: the rest of a cut reply thinks in its own open box, and both thinkings are kept
            page.fill("#say", "cut me off")
            page.click("#sendBtn")
            finished()
            t = last_turn()
            ok("a reply cut at the limit is kept as cut, with its thinking", t.get("cut") is True and t.get("thinking") == "The wall first. Then who paid.", (t.get("cut"), t.get("thinking")))
            first_ms = t.get("thinkingMs") or 0
            if os.environ.get("SHOW"):
                print("CUT TURN:", json.dumps({k: t.get(k) for k in ("text", "cut", "cutBy", "failed", "thinking", "thinkingMs")}))
                print("ON SCREEN:", page.locator(".turn.maker").last.inner_text()[:300])
                print("SO FAR:", passed, failed)
            go_on = page.locator(".turn.maker").last.locator(".btn", has_text="Go on")
            ok("a cut reply offers Go on", go_on.count() == 1)
            if go_on.count():
                go_on.click()
            seen("() => [...document.querySelectorAll('.turn.maker .thinking-text')].some((x) => x.checkVisibility() && x.textContent.startsWith('Carrying on'))",
                 "Go on: the rest thinks in an open box, from its own first word")
            stopped_turn_done()
            t = last_turn()
            ok("and the reply is joined whole", t.get("text") == "The harbour wall was built by the guild of tides." and not t.get("cut"), t.get("text"))
            ok("with both thinkings kept, in order", t.get("thinking") == "The wall first. Then who paid.\n\nCarrying on from the cut.", t.get("thinking"))
            ok("and the time it thought added up", (t.get("thinkingMs") or 0) > first_ms, (first_ms, t.get("thinkingMs")))

            # 5. Another answer: each answer keeps its own thinking, walked with ◂ ▸
            page.fill("#say", "answer twice")
            page.click("#sendBtn")
            finished()
            page.locator(".turn.maker").last.locator(".btn", has_text="Another answer").click()
            seen("() => [...document.querySelectorAll('.turn.maker .thinking-text')].some((x) => x.checkVisibility() && x.textContent.startsWith('Version 2'))",
                 "Another answer: the new one thinks in an open box, from its own first word")
            stopped_turn_done()
            t = last_turn()
            ok("the new answer is shown with its own thinking", t.get("text") == "Answer 2." and t.get("thinking") == "Version 2 weighing it.", (t.get("text"), t.get("thinking")))
            ok("and the first is kept as a version, with its own", len(t.get("versions") or []) == 2 and t["versions"][0].get("thinking") == "Version 1 weighing it."
               and t["versions"][0].get("thinkingMs"), [(v.get("text"), v.get("thinking")) for v in t.get("versions") or []])
            last = page.locator(".turn.maker").last
            last.locator(".swipes .iconbtn").first.click()
            page.wait_for_timeout(500)
            last = page.locator(".turn.maker").last
            last.locator(".thinking-head").click()
            ok("walking back shows the first answer's own thinking", last.locator(".bubble").inner_text() == "Answer 1." and last.locator(".thinking-text").inner_text() == "Version 1 weighing it.",
               (last.locator(".bubble").inner_text(), last.locator(".thinking-text").inner_text()))
            ok("nothing threw", not errors, errors[:2])
            browser.close()
    finally:
        server.terminate()
        fake.shutdown()
        shutil.rmtree(home, ignore_errors=True)

    print(f"\n{passed} passed, {len(failed)} failed")
    for f in failed:
        print("  ✗ " + f)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
