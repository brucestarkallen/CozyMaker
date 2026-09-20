/* CozyMaker — js/ui/docs.js
 * The documents. The plot essential, the continuation files, the worldbook —
 * open one, read it, change a line by hand if you feel like it. The crew's
 * changes and yours land in the same place, because there is only one place. */

import * as store from '../store.js';
import { $, el, openSheet, toast, redraw, field, select, group } from './kit.js';
import { parseDoc, indexLines, estimateTokens } from '../doc/index.js';
import { lint, readEvents } from '../doc/lint.js';

const KINDS = [
  ['pe', 'Plot essential'],
  ['continuity', 'Continuation file'],
  ['worldbook', 'Worldbook'],
  ['notes', 'Notes to yourself'],
];

let openDocIdValue = null;

/* Run the checks when the writer finishes with a document, not while he is
 * typing in it. Mid-keystroke it would take away the empty heading he is
 * about to fill; on the way out it is simply tidy. There is no button for
 * this and there is not meant to be — one door for one act. */
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

export function openDocs() {
  if (openDocIdValue) tidyOnLeaving(openDocIdValue);
  openDocIdValue = null;
  $('docsTitle').textContent = 'The documents';
  const action = $('docsAction');
  action.textContent = 'New';
  action.onclick = newDoc;
  drawList();
  openSheet('docsSheet');
}

function drawList() {
  const body = $('docsBody');
  const p = store.getProject();
  body.innerHTML = '';
  const docs = (p.docs || []);

  if (!docs.length) {
    body.append(el('p', 'hint',
      'Nothing yet. Tell them about your world in the room and the plot essential gets built for you — or tap New and start one by hand.'));
    return;
  }

  for (const d of docs) {
    const row = el('div', 'row');
    const g = el('div', 'grow');
    g.append(el('b', '', d.name));
    const parsed = parseDoc(d.text, d.kind);
    const ev = d.kind === 'worldbook' ? null : readEvents(d.text);
    const bits = [
      kindLabel(d.kind),
      `${estimateTokens(d.text).toLocaleString()} tokens`,
    ];
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

  const g2 = group('A copy on the device',
    'Every document is also written as plain markdown in ~/.cozymaker/exports, so you can reach it from the shell without opening this.');
  body.append(g2);
}

function kindLabel(kind) {
  const hit = KINDS.find((k) => k[0] === (kind || 'pe'));
  return hit ? hit[1] : 'Document';
}

async function newDoc() {
  const p = store.getProject();
  const name = prompt('What is it called?', suggestName(p));
  if (name === null) return;
  const clean = (name.trim() || 'Untitled') + (/\.(md|json|txt)$/i.test(name.trim()) ? '' : '.md');
  if ((p.docs || []).some((d) => d.name === clean)) return toast('There is already one called that.');
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

function guessKind(name) {
  const n = name.toLowerCase();
  if (n.includes('worldbook') || n.endsWith('.json')) return 'worldbook';
  if (n.includes('continuity') || n.includes('brief') || /file\s*\d/.test(n)) return 'continuity';
  if (n.includes('note')) return 'notes';
  return 'pe';
}

/* ------------------------------------------------------------- one of them */

function openOne(id) {
  const p = store.getProject();
  const doc = (p.docs || []).find((d) => d.id === id);
  if (!doc) return;
  openDocIdValue = id;

  $('docsTitle').textContent = doc.name;
  const action = $('docsAction');
  action.textContent = 'Back';
  action.onclick = () => openDocs();

  const body = $('docsBody');
  body.innerHTML = '';
  body.style.padding = '0';

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
    refreshMeta();
  });

  const del = el('button', 'btn danger', 'Delete');
  del.addEventListener('click', async () => {
    if (!confirm(`Delete ${doc.name}? A copy stays in the backups folder on the device.`)) return;
    await store.removeDoc(id);
    openDocs();
    redraw();
  });

  row.append(rename, copy, del);
  tools.append(field('What kind of document this is', kind), row);
  body.append(tools);

  body.style.padding = '';
}

export function currentDocId() { return openDocIdValue; }
