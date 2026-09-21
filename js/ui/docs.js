/* CozyMaker — js/ui/docs.js
 *
 * The documents. The plot essential, the continuation files, the worldbook —
 * open one, read it, change a line by hand. The crew's changes and his land in
 * the same place, because there is only one place.
 *
 * Every job a document can be given is a named button on it: "Tidy it up",
 * "Make it shorter", "Check it". Each one sends its job through the same
 * conversation he types into, and shows there in his own words — the button is
 * a way to find the door, not a second door (Cozy Tavern M210, M220). */

import * as store from '../store.js';
import { $, el, openSheet, closeSheet, toast, redraw, field, select, group, ask } from './kit.js';
import { parseDoc, indexLines, estimateTokens } from '../doc/index.js';
import { lint, readEvents } from '../doc/lint.js';

const KINDS = [
  ['pe', 'Plot essential'],
  ['continuity', 'Continuation file'],
  ['worldbook', 'Worldbook'],
  ['notes', 'Notes to yourself'],
];

let openDocIdValue = null;

/* Run the checks when he finishes with a document, not while he is typing in
 * it — mid-keystroke they would take away the empty heading he is about to
 * fill. What they repair is said once, plainly. */
export function tidyOnLeaving(id) {
  const p = store.getProject();
  const doc = (p.docs || []).find((d) => d.id === id);
  if (!doc) return;
  const r = lint(doc.text, { kind: doc.kind || 'pe', deliverable: (doc.kind || 'pe') !== 'notes' });
  if (!r.changed) return;
  store.writeDoc(id, r.text);
  const fixed = r.found.filter((f) => f.repaired).map((f) => f.said);
  if (fixed.length) toast(`In ${doc.name}, ${fixed.join('; ')}.`);
  redraw();
}

export function currentDocId() { return openDocIdValue; }

export function openDocs() {
  if (openDocIdValue) tidyOnLeaving(openDocIdValue);
  openDocIdValue = null;
  $('docsTitle').textContent = 'The documents';
  const action = $('docsAction');
  action.textContent = 'New document';
  action.onclick = newDoc;
  drawList();
  openSheet('docsSheet');
}

export function openDoc(id) {
  openSheet('docsSheet');
  openOne(id);
}

function drawList() {
  const body = $('docsBody');
  const p = store.getProject();
  body.innerHTML = '';
  body.style.padding = '';
  const docs = p.docs || [];

  if (!docs.some((d) => d.kind === 'pe')) {
    const g = group('No plot essential yet',
      'Start one with the crew — tell them about the world and it gets built as you talk — or bring in one you already have.');
    const row = el('div', 'btnrow');
    const start = el('button', 'btn', 'New plot essential');
    start.addEventListener('click', () => { closeSheet('docsSheet'); newPlotEssential(); });
    const bring = el('button', 'btn quiet', 'Bring one in');
    bring.addEventListener('click', bringIn);
    row.append(start, bring);
    g.append(row);
    body.append(g);
  }

  for (const d of docs) {
    const row = el('div', 'row');
    const g = el('div', 'grow');
    g.append(el('b', '', d.name));
    const parsed = parseDoc(d.text, d.kind);
    const ev = d.kind === 'worldbook' ? null : readEvents(d.text);
    const bits = [kindLabel(d.kind), `${estimateTokens(d.text).toLocaleString()} tokens`];
    if (d.kind === 'worldbook') bits.push(`${parsed.sections.length} entries`);
    else {
      bits.push(`${parsed.sections.length} sections`);
      if (ev && ev.ids.length) bits.push(`${ev.ids.length} events`);
    }
    g.append(el('small', '', bits.join(' · ')));
    g.addEventListener('click', () => openOne(d.id));
    row.append(g);
    body.append(row);
  }

  if (docs.some((d) => d.kind === 'pe')) {
    const row = el('div', 'btnrow');
    const bring = el('button', 'btn quiet', 'Bring one in');
    bring.addEventListener('click', bringIn);
    row.append(bring);
    body.append(row);
  }

  body.append(group('A copy on the device',
    'Every document is also written as plain markdown in ~/.cozymaker/exports, so you can reach it from the shell without opening this.'));
}

