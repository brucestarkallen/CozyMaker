/* CozyMaker — js/ui/app.js
 * The room: the conversation that is open, and the way into everything else. */

import * as store from '../store.js';
import { runTurn, capUndo, landTurn, commit, versionOf, FRONT_ONLY, GO_ON } from '../agents/run.js';
import { onWork, stopWork, onLearn } from '../agents/call.js';
import { undoBatch } from '../doc/edits.js';
import { personaOf, names } from '../agents/persona.js';
import { $, el, escape, closeSheet, toast, applyTheme, onRedraw, onAsk, fold, copyText } from './kit.js';
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
  /* What a model taught the house is kept on its connection (M350). */
  onLearn((id, learned) => {
    const h = store.getHouse();
    const c = (h.connections || []).find((x) => x.id === id);
    if (!c) return;
    c.learned = learned;
    store.saveHouse(h);
  });
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
/* HE OWNS THE SCROLL, measured before the page changes (the Plot Essential
 * Maker's rule). The flag the scroll event keeps is a frame late: a piece of
 * the reply landing in that frame found him still "pinned" and threw him back
 * to the bottom just after he had scrolled up. So each piece asks where he is
 * right now, before it is added, and follows only if he was at the bottom. */
function keepPlace(change) {
  const stay = pinned && nearBottom();
  change();
  if (stay) stream.scrollTop = stream.scrollHeight;
  else pinned = false;
}

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
  /* while another answer is being written, it stands where the old one was */
  const replacing = running && running.worldId === p.id && running.chatId === chat.id ? running.replaceAt : undefined;
  if (!turns.length) stream.append(emptyRoom(p));
  else turns.forEach((t, i) => { if (i !== replacing) stream.append(turnNode(t, i)); });
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

/* THE THINKING BOX, where a thinking box goes: above the reply, shut until
 * tapped, "Thinking… 7s" while the model thinks and "Thought for 12s" after
 * (SillyTavern's words; Cozy Tavern M40's clock, M105's copy). A plain button
 * opens it: native <details> did not open on his phone. */
function tookWords(ms) {
  const sec = Math.max(0, ms || 0) / 1000;
  return sec < 60 ? Math.round(sec) + 's' : Math.floor(sec / 60) + 'm ' + Math.round(sec % 60) + 's';
}
function thinkingBox(text, ms, { live = false } = {}) {
  const box = el('div', 'thinking-box');
  const head = el('button', 'thinking-head');
  head.type = 'button';
  const body = el('div', 'thinking-body');
  body.hidden = true;
  const words = el('div', 'thinking-text', text || '');
  const copy = el('button', 'btn quiet small', 'Copy the thinking');
  copy.addEventListener('click', (e) => { e.stopPropagation(); copyText(words.textContent); });
  body.append(words, copy);
  box.append(head, body);
  let label = live ? 'Thinking\u2026' : Number.isFinite(ms) && ms > 0 ? `Thought for ${tookWords(ms)}` : 'Thinking';
  const show = () => { head.textContent = (body.hidden ? '\u25b8 ' : '\u25be ') + label; };
  head.addEventListener('click', (e) => { e.stopPropagation(); body.hidden = !body.hidden; show(); });
  show();
  if (!live) return { node: box };
  const start = Date.now();
  let stopped = 0;
  const tick = setInterval(() => { label = `Thinking\u2026 ${tookWords(Date.now() - start)}`; show(); }, 1000);
  return {
    node: box,
    add(chunk) { words.textContent += chunk; },
    stop() {
      if (stopped) return stopped;
      clearInterval(tick);
      stopped = Math.max(1, Date.now() - start);
      label = `Thought for ${tookWords(stopped)}`;
      show();
      return stopped;
    },
  };
}

