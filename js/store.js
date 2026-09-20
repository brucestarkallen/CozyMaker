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

export function watch(fn) { watchers.add(fn); return () => watchers.delete(fn); }
function tell() { for (const fn of watchers) { try { fn({ house, project }); } catch (_) {} } }

async function api(path, opts) {
  const res = await fetch(path, { cache: 'no-store', ...opts });
  if (!res.ok) throw new Error(`${path} came back ${res.status}`);
  return res.json();
}

/* ------------------------------------------------------------------ house */

export async function loadHouse() {
  house = await api('/api/house');
  house.settings = house.settings || {};
  house.connections = house.connections || [];
  house.agentConnections = house.agentConnections || {};
  return house;
}

export function getHouse() { return house; }

export async function saveHouse(next) {
  house = next || house;
  await api('/api/house', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(house),
  });
  tell();
  return house;
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

export async function openProject(id) {
  project = await api('/api/project/' + id);
  project.docs = project.docs || [];
  project.turns = project.turns || [];
  project.undo = project.undo || [];
  project.recentSections = project.recentSections || [];
  try { localStorage.setItem('cozymaker:open', id); } catch (_) {}
  tell();
  return project;
}

export function getProject() { return project; }

export function lastOpenId() {
  try { return localStorage.getItem('cozymaker:open') || null; } catch (_) { return null; }
}

export async function createProject(title) {
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const fresh = {
    id,
    title: title || 'A new world',
    docs: [],
    turns: [],
    undo: [],
    recentSections: [],
  };
  await api('/api/project/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fresh),
  });
  return openProject(id);
}

export async function deleteProject(id) {
  await api('/api/project/' + id, { method: 'DELETE' });
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
  if (!project || !dirty) return saving;
  /* Serialised ONCE. The obvious way — clone the world, then stringify the
   * clone — walks everything twice on the main thread on every save, which is
   * exactly what made the other frontend stutter on a long story. The string
   * is the snapshot: nothing can mutate it while the save is in flight. */
  const id = project.id;
  const body = JSON.stringify(project);
  dirty = false;
  saving = saving.then(() =>
    api('/api/project/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch((e) => { dirty = true; console.warn('save did not land:', e.message); })
  );
  return saving;
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