function kindLabel(kind) {
  const hit = KINDS.find((k) => k[0] === (kind || 'pe'));
  return hit ? hit[1] : 'Document';
}

/* --- starting one ---------------------------------------------------------- */

/* The builder is a co-writer, not a form: it starts by working out the world
 * with him, and writes the plot essential as it goes. */
export function newPlotEssential() {
  ask("Let's start a new plot essential for this world.", 'builder');
}

async function newDoc() {
  const p = store.getProject();
  const name = prompt('What is it called?', suggestName(p));
  if (name === null) return;
  const clean = (name.trim() || 'Untitled') + (/\.(md|json|txt)$/i.test(name.trim()) ? '' : '.md');
  if ((p.docs || []).some((d) => d.name === clean)) return toast('There is already one called that.');
  await store.addDoc(clean, guessKind(clean), guessKind(clean) === 'worldbook' ? '[]' : '');
  drawList();
  redraw();
}

function suggestName(p) {
  const docs = p.docs || [];
  if (!docs.some((d) => d.kind === 'pe')) return 'Plot Essential.md';
  const n = docs.filter((d) => d.kind === 'continuity').length + 1;
  return `Continuity File ${n}.md`;
}

/* A worldbook is known by what it IS — data that reads as a list of entries —
 * never by a first character: a pasted note that opens "[OOC: …]" is words. */
function readsAsWorldbook(t) {
  if (!/^[[{]/.test(t)) return false;
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) || Boolean(v && typeof v === 'object' && v.entries);
  } catch (_) { return false; }
}

export function guessKind(name, text = '') {
  const n = String(name).toLowerCase();
  const t = String(text).trim();
  if (n.endsWith('.json') || n.includes('worldbook') || readsAsWorldbook(t)) return 'worldbook';
  if (n.includes('continuity') || n.includes('brief') || /file\s*\d/.test(n) || /^#\s*PLOT ESSENTIAL CONTINUITY/i.test(t)) return 'continuity';
  if (n.includes('note')) return 'notes';
  return 'pe';
}

/* BRING ONE IN — paste it, or pick the file. He already has plot essentials
 * from his SillyTavern extension; they arrive whole, as themselves, and are
 * tidied on the way in by the same checks as everything else. */
export function bringIn() {
  openSheet('docsSheet');
  if (openDocIdValue) tidyOnLeaving(openDocIdValue);
  openDocIdValue = null;
  $('docsTitle').textContent = 'Bring one in';
  const action = $('docsAction');
  action.textContent = 'All documents';
  action.onclick = () => openDocs();

  const body = $('docsBody');
  body.innerHTML = '';
  body.style.padding = '';
  const g = group('Paste it, or pick the file', 'A plot essential, a continuation file, or a worldbook. It arrives whole.');
  const name = document.createElement('input');
  name.type = 'text';
  name.value = suggestName(store.getProject());
  const area = document.createElement('textarea');
  area.className = 'plain';
  area.style.minHeight = '220px';
  area.placeholder = 'Paste it here.';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.md,.txt,.json,text/plain,text/markdown,application/json';
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    area.value = await f.text();
    name.value = f.name.replace(/\.txt$/i, '.md');
  });
  g.append(field('Call it', name), field('Its words', area), field('…or pick the file', file));
  const row = el('div', 'btnrow');
  const go = el('button', 'btn', 'Bring it in');
  go.addEventListener('click', async () => {
    const text = area.value;
    if (!text.trim()) return toast('There is nothing in it yet.');
    let clean = name.value.trim() || 'Plot Essential.md';
    if (!/\.(md|json|txt)$/i.test(clean)) clean += '.md';
    const p = store.getProject();
    if ((p.docs || []).some((d) => d.name === clean)) return toast('There is already one called that — give this one another name.');
    const kind = guessKind(clean, text);
    const r = lint(text, { kind, deliverable: kind !== 'notes' });
    await store.addDoc(clean, kind, r.text);
    const fixed = r.found.filter((f) => f.repaired).map((f) => f.said);
    toast(`${clean} is in.${fixed.length ? ' On the way in: ' + fixed.join('; ') + '.' : ''}`);
    redraw();
    openDocs();
  });
  row.append(go);
  g.append(row);
  body.append(g);
}

