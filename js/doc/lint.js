import { lintTransplant } from './transplant.js';
import { stripTrailingCommasOutsideStrings, escapeRawControlsInStrings, escapeStrayQuotes } from './edits.js';
import { parseWorldbook } from './worldbook.js';
/* CozyMaker — js/doc/lint.js
 *
 * The checks that need no model at all: they are arithmetic and shape, they
 * run in a few milliseconds on every write, they cost nothing, and they are
 * never wrong about whether e014 comes after e013.
 *
 * THE RULE: if this file can see a problem, it fixes it. A finding that only
 * tells the writer something is wrong has handed him a chore, and he did not
 * come here to do chores. So every check either repairs the text itself — when
 * the repair is certain — or names the worker whose job it is, and that worker
 * is sent to do it without anyone being asked.
 *
 * Nothing here guesses. A repair that could destroy meaning is not a repair;
 * it is a worker's job, and it is handed over as one.
 */

/* Anything that must never survive into a document the storyteller reads.
 * These are the maker's own working notes leaking into the deliverable — the
 * storyteller reads them as story and breaks. */
/* THE CRAFT'S ALERTS ARE WORKING NOTES; A ONE-WORD TAG IS HIS DOCUMENT'S. Every
 * alert the craft raises is two words or more, joined (EPISTEMIC_VIOLATION,
 * STALE_WORLD_STATE, PARROT_FIX …). A single word in brackets is not: the
 * craft's own Fog of War writes [HIDDEN] into the plot essential as its value
 * (7.4), a template says [TITLE], and his own document may mark [FLASHBACK] or
 * [SECRET]. The first version removed every capitalised tag, [HIDDEN] with it. */
const ALERT_TAG = /\[[A-Z][A-Z0-9]*_[A-Z0-9_]+\]/g;
const CHORE_LINES = [
  /^\s*add to NEW CHARACTERS\s*$/gim,
  /^\s*(UNRESOLVED|TBD|needs verification)\s*:?.*$/gim,
  /^\s*Step \d+ found.*$/gim,
];
const EVENT_LINE = /^(\s*)(e\d{3,})(\s*[-–]\s*(\d{3,}))?\s*(\[[^\]]*\])?/;
const DATE_STAMP = /\[\s*(?:[A-Z][a-z]{2,8}\s+)?\d{1,2}\s+[A-Za-z]{3,12}\s+\d{1,5}[^\]]*\]/;
const SCORES_NOW = /\(\s*now\s*:\s*P\s*:\s*(-?\d+)\s+R\s*:\s*(-?\d+)\s+S\s*:\s*(-?\d+)\s*\)/gi;
const SCORES_BARE = /\(\s*P\s*:\s*(-?\d+)\s+R\s*:\s*(-?\d+)\s+S\s*:\s*(-?\d+)\s*\)/gi;

export const THRESHOLDS = { healthy: 6000, mature: 8000, bloated: 10000 };

function clamp(n) { return Math.max(0, Math.min(100, n)); }

function finding(check, said, opts = {}) {
  return { check, said, repaired: !!opts.repaired, worker: opts.worker || null, count: opts.count || 1 };
}

/* ------------------------------------------------------------------ counts */

/* The spec's "nothing disappeared" check, as a guard on every write rather
 * than a thing anyone has to remember to run. */
