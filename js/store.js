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
function tell() { for (const fn of watchers) { try { fn({ house, project, trouble }); } catch (_) {} } }
export function saveTrouble() { return trouble; }
export function unsavedWorlds() { return [...pending.keys()]; }

async function api(path, opts) {
  const res = await fetch(path, { cache: 'no-store', ...opts });
  if (!res.ok) {
    const e = new Error(`${path} came back ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

/* ------------------------------------------------------------------ house */

export async function loadHouse() {
  house = await api('/api/house');
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
  if (repaired) await saveHouse(house);
  return house;
}

export function getHouse() { return house; }

/* HOUSE SAVES GO IN ORDER. Two saves a moment apart (his name typed while the
 * persona box saves, a lesson learned mid-turn) went out side by side, and the
 * device's threads could land the older one last — the newer change lost.
 * Each save waits for the one before it and is written from the house as it
 * is when it goes, so the last to land is always the newest. */
let houseLine = Promise.resolve();
export function saveHouse(next) {
  house = next || house;
  const step = houseLine.catch(() => {}).then(async () => {
    await api('/api/house', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(house),
    });
    tell();
    return house;
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
  const raw = pending.has(id) ? JSON.parse(pending.get(id)) : await api('/api/project/' + id);
  const before = JSON.stringify(raw);
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
        w = pending.has(id) ? JSON.parse(pending.get(id)) : await api('/api/project/' + id);
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
    title: title || 'A new world',
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
  if (project && dirty) { pending.set(project.id, JSON.stringify(project)); dirty = false; }
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
    const body = pending.get(id);
    if (body === undefined) continue;        /* deleted while an earlier one saved */
    try {
      await api('/api/project/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
      if (pending.get(id) === body) pending.delete(id);
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
 * house up to write. Not the connections: they belong to this device, and a
 * file can travel where a key should not. */
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
    house: { settings: h.settings || {}, personaFrame: h.personaFrame || '', instructionsCraft: h.instructionsCraft || '' },
  };
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
  return { added };
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
