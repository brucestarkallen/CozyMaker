/* CozyMaker — tests/two_pages.mjs
 *
 * TWO WINDOWS, ONE DEVICE (v2.5). Two copies of the real store — two pages, as a
 * tab in Chrome and one in Opera would be, or a tab left open for days — against the
 * REAL serve.py on a throwaway home. Every check reads what reached the device.
 *
 *   node tests/two_pages.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8815;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
const failed = [];
const ok = (name, cond, detail = '') => { if (cond) passed++; else failed.push(`${name}${detail === '' ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = mkdtempSync(join(tmpdir(), 'cozymaker-two-'));
const server = spawn('python3', [join(ROOT, 'serve.py')], { env: { ...process.env, COZYMAKER_HOME: home, COZYMAKER_PORT: String(PORT) }, stdio: 'ignore' });

/* every page's own address goes to the real server; a hook can act the moment a
 * request has gone out (his hands on the page while a save is on its way) */
const realFetch = globalThis.fetch;
let whenSent = null;
globalThis.fetch = (url, init = {}) => {
  const u = String(url);
  const going = realFetch(u.startsWith('/') ? BASE + u : u, init);
  if (whenSent) { const f = whenSent(u, init); if (f) { whenSent = null; f(); } }
  return going;
};
const device = async (path, init) => { const r = await realFetch(BASE + path, init); return r.ok ? r.json() : null; };
const putWorld = (w) => device('/api/project/' + w.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(w) });

