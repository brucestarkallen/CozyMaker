/* CozyMaker — tests/saves.mjs
 * The save path, run for real against an in-process stand-in for serve.py
 * that can be switched off and on. Every check reads what reached the "disk". */

import * as store from '../js/store.js';

let passed = 0; const failed = [];
const ok = (name, cond, detail = '') => { if (cond) passed++; else failed.push(`${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms) => Promise.race([p, sleep(ms).then(() => 'TIMED OUT')]);

const disk = new Map();
let down = false;
const resp = (status, body) => ({ ok: status < 300, status, json: async () => body });
globalThis.fetch = async (path, opts = {}) => {
  const method = opts.method || 'GET';
  if (down) throw new TypeError('Failed to fetch');
  const m = /^\/api\/project\/(.+)$/.exec(path);
  if (m) {
    if (method === 'GET') return disk.has(m[1]) ? resp(200, JSON.parse(disk.get(m[1]))) : resp(404, { error: 'not found' });
    if (method === 'PUT') { disk.set(m[1], opts.body); return resp(200, { ok: true }); }
    if (method === 'DELETE') { disk.delete(m[1]); return resp(200, { ok: true }); }
  }
  return resp(404, {});
};
const onDisk = (id) => (disk.has(id) ? JSON.parse(disk.get(id)) : null);
const put = (w) => disk.set(w.id, JSON.stringify(w));

put({ id: 'A', title: 'A1', docs: [], chats: [] });
put({ id: 'B', title: 'B1', docs: [], chats: [] });
put({ id: 'C', title: 'C1', docs: [], chats: [] });

await store.openProject('A');
await store.setProject({ ...store.getProject(), title: 'A2' }, { now: true });
ok('a save lands', onDisk('A').title === 'A2');

down = true;
await store.setProject({ ...store.getProject(), title: 'A3' }, { now: true });
ok('a save that does not land is known', store.saveTrouble() === true);
ok('and its copy is kept, not dropped', store.unsavedWorlds().includes('A'));
ok('the device still has the last good copy', onDisk('A').title === 'A2');
down = false;
await store.flush();
ok('when the server is back, it lands', onDisk('A').title === 'A3');
ok('and the house stops saying it is unsaved', store.saveTrouble() === false && store.unsavedWorlds().length === 0);

/* switching worlds after a failed save loses nothing */
down = true;
await store.setProject({ ...store.getProject(), title: 'A4' }, { now: true });
await store.openProject('A');
ok('a world with unsaved changes reopens from its own copy, even with the server down',
  store.getProject().title === 'A4', store.getProject().title + ' / device ' + onDisk('A').title);
down = false;
await store.openProject('B');
ok('another world opens once the server is back', store.getProject().id === 'B');
await store.flush();
ok('the first world\'s unsaved copy reached the device, not lost in the switch', onDisk('A').title === 'A4');

/* a deleted world is never resurrected by a retry */
down = true;
await store.setProject({ ...store.getProject(), title: 'A5' }, { now: true });
down = false;
await store.deleteProject('A');
await store.flush();
await sleep(50);
ok('a world deleted while its save waited stays deleted', !disk.has('A'));

/* a world not on screen: "not found" means deleted; anything else is waited out */
await store.openProject('B');
const gone = await within(store.updateWorld('nowhere', (w) => w), 3000);
ok('only "not found" means a world is gone', gone && gone.gone === true, JSON.stringify(gone));
down = true;
const landing = store.updateWorld('C', (w) => ({ ...w, title: 'C-landed' }));
await sleep(200);
ok('an outage is not taken for a deletion', store.saveTrouble() === true);
down = false;
const landed = await within(landing, 8000);
ok('a reply for a world not on screen lands once the server is back', landed && landed.ok === true, JSON.stringify(landed));
await store.flush();
ok('and it is on the device', onDisk('C').title === 'C-landed', JSON.stringify(onDisk('C')));

/* opened while its landing waited its turn — must not wait for ever */
put({ id: 'D', title: 'D1', docs: [], chats: [] });
down = true;
const later = store.updateWorld('D', (w) => ({ ...w, title: 'D-landed' }));
await sleep(100);
down = false;
await store.openProject('D');
const res = await within(later, 8000);
ok('a world opened while its landing waited does not hang', res !== 'TIMED OUT', String(res));
ok('the landing is on the screen', store.getProject().title === 'D-landed', store.getProject().title);
await store.flush();
ok('and on the device', onDisk('D').title === 'D-landed');

/* a change that throws never hangs its caller and never stops later saves */
const bad = await within(store.updateWorld('B', () => { throw new Error('boom'); }), 3000);
ok('a failing change for a world not on screen reports, not hangs', bad && bad.error === 'boom', JSON.stringify(bad));
const badHere = await within(store.updateWorld(store.getProject().id, () => { throw new Error('bang'); }), 3000);
ok('a failing change on screen reports the same way', badHere && badHere.error === 'bang', JSON.stringify(badHere));
await store.setProject({ ...store.getProject(), title: 'D-after' }, { now: true });
ok('and every save after it still lands', onDisk('D').title === 'D-after', JSON.stringify(onDisk('D')));

console.log(`\n${passed} passed, ${failed.length} failed`);
for (const f of failed) console.log('  ✗ ' + f);
process.exit(failed.length ? 1 : 0);
