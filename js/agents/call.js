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

import { buildRequest, readAnswer, readChunk, WORKER_ROOM, withoutThinking, THINKING_FIELDS, REASONING_REFUSAL, modelsUrl, modelsHeaders, reportedIdentity, spokenAs,
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

/* THE CREW'S CALLS STREAM, the way Cozy Tavern's workers ride the same streamed
 * path as its storyteller (M28, M270). Asked for all at once, a worker writing a
 * whole plot essential sat silent for minutes — only a clock showed it was
 * alive — and a provider behind a gateway that closes a silent connection
 * could cut it off and lose the lot. Streamed, the words arrive as they are
 * written, the house can say how far along it is (onProgress), and a silent
 * gateway never sees silence. The answer is still read whole before anything
 * is done with it. "Try it" asks all at once, because only a whole answer
 * reports the thinking tokens it spent (opts.stream === false). */
export async function callModel(conn, opts = {}) {
  if (!conn || !conn.url || !conn.model) {
    return { ok: false, text: '', thinking: '', error: 'no connection is set for this' };
  }
  const c = opts.asWorker === false ? conn : asWorkerConnection(conn, opts);
  const stream = opts.stream !== false;
  const shape = {
    system: opts.system,
    messages: opts.messages || [{ role: 'user', content: opts.user || '' }],
    maxTokens: c.maxTokens,
    room: WORKER_ROOM,
    stream,
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
        body: JSON.stringify(stream ? { url: req.url, headers: req.headers, body: req.body, stream: true } : { url: req.url, headers: req.headers, body: req.body }),
        signal: opts.signal,
      });
      const out = await readReply(req.house, res, { onProgress: opts.onProgress });
      if (out.finish === 'error') {
        lastError = out.error || 'the provider was not happy with that';
        const status = Number(out.status) || 0;
        /* A REFUSED THINKING FIELD STEPS DOWN AND GOES AGAIN, ONCE — the
         * message is not eaten because the model does not take a level. */
        if (lessons < MAX_LESSONS && !out.midStream && status >= 400 && status < 500 && REASONING_REFUSAL.test(lastError) &&
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
        const retryAfter = Number(out.retryAfter) * 1000;
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter : BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        if (attempt < MAX_RETRIES) { await sleep(wait); continue; }
        return { ok: false, text: '', thinking: '', error: lastError };
      }
      /* An empty answer is not a transport failure — it is the caller's to
       * judge, and the caller knows what it asked for. */
      noticeOff(c, out.thinking);
      if (conn !== c && c.learned) conn.learned = c.learned;
      return { ok: true, text: out.text || '', thinking: out.thinking || '', finish: out.finish, thinkTokens: out.thinkTokens || 0, hiddenThought: Boolean(out.hiddenThought) };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, text: '', thinking: '', error: 'stopped' };
      lastError = (e && e.message) || String(e);
      if (attempt < MAX_RETRIES) { await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]); continue; }
    }
  }
  return { ok: false, text: '', thinking: '', error: lastError };
}

/* DOES IT ACTUALLY THINK, AT THE LEVEL THIS CONNECTION IS SET TO? (Cozy Tavern
 * M351.) "Try it" said only that the line was good. It now sends exactly what
 * a turn sends for the thinking, reads every channel thinking arrives on and
 * the thinking tokens the answer reports, and — when nothing came back —
 * asks once more at the top level, so it can say which it is: this LEVEL gives
 * none, this ADDRESS gives none, or the model thought and the address keeps the
 * words. A refused level is learned from and asked again on the way (M350). */