function turnNode(t, index) {
  const wrap = el('div', 'turn ' + (t.role === 'writer' ? 'writer' : 'maker'));
  const chat = store.openChat();
  const last = chat && index === chat.turns.length - 1;
  if (t.role !== 'writer') {
    const who = names(personaOf(store.getHouse()));
    if (who.maker && who.maker !== 'you') wrap.append(el('div', 'who', who.maker));
  }
  const bubble = el('div', 'bubble' + (t.failed ? ' failed' : ''));
  bubble.textContent = t.text || '';
  /* a tap on a message shows what can be done with it */
  bubble.addEventListener('click', () => { if (!running) wrap.classList.toggle('acting'); });
  if (t.thinking) wrap.append(thinkingBox(t.thinking, t.thinkingMs).node);
  wrap.append(bubble);
  if (t.cut) {
    wrap.append(el('div', 'cutnote', 'Cut off here — the reply ran out of room before it finished.'));
    if (last && !running) {
      const on = el('button', 'btn quiet small again', 'Go on');
      on.addEventListener('click', () => goOn(index));
      wrap.append(on);
    }
  }
  if (t.role === 'maker' && last && !t.failed) wrap.append(swipeBar(t, index));
  if ((t.cards && t.cards.length) || (t.batches && t.batches.length)) wrap.append(cardsNode(t, index));
  /* THE FINDABLE RETRY (Cozy Tavern M25): the last turn, failed or stopped
   * with nothing changed, goes again with his same words. */
  const before = chat && chat.turns[index - 1];
  if (last && t.failed && !(t.batches || []).length && before && before.role === 'writer' && !running) {
    const again = el('button', 'btn quiet small again', 'Try again');
    again.addEventListener('click', () => tryAgain(index));
    wrap.append(again);
  }
  wrap.append(actionsRow(t, index));
  return wrap;
}

/* The answers to one message, walked like SillyTavern's swipes. Only the one
 * shown is in the documents; stepping to another puts this one's changes back
 * and makes that one's again. "Another answer" writes a new one. */
function swipeBar(t, index) {
  const bar = el('div', 'swipes');
  const n = t.versions ? t.versions.length : 1;
  const k = t.versions ? t.shown : 0;
  if (n > 1) {
    const prev = el('button', 'iconbtn small', '\u25c2');
    prev.setAttribute('aria-label', 'The answer before this one'); prev.title = 'The answer before this one';
    prev.disabled = k === 0 || Boolean(running);
    prev.addEventListener('click', () => walkVersion(index, -1));
    const next = el('button', 'iconbtn small', '\u25b8');
    next.setAttribute('aria-label', 'The answer after this one'); next.title = 'The answer after this one';
    next.disabled = k === n - 1 || Boolean(running);
    next.addEventListener('click', () => walkVersion(index, 1));
    bar.append(prev, el('span', 'swipe-count', `${k + 1} / ${n}`), next);
  }
  const another = el('button', 'btn quiet small', 'Another answer');
  another.disabled = Boolean(running);
  another.addEventListener('click', () => anotherAnswer(index));
  bar.append(another);
  return bar;
}

function actionsRow(t, index) {
  const row = el('div', 'turn-actions');
  const add = (label, fn) => {
    const b = el('button', 'btn quiet small', label);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    row.append(b);
  };
  add('Copy', () => copyText(t.text || ''));
  add('Edit', () => startEdit(index));
  add('Branch here', () => branchHere(index));
  add('Delete', () => deleteTurn(index));
  return row;
}

