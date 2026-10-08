/* CozyMaker — js/store.js
 *
 * Where the work lives: on the device, in ~/.cozymaker, and nowhere else.
 *
 * The browser holds exactly one thing — the world that is open right now — and
 * it holds it only so the page can draw. Close every tab, open a different
 * browser, reboot the phone: the work is where it was, because the browser was
 * never where it was. There is no syncing between browsers, and there is
 * nothing to go wrong between them.
 *
 * Saves are debounced and always in order: a save that is still in flight when
 * the next change arrives does not race it. The page also saves on the way
 * out, so a world is never a few seconds behind.
 */

import { nameWorld, DEFAULT_WORLD_TITLE } from './doc/index.js';
import { mergeWorlds, merge3 } from './merge.js';

const SAVE_AFTER_MS = 900;

let house = null;
let project = null;
let saveTimer = null;
let saving = Promise.resolve();
let dirty = false;
const watchers = new Set();

/* WHAT HAS NOT REACHED THE DEVICE YET, one copy per world — the newest. A save
 * that does not land is not dropped and not merely logged: it stays here and
 * is tried again, a little later each time, until it lands. Android kills
 * Termux when it likes; the work must outlive that. */
const pending = new Map();
let trouble = false;
let retryWait = 0;
let retryTimer = null;
export const RETRY_FIRST_MS = 2000;
export const RETRY_MOST_MS = 30000;

/* Every step in the save line is caught where it is added. One step that
 * throws must never poison the line: a rejected promise skips every "then"
 * after it, and every save after it would silently never run. */
function inLine(step) {
  saving = saving.then(step).catch((e) => { console.error('a save step failed:', e); });
  return saving;
}

export function watch(fn) { watchers.add(fn); return () => watchers.delete(fn); }
/* how many parts of the page are listening: one for each part on screen — never one
 * more with every redraw (the walk holds the documents sheet to it) */
export function listening() { return watchers.size; }
function tell(extra = {}) { for (const fn of watchers) { try { fn({ house, project, trouble, ...extra }); } catch (_) {} } }

/* THE COPY ON THE DEVICE, AS THIS PAGE LAST KNEW IT (v2.5): per world, and for the house,
 * its stamp and its words. A save names the stamp (X-CozyMaker-Base); the device refuses
 * one made from an older copy and hands back its own, and the two are put together from
 * this one (merge.js) — so a tab that fell behind never writes over newer work. */
const bases = new Map();
let houseBase = null;
/* worlds deleted in another window: never saved again from this one */
const goneIds = new Set();
function knowWorld(id, at, json) { bases.set(id, { at: Number(at) || 0, json }); }
function baseHeader(base) { return base ? { 'X-CozyMaker-Base': String(base.at) } : {}; }
export function saveTrouble() { return trouble; }
/* anything of this page's not yet on the device */
export function hasUnsaved() { return dirty || pending.size > 0; }
export function unsavedWorlds() { return [...pending.keys()]; }

async function api(path, opts) {
  const res = await fetch(path, { cache: 'no-store', ...opts });
  if (!res.ok) {
    const e = new Error(`${path} came back ${res.status}`);
    e.status = res.status;
    /* what the device said with it: a refused save carries the newer copy */
    try { e.body = await res.json(); } catch (_) { e.body = null; }
    throw e;
  }
  return res.json();
}

/* ------------------------------------------------------------------ house */

export async function loadHouse() {
  house = await api('/api/house');
  houseBase = { at: Number(house.updated) || 0, json: JSON.stringify(house) };
  house.settings = house.settings || {};
  house.connections = house.connections || [];
  house.agentConnections = house.agentConnections || {};
  /* An earlier version offered "Think a little", saved as "minimal" — a word
   * no provider in the proven table takes. The house can see it, so the house
   * repairs it: it becomes Low, the nearest level that exists. */
  let repaired = false;
  for (const c of house.connections) {
    if (c.thinking === 'minimal') { c.thinking = 'low'; repaired = true; }
  }
  /* THE CONVERSATION WINDOW IS HIS, UNDER A NAME OF ITS OWN (v2.5). The server wrote
   * "turnsOnScreen": 40 into every house, and the box showed 40 whether or not he had
   * set it; read as his, it cut a long brainstorm's start out of what the builder reads.
   * The old name is read once and goes: a number other than that default was his and
   * moves to the new name; the default goes, and nothing set is the whole conversation.
   * A 40 he sets from now on is kept under the new name, and stays. */
  if (moveTalkWindow(house.settings)) repaired = true;
  if (repaired) await saveHouse(house);
  return house;
}

