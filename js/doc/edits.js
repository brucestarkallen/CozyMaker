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
    for (const candidate of [t, t.replace(/,\s*([}\]])/g, '$1')]) {
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

export function parseEdits(text) {
  const blocks = findBlocks(text, 'edits');
  if (!blocks.length) return { edits: [], warn: '' };
  const edits = [];
  let warn = '';
  for (const b of blocks) {
    const r = tolerantJson(b.body);
    if (!r.ok) { warn = r.error; continue; }
    for (const e of r.value) if (e && typeof e === 'object') edits.push(e);
  }
  return { edits, warn };
}

export function stripEdits(text) {
  let out = String(text || '');
  const blocks = findBlocks(out, 'edits');
  for (let i = blocks.length - 1; i >= 0; i--) out = out.slice(0, blocks[i].from) + out.slice(blocks[i].to);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------------------------------------------------------- finding */

const QUOTES = /[\u2018\u2019\u201a\u201b]/g;
const DQUOTES = /[\u201c\u201d\u201e\u201f]/g;

function normalize(s) {
  return String(s).replace(QUOTES, "'").replace(DQUOTES, '"').replace(/[\u2013\u2014]/g, '-')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = hay.indexOf(needle);
  while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

function words(s) { return normalize(s).split(/\s+/).filter(Boolean); }

function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return 0;
  const n = A.length, m = B.length;
  let prev = new Array(m + 1);
  let cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    const t = prev; prev = cur; cur = t;
  }
  return 1 - prev[m] / Math.max(n, m);
}

export const FUZZY_FLOOR = 0.78;
export const FUZZY_GAP = 0.05;

/* Where in the text does this belong? Returns {from,to} or a refusal. */
export function locate(text, find) {
  const src = String(text || '');
  const needle = String(find || '');
  if (!needle) return { ok: false, why: 'the change did not say what to replace' };

  const exact = countOccurrences(src, needle);
  if (exact === 1) { const i = src.indexOf(needle); return { ok: true, from: i, to: i + needle.length, how: 'exact' }; }
  if (exact > 1) return { ok: false, why: `those words appear ${exact} times, so it is not clear which one was meant` };

  /* Same words, different spacing or quote marks. */
  const nSrc = normalize(src);
  const nNeedle = normalize(needle);
  const nCount = countOccurrences(nSrc, nNeedle);
  if (nCount === 1) {
    const span = spanFromNormalized(src, nNeedle);
    if (span) return { ok: true, ...span, how: 'spacing' };
  }
  if (nCount > 1) return { ok: false, why: `those words appear ${nCount} times, so it is not clear which one was meant` };

  /* A close match, over a window the size of what was asked for. */
  const lines = src.split('\n');
  const want = needle.split('\n').length;
  let best = { score: 0, from: -1, to: -1 };
  let second = 0;
  let offset = 0;
  const starts = [];
  for (const l of lines) { starts.push(offset); offset += l.length + 1; }
  for (let i = 0; i < lines.length; i++) {
    for (const size of new Set([want, Math.max(1, want - 1), want + 1])) {
      if (i + size > lines.length) continue;
      const from = starts[i];
      const to = Math.min(src.length, starts[i] + lines.slice(i, i + size).join('\n').length);
      const score = similarity(src.slice(from, to), needle);
      if (score > best.score) { second = best.score; best = { score, from, to }; }
      else if (score > second) second = score;
    }
  }
  if (best.score >= FUZZY_FLOOR && best.score - second >= FUZZY_GAP) {
    return { ok: true, from: best.from, to: best.to, how: 'close', score: Number(best.score.toFixed(3)) };
  }
  if (best.score >= FUZZY_FLOOR) {
    return { ok: false, why: 'two places in the document match those words about equally well' };
  }
  return { ok: false, why: 'those words are not in the document as written' };
}

/* Map a normalized match back onto the real characters. */
function spanFromNormalized(src, nNeedle) {
  const map = [];
  let norm = '';
  let lastWasSpace = true;
  for (let i = 0; i < src.length; i++) {
    let c = src[i];
    if (QUOTES.test(c)) c = "'";
    else if (DQUOTES.test(c)) c = '"';
    else if (c === '\u2013' || c === '\u2014') c = '-';
    QUOTES.lastIndex = 0; DQUOTES.lastIndex = 0;
    if (c === ' ' || c === '\t') {
      if (lastWasSpace) continue;
      norm += ' '; map.push(i); lastWasSpace = true; continue;
    }
    if (c === '\n') {
      while (norm.endsWith(' ')) { norm = norm.slice(0, -1); map.pop(); }
      norm += '\n'; map.push(i); lastWasSpace = true; continue;
    }
    norm += c; map.push(i); lastWasSpace = false;
  }
  const lead = norm.length - norm.replace(/^\s+/, '').length;
  const trimmed = norm.trim();
  const at = trimmed.indexOf(nNeedle);
  if (at === -1) return null;
  const startIdx = at + lead;
  const endIdx = startIdx + nNeedle.length - 1;
  if (startIdx >= map.length || endIdx >= map.length) return null;
  return { from: map[startIdx], to: map[endIdx] + 1 };
}

/* ---------------------------------------------------------------- applying */

/* Apply one change to one document's text. Pure: text in, text out. */
export function applyEdit(text, edit) {
  const src = String(text || '');
  if (edit.replace_all === true) {
    if (typeof edit.replace !== 'string') return { ok: false, why: 'a full rewrite arrived with nothing to write' };
    return { ok: true, text: edit.replace, how: 'rewrote the whole thing' };
  }
  if (edit.append === true) {
    if (typeof edit.replace !== 'string') return { ok: false, why: 'nothing was given to add' };
    const joiner = src && !src.endsWith('\n') ? '\n' : '';
    return { ok: true, text: src + joiner + edit.replace, how: 'added at the end' };
  }
  if (typeof edit.insert_after === 'string' && edit.insert_after) {
    const at = locate(src, edit.insert_after);
    if (!at.ok) return { ok: false, why: at.why };
    const add = typeof edit.replace === 'string' ? edit.replace : '';
    const joiner = add.startsWith('\n') ? '' : '\n';
    return { ok: true, text: src.slice(0, at.to) + joiner + add + src.slice(at.to), how: 'put it under ' + short(edit.insert_after) };
  }
  if (typeof edit.find === 'string' && edit.find) {
    const to = typeof edit.replace === 'string' ? edit.replace : '';
    if (edit.all === true) {
      const n = countOccurrences(src, edit.find);
      if (!n) return { ok: false, why: 'those words are not in the document as written' };
      return { ok: true, text: src.split(edit.find).join(to), how: `changed all ${n}` };
    }
    const at = locate(src, edit.find);
    if (!at.ok) return { ok: false, why: at.why };
    return { ok: true, text: src.slice(0, at.from) + to + src.slice(at.to), how: at.how };
  }
  return { ok: false, why: 'that change did not say what to do' };
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
      cards.push({ status: 'applied', name, reason: e.reason || '', how: 'started it' });
      continue;
    }
    const name = e.file || (texts.size === 1 ? [...texts.keys()][0] : null);
    if (!name) { cards.push({ status: 'refused', name: '', reason: e.reason || '', why: 'the change did not say which document it belongs to' }); continue; }
    if (!texts.has(name)) { cards.push({ status: 'refused', name, reason: e.reason || '', why: 'there is no document by that name' }); continue; }
    const out = applyEdit(texts.get(name), e);
    if (!out.ok) { cards.push({ status: 'refused', name, reason: e.reason || '', why: out.why, find: e.find || e.insert_after || '' }); continue; }
    texts.set(name, out.text);
    cards.push({ status: 'applied', name, reason: e.reason || '', how: out.how, find: e.find || e.insert_after || '' });
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
