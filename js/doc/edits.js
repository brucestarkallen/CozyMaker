/* CozyMaker — js/doc/edits.js
 *
 * How a document changes. Never by being rewritten and sent back whole — that
 * is slow, it costs the writer money on every comma, and it is how a paragraph
 * he liked quietly disappears. A change names the exact words it is replacing.
 *
 * The laws that keep it honest:
 *   — a find must land in exactly ONE place. Two matches is a refusal with a
 *     reason, never a guess at which one was meant.
 *   — exact first; then the same text with its spacing and its quote marks
 *     normalized; then a close match, accepted only when it is clearly the
 *     best one in the document and clearly good enough. Anything short of
 *     that is refused and said out loud.
 *   — every applied change is written down with the words that were there
 *     before and a fingerprint of the words after. Undo refuses, loudly, if
 *     the text has moved since — it will not overwrite something newer.
 */

/* ------------------------------------------------------------ fingerprints */

export function hash(text) {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

/* ------------------------------------------------------------- the blocks */

export function findBlocks(text, tag) {
  const src = String(text || '');
  const low = src.toLowerCase();
  const open = '<' + tag + '>';
  const close = '</' + tag + '>';
  const out = [];
  let i = low.indexOf(open);
  while (i !== -1) {
    const j = low.indexOf(close, i + open.length);
    if (j === -1) break;
    out.push({ from: i, to: j + close.length, body: src.slice(i + open.length, j) });
    i = low.indexOf(open, j + close.length);
  }
  return out;
}

/* Models are not JSON printers. Repair what is safely repairable, and say so
 * when it is not. */
/* Drop trailing commas OUTSIDE string literals only — a blind ,\s*] regex
 * also deletes the comma inside a value such as "Options: [a, b, ]" (the
 * Plot Essential Maker's fix, carried over as it is). */
export function stripTrailingCommasOutsideStrings(s) {
  let out = '', inStr = false, escd = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (escd) { escd = false; continue; }
      if (c === '\\') { escd = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j < s.length && (s[j] === ']' || s[j] === '}')) continue;
    }
    out += c;
  }
  return out;
}

/* Raw line breaks and other control characters INSIDE string literals, which
 * models write constantly, escaped so the block still reads (the extension's
 * v0.11.11). Structure outside strings is not touched. */
export function escapeRawControlsInStrings(s) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\') { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      const code = c.charCodeAt(0);
      if (code < 0x20) { out += code === 8 ? '\\b' : code === 12 ? '\\f' : '\\u' + code.toString(16).padStart(4, '0'); continue; }
    }
    out += c;
  }
  return out;
}

function repairs(t) {
  const e = escapeRawControlsInStrings(t);
  return [t, stripTrailingCommasOutsideStrings(t), e, stripTrailingCommasOutsideStrings(e)];
}

export function tolerantJson(body) {
  const tries = [];
  const raw = String(body || '').trim();
  tries.push(raw);
  const fenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (fenced !== raw) tries.push(fenced);
  for (const base of [raw, fenced]) {
    const a = base.indexOf('[');
    const b = base.lastIndexOf(']');
    if (a !== -1 && b > a) tries.push(base.slice(a, b + 1));
  }
  const seen = new Set();
  for (const t of tries) {
    for (const candidate of repairs(t)) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      try {
        const v = JSON.parse(candidate);
        if (Array.isArray(v)) return { ok: true, value: v };
        if (v && typeof v === 'object') return { ok: true, value: [v] };
      } catch (_) { /* next */ }
    }
  }
  return { ok: false, error: 'the changes did not come through as readable data' };
}

/* ONE STRAY QUOTE MUST NOT VOID EVERY CHANGE (Cozy Chat v5.14.0). When the
 * block as a whole will not read, every complete change inside it is taken on
 * its own: walk the text keeping track of strings, cut out each top-level
 * object, and keep each one that reads. A second pass resynchronises at the
 * start of every line that opens a new object, so one broken string cannot
 * blind the scanner to everything after it. */
