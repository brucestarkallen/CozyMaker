#!/usr/bin/env python3
"""CozyMaker — tests/walk_house.py

THE HOUSE, TWO WINDOWS, AND A PAGE THAT KEEPS UP (v2.5). Real Chromium at a phone's
size, the real server, a stand-in model told what to say next. Every check is on what
is on screen, what reached the model, or what reached the device.

  — the house folds, cold: what he opens is remembered; a send with no connection
    opens Connections and gives his words back to the box
  — a reply that changed things and said nothing is a reply, not a failure
  — a reply with no words says the provider's reason
  — the document open in the sheet follows a turn that changes it
  — two windows: the one that comes back takes the newer copy; two that clash keep
    both; a world deleted in one is left by the other
  — a newer version on the device is taken by itself, never over a draft
  — the context line follows a reply that lands while he reads further up
  — earlier copies, listed and brought back

    python3 tests/walk_house.py
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
PORT = 8817
MODEL_PORT = 8818

passed = 0
failed = []
calls = []
NEXT = {"front": None}


def ok(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(f"{name}{' — ' + str(detail)[:300] if detail != '' else ''}")


PE = """# PLOT ESSENTIAL — The Lantern Coast — V1.0
# STATE: Tuesday 15 April 247 AGC, 09:24 / The Quay
# CALENDAR: Fantasy 12-month (AGC)

## WORLD
### Rules
- Epistemic Law: NPCs know ONLY what they personally witnessed.
- Majority is sixteen.

## MC — Jovan (17)
ID: Tall, dark-haired.
CORE: Reads a room before he speaks.

## TIMELINE
e001 [Mon 14 Apr 247, 09:00] [setup]: The lanterns were lit along the quay.

