/* CozyMaker — js/ui/app.js
 * The room: the conversation that is open, and the way into everything else. */

import * as store from '../store.js';
import { runTurn, capUndo, landTurn, commit, versionOf, FRONT_ONLY, GO_ON } from '../agents/run.js';
import { isNewStory, houseCommand } from '../agents/router.js';
import { stopWork, onLearn } from '../agents/call.js';
import { undoBatch } from '../doc/edits.js';
import { rollBackTo } from '../doc/branch.js';
import { DEFAULT_WORLD_TITLE, hasPlotEssential, hasWorldbook } from '../doc/index.js';
import { personaOf, names } from '../agents/persona.js';
import { $, el, escape, closeSheet, toast, applyTheme, onRedraw, onAsk, fold, copyText } from './kit.js';
import { openDocs, openDoc, tidyOnLeaving, currentDocId, bringIn, startChoices } from './docs.js';
import { openHouse } from './settings.js';
import { openDrawer, closeDrawer, drawerIsOpen, wireSwipe, setBusyCheck, draw as drawDrawer } from './drawer.js';
import { streamText } from './streamtext.js';
import { revealCount, takeChars } from './pace.js';

const stream = $('stream');
const say = $('say');
const sendBtn = $('sendBtn');

/* The one turn in flight, if any: which world and which conversation asked. */
let running = null;       /* { worldId, chatId, startedAt, abort } */
let statusEl = null;
const SEND_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
/* how long the last words of a finished reply may take to be drawn at their own pace */
const SETTLE_MS = 400;
const STOP_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>';

/* ------------------------------------------------------------------ boot */

