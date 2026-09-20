#!/usr/bin/env python3
"""CozyMaker — the little server that lives on the device.

Everything the maker knows is a file under ~/.cozymaker. The browser holds
nothing but the room that is open; close every tab, open a different browser,
and the work is still exactly where it was, because the device is the only
place it ever lived. There is no syncing between browsers — that lesson was
paid for once already.

Three jobs:
  1. hand out the app's own files
  2. keep the house and the projects (atomic writes, rolling backups)
  3. carry a call out to whichever provider a connection points at, so keys
     never leave the device and no provider's CORS rules can break a room

It also watches its own file: save serve.py and the running server relights
itself, so a change can never be invisible.
"""

import http.server
import socketserver
import json
import os
import sys
import re
import io
import time
import gzip
import shutil
import threading
import urllib.request
import urllib.error
from pathlib import Path

VERSION = "1.0.0"
ROOT = Path(__file__).resolve().parent
HOME = Path(os.environ.get("COZYMAKER_HOME", Path.home() / ".cozymaker"))
PROJECTS = HOME / "projects"
BACKUPS = HOME / "backups"
EXPORTS = HOME / "exports"
HOUSE = HOME / "_house.json"
PORT = int(os.environ.get("COZYMAKER_PORT", "8090"))
KEEP_BACKUPS = 8

for d in (HOME, PROJECTS, BACKUPS, EXPORTS):
    d.mkdir(parents=True, exist_ok=True)

_write_lock = threading.Lock()

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def safe_id(s):
    return bool(s) and bool(SAFE_ID.match(s))