/* the old name's number, as the new name holds it — or nothing, for the old default */
function oldTalkWindow(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n !== 40 ? Math.max(6, Math.round(n)) : undefined;
}
function moveTalkWindow(settings) {
  if (!settings || !Object.prototype.hasOwnProperty.call(settings, 'turnsOnScreen')) return false;
  const his = oldTalkWindow(settings.turnsOnScreen);
  if (settings.talkWindow === undefined && his !== undefined) settings.talkWindow = his;
  delete settings.turnsOnScreen;
  return true;
}

export function getHouse() { return house; }

/* HOUSE SAVES GO IN ORDER. Two saves a moment apart (his name typed while the
 * persona box saves, a lesson learned mid-turn) went out side by side, and the
 * device's threads could land the older one last — the newer change lost.
 * Each save waits for the one before it and is written from the house as it
 * is when it goes, so the last to land is always the newest. */
let houseLine = Promise.resolve();
/* the house, put in place: every part of the app holds this one object, so it is
 * filled again rather than replaced */
function adoptHouse(next) {
  for (const k of Object.keys(house)) delete house[k];
  Object.assign(house, next);
  house.settings = house.settings || {};
  house.connections = house.connections || [];
  house.agentConnections = house.agentConnections || {};
}
export function saveHouse(next) {
  if (next && next !== house) { if (house) adoptHouse(next); else house = next; }
  const step = houseLine.catch(() => {}).then(async () => {
    for (let tries = 0; ; tries++) {
      const body = JSON.stringify(house);
      try {
        const r = await api('/api/house', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...baseHeader(houseBase) }, body });
        houseBase = { at: Number(r.updated) || 0, json: body };
        house.updated = houseBase.at;
        tell();
        return house;
      } catch (e) {
        /* the house was saved from another page since this one read it: the two are put
         * together, this page's change on top, and saved again */
        if (e.status === 409 && e.body && e.body.house && tries < 4) {
          const remote = e.body.house;
          /* this page's side is the house as it is NOW: a change made while the refused
           * save was on its way is in it, and is not lost to the merge */
          const merged = merge3(houseBase ? JSON.parse(houseBase.json) : {}, JSON.parse(JSON.stringify(house)), remote);
          houseBase = { at: Number(remote.updated) || 0, json: JSON.stringify(remote) };
          adoptHouse(merged);
          continue;
        }
        throw e;
      }
    }
  });
  houseLine = step;
  return step;
}

export function setSetting(key, value) {
  house.settings[key] = value;
  return saveHouse();
}

/* --------------------------------------------------------------- projects */

export async function listProjects() {
  const r = await api('/api/projects');
  return r.projects || [];
}

/* A WORLD HOLDS ITS DOCUMENTS AND ITS CONVERSATIONS. The documents belong to
 * the world — every conversation in it reads and changes the same plot
 * essential. A conversation is only talk, and there can be as many as the
 * writer likes (Cozy Chat v5.4.0, "projects hold your chats").
 *
 * A world saved before conversations existed kept one list of turns on the
 * world itself. It is moved, whole and in order, into a first conversation the
 * moment it is opened — nothing is dropped and nothing is asked. */
export function chatId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export function upgradeWorld(w) {
  const world = w || {};
  world.docs = world.docs || [];
  world.undo = world.undo || [];
  world.recentSections = world.recentSections || [];
  if (!Array.isArray(world.chats)) world.chats = [];
  if (Array.isArray(world.turns)) {
    if (world.turns.length || !world.chats.length) {
      const first = world.turns[0], last = world.turns[world.turns.length - 1];
      world.chats.unshift({
        id: chatId(),
        title: 'First conversation',
        turns: world.turns,
        created: (first && first.at) || world.updated || Date.now(),
        updated: (last && last.at) || world.updated || Date.now(),
      });
    }
    delete world.turns;
  }
  if (!world.chats.length) {
    world.chats.push({ id: chatId(), title: 'First conversation', turns: [], created: Date.now(), updated: Date.now() });
  }
  for (const c of world.chats) { c.turns = c.turns || []; c.title = c.title || 'A conversation'; }
  if (!world.chats.some((c) => c.id === world.openChat)) world.openChat = newestChat(world).id;
  /* a world still called "A new world" whose plot essential names it */
  nameWorld(world);
  return world;
}

