/* CozyMaker — js/ui/app.js
 * The room: the conversation, and everything the writer touches to get to it.
 */

import * as store from '../store.js';
import { runTurn } from '../agents/run.js';
import { onWork, setActiveProject, stopWork } from '../agents/call.js';
import { undoBatch } from '../doc/edits.js';
import { personaOf, names } from '../agents/persona.js';
import { $, el, escape, openSheet, closeSheet, toast, applyTheme, onRedraw } from './kit.js';
import { openDocs } from './docs.js';
import { openHouse } from './settings.js';
const stream = $('stream');
const say = $('say');
let sending = false;
let live = null;              /* the bubble being written into right now */
let statusEl = null;
let abort = null;

/* ------------------------------------------------------------------ boot */

async function boot() {
  const house = await store.loadHouse();
  applyTheme(house.settings.theme);

  const worlds = await store.listProjects();
  const want = store.lastOpenId();
  if (worlds.some((w) => w.id === want)) await store.openProject(want);
  else if (worlds.length) await store.openProject(worlds[0].id);
  else await store.createProject('A new world');

  setActiveProject(store.getProject().id);
  draw();
  wire();
}

function wire() {
  $('sendBtn').addEventListener('click', send);
  say.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });
  say.addEventListener('input', grow);
  $('docsBtn').addEventListener('click', () => openDocs());
  $('settingsBtn').addEventListener('click', () => openHouse());
  $('worldBtn').addEventListener('click', openWorlds);
  $('newWorldBtn').addEventListener('click', async () => {
    const title = prompt('What is this world called?', 'A new world');
    if (title === null) return;
    await store.flush();
    await store.createProject(title.trim() || 'A new world');
    setActiveProject(store.getProject().id);
    closeSheet('worldsSheet');
    draw();
  });
  for (const b of document.querySelectorAll('[data-close]')) {
    b.addEventListener('click', () => closeSheet(b.getAttribute('data-close')));
  }
  onWork((state) => { if (state.busy) setStatus(state.label); });
  store.watch(() => drawHeader());
  onRedraw(() => draw());
}

function grow() {
  say.style.height = 'auto';
  say.style.height = Math.min(say.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
}

/* ---------------------------------------------------------------- sheets */

async function openWorlds() {
  const body = $('worldsBody');
  const worlds = await store.listProjects();
  const openId = store.getProject() ? store.getProject().id : null;
  body.innerHTML = '';
  for (const w of worlds) {
    const row = el('div', 'row');
    const grow = el('div', 'grow');
    grow.innerHTML = `<b></b><small></small>`;
    grow.querySelector('b').textContent = w.title;
    grow.querySelector('small').textContent =
      `${w.docs.length} document${w.docs.length === 1 ? '' : 's'} · ${w.turns} said · ${when(w.updated)}`;
    grow.addEventListener('click', async () => {
      await store.flush();
      await store.openProject(w.id);
      setActiveProject(w.id);
      closeSheet('worldsSheet');
      draw();
    });
    row.append(grow);
    if (w.id === openId) row.append(el('span', 'pill', 'open'));
    const del = el('button', 'iconbtn', '✕');
    del.title = 'Delete this world';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${w.title}" and everything in it? A copy stays in the backups folder on the device.`)) return;
      await store.deleteProject(w.id);
      openWorlds();
      if (!store.getProject()) { await store.createProject('A new world'); setActiveProject(store.getProject().id); }
      draw();
    });
    row.append(del);
    body.append(row);
  }
  if (!worlds.length) body.innerHTML = '<p class="hint">Nothing here yet. Tap New to start one.</p>';
  openSheet('worldsSheet');
}

/* ---------------------------------------------------------------- drawing */

export function draw() {
  drawHeader();
  const p = store.getProject();
  stream.innerHTML = '';
  if (!p) return;
  const turns = p.turns || [];
  if (!turns.length) {
    const who = names(personaOf(store.getHouse()));
    stream.append(node('div', 'empty',
      `<b>${escape(p.title)}</b>Tell ${escape(who.maker === 'you' ? 'them' : who.maker)} about the world you want to build — the place, the people, the trouble. Or paste something you already have.`));
    return;
  }
  for (const t of turns) stream.append(turnNode(t));
  scrollDown();
}

function drawHeader() {
  const p = store.getProject();
  if (!p) return;
  $('worldName').textContent = p.title;
  const n = (p.docs || []).length;
  $('worldSub').textContent = n ? `${n} document${n === 1 ? '' : 's'}` : 'nothing written yet';
}

function turnNode(t) {
  const wrap = el('div', 'turn ' + (t.role === 'writer' ? 'writer' : 'maker'));
  if (t.role !== 'writer') {
    const who = names(personaOf(store.getHouse()));
    if (who.maker && who.maker !== 'you') wrap.append(el('div', 'who', who.maker));
  }
  const bubble = el('div', 'bubble');
  bubble.textContent = t.text || '';
  wrap.append(bubble);
  if (t.thinking) {
    const d = document.createElement('details');
    d.className = 'thinking';
    const s = document.createElement('summary');
    s.textContent = 'what they were turning over';
    d.append(s, document.createTextNode(t.thinking));
    wrap.append(d);
  }
  if (t.cards && t.cards.length) wrap.append(cardsNode(t));
  return wrap;
}

