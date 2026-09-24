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
import { $, el, openSheet, closeSheet, toast, redraw, field, select, group, ask, fold, downloadText, copyText } from './kit.js';
import { lintTransplant } from '../doc/transplant.js';
import { guessKind } from '../doc/kind.js';
import { originalCraft, ownCraft } from '../engine/crafts.js';
import { parseDoc, indexLines, estimateTokens, nameWorld, hasPlotEssential } from '../doc/index.js';
import { lint, readEvents, readWorldbook } from '../doc/lint.js';
import { parseWorldbook, worldbookToST } from '../doc/worldbook.js';
import { WHOLE_LIMIT } from '../agents/run.js';
export { worldbookToST };

const KINDS = [
  ['pe', 'Plot essential'],
  ['continuity', 'Continuation file'],
  ['worldbook', 'Worldbook'],
  ['transplant', 'Summaryception transplant'],
  ['instructions', 'AI instructions'],
  ['notes', 'Notes to yourself'],
];

let openDocIdValue = null;
/* the document as it was when he opened it, to put his own edits back (the
 * extension's Undo covers manual saves as well as the agent's) */
let openedFor = null, openedText = null, typed = false;
export const HAND_KEPT = 8;
function forgetOpening() { openedFor = null; openedText = null; typed = false; }
function recordHandEdit(id, name, before, after) {
  const p = store.getProject();
  const list = (p.undo || []).filter(Boolean);
  const mine = list.filter((u) => u.docId === id).slice(-(HAND_KEPT - 1));
  const others = list.filter((u) => u.docId !== id);
  store.setProject({ ...p, undo: [...others, ...mine, { id: 'h' + Date.now().toString(36), docId: id, name, before, after, at: Date.now() }] });
}
export function lastHandEdit(id) {
  const p = store.getProject() || {};
  const doc = (p.docs || []).find((d) => d.id === id);
  const last = (p.undo || []).filter((u) => u && u.docId === id).pop();
  return doc && last && last.after === doc.text ? last : null;
}
async function putBackHandEdit(id) {
  const last = lastHandEdit(id);
  if (!last) return toast('The document has changed since, so there is nothing to put back.');
  const p = store.getProject();
  store.setProject({ ...p, undo: (p.undo || []).filter((u) => u !== last) });
  store.writeDoc(id, last.before);
  forgetOpening();
  openOne(id);
  redraw();
  toast('Your edits are put back.');
}

/* Run the checks when he finishes with a document, not while he is typing in
 * it — mid-keystroke they would take away the empty heading he is about to
 * fill. What they repair is said once, plainly. */
