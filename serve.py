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
import subprocess
from pathlib import Path

VERSION = "1.3.4"
ROOT = Path(__file__).resolve().parent
HOME = Path(os.environ.get("COZYMAKER_HOME", Path.home() / ".cozymaker"))
PROJECTS = HOME / "projects"
BACKUPS = HOME / "backups"
EXPORTS = HOME / "exports"
HOUSE = HOME / "_house.json"
PORT = int(os.environ.get("COZYMAKER_PORT", "8090"))
KEEP_BACKUPS = 8          # the newest, whatever their age
KEEP_HOURLY_FOR = 48 * 3600
KEEP_DAILY_FOR = 31 * 24 * 3600


def _commit():
    """The exact code this server was started from. The launcher compares it
    with the folder after pulling: different means stale, whatever any version
    string says. A number somebody has to remember to bump is a check that
    silently stops working the first time they forget."""
    try:
        out = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


COMMIT = _commit()

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
        keep = keep_which([m.name for m in mine], path.stem, path.suffix)
        for old in mine:
            if old.name not in keep:
                old.unlink(missing_ok=True)
    except Exception as e:  # a backup must never stop a save
        print("backup skipped:", e, file=sys.stderr)


def keep_which(names, stem, suffix, now=None):
    """Which backups stay. The newest eight; then the newest of each hour for
    two days; then the newest of each day for a month. Saves land about once a
    second while he types, so eight on their own covered the last few seconds
    of typing, and a bad save found an hour later had no good copy behind it."""
    now = time.time() if now is None else now
    dated = []
    for n in names:
        stamp = n[len(stem) + 1:len(stem) + 16]
        try:
            dated.append((time.mktime(time.strptime(stamp, "%Y%m%d-%H%M%S")), stamp, n))
        except ValueError:
            dated.append((now, "", n))           # a name it cannot read is never thrown away
    dated.sort(reverse=True)
    keep, hours, days = set(), set(), set()
    for i, (t, stamp, n) in enumerate(dated):
        age = now - t
        if i < KEEP_BACKUPS or not stamp:
            keep.add(n)
        elif age <= KEEP_HOURLY_FOR and stamp[:11] not in hours:
            keep.add(n)
        elif age <= KEEP_DAILY_FOR and stamp[:8] not in days:
            keep.add(n)
        if stamp:
            hours.add(stamp[:11])
            days.add(stamp[:8])
    return keep