export function countOf(text, kind = 'pe') {
  const src = String(text || '');
  if (kind === 'worldbook') {
    let n = 0;
    try { const v = JSON.parse(src || '[]'); n = Array.isArray(v) ? v.length : 0; } catch (_) { n = -1; }
    return { entries: n };
  }
  const events = new Set();
  let dossiers = 0;
  let bonds = 0;
  let inDossier = false;
  let counted = false;
  for (const line of src.split('\n')) {
    const m = EVENT_LINE.exec(line);
    if (m) events.add(m[2]);
    if (/^\s*→\s*\S/.test(line)) bonds++;
    /* A DOSSIER IS A PERSON, NOT EVERY HEADING. Counting every "###" would
     * count "### Rules" and "### Calendar" as people, and then a rewrite that
     * legitimately drops one empty world topic would be refused as if it had
     * deleted a character. A heading is a dossier when somebody's body or
     * behaviour is written under it. */
    if (/^#{2,3}\s+\S/.test(line)) { inDossier = true; counted = false; continue; }
    if (inDossier && !counted && /^\s*(ID|CORE)\s*:/i.test(line)) { dossiers++; counted = true; }
  }
  return { events: events.size, dossiers, bonds };
}

/* Did this write lose something it should not have? Returns null when fine. */
export function lostSomething(beforeText, afterText, kind = 'pe') {
  /* A TRANSPLANT LOSES DATA THROUGH ITS MARKERS. Its importer reads markers
   * exactly and silently drops what a broken one holds, so a change that
   * leaves more broken markers than it found is a loss, whatever it deleted
   * on purpose. Removing a whole block cleanly is not. */
  if (kind === 'transplant') {
    const bad = (t) => lintTransplant(t).issues.filter((x) => x.sev === 'error').length;
    const more = bad(afterText) - bad(beforeText);
    return more > 0 ? `${more} marker${more === 1 ? '' : 's'} the importer could no longer read (it would drop what ${more === 1 ? 'it holds' : 'they hold'})` : null;
  }
  /* instructions and notes have no shape code can count */
  if (kind === 'instructions' || kind === 'notes') return null;
  const a = countOf(beforeText, kind);
  const b = countOf(afterText, kind);
  const lost = [];
  for (const key of Object.keys(a)) {
    if (a[key] < 0 || b[key] < 0) continue;
    if (b[key] < a[key]) lost.push(`${a[key] - b[key]} ${key}`);
  }
  return lost.length ? lost.join(', ') : null;
}

/* ------------------------------------------------------------------- pass */

/* Run every check. Returns the repaired text and what happened. */
/* Kinds this house does not reshape: a Summaryception transplant is a marker
 * file its importer reads exactly (tidying it is how data gets dropped), and
 * instructions and notes are his own words in his own shape. */
export const UNTOUCHED_KINDS = ['instructions', 'notes'];

/* A TRANSPLANT GETS THE ONE REPAIR THAT IS CERTAIN. Its importer reads marker
 * names case-sensitively, so a marker written "sc-ledger" is silently skipped
 * and what it holds is lost; written "SC-LEDGER" it is read. Nothing else in
 * a transplant is touched by code: the rest needs the auditor's judgment. */
function lintTransplantMarkers(text) {
  const src = String(text || '');
  let n = 0;
  const out = src.replace(/<!--(\s*)(\/?)(sc-(?:transplant|notepad|ledger|snippet|pin))\b/gi, (m, sp, slash, name) => {
    const want = name.toUpperCase();
    if (name === want) return m;
    n++;
    return `<!--${sp}${slash}${want}`;
  });
  const found = n ? [finding('transplant markers in the wrong case', `${n} transplant marker${n > 1 ? 's' : ''} written in the wrong case ${n > 1 ? 'were' : 'was'} put in the case the importer reads`, { repaired: true, count: n })] : [];
  return { text: out, found, changed: out !== src };
}
function lintNothing(text) { return { text: String(text || ''), found: [], changed: false }; }

/* keep: the words that were his before the crew touched the document. What was
 * already there (a "TBD:" line, a bond, an empty heading he is about to fill) is
 * never taken out; only what the crew left behind this time is. With keep equal
 * to the whole text (his own typing), none of those are removed. The one
 * exception is the craft's multi-word alert markers, which are never story. */
export function lint(text, { kind = 'pe', deliverable = true, keep = null } = {}) {
  if (kind === 'transplant') return lintTransplantMarkers(text);
  if (UNTOUCHED_KINDS.includes(kind)) return lintNothing(text);
  let src = String(text || '');
  const found = [];

  if (kind === 'worldbook') return lintWorldbook(src);

  /* 1 — the maker's working notes must never be in the document itself. */
  if (deliverable) {
    const had = keep == null ? null : String(keep);
    /* the craft's own alert markers are machine diagnostics, never story, and
     * come out whoever put them there; everything else below is kept if it was his */
    const tags = src.match(ALERT_TAG);
    if (tags && tags.length) {
      src = src.replace(ALERT_TAG, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '');
      found.push(finding('working notes in the document',
        `took out ${tags.length} of the maker's own markers that had ended up inside the text`,
        { repaired: true, count: tags.length }));
    }
    let chores = 0;
    for (const re of CHORE_LINES) {
      src = src.replace(re, (line) => {
        if (had && had.includes(line.trim())) return line;
        chores++;
        return '';
      });
    }
    if (chores) {
      found.push(finding('a note to somebody inside the document',
        `took out ${chores} line${chores > 1 ? 's' : ''} that were instructions rather than story`,
        { repaired: true, count: chores }));
    }
  }

  /* 2 — a dossier for the main character never carries bonds. */
  const mc = mcSpan(src);
  if (mc) {
    const body = src.slice(mc.from, mc.to);
    const was = keep == null ? null : String(keep);
    const stripped = body.replace(/^\s*→\s*.*$/gm, (l) => (was && was.includes(l.trim()) ? l : ''));
    if (stripped !== body) {
      const n = body.split('\n').filter((l) => /^\s*→\s*\S/.test(l) && !(was && was.includes(l.trim()))).length;
      src = src.slice(0, mc.from) + stripped.replace(/\n{3,}/g, '\n\n') + src.slice(mc.to);
      found.push(finding('bonds on the main character',
        `moved ${n} bond line${n > 1 ? 's' : ''} off the main character — how he feels belongs in the scene and in what he does`,
        { repaired: true, count: n }));
    }
  }

  /* 3 — scores live between nought and a hundred. */
  let clamped = 0;
  const fixScores = (whole, p, r, s, wrapper) => {
    const np = clamp(+p), nr = clamp(+r), ns = clamp(+s);
    if (np === +p && nr === +r && ns === +s) return whole;
    clamped++;
    return wrapper(np, nr, ns);
  };
  src = src.replace(SCORES_NOW, (w, p, r, s) => fixScores(w, p, r, s, (a, b, c) => `(now: P:${a} R:${b} S:${c})`));
  src = src.replace(SCORES_BARE, (w, p, r, s) => fixScores(w, p, r, s, (a, b, c) => `(P:${a} R:${b} S:${c})`));
  if (clamped) {
    found.push(finding('a score outside its range',
      `brought ${clamped} score${clamped > 1 ? 's' : ''} back inside nought to a hundred`,
      { repaired: true, count: clamped }));
  }

  /* 4 — a heading with nothing under it is scaffolding, not content. */
  const emptied = removeEmptySections(src, keep == null ? null : String(keep));
  if (emptied.removed.length) {
    src = emptied.text;
    found.push(finding('an empty heading',
      `took out ${emptied.removed.length} heading${emptied.removed.length > 1 ? 's' : ''} with nothing under them (${emptied.removed.join(', ')})`,
      { repaired: true, count: emptied.removed.length }));
  }

  /* 5 — events: numbering, order, and a date on every one. These cannot be
   *     repaired from here without inventing something, so the chronicler is
   *     sent to do them. */
  const ev = readEvents(src);
  if (ev.duplicates.length) {
    found.push(finding('the same event number twice',
      `${ev.duplicates.join(', ')} appear${ev.duplicates.length > 1 ? '' : 's'} more than once`,
      { worker: 'chronicler', count: ev.duplicates.length }));
  }
  if (ev.outOfOrder.length) {
    found.push(finding('events out of order',
      `${ev.outOfOrder.join(', ')} come after a later number`,
      { worker: 'chronicler', count: ev.outOfOrder.length }));
  }
  if (ev.undated.length) {
    found.push(finding('an event with no date',
      `${ev.undated.slice(0, 6).join(', ')}${ev.undated.length > 6 ? ` and ${ev.undated.length - 6} more` : ''} have no day and time`,
      { worker: 'chronicler', count: ev.undated.length }));
  }

  /* 6 — a name inside a trait line belongs with the bond, not the trait. */
  const bleed = namedPersonGate(src);
  if (bleed.length) {
    found.push(finding('a name inside a character trait',
      `${bleed.slice(0, 4).join(', ')}${bleed.length > 4 ? ` and ${bleed.length - 4} more` : ''} describe who someone knows inside the line about who they are`,
      { worker: 'editor', count: bleed.length }));
  }

  /* 7 — size. */
  const tokens = Math.ceil(src.length / 4);
  if (tokens >= THRESHOLDS.bloated) {
    found.push(finding('the document has grown heavy',
      `about ${tokens.toLocaleString()} tokens — past the point where it starts crowding the storyteller`,
      { worker: 'compressor' }));
  }

  src = src.replace(/\n{4,}/g, '\n\n\n').replace(/[ \t]+$/gm, '');
  return { text: src, found, changed: src !== String(text || '') };
}

/* WHAT CODE CAN READ, CODE REPAIRS (the Plot Essential Maker's Validate &
 * repair; his rule: the app repairs what it detects). A trailing comma or a raw
 * line break inside a value is put right by the same string-aware repairs the
 * edits use; a list wrapped as {entries:[…]} or SillyTavern's numbered map is
 * made one list. Only what no rule can read goes to the worldbook keeper. */
/* A LIST AFTER A LIST IS ONE LIST. The keeper's own craft says to begin an
 * empty worldbook with an append whose value is a list, and a model adding
 * entries often appends another list after the one that is there: "[] [ … ]"
 * or "[a] [b]". What that means is certain — more entries — so code joins
 * them. Only lists and entries, one after another, with nothing but spaces
 * and commas between; anything else is not ours to guess, and goes to the
 * keeper as before. */
function valuesInARow(text) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { if (depth === 0) return null; inStr = true; continue; }
    if (c === '[' || c === '{') { if (depth === 0) start = i; depth++; continue; }
    if (c === ']' || c === '}') { depth--; if (depth < 0) return null; if (depth === 0) out.push(text.slice(start, i + 1)); continue; }
    if (depth === 0 && !/[\s,]/.test(c)) return null;
  }
  return depth === 0 && !inStr ? out : null;
}
function readOneValue(t) {
  for (const c of [t, stripTrailingCommasOutsideStrings(t), escapeRawControlsInStrings(stripTrailingCommasOutsideStrings(t)),
    stripTrailingCommasOutsideStrings(escapeRawControlsInStrings(escapeStrayQuotes(t)))]) {
    try { return { ok: true, v: JSON.parse(c) }; } catch (_) { /* the next repair */ }
  }
  return { ok: false };
}
const LOOKS_LIKE_ENTRY = (o) => o && typeof o === 'object' && !Array.isArray(o) && ['name', 'keys', 'key', 'content', 'comment'].some((k) => k in o);
function listsInARow(text) {
  const pieces = valuesInARow(text);
  if (!pieces || pieces.length < 2) return null;
  const all = [];
  for (const piece of pieces) {
    const r = readOneValue(piece);
    if (!r.ok) return null;
    const v = r.v;
    if (Array.isArray(v)) all.push(...v);
    else if (v && Array.isArray(v.entries)) all.push(...v.entries);
    else if (v && v.entries && typeof v.entries === 'object') all.push(...Object.values(v.entries));
    else if (LOOKS_LIKE_ENTRY(v)) all.push(v);
    else return null;
  }
  return all;
}

