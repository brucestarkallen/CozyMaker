/* CozyMaker — js/agents/call.js
 *
 * The one way anything in this house speaks to a model, and the one channel
 * the backstage work runs on.
 *
 * Every call goes out through the device's own server. Keys never leave the
 * device; no provider's browser rules can break a room; and there is exactly
 * one place where a retry, a timeout, or an unkind error message is handled.
 *
 * The backstage channel is exclusive and in order: one job at a time, in the
 * order they were asked for. A job carries the moment it was queued; switching
 * projects moves the moment on and every job still waiting is quietly let go,
 * so work for a world the writer has left never lands in the one he opened.
 */

import { buildRequest, readAnswer, readChunk, WORKER_ROOM, withoutThinking, THINKING_FIELDS, REASONING_REFUSAL,
  lessonFrom, learnedFacts, learnKey, familyStyle, cannotStopThinking } from '../providers.js';

/* WHAT A MODEL TEACHES IS KEPT (Cozy Tavern M350). A refusal of a thinking
 * field is read for what it offers — the levels it takes, or the one field it
 * does not — and the same request goes again fitted to it. The lesson is kept
 * on the connection, for that model at that address, so the next call is
 * right the first time instead of paying the refusal again. A refusal that
 * says nothing useful silences thinking for a day (M319), then heals. An Off
 * the model ignored is noticed. The house hears each lesson and saves it. */
const learners = new Set();
export function onLearn(fn) { learners.add(fn); return () => learners.delete(fn); }
export function learn(conn, fact) {
  if (!conn) return null;
  const was = learnedFacts(conn) ? conn.learned : null;
  const next = {
    for: learnKey(conn),
    at: Date.now(),
    efforts: fact.efforts || (was && was.efforts) || null,
    drop: [...new Set([...((was && was.drop) || []), ...(fact.drop || [])])],
    offThinks: fact.offThinks === true || Boolean(was && was.offThinks),
    downAt: fact.downAt || (was && was.downAt) || null,
  };
  conn.learned = next;
  for (const fn of learners) { try { fn(conn.id, next); } catch (_) {} }
  return next;
}
/* A refusal that names one field can hide another (a house that takes no
 * thinking at all may name only the first field it met). So a lesson is
 * learned per refusal, as many as there are fields to learn about; a refusal
 * that teaches nothing new silences thinking for the day (M319). It always
 * ends: every lesson removes something, and silence removes the rest. */
export const MAX_LESSONS = THINKING_FIELDS.length + 1;
function thinkingPart(body) {
  const b = body || {};
  return JSON.stringify(THINKING_FIELDS.filter((f) => f in b).map((f) => [f, b[f]]));
}
function learnFromRefusal(conn, detail, body, rebuild) {
  learn(conn, lessonFor(detail, body));
  let next = rebuild();
  if (thinkingPart(next) === thinkingPart(body)) { learn(conn, { downAt: Date.now() }); next = rebuild(); }
  return next;
}
function lessonFor(detail, body) {
  const l = lessonFrom(detail, body);
  if (l.allowed) return { efforts: l.allowed };
  if (l.badField) return { drop: [l.badField] };
  return { downAt: Date.now() };
}
function noticeOff(conn, thinking) {
  if (conn && conn.thinking === 'off' && String(thinking || '').trim() &&
      familyStyle(conn) !== 'hermes' && !cannotStopThinking(conn) && !(learnedFacts(conn) || {}).offThinks) {
    learn(conn, { offThinks: true });
  }
}

export const MAX_RETRIES = 4;
export const BACKOFF_MS = [2000, 4000, 8000, 16000];
/* A HANG GUARD, NOT A CLOCK ON THE WORK. A worker writing a whole plot
 * essential on a real provider works for minutes; 180 seconds killed that work
 * and it was reported as "stopped" — never seen here because every test ran
 * against a stand-in that answers at once. The device's relay already gives
 * each call ten minutes of silence before it gives up (serve.py); this only
 * catches a job that never comes back at all, and says so in those words. */
export let CALL_TIMEOUT_MS = 30 * 60 * 1000;
export const TIMED_OUT = 'it ran for thirty minutes without finishing, so it was let go';
export function setCallTimeoutForTests(ms) { CALL_TIMEOUT_MS = ms; }

/* ---------------------------------------------------------------- calling */