export function salvageEdits(body) {
  const src = String(body || '');
  const found = new Map();
  /* Each change is kept with WHERE it was written. The second pass can
   * recover a middle change after the first pass took the later ones, and
   * two changes to one passage must still land in the order they were
   * written. */
  const keep = (chunk, at) => {
    for (const c of repairs(chunk)) {
      try {
        const v = JSON.parse(c);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const key = JSON.stringify(v);
          const had = found.get(key);
          if (!had || at < had.at) found.set(key, { v, at });
          return;
        }
      } catch (_) { /* next */ }
    }
  };
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; continue; }
    if (c === '}' && depth > 0) { depth--; if (depth === 0 && start !== -1) { keep(src.slice(start, i + 1), start); start = -1; } }
  }
  let offset = 0;
  for (const part of src.split(/\n(?=\s*\{\s*")/)) {
    const a = part.indexOf('{');
    const b = part.lastIndexOf('}');
    if (a !== -1 && b > a) keep(part.slice(a, b + 1), offset + a);
    offset += part.length + 1;
  }
  return [...found.values()].sort((x, y) => x.at - y.at).map((x) => x.v);
}

/* How many changes the block meant to carry: every form of change carries
 * exactly one "replace" key ("file" may be left out, so it cannot be the
 * count). */
function changesMeant(body) {
  return (String(body || '').match(/"replace"\s*:/g) || []).length;
}

/* THE LAST BLOCK IS THE ANSWER (the Plot Essential Maker's findBlock: the LAST
 * opening tag with a closer, preferring one that holds data). Models draft on
 * the page — a plan, a block, "let me check", the block again — and applying
 * every block applies the same change twice, or nests a replacement inside
 * itself. Earlier blocks are set aside and that is said. A final block cut off
 * by the reply limit is still the final one: what arrived of it whole is used,
 * never an earlier draft in its place. */
const LOOKS_LIKE_DATA = /^\s*(\[|\{|```)/;
function readOne(body) {
  const r = tolerantJson(body);
  if (r.ok) return { edits: r.value.filter((e) => e && typeof e === 'object'), warn: '' };
  const got = salvageEdits(body);
  const lost = Math.max(changesMeant(body) - got.length, 0);
  if (!got.length) return { edits: [], warn: r.error };
  if (!lost) return { edits: got, warn: '' };
  return {
    edits: got,
    warn: `${lost === 1 ? 'one of the changes' : `${lost} of the changes`} could not be read and ${lost === 1 ? 'was' : 'were'} left out; ` +
      `${got.length === 1 ? 'the one that could be read was' : `the ${got.length} that could were`} used`,
  };
}
function draftsNote(n) {
  return n ? `${n === 1 ? 'an earlier block of changes' : `${n} earlier blocks of changes`} in the same answer ${n === 1 ? 'was' : 'were'} set aside as a draft — only the last one was used` : '';
}

export function parseEdits(text) {
  /* the extension's crafts name the block "docedits"; both are read */
  const src = String(text || '').replace(/<(\/?)docedits>/gi, '<$1edits>');
  const blocks = findBlocks(src, 'edits');
  const lastOpen = src.toLowerCase().lastIndexOf('<edits>');
  const cutAfter = lastOpen !== -1 && (!blocks.length || lastOpen >= blocks[blocks.length - 1].to);
  if (cutAfter) {
    const tail = src.slice(lastOpen + 7).trim();
    if (LOOKS_LIKE_DATA.test(tail)) {
      const got = salvageEdits(tail);
      const cut = 'the list of changes was cut off before it finished';
      const drafts = draftsNote(blocks.filter((b) => LOOKS_LIKE_DATA.test(b.body)).length);
      const warn = got.length
        ? `${cut} — ${got.length === 1 ? 'the one complete change that arrived was' : `the ${got.length} complete changes that arrived were`} used and the rest were not`
        : `${cut}, and none of it arrived whole`;
      return { edits: got, warn: [warn, drafts].filter(Boolean).join('; '), cut: true };
    }
  }
  if (!blocks.length) return { edits: [], warn: '' };
  let chosen = null;
  for (let k = blocks.length - 1; k >= 0; k--) if (LOOKS_LIKE_DATA.test(blocks[k].body)) { chosen = blocks[k]; break; }
  if (!chosen) chosen = blocks[blocks.length - 1];
  const one = readOne(chosen.body);
  const set = blocks.filter((b) => b !== chosen && LOOKS_LIKE_DATA.test(b.body) && b.body.trim() !== chosen.body.trim()).length;
  return { edits: one.edits, warn: [one.warn, draftsNote(set)].filter(Boolean).join('; ') };
}

/* Thinking written on the page, taken out of what is shown and passed on
 * (<think>, <thinking>, <reasoning>; an unclosed one runs to the end). */
export function stripThinking(text) {
  let rest = String(text || '').replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
  const open = rest.match(/<(think|thinking|reasoning)>/i);
  if (open) rest = rest.slice(0, open.index);
  return rest.replace(/<\/(think|thinking|reasoning)>/gi, '').trim();
}

export function stripEdits(text) {
  let out = String(text || '').replace(/<(\/?)docedits>/gi, '<$1edits>');
  const blocks = findBlocks(out, 'edits');
  for (let i = blocks.length - 1; i >= 0; i--) out = out.slice(0, blocks[i].from) + out.slice(blocks[i].to);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------------------------------------------------------- finding */

/* WHAT MAY DIFFER BETWEEN A QUOTE AND THE DOCUMENT: spacing, and the shape of
 * quote marks and dashes — nothing else (the Plot Essential Maker's law,
 * v0.11.10 → v0.11.13: "an ~83% match can silently overwrite real words in an
 * instruction file"; every fuzzier rule it tried either refused good edits or
 * wrote misquotes over real text). Case is a difference. A missing word is a
 * difference. Those are refused, and the worker is asked to quote again. */
function foldChar(c) {
  if ('\u2018\u2019\u201a\u201b\u02bc'.includes(c)) return "'";
  if ('\u201c\u201d\u201e\u201f'.includes(c)) return '"';
  if ('\u2010\u2011\u2013\u2014'.includes(c)) return '-';
  if (c === '\u00a0') return ' ';
  return c;
}

/* One pass: fold each character, collapse runs of spaces to one space and any
 * whitespace containing a line break to one line break, trim the ends — and
 * remember, for every character kept, where it came from. The same pass
 * serves the quote and the document, so the two can never disagree. */
function foldWithMap(s) {
  const src = String(s);
  let out = '';
  const at = [];
  let space = -1, line = -1;
  for (let i = 0; i < src.length; i++) {
    const c = foldChar(src[i]);
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { if (space < 0) space = i; continue; }
    if (c === '\n') { if (line < 0) line = i; continue; }
    if (out.length) {
      if (line >= 0) { out += '\n'; at.push(line); }
      else if (space >= 0) { out += ' '; at.push(space); }
    }
    space = -1; line = -1;
    out += c; at.push(i);
  }
  return { text: out, at };
}

function normalize(s) { return foldWithMap(s).text; }

function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = hay.indexOf(needle);
  while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

/* FIND WHERE A CHANGE GOES. Exactly as quoted, once; else the same words with
 * only spacing, quote marks or dashes different, once. Anything else is
 * refused with the reason — never guessed at — and the worker is asked to
 * quote the document again. Linear in the length of the document. */
export function locate(text, find) {
  const src = String(text || '');
  const needle = String(find || '');
  if (!needle) return { ok: false, why: 'the change did not say what to replace' };

  const exact = countOccurrences(src, needle);
  if (exact === 1) { const i = src.indexOf(needle); return { ok: true, from: i, to: i + needle.length, how: 'exact' }; }
  if (exact > 1) return { ok: false, why: `those words appear ${exact} times, so it is not clear which one was meant` };

  const F = foldWithMap(src);
  const n = normalize(needle);
  if (!n) return { ok: false, why: 'the change did not say what to replace' };
  const count = countOccurrences(F.text, n);
  if (count === 1) {
    const k = F.text.indexOf(n);
    return { ok: true, from: F.at[k], to: F.at[k + n.length - 1] + 1, how: 'spacing' };
  }
  if (count > 1) return { ok: false, why: `those words appear ${count} times, so it is not clear which one was meant` };
  return { ok: false, why: 'those words are not in the document as written' };
}

/* ---------------------------------------------------------------- applying */

/* Apply one change to one document's text. Pure: text in, text out. */
/* NEVER ADD WHAT IS ALREADY THERE (Cozy Tavern M79: code refuses an edit that
 * adds words a line already holds, and an append the field already states).
 * A worker that appends a paragraph the document already holds is how a
 * plot essential starts to carry every fact twice. Spacing and case are
 * ignored; a short separator — a rule, a blank line — repeats legitimately
 * and is let through. */
export const ALREADY_MIN = 24;
function alreadyHolds(src, add) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const a = norm(add);
  return a.length >= ALREADY_MIN && norm(src).includes(a);
}

export function applyEdit(text, edit) {
  const src = String(text || '');
  if (edit.replace_all === true) {
    if (typeof edit.replace !== 'string') return { ok: false, why: 'a full rewrite arrived with nothing to write' };
    return { ok: true, text: edit.replace, how: 'rewrote the whole thing', was: src, now: edit.replace };
  }
  if (edit.append === true) {
    if (typeof edit.replace !== 'string' || !edit.replace.trim()) return { ok: false, why: 'nothing was given to add' };
    if (alreadyHolds(src, edit.replace)) return { ok: false, why: 'those words are already in the document' };
    const joiner = src && !src.endsWith('\n') ? '\n' : '';
    return { ok: true, text: src + joiner + edit.replace, how: 'added at the end', was: '', now: edit.replace };
  }
  if (typeof edit.insert_after === 'string' && edit.insert_after) {
    const at = locate(src, edit.insert_after);
    if (!at.ok) return { ok: false, why: at.why };
    if (typeof edit.replace !== 'string' || !edit.replace.trim()) return { ok: false, why: 'nothing was given to add' };
    if (alreadyHolds(src, edit.replace)) return { ok: false, why: 'those words are already in the document' };
    const add = edit.replace;
    const joiner = add.startsWith('\n') ? '' : '\n';
    return { ok: true, text: src.slice(0, at.to) + joiner + add + src.slice(at.to), how: 'put it under ' + short(edit.insert_after), was: '', now: add };
  }
  if (typeof edit.find === 'string' && edit.find) {
    const to = typeof edit.replace === 'string' ? edit.replace : '';
    if (edit.all === true) {
      const n = countOccurrences(src, edit.find);
      if (!n) return { ok: false, why: 'those words are not in the document as written' };
      if (edit.find === to) return { ok: false, why: 'that change leaves the words exactly as they were' };
      return { ok: true, text: src.split(edit.find).join(to), how: `changed all ${n}`, was: edit.find, now: to };
    }
    const at = locate(src, edit.find);
    if (!at.ok) return { ok: false, why: at.why };
    /* a change that puts back the very words it found changes nothing, and
     * must not be reported as done */
    if (src.slice(at.from, at.to) === to) return { ok: false, why: 'that change leaves the words exactly as they were' };
    return { ok: true, text: src.slice(0, at.from) + to + src.slice(at.to), how: at.how, was: src.slice(at.from, at.to), now: to };
  }
  return { ok: false, why: 'that change did not say what to do' };
}

/* What a card keeps of before and after: enough to see the change, never a
 * whole rebuilt document stored twice. */
export const CARD_KEEP = 1200;
function clip(s) {
  const t = String(s == null ? '' : s);
  return t.length > CARD_KEEP ? t.slice(0, CARD_KEEP) + `… (${(t.length - CARD_KEEP).toLocaleString()} more characters)` : t;
}

function short(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

/* Apply a run of changes to a set of documents. Returns the new texts, one
 * card per change, and one undo batch holding what was there before. */
export function applyRun(docs, edits, { label = 'a change' } = {}) {
  const texts = new Map();
  for (const d of docs) texts.set(d.name, d.text);
  const before = new Map(texts);
  const cards = [];
  const created = [];

  for (const e of edits) {
    if (typeof e.create_file === 'string' && e.create_file) {
      const name = e.create_file;
      if (texts.has(name)) {
        cards.push({ status: 'refused', name, reason: e.reason || '', why: 'a document with that name already exists' });
        continue;
      }
      texts.set(name, typeof e.replace === 'string' ? e.replace : '');
      created.push(name);
      cards.push({ status: 'applied', name, reason: e.reason || '', how: 'started it', was: '', now: clip(String(e.replace || '')) });
      continue;
    }
    const name = e.file || (texts.size === 1 ? [...texts.keys()][0] : null);
    if (!name) { cards.push({ status: 'refused', name: '', reason: e.reason || '', why: 'the change did not say which document it belongs to' }); continue; }
    if (!texts.has(name)) { cards.push({ status: 'refused', name, reason: e.reason || '', why: 'there is no document by that name' }); continue; }
    const out = applyEdit(texts.get(name), e);
    if (!out.ok) { cards.push({ status: 'refused', name, reason: e.reason || '', why: out.why, find: e.find || e.insert_after || '' }); continue; }
    texts.set(name, out.text);
    cards.push({ status: 'applied', name, reason: e.reason || '', how: out.how, find: e.find || e.insert_after || '', was: clip(out.was), now: clip(out.now) });
  }

  const items = [];
  for (const [name, text] of texts) {
    const was = before.has(name) ? before.get(name) : null;
    if (was === text) continue;
    items.push({ name, before: was, afterHash: hash(text) });
  }
  const batch = items.length
    ? { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), label, items, undone: false }
    : null;

  return { texts, cards, batch, created };
}

/* Put it back — unless something newer is there, in which case say so and do
 * nothing. Silently overwriting a later change is worse than refusing. */
export function undoBatch(docs, batch) {
  if (!batch || batch.undone) return { ok: false, why: 'that has already been put back' };
  if (batch.tooOld) return { ok: false, why: 'that one is too far back to put back now' };
  const byName = new Map(docs.map((d) => [d.name, d]));
  for (const item of batch.items) {
    const live = byName.get(item.name);
    if (!live) return { ok: false, why: `${item.name} is no longer here` };
    if (hash(live.text) !== item.afterHash) {
      return { ok: false, why: `${item.name} has changed since then, so putting it back would undo the newer change too` };
    }
  }
  const changes = [];
  for (const item of batch.items) {
    changes.push({ name: item.name, text: item.before, remove: item.before === null });
  }
  return { ok: true, changes };
}