function cardsNode(t) {
  const box = el('div', 'cards');
  for (const c of t.cards) {
    const row = el('div', 'card' + (c.status === 'refused' ? ' refused' : ''));
    row.append(el('span', 'dot'));
    const text = el('span', 'grow');
    if (c.status === 'applied') {
      text.innerHTML = `<b>${escape(c.name)}</b> — ${escape(c.reason || c.how || 'changed')}`;
    } else {
      text.innerHTML = `<b>${escape(c.name || 'a change')}</b> — not done: ${escape(c.why || 'refused')}`;
    }
    row.append(text);
    box.append(row);
  }
  for (const b of t.batches || []) {
    const row = el('div', 'card');
    row.append(el('span', 'dot'));
    row.append(el('span', 'grow', b.undone ? 'put back' : `${b.items.length} document${b.items.length === 1 ? '' : 's'} changed`));
    if (!b.undone) {
      const u = el('button', 'undo', 'put it back');
      u.addEventListener('click', () => putBack(t, b));
      row.append(u);
    }
    box.append(row);
  }
  return box;
}

async function putBack(turn, batch) {
  const p = store.getProject();
  const docs = (p.docs || []).map((d) => ({ name: d.name, text: d.text }));
  const out = undoBatch(docs, batch);
  if (!out.ok) return toast(out.why);
  const next = { ...p, docs: (p.docs || []).slice() };
  for (const ch of out.changes) {
    if (ch.remove) next.docs = next.docs.filter((d) => d.name !== ch.name);
    else next.docs = next.docs.map((d) => (d.name === ch.name ? { ...d, text: ch.text } : d));
  }
  batch.undone = true;
  next.turns = (next.turns || []).map((t) => (t === turn ? { ...t } : t));
  await store.setProject(next, { now: true });
  draw();
  toast('put back');
}

/* ------------------------------------------------------------------ send */

async function send() {
  if (sending) { stopWork(store.getProject().id); if (abort) abort.abort(); return; }
  const text = say.value.trim();
  if (!text) return;
  const house = store.getHouse();
  if (!house.connections.length) { openHouse(); return toast('Set up a connection first — the house, then Connections.'); }

  say.value = ''; grow();
  sending = true;
  $('sendBtn').setAttribute('aria-label', 'Stop');

  let p = store.getProject();
  p = { ...p, turns: [...(p.turns || []), { role: 'writer', text, at: Date.now() }] };
  await store.setProject(p);
  draw();

  setStatus('reading that');
  live = el('div', 'turn maker');
  const who = names(personaOf(house));
  if (who.maker && who.maker !== 'you') live.append(el('div', 'who', who.maker));
  const bubble = el('div', 'bubble');
  live.append(bubble);
  stream.append(live);
  scrollDown();

  abort = new AbortController();
  let reply = '';
  let thinking = '';
  let result = null;
  try {
    result = await runTurn({
      house,
      project: store.getProject(),
      message: text,
      onStatus: setStatus,
      onText: (chunk) => { reply += chunk; bubble.textContent = reply; clearStatus(); scrollDown(); },
      onThinking: (chunk) => { thinking += chunk; },
      signal: abort.signal,
    });
  } catch (e) {
    result = { project: store.getProject(), reply, cards: [], batches: [], error: (e && e.message) || String(e) };
  }

  clearStatus();
  if (live && live.parentNode) live.remove();
  live = null;

  const next = { ...result.project };
  next.turns = [...(next.turns || []), {
    role: 'maker',
    text: result.reply || (result.error ? `That did not go through — ${result.error}` : ''),
    thinking: thinking || '',
    cards: (result.cards || []).filter((c) => c.status === 'refused' || c.reason || c.how),
    batches: result.batches || [],
    at: Date.now(),
  }];
  await store.setProject(next, { now: true });

  sending = false;
  abort = null;
  $('sendBtn').setAttribute('aria-label', 'Send');
  draw();
}

/* ---------------------------------------------------------------- pieces */

function setStatus(label) {
  if (!label) return clearStatus();
  if (!statusEl) {
    statusEl = el('div', 'status');
    statusEl.append(el('span', 'ember'));
    statusEl.append(el('span', 'label'));
    stream.append(statusEl);
  }
  statusEl.querySelector('.label').textContent = label;
  scrollDown();
}
function clearStatus() { if (statusEl) { statusEl.remove(); statusEl = null; } }

function scrollDown() { stream.scrollTop = stream.scrollHeight; }

function node(tag, cls, html) {
  const n = document.createElement(tag);
  n.className = cls; n.innerHTML = html;
  return n;
}
function when(ms) {
  if (!ms) return 'never opened';
  const d = Math.floor((Date.now() - ms) / 1000);
  if (d < 90) return 'just now';
  if (d < 3600) return Math.round(d / 60) + ' minutes ago';
  if (d < 86400) return Math.round(d / 3600) + ' hours ago';
  return Math.round(d / 86400) + ' days ago';
}

boot().catch((e) => {
  document.body.innerHTML =
    `<div class="empty"><b>CozyMaker could not start</b>${escape(e.message || String(e))}<br><br>` +
    `Is the little server running? In Termux: <code>cozymaker</code></div>`;
});