function asWorkerConnection(conn, { maxTokens }) {
  /* THE CONNECTION THE WRITER CHOSE IS THE CONNECTION THAT ANSWERS. Its
   * temperature, its top-p, its thinking are its own; this copy changes
   * exactly one thing — it makes sure there is room for an answer, because a
   * connection set to 200 tokens would cut a worker's edits in half. It only
   * ever raises the ceiling. */
  const c = { ...conn };
  const want = Number.isFinite(maxTokens) ? Math.round(maxTokens) : WORKER_ROOM;
  const has = Number.isFinite(c.maxTokens) ? Math.round(c.maxTokens) : 0;
  c.maxTokens = Math.max(want, has);
  return c;
}

export async function callModel(conn, opts = {}) {
  if (!conn || !conn.url || !conn.model) {
    return { ok: false, text: '', thinking: '', error: 'no connection is set for this' };
  }
  const c = opts.asWorker === false ? conn : asWorkerConnection(conn, opts);
  const shape = {
    system: opts.system,
    messages: opts.messages || [{ role: 'user', content: opts.user || '' }],
    maxTokens: c.maxTokens,
    room: WORKER_ROOM,
    stream: false,
  };
  const req = buildRequest(c, shape);

  let lastError = 'the call did not go through';
  let lessons = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (opts.stale && opts.stale()) return { ok: false, text: '', thinking: '', error: 'let go' };
    try {
      const res = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: req.url, headers: req.headers, body: req.body }),
        signal: opts.signal,
      });
      const data = await res.json();
      const out = readAnswer(req.house, data);
      if (out.finish === 'error') {
        lastError = out.error || 'the provider was not happy with that';
        const status = Number(data.status) || 0;
        /* A REFUSED THINKING FIELD STEPS DOWN AND GOES AGAIN, ONCE — the
         * message is not eaten because the model does not take a level. */
        if (lessons < MAX_LESSONS && status >= 400 && status < 500 && REASONING_REFUSAL.test(lastError) &&
            THINKING_FIELDS.some((f) => f in req.body)) {
          req.body = learnFromRefusal(c, lastError, req.body, () => buildRequest(c, shape).body);
          if (conn !== c) conn.learned = c.learned;
          lessons++;
          attempt--;
          continue;
        }
        /* NOTHING ELSE IN THE FOUR-HUNDREDS IS FIXED BY WAITING. A bad key, a
         * wrong model name, a malformed request comes back identical every
         * time; retrying it four times only turns an instant error into thirty
         * seconds of silence. Only "slow down" and "try later" are retried. */
        const transient = status === 0 || status === 408 || status === 429 || status >= 500;
        if (!transient) return { ok: false, text: '', thinking: '', error: lastError };
        const retryAfter = Number(data.retryAfter) * 1000;
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter : BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        if (attempt < MAX_RETRIES) { await sleep(wait); continue; }
        return { ok: false, text: '', thinking: '', error: lastError };
      }
      /* An empty answer is not a transport failure — it is the caller's to
       * judge, and the caller knows what it asked for. */
      noticeOff(c, out.thinking);
      if (conn !== c && c.learned) conn.learned = c.learned;
      return { ok: true, text: out.text || '', thinking: out.thinking || '', finish: out.finish };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, text: '', thinking: '', error: 'stopped' };
      lastError = (e && e.message) || String(e);
      if (attempt < MAX_RETRIES) { await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]); continue; }
    }
  }
  return { ok: false, text: '', thinking: '', error: lastError };
}

/* The front of the house streams, so the writer sees words arriving. */
export async function streamModel(conn, opts = {}) {
  let out;
  for (let lessons = 0; ; lessons++) {
    try { out = await streamOnce(conn, opts, false); break; }
    catch (e) {
      if (!(e && e.refusedThinking) || (opts.signal && opts.signal.aborted) || lessons >= MAX_LESSONS) throw e;
      /* the same lessons as a worker's; the next try is built with them */
      learnFromRefusal(conn, e.message, e.body || {}, () => buildRequest(conn, { system: opts.system, messages: opts.messages || [], stream: true }).body);
    }
  }
  noticeOff(conn, out.thinking);
  return out;
}

