/* CozyMaker — js/ui/app.js
 * The room: the conversation that is open, and the way into everything else. */

import * as store from '../store.js';
import { runTurn, capUndo, landTurn } from '../agents/run.js';
import { onWork, stopWork } from '../agents/call.js';
import { undoBatch } from '../doc/edits.js';
import { personaOf, names } from '../agents/persona.js';
import { $, el, escape, closeSheet, toast, applyTheme, onRedraw, onAsk } from './kit.js';
import { openDocs, tidyOnLeaving, currentDocId, newPlotEssential, bringIn } from './docs.js';
import { openHouse } from './settings.js';
import { openDrawer, closeDrawer, drawerIsOpen, wireSwipe, setBusyCheck, draw as drawDrawer } from './drawer.js';

const stream = $('stream');
const say = $('say');
const sendBtn = $('sendBtn');

/* The one turn in flight, if any: which world and which conversation asked. */
let running = null;       /* { worldId, chatId, startedAt, abort } */
let statusEl = null;
const SEND_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const STOP_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>';

/* ------------------------------------------------------------------ boot */

async function boot() {
  const house = await store.loadHouse();
  applyTheme(house.settings.theme);
  const worlds = await store.listProjects();
  const want = store.lastOpenId();
  if (worlds.some((w) => w.id === want)) await store.openProject(want);
  else if (worlds.length) await store.openProject(worlds[0].id);
  else await store.createProject('A new world');
  wire();
  draw();
}

function wire() {
  sendBtn.addEventListener('click', onSendButton);
  say.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSendButton(); }
  });
  say.addEventListener('input', grow);
  $('menuBtn').addEventListener('click', () => (drawerIsOpen() ? closeDrawer() : openDrawer()));
  $('scrim').addEventListener('click', closeDrawer);
  $('docsBtn').addEventListener('click', () => openDocs());
  $('settingsBtn').addEventListener('click', () => openHouse());
  $('worldBtn').addEventListener('click', openDrawer);
  for (const b of document.querySelectorAll('[data-close]')) {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-close');
      if (id === 'docsSheet' && currentDocId()) tidyOnLeaving(currentDocId());
      closeSheet(id);
    });
  }
  stream.addEventListener('scroll', () => { pinned = nearBottom(); }, { passive: true });
  onWork((state) => { if (state.busy && running) setStatus(state.label); });
  store.watch(({ trouble }) => {
    drawHeader();
    $('saveNote').hidden = !trouble;
  });
  onRedraw(() => draw());
  onAsk((text, worker) => send(text, worker));
  setBusyCheck(() => Boolean(running));
  wireSwipe();
}