export function readWorldbook(src) {
  const text = String(src || '').trim() || '[]';
  let v, fixed = false;
  try { v = JSON.parse(text); } catch (_) {
    try { v = JSON.parse(escapeRawControlsInStrings(stripTrailingCommasOutsideStrings(text))); fixed = true; }
    catch (e) {
      const joined = listsInARow(text);
      if (!joined) return { ok: false, why: 'it is not valid JSON right now' };
      v = joined;
      fixed = true;
    }
  }
  let list = null, wrapped = false;
  if (Array.isArray(v)) list = v;
  else if (v && Array.isArray(v.entries)) { list = v.entries; wrapped = true; }
  else if (v && v.entries && typeof v.entries === 'object') { list = Object.values(v.entries); wrapped = true; }
  if (!list) return { ok: false, why: 'it should be one list of entries' };
  /* SillyTavern's own fields are read for what they mean, by the extension's
   * own reading: constant is always-on, key is keys, comment is the name, a
   * numeric position is a place, a number written as a string is a number */
  const stFields = list.some((e) => e && typeof e === 'object' &&
    ('key' in e || 'constant' in e || typeof e.position === 'number' || ('comment' in e && !('name' in e))));
  if (stFields) return { ok: true, entries: parseWorldbook(JSON.stringify(list)).entries, fixed, reshaped: true };
  return { ok: true, entries: list, fixed, reshaped: wrapped };
}