## SCENE
WHERE: The Quay / PRESENT: Jovan / ACTIVITY: waiting
"""


def edits(lst):
    return "<edits>\n" + json.dumps(lst) + "\n</edits>"


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        sent = json.loads(self.rfile.read(n).decode())
        msgs = sent.get("messages", [])
        system = next((m["content"] for m in msgs if m.get("role") == "system"), "")
        front = "How this room works" in system
        plan = (NEXT["front"] or {"text": "Noted."}) if front else {"text": "<verdict>CLEAN</verdict> It holds."}
        calls.append({"front": front, "body": sent})
        text, thinking = plan.get("text", ""), plan.get("thinking", "")
        finish = plan.get("finish", "stop")
        slow = plan.get("slow", 0)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        try:
            pieces = [{"choices": [{"delta": {"reasoning_content": thinking[i:i + 20]}}]} for i in range(0, len(thinking), 20)]
            pieces += [{"choices": [{"delta": {"content": text[i:i + 24]}}]} for i in range(0, len(text), 24)]
            pieces.append({"choices": [{"delta": {}, "finish_reason": finish}]})
            for p in pieces:
                self.wfile.write(("data: " + json.dumps(p) + "\n\n").encode())
                self.wfile.flush()
                if slow:
                    time.sleep(slow)
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        return json.loads(urllib.request.urlopen(req, timeout=20).read() or b"null")
    except urllib.error.HTTPError:
        return None


def until(check, timeout=8.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if check():
                return True
        except Exception:
            pass
        time.sleep(0.15)
    try:
        return bool(check())
    except Exception:
        return False


def main():
    from playwright.sync_api import sync_playwright

    home = Path(tempfile.mkdtemp(prefix="cozymaker-house-"))
    env = dict(os.environ, COZYMAKER_HOME=str(home), COZYMAKER_PORT=str(PORT))
    server = subprocess.Popen([sys.executable, str(ROOT / "serve.py")], env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    model = Threaded(("127.0.0.1", MODEL_PORT), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    try:
        if not until(lambda: api("/api/version") is not None, 20):
            ok("the server came up", False)
            return 1
        house = api("/api/house")
        house["settings"].update({"makerName": "Eni", "yourName": "Bruce", "person": "second"})
        house["personaFrame"] = "You are Eni."
        house["connections"] = []
        api("/api/house", "PUT", house)
        api("/api/project/w_lantern", "PUT", {"id": "w_lantern", "title": "The Lantern Coast",
                                              "docs": [{"id": "d1", "name": "Plot Essential.md", "kind": "pe", "text": PE}], "chats": []})

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            # cold: nothing in this browser yet, so the house folds as it does the first time
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            ctx.set_default_timeout(8000)
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            # a refused save (409), a world gone (404, 410) are the protocol working, not errors
            expected = re.compile(r"Failed to load resource: the server responded with a status of (404|409|410)")
            page.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" and not expected.search(m.text) else None)
            page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
            page.wait_for_timeout(700)
            state = {}

            def section(name, fn):
                """A part of the walk that breaks is a failure reported, never a crash that hides the rest."""
                try:
                    fn()
                except Exception as e:
                    ok(f"{name}: walked to its end", False, f"{type(e).__name__}: {str(e).splitlines()[0][:200]}")

            def open_pe(p):
                p.click("#docsBtn")
                p.wait_for_timeout(300)
                p.locator("#docsBody .row", has_text="Plot Essential.md").first.click()
                p.wait_for_timeout(300)

            def opened(key, p=None):
                return (p or page).evaluate(f"""() => {{ const g = document.querySelector('#houseBody [data-section="{key}"]');
                  const b = g && g.querySelector('.section-head'); return b ? b.getAttribute('aria-expanded') : null; }}""")

            def idle(p=None):
                (p or page).wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=30000)

            def send(text, p=None, turn=True):
                """Sent, and — for a turn — under way: the model has been asked, so a wait for the
                turn to end can never return before it began."""
                q = p or page
                n = len(calls)
                q.fill("#say", text)
                q.click("#sendBtn")
                if turn and not until(lambda: len(calls) > n, 10):
                    raise RuntimeError(f"the turn for {text!r} never reached the model")

            def lantern():
                return (api("/api/project/w_lantern") or {"docs": [{"text": ""}], "chats": [{"turns": [{}]}]})

            # ------------------------------------------------ the house folds; his words come back
            def folds():
                send("hello there, the harbour first", turn=False)
                page.wait_for_timeout(500)
                ok("a send with no connection opens the house", page.locator("#houseSheet.open").count() == 1)
                ok("at Connections, open, where he has to begin", opened("connections") == "true", opened("connections"))
                ok("the first time, the first section is open and the rest fold to their names",
                   opened("who") == "true" and opened("crew") == "false" and opened("look") == "false" and opened("floor") == "false",
                   [opened(k) for k in ("who", "crew", "look", "floor")])
                ok("what he typed is back in the box, never lost", page.input_value("#say") == "hello there, the harbour first", page.input_value("#say"))
                page.click('#houseBody [data-section="look"] .section-head')
                ok("a section opens on a tap", opened("look") == "true")
            section("the house folds", folds)

            house = api("/api/house")
            house["connections"] = [{"id": "c1", "name": "stand-in", "url": f"http://127.0.0.1:{MODEL_PORT}/v1", "model": "m", "key": "k"}]
            house["agentConnections"] = {"keeper": "c1"}
            api("/api/house", "PUT", house)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)

            def remembered():
                page.click("#settingsBtn")
                page.wait_for_timeout(300)
                ok("what he opened is remembered; what was opened for him that once is not",
                   opened("look") == "true" and opened("connections") == "false" and opened("who") == "true", [opened(k) for k in ("look", "connections", "who")])
                page.click('[data-close="houseSheet"]')
            section("the folds remembered", remembered)
            page.fill("#say", "")

            # ------------------------------------------------ a reply that only changed things
            def changes_only():
                NEXT["front"] = {"text": edits([{"file": "Plot Essential.md", "find": "- Majority is sixteen.", "replace": "- Majority is fifteen.", "reason": "younger"}])}
                send("make the age of majority fifteen")
                idle()
                page.wait_for_timeout(400)
                last = page.locator(".turn.maker .bubble").last
                cls = last.get_attribute("class") or ""
                ok("a reply that changed things and wrote no words is a reply, not a failure",
                   "note" in cls and "failed" not in cls and "The changes it made went in" in last.inner_text(), (cls, last.inner_text()))
                ok("and the change is on the device", until(lambda: "- Majority is fifteen." in lantern()["docs"][0]["text"]))
                saved = lantern()["chats"][0]["turns"][-1]
                ok("kept with no words of its own, so nothing of the house's line is ever read back as its", saved.get("text") == "" and not saved.get("failed") and "went in" in (saved.get("note") or ""), saved)
            section("a reply that only changed things", changes_only)

            # ------------------------------------------------ a reply with no words says why
            def no_words():
                NEXT["front"] = {"text": "", "thinking": "a long think about the harbour " * 8, "finish": "length"}
                send("think about the harbour")
                idle()
                page.wait_for_timeout(400)
                last = page.locator(".turn.maker .bubble").last
                words = last.inner_text()
                ok("a reply with no words says the provider's reason: it ran out of room thinking, and what gives it room",
                   "ran out of room" in words and "Longest reply" in words and "failed" in (last.get_attribute("class") or ""), words)
            section("a reply with no words", no_words)

            # ------------------------------------------------ the open document follows a turn
            def follows():
                NEXT["front"] = {"text": "Moved the scene.\n\n" + edits([{"file": "Plot Essential.md", "find": "WHERE: The Quay", "replace": "WHERE: The Lighthouse", "reason": "moved"}]), "slow": 0.35}
                send("move the scene to the lighthouse")
                page.wait_for_timeout(250)
                open_pe(page)
                area = page.locator("#docsBody textarea")
                ok("the document was opened while the turn worked", "WHERE: The Quay" in area.input_value() and page.locator("#sendBtn.stop").count() == 1,
                   (area.input_value()[-160:], page.locator("#sendBtn.stop").count()))
                idle()
                ok("the box follows the turn that changed it, with no reopening", until(lambda: "WHERE: The Lighthouse" in area.input_value(), 6), area.input_value()[-200:])
                area.click()
                page.keyboard.press("Control+End")
                page.keyboard.type(" Gulls.")
                page.click('[data-close="docsSheet"]')
                ok("a key pressed after keeps the turn's change and adds his own",
                   until(lambda: "WHERE: The Lighthouse" in lantern()["docs"][0]["text"] and "Gulls." in lantern()["docs"][0]["text"]),
                   lantern()["docs"][0]["text"][-120:])
            section("the open document follows", follows)

            # ------------------------------------------------ two windows
            def two_windows():
                page2 = ctx.new_page()
                state["page2"] = page2
                page2.on("pageerror", lambda e: errors.append("page2: " + str(e)))
                page2.on("console", lambda m: errors.append("page2 console:" + m.text) if m.type == "error" and not expected.search(m.text) else None)
                page2.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
                page2.wait_for_timeout(600)
                ok("a second window opens the same world", page2.locator("#worldName").inner_text() == "The Lantern Coast")
                NEXT["front"] = {"text": "The lighthouse keeper has a daughter."}
                send("who keeps the lighthouse?")
                idle()
                page.wait_for_timeout(300)
                ok("the second window has not seen it yet", "has a daughter" not in page2.locator("#stream").inner_text())
                page2.wait_for_timeout(1600)
                page2.evaluate("() => window.dispatchEvent(new Event('focus'))")
                ok("coming back to it, it takes the newer copy on its own",
                   until(lambda: "has a daughter" in page2.locator("#stream").inner_text(), 6), page2.locator("#stream").inner_text()[-200:])

                def edit_doc(p, add):
                    open_pe(p)
                    p.locator("#docsBody textarea").click()
                    p.keyboard.press("Control+End")
                    p.keyboard.type(add)
                    p.click('[data-close="docsSheet"]')

                page.wait_for_timeout(1700)
                edit_doc(page, " FROM-ONE.")
                until(lambda: "FROM-ONE." in lantern()["docs"][0]["text"])
                edit_doc(page2, " FROM-TWO.")
                ok("two windows changing the same document differently: the one that saved last stands",
                   until(lambda: "FROM-TWO." in lantern()["docs"][0]["text"]), lantern()["docs"][0]["text"][-80:])
                beside = [w for w in api("/api/projects")["projects"] if "(from another window, " in (w.get("title") or "")]
                ok("and the other window's whole copy is kept as a world of its own",
                   len(beside) == 1 and "FROM-ONE." in api("/api/project/" + beside[0]["id"])["docs"][0]["text"], beside)
                ok("the window is told, by name", until(lambda: "Another window changed the same thing" in page2.locator("#toast").inner_text(), 4), page2.locator("#toast").inner_text())

                api("/api/project/w_lantern", "DELETE")
                page.wait_for_timeout(1700)
                page2.evaluate("() => window.dispatchEvent(new Event('focus'))")
                ok("a world deleted in another window: this one says so, and moves to one that is there",
                   until(lambda: "was deleted in another window" in page2.locator("#toast").inner_text(), 6) and until(lambda: page2.locator("#worldName").inner_text() != "The Lantern Coast", 6),
                   (page2.locator("#toast").inner_text(), page2.locator("#worldName").inner_text()))
                ok("and never brings it back", api("/api/project/w_lantern") is None)
            section("two windows", two_windows)
            if state.get("page2"):
                state["page2"].close()

            # ------------------------------------------------ a newer version, taken by itself
            def newer_version():
                page.reload(wait_until="networkidle")
                page.wait_for_timeout(600)
                page.evaluate("() => { window.__stayed = 1; }")
                page.route("**/api/version", lambda route: route.fulfill(status=200, content_type="application/json",
                                                                          body=json.dumps({"version": "9.9.9", "commit": "a-newer-commit"})))
                page.fill("#say", "half a thought")
                page.wait_for_timeout(1700)
                page.evaluate("() => window.dispatchEvent(new Event('focus'))")
                page.wait_for_timeout(1500)
                ok("a newer version is never taken over words half typed", page.evaluate("() => window.__stayed") == 1 and page.input_value("#say") == "half a thought")
                page.fill("#say", "")
                page.wait_for_timeout(1700)
                page.evaluate("() => window.dispatchEvent(new Event('focus'))")
                ok("with nothing in progress, the page takes it by itself", until(lambda: page.evaluate("() => window.__stayed") is None, 8))
            section("a newer version", newer_version)
            page.unroute("**/api/version")
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(600)

            # ------------------------------------------------ the context line, read further up
            def context_line():
                api("/api/project/w_long", "PUT", {"id": "w_long", "title": "The Long Talk", "docs": [{"id": "d1", "name": "Plot Essential.md", "kind": "pe", "text": PE}],
                                                   "chats": [{"id": "c1", "title": "Long", "turns": sum(([{"role": "writer", "text": f"question {i}", "at": i * 2 + 1},
                                                                                                         {"role": "maker", "text": ("A long answer line. " * 30), "at": i * 2 + 2}] for i in range(8)), [])}]})
                page.evaluate("() => localStorage.setItem('cozymaker:open', 'w_long')")
                page.reload(wait_until="networkidle")
                page.wait_for_timeout(800)

                def context_now():
                    m = re.search(r"Context ~([\d,]+) tokens", page.locator("#contextLine").inner_text())
                    return int(m.group(1).replace(",", "")) if m else 0
                ok("the long conversation is the one open", page.locator("#worldName").inner_text() == "The Long Talk", page.locator("#worldName").inner_text())
                before = context_now()
                NEXT["front"] = {"text": "A reply that adds a good deal to what is read. " * 60, "slow": 0.02}
                send("tell me the long version")
                page.wait_for_timeout(400)
                page.mouse.move(195, 300)
                page.mouse.wheel(0, -5000)
                page.wait_for_timeout(200)
                idle()
                page.wait_for_timeout(700)
                scrolled = page.evaluate("() => { const s = document.getElementById('stream'); return s.scrollHeight - s.scrollTop - s.clientHeight; }")
                after = context_now()
                ok("he was reading further up when it landed", scrolled > 400, scrolled)
                ok("the context line follows the reply that landed, scrolled up or not", after - before > 500, (before, after))
            section("the context line", context_line)

            # ------------------------------------------------ earlier copies, brought back
            def copies():
                page.click("#settingsBtn")
                page.wait_for_timeout(300)
                if opened("floor") != "true":
                    page.click('#houseBody [data-section="floor"] .section-head')
                page.click('#houseBody :text("Show the earlier copies")')
                ok("the earlier copies are listed, a deleted world's too", until(lambda: "The Lantern Coast (deleted)" in page.locator("#houseBody .copies").inner_text(), 6),
                   page.locator("#houseBody .copies").inner_text()[:300])
                page.click('#houseBody .copies .fold-head:has-text("The Lantern Coast (deleted)")')
                page.locator('#houseBody .copies .fold-body:visible button:has-text("Bring this copy back")').first.click()
                ok("one comes back as a world of its own, beside the rest, and is opened",
                   until(lambda: "(as it was " in page.locator("#worldName").inner_text(), 6) and page.locator("#houseSheet.open").count() == 0,
                   page.locator("#worldName").inner_text())
                back = [w for w in api("/api/projects")["projects"] if "(as it was " in (w.get("title") or "")]
                ok("on the device, with its documents", len(back) == 1 and api("/api/project/" + back[0]["id"])["docs"][0]["name"] == "Plot Essential.md", back)
            section("earlier copies", copies)

            # ------------------------------------------------ his message goes with what answered it
            def delete_his():
                api("/api/project/w_del", "PUT", {"id": "w_del", "title": "The Tower", "docs": [{"id": "d1", "name": "Plot Essential.md", "kind": "pe", "text": PE}], "chats": []})
                page.evaluate("() => localStorage.setItem('cozymaker:open', 'w_del')")
                page.reload(wait_until="networkidle")
                page.wait_for_timeout(700)
                NEXT["front"] = {"text": "Moved it to the tower.\n\n" + edits([{"file": "Plot Essential.md", "find": "WHERE: The Quay", "replace": "WHERE: The Tower", "reason": "moved"}])}
                send("move the scene to the tower")
                idle()
                page.wait_for_timeout(500)
                ok("the reply changed the document", "WHERE: The Tower" in api("/api/project/w_del")["docs"][0]["text"])
                asked = []
                page.once("dialog", lambda d: (asked.append(d.message), d.accept()))
                page.locator(".turn.writer .bubble").last.click()
                page.wait_for_timeout(250)
                page.locator(".turn.writer").last.locator(".turn-actions .btn", has_text="Delete").click()
                page.wait_for_timeout(1200)
                ok("deleting his message asks once, saying what goes with it",
                   asked == ["Delete this message of yours, and the reply that answered it? What it changed in the documents is put back."], asked)
                w = api("/api/project/w_del")
                ok("his message goes with the reply that answered it — none left answering nothing",
                   page.locator(".turn").count() == 0 and w["chats"][0]["turns"] == [], (page.locator(".turn").count(), [t["role"] for t in w["chats"][0]["turns"]]))
                ok("and what the reply changed is put back", "WHERE: The Quay" in w["docs"][0]["text"] and "The Tower" not in w["docs"][0]["text"], w["docs"][0]["text"][-80:])
            section("his message, deleted", delete_his)

            ok("nothing threw anywhere", not errors, "; ".join(errors[:4]))
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