export async function testConnection(conn) {
  const level = conn && conn.thinking ? String(conn.thinking) : '';
  const ask = (c) => callModel(c, { user: 'Answer with one word: ready.', maxTokens: 2000, stream: false });
  const first = await ask(conn);
  if (!first.ok) return { ok: false, words: `No \u2014 ${first.error}` };
  const said = first.text.trim() ? ` It answered \u201c${first.text.trim().slice(0, 24)}\u201d.` : '';
  const at = level ? `Asked at \u201c${level}\u201d (${spokenAs(conn)})` : 'Asked with nothing said about thinking, so the model decided';
  const came = (o) => String(o.thinking || '').trim();
  if (came(first)) return { ok: true, thinks: true, words: `Working. ${at} \u2014 ${came(first).length.toLocaleString()} characters of thinking came back.${said} Thinking works on this connection.` };
  if (first.thinkTokens || first.hiddenThought) return { ok: true, thinks: true, hidden: true, words: `Working. ${at} \u2014 no thinking words came back, but it reported ${first.thinkTokens ? first.thinkTokens.toLocaleString() + ' thinking tokens' : 'hidden thinking'}: the model did think, and this address keeps the words to itself.${said}` };
  if (level === 'off') return { ok: true, thinks: false, words: `Working. ${at} \u2014 it answered without thinking, as set.${said}` };
  if (!level) return { ok: true, thinks: false, words: `Working. ${at} \u2014 it answered without thinking.${said} Choose a level under Thinking if you want it to think.` };
  if (level === 'max') return { ok: true, thinks: false, words: `Working. ${at} \u2014 no thinking came back even at the top level: this address sends none back (the model may still think inside it).${said}` };
  const top = await ask({ ...conn, thinking: 'max' });
  if (!top.ok) return { ok: true, thinks: false, words: `Working. ${at} \u2014 no thinking came back. (Asking at the top level was refused, so it could not be compared.)${said}` };
  if (came(top) || top.thinkTokens || top.hiddenThought) return { ok: true, thinks: false, levelTooLow: true, words: `Working. ${at} \u2014 no thinking came back. Asked again at \u201cmax\u201d, thinking did come back \u2014 so it is this LEVEL that gives none here, not the address: choose a higher one.${said}` };
  return { ok: true, thinks: false, words: `Working. ${at} \u2014 no thinking came back, nor at \u201cmax\u201d: this address sends no thinking back at any level (the model may still think inside it).${said}` };
}

/* The models a provider offers, as it lists them (Cozy Tavern M348): each with
 * what it is — the weights behind an alias, the thinking levels it takes. */
export async function listModels(conn) {
  const url = modelsUrl(conn);
  if (!url) return { ok: false, error: 'there is no address yet' };
  try {
    const res = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, headers: modelsHeaders(conn), method: 'GET' }) });
    const data = await res.json();
    if (data && data.error) return { ok: false, error: data.detail || data.error };
    const rows = Array.isArray(data && data.data) ? data.data : Array.isArray(data && data.models) ? data.models : Array.isArray(data) ? data : [];
    const models = rows.filter((m) => m && (m.id || m.name)).map((m) => ({ id: String(m.id || m.name), ...reportedIdentity(m) }));
    models.sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
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
  const out = await readReply(req.house, res, { onText: opts.onText, onThinking: opts.onThinking });
  /* A REPLY BROKEN OFF PARTWAY IS A CUT REPLY. A provider that says it went
   * wrong in the middle of an answer (or a line that dropped) left what had
   * arrived looking finished — no failure, no Go on, a truncated answer passing
   * for a whole one. It is kept as what it is: cut, by the provider. */
  if (out.finish === 'error' && out.text) return { text: out.text, thinking: out.thinking || '', cut: true, cutBy: 'provider' };
  if (out.finish === 'error' && !out.text) {
    const err = new Error(out.error || 'the provider was not happy with that');
    err.status = Number(out.status) || 0;
    err.refusedThinking = !dropThinking && !out.midStream && out.status >= 400 && out.status < 500 &&
      REASONING_REFUSAL.test(err.message) && THINKING_FIELDS.some((f) => f in req.body);
    err.body = req.body;
    throw err;
  }
  return { text: out.text || '', thinking: out.thinking || '', cut: out.finish === 'length' };
}