export function newestChat(world) {
  return (world.chats || []).slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
}

export function openChat() {
  if (!project) return null;
  return project.chats.find((c) => c.id === project.openChat) || project.chats[0] || null;
}

export async function openProject(id) {
  /* Anything still on its way to the device for this world is newer than
   * what the device holds, so the world opens from it. And no write already
   * queued may land after this read and leave the screen behind it. */
  await saving;
  const waiting = pending.has(id);
  const raw = waiting ? JSON.parse(pending.get(id)) : await api('/api/project/' + id);
  const before = JSON.stringify(raw);
  /* the copy on the device, as read: what this page's saves are made from */
  if (!waiting) knowWorld(id, raw.updated, before);
  project = upgradeWorld(raw);
  try { localStorage.setItem('cozymaker:open', id); } catch (_) {}
  /* A world that had to be moved into the new shape is written back at once.
   * Left only in memory, every open would move it again under a fresh
   * conversation id — and a reply finishing after he walked away would look
   * for a conversation that no longer existed. */
  if (JSON.stringify(project) !== before) await setProject(project, { now: true });
  tell();
  return project;
}

/* Change a world by its id, whether or not it is the one on screen. A reply
 * lands in the world and the conversation that asked for it, even if the
 * writer has walked into another one while the crew worked (Cozy Chat v5.2.0).
 * A world deleted in the meantime stays deleted: nothing is written back and
 * the caller is told (Cozy Tavern M185 — a page let go must stay gone). */
export async function updateWorld(id, mutate) {
  /* deleted — here, or in another window while this one still showed it (v2.5): what
   * would land is let go and the caller told, never kept on a screen that saves nowhere */
  if (goneIds.has(id)) return { ok: false, gone: true };
  if (project && project.id === id) {
    let next;
    try { next = mutate(project); } catch (e) { return { ok: false, gone: false, error: e.message }; }
    if (next === null) return { ok: false, gone: false };
    await setProject(next || project, { now: true });
    return { ok: true, open: true };
  }
  /* Not on screen. The read, the change and the hand-over to the save queue
   * happen as ONE step in the same line as every save, so no open and no
   * other write can fall between them. Only "not found" means deleted; any
   * other failure — the server restarting, Termux killed — is waited out and
   * tried again, never taken as a deletion. */
  return new Promise((resolve) => {
    let wait = RETRY_FIRST_MS;
    const attempt = async () => {
      /* Opened while this waited its turn: change it on screen. Its save is
       * scheduled, never awaited here — this step runs INSIDE the save line,
       * and waiting on a save queued behind itself would wait for ever. */
      if (project && project.id === id) {
        let next;
        try { next = mutate(project); } catch (e) { resolve({ ok: false, gone: false, error: e.message }); return; }
        if (next === null) { resolve({ ok: false, gone: false }); return; }
        setProject(next || project);
        resolve({ ok: true, open: true });
        return;
      }
      let w;
      try {
        const waiting = pending.has(id);
        w = waiting ? JSON.parse(pending.get(id)) : await api('/api/project/' + id);
        if (!waiting) knowWorld(id, w.updated, JSON.stringify(w));
      } catch (e) {
        if (e.status === 404) { resolve({ ok: false, gone: true }); return; }
        trouble = true; tell();
        setTimeout(() => inLine(attempt), wait);
        wait = Math.min(wait * 2, RETRY_MOST_MS);
        return;
      }
      const before = JSON.stringify(w);
      const upgraded = upgradeWorld(w);
      let next;
      try { next = mutate(upgraded); } catch (e) { resolve({ ok: false, gone: false, error: e.message }); return; }
      const out = next === null ? upgraded : (next || upgraded);
      if (next !== null || JSON.stringify(upgraded) !== before) pending.set(id, JSON.stringify(out));
      await drain();
      resolve(next === null ? { ok: false, gone: false } : { ok: true, open: false });
    };
    inLine(attempt);
  });
}

export function getProject() { return project; }

