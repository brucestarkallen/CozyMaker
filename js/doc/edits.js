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

/* A DOUBLE QUOTE INSIDE A VALUE THAT NOBODY ESCAPED. A plot essential is full
 * of them — its dialogue lines (> "…" —Claire), its LAST line, a nickname —
 * and a model writing a document into a string very often leaves them bare.
 * One bare quote ended the string early and the whole change was lost:
 * a whole plot essential, unreadable, written again from nothing. So a quote
 * inside a string is read for what it is by what follows it. It ends the
 * string only where the data can go on from there: after a name, a colon;
 * after a value in an object, the end of the object or a comma and the next
 * name with its colon; in a list, the end of the list or a comma and the next
 * value. Any other quote is part of the words, and is escaped. Structure
 * outside strings is never touched, and this is only ever tried after every
 * other repair has failed — valid data never reaches it. */
export function escapeStrayQuotes(s) {
  const src = String(s || '');
  const stack = [];
  let out = '', inStr = false, esc = false, isKey = false, expectKey = false;
  const skip = (k) => { while (k < src.length && /\s/.test(src[k])) k++; return k; };
  /* a quote that opens a name and its colon: "replace": */
  const nameAt = (k) => {
    if (src[k] !== '"') return false;
    let m = k + 1;
    while (m < src.length && /[A-Za-z0-9_]/.test(src[m])) m++;
    return m > k + 1 && src[m] === '"' && src[skip(m + 1)] === ':';
  };
  /* 'end' — the string ends here; 'inner' — the quote is part of the words;
   * 'lost' — a name and its colon begin right here, inside what should be a
   * value: a closing quote went missing earlier, and where it belonged is a
   * guess this does not make. */
  const judge = (i) => {
    const j = skip(i + 1);
    if (isKey) return src[j] === ':' ? 'end' : 'inner';
    if (nameAt(i)) return 'lost';
    if (j >= src.length) return 'end';
    const nx = src[j];
    const top = stack[stack.length - 1];
    if (nx === '}') return top === '{' ? 'end' : 'inner';
    if (nx === ']') return top === '[' ? 'end' : 'inner';
    if (nx === ',') {
      const k = skip(j + 1);
      if (top === '{') return nameAt(k) ? 'end' : 'inner';
      return /["{[\-0-9tfn]/.test(src[k] || '') ? 'end' : 'inner';
    }
    /* the next name straight after, with no comma: the quote ends the string
     * (the missing comma is not ours to add) */
    if (nx === '"' && top === '{' && nameAt(j)) return 'end';
    return 'inner';
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; out += c; continue; }
      if (c === '\\') { esc = true; out += c; continue; }
      if (c === '"') {
        const v = judge(i);
        if (v === 'lost') return src;
        if (v === 'end') { inStr = false; out += c; } else out += '\\"';
        continue;
      }
      out += c;
      continue;
    }
    if (c === '"') { inStr = true; isKey = stack[stack.length - 1] === '{' && expectKey; out += c; continue; }
    if (c === '{') { stack.push('{'); expectKey = true; }
    else if (c === '[') { stack.push('['); expectKey = false; }
    else if (c === '}' || c === ']') { stack.pop(); expectKey = false; }
    else if (c === ':') expectKey = false;
    else if (c === ',') expectKey = stack[stack.length - 1] === '{';
    out += c;
  }
  return out;
}