/* ONE READER FOR EVERY ANSWER, streamed or not.
 *
 * A stream is read line by line as it arrives; the words and the thinking go to
 * whoever is listening, each on its own channel. What is left when the stream
 * ends is still part of it: a refusal comes back as one line of JSON with no
 * newline after it, and a provider's last piece can end without one too (the
 * first version read only lines ending in a newline, and a refused call — a bad
 * key, a wrong model, a level the model will not take — came back as an empty
 * reply with no error).
 *
 * An answer that is not a stream at all is read too, whole: the device's own
 * word that the provider refused (it answers every refusal with one JSON
 * object), or a provider that ignored "stream" and answered in one piece —
 * which used to reach him as an empty reply.
 *
 * An error that arrives in the middle of a stream is an error, never a finished
 * answer; and a stream that ends having said nothing at all, and never said it
 * was done, did not finish — both are tried again like any passing fault. */
/* A THOUGHT WRITTEN INTO THE REPLY IS THE MODEL'S THINKING, NOT ITS REPLY.
 * Some servers have no channel for a model's thinking and send it inside the
 * words, between <think> and </think> — often with no opening tag at all, the
 * model's own template having opened it. Cozy Tavern's splitter (its M8.5,
 * V176) moves a reply's leading span onto the thinking channel as it streams,
 * holding back a tag cut in two by a chunk; CozyMaker never had it, so the
 * whole thought was shown as the reply, and sent back to the persona as its
 * own earlier words on every turn after. The streamed splitter below is
 * Tavern's; splitThink takes what is left when the stream is done: a lone
 * </think> means everything before it was the thought. */
function makeThinkSplitter(emit) {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let state = 'open';
  let buf = '';
  let afterThought = false;   /* the blank lines after a moved thought are not the reply's first words */
  function feed(text) {
    buf += text;
    for (;;) {
      if (state === 'open') {
        const trimmed = buf.replace(/^\s+/, '');
        if (trimmed.length < OPEN.length && OPEN.startsWith(trimmed)) return;
        if (trimmed.startsWith(OPEN)) {
          const lead = buf.length - trimmed.length;
          if (lead) emit('prose', buf.slice(0, lead));
          buf = trimmed.slice(OPEN.length);
          state = 'thinking';
          continue;
        }
        emit('prose', buf);
        buf = '';
        state = 'prose';
        return;
      }
      if (state === 'thinking') {
        const at = buf.indexOf(CLOSE);
        if (at !== -1) {
          if (at) emit('thinking', buf.slice(0, at));
          buf = buf.slice(at + CLOSE.length);
          state = 'prose';
          afterThought = true;
          continue;
        }
        let hold = 0;
        const maxHold = Math.min(CLOSE.length - 1, buf.length);
        for (let k = maxHold; k > 0; k--) {
          if (CLOSE.startsWith(buf.slice(-k))) { hold = k; break; }
        }
        const out = buf.slice(0, buf.length - hold);
        if (out) emit('thinking', out);
        buf = buf.slice(buf.length - hold);
        return;
      }
      if (afterThought) { buf = buf.replace(/^\s+/, ''); if (!buf) return; afterThought = false; }
      emit('prose', buf);
      buf = '';
      return;
    }
  }
  function end() {
    if (!buf) return;
    emit(state === 'thinking' ? 'thinking' : 'prose', buf);
    buf = '';
  }
  return { feed, end };
}
export function splitThink(text) {
  let words = String(text || '');
  let thought = '';
  const lead = /^\s*<think>([\s\S]*?)(?:<\/think>|$)/.exec(words);
  if (lead) { thought = lead[1]; words = words.slice(lead[0].length); }
  const close = words.lastIndexOf('</think>');
  if (close !== -1 && words.slice(0, close).indexOf('<think>') === -1) {
    thought = (thought ? thought + '\n' : '') + words.slice(0, close);
    words = words.slice(close + 8);
  }
  return { text: words.replace(/^\s+/, ''), thinking: thought.trim() };
}

const TRANSIENT_WORDS = /overload|rate.?limit|too many requests|timed? ?out|try again|temporar|unavailable|capacity|busy/i;
/* An error said in the middle of an answer: the provider was reached and said
 * what went wrong, so it is not a lost connection. What reads as passing
 * (overloaded, rate-limited, try again) is tried again; anything else is said
 * as it is, once — and it never teaches the house a lesson about thinking,
 * because the request itself was taken. */