export function lastOpenId() {
  try { return localStorage.getItem('cozymaker:open') || null; } catch (_) { return null; }
}

export async function createProject(title) {
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const fresh = upgradeWorld({
    id,
    title: title || DEFAULT_WORLD_TITLE,
    docs: [],
    chats: [],
    undo: [],
    recentSections: [],
  });
  await api('/api/project/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fresh),
  });
  return openProject(id);
}

/* A COPY BESIDE IT, WHEN TWO PAGES CHANGED THE SAME THING DIFFERENTLY (v2.5). This page's
 * version stands in the world; the other page's whole copy is kept as a world of its own,
 * so nothing either of them did is lost. */
async function keepBeside(world) {
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const when = new Date().toLocaleString();
  const title = `${String(world.title || DEFAULT_WORLD_TITLE)} (from another window, ${when})`;
  await api('/api/project/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...world, id, title }) });
  return title;
}

/* THE DEVICE HOLDS A NEWER COPY THAN THE ONE THIS SAVE WAS MADE FROM: the newest copy
 * this page holds and the device's are put together, the open world takes the result,
 * and it goes out again. A true conflict keeps the device's copy beside it as a world of
 * its own. Returns the copy to save next. */
async function settleWorld(id, sent, remote) {
  if (project && project.id === id && dirty) { pending.set(id, JSON.stringify(project)); dirty = false; }
  const latest = pending.has(id) ? pending.get(id) : sent;
  const base = bases.get(id);
  const { world, conflicts } = mergeWorlds(base ? JSON.parse(base.json) : {}, JSON.parse(latest), remote);
  knowWorld(id, remote.updated, JSON.stringify(remote));
  const next = JSON.stringify(world);
  pending.set(id, next);
  /* the open world takes the result at once — nothing he does can fall between the
   * copy read for the merge and the copy put on screen */
  const open = Boolean(project && project.id === id);
  if (open) project = upgradeWorld(JSON.parse(next));
  let beside = '';
  if (conflicts.length) { try { beside = await keepBeside(remote); } catch (_) { beside = ''; } }
  if (open) tell({ reloaded: true, merged: { conflicts: conflicts.length, beside } });
  else if (conflicts.length) tell({ merged: { conflicts: conflicts.length, beside } });
  /* anything typed meanwhile is a newer copy of its own, saved after this one */
  return next;
}

/* A WORLD DELETED IN ANOTHER WINDOW STAYS DELETED: its waiting copy goes, and the page is told. */
function goneWorld(id) {
  goneIds.add(id);
  pending.delete(id);
  bases.delete(id);
  if (project && project.id === id) dirty = false;
  tell({ gone: id });
}

/* BACK TO A PAGE THAT FELL BEHIND (v2.5). When the page comes back into view (another
 * app, another browser, a tab left for days) with nothing of its own still unsaved, it
 * reads whether the device has moved on, and takes the newer copy of the open world and
 * of the house before he can act on an old one. Returns what changed. */
export async function refreshFromDevice({ house: takeHouse = true } = {}) {
  const out = { world: false, house: false, gone: false };
  await saving;
  /* the house — not while he has it open in front of him: what he is changing there is
   * saved over the device's copy by the merge, never under his hands */
  if (takeHouse) {
    try {
      const h = await api('/api/house');
      if (house && houseBase && Number(h.updated || 0) !== houseBase.at) {
        await houseLine.catch(() => {});
        if (Number(h.updated || 0) !== houseBase.at) {
          houseBase = { at: Number(h.updated) || 0, json: JSON.stringify(h) };
          adoptHouse(h);
          out.house = true;
        }
      }
    } catch (_) { /* the device is away: nothing to compare with */ }
  }
  /* the open world, when nothing of this page's is still on its way to the device */
  const takeWorld = async () => {
    if (!project || dirty || pending.has(project.id)) return;
    const id = project.id;
    let stamp;
    try { stamp = await api('/api/stamp/' + id); }
    catch (e) { if (e.status === 404) { out.gone = true; goneWorld(id); } return; }
    const base = bases.get(id);
    if (!base || Number(stamp.updated || 0) === base.at) return;
    let raw;
    try { raw = await api('/api/project/' + id); } catch (_) { return; }
    /* he may have started typing while it was read: his words win, and his save will
     * be put together with the device's copy if it has to be */
    if (dirty || pending.has(id) || !project || project.id !== id) return;
    knowWorld(id, raw.updated, JSON.stringify(raw));
    project = upgradeWorld(raw);
    out.world = true;
  };
  await takeWorld();
  if (out.house || out.world) tell({ reloaded: true });
  return out;
}

export async function deleteProject(id) {
  /* A deleted world is never put back by a save still waiting to retry —
   * nor by one already going out: the delete goes in the save line, after any
   * save in flight, and a run already under way skips a world no longer
   * waiting. Sent beside it, a save mid-flight landed after the delete and
   * brought the world back. */
  pending.delete(id);
  let failed = null;
  await inLine(async () => { try { await api('/api/project/' + id, { method: 'DELETE' }); } catch (e) { failed = e; } });
  if (failed) throw failed;
  bases.delete(id);
  goneIds.add(id);
  if (project && project.id === id) project = null;
  try { if (localStorage.getItem('cozymaker:open') === id) localStorage.removeItem('cozymaker:open'); } catch (_) {}
  tell();
}

/* Replace the open world and save it. Every change goes through here, so
 * there is one place a save can be got wrong and one place to fix it. */
export function setProject(next, { now = false } = {}) {
  project = next;
  dirty = true;
  tell();
  if (now) return flush();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_AFTER_MS);
  return Promise.resolve();
}