def newest_backup(path: Path):
    """The newest backup of a file that can still be read, or None."""
    for b in sorted(BACKUPS.glob(f"{path.stem}.*{path.suffix}.gz"), reverse=True):
        try:
            with gzip.open(b, "rt", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            continue
    return None


def read_healing(path: Path):
    """What is on disk. If the file is there but cannot be read, the newest
    backup that can be is put back in its place, so the listing and the next
    reader see the world instead of losing it; the unreadable copy is kept
    beside it. Only a file that is not there at all reads as nothing."""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except Exception as e:
        good = newest_backup(path)
        print("could not read", path, e, "- " + ("put back from its newest backup" if good is not None else "no backup to put back"), file=sys.stderr)
        if good is None:
            return None
        with _write_lock:
            try:
                shutil.copyfile(path, path.with_name(path.name + ".unreadable"))
            except Exception:
                pass
            atomic_write(path, json.dumps(good, indent=1))
        return good


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
            "person": "follow",
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
            d = read_healing(p)
            if not d:
                continue
            out.append({
                "id": d.get("id", p.stem),
                "title": d.get("title", p.stem),
                "updated": d.get("updated", 0),
                "docs": [{"id": x.get("id"), "name": x.get("name"),
                          "kind": x.get("kind"), "chars": len(x.get("text", ""))}
                         for x in d.get("docs", [])],
                "chats": [{"id": c.get("id"), "title": c.get("title"),
                           "turns": len(c.get("turns", [])), "updated": c.get("updated", 0)}
                          for c in d.get("chats", [])]
                         or ([{"id": "", "title": "First conversation",
                               "turns": len(d.get("turns", [])), "updated": d.get("updated", 0)}]
                             if d.get("turns") else []),
                "turns": sum(len(c.get("turns", [])) for c in d.get("chats", [])) + len(d.get("turns", [])),
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
        """The whole body, or None. A body cut short — a phone putting the
        app away mid-save — or one that is not JSON used to read as {}, and
        {} was then written over the world or the house: erased."""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if n <= 0:
            return None
        raw = self.rfile.read(n)
        if len(raw) != n:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    # ---------- GET ----------

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/version":
            return self.send_json({"version": VERSION, "commit": COMMIT,
                                   "home": str(HOME), "root": str(ROOT)})
        if path == "/api/house":
            house = read_healing(HOUSE)
            if house is None:
                house = default_house()
                if not HOUSE.exists():          # never write defaults over a house it could not read
                    atomic_write(HOUSE, json.dumps(house, indent=1))
            return self.send_json(house)
        if path == "/api/projects":
            return self.send_json({"projects": project_list()})
        if path.startswith("/api/project/"):
            pid = path[len("/api/project/"):]
            if not safe_id(pid):
                return self.send_json({"error": "bad id"}, 400)
            d = read_healing(project_path(pid))
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
        incomplete = {"error": "that save arrived incomplete, so nothing was written"}
        if path == "/api/house":
            if not (isinstance(body, dict) and ("settings" in body or "connections" in body)):
                return self.send_json(incomplete, 400)
            with _write_lock:
                roll_backup(HOUSE)
                atomic_write(HOUSE, json.dumps(body, indent=1))
            return self.send_json({"ok": True})
        if path.startswith("/api/project/"):
            pid = path[len("/api/project/"):]
            if not safe_id(pid):
                return self.send_json({"error": "bad id"}, 400)
            if not (isinstance(body, dict) and isinstance(body.get("docs"), list)):
                return self.send_json(incomplete, 400)
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
        if path == "/api/quit":
            # How the launcher stops an old server: by asking whatever is on
            # THIS port to leave. Never by process name — Cozy Tavern also runs
            # a file called serve.py, and killing by name takes it down too.
            self.send_json({"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        return self.send_json({"error": "unknown"}, 404)

    # ---------- the one way out to a provider ----------

    def proxy_call(self):
        spec = self.read_body() or {}
        url = spec.get("url") or ""
        if not (url.startswith("https://") or url.startswith("http://")):
            return self.send_json({"error": "that address does not look right"}, 400)
        headers = spec.get("headers") or {}
        stream = bool(spec.get("stream"))
        if str(spec.get("method") or "POST").upper() == "GET":
            # a provider's list of its models (Cozy Tavern M348): a GET, with no body
            req = urllib.request.Request(url, method="GET")
        else:
            payload = json.dumps(spec.get("body") or {}).encode("utf-8")
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

        def put(chunk):
            self.wfile.write(b"%X\r\n" % len(chunk))
            self.wfile.write(chunk)
            self.wfile.write(b"\r\n")
            self.wfile.flush()

        try:
            while True:
                # THE PROVIDER'S SIDE BREAKING IS NOT THE PAGE'S. A line that drops
                # partway, a read that times out, a broken handshake: once, any of
                # them escaped this handler and left the page's stream without its
                # end, a bare network error in the middle of reading. It is said on
                # the stream now, as an error the page reads, marked as passing so a
                # worker asks again; the stream then ends properly.
                try:
                    chunk = resp.read1(2048)
                except Exception as e:
                    said = {"error": {"message": "the provider's line dropped partway through the answer (" + str(e)[:200] + ")", "code": 503}}
                    put(("\n\ndata: " + json.dumps(said) + "\n\n").encode())
                    break
                if not chunk:
                    break
                put(chunk)
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page went away — Stop, or it was closed


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
    try:
        httpd = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"port {PORT} is held by another program.")
        print("stop it, or run: COZYMAKER_PORT=8091 cozymaker")
        sys.exit(1)
    with httpd:
        print(f"CozyMaker {VERSION} — http://127.0.0.1:{PORT}")
        print(f"everything lives in {HOME}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