def atomic_write(path: Path, text: str):
    """Write through a temp file so a half-written project can never exist."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def roll_backup(path: Path):
    """Keep the last few versions of anything before it is overwritten."""
    if not path.exists():
        return
    try:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        dest = BACKUPS / f"{path.stem}.{stamp}{path.suffix}.gz"
        with open(path, "rb") as src, gzip.open(dest, "wb") as out:
            shutil.copyfileobj(src, out)
        mine = sorted(BACKUPS.glob(f"{path.stem}.*{path.suffix}.gz"))
        for old in mine[:-KEEP_BACKUPS]:
            old.unlink(missing_ok=True)
    except Exception as e:  # a backup must never stop a save
        print("backup skipped:", e, file=sys.stderr)


def read_json(path: Path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return fallback
    except Exception as e:
        print("could not read", path, e, file=sys.stderr)
        return fallback


def default_house():
    return {
        "connections": [],
        "agentConnections": {},
        "settings": {
            "theme": "hearth",
            "makerName": "",
            "yourName": "",
            "person": "second",
            "autoApply": True,
            "turnsOnScreen": 40,
        },
        "personaFrame": "",
        "projects": [],
    }


def project_path(pid):
    return PROJECTS / f"{pid}.json"


def project_list():
    out = []
    for p in sorted(PROJECTS.glob("*.json")):
        try:
            d = read_json(p, None)
            if not d:
                continue
            out.append({
                "id": d.get("id", p.stem),
                "title": d.get("title", p.stem),
                "updated": d.get("updated", 0),
                "docs": [{"id": x.get("id"), "name": x.get("name"),
                          "kind": x.get("kind"), "chars": len(x.get("text", ""))}
                         for x in d.get("docs", [])],
                "turns": len(d.get("turns", [])),
            })
        except Exception:
            continue
    out.sort(key=lambda r: r.get("updated", 0), reverse=True)
    return out


def mirror_exports(proj):
    """A plain-markdown copy of every document, so the work is reachable from
    the shell without going through the app. One way only: the JSON is the
    truth, this is a convenience."""
    try:
        pid = proj.get("id")
        if not safe_id(pid):
            return
        d = EXPORTS / pid
        d.mkdir(parents=True, exist_ok=True)
        keep = set()
        for doc in proj.get("docs", []):
            name = re.sub(r"[^A-Za-z0-9 ._-]", "_", doc.get("name", "untitled"))
            if not name.lower().endswith(".md"):
                name += ".md"
            keep.add(name)
            atomic_write(d / name, doc.get("text", ""))
        for f in d.glob("*.md"):
            if f.name not in keep:
                f.unlink(missing_ok=True)
    except Exception as e:
        print("export mirror skipped:", e, file=sys.stderr)


MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
    ".ico": "image/x-icon",
}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CozyMaker/" + VERSION

    def log_message(self, fmt, *args):
        pass

    # ---------- small helpers ----------

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, code=200, ctype="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    # ---------- GET ----------

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/version":
            return self.send_json({"version": VERSION, "home": str(HOME)})
        if path == "/api/house":
            house = read_json(HOUSE, None)
            if house is None:
                house = default_house()
                atomic_write(HOUSE, json.dumps(house, indent=1))
            return self.send_json(house)
        if path == "/api/projects":
            return self.send_json({"projects": project_list()})
        if path.startswith("/api/project/"):
            pid = path[len("/api/project/"):]
            if not safe_id(pid):
                return self.send_json({"error": "bad id"}, 400)
            d = read_json(project_path(pid), None)
            if d is None:
                return self.send_json({"error": "not found"}, 404)
            return self.send_json(d)
        return self.serve_static(path)

    def serve_static(self, path):
        if path == "/" or path == "":
            path = "/index.html"
        rel = path.lstrip("/")
        target = (ROOT / rel).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            return self.send_text("no", 403)
        if not target.is_file():
            return self.send_text("not found", 404)
        ctype = MIME.get(target.suffix, "application/octet-stream")
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        # the app's own files must never be served from a stale cache: a fix
        # the writer cannot see is the same as a fix that was never made
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(data)

    # ---------- PUT / POST / DELETE ----------

    def do_PUT(self):
        path = self.path.split("?", 1)[0]
        body = self.read_body()
        if path == "/api/house":
            with _write_lock:
                roll_backup(HOUSE)
                atomic_write(HOUSE, json.dumps(body, indent=1))
            return self.send_json({"ok": True})
        if path.startswith("/api/project/"):
            pid = path[len("/api/project/"):]
            if not safe_id(pid):
                return self.send_json({"error": "bad id"}, 400)
            body["id"] = pid
            body["updated"] = int(time.time() * 1000)
            with _write_lock:
                p = project_path(pid)
                roll_backup(p)
                atomic_write(p, json.dumps(body, indent=1))
                mirror_exports(body)
            return self.send_json({"ok": True, "updated": body["updated"]})
        return self.send_json({"error": "unknown"}, 404)

    def do_DELETE(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/project/"):
            pid = path[len("/api/project/"):]
            if not safe_id(pid):
                return self.send_json({"error": "bad id"}, 400)
            with _write_lock:
                p = project_path(pid)
                roll_backup(p)
                p.unlink(missing_ok=True)
                shutil.rmtree(EXPORTS / pid, ignore_errors=True)
            return self.send_json({"ok": True})
        return self.send_json({"error": "unknown"}, 404)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/call":
            return self.proxy_call()
        return self.send_json({"error": "unknown"}, 404)

    # ---------- the one way out to a provider ----------

    def proxy_call(self):
        spec = self.read_body()
        url = spec.get("url") or ""
        if not (url.startswith("https://") or url.startswith("http://")):
            return self.send_json({"error": "that address does not look right"}, 400)
        headers = spec.get("headers") or {}
        payload = json.dumps(spec.get("body") or {}).encode("utf-8")
        stream = bool(spec.get("stream"))
        req = urllib.request.Request(url, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        for k, v in headers.items():
            if isinstance(k, str) and isinstance(v, str):
                req.add_header(k, v)
        try:
            resp = urllib.request.urlopen(req, timeout=spec.get("timeout", 600))
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:4000]
            except Exception:
                pass
            return self.send_json({"error": "provider", "status": e.code,
                                   "detail": detail,
                                   "retryAfter": e.headers.get("Retry-After")}, 200)
        except Exception as e:
            return self.send_json({"error": "transport", "detail": str(e)[:400]}, 200)

        if not stream:
            data = resp.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            while True:
                chunk = resp.read(2048)
                if not chunk:
                    break
                self.wfile.write(b"%X\r\n" % len(chunk))
                self.wfile.write(chunk)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def watch_self():
    """If this file changes, relight. A server still holding the port after an
    update is an update the writer cannot see."""
    mine = Path(__file__).resolve()
    stamp = mine.stat().st_mtime
    while True:
        time.sleep(2)
        try:
            if mine.stat().st_mtime != stamp:
                print("serve.py changed — relighting", file=sys.stderr)
                os.execv(sys.executable, [sys.executable, str(mine)])
        except Exception:
            pass


def main():
    threading.Thread(target=watch_self, daemon=True).start()
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"CozyMaker {VERSION} — http://127.0.0.1:{PORT}")
        print(f"everything lives in {HOME}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