function errorOf(e) {
  const err = e && typeof e === 'object' ? e : { message: String(e || '') };
  const message = typeof err.message === 'string' && err.message ? err.message : JSON.stringify(err);
  let status = Number(err.code) || Number(err.status) || 0;
  if (!status) status = TRANSIENT_WORDS.test(message + ' ' + String(err.type || '')) ? 503 : 422;
  return { message, status };
}
export async function readReply(house, res, { onText, onThinking, onProgress } = {}) {
  const reader = res && res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  const whole = (data) => {
    if (data && data.error) {
      const d = data.detail || data.error;
      return { finish: 'error', error: typeof d === 'string' ? d : JSON.stringify(d), status: Number(data.status) || 0, retryAfter: data.retryAfter, text: '', thinking: '' };
    }
    const a = readAnswer(house, data);
    const cut = splitThink(a.text);
    if (cut.thinking) { a.text = cut.text; a.thinking = [a.thinking, cut.thinking].filter(Boolean).join('\n\n'); }
    if (a.text && onText) onText(a.text);
    if (a.thinking && onThinking) onThinking(a.thinking);
    return a;
  };
  if (!reader) {
    let data = null;
    try { data = await res.json(); } catch (_) { return { finish: 'error', error: 'the answer could not be read', status: 0, text: '', thinking: '' }; }
    return whole(data);
  }
  const decoder = new TextDecoder();
  let buffer = '', raw = '', sse = false, text = '', thinking = '', cut = false, ended = false, midError = null, told = 0;
  const split = makeThinkSplitter((kind, s) => {
    if (kind === 'thinking') { thinking += s; if (onThinking) onThinking(s); } else { text += s; if (onText) onText(s); }
  });
  const handle = (line) => {
    const l = line.trim();
    if (!l.startsWith('data:')) return;
    sse = true;
    const payload = l.slice(5).trim();
    if (payload === '[DONE]') { ended = true; return; }
    let obj;
    try { obj = JSON.parse(payload); } catch (_) { return; }
    if (!obj || typeof obj !== 'object') return;
    if (obj.error) { midError = obj.error; return; }
    if (obj.type === 'message_stop' || (obj.type === 'message_delta' && obj.delta && obj.delta.stop_reason)) ended = true;
    const choice = obj.choices && obj.choices[0];
    if (choice && choice.finish_reason) ended = true;
    const part = readChunk(house, obj);
    if (!part) return;
    if (part.text) split.feed(part.text);
    if (part.thinking) { thinking += part.thinking; if (onThinking) onThinking(part.thinking); }
    if (part.cut) cut = true;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const piece = decoder.decode(value, { stream: true });
    if (!sse) raw += piece;
    buffer += piece;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) { handle(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
    if (onProgress && Date.now() - told >= 400) { told = Date.now(); onProgress({ text, thinking }); }
  }
  const tail = decoder.decode();
  if (!sse) raw += tail;
  handle(buffer + tail);
  if (!sse) {
    let data = null;
    try { data = JSON.parse(raw); } catch (_) { return { finish: 'error', error: raw.trim() ? 'the answer could not be read' : 'nothing came back', status: 0, text: '', thinking: '' }; }
    return whole(data);
  }
  split.end();
  /* a lone </think> left in the words: everything before it was the thought */
  const late = splitThink(text);
  if (late.thinking) { text = late.text; thinking = [thinking, late.thinking].filter(Boolean).join('\n\n'); }
  if (onProgress) onProgress({ text, thinking });
  if (midError) { const e = errorOf(midError); return { finish: 'error', error: e.message, status: e.status, midStream: true, text, thinking }; }
  if (!text && !thinking && !ended) return { finish: 'error', error: 'the answer stopped before anything came', status: 0, text: '', thinking: '' };
  return { text, thinking, finish: cut ? 'length' : 'stop', thinkTokens: 0, hiddenThought: false };
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