async function boot() {
  const house = await store.loadHouse();
  applyTheme(house.settings.theme);
  const worlds = await store.listProjects();
  const want = store.lastOpenId();
  if (worlds.some((w) => w.id === want)) await store.openProject(want);
  else if (worlds.length) await store.openProject(worlds[0].id);
  else await store.createProject(DEFAULT_WORLD_TITLE);
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
  /* The turn says what the crew is doing, in words ("the builder is on it"). The
   * channel's own announcement carries only a worker's id, and used to land a
   * moment later and write "builder" or "listener" over those words. */
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
  /* a redraw while a reply is being written takes its bubble out and puts it
   * back, and a box taken out of the page forgets where it was scrolled: the
   * live thinking would jump to its top and stop following. Its place is kept. */
  const liveBox = running && running.bubble ? running.bubble.querySelector('.thinking-text') : null;
  const liveAt = liveBox && liveBox.isConnected ? { follow: liveBox.scrollHeight - liveBox.scrollTop - liveBox.clientHeight < 24, top: liveBox.scrollTop } : null;
  stream.innerHTML = '';
  if (!p || !chat) return;
  const turns = chat.turns || [];
  /* while another answer is being written, it stands where the old one was */
  const replacing = running && running.worldId === p.id && running.chatId === chat.id ? running.replaceAt : undefined;
  if (!turns.length) stream.append(emptyRoom(p));
  else turns.forEach((t, i) => { if (i !== replacing) stream.append(turnNode(t, i)); });
  if (running && running.worldId === p.id && running.chatId === chat.id && running.bubble) {
    stream.append(running.bubble);
    /* back on screen after he walked away and back, it follows its own end again */
    if (liveBox && liveBox.isConnected) liveBox.scrollTop = !liveAt || liveAt.follow ? liveBox.scrollHeight : liveAt.top;
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
  if (!hasPlotEssential(p.docs)) {
    /* this room goes once he speaks, so it says where the buttons stay; which
     * ways to start are offered is the one answer docs.js startChoices gives */
    box.append(el('p', '', hasWorldbook(p.docs)
      ? `The worldbook is in The documents. Talk the world through with ${them} \u2014 nothing is written until you ask. To make a plot essential too, say \u201cbuild it\u201d or tap Start a plot essential (it stays in The documents), and it's built from everything you said and the worldbook.`
      : `Talk the world through with ${them} \u2014 the place, the people, the trouble. Nothing is written until you ask. When you're ready, tap Start a plot essential or Start a worldbook, whichever you're making (both stay in The documents), and it's built from everything you said; saying \u201cbuild it\u201d starts a plot essential. Or import one you already have, or build one from a story card you found on Isekai Zero, AI Dungeon or the like.`));
    const row = el('div', 'btnrow center');
    for (const c of startChoices(p.docs)) {
      const b = el('button', c.main ? 'btn' : 'btn quiet', c.label);
      b.addEventListener('click', () => c.run());
      row.append(b);
    }
    const bring = el('button', 'btn quiet', 'Import');
    bring.addEventListener('click', bringIn);
    row.append(bring);
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

/* THE THINKING BOX, where a thinking box goes: above the reply. A finished one
 * is shut until tapped and says "Thought for 12s" (SillyTavern's words; Cozy
 * Tavern M40's clock, M105's copy). A plain button opens it: native <details>
 * did not open on his phone.
 *
 * A LIVE ONE IS OPEN WHILE THE MODEL THINKS (Cozy Tavern's own: its box opens at
 * the first thought and folds at the first word of the page). It used to be shut
 * while live too, so the first thing he saw move was the reply — the stream
 * never started at the thinking unless he tapped. It is drawn line by line
 * (streamtext.js), from its first word, says "Thinking… 7s" while it runs, and
 * folds itself shut when the reply's words reach the screen. A tap still opens
 * or shuts it whenever he likes; Copy takes everything thought so far. */
function tookWords(ms) {
  const sec = Math.max(0, ms || 0) / 1000;
  return sec < 60 ? Math.round(sec) + 's' : Math.floor(sec / 60) + 'm ' + Math.round(sec % 60) + 's';
}
function thinkingBox(text, ms, { live = false, since = 0, source = null } = {}) {
  const box = el('div', 'thinking-box');
  const head = el('button', 'thinking-head');
  head.type = 'button';
  const body = el('div', 'thinking-body');
  body.hidden = !live;
  const words = el('div', 'thinking-text', live ? undefined : (text || ''));
  const copy = el('button', 'btn quiet small', 'Copy the thinking');
  copy.addEventListener('click', (e) => { e.stopPropagation(); copyText(source ? source() : words.textContent); });
  body.append(words, copy);
  box.append(head, body);
  let label = live ? 'Thinking\u2026' : Number.isFinite(ms) && ms > 0 ? `Thought for ${tookWords(ms)}` : 'Thinking';
  const show = () => { head.textContent = (body.hidden ? '\u25b8 ' : '\u25be ') + label; };
  head.addEventListener('click', (e) => { e.stopPropagation(); body.hidden = !body.hidden; show(); });
  show();
  if (!live) return { node: box };
  /* a reply started early arrives with the moment its thinking really began,
   * so the box says how long the model truly thought */
  const start = since > 0 ? since : Date.now();
  let stopped = 0;
  const tick = setInterval(() => { if (!stopped) { label = `Thinking\u2026 ${tookWords(Date.now() - start)}`; show(); } }, 1000);
  return {
    node: box,
    words,
    stop(at = 0) {
      if (stopped) return stopped;
      clearInterval(tick);
      stopped = Math.max(1, (at > 0 ? at : Date.now()) - start);
      label = `Thought for ${tookWords(stopped)}`;
      show();
      return stopped;
    },
    fold() { body.hidden = true; show(); },
    quiet() { clearInterval(tick); },
  };
}

/* THE REPLY WHILE IT IS BEING WRITTEN.
 *
 * Every piece used to be drawn the moment it came: the whole reply written back
 * over itself (textContent = reply), the whole thinking read and rewritten
 * (textContent += piece), and the scroll measured and set — per piece, so each
 * cost more than the last and a long thinking froze the phone (Cozy Tavern's
 * M269 fault: there, a five-second stream took 158 seconds to show). Now a piece
 * only joins a string. Once a frame, what has come is drawn: the thinking line
 * by line, the words added at the end as new text, and the scroll measured once,
 * BEFORE the change — he owns the scroll (keepPlace's rule, kept).
 *
 * Smooth streaming (the house's setting, on unless he turns it off) draws what
 * has arrived a share at a time (pace.js), so a clump of words from the provider
 * flows in over the next moment instead of landing at once; off, everything
 * that has come is drawn each frame.
 *
 * The thinking's clock starts at the first thought and stops when the first
 * word ARRIVES — how long the model really thought — and the box folds when that
 * word is DRAWN. letGo() takes back everything a reply started early showed,
 * when the crew is sent after all and that reply will never be written. */
function liveTurn(turn, inner) {
  let thinkAll = '';
  let thinkQueue = '';
  let wordsAll = '';
  let wordQueue = '';
  let box = null;
  let lines = null;
  let since = 0;
  let thoughtMs = 0;
  let wordsShown = false;
  let shown = false;
  let frame = 0;
  let lastFrame = 0;
  let ended = false;
  const settlers = [];
  const smooth = () => ((store.getHouse() || {}).settings || {}).smoothStreaming !== 'off';
  const nextFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(performance.now()), 16));
  const schedule = () => { if (!frame && !ended) frame = nextFrame(paint); };
  const settled = () => { if (thinkQueue || wordQueue) return; for (const r of settlers.splice(0)) r(); };
  function paint(now) {
    frame = 0;
    if (ended) return;
    const t = Number.isFinite(now) ? now : performance.now();
    const dt = lastFrame ? t - lastFrame : 16;
    lastFrame = t;
    const pace = smooth();
    /* the scroll is his, and only the conversation on screen is touched: a reply
     * still being written in a world he has walked out of never moves the one he
     * is reading */
    const onScreen = turn.isConnected;
    const stay = onScreen && pinned && nearBottom();
    if (thinkQueue && !wordsShown) {
      if (!box) {
        box = thinkingBox('', 0, { live: true, since, source: () => thinkAll });
        turn.insertBefore(box.node, inner);
        lines = streamText(box.words);
        if (thoughtMs) box.stop(since + thoughtMs);
      }
      const part = pace ? takeChars(thinkQueue, revealCount(thinkQueue.length, dt)) : thinkQueue;
      lines.append(part);
      thinkQueue = thinkQueue.slice(part.length);
      if (!shown) { shown = true; clearWaiting(); }
    }
    if (wordQueue) {
      if (!wordsShown) {
        wordsShown = true;
        /* the reply has begun: what is left of the thinking goes in at once, and the box shuts */
        if (box) { if (thinkQueue) lines.append(thinkQueue); thinkQueue = ''; box.fold(); }
        shown = true;
        clearStatus();
      }
      const part = pace ? takeChars(wordQueue, revealCount(wordQueue.length, dt)) : wordQueue;
      inner.append(document.createTextNode(part));
      wordQueue = wordQueue.slice(part.length);
    }
    if (stay) stream.scrollTop = stream.scrollHeight;
    else if (onScreen) pinned = false;
    if (thinkQueue || wordQueue) schedule();
    else { lastFrame = 0; settled(); }
  }
  const stopClock = (at = 0) => {
    if (!since || thoughtMs) return;
    thoughtMs = Math.max(1, (at > 0 ? at : Date.now()) - since);
    if (box) box.stop(since + thoughtMs);
  };
  return {
    thinking(chunk, at = 0) {
      if (!chunk || ended) return;
      if (!since) since = at > 0 ? at : Date.now();
      thinkAll += chunk;
      if (wordsShown) { if (lines) lines.append(chunk); return; }
      thinkQueue += chunk;
      schedule();
    },
    text(chunk, at = 0) {
      if (!chunk || ended) return;
      stopClock(at);
      wordsAll += chunk;
      wordQueue += chunk;
      schedule();
    },
    /* the reply this belonged to will not be written: everything it showed goes */
    letGo() {
      if (box) { box.quiet(); box.node.remove(); }
      box = null; lines = null;
      thinkAll = ''; thinkQueue = ''; since = 0; thoughtMs = 0;
      wordsAll = ''; wordQueue = ''; wordsShown = false;
      inner.textContent = '';
      shown = false;
      settled();
    },
    /* the last of it drawn at the pace it was coming, for at most `ms` */
    settle(ms) {
      if (!thinkQueue && !wordQueue) return Promise.resolve();
      return new Promise((resolve) => { settlers.push(resolve); setTimeout(resolve, ms); });
    },
    stopClock,
    /* the stream is over: no more frames, and the clock stops where it stands */
    end() {
      stopClock();
      ended = true;
      if (frame) { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame); frame = 0; }
      if (box) box.quiet();
      for (const r of settlers.splice(0)) r();
    },
    get shown() { return shown; },
    get thought() { return thinkAll; },
    get thinkingMs() { return thoughtMs; },
    get reply() { return wordsAll; },
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
    wrap.append(el('div', 'cutnote', t.cutBy === 'provider'
      ? 'Cut off here \u2014 the provider stopped partway, before it finished.'
      : 'Cut off here \u2014 the reply ran out of room before it finished.'));
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
  /* SEVERAL CHANGES THAT DID NOT GO IN ARE ONE LINE. Four identical orange
   * "not done: those words are not in the document as written" cards told him
   * nothing four times; the reasons are one tap away */
  const refused = (t.cards || []).filter((c) => c.status === 'refused');
  if (refused.length > 1) {
    const row = el('div', 'card refused');
    row.append(el('span', 'dot'));
    row.append(el('span', 'grow', `${refused.length} changes did not go in`));
    box.append(row);
    box.append(fold('why', el('div', 'diff', refused.map((c) => `${c.name ? c.name + ' \u2014 ' : ''}${c.why || 'refused'}`).join('\n')), { className: 'fold diff-fold' }));
  }
  for (const c of (t.cards || []).filter((x) => x.status !== 'refused' || refused.length === 1)) {
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
        else if (ch.add) docs = [...docs, { id: store.docId(), name: ch.name, kind: ch.kind || 'pe', text: ch.text || '' }];
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
    const c = commit(world, g.edits, g.label, g.maker || null);
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

/* BRANCH HERE: A WORLD OF ITS OWN. It used to make a new conversation that
 * shared the world's documents — so whatever the branch changed, the original
 * lost, and nothing rolled back. Now the branch is a world beside the original:
 * the talk up to this message, and its OWN documents, as they stood right
 * after it — every change made since put back on the copy (doc/branch.js),
 * never on the original, which is left exactly as it is. Rolling an update
 * back is branching from the message before it. */
async function branchHere(index) {
  if (running) return;
  await store.flush();
  const world = store.getProject();
  const chat = store.openChat();
  const t = chat.turns[index];
  if (!t) return;
  const back = rollBackTo(world, t.at || 0);
  const docs = (back.ok ? back.docs : world.docs || []).map((d) => ({ ...d, id: store.docId() }));
  const turns = chat.turns.slice(0, index + 1).map((x) => ({ ...x }));
  await store.createProject(`${world.title} \u2014 branch`);
  const fresh = store.getProject();
  const talk = { ...fresh.chats[0], title: chat.title, turns, updated: Date.now() };
  await store.setProject({ ...fresh, docs, chats: [talk], openChat: talk.id, recentSections: world.recentSections || [] }, { now: true });
  draw();
  if (drawerIsOpen()) drawDrawer();
  toast(back.ok
    ? `A branch of \u201c${world.title}\u201d from that message \u2014 its own documents, as they stood then. The original is untouched.`
    : `A branch of \u201c${world.title}\u201d from that message \u2014 its own documents, as they stand now (${back.why}). The original is untouched.`);
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
  if (atOnce(text)) return;
  send(text, null);
}

/* THE CRAFT'S COMMANDS FOR A CHAT WINDOW, AS THEY ARE HERE (router.js houseCommand).
 * They used to be sent to the eye, which was never told what they mean. The plot
 * essential here is a document, always whole, so: *show_full_file opens it; *next
 * is the rest of a reply that was cut off, the same as Go on; and nothing is ever
 * hidden, which the spoiler pair says. *regress goes through the turn: the house
 * keeps the entry itself (run.js). */
function atOnce(text) {
  const c = houseCommand(text);
  if (!c || c.what === 'regress') return false;
  const p = store.getProject() || {};
  if (c.what === 'show_full_file') {
    const pe = (p.docs || []).find((d) => (d.kind || 'pe') === 'pe' && String(d.text || '').trim());
    if (pe) openDoc(pe.id);
    else toast('There is no plot essential yet, so there is nothing to show.');
    return true;
  }
  if (c.what === 'next') {
    const chat = store.openChat();
    const turns = (chat && chat.turns) || [];
    const last = turns[turns.length - 1];
    if (last && last.role === 'maker' && last.cut && !last.failed) goOn(turns.length - 1);
    else toast('Nothing was cut off, so there is no second part \u2014 every answer here arrives whole.');
    return true;
  }
  toast('Nothing here is hidden: The documents show every word of the plot essential, and so does what you copy or export.');
  return true;
}

/* One way in for every kind of asking: a new message (the default), his
 * message sent again from where it stands (from), another answer to it
 * (from + replaceAt), or the rest of a reply that was cut off (continueAt). */
async function send(text, forceWorker, opts = {}) {
  if (running) { toast('The crew is still working \u2014 this can go when they are done.'); return; }
  const house = store.getHouse();
  if (!house.connections.length) { openHouse(); toast('Set up a connection first \u2014 in the house, under Connections.'); return; }
  closeDrawer();
  /* A NEW STORY GETS A WORLD OF ITS OWN — a story card, or *new, *source_new,
   * *hybrid_new typed in a world that already has a plot essential: built there,
   * it would be written over that one. */
  if (opts.from === undefined && opts.continueAt === undefined && isNewStory(text) && hasPlotEssential((store.getProject() || {}).docs)) {
    await store.flush();
    await store.createProject(DEFAULT_WORLD_TITLE);
    toast('A new story gets a world of its own \u2014 this one is new, and takes its plot essential\u2019s name once it is built.');
  }

  const world = store.getProject();
  const chat = store.openChat();
  const worldId = world.id, chatId = chat.id;
  const fresh = opts.from === undefined && opts.continueAt === undefined;
  const history = opts.continueAt !== undefined ? chat.turns.slice(0, opts.continueAt + 1)
    : opts.from !== undefined ? chat.turns.slice(0, opts.from) : chat.turns.slice();
  const snapshot = new Map((world.docs || []).map((d) => [d.name, d.text]));

  const saidAt = Date.now();
  if (fresh) {
    /* His words go in at once, where he asked. */
    await store.updateWorld(worldId, (w) => {
      const c = w.chats.find((x) => x.id === chatId);
      if (!c) return null;
      c.turns = [...c.turns, forceWorker ? { role: 'writer', text, worker: forceWorker, at: saidAt } : { role: 'writer', text, at: saidAt }];
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
  const live = liveTurn(bubble, inner);
  const titled = (store.getProject().chats || []).find((c) => c.id === chatId);
  running = { worldId, chatId, chatTitle: (titled || chat).title, startedAt: Date.now(), abort, bubble, replaceAt: opts.replaceAt };
  draw();
  setStatus('reading that');

  let result;
  try {
    result = await runTurn({
      house, project: store.getProject(), history, message: text, forceWorker,
      /* the house's work said in words; when it is done and nothing of the reply
       * is on screen yet, the ember alone breathes until the first piece comes */
      onStatus: (label, detail) => (label ? setStatus(label, detail) : live.shown ? clearStatus() : setWaiting()),
      onText: (chunk, at) => live.text(chunk, at),
      onThinking: (chunk, at) => live.thinking(chunk, at),
      /* the early reply was let go: its thinking goes; while nothing says what the
       * house is doing (a retry after a passing failure), the ember stays */
      onLetGo: () => { live.letGo(); if (!statusLabel) setWaiting(); },
      signal: abort.signal,
    });
  } catch (e) {
    result = { project: store.getProject(), reply: live.reply, cards: [], batches: [], edits: [], error: (e && e.message) || String(e) };
  }
  /* the stream is over: the clock stops where it stands, and the last words are
   * drawn at the pace they were coming — briefly, never holding a stop or a failure */
  live.stopClock();
  if (!result.error && !result.stopped && !abort.signal.aborted && !result.newStory) await live.settle(SETTLE_MS);
  const thinking = live.thought;
  const thinkingMs = live.thinkingMs;
  live.end();

  clearStatus();
  /* A DIFFERENT STORY, ASKED FOR IN PLAIN WORDS IN A WORLD THAT HAS ONE (run.js): it
   * gets a world of its own, as *new and a card do. His words leave this world —
   * nothing of it changed — and go to the new one with the talk that led to them
   * (plain words only: the changes in it belong to this world), where they are
   * read again: talk starts a brainstorm there, an ask to build starts a build. */
  if (result && result.newStory && fresh) {
    running = null;
    const before = history.map((t) => ({ role: t.role, text: t.text || '', at: t.at }));
    const left = await store.updateWorld(worldId, (w) => {
      const c = w.chats.find((x) => x.id === chatId);
      if (!c) return null;
      c.turns = c.turns.filter((t) => !(t.role === 'writer' && t.at === saidAt));
      return w;
    });
    if (!left.ok) { toast('That could not be moved to a new world, so nothing was done.'); draw(); return; }
    await store.flush();
    await store.createProject(DEFAULT_WORLD_TITLE);
    if (before.length) {
      const fresh2 = store.getProject();
      const first = { ...fresh2.chats[0], title: `From ${world.title}`, turns: before, updated: Date.now() };
      await store.setProject({ ...fresh2, chats: [first], openChat: first.id }, { now: true });
    }
    toast('A new story gets a world of its own \u2014 the talk came along, and the world you were in is left as it was.');
    draw();
    if (drawerIsOpen()) drawDrawer();
    return send(text, null);
  }
  const stoppedByHim = result.stopped || abort.signal.aborted;
  const words = result.reply || '';
  const makerTurn = {
    role: 'maker',
    text: words || (stoppedByHim ? '(stopped)' : result.error ? `That did not go through \u2014 ${result.error}`
      : thinking ? '(no words came back \u2014 only their thinking, kept below)' : '(no words came back)'),
    failed: !words,
    /* a thought the reader moved off the words once they were all in is kept too */
    thinking: (result.thinking || '').length > thinking.length ? result.thinking : thinking,
    thinkingMs: thinkingMs || undefined,
    cards: (result.cards || []).filter((c) => c.status === 'refused' || c.reason || c.how),
    batches: result.batches || [],
    edits: result.edits || [],
    asks: result.asks || [],
    cut: Boolean(result.cut && words),
    cutBy: result.cut && words ? (result.cutBy || 'length') : '',
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
        ...x, text: joined, cut: makerTurn.cut, cutBy: makerTurn.cutBy, thinking: [x.thinking, thinking].filter(Boolean).join('\n\n'),
        thinkingMs: ((x.thinkingMs || 0) + (makerTurn.thinkingMs || 0)) || undefined,
        versions: x.versions ? x.versions.map((v, j) => (j === x.shown ? { ...v, text: joined, cut: makerTurn.cut, cutBy: makerTurn.cutBy } : v)) : undefined,
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

/* A LONG JOB SHOWS IT IS STILL GOING. A whole plot essential takes minutes on
 * a real provider; past a few seconds the line says how long it has run, so a
 * job that is working never looks like one that froze. */
let statusLabel = '';
let statusDetail = '';
let statusSince = 0;
let statusTick = null;
/* who is on what, how far along (a streamed answer's words so far), and past
 * fifteen seconds how long it has run — the clock belongs to the label, so a
 * word count arriving never starts it again */
function statusWords() {
  const s = Math.floor((Date.now() - statusSince) / 1000);
  const bits = statusLabel ? [statusLabel] : [];
  if (statusDetail) bits.push(statusDetail);
  if (s >= 15) bits.push(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  return bits.join(' \u00b7 ');
}
/* NOTHING ON SCREEN MOVING IS NOT ALLOWED WHILE A TURN RUNS. When the crew is
 * done, the line that said what they were doing used to go at once, and until
 * the reply's first piece came nothing moved at all — on a provider that thinks
 * without sending its thinking, for the whole of its think. Now the ember stays,
 * with no words (past fifteen seconds, how long it has been), until the first
 * thought or word is on screen. */
let waiting = false;
function setWaiting() {
  if (!running) return clearStatus();
  if (!waiting) { clearStatus(); waiting = true; statusSince = Date.now(); }
  setStatus('', '', true);
}
function clearWaiting() { if (waiting) clearStatus(); }
function setStatus(label, detail = '', quiet = false) {
  if (!label && !quiet) return clearStatus();
  if (label) waiting = false;
  if (!statusEl) {
    statusEl = el('div', 'status');
    statusEl.append(el('span', 'ember'));
    statusEl.append(el('span', 'label'));
  }
  if (label !== statusLabel) { statusLabel = label; if (label) statusSince = Date.now(); }
  statusDetail = detail || '';
  if (!statusTick) statusTick = setInterval(() => { if (statusEl) keepPlace(() => { statusEl.querySelector('.label').textContent = statusWords(); }); }, 1000);
  const p = store.getProject(), chat = store.openChat();
  keepPlace(() => {
    statusEl.querySelector('.label').textContent = statusWords();
    if (running && p && chat && running.worldId === p.id && running.chatId === chat.id && !statusEl.isConnected) stream.append(statusEl);
  });
}
function clearStatus() {
  if (statusEl) { statusEl.remove(); statusEl = null; }
  if (statusTick) { clearInterval(statusTick); statusTick = null; }
  statusLabel = '';
  statusDetail = '';
  waiting = false;
}

boot().catch((e) => {
  document.body.innerHTML =
    `<div class="empty"><b>CozyMaker could not start</b>${escape(e.message || String(e))}<br><br>` +
    `Is the little server running? In Termux: <code>cozymaker</code></div>`;
});
