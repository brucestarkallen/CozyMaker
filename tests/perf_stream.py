#!/usr/bin/env python3
"""CozyMaker — tests/perf_stream.py

The live stream, measured in a real browser (Cozy Tavern's tests/perf_housekeeper.py,
M269/M279, carried over). A headless Chromium on a phone's viewport, its CPU slowed 6x,
against the real serve.py and a stand-in model that streams the way a thinking model
does: the reply thinks long and then writes, its pieces arriving in bursts the way a provider's
do over a network.

While it streams, every animation frame and every long task on the main thread is
recorded, and the room is watched for when the first thought and the first word are
really on screen. The clocks are the same machine's: the page's Date.now() and the
stand-in's time.time().

    python3 tests/perf_stream.py                 # prints the numbers, exits 1 when a law breaks
    THINK=3000 ANSWER=600 THROTTLE=6 python3 tests/perf_stream.py

The laws (each one fails on the code before 1.6.0):
  - nobody is waited on before the one he talks to (v2.0): the first thought is on screen
    within a second and a half of the press, and within a second of the model sending
    it — the stream starts at the thinking
  - the thinking box is open while it thinks, with no tap, and its first words are
    still there once it is long
  - it folds shut once the reply's words are on screen
  - no frame stalls the screen past the budget, and the long tasks stay under it
  - the words arrive on screen evenly: no frame shows more than a small slice at once
  - everything that streamed is kept: the whole thinking and the whole reply
"""

import json
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
PORT = int(os.environ.get("PORT", "8811"))
FAKE = int(os.environ.get("FAKE_PORT", "8812"))
THINK = int(os.environ.get("THINK", "3000"))        # thinking pieces, ~34 characters each
ANSWER = int(os.environ.get("ANSWER", "600"))       # answer pieces, ~9 characters each
BURST = int(os.environ.get("BURST", "12"))          # pieces that arrive together
BURST_GAP = float(os.environ.get("BURST_GAP", "0.04"))
LISTEN_SECONDS = float(os.environ.get("LISTEN_SECONDS", "4"))
THROTTLE = float(os.environ.get("THROTTLE", "6"))
SMOOTH = os.environ.get("SMOOTH", "")               # "off" measures the raw drawing
BUDGET = {"worst_frame_ms": 250, "long_task_total_ms": 3000, "first_thought_lag_ms": 1000, "still_frames_share": 0.25}

marks = {}
lock = threading.Lock()


def mark(k):
    with lock:
        marks.setdefault(k, time.time() * 1000)


class Fake(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        sent = json.loads(self.rfile.read(n).decode() or "{}")
        system = next((m.get("content", "") for m in sent.get("messages", []) if m.get("role") == "system"), "")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def send(delta, fin=None):
            self.wfile.write(("data: " + json.dumps({"choices": [{"index": 0, "delta": delta, "finish_reason": fin}]}) + "\n\n").encode())

        try:
            mark("front_asked")
            for i in range(THINK):
                send({"reasoning_content": "thinking step %05d, weighing it. " % i})
                if i == 0:
                    self.wfile.flush()
                    mark("front_first_thought_sent")
                if i % BURST == BURST - 1:
                    self.wfile.flush()
                    time.sleep(BURST_GAP)
            self.wfile.flush()
            for i in range(ANSWER):
                send({"content": "word%04d " % i})
                if i == 0:
                    self.wfile.flush()
                    mark("front_first_word_sent")
                if i % BURST == BURST - 1:
                    self.wfile.flush()
                    time.sleep(BURST_GAP)
            send({}, "stop")
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            mark("front_done")
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


def put(path, body):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=json.dumps(body).encode(), method="PUT")
    req.add_header("Content-Type", "application/json")
    return json.loads(urllib.request.urlopen(req).read() or b"{}")


def get(path):
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}").read())