export function flush() {
  clearTimeout(saveTimer);
  /* Serialised ONCE. The obvious way — clone the world, then stringify the
   * clone — walks everything twice on the main thread on every save, which is
   * exactly what made the other frontend stutter on a long story. The string
   * is the snapshot: nothing can mutate it while the save is in flight. */
  if (project && dirty && !goneIds.has(project.id)) pending.set(project.id, JSON.stringify(project));
  dirty = false;
  if (!pending.size) return saving;
  return inLine(drain);
}

/* Put every waiting copy on the device, newest per world. The first one that
 * will not land stops the run; it and everything after it wait for the next
 * try, a little later each time, and the house says plainly that it is not
 * saved yet. A copy superseded while its save was in flight stays for the
 * next run, so the newest always wins. */
async function drain() {
  for (const [id] of [...pending]) {
    let body = pending.get(id);
    if (body === undefined) continue;        /* deleted while an earlier one saved */
    if (goneIds.has(id)) { pending.delete(id); continue; }
    try {
      for (let tries = 0; ; tries++) {
        try {
          const r = await api('/api/project/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...baseHeader(bases.get(id)) }, body });
          knowWorld(id, r.updated, body);
          if (pending.get(id) === body) pending.delete(id);
          break;
        } catch (e) {
          /* made from an older copy than the device's: put together, and out again */
          if (e.status === 409 && e.body && e.body.world && tries < 4) { body = await settleWorld(id, body, e.body.world); continue; }
          /* deleted in another window meanwhile: it stays deleted */
          if (e.status === 410) { goneWorld(id); break; }
          throw e;
        }
      }
    } catch (e) {
      trouble = true;
      tell();
      retryWait = Math.min(retryWait ? retryWait * 2 : RETRY_FIRST_MS, RETRY_MOST_MS);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { flush(); }, retryWait);
      return;
    }
  }
  if (!pending.size) {
    clearTimeout(retryTimer);
    retryWait = 0;
    if (trouble) { trouble = false; tell(); }
  }
}

/* A page going away still owes its last save. */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { try { flush(); } catch (_) {} });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

/* ------------------------------------------------------------- documents */