async function main() {
  let up = false;
  for (let i = 0; i < 150 && !up; i++) { try { up = (await realFetch(BASE + '/api/version')).ok; } catch (_) { await sleep(100); } }
  if (!up) { ok('the server came up', false); return; }

  /* two pages: the same code, two copies of it */
  const A = await import('../js/store.js?page=a');
  const B = await import('../js/store.js?page=b');
  ok('two pages are two copies of the store', A !== B && typeof A.refreshFromDevice === 'function', typeof A.refreshFromDevice);
  if (typeof A.refreshFromDevice !== 'function') return;

  await putWorld({ id: 'w1', title: 'Harbour', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: 'PE one' }], chats: [{ id: 'c1', title: 'Talk', turns: [{ role: 'writer', text: 'hello', at: 1 }] }] });
  await A.loadHouse(); await B.loadHouse();
  await A.openProject('w1'); await B.openProject('w1');
  const told = { A: [], B: [] };
  A.watch((e) => { if (e.merged || e.gone || e.reloaded) told.A.push({ merged: e.merged, gone: e.gone, reloaded: e.reloaded }); });
  B.watch((e) => { if (e.merged || e.gone || e.reloaded) told.B.push({ merged: e.merged, gone: e.gone, reloaded: e.reloaded }); });
  const withText = (S, text) => { const p = S.getProject(); return { ...p, docs: p.docs.map((d) => (d.id === 'd1' ? { ...d, text } : d)) }; };
  const addTurn = (S, text) => { const p = S.getProject(); return S.setProject({ ...p, chats: p.chats.map((c) => (c.id === 'c1' ? { ...c, turns: [...c.turns, { role: 'writer', text, at: Date.now() }] } : c)) }, { now: true }); };

  /* — two windows, different things — */
  await A.setProject({ ...A.getProject(), title: 'Harbour of Varrow' }, { now: true });
  await B.setProject(withText(B, 'PE two, from B'), { now: true });
  let dev = await device('/api/project/w1');
  ok('two windows changing different things: both changes stand on the device', dev.title === 'Harbour of Varrow' && dev.docs[0].text === 'PE two, from B', [dev.title, dev.docs[0].text]);
  ok('and the window that saved second shows both', B.getProject().title === 'Harbour of Varrow' && B.getProject().docs[0].text === 'PE two, from B');
  ok('nothing was a clash, so nothing was kept beside', !told.B.some((t) => t.merged && t.merged.conflicts), told.B);

  /* — one conversation, talked on in both — */
  await addTurn(A, 'from A');
  await addTurn(B, 'from B');
  dev = await device('/api/project/w1');
  ok('a conversation talked on in both windows keeps every message of both', JSON.stringify(dev.chats[0].turns.map((t) => t.text)) === JSON.stringify(['hello', 'from A', 'from B']), dev.chats[0].turns.map((t) => t.text));
  ok('and the documents stayed as the other window left them', dev.docs[0].text === 'PE two, from B' && dev.title === 'Harbour of Varrow');

  /* — coming back to a window that fell behind — */
  const back = await A.refreshFromDevice();
  ok('a window coming back takes the newer copy before he can act on an old one', back.world === true && JSON.stringify(A.getProject().chats[0].turns.map((t) => t.text)) === JSON.stringify(['hello', 'from A', 'from B']), back);
  const again = await A.refreshFromDevice();
  ok('and with nothing newer, it changes nothing', again.world === false && again.house === false, again);

  /* — the same thing, changed differently in both — */
  await B.refreshFromDevice();
  told.B.length = 0;
  await A.setProject(withText(A, 'A wrote this'), { now: true });
  await B.setProject(withText(B, 'B wrote this'), { now: true });
  dev = await device('/api/project/w1');
  ok('the same thing changed differently: the window that saved last stands', dev.docs[0].text === 'B wrote this', dev.docs[0].text);
  const listed = ((await device('/api/projects')) || {}).projects || [];
  const beside = listed.find((w) => /\(from another window, /.test(w.title || ''));
  const besideWorld = beside ? await device('/api/project/' + beside.id) : null;
  ok('and the other window’s whole copy is kept beside it, as a world of its own', Boolean(besideWorld) && besideWorld.docs[0].text === 'A wrote this' && besideWorld.chats[0].turns.length === 3, beside);
  const clash = told.B.find((t) => t.merged && t.merged.conflicts);
  ok('the window is told, with the copy’s name', Boolean(clash) && clash.merged.beside === (beside && beside.title), told.B);

  /* — he types while the other window's copy is being kept beside — */
  await A.refreshFromDevice(); await B.refreshFromDevice();
  await A.setProject(withText(A, 'A again'), { now: true });
  whenSent = (u, init) => (init.method === 'PUT' && /^\/api\/project\/p/.test(u) ? () => { B.setProject({ ...B.getProject(), title: 'typed while it was kept' }); } : null);
  await B.setProject(withText(B, 'B again'), { now: true });
  whenSent = null;
  await B.flush();
  dev = await device('/api/project/w1');
  ok('what he typed while the other copy was kept beside is not lost', dev.title === 'typed while it was kept' && dev.docs[0].text === 'B again', [dev.title, dev.docs[0].text]);

  /* — a world deleted in another window — */
  await putWorld({ id: 'w2', title: 'Ferry', docs: [], chats: [] });
  await A.openProject('w2'); await B.openProject('w2');
  told.A.length = 0;
  await B.deleteProject('w2');
  await A.setProject({ ...A.getProject(), title: 'still typing in A' }, { now: true });
  ok('a world deleted in another window stays deleted when this one saves', (await device('/api/project/w2')) === null);
  ok('and this window is told', told.A.some((t) => t.gone === 'w2'), told.A);
  const landing = await A.updateWorld('w2', (w) => w);
  ok('a reply landing there afterwards is let go, and the caller told', landing.ok === false && landing.gone === true, landing);
  await A.flush();
  ok('and nothing brings it back', (await device('/api/project/w2')) === null);
  await putWorld({ id: 'w3', title: 'Lantern', docs: [], chats: [] });
  await A.openProject('w3');
  told.A.length = 0;
  await device('/api/project/w3', { method: 'DELETE' });
  const seen = await A.refreshFromDevice();
  ok('a window coming back to a world deleted elsewhere is told it is gone', seen.gone === true && told.A.some((t) => t.gone === 'w3'), seen);

  /* — the house, saved from two windows — */
  await A.loadHouse(); await B.loadHouse();
  A.getHouse().settings.makerName = 'Eni'; await A.saveHouse();
  B.getHouse().settings.theme = 'tavern'; await B.saveHouse();
  let hd = await device('/api/house');
  ok('the house: two windows’ settings both stand', hd.settings.makerName === 'Eni' && hd.settings.theme === 'tavern', hd.settings);
  A.getHouse().connections.push({ id: 'cA', name: 'A', url: 'http://a.example/v1', model: 'm' }); await A.saveHouse();
  B.getHouse().connections.push({ id: 'cB', name: 'B', url: 'http://b.example/v1', model: 'm' }); await B.saveHouse();
  hd = await device('/api/house');
  ok('a connection added in each window: both kept', ['cA', 'cB'].every((id) => hd.connections.some((c) => c.id === id)), hd.connections.map((c) => c.id));
  /* a change he makes while a save that will be refused is on its way */
  B.getHouse().settings.smoothStreaming = 'off'; await B.saveHouse();
  whenSent = (u, init) => (u === '/api/house' && init.method === 'PUT' ? () => { A.getHouse().settings.yourName = 'Bruce'; } : null);
  A.getHouse().settings.person = 'first';
  await A.saveHouse();
  whenSent = null;
  await A.saveHouse();
  hd = await device('/api/house');
  ok('a change made while a refused save was on its way is not lost to the merge', hd.settings.yourName === 'Bruce' && hd.settings.person === 'first' && hd.settings.smoothStreaming === 'off', hd.settings);
  /* coming back with the house open in front of him: the house is left as he sees it */
  B.getHouse().settings.theme = 'neon'; await B.saveHouse();
  const kept = await A.refreshFromDevice({ house: false });
  ok('with the house open in front of him, coming back leaves it as he sees it', kept.house === false && A.getHouse().settings.theme === 'tavern', [kept, A.getHouse().settings.theme]);
  const taken = await A.refreshFromDevice();
  ok('with it shut, coming back takes the newer house', taken.house === true && A.getHouse().settings.theme === 'neon', [taken, A.getHouse().settings.theme]);
}

try { await main(); }
catch (e) { ok('the two-page walk ran to its end', false, String((e && e.stack) || e)); }
finally {
  server.kill();
  try { rmSync(home, { recursive: true, force: true }); } catch (_) { /* gone already */ }
}
console.log(`\n${passed} passed, ${failed.length} failed`);
for (const f of failed) console.log('  ✗ ' + f);
process.exit(failed.length ? 1 : 0);
