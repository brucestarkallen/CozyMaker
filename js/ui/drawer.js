/* CozyMaker — js/ui/drawer.js
 *
 * The shelf on the left: every world, and inside the open one its
 * conversations and its documents. It slides in from the left edge — a swipe
 * from the edge of the screen, or the button at the top left — the way the
 * shelf does in Cozy Chat and Cozy Tavern, so a hand that knows those two
 * already knows this.
 *
 * Every control here is named in words (Cozy Tavern M169: every control in
 * the house is named). A control nobody can find does not exist.
 *
 * Worlds and conversations are listed newest first, by when they were last
 * touched — never by the order they happen to be stored in. */

import * as store from '../store.js';
import { $, el, toast, redraw, ask, when } from './kit.js';
import { DEFAULT_WORLD_TITLE, hasPlotEssential } from '../doc/index.js';
import { openDocs, openDoc, newPlotEssential, bringIn, storyCardIn } from './docs.js';
import { openHouse } from './settings.js';

let busyElsewhere = () => false;
export function setBusyCheck(fn) { busyElsewhere = fn; }

export function openDrawer() {
  draw();
  $('drawer').classList.add('open');
  $('scrim').classList.add('on');
  $('drawer').setAttribute('aria-hidden', 'false');
}

export function closeDrawer() {
  $('drawer').classList.remove('open');
  $('scrim').classList.remove('on');
  $('drawer').setAttribute('aria-hidden', 'true');
}

export function drawerIsOpen() { return $('drawer').classList.contains('open'); }