export function docId() {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export function addDoc(name, kind, text) {
  const next = { ...project, docs: [...(project.docs || []), { id: docId(), name, kind, text: text || '' }] };
  return setProject(next, { now: true });
}

export function removeDoc(id) {
  const next = { ...project, docs: (project.docs || []).filter((d) => d.id !== id) };
  return setProject(next, { now: true });
}

export function writeDoc(id, text) {
  const next = { ...project, docs: (project.docs || []).map((d) => (d.id === id ? { ...d, text } : d)) };
  return setProject(next);
}

export function renameDoc(id, name) {
  const next = { ...project, docs: (project.docs || []).map((d) => (d.id === id ? { ...d, name } : d)) };
  return setProject(next, { now: true });
}

/* ---------------------------------------------------------- conversations */

export function newChat(title) {
  const c = { id: chatId(), title: title || 'A new conversation', turns: [], created: Date.now(), updated: Date.now() };
  const next = { ...project, chats: [...project.chats, c], openChat: c.id };
  return setProject(next, { now: true }).then(() => c);
}

/* EVERYTHING IN ONE FILE (the Plot Essential Maker's v0.13.0, "Backup all").
 * Every world whole, with its documents and conversations, and how he set the
 * house up to write — his connections too, keys and all, and who rides which
 * (v2.5, his own standard for a copy: "like Mac Time Machine" — brought back on a new
 * phone it is the house as it was, with nothing to set up again). The first version
 * left the connections out, so a copy brought back could not answer a word until every
 * key was typed in again. What was sent stays on the phone that made it: forty replies a
 * world, each holding his whole engine, is far too much for one file. */
export const BACKUP_FORMAT = 'cozymaker-backup';
export async function exportEverything() {
  await flush();
  const worlds = [];
  for (const w of await listProjects()) {
    const raw = pending.has(w.id) ? JSON.parse(pending.get(w.id)) : await api('/api/project/' + w.id);
    worlds.push(upgradeWorld(raw));
  }
  const h = house || {};
  return {
    format: BACKUP_FORMAT, v: 1, at: Date.now(), worlds,
    house: { settings: h.settings || {}, personaFrame: h.personaFrame || '', postNote: h.postNote || '', instructionsCraft: h.instructionsCraft || '', crafts: h.crafts || {},
      connections: (h.connections || []).map((c) => ({ ...c })), agentConnections: { ...(h.agentConnections || {}) } },
  };
}

/* HOW HE SET THE HOUSE UP COMES BACK TOO — where this house has nothing of its
 * own. The file has always carried his instructions for the one he talks to,
 * their names and his settings, and bringing it back never read them: on a new
 * phone the worlds returned and the persona did not. His own versions of the
 * keepers' crafts were not in the file at all. Bringing back still only ever
 * adds — a value this house already has is never replaced. Pure: the house in,
 * the house out, and what was filled. */
export function fillHouse(current, saved) {
  const h = { ...(current || {}), settings: { ...((current && current.settings) || {}) }, crafts: { ...((current && current.crafts) || {}) } };
  const filled = [];
  const s = (saved && typeof saved === 'object') ? saved : {};
  const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
  if (blank(h.personaFrame) && !blank(s.personaFrame)) { h.personaFrame = s.personaFrame; filled.push('their instructions'); }
  if (blank(h.postNote) && !blank(s.postNote)) { h.postNote = s.postNote; filled.push('the note at the end'); }
  for (const [k0, v0] of Object.entries(s.settings || {})) {
    /* a file from before v2.5: its conversation window under the old name — the old
     * default is nothing, his own number is his, under the new name */
    let k = k0, v = v0;
    if (k0 === 'turnsOnScreen') { v = oldTalkWindow(v0); if (v === undefined) continue; k = 'talkWindow'; }
    if (blank(h.settings[k]) && !blank(v)) { h.settings[k] = v; if (k === 'makerName' || k === 'yourName') { if (!filled.includes('the names')) filled.push('the names'); } }
  }
  for (const [w, text] of Object.entries(s.crafts || {})) {
    if (blank(h.crafts[w]) && !blank(text)) { h.crafts[w] = text; if (!filled.includes('your own crafts')) filled.push('your own crafts'); }
  }
  if (blank(h.instructionsCraft) && !blank(s.instructionsCraft) && blank(h.crafts.instructions)) { h.instructionsCraft = s.instructionsCraft; if (!filled.includes('your own crafts')) filled.push('your own crafts'); }
  if (!Object.keys(h.crafts).length) delete h.crafts;
  /* HIS CONNECTIONS COME BACK BESIDE HIS OWN (v2.5): one this house already has — the same
   * one, or one at the same address with the same model and key — is never doubled, and
   * nothing here is replaced; who rides which comes back only where nothing is chosen */
  const conns = (current && current.connections || []).map((c) => ({ ...c }));
  const sameOne = (a, b) => a.id === b.id || (String(a.url || '') === String(b.url || '') && String(a.model || '') === String(b.model || '') && String(a.key || '') === String(b.key || ''));
  /* the file's connection, as this house holds it: itself, or the one here it matches */
  const here = new Map();
  let added = 0;
  for (const c of Array.isArray(s.connections) ? s.connections : []) {
    if (!c || typeof c !== 'object' || !String(c.url || '').trim()) continue;
    const twin = conns.find((x) => sameOne(x, c));
    if (twin) { here.set(c.id, twin.id); continue; }
    conns.push({ ...c });
    here.set(c.id, c.id);
    added++;
  }
  if (added) { h.connections = conns; filled.push(added === 1 ? 'a connection' : `${added} connections`); }
  const picks = { ...((current && current.agentConnections) || {}) };
  let picked = 0;
  for (const [who, saidId] of Object.entries((s.agentConnections && typeof s.agentConnections === 'object') ? s.agentConnections : {})) {
    const id = here.get(saidId) || saidId;
    if (picks[who] || !(h.connections || conns).some((c) => c.id === id)) continue;
    picks[who] = id;
    picked++;
  }
  if (picked) { h.agentConnections = picks; if (!filled.includes('who rides which connection')) filled.push('who rides which connection'); }
  return { house: h, filled };
}

export function readBackup(text) {
  let v;
  try { v = JSON.parse(text); } catch (_) { return { ok: false, why: 'that file is not readable' }; }
  if (!v || v.format !== BACKUP_FORMAT || !Array.isArray(v.worlds)) return { ok: false, why: 'that file is not a CozyMaker backup' };
  return { ok: true, backup: v };
}

/* BRINGING IT BACK ONLY EVER ADDS (v0.13.0's guarantee). Every world returns
 * as a new world beside what is here, under a fresh id; a title already in use
 * gets "(restored)". Nothing here is replaced, so nothing here can be lost. */
export async function restoreEverything(backup) {
  const titles = new Set((await listProjects()).map((w) => w.title));
  let added = 0;
  for (const w0 of backup.worlds || []) {
    if (!w0 || typeof w0 !== 'object') continue;
    const w = upgradeWorld(JSON.parse(JSON.stringify(w0)));
    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const base = String(w.title || 'A restored world');
    let title = base;
    for (let n = 1; titles.has(title); n++) title = n === 1 ? `${base} (restored)` : `${base} (restored ${n})`;
    titles.add(title);
    await api('/api/project/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...w, id, title }) });
    added++;
  }
  let filled = [];
  if (house && backup.house) {
    const r = fillHouse(house, backup.house);
    if (r.filled.length) { filled = r.filled; Object.assign(house, r.house); if (!r.house.crafts) delete house.crafts; await saveHouse(house); }
  }
  return { added, filled };
}

/* AN EARLIER COPY OF A WORLD, BROUGHT BACK (v2.5): beside what is here, never over it,
 * under a fresh id, its title saying when it is from. */
export async function restoreCopy(raw, when) {
  const w = upgradeWorld(JSON.parse(JSON.stringify(raw || {})));
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const title = `${String(w.title || DEFAULT_WORLD_TITLE).replace(/ \(as it was [^)]*\)$/, '')} (as it was ${when})`;
  await api('/api/project/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...w, id, title }) });
  return { id, title };
}

export function newChatWith(title, turns) {
  const c = { id: chatId(), title: title || 'A new conversation', turns: turns || [], created: Date.now(), updated: Date.now() };
  const next = { ...project, chats: [...project.chats, c], openChat: c.id };
  return setProject(next, { now: true }).then(() => c);
}

export function switchChat(id) {
  if (!project.chats.some((c) => c.id === id)) return Promise.resolve();
  return setProject({ ...project, openChat: id }, { now: true });
}

export function renameChat(id, title) {
  const next = { ...project, chats: project.chats.map((c) => (c.id === id ? { ...c, title } : c)) };
  return setProject(next, { now: true });
}

/* A world always has at least one conversation: deleting the last one leaves
 * a fresh empty one behind rather than a world with nowhere to talk. */
export function deleteChat(id) {
  let chats = project.chats.filter((c) => c.id !== id);
  if (!chats.length) chats = [{ id: chatId(), title: 'A new conversation', turns: [], created: Date.now(), updated: Date.now() }];
  const openChatId = chats.some((c) => c.id === project.openChat) ? project.openChat : newestChat({ chats }).id;
  return setProject({ ...project, chats, openChat: openChatId }, { now: true });
}