function lintWorldbook(src) {
  const found = [];
  const read = readWorldbook(src);
  if (!read.ok) {
    found.push(finding('the worldbook is not readable as data', read.why, { worker: 'worldbook' }));
    return { text: src, found, changed: false };
  }
  const entries = read.entries;
  let repaired = 0;
  let reread = 0;
  if (read.fixed) { found.push(finding('the worldbook data was put right', 'a trailing comma or a raw line break inside a value', { repaired: true })); reread++; }
  if (read.reshaped) { found.push(finding('the worldbook was made one list of entries', 'it was wrapped in another shape', { repaired: true })); reread++; }
  const seen = new Map();
  const dupes = [];
  const keyless = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const name = String(e.name || '').trim();
    if (name) { if (seen.has(name)) dupes.push(name); else seen.set(name, true); }
    const strat = String(e.strategy || '').toLowerCase();
    if (!['blue', 'green', 'chain'].includes(strat)) { e.strategy = 'green'; repaired++; }
    if (e.strategy === 'green' && (!Array.isArray(e.keys) || !e.keys.filter(Boolean).length)) {
      keyless.push(name || 'an unnamed entry');
    }
    for (const [k, lo, hi] of [['order', 0, 1000], ['depth', 0, 100], ['probability', 0, 100]]) {
      if (e[k] !== undefined && Number.isFinite(+e[k])) {
        const v = Math.max(lo, Math.min(hi, Math.round(+e[k])));
        if (v !== +e[k]) { e[k] = v; repaired++; }
      }
    }
  }
  if (repaired) found.push(finding('an entry set up wrong', `put ${repaired} setting${repaired > 1 ? 's' : ''} back in range`, { repaired: true, count: repaired }));
  if (dupes.length) found.push(finding('two entries with the same name', dupes.join(', '), { worker: 'worldbook', count: dupes.length }));
  if (keyless.length) found.push(finding('an entry that can never fire', `${keyless.join(', ')} ${keyless.length > 1 ? 'have' : 'has'} no words to trigger on`, { worker: 'worldbook', count: keyless.length }));
  const text = repaired || reread ? JSON.stringify(entries, null, 2) : src;
  return { text, found, changed: text !== src };
}

