/* CozyMaker — js/engine/slices.js
 *
 * The maker's whole craft lives in ONE file: engine/generalist.md. Nothing in
 * this app restates a law from it, because a law written twice is a law that
 * will disagree with itself. This module reads that file, cuts it at its own
 * section headings, and hands each backstage worker exactly the sections its
 * job needs — and nothing else.
 *
 * That is the whole argument for having several workers instead of one. The
 * craft is ~122,000 characters. No worker ever carries all of it: the biggest
 * slice is under 42,000, most are near 26,000. A worker reading only its own
 * laws applies them; a worker reading all of them skims.
 *
 * Heading shapes, confirmed against the real file (75 sections, no duplicate
 * numbers, 122,336 of 122,410 characters captured):
 *   top level  "7 · WORKFLOWS"          number, middle dot, TITLE
 *   sub level  "7.1 Setup (`*new`)"     dotted number, then the title
 * A bare "1 Holistic read — …" is a numbered list item, not a heading; it has
 * neither a middle dot nor a dotted number, which is how the two are told
 * apart. Lines inside a fenced block, and table rows, are never headings.
 */

let CACHE = null;
/* the engine as it is written, word for word: what the one he talks to reads */
let RAW = null;

const TOP = /^(\d+)\s+·\s+(\S.*)$/;
const SUB = /^(\d+(?:\.\d+)+)\s+(\S.*)$/;

/* Cut the craft into addressable sections. Pure — give it text, get a map. */
export function cutSections(src) {
  const lines = String(src || '').split('\n');
  const marks = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (l.indexOf('|') !== -1) continue;
    const m = TOP.exec(l) || SUB.exec(l);
    if (m) marks.push({ line: i, id: m[1], title: m[2] });
  }
  const map = new Map();
  for (let n = 0; n < marks.length; n++) {
    const from = marks[n].line;
    const to = n + 1 < marks.length ? marks[n + 1].line : lines.length;
    map.set(marks[n].id, {
      id: marks[n].id,
      title: marks[n].title,
      text: lines.slice(from, to).join('\n').replace(/\s+$/, ''),
    });
  }
  return map;
}

/* THE LAWS EVERY WORKER CARRIES.
 * Who the maker is, how it talks to the writer, what each field may hold,
 * how bonds are priced, what the MC's dossier may never contain, what is
 * appended and what is overwritten, the lazy-load rule, the writing
 * principles, and the document's shape. A worker without these can be
 * correct about its own job and still produce a file that breaks. */
/* THE SPINE — what every worker reads. It carries the Core Mandates (1.1),
 * which the craft says override all other rules and which every workflow
 * cites by name (M1, M2, M3, M5), and what the Expert Eye asks of any work
 * (2, 2.1, 2.3). Seven of the nine workers were once told to apply them and
 * never given them; a worker told to use something it never receives invents
 * it. tests/units.mjs holds this: no worker is ordered to run a named check
 * whose section it does not read. */
export const SPINE = ['1', '1.1', '1.3', '2', '2.1', '2.3', '3.1', '3.2', '3.3', '3.4', '3.6', '4', '6.1', '6.2', '6.3'];

/* The eye's own sections, on top of the spine (v2.0: the one he talks to reads
 * the whole engine and does the plot essential's work itself; the eye is the one
 * helper on this craft, reading back with fresh eyes) — every check its read-back
 * runs: the Expert Eye whole (2–2.7), the Core Mandates and severity (1.1, 1.2),
 * the Verification Engine (7.3), the alert list (12), its worked examples (13.4,
 * 13.6, 13.7) and the Auto-Fix Mandate (8.2). */
export const SLICES = {
  eye:            ['2', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '1.1', '1.2', '7.3', '12', '13.6', '13.7', '13.4', '8.2'],
};

/* What each helper on this craft is for, in the writer's own words. */
export const JOBS = {
  eye:           'reads the documents back with fresh eyes and puts right what slipped past',
};

/* Fetch the craft once. */
export async function loadEngine(fetcher = fetch) {
  if (CACHE) return CACHE;
  /* Rooted, not relative. A relative fetch resolves against whatever base
   * the caller happens to have, and a craft file that quietly 404s leaves
   * every worker reading nothing while the app looks perfectly well. */
  const res = await fetcher('/engine/generalist.md', { cache: 'no-store' });
  if (!res.ok) throw new Error('the craft file could not be read (engine/generalist.md)');
  const text = await res.text();
  RAW = text;
  CACHE = cutSections(text);
  return CACHE;
}

/* The whole engine, word for word — for the one he talks to, which reads all of it. */
export async function loadEngineText(fetcher = fetch) {
  if (RAW) return RAW;
  const sections = await loadEngine(fetcher);
  if (RAW) return RAW;
  return [...sections.values()].map((x) => x.text).join('\n\n');
}

export function setEngineForTests(map, raw = null) { CACHE = map; RAW = raw; }

/* Build one worker's reading. Missing ids are reported rather than silently
 * dropped — a worker quietly short a law is the bug that never gets found. */
export function sliceFor(sections, worker) {
  const own = SLICES[worker];
  if (!own) throw new Error('no such worker: ' + worker);
  const ids = SPINE.concat(own);
  const seen = new Set();
  const parts = [];
  const missing = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const s = sections.get(id);
    if (!s) { missing.push(id); continue; }
    parts.push(s.text);
  }
  return { text: parts.join('\n\n---\n\n'), ids: [...seen], missing };
}

/* Every worker's slice size, for the record. */
export function sliceReport(sections) {
  const rows = [];
  for (const w of Object.keys(SLICES)) {
    const s = sliceFor(sections, w);
    rows.push({ worker: w, chars: s.text.length, sections: s.ids.length, missing: s.missing });
  }
  return rows;
}