function grow() {
  say.style.height = 'auto';
  say.style.height = Math.min(say.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
}

/* ---------------------------------------------------------------- scroll */

/* THE WRITER OWNS THE SCROLL (Cozy Chat v5.2.2). The stream follows a reply
 * down only while he is already at the bottom; the moment he scrolls up to
 * read, it stops pulling him back. */
let pinned = true;
function nearBottom() { return stream.scrollHeight - stream.scrollTop - stream.clientHeight < 120; }
function follow() { if (pinned) stream.scrollTop = stream.scrollHeight; }

/* ---------------------------------------------------------------- drawing */

/* A redraw of the same conversation keeps his place unless he was already at
 * the bottom; only walking into a different conversation starts at its end.
 * The first version followed his finger while a reply streamed and then threw
 * him to the bottom anyway the moment it finished. */
let lastDrawn = null;

export function draw() {
  drawHeader();
  const p = store.getProject();
  const chat = store.openChat();
  const same = chat && p && lastDrawn === p.id + ':' + chat.id;
  const keepAt = same && !pinned ? stream.scrollTop : null;
  lastDrawn = chat && p ? p.id + ':' + chat.id : null;
  stream.innerHTML = '';
  if (!p || !chat) return;
  const turns = chat.turns || [];
  if (!turns.length) stream.append(emptyRoom(p));
  else turns.forEach((t, i) => stream.append(turnNode(t, i)));
  if (running && running.worldId === p.id && running.chatId === chat.id && running.bubble) {
    stream.append(running.bubble);
    if (statusEl) stream.append(statusEl);
  }
  drawComposer();
  if (keepAt !== null) { stream.scrollTop = keepAt; return; }
  pinned = true;
  follow();
}

function emptyRoom(p) {
  const box = el('div', 'empty');
  const who = names(personaOf(store.getHouse()));
  const them = who.maker === 'you' ? 'them' : who.maker;
  box.append(el('b', '', p.title));
  const hasPE = (p.docs || []).some((d) => d.kind === 'pe' && (d.text || '').trim());
  if (!hasPE) {
    box.append(el('p', '', `Tell ${them} about the world you want to build — the place, the people, the trouble. Or start from something you already have.`));
    const row = el('div', 'btnrow center');
    const start = el('button', 'btn', 'Start a plot essential');
    start.addEventListener('click', newPlotEssential);
    const bring = el('button', 'btn quiet', 'Bring one in');
    bring.addEventListener('click', bringIn);
    row.append(start, bring);
    box.append(row);
  } else {
    box.append(el('p', '', `A fresh conversation about ${p.title}. Everything in the documents is still here — ask ${them} anything, or give the plot essential a job.`));
  }
  return box;
}

function drawHeader() {
  const p = store.getProject();
  if (!p) return;
  $('worldName').textContent = p.title;
  const chat = store.openChat();
  const n = (p.docs || []).length;
  $('worldSub').textContent = `${chat ? chat.title : ''}${chat ? ' · ' : ''}${n ? `${n} document${n === 1 ? '' : 's'}` : 'nothing written yet'}`;
}

/* ONE BUTTON, ONE MEANING (Cozy Tavern M210). While a turn runs, the button
 * in the conversation that asked is a Stop and LOOKS like one. Everywhere
 * else the composer says the crew is busy and where, instead of silently
 * turning into a way to cancel somebody else's work. */
function drawComposer() {
  const p = store.getProject();
  const chat = store.openChat();
  const here = running && p && chat && running.worldId === p.id && running.chatId === chat.id;
  if (!running) {
    sendBtn.innerHTML = SEND_ICON;
    sendBtn.classList.remove('stop');
    sendBtn.setAttribute('aria-label', 'Send'); sendBtn.title = 'Send';
    say.disabled = false; sendBtn.disabled = false;
    say.placeholder = 'What are we making?';
  } else if (here) {
    sendBtn.innerHTML = STOP_ICON;
    sendBtn.classList.add('stop');
    sendBtn.setAttribute('aria-label', 'Stop'); sendBtn.title = 'Stop';
    say.disabled = false; sendBtn.disabled = false;
    say.placeholder = 'The crew is working…';
  } else {
    sendBtn.innerHTML = SEND_ICON;
    sendBtn.classList.remove('stop');
    sendBtn.setAttribute('aria-label', 'Send'); sendBtn.title = 'The crew is busy elsewhere';
    say.disabled = true; sendBtn.disabled = true;
    say.placeholder = `The crew is working in “${running.chatTitle}” — back in a moment`;
  }
}

function turnNode(t, index) {
  const wrap = el('div', 'turn ' + (t.role === 'writer' ? 'writer' : 'maker'));
  if (t.role !== 'writer') {
    const who = names(personaOf(store.getHouse()));
    if (who.maker && who.maker !== 'you') wrap.append(el('div', 'who', who.maker));
  }
  const bubble = el('div', 'bubble' + (t.failed ? ' failed' : ''));
  bubble.textContent = t.text || '';
  wrap.append(bubble);
  if (t.cut) wrap.append(el('div', 'cutnote', 'Cut off here — the reply ran out of room before it finished.'));
  /* THE FINDABLE RETRY (Cozy Tavern M25). The last turn, when it failed or
   * was stopped and changed nothing, can simply go again — his words are
   * still here, he should not have to type them twice. A turn whose crew DID
   * change the documents keeps those changes; going again would do the work
   * twice, so it is not offered there. */
  const chat = store.openChat();
  const last = chat && index === chat.turns.length - 1;
  const before = chat && chat.turns[index - 1];
  if (last && t.failed && !(t.batches || []).length && before && before.role === 'writer' && !running) {
    const again = el('button', 'btn quiet small again', 'Try again');
    again.addEventListener('click', () => tryAgain(index));
    wrap.append(again);
  }
  if (t.thinking) {
    const d = document.createElement('details');
    d.className = 'thinking';
    const s = document.createElement('summary');
    s.textContent = 'what they were turning over';
    d.append(s, document.createTextNode(t.thinking));
    wrap.append(d);
  }
  if ((t.cards && t.cards.length) || (t.batches && t.batches.length)) wrap.append(cardsNode(t, index));
  return wrap;
}

function cardsNode(t, index) {
  const box = el('div', 'cards');
  for (const c of t.cards || []) {
    const row = el('div', 'card' + (c.status === 'refused' ? ' refused' : ''));
    row.append(el('span', 'dot'));
    const text = el('span', 'grow');
    if (c.status === 'applied') text.innerHTML = `<b>${escape(c.name)}</b> — ${escape(c.reason || c.how || 'changed')}`;
    else text.innerHTML = c.name ? `<b>${escape(c.name)}</b> — not done: ${escape(c.why || 'refused')}` : `Not done: ${escape(c.why || 'refused')}`;
    row.append(text);
    box.append(row);
  }
  for (const b of t.batches || []) {
    const row = el('div', 'card');
    row.append(el('span', 'dot'));
    const what = `${b.items.length} document${b.items.length === 1 ? '' : 's'} changed`;
    row.append(el('span', 'grow', b.undone ? 'put back' : what));
    if (!b.undone && !b.tooOld) {
      const u = el('button', 'undo', 'put it back');
      u.addEventListener('click', () => putBack(index, b.id));
      row.append(u);
    }
    box.append(row);
  }
  return box;
}

async function tryAgain(index) {
  /* Checked BEFORE anything is taken off: if a turn started between the
   * button being drawn and the tap, taking his words off and then being
   * refused would lose them. */
  if (running) { toast('The crew is still working — try again when they are done.'); return; }
  const p = store.getProject();
  const chat = store.openChat();
  const writer = chat.turns[index - 1];
  if (!writer || writer.role !== 'writer') return;
  /* His words and the failed answer are taken off, and his words go again
   * exactly as they were first sent — with the same named job if a button
   * sent them. */
  const chats = p.chats.map((c) => (c.id !== chat.id ? c : { ...c, turns: c.turns.slice(0, index - 1) }));
  await store.setProject({ ...p, chats }, { now: true });
  send(writer.text, writer.worker || null);
}

async function putBack(turnIndex, batchId) {
  const p = store.getProject();
  const chat = store.openChat();
  const turn = chat.turns[turnIndex];
  const batch = turn && (turn.batches || []).find((b) => b.id === batchId);
  if (!batch) return;
  const docs = (p.docs || []).map((d) => ({ name: d.name, text: d.text }));
  const out = undoBatch(docs, batch);
  if (!out.ok) return toast(out.why);
  let nextDocs = (p.docs || []).slice();
  for (const ch of out.changes) {
    if (ch.remove) nextDocs = nextDocs.filter((d) => d.name !== ch.name);
    else nextDocs = nextDocs.map((d) => (d.name === ch.name ? { ...d, text: ch.text } : d));
  }
  const chats = p.chats.map((c) => (c.id !== chat.id ? c : {
    ...c,
    turns: c.turns.map((t, i) => (i !== turnIndex ? t : {
      ...t, batches: t.batches.map((b) => (b.id === batchId ? { ...b, undone: true } : b)),
    })),
  }));
  await store.setProject({ ...p, docs: nextDocs, chats }, { now: true });
  draw();
  toast('Put back.');
}

/* ------------------------------------------------------------------ send */

/* A second tap that lands within a moment of sending is the same tap twice,
 * not a Stop (Cozy Tavern M295). */
const DOUBLE_TAP_MS = 700;

function onSendButton() {
  if (running) {
    const p = store.getProject();
    const chat = store.openChat();
    const here = p && chat && running.worldId === p.id && running.chatId === chat.id;
    if (!here) return;
    if (Date.now() - running.startedAt < DOUBLE_TAP_MS) return;
    stopWork(running.worldId);
    running.abort.abort();
    setStatus('stopping…');
    return;
  }
  const text = say.value.trim();
  if (!text) return;
  say.value = ''; grow();
  send(text, null);
}

async function send(text, forceWorker) {
  if (running) { toast('The crew is still working — this can go when they are done.'); return; }
  const house = store.getHouse();
  if (!house.connections.length) { openHouse(); toast('Set up a connection first — in the house, under Connections.'); return; }
  closeDrawer();

  const world = store.getProject();
  const chat = store.openChat();
  const worldId = world.id, chatId = chat.id;
  const history = chat.turns.slice();
  const snapshot = new Map((world.docs || []).map((d) => [d.name, d.text]));

  /* His words go in at once, where he asked. */
  await store.updateWorld(worldId, (w) => {
    const c = w.chats.find((x) => x.id === chatId);
    if (!c) return null;
    c.turns = [...c.turns, forceWorker ? { role: 'writer', text, worker: forceWorker, at: Date.now() } : { role: 'writer', text, at: Date.now() }];
    c.updated = Date.now();
    if (c.turns.filter((t) => t.role === 'writer').length === 1 && /^(First conversation|A new conversation)$/.test(c.title)) {
      c.title = text.replace(/\s+/g, ' ').slice(0, 42) + (text.length > 42 ? '…' : '');
    }
    return w;
  });

  const abort = new AbortController();
  const bubble = el('div', 'turn maker');
  const who = names(personaOf(house));
  if (who.maker && who.maker !== 'you') bubble.append(el('div', 'who', who.maker));
  const inner = el('div', 'bubble');
  bubble.append(inner);
  const titled = (store.getProject().chats || []).find((c) => c.id === chatId);
  running = { worldId, chatId, chatTitle: (titled || chat).title, startedAt: Date.now(), abort, bubble };
  draw();
  setStatus('reading that');

  let reply = '', thinking = '', result;
  try {
    result = await runTurn({
      house, project: world, history, message: text, forceWorker,
      onStatus: setStatus,
      onText: (chunk) => { reply += chunk; inner.textContent = reply; clearStatus(); follow(); },
      onThinking: (chunk) => { thinking += chunk; },
      signal: abort.signal,
    });
  } catch (e) {
    result = { project: world, reply, cards: [], batches: [], error: (e && e.message) || String(e) };
  }

  clearStatus();
  const stoppedByHim = result.stopped || abort.signal.aborted;
  const words = result.reply || '';
  const makerTurn = {
    role: 'maker',
    text: words || (stoppedByHim ? '(stopped)' : result.error ? `That did not go through — ${result.error}`
      : thinking ? '(no words came back — only their thinking, kept below)' : '(no words came back)'),
    /* A note from the house is not something the maker said, and must never
     * be handed back to the model as its own words (Cozy Chat, app notes). */
    failed: !words,
    thinking,
    cards: (result.cards || []).filter((c) => c.status === 'refused' || c.reason || c.how),
    batches: result.batches || [],
    cut: Boolean(result.cut && words),
    at: Date.now(),
  };

  let landed = null;
  let where = { ok: false };
  try {
    where = await store.updateWorld(worldId, (w) => {
      landed = landTurn(w, { chatId, snapshot, result, makerTurn });
      capUndo(landed.world);
      return landed.world;
    });
  } catch (e) {
    toast(`The reply could not be put away: ${(e && e.message) || e}`);
  } finally {
    /* Whatever happens while landing, the room never stays "working". */
    running = null;
  }
  /* The world was not on screen when the reply was saved to the device — but
   * he may have opened it in the moment the save was in flight, and the copy
   * on screen would then lack the reply and write over it on its next save
   * (two hands on one world, Cozy Tavern M293-5). Land it there too; landing
   * is idempotent, so a copy that already has it is left exactly as it is. */
  if (where.ok && !where.open) {
    const now = store.getProject();
    if (now && now.id === worldId) {
      const again = landTurn(now, { chatId, snapshot, result, makerTurn });
      if (!again.already) { capUndo(again.world); await store.setProject(again.world, { now: true }); }
    }
  }
  if (where.error) toast(`The reply could not be put away: ${where.error}`);
  if (!where.ok && where.gone) toast('That world was deleted while the crew worked, so what they did was let go.');
  else if (landed && !landed.landed) toast('That conversation was deleted while the crew worked — the documents still got the changes.');
  draw();
  if (drawerIsOpen()) drawDrawer();
}

/* ---------------------------------------------------------------- pieces */

function setStatus(label) {
  if (!label) return clearStatus();
  if (!statusEl) {
    statusEl = el('div', 'status');
    statusEl.append(el('span', 'ember'));
    statusEl.append(el('span', 'label'));
  }
  statusEl.querySelector('.label').textContent = label;
  const p = store.getProject(), chat = store.openChat();
  if (running && p && chat && running.worldId === p.id && running.chatId === chat.id && !statusEl.isConnected) stream.append(statusEl);
  follow();
}
function clearStatus() { if (statusEl) { statusEl.remove(); statusEl = null; } }

boot().catch((e) => {
  document.body.innerHTML =
    `<div class="empty"><b>CozyMaker could not start</b>${escape(e.message || String(e))}<br><br>` +
    `Is the little server running? In Termux: <code>cozymaker</code></div>`;
});