export function tidyOnLeaving(id) {
  const p = store.getProject();
  const doc = (p.docs || []).find((d) => d.id === id);
  if (!doc) { forgetOpening(); return; }
  /* his own typing: every word of it is his, so nothing of it is taken out */
  const r = lint(doc.text, { kind: doc.kind || 'pe', deliverable: (doc.kind || 'pe') !== 'notes', keep: doc.text });
  let text = doc.text;
  if (r.changed) {
    store.writeDoc(id, r.text);
    text = r.text;
    const fixed = r.found.filter((f) => f.repaired).map((f) => f.said);
    if (fixed.length) toast(`In ${doc.name}, ${fixed.join('; ')}.`);
  }
  const his = openedFor === id && typed && openedText !== null && openedText !== text;
  if (his) recordHandEdit(id, doc.name, openedText, text);
  if (openedFor === id) forgetOpening();
  const named = { ...store.getProject() };
  const renamed = nameWorld(named);
  if (renamed) store.setProject(named);
  /* leaving a document is a save point: what he wrote goes to the device now,
   * not a moment later, through the same line every save takes */
  store.flush();
  if (r.changed || his || renamed) redraw();
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

  if (!hasPlotEssential(docs)) {
    const g = group('No plot essential yet',
      'Talk the world through first \u2014 nothing is written until you ask. When you\u2019re ready, say \u201cbuild it\u201d or tap Start a plot essential, and it is built from everything you said; or bring in one you already have.');
    const row = el('div', 'btnrow');
    const start = el('button', 'btn', 'Start a plot essential');
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
    if (d.kind === 'worldbook') {
      bits.push(`${parsed.sections.length} entries`);
      /* what the always-on (blue) entries cost on every single message */
      const wb = readWorldbook(d.text);
      if (wb.ok) {
        const blue = wb.entries.filter((e) => e && (String(e.strategy || '').toLowerCase() === 'blue' || e.constant === true));
        if (blue.length) bits.push(`always on: ${estimateTokens(blue.map((e) => String(e.content || '')).join('\n')).toLocaleString()} tokens`);
      }
    }
    else {
      bits.push(`${parsed.sections.length} sections`);
      if (ev && ev.ids.length) bits.push(`${ev.ids.length} events`);
    }
    g.append(el('small', '', bits.join(' · ')));
    g.addEventListener('click', () => openOne(d.id));
    row.append(g);
    body.append(row);
  }

  if (hasPlotEssential(docs)) {
    const row = el('div', 'btnrow');
    const bring = el('button', 'btn quiet', 'Bring one in');
    bring.addEventListener('click', bringIn);
    row.append(bring);
    body.append(row);
  }

  if (docs.length > 1) {
    const row = el('div', 'btnrow');
    const side = el('button', 'btn quiet', 'Side by side');
    side.addEventListener('click', () => openCompare());
    row.append(side);
    body.append(row);
  }

  if (docs.length) {
    const size = docs.reduce((n, x) => n + (x.text || '').length, 0);
    const tokens = estimateTokens(docs.map((x) => x.text || '').join('\n')).toLocaleString();
    body.append(group('What a worker reads', size <= WHOLE_LIMIT
      ? `Every document here, whole \u2014 about ${tokens} tokens \u2014 beside its own craft and the talk.`
      : `These are too big to send whole (about ${tokens} tokens), so each worker reads the outline and the parts in play, and asks for more when it needs them.`));
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
  /* empty, whatever its kind: the worldbook keeper's own craft begins an empty
   * worldbook with an append of a list, and "[]" with a list after it is not
   * one list (the extension's worldbook starts empty too) */
  await store.addDoc(clean, guessKind(clean), '');
  drawList();
  redraw();
}

function suggestName(p) {
  const docs = p.docs || [];
  if (!docs.some((d) => d.kind === 'pe')) return 'Plot Essential.md';
  const n = docs.filter((d) => d.kind === 'continuity').length + 1;
  return `Continuity File ${n}.md`;
}

/* EACH KIND OF DOCUMENT GOES TO THE ONE WHO KNOWS IT. The same three named
 * jobs everywhere; the worker behind them follows what the document is. A
 * transplant is checked by code first (the importer's own reading) and the
 * auditor is handed exactly what the code found. */
function jobsFor(doc) {
  const n = doc.name;
  if (doc.kind === 'worldbook') return [
    ['Tidy it up', 'worldbook', `Tidy up the worldbook ${n}: every entry one topic, every field chosen for what the entry is.`],
    ['Make it shorter', 'worldbook', `Make the entries in ${n} shorter without losing anything the story needs.`],
    ['Check it', 'worldbook', `Check ${n}: valid JSON, one topic per entry, keys that will fire, settings that fit each entry. Put right what is wrong.`],
  ];
  if (doc.kind === 'transplant') {
    /* the marker check runs when the button is pressed, on the document as it
     * is then, never on the copy that was on screen when the sheet opened */
    const check = () => {
      const cur = ((store.getProject() || {}).docs || []).find((d) => d.id === doc.id) || doc;
      const found = lintTransplant(cur.text || '');
      const report = found.issues.length
        ? '\n\nThe marker check (the importer\'s own reading, done by code) found:\n' + found.issues.slice(0, 40).map((x) => `- line ${x.line}: ${x.msg}`).join('\n')
        : '\n\nThe marker check (the importer\'s own reading, done by code) found nothing wrong with the markers.';
      return `*audit ${n}${report}`;
    };
    return [
      ['Tidy it up', 'auditor', `*cleanup ${n}`],
      ['Make it shorter', 'auditor', `*optimize ${n}`],
      ['Check it', 'auditor', check],
    ];
  }
  if (doc.kind === 'instructions') {
    /* a model cannot see spacing; code can (the extension's deterministic
     * check), so what code finds is handed over with the job, at the tap */
    const check = () => {
      const cur = ((store.getProject() || {}).docs || []).find((x) => x.id === doc.id) || doc;
      const found = spacingReport(cur.text || '');
      return `Check ${n} for contradictions, gaps, and rules a model could misread, and put them right.` +
        (found ? `\n\nThe spacing check (done by code) found: ${found}.` : '');
    };
    return [
      ['Tidy it up', 'instructions', `Tidy up ${n}: no rule said twice, none that contradict, nothing a model could misread.`],
      ['Make it shorter', 'instructions', `Make ${n} shorter without losing a single instruction.`],
      ['Check it', 'instructions', check],
    ];
  }
  return [
    ['Tidy it up', 'showrunner', `Tidy up ${n}.`],
    ['Make it shorter', 'compressor', `Make ${n} shorter without losing anything that matters.`],
    ['Check it', 'eye', `Check ${n} for anything wrong or contradictory, and put it right.`],
  ];
}

/* HOW EACH KEEPER WORKS IS HIS TO CHANGE (the extension's presets: Edit, and
 * Reset default for the seeded ones), found beside the document it works on.
 * An empty or unchanged craft is the original; the original is one tap away. */
export function craftNode(worker, label) {
  const box = el('div', '');
  const area = document.createElement('textarea');
  area.className = 'edit-area';
  area.value = 'reading\u2026';
  const row = el('div', 'btnrow');
  const save = el('button', 'btn small', 'Save');
  const orig = el('button', 'btn quiet small', 'Put back the original');
  row.append(save, orig);
  box.append(area, row);
  let original = '';
  originalCraft(worker).then((o) => { original = o; area.value = ownCraft(store.getHouse(), worker) || o; })
    .catch((e) => { area.value = ''; toast((e && e.message) || String(e)); });
  const keep = async (text) => {
    const h = store.getHouse();
    h.crafts = { ...(h.crafts || {}) };
    if (!text.trim() || text.trim() === original.trim()) delete h.crafts[worker];
    else h.crafts[worker] = text;
    if (worker === 'instructions') delete h.instructionsCraft;
    await store.saveHouse(h);
  };
  save.addEventListener('click', async () => { await keep(area.value); toast('Saved. They work this way from now on.'); });
  orig.addEventListener('click', async () => { await keep(''); area.value = original; toast('The original is back.'); });
  const f = fold(label, box, { className: 'fold thinking' });
  f.style.maxHeight = 'none';
  return f;
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
    /* IT ARRIVES WHOLE, as the box says: his document exactly as he gave it —
     * only a Windows line ending made plain. The checks used to run on the way
     * in and could take out what was his (a [HIDDEN] value, a "TBD:" line). */
    const kind = guessKind(clean, text);
    let words = text.replace(/\r\n?/g, '\n');
    /* a worldbook in SillyTavern's own shape, or with a stray comma, is put in
     * the one shape this house reads — its values exactly as they were */
    if (kind === 'worldbook') { const wb = readWorldbook(words); if (wb.ok && (wb.fixed || wb.reshaped)) words = JSON.stringify(wb.entries, null, 2); }
    await store.addDoc(clean, kind, words);
    const named = { ...store.getProject() };
    if (nameWorld(named)) await store.setProject(named, { now: true });
    toast(`${clean} is in, whole.`);
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
  if (openedFor !== id) {
    const opening = ((store.getProject() || {}).docs || []).find((d) => d.id === id);
    openedFor = id; openedText = opening ? opening.text : null; typed = false;
  }

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
      ask(typeof words === 'function' ? words() : words, worker);
    });
    return b;
  };
  if (doc.kind !== 'notes') {
    jobs.append(
      ...jobsFor(doc).map(([label, worker, words]) => job(label, worker, words)),
    );
  }
  if (doc.kind === 'worldbook') {
    const ex = el('button', 'btn quiet small', 'Export for SillyTavern');
    /* the worldbook as it is when he taps, not as it was when this opened */
    ex.addEventListener('click', () => exportForSillyTavern(((store.getProject() || {}).docs || []).find((d) => d.id === doc.id) || doc));
    jobs.append(ex);
  }
  body.append(jobs);
  /* how the instructions writer works: his to set, found beside what it writes */
  if (doc.kind === 'worldbook') body.append(craftNode('worldbook', 'how the worldbook keeper works'));
  if (doc.kind === 'transplant') body.append(craftNode('auditor', 'how the memory auditor works'));
  if (doc.kind === 'instructions') body.append(craftNode('instructions', 'how the instructions writer works'));

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
    typed = true;
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

  const lines = indexLines(parseDoc(doc.text, doc.kind));
  const shape = fold('everything that is in it', lines.length ? lines.join('\n') : 'nothing yet', { className: 'fold thinking' });
  shape.style.maxHeight = 'none';
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
  copy.addEventListener('click', () => copyText(area.value));
  const nowDoc = () => ((store.getProject() || {}).docs || []).find((d) => d.id === id) || doc;
  const save = el('button', 'btn quiet', 'Save as a file');
  save.addEventListener('click', () => {
    const d = nowDoc();
    const name = /\.[a-z0-9]{1,5}$/i.test(d.name) ? d.name : d.name + (d.kind === 'worldbook' ? '.json' : '.md');
    downloadText(name, d.text || '', /\.json$/i.test(name) ? 'application/json' : 'text/markdown');
    toast(`Saved as ${name}.`);
  });
  const dup = el('button', 'btn quiet', 'Duplicate');
  dup.addEventListener('click', async () => {
    const d = nowDoc();
    const taken = new Set(((store.getProject() || {}).docs || []).map((x) => x.name));
    const m = /^(.*?)(\.[a-z0-9]{1,5})?$/i.exec(d.name);
    let name = '';
    for (let n = 1; !name || taken.has(name); n++) name = `${m[1]} (copy${n > 1 ? ' ' + n : ''})${m[2] || ''}`;
    await store.addDoc(name, d.kind, d.text || '');
    toast(`Duplicated as ${name}.`);
    redraw();
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
  row.append(rename, copy, save, dup);
  if (lastHandEdit(id)) {
    const back = el('button', 'btn quiet', 'Put back my edits');
    back.addEventListener('click', () => putBackHandEdit(id));
    row.append(back);
  }
  row.append(del);
  tools.append(field('What kind of document this is', kind), row);
  body.append(tools);
}

/* --- SillyTavern ------------------------------------------------------------ */

/* THE WORLDBOOK IS FOR USING, and he uses it in SillyTavern. The mapping is
 * Cozy Chat's (v5.13.0), carried over exactly: blue → constant, green →
 * selective on its keys, chain → vectorized; position, order, depth and
 * probability carried across. */


function exportForSillyTavern(doc) {
  /* READ THE WAY THE HOUSE READS EVERY WORLDBOOK, then map it with the
   * extension's own pipeline. The house's reading repairs what code can — a
   * stray comma, a line break inside a value, a list written after a list, a
   * list wrapped as {entries} or in SillyTavern's own shape — and the documents
   * list already counted entries that way; the export read with the
   * extension's reader alone, and refused a worldbook it was counting. Only
   * what no rule can read is left for the keeper (Check it, on this page). */
  const read = readWorldbook(doc.text || '');
  if (!read.ok) return toast(`The worldbook cannot be read as data right now (${read.why}) \u2014 tap Check it and it will be put right, then export.`);
  const p = parseWorldbook(JSON.stringify(read.entries));
  if (p.error) return toast(`The worldbook cannot be read as data right now (${p.error}) \u2014 tap Check it and it will be put right, then export.`);
  if (!p.entries.length) return toast('There are no entries in this worldbook yet.');
  downloadText(doc.name.replace(/\.(md|json|txt)$/i, '') + ' - SillyTavern.json', JSON.stringify(worldbookToST(p.entries), null, 2));
  const counts = p.entries.reduce((n, e) => { n[e.strategy] = (n[e.strategy] || 0) + 1; return n; }, {});
  toast(`${p.entries.length} entr${p.entries.length === 1 ? 'y' : 'ies'} exported (${Object.entries(counts).map(([k, v]) => v + ' ' + k).join(', ')}) \u2014 in SillyTavern: World Info, then Import.`);
}

/* SIDE BY SIDE (the Plot Essential Maker's v0.11.0 compare view): two to four
 * documents next to each other, read only, each with its own Copy. A tap on a
 * name shows or hides it. Nothing here changes anything. */
function openCompare(chosen = null) {
  const docs = ((store.getProject() || {}).docs || []);
  const pick = (chosen || docs.slice(0, 2).map((x) => x.id)).filter((id) => docs.some((x) => x.id === id));
  const body = $('docsBody');
  body.innerHTML = '';
  /* back to the list the same way as from anywhere in here: All documents, at
   * the top (it used to be a second button with a second name, down here) */
  $('docsTitle').textContent = 'Side by side';
  const action = $('docsAction');
  action.textContent = 'All documents';
  action.onclick = () => openDocs();
  body.append(group('Side by side', 'Read only. Tap a name to show or hide it \u2014 up to four at once.'));
  const names = el('div', 'btnrow');
  for (const x of docs) {
    const on = pick.includes(x.id);
    const b = el('button', 'btn small' + (on ? '' : ' quiet'), x.name);
    b.addEventListener('click', () => openCompare(on ? pick.filter((id) => id !== x.id) : [...pick, x.id].slice(-4)));
    names.append(b);
  }
  body.append(names);
  const panes = el('div', 'compare');
  for (const id of pick) {
    const x = docs.find((y) => y.id === id);
    const pane = el('div', 'pane');
    const head = el('div', 'pane-head');
    head.append(el('b', '', x.name));
    const cp = el('button', 'btn quiet small', 'Copy');
    cp.addEventListener('click', () => copyText(x.text || ''));
    head.append(cp);
    pane.append(head, el('div', 'pane-text', x.text || '(empty)'));
    panes.append(pane);
  }
  body.append(panes);
}

/* Spacing a model cannot see: doubled spaces inside a line (indentation is
 * left alone), spaces at the end of a line, tabs. Line numbers, in words. */
export function spacingReport(text) {
  const doubled = [], trailing = [], tabs = [];
  String(text || '').split('\n').forEach((line, i) => {
    const body = line.replace(/^\s+/, '');
    if (/\S {2,}\S/.test(body)) doubled.push(i + 1);
    if (/[ \t]+$/.test(line)) trailing.push(i + 1);
    if (line.includes('\t')) tabs.push(i + 1);
  });
  const say = (label, lines) => (lines.length ? `${label} on line${lines.length > 1 ? 's' : ''} ${lines.slice(0, 12).join(', ')}${lines.length > 12 ? ` and ${lines.length - 12} more` : ''}` : '');
  return [say('doubled spaces inside a line', doubled), say('spaces at the end of a line', trailing), say('tabs', tabs)].filter(Boolean).join('; ');
}