/* --- one of them ----------------------------------------------------------- */

function openOne(id) {
  const p = store.getProject();
  const doc = (p.docs || []).find((d) => d.id === id);
  if (!doc) return;
  if (openDocIdValue && openDocIdValue !== id) tidyOnLeaving(openDocIdValue);
  openDocIdValue = id;

  $('docsTitle').textContent = doc.name;
  const action = $('docsAction');
  action.textContent = 'All documents';
  action.onclick = () => openDocs();

  const body = $('docsBody');
  body.innerHTML = '';
  body.style.padding = '0';

  /* The jobs this document can be given, named, at the top where they are
   * seen — each goes through the conversation in plain words. */
  const jobs = el('div', 'doc-jobs');
  const job = (label, worker, words) => {
    const b = el('button', 'btn quiet small', label);
    b.addEventListener('click', () => {
      tidyOnLeaving(id);
      closeSheet('docsSheet');
      openDocIdValue = null;
      ask(words, worker);
    });
    return b;
  };
  if (doc.kind !== 'notes') {
    jobs.append(
      job('Tidy it up', 'showrunner', `Tidy up ${doc.name}.`),
      job('Make it shorter', 'compressor', `Make ${doc.name} shorter without losing anything that matters.`),
      job('Check it', 'eye', `Check ${doc.name} for anything wrong or contradictory, and put it right.`),
    );
  }
  if (doc.kind === 'worldbook') {
    const ex = el('button', 'btn quiet small', 'Export for SillyTavern');
    ex.addEventListener('click', () => exportForSillyTavern(doc));
    jobs.append(ex);
  }
  body.append(jobs);

  const wrap = el('div', 'docedit');
  const area = document.createElement('textarea');
  area.value = doc.text || '';
  area.spellcheck = false;
  area.autocapitalize = 'off';
  area.style.minHeight = '48vh';

  const meta = el('div', 'docmeta');
  const refreshMeta = () => {
    const parsed = parseDoc(area.value, doc.kind);
    const ev = doc.kind === 'worldbook' ? null : readEvents(area.value);
    meta.textContent = [
      `${estimateTokens(area.value).toLocaleString()} tokens`,
      doc.kind === 'worldbook' ? `${parsed.sections.length} entries` : `${parsed.sections.length} sections`,
      ev && ev.ids.length ? `${ev.ids.length} events` : null,
    ].filter(Boolean).join('  ·  ');
  };
  refreshMeta();

  let redrawTimer = null;
  area.addEventListener('input', () => {
    refreshMeta();
    /* Straight into the store, every keystroke. The store holds the only
     * debounce, so the save on the way out always has the latest words. */
    store.writeDoc(id, area.value);
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(redraw, 400);
  });

  wrap.append(area, meta);
  body.append(wrap);

  const tools = el('div', 'group');
  tools.style.padding = '0 16px 16px';

  const shape = document.createElement('details');
  shape.className = 'thinking';
  shape.style.maxHeight = 'none';
  const sum = document.createElement('summary');
  sum.textContent = 'everything that is in it';
  const lines = indexLines(parseDoc(doc.text, doc.kind));
  shape.append(sum, document.createTextNode('\n' + (lines.length ? lines.join('\n') : 'nothing yet')));
  tools.append(shape);

  const row = el('div', 'btnrow');
  const rename = el('button', 'btn quiet', 'Rename');
  rename.addEventListener('click', async () => {
    const name = prompt('Call it what?', doc.name);
    if (name === null) return;
    const clean = name.trim();
    if (!clean) return;
    if ((store.getProject().docs || []).some((d) => d.name === clean && d.id !== id)) return toast('There is already one called that.');
    await store.renameDoc(id, clean);
    $('docsTitle').textContent = clean;
    redraw();
  });
  const copy = el('button', 'btn quiet', 'Copy all');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(area.value); toast('Copied.'); }
    catch (_) { area.select(); toast('Select and copy.'); }
  });
  const kind = select(KINDS, doc.kind || 'pe');
  kind.addEventListener('change', async () => {
    const p2 = store.getProject();
    const next = { ...p2, docs: (p2.docs || []).map((d) => (d.id === id ? { ...d, kind: kind.value } : d)) };
    await store.setProject(next, { now: true });
    doc.kind = kind.value;
    refreshMeta();
  });
  const del = el('button', 'btn danger', 'Delete');
  del.addEventListener('click', async () => {
    if (!confirm(`Delete ${doc.name}? A copy stays in the backups folder on the device.`)) return;
    openDocIdValue = null;
    await store.removeDoc(id);
    openDocs();
    redraw();
  });
  row.append(rename, copy, del);
  tools.append(field('What kind of document this is', kind), row);
  body.append(tools);
}