export async function draw() {
  const body = $('drawerBody');
  const open = store.getProject();
  let worlds = [];
  try { worlds = await store.listProjects(); } catch (_) { /* the open world is still drawn */ }
  /* Redrawn while open — a reply landing, a rename — the drawer keeps his
   * place instead of jumping to the top under his finger (Cozy Tavern M142). */
  const keep = body.scrollTop;
  body.innerHTML = '';

  const head = el('div', 'drawer-head');
  head.append(el('h2', '', 'Your worlds'));
  const nw = el('button', 'btn quiet small', 'New world');
  nw.addEventListener('click', newWorld);
  head.append(nw);
  body.append(head);

  /* The open world's own figures come from memory — fresher than the list. */
  const rows = worlds.map((w) => (open && w.id === open.id
    ? { ...w, title: open.title, updated: Math.max(w.updated || 0, ...(open.chats || []).map((c) => c.updated || 0)) }
    : w));
  if (open && !rows.some((w) => w.id === open.id)) rows.unshift({ id: open.id, title: open.title, updated: Date.now(), docs: open.docs, chats: open.chats });
  rows.sort((a, b) => (b.updated || 0) - (a.updated || 0));

  for (const w of rows) {
    const isOpen = open && w.id === open.id;
    const wrap = el('div', 'world' + (isOpen ? ' open' : ''));
    const row = el('button', 'world-row');
    row.append(el('span', 'world-name', w.title));
    const nDocs = isOpen ? open.docs.length : (w.docs || []).length;
    const nChats = isOpen ? open.chats.length : Math.max(1, (w.chats || []).length);
    row.append(el('span', 'world-sub',
      `${nDocs} document${nDocs === 1 ? '' : 's'} · ${nChats} conversation${nChats === 1 ? '' : 's'} · ${when(w.updated)}`));
    row.addEventListener('click', async () => {
      if (isOpen) return;
      await store.flush();
      await store.openProject(w.id);
      redraw();
      draw();
    });
    const line = el('div', 'world-line');
    line.append(row);
    line.append(itemMenu([
      ['Rename', async () => {
        const t = prompt('Call this world…', w.title);
        if (t === null || !t.trim()) return;
        await renameWorld(w.id, t.trim());
        redraw(); draw();
      }],
      ['Delete', async () => {
        if (busyElsewhere()) return toast('The crew is still working — this can go when they are done.');
        if (!confirm(`Delete "${w.title}" — every document and conversation in it? A copy stays in the backups folder on the device.`)) return;
        await store.deleteProject(w.id);
        if (!store.getProject()) {
          const left = (await store.listProjects()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
          if (left.length) await store.openProject(left[0].id);
          else await store.createProject(DEFAULT_WORLD_TITLE);
        }
        redraw(); draw();
      }],
    ]));
    wrap.append(line);
    if (isOpen) wrap.append(openWorldParts(open));
    body.append(wrap);
  }

  const foot = el('div', 'drawer-foot');
  const house = el('button', 'btn quiet', 'The house — connections, names, the look');
  house.addEventListener('click', () => { closeDrawer(); openHouse(); });
  foot.append(house);
  body.append(foot);
  body.scrollTop = keep;
}

function openWorldParts(world) {
  const box = el('div', 'world-parts');

  /* --- conversations --- */
  const talk = el('div', 'part');
  const th = el('div', 'part-head');
  th.append(el('h3', '', 'Conversations'));
  const nc = el('button', 'btn quiet small', 'New conversation');
  nc.addEventListener('click', async () => {
    if (busyElsewhere()) return toast('The crew is still working — the new conversation can start when they are done.');
    await store.newChat();
    redraw();
    closeDrawer();
  });
  th.append(nc);
  talk.append(th);
  const chats = world.chats.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  for (const c of chats) {
    const r = el('div', 'item chat' + (c.id === world.openChat ? ' current' : ''));
    const go = el('button', 'item-main');
    go.append(el('span', 'item-name', c.title));
    const n = c.turns.length;
    go.append(el('span', 'item-sub', `${n ? `${n} said` : 'nothing said yet'} · ${when(c.updated)}`));
    go.addEventListener('click', async () => { await store.switchChat(c.id); redraw(); closeDrawer(); });
    r.append(go);
    r.append(itemMenu([
      ['Rename', async () => {
        const t = prompt('Call this conversation…', c.title);
        if (t === null || !t.trim()) return;
        await store.renameChat(c.id, t.trim()); redraw(); draw();
      }],
      ['Delete', async () => {
        if (!confirm(`Delete the conversation "${c.title}"? The documents stay exactly as they are — only the talk goes. A copy stays in the backups folder on the device.`)) return;
        await store.deleteChat(c.id); redraw(); draw();
      }],
    ]));
    talk.append(r);
  }
  box.append(talk);

  /* --- documents --- */
  const docs = el('div', 'part');
  const dh = el('div', 'part-head');
  dh.append(el('h3', '', 'Documents'));
  const all = el('button', 'btn quiet small', 'All of them');
  all.addEventListener('click', () => { closeDrawer(); openDocs(); });
  dh.append(all);
  docs.append(dh);
  for (const d of world.docs) {
    const r = el('div', 'item doc');
    const go = el('button', 'item-main');
    go.append(el('span', 'item-name', d.name));
    go.append(el('span', 'item-sub', `${kindWord(d.kind)} · about ${Math.ceil((d.text || '').length / 4).toLocaleString()} tokens`));
    go.addEventListener('click', () => { closeDrawer(); openDoc(d.id); });
    r.append(go);
    docs.append(r);
  }
  const acts = el('div', 'btnrow');
  if (!hasPlotEssential(world.docs)) {
    const start = el('button', 'btn small', 'Start a plot essential');
    start.addEventListener('click', () => { closeDrawer(); newPlotEssential(); });
    const card = el('button', 'btn quiet small', 'Build from a story card');
    card.addEventListener('click', () => { closeDrawer(); storyCardIn(); });
    acts.append(start, card);
  }
  const bring = el('button', 'btn quiet small', 'Bring one in');
  bring.addEventListener('click', () => { closeDrawer(); bringIn(); });
  acts.append(bring);
  const pe = world.docs.find((d) => d.kind === 'pe' && (d.text || '').trim());
  if (pe) {
    const tidy = el('button', 'btn quiet small', 'Tidy it up');
    tidy.addEventListener('click', () => { closeDrawer(); ask(`Tidy up ${pe.name}.`, 'showrunner'); });
    acts.append(tidy);
  }
  docs.append(acts);
  box.append(docs);
  return box;
}

function kindWord(kind) {
  return { pe: 'plot essential', continuity: 'continuation file', worldbook: 'worldbook', notes: 'notes' }[kind || 'pe'] || 'document';
}

/* A small "⋯" that opens the row's own actions in place — named, never hidden
 * behind a long press. */
function itemMenu(actions) {
  const wrap = el('div', 'item-menu');
  const more = el('button', 'iconbtn small', '⋯');
  more.setAttribute('aria-label', 'More for this one');
  const list = el('div', 'item-actions');
  for (const [label, fn] of actions) {
    const b = el('button', 'btn quiet small', label);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    list.append(b);
  }
  more.addEventListener('click', (e) => { e.stopPropagation(); wrap.classList.toggle('show'); });
  wrap.append(more, list);
  return wrap;
}

async function renameWorld(id, title) {
  await store.updateWorld(id, (w) => ({ ...w, title }));
}

/* A NEW WORLD IS SOMEWHERE TO START TALKING. The drawer used to stay open over
 * it, so the first thing he had to do in a world he had just made was close
 * something. It shuts, and he is in the empty room, where how to begin is said. */
async function newWorld() {
  const title = prompt('What is this world called?', DEFAULT_WORLD_TITLE);
  if (title === null) return;
  await store.flush();
  await store.createProject(title.trim() || DEFAULT_WORLD_TITLE);
  redraw();
  closeDrawer();
}

/* --- the swipe from the left edge ---------------------------------------- */

export function wireSwipe() {
  let x0 = null, y0 = null, fromEdge = false, onDrawer = false;
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY;
    fromEdge = x0 < 26 && !drawerIsOpen() && !document.querySelector('.sheet.open');
    onDrawer = drawerIsOpen();
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
    if (fromEdge && dx > 60 && dy < 60) openDrawer();
    else if (onDrawer && dx < -60 && dy < 60) closeDrawer();
    x0 = null;
  }, { passive: true });
}
