/* CozyMaker — js/doc/entries.js
 *
 * WORLDBOOK ENTRIES, WRITTEN AS PLAIN DATA.
 *
 * A worldbook is a JSON list. The keeper's craft (the extension's, carried over
 * as it is) has it change one through the block of changes — an append whose
 * value is the new entries, a find and replace on the text — which means a list
 * of entries written INSIDE a JSON string: every quote in every entry escaped
 * twice. One quote left bare voided the whole change, and the keeper, asked
 * again in the same form, slipped the same way (reproduced through the real
 * turn: the change refused twice, the entries lost). That is the fault v1.2.0
 * took out of plot essentials by having a whole document written plainly.
 *
 * So the keeper may also hand its entries over as data, in the same block:
 *
 *   {"file": "Ash Harbour.json", "entries": [ {"name": "Aldric", …}, … ]}
 *
 * Each entry is put in BY ITS NAME: a name not in the worldbook is added whole;
 * a name already there is that entry changed — the fields given replace those
 * fields, and every field left out stays exactly as it was, so changing an
 * entry's keys can never wipe its content. Code does the joining, the list
 * stays one list, and nothing is ever escaped twice. */

import { readWorldbook } from './lint.js';

/* One entry in the house's own shape: an entry written in SillyTavern's (key,
 * comment, constant, a numbered position) is read for what its fields mean, the
 * way the house reads every worldbook. */
function shaped(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const st = 'key' in e || 'constant' in e || typeof e.position === 'number' || ('comment' in e && !('name' in e));
  if (!st) return { ...e };
  const read = readWorldbook(JSON.stringify([e]));
  return read.ok && read.entries[0] ? { ...read.entries[0] } : null;
}

function nameOf(e) { return String((e && e.name) || '').trim(); }

function listed(names) {
  const shown = names.slice(0, 6).join(', ');
  return names.length > 6 ? `${shown} and ${names.length - 6} more` : shown;
}

/* Put the given entries into a worldbook's text. Pure: text in, text out.
 * Returns { ok, text, how, was, now } or { ok: false, why }. */
export function putEntries(text, given) {
  const src = String(text || '');
  if (!Array.isArray(given) || !given.length) return { ok: false, why: 'the change carried no entries' };
  const incoming = [];
  for (const raw of given) {
    const e = shaped(raw);
    if (!e) return { ok: false, why: 'one of the entries was not an entry — each one is an object with a name' };
    if (!nameOf(e)) return { ok: false, why: 'an entry came with no name, so there was nowhere to put it' };
    incoming.push(e);
  }

  let list = [];
  if (src.trim()) {
    const read = readWorldbook(src);
    if (!read.ok) return { ok: false, why: `the worldbook cannot be read as data right now (${read.why}), so the entries could not be put in` };
    list = read.entries.map((x) => (x && typeof x === 'object' ? { ...x } : x));
  }

  const added = [], changed = [], was = [], now = [];
  for (const e of incoming) {
    const name = nameOf(e);
    let at = list.findIndex((x) => nameOf(x) === name);
    if (at === -1) {
      const low = name.toLowerCase();
      const hits = list.map((x, i) => (nameOf(x).toLowerCase() === low ? i : -1)).filter((i) => i !== -1);
      if (hits.length === 1) at = hits[0];
    }
    if (at === -1) {
      if (!String(e.content || '').trim()) return { ok: false, why: `the new entry ${name} came with no content` };
      list.push(e);
      added.push(name);
      now.push(e);
      continue;
    }
    /* a change: the fields given replace those fields; the rest stay */
    const old = list[at];
    const next = { ...old, ...e, name: nameOf(old) };
    if (JSON.stringify(next) === JSON.stringify(old)) continue;
    list[at] = next;
    if (!changed.includes(nameOf(old))) changed.push(nameOf(old));
    was.push(old);
    now.push(next);
  }

  if (!added.length && !changed.length) return { ok: false, why: 'those entries are already in the document exactly as written' };
  const how = [added.length ? `added ${listed(added)}` : '', changed.length ? `changed ${listed(changed)}` : ''].filter(Boolean).join('; ');
  return {
    ok: true,
    text: JSON.stringify(list, null, 2),
    how,
    was: was.length ? JSON.stringify(was.length === 1 ? was[0] : was, null, 2) : '',
    now: JSON.stringify(now.length === 1 ? now[0] : now, null, 2),
    added, changed,
  };
}