def main():
    from playwright.sync_api import sync_playwright

    home = Path(tempfile.mkdtemp(prefix="cozymaker-perf-"))
    env = dict(os.environ, COZYMAKER_HOME=str(home), COZYMAKER_PORT=str(PORT))
    server = subprocess.Popen([sys.executable, str(ROOT / "serve.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    fake = Threaded(("127.0.0.1", FAKE), Fake)
    threading.Thread(target=fake.serve_forever, daemon=True).start()
    result = {}
    try:
        for _ in range(200):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/version", timeout=1).read()
                break
            except Exception:
                time.sleep(0.1)
        house = get("/api/house")
        house["connections"] = [{"id": "c1", "name": "thinks", "url": f"http://127.0.0.1:{FAKE}/v1", "model": "thinker", "key": "k"}]
        house["agentConnections"] = {"keeper": "c1"}
        house["settings"].update({"makerName": "Eni", "yourName": "Bruce", "person": "second", "theme": "hearth"})
        if SMOOTH:
            house["settings"]["smoothStreaming"] = SMOOTH
        house["personaFrame"] = "You are Eni. You are warm and a bit sharp."
        put("/api/house", house)
        put("/api/project/p_perf", {"id": "p_perf", "title": "Tide", "docs": [{"id": "d1", "name": "Plot Essential.md", "kind": "pe", "text": PE_SEED}],
                                     "turns": [], "undo": [], "recentSections": []})

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, service_workers="block")
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
            page.wait_for_timeout(800)
            cdp = ctx.new_cdp_session(page)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
            page.evaluate("""(FULL) => {
              const P = window.__perf = { frames: [], long: [], on: true, marks: {}, jumps: [], firstWords: null, foldedAtWords: null, openWhileThinking: null, full: FULL, allOnScreen: 0 };
              const mark = (k) => { if (!(k in P.marks)) P.marks[k] = Date.now(); };
              try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push(e.duration); }).observe({ type: 'longtask' }); } catch (e) {}
              document.getElementById('sendBtn').addEventListener('click', () => mark('pressed'), { capture: true });
              const live = () => { const t = document.querySelectorAll('.turn.maker'); return t[t.length - 1] || null; };
              const look = () => {
                if (!P.on) return;
                const turn = live();
                const tt = turn && turn.querySelector('.thinking-text');
                const shown = Boolean(tt && tt.checkVisibility());
                const t = shown ? tt.textContent : '';
                if (t.includes('thinking step 00000')) mark('first_thought_on_screen');
                if (turn && turn.querySelector('.thinking-box') && P.openWhileThinking === null && !(turn.querySelector('.bubble') || {}).textContent) P.openWhileThinking = shown;
                if (shown && P.firstWords === null && /thinking step 0[1-9]\\d{3}/.test(t)) P.firstWords = t.includes('thinking step 00000');
                const b = turn && turn.querySelector('.bubble');
                if (b && b.textContent.includes('word0000') && P.foldedAtWords === null) P.foldedAtWords = !shown;
              };
              setInterval(look, 50);
              let last = performance.now();
              let lastLen = 0;
              /* how many new characters each frame shows, from the first word on */
              const loop = (now) => {
                P.frames.push(now - last); last = now;
                const turn = live();
                const b = turn && turn.querySelector('.bubble');
                const len = b && b.textContent.includes('word0000') ? b.textContent.length : 0;
                if (len > 0 && !('first_word_on_screen' in P.marks)) mark('first_word_on_screen');
                if (len > 0 && len < P.full) P.jumps.push(Math.max(0, len - lastLen));
                if (len >= P.full && !P.allOnScreen) { P.allOnScreen = Date.now(); P.jumps.push(Math.max(0, len - lastLen)); }
                lastLen = len;
                if (P.on) requestAnimationFrame(loop);
              };
              requestAnimationFrame(loop);
            }""", len("".join("word%04d " % i for i in range(ANSWER)).strip()))
            page.fill("#say", "the tide should feel like a character")
            page.click("#sendBtn")
            page.wait_for_selector("#sendBtn.stop", timeout=20000)
            page.wait_for_function("() => !document.querySelector('#sendBtn.stop')", timeout=900000, polling=500)
            page.wait_for_timeout(300)
            stats = page.evaluate("""() => {
              const P = window.__perf; P.on = false;
              const f = P.frames.slice(2).sort((a, b) => a - b);
              const pct = (q) => f.length ? f[Math.min(f.length - 1, Math.floor(q * f.length))] : 0;
              const j = P.jumps;
              const mean = j.length ? j.reduce((a, b) => a + b, 0) / j.length : 0;
              const sd = j.length ? Math.sqrt(j.reduce((a, b) => a + (b - mean) * (b - mean), 0) / j.length) : 0;
              const sorted = j.slice().sort((a, b) => a - b);
              return { marks: P.marks, marks_all: P.allOnScreen || null, frames: f.length, worst_frame_ms: Math.round(f[f.length - 1] || 0), p95_frame_ms: Math.round(pct(0.95)),
                frames_over_100ms: f.filter((x) => x > 100).length, long_tasks: P.long.length, long_task_total_ms: Math.round(P.long.reduce((a, b) => a + b, 0)),
                first_words_while_streaming: P.firstWords, open_while_thinking: P.openWhileThinking, folded_at_words: P.foldedAtWords,
                word_frames: j.length, still_frames_share: j.length ? Math.round(100 * j.filter((x) => x === 0).length / j.length) / 100 : null,
                biggest_frame_jump: sorted[sorted.length - 1] || 0, frame_jump_cv: mean ? Math.round(100 * sd / mean) / 100 : null,
                first_to_last_word_on_screen_ms: P.allOnScreen && P.marks.first_word_on_screen ? P.allOnScreen - P.marks.first_word_on_screen : null };
            }""")
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
            browser.close()
        world = get("/api/project/p_perf")
        chat = next(c for c in world["chats"] if c["id"] == world["openChat"])
        kept = chat["turns"][-1]
        m = stats.pop("marks")
        with lock:
            srv = dict(marks)
        rel = lambda k, base: round(m[k] - base) if k in m and base else None
        pressed = m.get("pressed")
        result = {
            "throttle": THROTTLE, "think_pieces": THINK, "answer_pieces": ANSWER, "smooth": SMOOTH or "default",
            "press_to_first_thought_on_screen_ms": rel("first_thought_on_screen", pressed),
            "model_first_thought_to_screen_ms": rel("first_thought_on_screen", srv.get("front_first_thought_sent")),
            "model_first_word_to_screen_ms": rel("first_word_on_screen", srv.get("front_first_word_sent")),
            "model_last_word_sent_to_all_on_screen_ms": round(stats["marks_all"] - srv["front_done"]) if stats.get("marks_all") and "front_done" in srv else None,
            **stats,
            "kept_thinking_chars": len(kept.get("thinking") or ""),
            "expected_thinking_chars": sum(len("thinking step %05d, weighing it. " % i) for i in range(THINK)),
            "kept_reply_chars": len((kept.get("text") or "").strip()),
            "expected_reply_chars": len("".join("word%04d " % i for i in range(ANSWER)).strip()),
            "page_errors": errors[:3],
            "kept_text_head": (kept.get("text") or "")[:160],
        }
    finally:
        server.terminate()
        fake.shutdown()
        shutil.rmtree(home, ignore_errors=True)
    print(json.dumps(result, indent=1))
    laws = {
        "nobody is waited on: the first thought is on screen within 1.5s of the press": (result.get("press_to_first_thought_on_screen_ms") is not None and result["press_to_first_thought_on_screen_ms"] <= 1500),
        "and within a second of the model sending it": (result.get("model_first_thought_to_screen_ms") is not None and result["model_first_thought_to_screen_ms"] <= BUDGET["first_thought_lag_ms"]),
        "the box is open while it thinks, with no tap": result.get("open_while_thinking") is True,
        "its first words are still there once it is long": result.get("first_words_while_streaming") is True or THINK < 1500,
        "it folds shut once the words are on screen": result.get("folded_at_words") is True,
        "no frame stalls the screen": result.get("worst_frame_ms", 1e9) <= BUDGET["worst_frame_ms"],
        "the long tasks stay under budget": result.get("long_task_total_ms", 1e9) <= BUDGET["long_task_total_ms"],
        "the words arrive evenly (few frames with nothing new while they come)": (SMOOTH == "off") or (result.get("still_frames_share") is not None and result["still_frames_share"] <= BUDGET["still_frames_share"]),
        # the switch reaches the live path: turned off, a clump lands whole the frame it arrives
        "with Smooth streaming off, a clump lands the frame it arrives": (SMOOTH != "off") or result.get("biggest_frame_jump", 0) >= BURST * 9 - 9,
        "the whole thinking is kept": result.get("kept_thinking_chars", 0) >= result.get("expected_thinking_chars", 1) - 2,
        "the whole reply is kept": result.get("kept_reply_chars") == result.get("expected_reply_chars"),
        "nothing threw": not result.get("page_errors"),
    }
    bad = [k for k, v in laws.items() if not v]
    for k, v in laws.items():
        print(("  ok    " if v else "  FAIL  ") + k)
    print(f"{len(laws) - len(bad)} passed, {len(bad)} failed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