function cardsNode(t, index) {
  const box = el('div', 'cards');
  for (const c of t.cards || []) {
    const row = el('div', 'card' + (c.status === 'refused' ? ' refused' : ''));
    row.append(el('span', 'dot'));
    const text = el('span', 'grow');
    if (c.status === 'applied') text.innerHTML = `<b>${escape(c.name)}</b> \u2014 ${escape(c.reason || c.how || 'changed')}`;
    else text.innerHTML = c.name ? `<b>${escape(c.name)}</b> \u2014 not done: ${escape(c.why || 'refused')}` : `Not done: ${escape(c.why || 'refused')}`;
    row.append(text);
    box.append(row);
    /* WHAT CHANGED, SEEN (the Plot Essential Maker's red/green cards; Cozy
     * Tavern M76: every card shows before and after). */
    if (c.status === 'applied' && (c.was || c.now)) {
      const diff = el('div', 'diff');
      if (c.was) diff.append(el('div', 'was', c.was));
      if (c.now) diff.append(el('div', 'now', c.now));
      box.append(fold('what changed', diff, { className: 'fold diff-fold' }));
    }
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

/* PUT CHANGES BACK, AS ONE STEP. Every undo in the room goes through here:
 * the listed turns' live changes, newest first, each against the documents as
 * they stand. The first one that cannot be put back (the documents changed
 * since) stops the whole step and nothing is changed — no half-undone state. */
function liveBatches(t) { return (t.batches || []).filter((b) => !b.undone); }

function putBackTurns(world, chatId, indices, onlyBatch = null) {
  let docs = (world.docs || []).map((d) => ({ ...d }));
  const chats = world.chats.map((c) => (c.id !== chatId ? c : { ...c, turns: c.turns.slice() }));
  const chat = chats.find((c) => c.id === chatId);
  const order = [...indices].sort((x, y) => y - x);
  for (const i of order) {
    const t = chat.turns[i];
    if (!t) continue;
    const live = liveBatches(t).filter((b) => !onlyBatch || b.id === onlyBatch).reverse();
    for (const batch of live) {
      if (batch.tooOld) return { ok: false, why: 'those changes are too old to put back' };
      const out = undoBatch(docs.map((d) => ({ name: d.name, text: d.text })), batch);
      if (!out.ok) return { ok: false, why: out.why };
      for (const ch of out.changes) {
        if (ch.remove) docs = docs.filter((d) => d.name !== ch.name);
        else docs = docs.map((d) => (d.name === ch.name ? { ...d, text: ch.text } : d));
      }
      chat.turns[i] = { ...chat.turns[i], batches: chat.turns[i].batches.map((b) => (b.id === batch.id ? { ...b, undone: true } : b)) };
    }
  }
  return { ok: true, world: { ...world, docs, chats } };
}

async function putBack(turnIndex, batchId) {
  const chat = store.openChat();
  const r = putBackTurns(store.getProject(), chat.id, [turnIndex], batchId);
  if (!r.ok) return toast(r.why);
  await store.setProject(r.world, { now: true });
  draw();
  toast('Put back.');
}

async function anotherAnswer(index) {
  if (running) return;
  const chat = store.openChat();
  const t = chat.turns[index];
  const writer = chat.turns[index - 1];
  if (!writer || writer.role !== 'writer') return toast('There is no message of yours before this one to answer again.');
  if (liveBatches(t).length) {
    const r = putBackTurns(store.getProject(), chat.id, [index]);
    if (!r.ok) return toast(`This answer's changes can't be put back first \u2014 ${r.why}.`);
    await store.setProject(r.world, { now: true });
  }
  send(writer.text, writer.worker || null, { from: index - 1, replaceAt: index });
}

async function walkVersion(index, dir) {
  if (running) return;
  const chat = store.openChat();
  const t = chat.turns[index];
  if (!t || !t.versions) return;
  const k = t.shown + dir;
  if (k < 0 || k >= t.versions.length) return;
  let world = store.getProject();
  if (liveBatches(t).length) {
    const r = putBackTurns(world, chat.id, [index]);
    if (!r.ok) return toast(`This answer's changes can't be put back first \u2014 ${r.why}.`);
    world = r.world;
  }
  const versions = t.versions.map((v, i) => (i === t.shown ? versionOf(t) : v));
  const target = versions[k];
  /* that answer's changes, made again in the order it made them */
  const batches = [];
  const remade = [];
  let refused = 0;
  for (const g of target.edits || []) {
    const c = commit(world, g.edits, g.label);
    world = c.project;
    remade.push(...c.cards);
    refused += c.cards.filter((x) => x.status === 'refused').length;
    if (c.batch) batches.push(c.batch);
  }
  /* when some of it no longer fits, the cards say what is in the documents
   * now, never what was true the first time */
  const turn = { ...t, ...target, cards: refused ? remade : target.cards, batches, versions, shown: k };
  const chats = world.chats.map((c) => (c.id !== chat.id ? c : { ...c, turns: c.turns.map((x, i) => (i === index ? turn : x)) }));
  const next = { ...world, chats };
  capUndo(next);
  await store.setProject(next, { now: true });
  draw();
  if (refused) toast(`${refused} of that answer's changes no longer fit the documents, so ${refused === 1 ? 'it was' : 'they were'} not made again.`);
}

function startEdit(index) {
  if (running) return;
  const chat = store.openChat();
  const t = chat.turns[index];
  const node = stream.querySelectorAll('.turn')[index];
  if (!t || !node) return;
  const area = document.createElement('textarea');
  area.className = 'edit-area';
  area.value = t.text || '';
  const row = el('div', 'btnrow');
  const saveB = el('button', 'btn small', 'Save');
  saveB.addEventListener('click', () => saveEdit(index, area.value));
  row.append(saveB);
  if (t.role === 'writer') {
    const resend = el('button', 'btn quiet small', 'Send again from here');
    resend.addEventListener('click', () => resendFrom(index, area.value));
    row.append(resend);
  }
  const cancel = el('button', 'btn quiet small', 'Cancel');
  cancel.addEventListener('click', () => draw());
  row.append(cancel);
  node.querySelector('.bubble').replaceWith(area);
  const acts = node.querySelector('.turn-actions');
  if (acts) acts.remove();
  node.append(row);
  area.focus();
}

async function saveEdit(index, text) {
  const p = store.getProject();
  const chat = store.openChat();
  const chats = p.chats.map((c) => (c.id !== chat.id ? c : {
    ...c,
    turns: c.turns.map((t, i) => {
      if (i !== index) return t;
      const next = { ...t, text };
      if (t.versions) next.versions = t.versions.map((v, j) => (j === t.shown ? { ...v, text } : v));
      return next;
    }),
  }));
  await store.setProject({ ...p, chats }, { now: true });
  draw();
}

async function resendFrom(index, text) {
  if (running) return;
  if (!text.trim()) return toast('There is nothing to send.');
  const chat = store.openChat();
  const later = chat.turns.map((t, i) => i).filter((i) => i > index && liveBatches(chat.turns[i]).length);
  let world = store.getProject();
  if (later.length) {
    /* the only safe way on: what those replies changed is put back first,
     * without asking (nothing he can choose here would be kept safely) */
    const r = putBackTurns(world, chat.id, later);
    if (!r.ok) return toast(`Those changes can't be put back \u2014 ${r.why}.`);
    world = r.world;
    toast('What the later replies changed was put back first.');
  }
  const writer = chat.turns[index];
  const chats = world.chats.map((c) => (c.id !== chat.id ? c : { ...c, turns: [...c.turns.slice(0, index), { ...writer, text, at: Date.now() }] }));
  await store.setProject({ ...world, chats }, { now: true });
  send(text, writer.worker || null, { from: index });
}

async function deleteTurn(index) {
  if (running) return;
  const chat = store.openChat();
  const t = chat.turns[index];
  if (!t) return;
  let world = store.getProject();
  if (liveBatches(t).length) {
    /* never keep changes whose way back has been thrown away */
    if (!confirm('This reply changed the documents. Put those changes back and delete it?')) return;
    const r = putBackTurns(world, chat.id, [index]);
    if (!r.ok) return toast(`Its changes can't be put back \u2014 ${r.why}.`);
    world = r.world;
  } else if (!confirm(t.role === 'writer' ? 'Delete this message of yours?' : 'Delete this reply?')) return;
  const chats = world.chats.map((c) => (c.id !== chat.id ? c : { ...c, turns: c.turns.filter((x, i) => i !== index) }));
  await store.setProject({ ...world, chats }, { now: true });
  draw();
}

async function branchHere(index) {
  if (running) return;
  const chat = store.openChat();
  /* The talk up to here, in a new conversation. The documents are the
   * world's, shared; the way back for each change stays with the
   * conversation that made it, so nothing can be put back twice. */
  const turns = chat.turns.slice(0, index + 1).map((t) => (t.role !== 'maker' ? { ...t } : {
    ...t, batches: [], versions: t.versions ? t.versions.map((v) => ({ ...v, batches: [] })) : undefined,
  }));
  await store.newChatWith(`${chat.title} \u2014 branch`, turns);
  draw();
  if (drawerIsOpen()) drawDrawer();
  toast('A new conversation from here. The documents are shared with the one it came from.');
}

function goOn(index) {
  send(GO_ON, FRONT_ONLY, { continueAt: index });
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

/* One way in for every kind of asking: a new message (the default), his
 * message sent again from where it stands (from), another answer to it
 * (from + replaceAt), or the rest of a reply that was cut off (continueAt). */
async function send(text, forceWorker, opts = {}) {
  if (running) { toast('The crew is still working \u2014 this can go when they are done.'); return; }
  const house = store.getHouse();
  if (!house.connections.length) { openHouse(); toast('Set up a connection first \u2014 in the house, under Connections.'); return; }
  closeDrawer();

  const world = store.getProject();
  const chat = store.openChat();
  const worldId = world.id, chatId = chat.id;
  const fresh = opts.from === undefined && opts.continueAt === undefined;
  const history = opts.continueAt !== undefined ? chat.turns.slice(0, opts.continueAt + 1)
    : opts.from !== undefined ? chat.turns.slice(0, opts.from) : chat.turns.slice();
  const snapshot = new Map((world.docs || []).map((d) => [d.name, d.text]));

  if (fresh) {
    /* His words go in at once, where he asked. */
    await store.updateWorld(worldId, (w) => {
      const c = w.chats.find((x) => x.id === chatId);
      if (!c) return null;
      c.turns = [...c.turns, forceWorker ? { role: 'writer', text, worker: forceWorker, at: Date.now() } : { role: 'writer', text, at: Date.now() }];
      c.updated = Date.now();
      if (c.turns.filter((t) => t.role === 'writer').length === 1 && /^(First conversation|A new conversation)$/.test(c.title)) {
        c.title = text.replace(/\s+/g, ' ').slice(0, 42) + (text.length > 42 ? '\u2026' : '');
      }
      return w;
    });
  }

  const abort = new AbortController();
  const bubble = el('div', 'turn maker');
  const who = names(personaOf(house));
  if (who.maker && who.maker !== 'you') bubble.append(el('div', 'who', who.maker));
  const inner = el('div', 'bubble');
  bubble.append(inner);
  let liveThinking = null;
  let thinkingMs = 0;
  const thoughtDone = () => { if (liveThinking && !thinkingMs) thinkingMs = liveThinking.stop(); };
  const titled = (store.getProject().chats || []).find((c) => c.id === chatId);
  running = { worldId, chatId, chatTitle: (titled || chat).title, startedAt: Date.now(), abort, bubble, replaceAt: opts.replaceAt };
  draw();
  setStatus('reading that');

  let reply = '', thinking = '', result;
  try {
    result = await runTurn({
      house, project: store.getProject(), history, message: text, forceWorker,
      onStatus: setStatus,
      onText: (chunk) => { thoughtDone(); keepPlace(() => { reply += chunk; inner.textContent = reply; clearStatus(); }); },
      onThinking: (chunk) => {
        thinking += chunk;
        keepPlace(() => {
          if (!liveThinking) { liveThinking = thinkingBox('', 0, { live: true }); bubble.insertBefore(liveThinking.node, inner); clearStatus(); }
          liveThinking.add(chunk);
        });
      },
      signal: abort.signal,
    });
  } catch (e) {
    result = { project: store.getProject(), reply, cards: [], batches: [], edits: [], error: (e && e.message) || String(e) };
  }

  clearStatus();
  const stoppedByHim = result.stopped || abort.signal.aborted;
  const words = result.reply || '';
  const makerTurn = {
    role: 'maker',
    text: words || (stoppedByHim ? '(stopped)' : result.error ? `That did not go through \u2014 ${result.error}`
      : thinking ? '(no words came back \u2014 only their thinking, kept below)' : '(no words came back)'),
    failed: !words,
    thinking,
    thinkingMs: (thoughtDone(), thinkingMs) || undefined,
    cards: (result.cards || []).filter((c) => c.status === 'refused' || c.reason || c.how),
    batches: result.batches || [],
    edits: result.edits || [],
    cut: Boolean(result.cut && words),
    at: Date.now(),
  };

  let landed = null;
  let where = { ok: false };
  const land = (w) => {
    if (opts.continueAt !== undefined) {
      /* the rest of a cut-off reply joins it; nothing else changes */
      const c = w.chats.find((x) => x.id === chatId);
      const t = c && c.turns[opts.continueAt];
      if (!t || !words) return null;
      const joined = t.text + (/\s$/.test(t.text) || /^\s/.test(words) ? '' : ' ') + words;
      c.turns = c.turns.map((x, i) => (i !== opts.continueAt ? x : {
        ...x, text: joined, cut: makerTurn.cut, thinking: [x.thinking, thinking].filter(Boolean).join('\n\n'),
        thinkingMs: ((x.thinkingMs || 0) + (makerTurn.thinkingMs || 0)) || undefined,
        versions: x.versions ? x.versions.map((v, j) => (j === x.shown ? { ...v, text: joined, cut: makerTurn.cut } : v)) : undefined,
      }));
      c.updated = Date.now();
      landed = { landed: true };
      return w;
    }
    landed = landTurn(w, { chatId, snapshot, result, makerTurn, replaceAt: opts.replaceAt === undefined ? null : opts.replaceAt });
    capUndo(landed.world);
    return landed.world;
  };
  try {
    where = await store.updateWorld(worldId, land);
  } catch (e) {
    toast(`The reply could not be put away: ${(e && e.message) || e}`);
  } finally {
    /* Whatever happens while landing, the room never stays "working". */
    running = null;
  }
  /* The world was not on screen when the reply was saved to the device, but
   * he may have opened it while the save was in flight: land it there too.
   * Landing is idempotent, so a copy that already has it is left alone. */
  if (where.ok && !where.open && opts.continueAt === undefined) {
    const now = store.getProject();
    if (now && now.id === worldId) {
      const again = landTurn(now, { chatId, snapshot, result, makerTurn, replaceAt: opts.replaceAt === undefined ? null : opts.replaceAt });
      if (!again.already) { capUndo(again.world); await store.setProject(again.world, { now: true }); }
    }
  }
  if (opts.continueAt !== undefined && !words) {
    /* nothing arrived to join the reply: say why, never vanish */
    toast(result.error ? `That did not go through \u2014 ${result.error}` : stoppedByHim ? 'Stopped.' : 'Nothing more came back.');
  }
  if (where.error) toast(`The reply could not be put away: ${where.error}`);
  if (!where.ok && where.gone) toast('That world was deleted while the crew worked, so what they did was let go.');
  else if (landed && !landed.landed) toast('That conversation was deleted while the crew worked \u2014 the documents still got the changes.');
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
  const p = store.getProject(), chat = store.openChat();
  keepPlace(() => {
    statusEl.querySelector('.label').textContent = label;
    if (running && p && chat && running.worldId === p.id && running.chatId === chat.id && !statusEl.isConnected) stream.append(statusEl);
  });
}
function clearStatus() { if (statusEl) { statusEl.remove(); statusEl = null; } }

boot().catch((e) => {
  document.body.innerHTML =
    `<div class="empty"><b>CozyMaker could not start</b>${escape(e.message || String(e))}<br><br>` +
    `Is the little server running? In Termux: <code>cozymaker</code></div>`;
});