function repairs(t) {
  const e = escapeRawControlsInStrings(t);
  /* the stray quotes first: with them escaped, the string the control
   * repair walks is the real one */
  const q = escapeRawControlsInStrings(escapeStrayQuotes(t));
  return [t, stripTrailingCommasOutsideStrings(t), e, stripTrailingCommasOutsideStrings(e), q, stripTrailingCommasOutsideStrings(q)];
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

/* A WHOLE DOCUMENT IS WRITTEN PLAINLY, NOT SQUEEZED INTO A STRING. A plot
 * essential inside a JSON string needs every line break and every quote
 * escaped, and one that was not lost the whole build (see escapeStrayQuotes).
 * So a whole document — a new one, or one rebuilt from start to finish — is
 * written between <file name="…"> and </file>, exactly as it should read.
 *   — Blocks never nest: an opener met again before a closer means the first
 *     one never finished, and it is set aside.
 *   — The last one for a name is the answer; earlier ones are drafts.
 *   — One left open at the end was cut off: it is reported, never written
 *     (half a document written over a whole one is a loss).
 *   — A document wrapped whole in a code fence is unwrapped. */
const FILE_OPEN = /<file\s+(?:name|path)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^>\n]+?))\s*\/?>/gi;
const FILE_CLOSE = /<\/file\s*>/i;
export function readFiles(text) {
  const src = String(text || '');
  const opens = [...src.matchAll(FILE_OPEN)].map((m) => ({ at: m.index, end: m.index + m[0].length, name: (m[1] || m[2] || m[3] || '').trim() }));
  const found = [];
  const spans = [];
  let open = null;
  let skipTo = 0;
  for (let n = 0; n < opens.length; n++) {
    const o = opens[n];
    if (o.at < skipTo) continue;
    const next = opens.slice(n + 1).find((x) => x.at >= o.end);
    const tail = src.slice(o.end, next ? next.at : src.length);
    const close = FILE_CLOSE.exec(tail);
    if (!close) {
      if (!next) { open = { name: o.name, at: o.at }; spans.push([o.at, src.length]); }
      else spans.push([o.at, next.at]);
      continue;
    }
    let body = tail.slice(0, close.index).replace(/\r\n?/g, '\n').replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '');
    const fenced = /^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/.exec(body);
    if (fenced) body = fenced[1];
    const stop = o.end + close.index + close[0].length;
    found.push({ name: o.name, text: body, at: o.at });
    spans.push([o.at, stop]);
    skipTo = stop;
  }
  /* the last one per name is the answer */
  const last = new Map();
  for (const f of found) last.set(f.name.toLowerCase(), f);
  const files = found.filter((f) => last.get(f.name.toLowerCase()) === f && f.name);
  return { files, open, spans, drafts: found.length - files.length };
}

/* The text with every document written plainly taken out — so nothing inside
 * a document is ever read as a block of changes, or reaches anyone as notes. */
