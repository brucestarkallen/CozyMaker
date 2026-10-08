/* CozyMaker — js/merge.js
 *
 * TWO COPIES OF ONE WORLD, PUT TOGETHER (v2.5; Cozy Chat v5.27.0's merge, shaped for a
 * world). The device holds the work; every page holds the copy it last read. A tab left
 * open for days, or the same world open in Opera and in Chrome, each saved its WHOLE copy,
 * and the last to save wrote over the other's newer work without a word. The server now
 * refuses a save made from an older copy and hands back the copy it has; the page puts
 * the two together here, from the copy both began with:
 *
 *   — what only one side changed is taken from that side;
 *   — a list of things with ids (documents, conversations, connections, hand edits) is
 *     put together thing by thing: one added on either side is kept, one taken out on one
 *     side and untouched on the other goes;
 *   — a conversation carried further on one side is that conversation; carried on
 *     differently on both, it keeps every message of both;
 *   — what both sides changed differently is a true conflict: this page's version stands
 *     (the latest hand on it), and the caller keeps the other side's whole copy beside it,
 *     so nothing is ever lost.
 *
 * What only says where a page is (which conversation is open, the newest sections) and
 * the stamps the server writes are never a conflict. Pure: no store, no fetch.
 */

const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isIdList = (v) => Array.isArray(v) && v.every((e) => isObj(e) && typeof e.id === 'string' && e.id);
/* a conversation's messages carry no id, but each its moment (at) and its role: one
 * message is one role at one moment — known again in both copies wherever it stands */
const stampOf = (e) => `${e.role || ''}@${e.at}`;
const isStampList = (v) => Array.isArray(v) && v.every((e) => isObj(e) && Number.isFinite(e.at)) && new Set(v.map(stampOf)).size === v.length;
const byId = (e) => e.id;

/* where a page is, and the stamps: this page's own, or the later one, never a conflict */
const PAGE_OWN = new Set(['openChat', 'recentSections']);
const STAMPS = new Set(['updated']);

/* one list carried further than the other: the longer one, which holds the shorter */
function carriedOn(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((x, i) => same(x, long[i])) ? long : null;
}
/* both carried on from where they began, differently (a conversation talked on in two
 * windows): where they began, then what the other window added, then this page's —
 * every message of both, each window's own in its own order */
function bothCarriedOn(b, l, r) {
  if (!Array.isArray(b) || !Array.isArray(l) || !Array.isArray(r)) return null;
  const startsWithBase = (list) => list.length >= b.length && b.every((x, i) => same(x, list[i]));
  return startsWithBase(l) && startsWithBase(r) ? b.concat(r.slice(b.length), l.slice(b.length)) : null;
}

export function merge3(B, L, R, conflicts = [], path = '') {
  const b0 = isObj(B) ? B : {};
  const l0 = isObj(L) ? L : {};
  const r0 = isObj(R) ? R : {};
  const out = {};
  for (const k of new Set([...Object.keys(b0), ...Object.keys(l0), ...Object.keys(r0)])) {
    const b = b0[k], l = l0[k], r = r0[k];
    let v;
    if (STAMPS.has(k)) v = Math.max(Number(l) || 0, Number(r) || 0) || l || r;
    else if (PAGE_OWN.has(k)) v = l !== undefined ? l : r;
    else {
      const lc = !same(l, b), rc = !same(r, b);
      if (!lc) v = r;
      else if (!rc || same(l, r)) v = l;
      else if (isIdList(l) && isIdList(r) && (b === undefined || isIdList(b))) v = mergeById(Array.isArray(b) ? b : [], l, r, conflicts, `${path}${k}`);
      /* MESSAGES, KNOWN BY THEIR MOMENT. A window that lands a reply also marks an older
       * reply's way back too old to keep (capUndo), so by position the two windows' talk
       * no longer began the same and every message of the other's would have been a clash;
       * known by role and moment, each message is put together on its own, in the order
       * they were said */
      else if (isStampList(l) && isStampList(r) && (b === undefined || isStampList(b))) {
        v = mergeById(Array.isArray(b) ? b : [], l, r, conflicts, `${path}${k}`, stampOf).sort((x, y) => x.at - y.at);
      }
      else if (isObj(l) && isObj(r)) v = merge3(isObj(b) ? b : {}, l, r, conflicts, `${path}${k}.`);
      else {
        const longer = carriedOn(l, r) || bothCarriedOn(b, l, r);
        if (longer) v = longer;
        else { v = l; conflicts.push(`${path}${k}`); }
      }
    }
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function mergeById(B, L, R, conflicts = [], path = '', keyOf = byId) {
  const index = (list) => new Map(list.map((e) => [keyOf(e), e]));
  const bm = index(B), lm = index(L), rm = index(R);
  const order = L.map(keyOf).concat(R.map(keyOf).filter((id) => !lm.has(id)));
  const out = [];
  for (const id of order) {
    const b = bm.get(id), l = lm.get(id), r = rm.get(id);
    if (l && r) out.push(same(l, b) ? r : same(r, b) ? l : merge3(b || {}, l, r, conflicts, `${path}[${id}].`));
    else if (l) { if (!b || !same(l, b)) out.push(l); }      /* gone there: kept only if changed here */
    else if (r) { if (!b || !same(r, b)) out.push(r); }      /* gone here: kept only if changed there */
  }
  return out;
}

/* A world, put together: { world, conflicts } — conflicts names each part both sides
 * changed differently (this page's version stands in world). */
export function mergeWorlds(base, local, remote) {
  const conflicts = [];
  const world = merge3(base || {}, local || {}, remote || {}, conflicts, '');
  /* A DOCUMENT'S NAME IS ITS ADDRESS — every change names the document it is for — so
   * one name is one document. Two windows that each started one under the same name
   * keep this page's here; the other window's is in its copy kept beside, and the
   * clash is said like any other. */
  if (Array.isArray(world.docs)) {
    const mine = new Set(((local && local.docs) || []).map((d) => d && d.id));
    const seen = new Map();
    for (const d of world.docs) {
      const name = d && d.name;
      if (!name) continue;
      const at = seen.get(name);
      if (!at) { seen.set(name, d); continue; }
      const keep = mine.has(at.id) || !mine.has(d.id) ? at : d;
      seen.set(name, keep);
      conflicts.push(`docs[${name}]`);
    }
    world.docs = world.docs.filter((d) => !(d && d.name) || seen.get(d.name) === d);
  }
  return { world, conflicts };
}