/* -------------------------------------------------------------- the parts */

function mcSpan(src) {
  const lines = src.split('\n');
  let from = -1, at = 0, fromChar = -1;
  for (let i = 0; i < lines.length; i++) {
    if (from === -1 && /^##\s+MC\s*[—-]/i.test(lines[i])) { from = i; fromChar = at; }
    else if (from !== -1 && /^##?#?\s+\S/.test(lines[i]) && i > from) {
      return { from: fromChar, to: at };
    }
    at += lines[i].length + 1;
  }
  return from === -1 ? null : { from: fromChar, to: src.length };
}

/* A HEADING IS EMPTY ONLY WHEN NOTHING LIVES UNDER IT AT ALL — and a heading
 * whose children are other headings is not empty, it is a grouping.
 *
 * The first version of this read a section's body as "everything up to the
 * next heading of any level", which made "## WORLD" empty in every plot
 * essential ever written, because what follows it is "### Rules". It deleted
 * the WORLD heading on every save. So: a heading owns everything down to the
 * next heading at its own level or higher, descendants included, and it is
 * empty only when that whole stretch holds nothing but blanks, dividers and
 * other empty headings. When a parent is empty its children are too, so only
 * the outermost one is taken out, and only it is reported. */
function removeEmptySections(src, had = null) {
  const lines = src.split('\n');
  const heads = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(\S.*)$/.exec(lines[i]);
    if (m) heads.push({ line: i, level: m[1].length, title: m[2] });
  }
  if (!heads.length) return { text: src, removed: [] };

  for (let n = 0; n < heads.length; n++) {
    let end = lines.length;
    for (let k = n + 1; k < heads.length; k++) {
      if (heads[k].level <= heads[n].level) { end = heads[k].line; break; }
    }
    heads[n].end = end;
  }

  const headLines = new Set(heads.map((h) => h.line));
  for (const h of heads) {
    h.empty = true;
    for (let i = h.line + 1; i < h.end; i++) {
      if (headLines.has(i)) continue;
      if (lines[i].replace(/[-\s]/g, '') !== '') { h.empty = false; break; }
    }
  }

  const drop = new Set();
  const removed = [];
  for (const h of heads) {
    if (!h.empty || drop.has(h.line)) continue;
    if (had && had.split('\n').some((l) => l.trim() === lines[h.line].trim())) continue;   /* his heading, kept for him to fill */
    removed.push(h.title.split('(')[0].trim());
    for (let i = h.line; i < h.end; i++) drop.add(i);
  }
  if (!removed.length) return { text: src, removed };

  const out = lines.filter((_, i) => !drop.has(i));
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), removed };
}