function withoutFiles(src, spans) {
  let out = src;
  for (const [a, b] of [...spans].sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + ' '.repeat(b - a) + out.slice(b);
  return out;
}

/* The name of a document left open at the very end of an answer, or ''. */
export function openFileAtEnd(text) {
  const r = readFiles(String(text || '').replace(/<(\/?)docedits>/gi, '<$1edits>'));
  return r.open ? (r.open.name || 'the document') : '';
}

export function parseEdits(text) {
  /* the extension's crafts name the block "docedits"; both are read */
  const raw = String(text || '').replace(/<(\/?)docedits>/gi, '<$1edits>');
  const files = readFiles(raw);
  const got = parseBlock(withoutFiles(raw, files.spans));
  if (!files.files.length && !files.open) return got;
  /* in the order they were written: two changes to one document land the way
   * the worker meant them to */
  const items = files.files.map((f) => ({ at: f.at, edits: [{ file: f.name, whole: true, replace: f.text, reason: 'written whole' }] }));
  if (got.edits.length) items.push({ at: got.at, edits: got.edits });
  items.sort((a, b) => a.at - b.at);
  const warns = [got.warn];
  if (files.open) warns.push(`${files.open.name || 'a document'} was cut off before it finished, so it was not written`);
  return {
    edits: items.flatMap((x) => x.edits),
    warn: warns.filter(Boolean).join('; '),
    cut: Boolean(got.cut || files.open),
    fileCut: files.open ? (files.open.name || 'the document') : '',
    drafts: (got.drafts || 0) + files.drafts,
  };
}

function parseBlock(src) {
  const blocks = findBlocks(src, 'edits');
  const lastOpen = src.toLowerCase().lastIndexOf('<edits>');
  const cutAfter = lastOpen !== -1 && (!blocks.length || lastOpen >= blocks[blocks.length - 1].to);
  if (cutAfter) {
    const tail = src.slice(lastOpen + 7).trim();
    if (LOOKS_LIKE_DATA.test(tail)) {
      const got = salvageEdits(tail);
      const cut = 'the list of changes was cut off before it finished';
      const warn = got.length
        ? `${cut} — ${got.length === 1 ? 'the one complete change that arrived was' : `the ${got.length} complete changes that arrived were`} used and the rest were not`
        : `${cut}, and none of it arrived whole`;
      return { edits: got, warn, cut: true, drafts: blocks.filter((b) => LOOKS_LIKE_DATA.test(b.body)).length, at: lastOpen };
    }
  }
  if (!blocks.length) return { edits: [], warn: '', at: 0 };
  let chosen = null;
  for (let k = blocks.length - 1; k >= 0; k--) if (LOOKS_LIKE_DATA.test(blocks[k].body)) { chosen = blocks[k]; break; }
  if (!chosen) chosen = blocks[blocks.length - 1];
  const one = readOne(chosen.body);
  const set = blocks.filter((b) => b !== chosen && LOOKS_LIKE_DATA.test(b.body) && b.body.trim() !== chosen.body.trim()).length;
  /* a draft set aside is how the answer was written, not something that went
   * wrong: it is counted, never reported as a change that did not come through */
  return { edits: one.edits, warn: one.warn, drafts: set, at: chosen.from };
}

/* Thinking written on the page, taken out of what is shown and passed on
 * (<think>, <thinking>, <reasoning>; an unclosed one runs to the end). */
export function stripThinking(text) {
  let rest = String(text || '').replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
  const open = rest.match(/<(think|thinking|reasoning)>/i);
  if (open) rest = rest.slice(0, open.index);
  /* a closing tag with no opening one: the model's template opened the thought,
   * so everything before the last closer was thinking, never words to keep */
  const closers = [...rest.matchAll(/<\/(think|thinking|reasoning)>/gi)];
  if (closers.length) { const last = closers[closers.length - 1]; rest = rest.slice(last.index + last[0].length); }
  return rest.trim();
}

export function stripEdits(text) {
  let out = String(text || '').replace(/<(\/?)docedits>/gi, '<$1edits>');
  const files = readFiles(out);
  for (const [a, b] of [...files.spans].sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + out.slice(b);
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
    /* UNDER THE LINE, NEVER INSIDE IT. A quote that stops partway along a line
     * ("- The city lives inside") put the new text in the middle of that line
     * and split it in two. It goes after the end of the line the quote is on. */
    let cut = at.to;
    if (cut < src.length && src[cut] !== '\n') { const nl = src.indexOf('\n', cut); cut = nl === -1 ? src.length : nl; }
    return { ok: true, text: src.slice(0, cut) + joiner + add + src.slice(cut), how: 'put it under ' + short(edit.insert_after), was: '', now: add };
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
/* A DOCUMENT NAMED THE WAY A MODEL NAMES IT. "plot essential.md" or "Plot
 * Essential" for "Plot Essential.md" was refused as "no document by that
 * name" and the change was lost. Exact first; then ignoring case; then without
 * its ending — and only when exactly one document answers. */
export function nameIn(texts, want) {
  const names = [...texts.keys()];
  const w = String(want || '').trim();
  if (texts.has(w)) return w;
  const low = w.toLowerCase();
  const bare = (s) => s.toLowerCase().replace(/\.(md|json|txt)$/, '').trim();
  for (const pick of [(n) => n.toLowerCase() === low, (n) => bare(n) === bare(w)]) {
    const hits = names.filter(pick);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}

export function applyRun(docs, edits, { label = 'a change' } = {}) {
  const texts = new Map();
  for (const d of docs) texts.set(d.name, d.text);
  const before = new Map(texts);
  const cards = [];
  const created = [];
  const cleared = [];
  const deleted = [];

  for (const e of edits) {
    /* CLEAR AND DELETE, WHEN HE ASKS FOR THEM. Only the house writes these (a
     * worker's own edits never carry "house"): "clear the plot essential"
     * used to reach a worker, whose rewrite to nothing was then refused by the
     * guard against accidental loss — so nothing was ever cleared. */
    if (e.house === true && (e.clear === true || typeof e.delete_file === 'string')) {
      const want = e.clear === true ? e.file : e.delete_file;
      const name = nameIn(texts, want);
      if (!name) { cards.push({ status: 'refused', name: want || '', reason: e.reason || '', why: 'there is no document by that name' }); continue; }
      const old = texts.get(name);
      if (e.clear === true) {
        if (!String(old || '').trim()) { cards.push({ status: 'refused', name, reason: e.reason || '', why: 'it is already empty' }); continue; }
        texts.set(name, '');
        cleared.push(name);
        cards.push({ status: 'applied', name, reason: e.reason || 'you asked for it to be cleared', how: 'cleared it', was: clip(old), now: '' });
      } else {
        texts.delete(name);
        deleted.push({ name, text: old });
        cards.push({ status: 'applied', name, reason: e.reason || 'you asked for it to be deleted', how: 'deleted it', was: clip(old), now: '' });
      }
      continue;
    }
    /* A WHOLE DOCUMENT, WRITTEN PLAINLY: a new one is started (or an empty one
     * of that name written); one with words in it is rebuilt whole, and the
     * guard against losing things still stands over it (run.js commit). The
     * very words it already has change nothing, and say nothing. */
    if (e.whole === true && typeof e.file === 'string' && e.file.trim()) {
      const body = typeof e.replace === 'string' ? e.replace : '';
      const name = nameIn(texts, e.file.trim()) || e.file.trim();
      if (!body.trim()) { cards.push({ status: 'refused', name, reason: e.reason || '', why: 'the document came back empty' }); continue; }
      if (texts.has(name)) {
        const old = String(texts.get(name) || '');
        if (old === body) continue;
        texts.set(name, body);
        cards.push({ status: 'applied', name, reason: e.reason || '', how: old.trim() ? 'rewrote the whole thing' : 'wrote it', was: clip(old), now: clip(body) });
        continue;
      }
      texts.set(name, body);
      created.push(name);
      cards.push({ status: 'applied', name, reason: e.reason || '', how: 'started it', was: '', now: clip(body) });
      continue;
    }
    if (typeof e.create_file === 'string' && e.create_file) {
      const name = e.create_file;
      if (texts.has(name) && String(texts.get(name) || '').trim()) {
        cards.push({ status: 'refused', name, reason: e.reason || '', why: 'a document with that name already exists' });
        continue;
      }
      /* an empty one by that name (cleared a moment ago, or started by hand) is simply written */
      if (texts.has(name)) {
        texts.set(name, typeof e.replace === 'string' ? e.replace : '');
        cards.push({ status: 'applied', name, reason: e.reason || '', how: 'wrote it', was: '', now: clip(String(e.replace || '')) });
        continue;
      }
      texts.set(name, typeof e.replace === 'string' ? e.replace : '');
      created.push(name);
      cards.push({ status: 'applied', name, reason: e.reason || '', how: 'started it', was: '', now: clip(String(e.replace || '')) });
      continue;
    }
    const name = e.file ? nameIn(texts, e.file) || e.file : (texts.size === 1 ? [...texts.keys()][0] : null);
    if (!name) { cards.push({ status: 'refused', name: '', reason: e.reason || '', why: 'the change did not say which document it belongs to' }); continue; }
    if (!texts.has(name)) { cards.push({ status: 'refused', name, reason: e.reason || '', why: 'there is no document by that name' }); continue; }
    /* a full rewrite into the very words that are there changed nothing: no card saying it did */
    if (e.replace_all === true && typeof e.replace === 'string' && e.replace === texts.get(name)) continue;
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
  for (const d of deleted) items.push({ name: d.name, before: d.text, afterHash: null, removed: true });
  const batch = items.length
    ? { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), label, items, undone: false }
    : null;

  return { texts, cards, batch, created, cleared, deleted };
}

/* Put it back — unless something newer is there, in which case say so and do
 * nothing. Silently overwriting a later change is worse than refusing. */
export function undoBatch(docs, batch) {
  if (!batch || batch.undone) return { ok: false, why: 'that has already been put back' };
  if (batch.tooOld) return { ok: false, why: 'that one is too far back to put back now' };
  const byName = new Map(docs.map((d) => [d.name, d]));
  for (const item of batch.items) {
    const live = byName.get(item.name);
    /* a deleted document comes back — unless another now has its name */
    if (item.removed) {
      if (live) return { ok: false, why: `a document called ${item.name} is here again, so the old one cannot come back beside it` };
      continue;
    }
    if (!live) return { ok: false, why: `${item.name} is no longer here` };
    if (hash(live.text) !== item.afterHash) {
      return { ok: false, why: `${item.name} has changed since then, so putting it back would undo the newer change too` };
    }
  }
  const changes = [];
  for (const item of batch.items) {
    if (item.removed) { changes.push({ name: item.name, text: item.before, add: true, kind: item.kind || 'pe' }); continue; }
    changes.push({ name: item.name, text: item.before, remove: item.before === null });
  }
  return { ok: true, changes };
}