/* --- SillyTavern ------------------------------------------------------------ */

/* THE WORLDBOOK IS FOR USING, and he uses it in SillyTavern. The mapping is
 * Cozy Chat's (v5.13.0), carried over exactly: blue → constant, green →
 * selective on its keys, chain → vectorized; position, order, depth and
 * probability carried across. */
function positionToST(pos) {
  const p = String(pos || '').toLowerCase();
  if (p === 'before_char') return 0;
  if (p === 'at_depth') return 4;
  return 1;
}

export function worldbookToST(entries) {
  const out = { entries: {} };
  (entries || []).forEach((e, i) => {
    const strat = String(e.strategy || 'green').toLowerCase();
    const blue = strat === 'blue', chain = strat === 'chain';
    const keys = (blue || chain) ? [] : (Array.isArray(e.keys) ? e.keys : String(e.keys || '').split(','))
      .map((k) => String(k).trim()).filter(Boolean);
    const pos = positionToST(e.position);
    const prob = Number.isFinite(+e.probability) ? Math.max(0, Math.min(100, +e.probability)) : 100;
    out.entries[String(i)] = {
      uid: i, key: keys, keysecondary: [], comment: String(e.name || ''), content: String(e.content || ''),
      constant: blue, vectorized: chain || !blue, selective: !blue && keys.length > 0,
      selectiveLogic: 0, addMemo: true, order: Number.isFinite(+e.order) ? +e.order : 100,
      position: pos, disable: false, excludeRecursion: false, preventRecursion: false,
      delayUntilRecursion: false, probability: prob, useProbability: prob !== 100,
      depth: pos === 4 ? (Number.isFinite(+e.depth) ? +e.depth : 4) : 4,
      group: '', groupOverride: false, groupWeight: 100, scanDepth: null,
      caseSensitive: null, matchWholeWords: null, useGroupScoring: null,
      automationId: '', role: null, sticky: 0, cooldown: 0, delay: 0, displayIndex: i,
    };
  });
  return out;
}

function exportForSillyTavern(doc) {
  let entries;
  try {
    const v = JSON.parse(doc.text || '[]');
    entries = Array.isArray(v) ? v : Array.isArray(v.entries) ? v.entries : Object.values(v.entries || {});
  } catch (_) {
    return toast('The worldbook is not readable data right now — ask the crew to check it, then export.');
  }
  const blob = new Blob([JSON.stringify(worldbookToST(entries), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = doc.name.replace(/\.(md|json|txt)$/i, '') + ' - SillyTavern.json';
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} exported — in SillyTavern: World Info, then Import.`);
}