export function readEvents(src) {
  const ids = [];
  const undated = [];
  const seen = new Map();
  const duplicates = [];
  for (const line of String(src || '').split('\n')) {
    const m = EVENT_LINE.exec(line);
    if (!m) continue;
    const id = m[2];
    ids.push(id);
    if (seen.has(id)) { if (!duplicates.includes(id)) duplicates.push(id); } else seen.set(id, true);
    if (!DATE_STAMP.test(line)) undated.push(id);
  }
  const outOfOrder = [];
  let high = -1;
  for (const id of ids) {
    const n = parseInt(id.slice(1), 10);
    if (n < high) outOfOrder.push(id);
    else high = n;
  }
  return { ids, duplicates, outOfOrder, undated };
}

/* A trait line that leans on a name is really a bond line. Only flags names
 * that actually have a dossier in this document, so an ordinary word is never
 * mistaken for a person. */
export function namedPersonGate(src) {
  const names = [];
  for (const line of String(src || '').split('\n')) {
    const m = /^###\s+([^(|—-]+)/.exec(line);
    if (m) { const n = m[1].trim(); if (n.length >= 3) names.push(n); }
    const mc = /^##\s+MC\s*[—-]\s*([^(]+)/i.exec(line);
    if (mc) { const n = mc[1].trim(); if (n.length >= 3) names.push(n); }
  }
  if (!names.length) return [];
  const hits = [];
  let owner = '';
  for (const line of String(src || '').split('\n')) {
    const h = /^###\s+([^(|—-]+)/.exec(line);
    if (h) owner = h[1].trim();
    /* THE MAIN CHARACTER'S HEADING NAMES AN OWNER TOO. Without this his CORE
     * line is attributed to whichever dossier happened to come before him, or
     * to nobody at all, and the report reads "a dossier mentions Claire". */
    const m = /^##\s+MC\s*[—-]\s*([^(]+)/i.exec(line);
    if (m) owner = m[1].trim();
    if (!/^\s*CORE\s*:/i.test(line)) continue;
    for (const n of names) {
      if (n === owner) continue;
      if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(line)) {
        hits.push(`${owner || 'a dossier'} mentions ${n}`);
        break;
      }
    }
  }
  return hits;
}
