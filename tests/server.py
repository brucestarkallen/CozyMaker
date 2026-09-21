#!/usr/bin/env python3
"""CozyMaker — tests/server.py

Starts the REAL serve.py against a throwaway home, then uses it the way the
app does: save a world, read it back, change it, check the plain-markdown copy
on disk, and put a call through the proxy to a provider that is also real (a
tiny one started here). Nothing is mocked out of the path under test.

    python3 tests/server.py
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
import urllib.error
import http.server
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8791
FAKE_PROVIDER_PORT = 8792

passed = 0
failed = []


def ok(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(f"{name}{' — ' + detail if detail else ''}")


def call(path, method="GET", body=None, port=PORT, raw=False):
    url = f"http://127.0.0.1:{port}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=20) as r:
        payload = r.read()
        if raw:
            return r.status, payload
        return r.status, json.loads(payload.decode())


# ------------------------------------------------------- a real provider

class FakeProvider(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        sent = json.loads(self.rfile.read(n).decode())
        if self.path.endswith("/boom"):
            self.send_response(429)
            self.send_header("Retry-After", "1")
            self.send_header("Content-Length", "22")
            self.end_headers()
            self.wfile.write(b'{"error":"slow down"}\n')
            return
        if self.path.endswith("/slowstream"):
            # a provider that writes slowly, the way a thinking model does: small events, far apart
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for i in range(5):
                chunk = json.dumps({"choices": [{"delta": {"reasoning_content": f"thought {i} "}}]})
                self.wfile.write(f"data: {chunk}\n\n".encode())
                self.wfile.flush()
                time.sleep(0.3)
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            return
        if self.path.endswith("/stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for piece in ["he", "llo"]:
                chunk = json.dumps({"choices": [{"delta": {"content": piece}}]})
                self.wfile.write(f"data: {chunk}\n\n".encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            return
        out = {
            "choices": [{
                "message": {"content": "saw model " + str(sent.get("model"))
                                       + " auth " + self.headers.get("Authorization", "none")},
                "finish_reason": "stop",
            }]
        }
        body = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def wait_for(port, seconds=15):
    for _ in range(seconds * 10):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/version", timeout=1).read()
            return True
        except Exception:
            time.sleep(0.1)
    return False


def main():
    home = Path(tempfile.mkdtemp(prefix="cozymaker-test-"))
    env = dict(os.environ, COZYMAKER_HOME=str(home), COZYMAKER_PORT=str(PORT))
    server = subprocess.Popen([sys.executable, str(ROOT / "serve.py")], env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    provider = Threaded(("127.0.0.1", FAKE_PROVIDER_PORT), FakeProvider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()

    try:
        if not wait_for(PORT):
            print("the server never came up")
            print(server.stderr.read().decode()[:2000])
            return 1

        # --- it hands out its own files -------------------------------------
        code, body = call("/index.html", raw=True)
        ok("the page is served", code == 200 and b"CozyMaker" in body)
        code, body = call("/js/agents/run.js", raw=True)
        ok("the modules are served", code == 200 and b"runTurn" in body)
        code, body = call("/engine/generalist.md", raw=True)
        ok("the craft file is served", code == 200 and b"IDENTITY & MANDATES" in body)
        ok("the craft file is served whole", len(body) > 120000, str(len(body)))
        try:
            call("/../serve.py", raw=True)
            ok("it will not serve outside itself", False)
        except urllib.error.HTTPError as e:
            ok("it will not serve outside itself", e.code in (403, 404))

        # --- the house -------------------------------------------------------
        code, house = call("/api/house")
        ok("a fresh house is made", code == 200 and house["connections"] == [])
        house["connections"] = [{"id": "c1", "name": "test", "url": "x", "model": "m", "key": "k"}]
        house["settings"]["makerName"] = "Eni"
        call("/api/house", "PUT", house)
        _, again = call("/api/house")
        ok("the house is kept", again["settings"]["makerName"] == "Eni" and len(again["connections"]) == 1)

        # --- a world ---------------------------------------------------------
        world = {
            "id": "p_test1", "title": "The Ashwood Pact",
            "docs": [{"id": "d1", "name": "Plot Essential.md", "kind": "pe",
                      "text": "# PLOT ESSENTIAL — The Ashwood Pact\n\n## SCENE\nWHERE: the hall\n"}],
            "turns": [{"role": "writer", "text": "hello", "at": 1}],
        }
        code, r = call("/api/project/p_test1", "PUT", world)
        ok("a world saves", code == 200 and r["ok"])
        code, back = call("/api/project/p_test1")
        ok("a world reads back exactly", back["title"] == "The Ashwood Pact"
           and back["docs"][0]["text"] == world["docs"][0]["text"])
        ok("the save is stamped", isinstance(back.get("updated"), int) and back["updated"] > 0)

        code, listing = call("/api/projects")
        ok("the world shows in the list", any(p["id"] == "p_test1" for p in listing["projects"]))
        row = [p for p in listing["projects"] if p["id"] == "p_test1"][0]
        ok("the list says how big each document is", row["docs"][0]["chars"] == len(world["docs"][0]["text"]))

        mirror = home / "exports" / "p_test1" / "Plot Essential.md"
        ok("a plain copy lands on disk", mirror.exists() and mirror.read_text() == world["docs"][0]["text"])

        # change it; the copy must follow and the old one must be backed up
        world["docs"][0]["text"] += "\n## WORLD\n### Rules\n- one rule\n"
        world["docs"].append({"id": "d2", "name": "Worldbook.json", "kind": "worldbook", "text": "[]"})
        call("/api/project/p_test1", "PUT", world)
        ok("the plain copy follows a change", "one rule" in mirror.read_text())
        ok("a second document lands too", (home / "exports" / "p_test1" / "Worldbook.json.md").exists())
        ok("the previous version is kept", len(list((home / "backups").glob("p_test1*.gz"))) >= 1)

        # a removed document must disappear from the copy, not linger
        world["docs"] = world["docs"][:1]
        call("/api/project/p_test1", "PUT", world)
        ok("a removed document leaves the copy",
           not (home / "exports" / "p_test1" / "Worldbook.json.md").exists())

        try:
            call("/api/project/../../etc/passwd")
            ok("a bad world name is refused", False)
        except urllib.error.HTTPError as e:
            ok("a bad world name is refused", e.code == 400)

        code, r = call("/api/project/p_test1", "DELETE")
        ok("a world deletes", code == 200)
        try:
            call("/api/project/p_test1")
            ok("a deleted world is gone", False)
        except urllib.error.HTTPError as e:
            ok("a deleted world is gone", e.code == 404)
        ok("a deleted world is still in the backups",
           len(list((home / "backups").glob("p_test1*.gz"))) >= 1)

        # --- the way out to a provider ---------------------------------------
        code, r = call("/api/call", "POST", {
            "url": f"http://127.0.0.1:{FAKE_PROVIDER_PORT}/v1/chat/completions",
            "headers": {"Authorization": "Bearer secret"},
            "body": {"model": "deepseek-chat", "messages": []},
        })
        text = r["choices"][0]["message"]["content"]
        ok("a call goes out and comes back", "saw model deepseek-chat" in text, text)
        ok("the key travels with it", "Bearer secret" in text, text)

        code, r = call("/api/call", "POST", {
            "url": f"http://127.0.0.1:{FAKE_PROVIDER_PORT}/boom",
            "headers": {}, "body": {},
        })
        ok("an unhappy provider becomes words, not a crash", r.get("error") == "provider" and r.get("status") == 429, json.dumps(r))
        ok("the wait-a-moment header is passed on", r.get("retryAfter") == "1")

        code, r = call("/api/call", "POST", {"url": "file:///etc/passwd", "body": {}})
        ok("a nonsense address is refused", False)
    except urllib.error.HTTPError as e:
        ok("a nonsense address is refused", e.code == 400)
    finally:
        pass

    try:
        code, raw = call("/api/call", "POST", {
            "url": f"http://127.0.0.1:{FAKE_PROVIDER_PORT}/stream",
            "headers": {}, "body": {}, "stream": True,
        }, raw=True)
        body = raw.decode()
        ok("a streamed answer comes through in pieces", "he" in body and "llo" in body and "[DONE]" in body, body[:200])

        # a stream reaches the page as it is written -- never held until a buffer fills.
        # (The relay once read 2,048 bytes at a time and waited for all of them: a thinking
        # model's small events sat on the phone's own server until the reply was over.)
        import http.client
        hc = http.client.HTTPConnection("127.0.0.1", PORT, timeout=15)
        t0 = time.time()
        hc.request("POST", "/api/call", body=json.dumps({"url": f"http://127.0.0.1:{FAKE_PROVIDER_PORT}/slowstream",
                                                        "headers": {}, "body": {}, "stream": True}),
                   headers={"Content-Type": "application/json"})
        hr = hc.getresponse()
        arrivals = []
        while True:
            piece = hr.read1(4096)
            if not piece:
                break
            arrivals += [round(time.time() - t0, 2)] * piece.count(b"data: {")
        hc.close()
        ok("a slow stream reaches the page event by event, as it is written",
           len(arrivals) == 5 and arrivals[0] < 0.6 and arrivals[-1] - arrivals[0] > 0.9, str(arrivals))

        code, r = call("/api/call", "POST", {
            "url": "http://127.0.0.1:9/nothing-listening", "headers": {}, "body": {},
        })
        ok("a dead address becomes words, not a crash", r.get("error") == "transport", json.dumps(r)[:200])

        # --- a save that arrives cut short, or empty, is never written ----------
        import socket
        heal = {"id": "p_heal", "title": "Heal", "docs": [{"id": "d1", "name": "PE.md", "kind": "pe", "text": "version one"}], "chats": []}
        call("/api/project/p_heal", "PUT", heal)
        body = json.dumps({**heal, "docs": [{"id": "d1", "name": "PE.md", "kind": "pe", "text": "x" * 4000}]}).encode()
        sock = socket.create_connection(("127.0.0.1", PORT), timeout=10)
        sock.sendall(b"PUT /api/project/p_heal HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n"
                     + f"Content-Length: {len(body)}\r\n\r\n".encode() + body[:300])
        sock.shutdown(socket.SHUT_WR)       # the phone put the app away mid-save
        try:
            sock.recv(1000)
        except Exception:
            pass
        sock.close()
        time.sleep(0.3)
        code, back = call("/api/project/p_heal")
        ok("a save cut short mid-body is not written over the world", back.get("docs") and back["docs"][0]["text"] == "version one", str(back)[:120])
        for bad, label in ((b"{}", "an empty save"), (b"not json at all", "a save that is not JSON")):
            req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/project/p_heal", data=bad, method="PUT")
            try:
                urllib.request.urlopen(req, timeout=10)
                refused = False
            except urllib.error.HTTPError as e:
                refused = e.code == 400
            code, back = call("/api/project/p_heal")
            ok(f"{label} is refused and the world stays as it was", refused and back["docs"][0]["text"] == "version one")
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/house", data=b"{}", method="PUT")
        try:
            urllib.request.urlopen(req, timeout=10)
            refused = False
        except urllib.error.HTTPError as e:
            refused = e.code == 400
        code, h = call("/api/house")
        ok("an empty house save is refused and the house stays as it was", refused and "connections" in h and "settings" in h)

        # --- a file that cannot be read is put back from its newest backup ------
        call("/api/project/p_heal", "PUT", {**heal, "docs": [{"id": "d1", "name": "PE.md", "kind": "pe", "text": "version two"}]})
        (home / "projects" / "p_heal.json").write_text("{ this is not a world")
        code, back = call("/api/project/p_heal")
        ok("an unreadable world is put back from its newest backup, not taken for deleted", code == 200 and back["docs"][0]["text"] == "version one", str(back)[:120])
        ok("and it is on disk again", json.loads((home / "projects" / "p_heal.json").read_text())["docs"][0]["text"] == "version one")
        ok("the unreadable copy is kept beside it", (home / "projects" / "p_heal.json.unreadable").exists())
        code, listing = call("/api/projects")
        ok("the listing still has it", any(w["id"] == "p_heal" for w in listing["projects"]))
        code, h = call("/api/house")
        call("/api/house", "PUT", {**h, "personaFrame": "I am Eni, first save."})
        call("/api/house", "PUT", {**h, "personaFrame": "I am Eni, second save."})
        (home / "_house.json").write_text("{ broken")
        code, h2 = call("/api/house")
        ok("an unreadable house is put back from its backup, never replaced by an empty one", h2.get("personaFrame") == "I am Eni, first save.", str(h2)[:120])
        ok("and the house on disk is whole again", json.loads((home / "_house.json").read_text()).get("personaFrame") == "I am Eni, first save.")

        # --- backups are kept across time, not only the last few seconds -------
        sys.path.insert(0, str(ROOT))
        os.environ["COZYMAKER_HOME"] = str(home)
        import importlib
        srv = importlib.import_module("serve")
        now = time.mktime(time.strptime("20260921-120000", "%Y%m%d-%H%M%S"))
        stamps = [time.strftime("%Y%m%d-%H%M%S", time.localtime(now - s_)) for s_ in
                  list(range(0, 20)) + [3600 + 5, 3600 + 60, 7200 + 5, 26 * 3600, 3 * 86400, 3 * 86400 + 60, 10 * 86400, 40 * 86400]]
        names = [f"p_x.{st}.json.gz" for st in stamps]
        kept = srv.keep_which(names, "p_x", ".json", now=now)
        ago = lambda sec: f"p_x.{time.strftime('%Y%m%d-%H%M%S', time.localtime(now - sec))}.json.gz"
        ok("the newest eight are kept", all(ago(s_) in kept for s_ in range(0, 8)))
        ok("the rest of the last few seconds are let go", not any(ago(s_) in kept for s_ in range(8, 20)))
        ok("the newest of each earlier hour is kept for two days", ago(3600 + 5) in kept and ago(7200 + 5) in kept and ago(3600 + 60) not in kept)
        ok("the newest of each day is kept for a month", ago(3 * 86400) in kept and ago(10 * 86400) in kept and ago(3 * 86400 + 60) not in kept)
        ok("older than a month is let go", ago(40 * 86400) not in kept)

        # --- it relights when its own file changes ---------------------------
        _, v1 = call("/api/version")
        src = (ROOT / "serve.py")
        original = src.read_text()
        # change whatever version is there (this line once named "1.0.0" and stopped
        # changing anything when the version moved on) -- and never pass on an edit that did nothing
        changed = re.sub(r'VERSION = "([^"]+)"', r'VERSION = "\1-relit"', original, count=1)
        ok("the test really changes the server's file", changed != original)
        src.write_text(changed)
        relit = False
        for _ in range(80):
            time.sleep(0.25)
            try:
                _, v2 = call("/api/version")
                if v2["version"] != v1["version"]:
                    relit = True
                    break
            except Exception:
                continue
        src.write_text(original)
        ok("it relights when its own file changes", relit,
           "an update that leaves the old server holding the port is an update you cannot see")
        time.sleep(3)
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()
        provider.shutdown()
        shutil.rmtree(home, ignore_errors=True)

    print(f"\n{passed} passed, {len(failed)} failed")
    for f in failed:
        print("  ✗ " + f)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
