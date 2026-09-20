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

import { buildRequest, readAnswer, readChunk, WORKER_ROOM } from '../providers.js';

export const MAX_RETRIES = 4;
export const BACKOFF_MS = [2000, 4000, 8000, 16000];
export const CALL_TIMEOUT_MS = 180000;

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
  const req = buildRequest(c, {
    system: opts.system,
    messages: opts.messages || [{ role: 'user', content: opts.user || '' }],
    maxTokens: c.maxTokens,
    room: WORKER_ROOM,
    stream: false,
  });

  let lastError = 'the call did not go through';
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
        const retryAfter = Number(data.retryAfter) * 1000;
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter : BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        if (attempt < MAX_RETRIES) { await sleep(wait); continue; }
        return { ok: false, text: '', thinking: '', error: lastError };
      }
      /* An empty answer is not a transport failure — it is the caller's to
       * judge, and the caller knows what it asked for. */
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
  const req = buildRequest(conn, {
    system: opts.system,
    messages: opts.messages || [],
    maxTokens: Number.isFinite(conn.maxTokens) ? conn.maxTokens : undefined,
    room: 512,
    stream: true,
  });
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      if (!line.startsWith('data:')) {
        /* A provider that answered with a plain error object rather than a
         * stream: say what it said instead of showing nothing. */
        if (line.startsWith('{')) {
          try {
            const o = JSON.parse(line);
            if (o && o.error) failed = o.detail || o.error;
          } catch (_) { /* not ours */ }
        }
        continue;
      }
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let obj;
      try { obj = JSON.parse(payload); } catch (_) { continue; }
      if (obj && obj.error) { failed = obj.error.message || JSON.stringify(obj.error); continue; }
      const part = readChunk(req.house, obj);
      if (!part) continue;
      if (part.text) { text += part.text; opts.onText && opts.onText(part.text); }
      if (part.thinking) { thinking += part.thinking; opts.onThinking && opts.onThinking(part.thinking); }
    }
  }
  if (failed && !text) throw new Error(failed);
  return { text, thinking };
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
  const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
  try {
    const out = await job.run({
      signal: ctl.signal,
      stale: () => job.epoch !== epoch,
    });
    job.settle(out && typeof out === 'object' ? out : { ok: true, value: out });
  } catch (e) {
    job.settle({ ok: false, error: (e && e.message) || String(e) });
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