async function streamOnce(conn, opts, dropThinking) {
  const req = buildRequest(conn, {
    system: opts.system,
    messages: opts.messages || [],
    maxTokens: Number.isFinite(conn.maxTokens) ? conn.maxTokens : undefined,
    room: 512,
    stream: true,
  });
  if (dropThinking) req.body = withoutThinking(req.body);
  const res = await fetch('/api/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: req.url, headers: req.headers, body: req.body, stream: true }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error('the connection did not open');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let thinking = '';
  let failed = null;
  let failedStatus = 0;
  let cut = false;

  const handle = (raw) => {
    const line = raw.trim();
    if (!line) return;
    if (!line.startsWith('data:')) {
      /* A provider that answered with a plain error object rather than a
       * stream: say what it said instead of showing nothing. */
      if (line.startsWith('{')) {
        try {
          const o = JSON.parse(line);
          if (o && o.error) { failed = o.detail || o.error; failedStatus = Number(o.status) || 0; }
        } catch (_) { /* not ours */ }
      }
      return;
    }
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') return;
    let obj;
    try { obj = JSON.parse(payload); } catch (_) { return; }
    if (obj && obj.error) { failed = obj.error.message || JSON.stringify(obj.error); return; }
    const part = readChunk(req.house, obj);
    if (!part) return;
    if (part.text) { text += part.text; opts.onText && opts.onText(part.text); }
    if (part.thinking) { thinking += part.thinking; opts.onThinking && opts.onThinking(part.thinking); }
    if (part.cut) cut = true;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  /* WHAT IS LEFT WHEN THE STREAM ENDS IS STILL PART OF IT. A refusal comes
   * back as one line of JSON with no newline after it, and a provider's last
   * piece can end without one too. The first version only read lines that
   * ended in a newline, so a refused call — a bad key, a wrong model, a level
   * the model will not take — came back as an empty reply with no error. */
  buffer += decoder.decode();
  handle(buffer);
  if (failed && !text) {
    const err = new Error(typeof failed === 'string' ? failed : JSON.stringify(failed));
    err.refusedThinking = !dropThinking && failedStatus >= 400 && failedStatus < 500 &&
      REASONING_REFUSAL.test(err.message) && THINKING_FIELDS.some((f) => f in req.body);
    err.body = req.body;
    throw err;
  }
  return { text, thinking, cut };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ----------------------------------------------------------- the channel */

let epoch = 0;
let activeProject = null;
const pending = new Map();      /* projectId -> job[] */
const running = new Map();      /* projectId -> AbortController */
const listeners = new Set();

export function onWork(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function announce(state) { for (const fn of listeners) { try { fn(state); } catch (_) {} } }

export function setActiveProject(id) {
  if (activeProject === id) return;
  activeProject = id;
  epoch++;
  for (const [pid, list] of pending) {
    if (pid === id) continue;
    for (const job of list.splice(0)) job.settle({ ok: false, error: 'let go' });
  }
  announce({ busy: false, label: '' });
}

export function stopWork(projectId) {
  const list = pending.get(projectId);
  if (list) for (const job of list.splice(0)) job.settle({ ok: false, error: 'stopped' });
  const live = running.get(projectId);
  if (live) live.abort();
  announce({ busy: false, label: '' });
}

export function enqueue(projectId, label, run) {
  const mine = epoch;
  let settle;
  const done = new Promise((resolve) => { settle = resolve; });
  const job = { label, run, epoch: mine, settle, settled: false };
  const wrapped = (v) => { if (!job.settled) { job.settled = true; settle(v); } };
  job.settle = wrapped;
  if (!pending.has(projectId)) pending.set(projectId, []);
  pending.get(projectId).push(job);
  drain(projectId);
  return done;
}

async function drain(projectId) {
  if (running.has(projectId)) return;
  const list = pending.get(projectId);
  if (!list || !list.length) return;
  const job = list.shift();
  if (job.epoch !== epoch) { job.settle({ ok: false, error: 'let go' }); return drain(projectId); }

  const ctl = new AbortController();
  running.set(projectId, ctl);
  announce({ busy: true, label: job.label });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, CALL_TIMEOUT_MS);
  try {
    const out = await job.run({
      signal: ctl.signal,
      stale: () => job.epoch !== epoch,
    });
    const result = out && typeof out === 'object' ? out : { ok: true, value: out };
    /* the ceiling is not his Stop: say which it was */
    job.settle(timedOut && result.ok === false ? { ...result, error: TIMED_OUT } : result);
  } catch (e) {
    job.settle({ ok: false, error: timedOut ? TIMED_OUT : ((e && e.message) || String(e)) });
  } finally {
    clearTimeout(timer);
    running.delete(projectId);
    announce({ busy: false, label: '' });
    drain(projectId);
  }
}

export function queueDepth(projectId) {
  const list = pending.get(projectId);
  return (list ? list.length : 0) + (running.has(projectId) ? 1 : 0);
}

export function resetChannelForTests() {
  epoch = 0; activeProject = null; pending.clear(); running.clear(); listeners.clear();
}
