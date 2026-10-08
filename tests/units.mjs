/* CozyMaker — tests/units.mjs
 *
 * Every test here RUNS the thing. Text goes in, the real function does the
 * real work, and the assertion is on what came back. Nothing in this file
 * reads source, counts files, or checks a comment; a test that would still
 * pass with the feature deleted is worse than no test.
 *
 *   node tests/units.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

import { cutSections, sliceFor, sliceReport, SLICES, SPINE, setEngineForTests } from '../js/engine/slices.js';
import { parseDoc, indexLines, inPlay, brief, readNeed, stripNeed, resolveNeed, estimateTokens } from '../js/doc/index.js';
import { parseEdits, stripEdits, tolerantJson, locate, applyEdit, applyRun, undoBatch, hash, salvageEdits, stripTrailingCommasOutsideStrings, escapeRawControlsInStrings, stripThinking } from '../js/doc/edits.js';
import { lint, countOf, lostSomething, readEvents, namedPersonGate } from '../js/doc/lint.js';
import { buildRequest, readAnswer, readChunk, houseOf, alwaysThinks, thinkingFields, thinkingStyle, withoutThinking } from '../js/providers.js';
import { personaOf, greeting, openingFor, voiceMacros, unfilledMacros, framePerson } from '../js/agents/persona.js';
import { upgradeWorld } from '../js/store.js';
import { worldbookToST } from '../js/ui/docs.js';
import { guessKind, kindFor } from '../js/doc/kind.js';
import { when } from '../js/ui/kit.js';
import { callModel } from '../js/agents/call.js';
import { pickConnection } from '../js/agents/roster.js';
import { commit, capUndo, UNDO_KEPT, frontBody, landTurn, oneVoice, conversationFor, claimsAChange, endAtControlToken, docBriefs, either, WHOLE_LIMIT, checkChanged, visibleText } from '../js/agents/run.js';

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++; failures.push(name + (detail ? ` — ${detail}` : ''));
}
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  ok(name, a === b, `got ${a} want ${b}`);
}

function wholeAnswer(obj) { return new Response(JSON.stringify(obj), { status: 200 }); }

/* =================================================== the craft, cut up */

const ENGINE = readFileSync(join(ROOT, 'engine/generalist.md'), 'utf8');
const SECTIONS = cutSections(ENGINE);
setEngineForTests(SECTIONS);

ok('craft cuts into sections', SECTIONS.size === 75, `got ${SECTIONS.size}`);
ok('craft keeps its top-level parts', ['1', '7', '8', '10', '12', '14'].every((id) => SECTIONS.has(id)));
ok('craft keeps its deep parts', SECTIONS.has('8.8.1') && SECTIONS.has('8.8.3'));
ok('a numbered list item is not mistaken for a heading',
  ![...SECTIONS.values()].some((s) => /^Holistic read/.test(s.title)));
ok('section 7.1 really is the setup workflow', /\*new/.test(SECTIONS.get('7.1').text) && /PROACTIVE CO-WRITER/.test(SECTIONS.get('7.1').text));
ok('section 12 really is the alert list', SECTIONS.get('12').text.includes('[PARROT_FIX]'));

let captured = 0;
for (const s of SECTIONS.values()) captured += s.text.length;
ok('almost nothing falls between sections', captured > ENGINE.length - 200, `captured ${captured} of ${ENGINE.length}`);

for (const w of Object.keys(SLICES)) {
  const s = sliceFor(SECTIONS, w);
  ok(`${w} is handed every law it was promised`, s.missing.length === 0, s.missing.join(','));
  ok(`${w} carries the shared laws`, s.text.includes('Field Taxonomy') && s.text.includes('WRITING PRINCIPLES'));
  ok(`${w} carries less than the whole craft`, s.text.length < ENGINE.length * 0.5,
    `${s.text.length} vs ${ENGINE.length}`);
}
/* the alert list is known by its own heading and words, not by one alert's name
 * (that name is also used in 1.2, 2.3, 2.7, 7.7 and 13.6, which others read) */
const ALERTS = SECTIONS.get('12').text;
ok('the eye is handed the alert list', sliceFor(SECTIONS, 'eye').text.includes(ALERTS));

/* NO WORKER IS ORDERED TO RUN A CHECK IT WAS NEVER GIVEN. Every named check in
 * the craft, and the section that defines it; a worker whose reading names one
 * must read its section, or the reason it need not is written here. Before
 * v1.2.4 seven of nine workers were told to apply the Core Mandates (M1, M2,
 * M5) and never given them, the builder was told to run the Verification
 * Engine and Tier A before delivering and given neither, and the compressor
 * was told to re-run the Shared Audit Pipeline it had never read. A worker
 * told to use something it never receives invents it. */
{
  const NAMED = {
    'Verification Engine': '7.3', 'Mechanical Audit': '7.3', 'Disease Scan': '7.3', 'Stale-Assumption Scan': '7.3',
    'Tier A': '2.4', 'Tier B': '2.5', 'Tier C': '2.6', 'Expert Eye': '2', 'Auto-Fix Mandate': '8.2', 'Deliverable Purity': '8.2',
    'Shared Audit Pipeline': '8.3', 'CBPA': '7.2', 'Protocol 20': '7.5', 'Protocol 21': '7.5', 'Protocol 25': '7.5',
    'Anti-Parrot': '2.1', 'SCAN EVIDENCE': '2.3', 'Evidence Requirement': '2.3', 'Field Update Contract': '3.4',
    'Hierarchy of Narrative Truth': '3.5', 'Dual Index': '3.7', 'Zero-Loss Verification': '8.8.3', 'Stacking Architecture': '8.4',
    'Narrative X-Ray': '10.1', 'Cleanup Manifest': '10.2', 'Viability Simulation': '9.3', 'Cascade Analysis': '9.4',
    'Edit Mode Discipline': '7.7', 'Surgical Default': '7.7', 'Update Pipeline': '7.2', 'Crowd Perception': '13.4',
    'Severity Ordering': '1.2', 'Summaryception Input Mode': '8.6', 'GENERALIST NOTES': '7.4', 'MEMORY MAP': '3.6',
    'Transactional Read': '2.2', 'Continuation File Model': '8.1', 'Command Parsing': '7.6',
  };
  for (let i = 1; i <= 8; i++) NAMED[`M${i}`] = '1.1';
  /* why a section named in a worker's reading need not be read by it */
  const EVERYONE = { '7.4': 'the craft\'s output protocol is replaced by the house\'s own return contract' };
  const READ_BACK = new Set(['2.4', '2.5', '2.6', '8.2']);   /* the eye holds these and reads back every change but a surgical edit */
  const OWN = {
    scribe: { '8.7': 'section 8 names *ooc in its heading; that is the diagnostician\'s job' },
    compressor: { '8.5': 'its own Step 3 and Step 4 restate the Golden Rule and the four-question test in full' },
    /* the showrunner reads the craft's command table (11) for #prune, defined nowhere else; the table names
     * every other workflow too, and those are other workers' jobs */
    showrunner: { '7.1': 'the command table names *new\'s setup; the builder\'s job', '7.2': 'the command table names *p and #q; the chronicler\'s job',
      '8.5': 'the command table names *continuity\'s format; the scribe\'s job', '8.7': 'the command table names *ooc; the diagnostician\'s job',
      '8.9': 'the command table names *import; the builder\'s job' },
    editor: { '7.2': 'the CBPA is named only on the *p row of its command table, the chronicler\'s job',
      '8.2': 'its Tier A carries the purity test itself, and the house\'s contract keeps anything but the story out of a document' },
  };
  const eyeReads = new Set([...SPINE, ...SLICES.eye]);
  ok('the eye really holds what the others lean on it for', [...READ_BACK].every((id) => eyeReads.has(id)));
  for (const w of Object.keys(SLICES)) {
    const reads = new Set([...SPINE, ...SLICES[w]]);
    const text = [...reads].map((id) => (SECTIONS.get(id) || { text: '' }).text).join('\n');
    const gaps = new Set();
    const need = (sec, why) => {
      if (!SECTIONS.has(sec) || reads.has(sec) || EVERYONE[sec] || (OWN[w] || {})[sec]) return;
      if (w !== 'editor' && w !== 'eye' && READ_BACK.has(sec)) return;
      gaps.add(`${sec} (${why})`);
    };
    for (const [name, sec] of Object.entries(NAMED)) {
      const re = new RegExp('\\b' + name.replace(/[-\s]/g, '[-\\s]') + '\\b', /^M\d$/.test(name) ? '' : 'i');
      if (re.test(text)) need(sec, name);
    }
    for (const mm of text.matchAll(/(?:Section|\u00a7|\()\s*(\d{1,2}(?:\.\d+){1,2})\)?/g)) need(mm[1], `(${mm[1]})`);
    ok(`${w} is given every check its reading orders it to run`, gaps.size === 0, [...gaps].join('; '));
  }
}

const REPORT = sliceReport(SECTIONS);
const biggest = Math.max(...REPORT.map((r) => r.chars));
ok('the eye carries only its part of the craft (the one he talks to reads all of it)', biggest < ENGINE.length * 0.5, `biggest slice ${biggest} of ${ENGINE.length}`);

/* ====================================================== a real document */

const PE = `# PLOT ESSENTIAL — The Ashwood Pact — V1.0
# STATE: Tuesday 15 April 247 AGC, 09:24 / Council Chamber
# CALENDAR: Fantasy 12-month (AGC)

## WORLD
### Rules
- Epistemic Law: NPCs know ONLY what they personally witnessed.
- Majority is sixteen.

### Calendar
Fantasy 12-month (AGC), year counted from the Great Concord.

## MC — Jovan (17)
ID: Tall, dark-haired, a fencer's build.
CORE: Reads a room before he speaks. Decides early and quietly.
SKILLS: Tactics, cold reading, a duellist's hand.
→ Claire: fond of her (P:60 R:35 S:25)

### Claire (student | core | 16)
ID: Small, freckled, always ink on her fingers.
CORE: Stubborn, catches detail nobody else does. Jovan keeps unsettling her.
GROWTH:
- e024: stopped retreating — cornered by Jovan after the council
→ Jovan: refuses to back down (P:60 R:35 S:25)

### Emilia (councillor | secondary | 41)
ID: Grey at the temples, never hurries.
CORE: Measures every sentence before it leaves her.
→ Jovan: wary of him (P:30 R:0 S:0)

## MINOR CHARACTERS

## TIMELINE
e001 [Mon 14 Apr 247, 09:00] [setup]: The showcase opened in the east hall.
e002 [Mon 14 Apr 247, 11:30] [decisive]: Alaric's arm broke in the third bout.
e003 [Tue 15 Apr 247, 09:09] [political]: Jovan argued for doing nothing.
  > "Let anonymity protect him." —Jovan
e004 [tension]: Emilia pressed him on the blank directive. [EPISTEMIC_VIOLATION]
  REL: Emilia → Jovan: P-5 R+0 S+0 (now: P:25 R:0 S:0)

## SCENE
WHERE: Council Chamber / PRESENT: Jovan, Emilia /
ACTIVITY: Emilia waiting on an answer / HOOK: the directive is still blank /
LAST: "I'll have it by evening." —Jovan
`;

const doc = parseDoc(PE, 'pe');
eq('the header lines are read', doc.head.length, 3);
ok('the sections are found', doc.sections.length >= 8, `got ${doc.sections.length}`);
ok('a dossier is its own section', doc.sections.some((s) => s.title.startsWith('Claire')));
ok('the timeline holds its events', doc.sections.find((s) => s.title === 'TIMELINE').events.length === 4);
ok('an event carries its tag', doc.sections.find((s) => s.title === 'TIMELINE').events[1].tag === 'Mon 14 Apr 247, 11:30');

const idx = indexLines(doc);
ok('every section gets one line in the shape', idx.length === doc.sections.length);
ok('the timeline line says how many events and which', idx.some((l) => /TIMELINE — 4 events, e001 to e004/.test(l)));
ok('a dossier line names the dossier', idx.some((l) => l.includes('Claire (student | core | 16)')));
ok('a grouping heading is described as a grouping, not as a size',
  idx.some((l) => l === 'WORLD — what follows is under this'),
  JSON.stringify(idx.filter((l) => l.startsWith('WORLD'))));
ok('a real section still reports its size', idx.some((l) => /^\s*Rules — \d+ characters/.test(l)));

const play = inPlay(doc, { message: 'change Claire’s age to 15' });
ok('a named character is put in front of us', play.some((b) => b.title.startsWith('Claire')));
ok('the live moment is always in front of us', play.some((b) => b.title === 'SCENE'));
ok('the hard rules are always in front of us', play.some((b) => b.title === 'Rules'));
ok('an unnamed character is NOT sent in full', !play.some((b) => b.title.startsWith('Emilia')));

const b = brief(doc, 'Plot Essential.md', { message: 'Claire' });
ok('the brief names every section that exists', b.includes('Emilia (councillor | secondary | 41)'));
ok('a section not in play is named with a one-line gist', b.includes('Emilia (councillor | secondary | 41) — 168 characters'));
ok('a section not in play does not send its body', !b.includes('→ Jovan: wary of him'));
ok('the brief says how to ask for more', b.includes('<need>'));
ok('the brief is much smaller than the document plus everything',
  b.length < PE.length * 1.4, `brief ${b.length} vs doc ${PE.length}`);

eq('a request for more is read', readNeed('sure thing <need>Emilia, WORLD</need> ok'), ['Emilia', 'WORLD']);
eq('the request is taken back out', stripNeed('a <need>x</need> b').replace(/\s+/g, ' '), 'a b');
const resolved = resolveNeed(doc, ['Emilia', 'nothing at all']);
ok('a request resolves onto the right section', resolved.length === 1 && resolved[0].startsWith('emilia'));

/* recent-events trimming */
const many = PE.replace('e004 [tension]', Array.from({ length: 30 }, (_, i) =>
  `e1${String(i).padStart(2, '0')} [Mon 14 Apr 247, 0${(i % 9) + 1}:00] [routine]: filler ${i}.`).join('\n') + '\ne004 [tension]');
const bigDoc = parseDoc(many, 'pe');
const bigPlay = inPlay(bigDoc, { message: 'TIMELINE' });
const tl = bigPlay.find((x) => x.title === 'TIMELINE');
ok('a long timeline is not sent whole', tl && tl.text.length < bigDoc.sections.find((s) => s.title === 'TIMELINE').text.length);
ok('a long timeline still sends the newest events', tl && tl.text.includes('e004'));
ok('a long timeline says the rest are listed above', tl && tl.text.includes('listed in the shape above'));

/* ============================================================= the edits */

const block = `Sure — done.

<edits>
[
  {"file":"Plot Essential.md","find":"CORE: Stubborn, catches detail nobody else does.","replace":"CORE: Stubborn, catches detail nobody else does. Slow to trust.","reason":"deepens her"},
]
</edits>`;
const parsed = parseEdits(block);
ok('a trailing comma is forgiven', parsed.edits.length === 1, parsed.warn);
ok('the block is taken out of what the writer sees', !stripEdits(block).includes('<edits>'));
ok('the words around the block survive', stripEdits(block).startsWith('Sure — done.'));
ok('unreadable data is reported, not swallowed', parseEdits('<edits>{{{</edits>').warn.length > 0);
ok('a single object is accepted as one change', tolerantJson('{"find":"a","replace":"b"}').value.length === 1);
ok('a fenced block is forgiven', tolerantJson('```json\n[{"find":"a"}]\n```').ok);

const one = locate(PE, 'CORE: Stubborn, catches detail nobody else does.');
ok('an exact find lands', one.ok && one.how === 'exact');
const twice = locate(PE, '(P:60 R:35 S:25)');
ok('two matches is a refusal, not a guess', !twice.ok && /appear 2 times/.test(twice.why), twice.why);
const spaced = locate(PE, 'CORE:   Measures every  sentence before it leaves her.');
ok('different spacing still lands', spaced.ok && spaced.how === 'spacing', JSON.stringify(spaced));
ok('the spacing match covers the right words',
  spaced.ok && PE.slice(spaced.from, spaced.to) === 'CORE: Measures every sentence before it leaves her.',
  spaced.ok ? JSON.stringify(PE.slice(spaced.from, spaced.to)) : '');
const close = locate(PE, 'ID: Small, freckled, always ink on her fingertips.');
/* This line once asserted a near miss LANDS. The Plot Essential Maker learned the hard way that a near
 * miss is a misquote, and landing it writes over real words (v0.11.10-v0.11.13). */
ok('a near miss is refused, never guessed', !close.ok);
const nowhere = locate(PE, 'this sentence is not in the document anywhere at all');
ok('words that are not there are refused', !nowhere.ok);

const e1 = applyEdit(PE, { find: 'Majority is sixteen.', replace: 'Majority is seventeen.' });
ok('a change lands where it should', e1.ok && e1.text.includes('Majority is seventeen.'));
ok('a change does not touch anything else', e1.ok && e1.text.length === PE.length + 2, `${e1.text.length} vs ${PE.length}`);
const e2 = applyEdit(PE, { insert_after: '## MINOR CHARACTERS', replace: '- Harken (e003) — Stella\'s mentor' });
ok('text goes in under its anchor', e2.ok && /## MINOR CHARACTERS\n- Harken/.test(e2.text));
const e3 = applyEdit('a b a b', { find: 'a', replace: 'X', all: true });
ok('every one can be changed at once', e3.ok && e3.text === 'X b X b');
const e4 = applyEdit(PE, { append: true, replace: '\n## GENERALIST NOTES\nnone' });
ok('text can be added at the end', e4.ok && e4.text.endsWith('none'));

const docs = [{ name: 'Plot Essential.md', kind: 'pe', text: PE }];
const run = applyRun(docs, [
  { file: 'Plot Essential.md', find: 'Majority is sixteen.', replace: 'Majority is fifteen.', reason: 'the world got younger' },
  { file: 'Plot Essential.md', find: 'nowhere at all', replace: 'x', reason: 'will not land' },
  { create_file: 'Worldbook.json', replace: '[]', reason: 'somewhere to put lore' },
], { label: 'a test' });
eq('one change landed, one refused, one document started',
  run.cards.map((c) => c.status), ['applied', 'refused', 'applied']);
ok('the new document exists', run.texts.has('Worldbook.json'));
ok('the refusal says why', run.cards[1].why.length > 0);
ok('an undo batch was written down', run.batch && run.batch.items.length === 2);

const after = [...run.texts].map(([name, text]) => ({ name, text }));
const back = undoBatch(after, run.batch);
ok('undo is allowed when nothing moved', back.ok, back.why);
ok('undo removes a document that was created', back.changes.find((c) => c.name === 'Worldbook.json').remove === true);
ok('undo restores the old words', back.changes.find((c) => c.name === 'Plot Essential.md').text === PE);

const drifted = after.map((d) => (d.name === 'Plot Essential.md' ? { ...d, text: d.text + '\nsomething newer' } : d));
const refusedUndo = undoBatch(drifted, run.batch);
ok('undo refuses loudly when something newer is there', !refusedUndo.ok && /changed since/.test(refusedUndo.why), refusedUndo.why);

ok('the same words fingerprint the same', hash('abc') === hash('abc'));
ok('different words fingerprint differently', hash('abc') !== hash('abd'));

/* ============================================================== the lint */

const L = lint(PE, { kind: 'pe' });
ok('a working marker is taken out of the document', !L.text.includes('[EPISTEMIC_VIOLATION]'));
ok('the marker removal is reported', L.found.some((f) => f.repaired && /marker/.test(f.said)));
ok('a bond on the main character is moved off', !/^→ Claire/m.test(L.text.split('### Claire')[0]));
ok('the main character keeps everything else', L.text.includes('SKILLS: Tactics, cold reading'));
ok('another dossier keeps its bonds', /### Claire[\s\S]*?→ Jovan:/.test(L.text));
ok('an empty heading is removed', !L.text.includes('## MINOR CHARACTERS'));
ok('a full heading is kept', L.text.includes('## TIMELINE') && L.text.includes('## SCENE'));

/* THE ONE THAT WAS SHIPPED BROKEN AND GREEN: a heading whose content is other
 * headings is a grouping, not an empty section. The first version deleted
 * "## WORLD" out of every plot essential on every save, because what follows
 * it is "### Rules". */
ok('a heading holding only subsections survives', L.text.includes('## WORLD'),
  'WORLD was deleted: ' + L.text.slice(0, 160));
ok('its subsections survive with it', L.text.includes('### Rules') && L.text.includes('### Calendar'));
ok('the main character heading survives', L.text.includes('## MC — Jovan (17)'));

const shapes = {
  'blank then another heading':   ['## A\n\n## B\nreal\n', false],
  'blank then the end':           ['## A\nbody\n\n## GONE\n\n', false],
  'nothing at all after it':      ['## A\nbody\n\n## GONE', false],
  'only a divider under it':      ['## A\nbody\n\n## GONE\n---\n\n## B\nx\n', false],
  'real content under it':        ['## A\nbody\n\n## GONE\n\ne002 [tension]: a thing.\n', true],
  'a subsection with content':    ['## GONE\n### Under\n- a fact\n', true],
  'only an empty subsection':     ['## A\nbody\n\n## GONE\n### Under\n\n', false],
};
for (const [name, [src, shouldStay]] of Object.entries(shapes)) {
  const r = lint(src, { kind: 'pe' });
  ok(`an empty heading, ${name}`, r.text.includes('## GONE') === shouldStay,
    JSON.stringify(r.text));
}
ok('when a parent goes its empty child goes with it',
  !lint('## A\nbody\n\n## GONE\n### Under\n\n', { kind: 'pe' }).text.includes('### Under'));
ok('only the outermost removal is reported',
  lint('## A\nbody\n\n## GONE\n### Under\n\n', { kind: 'pe' })
    .found.filter((f) => /empty heading/.test(f.check))[0].said.includes('(GONE)'));
ok('a heading inside a fenced block is left alone',
  lint('## A\nbody\n\n```\n## not a heading\n```\n', { kind: 'pe' }).text.includes('## not a heading'));
ok('an event without a full date-time is handed to the chronicler',
  L.found.some((f) => f.worker === 'chronicler' && /without a full date-time/.test(f.check)));
ok('the undated event is named', L.found.some((f) => /e004/.test(f.said)));
ok('a name inside a trait is handed to the editor',
  L.found.some((f) => f.worker === 'editor' && /name inside/.test(f.check)), JSON.stringify(L.found.map((f) => f.check)));
ok('the trait bleed names who and whom',
  L.found.some((f) => /Claire mentions Jovan/.test(f.said)));
ok('a trait bleed on the main character names him, not "a dossier"',
  namedPersonGate('## MC — Jovan (17)\nCORE: quiet, but Claire unsettles him\n\n### Claire (x | core | 16)\nID: small\nCORE: stubborn')
    .some((h) => /^Jovan mentions Claire/.test(h)),
  JSON.stringify(namedPersonGate('## MC — Jovan (17)\nCORE: quiet, but Claire unsettles him\n\n### Claire (x | core | 16)\nID: small\nCORE: stubborn')));

const clamped = lint('→ X: y (now: P:140 R:-9 S:25)\ncontent so the section is not empty', { kind: 'pe' });
ok('a score over a hundred is brought back', clamped.text.includes('P:100'));
ok('a score under nought is brought back', clamped.text.includes('R:0'));

eq('counting finds the events, dossiers and bonds',
  countOf(PE, 'pe'), { events: 4, dossiers: 3, bonds: 3 });
ok('a world topic is not counted as a person',
  countOf('## WORLD\n### Rules\n- a rule\n### Calendar\nsome months', 'pe').dossiers === 0);
ok('the main character counts as a person',
  countOf('## MC — Jovan (17)\nID: tall\nCORE: quiet', 'pe').dossiers === 1);
ok('a rewrite that loses events is spotted',
  /events/.test(lostSomething(PE, PE.replace(/^e003.*$/m, ''), 'pe') || ''));
ok('a rewrite that loses nothing is allowed', lostSomething(PE, PE + '\n\nmore', 'pe') === null);

const ev = readEvents('e001 [Mon 1 Jan 100, 01:00] a\ne003 [Mon 1 Jan 100, 02:00] b\ne002 [Mon 1 Jan 100, 03:00] c\ne003 x');
eq('an event number used twice is caught', ev.duplicates, ['e003']);
eq('an event out of order is caught', ev.outOfOrder, ['e002']);
eq('an event with no date is caught', ev.undated, ['e003']);

const wb = lint(JSON.stringify([
  { name: 'Aldric', keys: ['Aldric'], content: 'a general', strategy: 'purple', order: 9999 },
  { name: 'Aldric', keys: [], content: 'again', strategy: 'green' },
]), { kind: 'worldbook' });
ok('a nonsense strategy is put back to green', wb.text.includes('"strategy": "green"'));
ok('an order out of range is brought back', JSON.parse(wb.text)[0].order === 1000);
ok('two entries with one name are caught', wb.found.some((f) => /same name/.test(f.check)));
ok('an entry that can never fire is caught', wb.found.some((f) => /never fire/.test(f.check)));
ok('a broken worldbook is reported, not crashed on',
  lint('{not json', { kind: 'worldbook' }).found.some((f) => /not readable/.test(f.check)));

/* the lint must be safe to run twice */
const twiceLinted = lint(L.text, { kind: 'pe' });
ok('running the checks again changes nothing more',
  twiceLinted.text === L.text, 'the second pass moved the text');

/* =========================================================== the wire */

const conn = { id: 'c1', name: 'd', url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'k' };
let req = buildRequest(conn, { system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 500 });
ok('the address is completed correctly', req.url === 'https://api.deepseek.com/v1/chat/completions', req.url);
ok('nothing unset is sent', !('temperature' in req.body) && !('top_p' in req.body) && !('reasoning_effort' in req.body),
  JSON.stringify(req.body));
ok('the system message goes first', req.body.messages[0].role === 'system');

req = buildRequest({ ...conn, temperature: 0, topP: 0.9, thinking: 'off' }, { messages: [], maxTokens: 100 });
ok('a temperature of zero the writer chose IS sent', req.body.temperature === 0);
ok('a top-p the writer chose is sent', req.body.top_p === 0.9);
/* The first version sent DeepSeek "off" as reasoning_effort "minimal" — a word
 * DeepSeek does not have — and this line pinned that mistake. DeepSeek's own
 * switch is thinking:{type:"disabled"} (Cozy Tavern M37). */
ok('"do not think" is spoken in DeepSeek\'s own words',
  req.body.thinking && req.body.thinking.type === 'disabled' && !('reasoning_effort' in req.body), JSON.stringify(req.body));

req = buildRequest({ ...conn, url: 'https://open.bigmodel.cn/api/paas/v4', thinking: 'off' }, { messages: [], maxTokens: 100 });
ok('z.ai is told not to think in its own words', req.body.thinking && req.body.thinking.type === 'disabled');

req = buildRequest({ ...conn, url: 'https://openrouter.ai/api/v1', thinking: 'off' }, { messages: [], maxTokens: 100 });
ok('openrouter is told not to think in its own words', req.body.reasoning && req.body.reasoning.enabled === false);

req = buildRequest({ ...conn, url: 'https://api.anthropic.com', model: 'claude-x', thinking: 'medium', thinkingBudget: 3000 },
  { messages: [{ role: 'user', content: 'u' }], maxTokens: 800, room: 600 });
ok('anthropic gets a thinking block only when asked', req.body.thinking.budget_tokens === 3000);
ok('anthropic is left room to answer past its thinking', req.body.max_tokens >= 3600, String(req.body.max_tokens));
ok('anthropic takes the system prompt on its own key', req.url.endsWith('/v1/messages'));

req = buildRequest({ ...conn, model: 'kimi-k2-thinking' }, { messages: [], maxTokens: 500 });
ok('a model that always thinks is given room even when nothing was set',
  req.body.max_tokens === 16000, String(req.body.max_tokens));
ok('the floor does not invent a thinking setting', !('reasoning_effort' in req.body));

ok('an address is recognised', houseOf('https://api.moonshot.ai/v1') === 'moonshot');
ok('a thinking model is recognised', alwaysThinks('kimi-k3') && alwaysThinks('o3-mini') && !alwaysThinks('deepseek-chat'));

eq('an openai-shaped answer is read',
  readAnswer('openai', { choices: [{ message: { content: 'hi', reasoning_content: 'mm' }, finish_reason: 'stop' }] }),
  { text: 'hi', thinking: 'mm', finish: 'stop', thinkTokens: 0, hiddenThought: false });
eq('an anthropic-shaped answer is read',
  readAnswer('anthropic', { content: [{ type: 'thinking', thinking: 'mm' }, { type: 'text', text: 'hi' }], stop_reason: 'end_turn' }),
  { text: 'hi', thinking: 'mm', finish: 'end_turn', hiddenThought: false, thinkTokens: 0 });
ok('a provider error becomes words, not a crash',
  readAnswer('openai', { error: 'provider', detail: 'no key' }).finish === 'error');
eq('a streamed piece is read',
  readChunk('openai', { choices: [{ delta: { content: 'ab' } }] }), { text: 'ab', thinking: '' });
eq('a streamed thought is kept on its own channel',
  readChunk('anthropic', { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'z' } }),
  { text: '', thinking: 'z' });

/* ========================================================== the persona */

const house = { settings: { makerName: 'Eni', yourName: 'Bruce', person: 'second' }, personaFrame: 'You are Eni. You swear a bit.' };
const p = personaOf(house);
eq('the greeting sounds like a person', greeting(p), 'Hey Eni, this is Bruce.');
eq('first person turns it around', greeting({ ...p, person: 'first' }), "I'm Eni, and Bruce is here with me.");
eq('with no names it says nothing rather than inventing one', greeting({ maker: '', you: '', person: 'second' }), '');
const opening = openingFor(p, 'You and the writer are building something.');
ok('the writer\'s own instructions come first and untouched', opening.startsWith('You are Eni. You swear a bit.'));
ok('the greeting follows them', opening.includes('Hey Eni, this is Bruce.'));
/* This test once checked that openingFor swapped "you" for "I" in the body. The swapping is gone: it
 * wrote "talks to I" and "I and Bruce". The body is written in each voice (see "both voices" below). */
ok('first person: the text sent reads in the first person', openingFor(personaOf({ settings: { makerName: 'Eni', yourName: 'Bruce', person: 'first' } }),
  frontBody(personaOf({ settings: { makerName: 'Eni', yourName: 'Bruce', person: 'first' } }))).includes('Bruce only ever talks to me'));

/* THE ROOM (v2.0): the one he talks to does the work, so it is told how. It used to be a
 * firewall that kept every way of changing a document out of its reading; he found the
 * house confusing for it, and worse than his own engine pasted into one model. */
const FRONT_TEXT = openingFor(p, frontBody(p));
ok('the room tells it how to change a document, part or whole', FRONT_TEXT.includes('<edits>') && FRONT_TEXT.includes('<file name='));
ok('the room tells it how to hand a job to a helper, and names them', FRONT_TEXT.includes('<helper name="the eye">') && /the worldbook keeper/.test(FRONT_TEXT) && /the memory auditor/.test(FRONT_TEXT));
ok('the room adds no bracketed alerts of its own', !/\[[A-Z][A-Z0-9_]{4,}\]/.test(frontBody(p)));

/* ============================================================ the crew */

const conns = [{ id: 'a' }, { id: 'b' }];
ok('a worker\'s own pick wins', pickConnection({ map: { eye: 'b' }, general: 'a', connections: conns }, 'eye').id === 'b');
ok('the general pick is next', pickConnection({ map: {}, general: 'a', connections: conns }, 'eye').id === 'a');
ok('a deleted pick falls through instead of shadowing',
  pickConnection({ map: { eye: 'gone' }, general: 'a', connections: conns }, 'eye').id === 'a');
ok('with nothing set the caller is told to fall back',
  pickConnection({ map: {}, general: null, connections: conns }, 'eye') === null);

/* ======================================================== the pipeline */

const project = { id: 'p1', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: PE }], turns: [], recentSections: [] };

const c1 = commit(project, [{ file: 'Plot Essential.md', find: 'Majority is sixteen.', replace: 'Majority is fifteen.', reason: 'x' }], 'test');
ok('a change reaches the document', c1.project.docs[0].text.includes('Majority is fifteen.'));
ok('the original object is not mutated', project.docs[0].text.includes('Majority is sixteen.'));
ok('the change is written down for undo', c1.batch && c1.batch.items.length === 1);

const gutted = PE.split('## TIMELINE')[0] + '## SCENE\nWHERE: nowhere\n';
const c2 = commit(project, [{ file: 'Plot Essential.md', replace_all: true, replace: gutted, reason: 'rebuild' }], 'test');
ok('a rewrite that would lose events is refused', c2.project.docs[0].text.includes('e001'), 'the timeline was lost');
ok('the refusal says what would have gone', /would have lost/.test(c2.guard || ''), c2.guard);
ok('the refusal shows up as a card', c2.cards.some((x) => x.status === 'refused'));
ok('a refused rewrite leaves no undo record at all', c2.batch === null,
  JSON.stringify(c2.batch));

/* A refused rewrite used to leave a record claiming the document had changed,
 * with a fingerprint of text that was never saved — so "put it back" refused
 * for the rest of that document's life, saying something newer was there. */
const mixed = commit(project, [
  { file: 'Plot Essential.md', find: 'Majority is sixteen.', replace: 'Majority is fifteen.', reason: 'ok' },
  { create_file: 'Notes.md', replace: 'a note', reason: 'ok' },
], 'mixed');
const liveDocs = mixed.project.docs.map((d) => ({ name: d.name, text: d.text }));
const undone = undoBatch(liveDocs, mixed.batch);
ok('what a commit records can actually be put back', undone.ok, undone.why);
ok('putting it back restores every document it touched',
  undone.changes.length === 2 &&
  undone.changes.find((c) => c.name === 'Plot Essential.md').text === PE &&
  undone.changes.find((c) => c.name === 'Notes.md').remove === true,
  JSON.stringify(undone.changes.map((c) => c.name)));

/* THE CHECKS (v2.0): certain repairs made, what needs judgment found — only what the turn
 * brought in, never what was there before it (the old sweep handed every finding in a
 * touched document to a worker on every change: the churn). */
const checked = checkChanged(project, new Set(['Plot Essential.md']), new Map());
ok('the checks repair what they can', !checked.project.docs[0].text.includes('[EPISTEMIC_VIOLATION]'));
ok('the checks say what they repaired', checked.repaired.length > 0);
ok('what needs judgment is found, by its document', checked.found.length > 0 && checked.found.every((f) => f.name === 'Plot Essential.md'), checked.found);
const before0 = checkChanged(project, new Set(['Plot Essential.md']), new Map([['Plot Essential.md', project.docs[0].text]]));
eq('what was in the document before the turn is never found again', before0.found, []);
ok('a document the turn did not change is not looked at', checkChanged(project, new Set(['Other.md']), new Map()).repaired.length === 0);

ok('a token count is roughly right', Math.abs(estimateTokens('a'.repeat(400)) - 100) <= 1);

/* ============ the faults the other two frontends already paid for ======== */

/* A question is somebody thinking out loud. Answering it is the front of the
 * house's work, not a worker's. */
/* What a worker has not been shown, it may not rewrite. */
const partial = brief(bigDoc, 'Plot Essential.md', { message: 'TIMELINE' });
ok('a partly-shown document says so in as many words', /do not rewrite the whole of it/i.test(partial));
const whole = brief(parseDoc('## ONE\nall of it is here\n', 'pe'), 'Small.md', { message: 'ONE' });
ok('a fully-shown document carries no such warning', !/do not rewrite/i.test(whole), whole);

/* A block cut off by the reply limit is not "no changes". */
ok('a truncated list of changes is reported',
  /cut off/.test(parseEdits('here you go\n<edits>\n[\n  {"file":"a.md","find":"x"').warn));
ok('the word in ordinary prose is not a truncation',
  parseEdits('I would put that in an <edits> block if it needed changing.').warn === '',
  parseEdits('I would put that in an <edits> block if it needed changing.').warn);
ok('ordinary prose naming the word survives whole',
  stripEdits('I would use an <edits> block.') === 'I would use an <edits> block.');

/* No machinery tag reaches the voice the writer hears. */
ok('a stray tag never reaches him', !/<edits|<need/.test(visibleText('done <edits> [ half a block')), visibleText('done <edits> [ half a block'));

/* The undo net is a net, not an archive. */
const netProject = { turns: [] };
for (let i = 0; i < UNDO_KEPT + 5; i++) {
  netProject.turns.push({ role: 'maker', batches: [{ id: 'b' + i, items: [{ name: 'Plot Essential.md', before: PE, afterHash: 'x' }], undone: false }] });
}
const trimmed = capUndo(netProject);
const batches = netProject.turns.map((t) => t.batches[0]);
ok('the net trimmed something', trimmed);
eq('the newest stay undoable', batches.slice(-UNDO_KEPT).filter((b) => b.tooOld).length, 0);
eq('the oldest lose only their payload', batches.slice(0, 5).filter((b) => b.tooOld && !b.items[0].before).length, 5);
ok('an aged-out record still exists as a record', batches[0].items.length === 1);
ok('putting back an aged-out record refuses honestly',
  !undoBatch([{ name: 'Plot Essential.md', text: PE }], batches[0]).ok);
ok('capping twice changes nothing more', capUndo(netProject) === false);

/* The craft file is asked for from the root, never relative to a caller — run,
 * not read: a real load through a fetcher that records what it was asked for. */
{
  const { loadEngine } = await import('../js/engine/slices.js');
  const asked = [];
  setEngineForTests(null);
  try {
    const loaded = await loadEngine(async (url) => { asked.push(url); return { ok: true, text: async () => ENGINE }; });
    eq('the craft is fetched from the root, and cut the same way', [asked, loaded.size], [['/engine/generalist.md'], SECTIONS.size]);
    setEngineForTests(null);
    let said = '';
    try { await loadEngine(async () => ({ ok: false, text: async () => '' })); } catch (e) { said = e.message; }
    ok('a craft file that will not come says so, rather than leaving every worker reading nothing', /could not be read/.test(said), said);
  } finally { setEngineForTests(SECTIONS); }
}

/* ========== what the whole history of both frontends taught ============== */

/* --- thinking, in each house's own words (Cozy Tavern M37, M303, M349) --- */
const TW = (url, model, level) => thinkingFields({ url, model }, level);
eq('DeepSeek off', TW('https://api.deepseek.com', 'deepseek-chat', 'off'), { thinking: { type: 'disabled' } });
eq('DeepSeek medium is its high', TW('https://api.deepseek.com', 'deepseek-chat', 'medium'), { thinking: { type: 'enabled' }, reasoning_effort: 'high' });
eq('DeepSeek xhigh is its max', TW('https://api.deepseek.com', 'deepseek-chat', 'xhigh').reasoning_effort, 'max');
eq('Kimi K3 cannot be told not to think — off is its low', TW('https://api.moonshot.ai/v1', 'kimi-k3', 'off'), { reasoning_effort: 'low' });
eq('Kimi K3 medium is its high', TW('https://api.moonshot.ai/v1', 'kimi-k3', 'medium'), { reasoning_effort: 'high' });
ok('Kimi K3 is never sent the K2 thinking block', !('thinking' in TW('https://api.moonshot.ai/v1', 'kimi-k3', 'high')));
eq('Kimi K2 on Moonshot is a switch only', TW('https://api.moonshot.ai/v1', 'kimi-k2-0905', 'high'), { thinking: { type: 'enabled' } });
eq('GLM 4.6 off', TW('https://api.z.ai/api/paas/v4', 'glm-4.6', 'off'), { thinking: { type: 'disabled' } });
eq('GLM 5.3 always thinks — off is its low', TW('https://api.z.ai/api/paas/v4', 'glm-5.3', 'off'), { thinking: { type: 'enabled' }, reasoning_effort: 'low' });
eq('Qwen is a switch', TW('https://dashscope.aliyuncs.com/v1', 'qwen-max', 'off'), { enable_thinking: false });
eq('nothing set, nothing sent', TW('https://api.deepseek.com', 'deepseek-chat', ''), {});
eq('a word no house takes is never sent', TW('https://api.deepseek.com', 'deepseek-chat', 'minimal'), {});
/* Through OpenRouter, OpenRouter maps a model's levels itself: Kimi K3 there
 * is spoken to in OpenRouter's words, not K3's (Cozy Tavern familyStyle). The
 * first version of this line asserted the opposite, and was wrong. */
ok('Kimi K3 through OpenRouter is spoken to in OpenRouter\'s words', thinkingStyle({ url: 'https://openrouter.ai/api/v1', model: 'moonshotai/kimi-k3' }) === 'openrouter');
ok('Kimi K3 through any other relay is known by its name', thinkingStyle({ url: 'https://api.synthetic.new/openai/v1', model: 'hf:moonshotai/Kimi-K3' }) === 'kimi');
eq('an Anthropic-shaped address on another house is Anthropic-shaped', houseOf('https://api.deepseek.com/anthropic'), 'anthropic');
eq('and its messages go where that shape expects', buildRequest({ url: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat', key: 'k' }, { messages: [] }).url, 'https://api.deepseek.com/anthropic/v1/messages');
eq('a Claude address typed with /v1 is not sent to /v1/v1', buildRequest({ url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', key: 'k' }, { messages: [] }).url, 'https://api.anthropic.com/v1/messages');
eq('and typed without it, the same place', buildRequest({ url: 'https://api.anthropic.com', model: 'claude-sonnet-4-5', key: 'k' }, { messages: [] }).url, 'https://api.anthropic.com/v1/messages');
eq('a refused level steps down to nothing',
  Object.keys(withoutThinking({ model: 'm', thinking: { type: 'enabled' }, reasoning_effort: 'high', reasoning: {}, enable_thinking: true, temperature: 0.5 })).sort(),
  ['model', 'temperature']);
ok('thinking on raises a worker\'s room so the thinking cannot eat the answer',
  buildRequest({ url: 'https://api.deepseek.com', model: 'deepseek-chat', thinking: 'high' }, { messages: [], maxTokens: 800 }).body.max_tokens >= 16000);
ok('thinking off leaves the room alone',
  buildRequest({ url: 'https://api.deepseek.com', model: 'deepseek-chat', thinking: 'off' }, { messages: [], maxTokens: 800 }).body.max_tokens === 800);

/* --- the wire: a 400 is not waited on; a refused level steps down once --- */
{
  const realFetch = globalThis.fetch;
  const bodies = [];
  let script = [];
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body).body);
    const next = script.shift();
    return { json: async () => next };
  };
  const conn = { url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'k', thinking: 'high' };
  const answer = { choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] };

  script = [{ error: 'provider', status: 400, detail: 'unknown parameter: reasoning_effort' }, answer];
  let t0 = Date.now();
  let r = await callModel(conn, { user: 'x' });
  ok('a refused thinking field steps down and the answer still comes', r.ok && r.text === 'done', JSON.stringify(r));
  ok('the second try left out exactly the field it refused', !('reasoning_effort' in bodies[1]), JSON.stringify(bodies[1]));
  ok('the lesson is kept on the connection', conn.learned && conn.learned.drop.includes('reasoning_effort'), JSON.stringify(conn.learned));
  bodies.length = 0;
  script = [answer];
  await callModel(conn, { user: 'x' });
  ok('the next call is right the first time', bodies.length === 1 && !('reasoning_effort' in bodies[0]), JSON.stringify(bodies));
  delete conn.learned;
  ok('stepping down costs no waiting', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);

  bodies.length = 0;
  script = [{ error: 'provider', status: 401, detail: 'invalid api key' }, answer, answer, answer, answer];
  t0 = Date.now();
  r = await callModel(conn, { user: 'x' });
  ok('a bad key fails at once instead of after thirty seconds', !r.ok && Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
  ok('a bad key is asked exactly once', bodies.length === 1, `${bodies.length} calls`);
  ok('a bad key says what the provider said', /invalid api key/.test(r.error), r.error);
  globalThis.fetch = realFetch;
}

/* --- a reply cut at the limit says so (Cozy Tavern M244, M246) --- */
ok('an OpenAI-shaped cut is seen', readChunk('openai', { choices: [{ delta: { content: 'and then' }, finish_reason: 'length' }] }).cut === true);
ok('a finished OpenAI-shaped reply is not called cut', !readChunk('openai', { choices: [{ delta: { content: 'end.' }, finish_reason: 'stop' }] }).cut);
ok('an Anthropic cut is seen', readChunk('anthropic', { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }).cut === true);
ok('a finished Anthropic reply is not called cut', readChunk('anthropic', { type: 'message_delta', delta: { stop_reason: 'end_turn' } }) === null);

/* --- never add what is already there (Cozy Tavern M79) --- */
{
  const doc = '# PE\n\n## WORLD\n- The city lives inside a dormant leviathan.\n\n## SCENE\nWHERE: the Ribway\n';
  const again = applyEdit(doc, { append: true, replace: '- The city lives   inside a DORMANT leviathan.' });
  ok('an append the document already holds is refused', !again.ok && /already in the document/.test(again.why), JSON.stringify(again));
  const under = applyEdit(doc, { insert_after: '## SCENE', replace: '- The city lives inside a dormant leviathan.' });
  ok('an insert the document already holds is refused', !under.ok && /already in the document/.test(under.why));
  ok('a new fact still goes in', applyEdit(doc, { append: true, replace: '- The Ribway floods at every tide.' }).ok);
  ok('a short separator may repeat', applyEdit(doc, { append: true, replace: '\n---\n' }).ok);
}

/* --- one stray quote never voids every change (Cozy Chat v5.14.0) --- */
/* a change no rule can read: a closing quote missing before the next name */
eq('every complete change survives a broken one', salvageEdits('[{"find":"a","replace":"1"},{"find":"b "broken,"replace":"2"},{"find":"c","replace":"3"}]').map((e) => e.find), ['a', 'c']);
/* a quote nobody escaped is not a broken change: it is read with the words it meant */
eq('an unescaped quote inside a change is read, not lost', salvageEdits('[{"find":"a","replace":"1"},{"find":"b "broken" q","replace":"2"},{"find":"c","replace":"3"}]').map((e) => e.find), ['a', 'b "broken" q', 'c']);
{
  /* a FIRST change nobody can read (a closing quote missing before the next
   * name) whose odd quote inverts the scanner's idea of what is a string for
   * everything after it; the second pass recovers the rest, and they must
   * come back in the order they were written */
  const block = '[\n  {"find":"one "x" y,"replace":"1"},\n  {"find":"two","replace":"2"},\n  {"find":"three","replace":"3"},\n  {"find":"four","replace":"4"}\n]';
  eq('salvaged changes come back in the order they were written', salvageEdits(block).map((e) => e.find), ['two', 'three', 'four']);
  const r = parseEdits('<edits>' + block + '</edits>');
  eq('the loss is counted exactly', r.warn, 'one of the changes could not be read and was left out; the 3 that could were used');
  const two = parseEdits('<edits>[\n{"find":"a "q,"replace":"1"},\n{"find":"b "q,"replace":"2"},\n{"find":"c","replace":"3"}\n]</edits>');
  eq('two lost, one kept, said in grammar', two.warn, '2 of the changes could not be read and were left out; the one that could be read was used');
}
/* --- A WHOLE PLOT ESSENTIAL IN A STRING, ITS QUOTES LEFT BARE (it was lost whole) --- */
{
  const { escapeStrayQuotes } = await import('../js/doc/edits.js');
  const PE_LINES = '# PLOT ESSENTIAL — The Ashwood Pact — V1.0\\n\\n## TIMELINE\\ne001 [Mon 14 Apr 247, 09:00] [setup]: The showcase opened.\\n  > "You don\'t get to decide when I\'m brave." —Claire\\n\\n## SCENE\\nWHERE: Hall / LAST: "Fine," he said.';
  const WANT = '# PLOT ESSENTIAL — The Ashwood Pact — V1.0\n\n## TIMELINE\ne001 [Mon 14 Apr 247, 09:00] [setup]: The showcase opened.\n  > "You don\'t get to decide when I\'m brave." —Claire\n\n## SCENE\nWHERE: Hall / LAST: "Fine," he said.';
  const escapedLines = parseEdits('I built it.\n\n<edits>\n[\n  {"create_file": "Plot Essential.md", "replace": "' + PE_LINES + '", "reason": "the premise"}\n]\n</edits>');
  eq('a plot essential with its dialogue quotes bare arrives whole', [escapedLines.edits.length, escapedLines.edits[0] && escapedLines.edits[0].replace, escapedLines.warn], [1, WANT, '']);
  const rawAll = parseEdits('<edits>\n[{"create_file": "Plot Essential.md", "replace": "' + WANT + '", "reason": "x"}]\n</edits>');
  eq('and one with its line breaks bare as well', [rawAll.edits.length, rawAll.edits[0] && rawAll.edits[0].replace], [1, WANT]);
  const valid = '[{"a": "x\\"y", "b": [1, "z", {"c": "d"}]}]';
  eq('valid data is never touched by the quote repair', escapeStrayQuotes(valid), valid);
  eq('a missing closing quote is not guessed at', escapeStrayQuotes('[{"find":"one "x,"replace":"1"}]'), '[{"find":"one "x,"replace":"1"}]');
  eq('a missing comma is not turned into words', tolerantJson('[{"find":"b" "replace":"2"}]').ok, false);
  eq('"no", "never" inside a value stays inside it',
    ((tolerantJson('[{"replace": "He said "no", "never", and left", "reason": "r"}]').value || [])[0] || {}).replace, 'He said "no", "never", and left');
}

/* --- A WHOLE DOCUMENT, WRITTEN PLAINLY: <file name="…"> … </file> --- */
{
  const { readFiles, openFileAtEnd } = await import('../js/doc/edits.js');
  const PE = '# PLOT ESSENTIAL — Harbour — V1.0\n\n## MC — Jovan (16)\nID: tall\nCORE: patient\n\n### Mira (captain | core | 24)\nID: scarred\nCORE: blunt, loyal\n→ Jovan: old crew (P:60 R:10 S:5)\n\n## SCENE\nLAST: "Fine," he said.';
  const one = parseEdits('I built it from everything you said.\n\n<file name="Plot Essential.md">\n' + PE + '\n</file>\n');
  eq('a document written plainly is one whole change, word for word', one.edits, [{ file: 'Plot Essential.md', whole: true, replace: PE, reason: 'written whole' }]);
  eq('and nothing of it reaches the notes', stripEdits('I built it from everything you said.\n\n<file name="Plot Essential.md">\n' + PE + '\n</file>\n'), 'I built it from everything you said.');
  const made = applyRun([], one.edits);
  eq('a new one is started', [made.texts.get('Plot Essential.md'), made.cards.map((c) => [c.status, c.how])], [PE, [['applied', 'started it']]]);
  const re = applyRun([{ name: 'Plot Essential.md', text: 'old' }], one.edits);
  eq('one with words in it is rebuilt whole', [re.texts.get('Plot Essential.md'), (re.cards[0] || {}).how], [PE, 'rewrote the whole thing']);
  const blank = applyRun([{ name: 'plot essential.md', text: '' }], one.edits);
  eq('an empty one by that name (any case) is written, not doubled', [[...blank.texts.keys()], (blank.cards[0] || {}).how], [['plot essential.md'], 'wrote it']);
  const same = applyRun([{ name: 'Plot Essential.md', text: PE }], one.edits);
  eq('the very words it already has change nothing and make no card', [same.cards.length, same.batch], [0, null]);
  const sameAll = applyRun([{ name: 'Plot Essential.md', text: PE }], [{ file: 'Plot Essential.md', replace_all: true, replace: PE }]);
  eq('a full rewrite into the same words makes no card either', sameAll.cards.length, 0);
  const drafts = parseEdits('<file name="A.md">\nfirst try\n</file>\nbetter:\n<file name="A.md">\nsecond try\n</file>');
  eq('the last one for a name is the answer, the earlier a draft', [drafts.edits.map((e) => e.replace), drafts.drafts || 0, drafts.warn], [['second try'], 1, '']);
  const cut = parseEdits('Here it is.\n<file name="A.md">\n# half a docu');
  eq('one left open at the end is cut, reported, and never written', [cut.edits.length, cut.fileCut, /A\.md was cut off before it finished/.test(cut.warn)], [0, 'A.md', true]);
  eq('the house sees which one was left open', [openFileAtEnd('x <file name="A.md">\n# half'), openFileAtEnd('<file name="A.md">\nall\n</file>')], ['A.md', '']);
  const nested = readFiles('<file name="A.md">\nstarted over\n<file name="A.md">\nthe whole of it\n</file>');
  eq('an opener met again before a closer sets the first aside', nested.files.map((f) => f.text), ['the whole of it']);
  const fenced = parseEdits('<file name="Lore.json">\n```json\n[{"name":"A"}]\n```\n</file>');
  eq('a document wrapped whole in a code fence is unwrapped', (fenced.edits[0] || {}).replace, '[{"name":"A"}]');
  const both = parseEdits('<file name="Continuity File 1.md">\n# FILE 1\n</file>\n<edits>[{"file":"Plot Essential.md","find":"a","replace":"b"}]</edits>');
  eq('a file and a block land in the order they were written', both.edits.map((e) => e.whole ? 'file' : 'edit'), ['file', 'edit']);
  const inner = parseEdits('<file name="Rules.md">\nWrite changes like <edits>[{"find":"x","replace":"y"}]</edits> in the game.\n</file>');
  eq('a block written inside a document is words, not a change', inner.edits.map((e) => e.whole === true), [true]);
  const single = parseEdits("<file name='B.md'>\nsingle quotes\n</file>");
  eq('a name in single quotes is read too', (single.edits[0] || {}).file, 'B.md');
  const bare = parseEdits('<file name=Plot Essential.md>\r\n# PE\r\nline two\r\n</file>');
  eq('a name written with no quotes, spaces and all, is read — and Windows line endings are made plain',
    [(bare.edits[0] || {}).file, (bare.edits[0] || {}).replace, stripEdits('Done.\n<file name=Plot Essential.md>\n# PE\n</file>')], ['Plot Essential.md', '# PE\nline two', 'Done.']);
  /* the loss guard still stands over a document rebuilt whole */
  const loses = commit({ id: 'p', docs: [{ id: 'd', name: 'Plot Essential.md', kind: 'pe', text: PE }], chats: [] },
    parseEdits('<file name="Plot Essential.md">\n# PLOT ESSENTIAL — Harbour — V1.0\n\n## MC — Jovan (16)\nID: tall\nCORE: patient\n</file>').edits, 'test');
  eq('a whole rebuild that would lose a person is refused, and the document is kept', [(loses.cards[0] || {}).status, /would have lost 1 dossiers/.test((loses.cards[0] || {}).why), loses.project.docs[0].text === PE], ['refused', true, true]);
}

/* --- A NEW WORLD TAKES THE NAME ITS PLOT ESSENTIAL GIVES IT --- */
{
  const { nameWorld, plotEssentialTitle, DEFAULT_WORLD_TITLE } = await import('../js/doc/index.js');
  const pe = (title) => ({ id: 'd', name: 'Plot Essential.md', kind: 'pe', text: `# PLOT ESSENTIAL — ${title} — V1.0\n# STATE: Monday\n\n## SCENE\nWHERE: x` });
  eq('the title a plot essential gives itself', plotEssentialTitle([pe('The Leviathan Quarter')]), 'The Leviathan Quarter');
  eq('a continuation file\'s heading is not the world\'s name', plotEssentialTitle([{ kind: 'continuity', text: '# PLOT ESSENTIAL CONTINUITY — X — FILE 2' }]), '');
  eq('the template\'s own placeholder is not a name', plotEssentialTitle([{ kind: 'pe', text: '# PLOT ESSENTIAL — [TITLE] — V[X.X]' }]), '');
  const fresh = { title: DEFAULT_WORLD_TITLE, docs: [pe('The Saltmarsh Court')] };
  eq('a world still called "A new world" takes it', [nameWorld(fresh), fresh.title], [true, 'The Saltmarsh Court']);
  const his = { title: 'My Tide Story', docs: [pe('The Saltmarsh Court')] };
  eq('a name he gave is never touched', [nameWorld(his), his.title], [false, 'My Tide Story']);
  /* through the real landing of a turn: the build arrives and the world is named */
  const world = { id: 'pz', title: DEFAULT_WORLD_TITLE, docs: [], chats: [{ id: 'c1', turns: [{ role: 'writer', text: 'build it', at: 1 }] }] };
  const out = landTurn(world, { chatId: 'c1', snapshot: new Map(), result: { project: { docs: [pe('The Saltmarsh Court')] } }, makerTurn: { role: 'maker', text: 'Built.', at: 2, cards: [], batches: [] } });
  eq('a turn that builds the plot essential names the world', out.world.title, 'The Saltmarsh Court');
  /* an old world opened: named, and written back (openProject writes an upgraded world back) */
  eq('a world opened with the old name and a titled plot essential is named on opening', upgradeWorld({ title: DEFAULT_WORLD_TITLE, docs: [pe('Ashwood')], chats: [] }).title, 'Ashwood');
  const { hasPlotEssential } = await import('../js/doc/index.js');
  eq('a world has a plot essential only when one has words in it', [hasPlotEssential([pe('X')]), hasPlotEssential([{ kind: 'pe', text: '  \n' }]), hasPlotEssential([{ kind: 'continuity', text: '# FILE 2' }]), hasPlotEssential([])], [true, false, false, false]);
}

/* --- THE KIND OF A DOCUMENT IS ONE RULE, AND THE CREW'S DOCUMENTS FOLLOW IT --- */
{
  eq('an instruction set its writer starts is an instruction set, whatever it is called', kindFor('Eni.md', 'You are Eni.', 'instructions'), 'instructions');
  eq('a transplant the auditor starts is a transplant', kindFor('Harbour.md', 'notes', 'auditor'), 'transplant');
  eq('a continuation file the scribe starts is one', kindFor('The Siege.md', '# THE SIEGE', 'scribe'), 'continuity');
  eq('the builder\'s documents are read by their names and words', [kindFor('Plot Essential.md', '# PLOT ESSENTIAL', 'builder'), kindFor('Continuity File 1.md', '# FILE 1', 'builder')], ['pe', 'continuity']);
  eq('an instruction set named for what it is, by anyone', kindFor('System Prompt.md', 'Be kind.', 'editor'), 'instructions');
  /* the real consequence: an instruction set is never tidied like a plot essential */
  const HIS = 'You are Eni.\n\n## Rules\nTBD: the tone for battles\n\n## Voice\n';
  const made = commit({ id: 'p', docs: [], chats: [] }, [{ file: 'Eni.md', whole: true, replace: HIS }], 'test', 'instructions');
  eq('a document the instructions writer starts is kept as instructions', made.project.docs[0].kind, 'instructions');
  const swept = checkChanged(made.project, new Set(['Eni.md']), new Map());
  eq('and the plot essential checks never touch it (its TBD line and its empty heading stay)', swept.project.docs[0].text, HIS);
}

/* --- THE PARTS THE CRAFT REQUIRES ARE NEVER LOST TO A CREW CHANGE --- */
{
  const FULL = '# PLOT ESSENTIAL — X — V1.0\n# STATE: Mon 1 Jan 1000, 09:00 / the hall\n# CALENDAR: Gregorian\n\n## WORLD\n### Rules\n- Epistemic Law: NPCs know only what they witnessed.\n\n### Calendar\nGregorian.\n\n## MC — A (20)\nID: tall\nCORE: calm\n\n## TIMELINE\ne001 [Mon 1 Jan 1000, 08:00] [SETUP]: began.\n\n## SCENE\nWHERE: the hall / LAST: he waits.\n';
  eq('a rewrite that drops the SCENE is a loss', lostSomething(FULL, FULL.replace(/\n## SCENE[\s\S]*$/, '\n')), 'the SCENE');
  eq('and one that drops the Epistemic Law', lostSomething(FULL, FULL.replace('- Epistemic Law: NPCs know only what they witnessed.\n', '')), 'the Epistemic Law');
  eq('and one that drops the STATE and CALENDAR lines', lostSomething(FULL, FULL.replace(/^# STATE:.*\n# CALENDAR:.*\n/m, '')), 'the STATE line, the CALENDAR line');
  eq('a change that keeps them all is no loss', lostSomething(FULL, FULL.replace('he waits', 'he opens the door')), null);
  eq('a document that never had a SCENE is not held to one', lostSomething('# PLOT ESSENTIAL — X — V1.0\n## MC — A (20)\nID: x\nCORE: y\n', '# PLOT ESSENTIAL — X — V1.0\n## MC — A (20)\nID: x\nCORE: y, calm\n'), null);
  const r = commit({ id: 'pa', docs: [{ id: 'd', name: 'Plot Essential.md', kind: 'pe', text: FULL }], chats: [] },
    [{ file: 'Plot Essential.md', whole: true, replace: FULL.replace(/\n## SCENE[\s\S]*$/, '\n') }], 'test');
  eq('through the real commit: "make it shorter" that dropped the SCENE is refused, and the document kept', [(r.cards[0] || {}).status, /the SCENE/.test((r.cards[0] || {}).why || ''), r.project.docs[0].text === FULL], ['refused', true, true]);
}

/* --- A NEW WORLDBOOK, AND THE KEEPER'S OWN FIRST RULE --- */
{
  const { readWorldbook } = await import('../js/doc/lint.js');
  const first = applyRun([{ name: 'Lore.json', text: '' }], [{ file: 'Lore.json', append: true, replace: '[\n  {"name": "Aldric", "keys": ["Aldric"], "content": "A general.", "strategy": "green"}\n]' }]);
  eq('an empty worldbook begun the way its keeper\'s craft says is one readable list', (readWorldbook(first.texts.get('Lore.json')).entries || []).map((e) => e.name), ['Aldric']);
  const old = lint('[]\n[{"name":"Aldric","keys":["Aldric"],"content":"A general.","strategy":"green"}]', { kind: 'worldbook' });
  const names = (t) => { try { return JSON.parse(t).map((e) => e.name); } catch (_) { return 'unreadable'; } };
  eq('a list written after the old "[]" is joined into one, by code', [names(old.text), old.found.every((f) => f.repaired)], [['Aldric'], true]);
  eq('two lists one after another are one', (readWorldbook('[{"name":"A","keys":["a"],"content":"x"}]\n[{"name":"B","keys":["b"],"content":"y"}]').entries || []).map((e) => e.name), ['A', 'B']);
  eq('a list and then an entry are one', (readWorldbook('[] {"name":"C","keys":["c"],"content":"z"}').entries || []).map((e) => e.name), ['C']);
  eq('words around them are not guessed at', readWorldbook('hello [1]').ok, false);
  /* counted and outlined the way the house reads it, everywhere */
  const three = JSON.stringify([{ name: 'A', keys: ['a'], content: 'x' }, { name: 'B', keys: ['b'], content: 'y' }, { name: 'C', keys: ['c'], content: 'z' }]);
  const twoInARow = JSON.stringify([{ name: 'A', keys: ['a'], content: 'x' }]) + '\n' + JSON.stringify([{ name: 'B', keys: ['b'], content: 'y' }]);
  eq('a list after a list is counted, not called uncountable', countOf(twoInARow, 'worldbook'), { entries: 2 });
  eq('so three entries rewritten as two, that way, are a loss the guard refuses', lostSomething(three, twoInARow, 'worldbook'), '1 entries');
  eq('the outline the crew and the persona are shown holds every entry of it', parseDoc(twoInARow, 'worldbook').sections.map((s) => s.title), ['A', 'B']);
  eq('and a SillyTavern export pasted in is outlined by its own names', parseDoc('{"entries":{"0":{"comment":"Aldric","key":["Aldric"],"content":"A general."}}}', 'worldbook').sections.map((s) => s.title), ['Aldric']);
}

ok('a block in the thinking channel is still a block', (() => {
  const r = parseEdits('<edits>[{"find":"a","replace":"b"}]</edits>');
  return r.edits.length === 1;
})());

/* --- THE TRANSPLANT CHECK ANSWERS TO SUMMARYCEPTION'S OWN IMPORTER --- */
{
  const { parseTransplant } = await import('./fixtures/summaryception-import.js');
  const { lintTransplant } = await import('../js/doc/transplant.js');
  const fx = JSON.parse(readFileSync(new URL('./fixtures/transplant-lint.json', import.meta.url), 'utf8'));
  const extra = [
    ['a dossier whose fields are all empty', '<!-- SC-TRANSPLANT {"v":1} -->\n<!-- SC-LEDGER {"name":"Mira"} -->\nCORE:\nSTATE:   \n<!-- /SC-LEDGER -->\n'],
    ['a closer carrying a payload', '<!-- SC-SNIPPET {"turns":"1-4"} -->\nMira stole the token.\n<!-- /SC-SNIPPET {"turns":"1-4"} -->\n## Notes\nprose that is not a snippet\n<!-- SC-PIN {"label":"x"} -->\n"Count again."\n<!-- /SC-PIN -->\n'],
    ['a dossier whose first field is indented', '<!-- SC-LEDGER {"name":"Oren"} -->\n   CORE: keeps the lamp\n<!-- /SC-LEDGER -->\n'],
    ['one empty field and one full', '<!-- SC-LEDGER {"name":"Dace"} -->\nCORE:\nSTATE: counting his tray\n<!-- /SC-LEDGER -->\n'],
  ];
  const cases = fx.cases.map((c) => [c.name, c.text]).concat(extra);
  const count = (t, kind) => (t.match(new RegExp('<!--\\s*SC-' + kind + '\\b', 'g')) || []).length;
  const missed = [];
  for (const [name, text] of cases) {
    const imp = parseTransplant(text);
    const lin = lintTransplant(text);
    const errors = lin.issues.filter((i) => i.sev === 'error').length;
    const lost = count(text, 'LEDGER') > Object.keys(imp.ledger).length || count(text, 'SNIPPET') > imp.snippets.length || count(text, 'PIN') > imp.pins.length;
    const bodies = [imp.notepad, ...Object.values(imp.ledger).flatMap((e) => Object.values(e)), ...imp.snippets.flatMap((s) => [s.text, s.detail || '']), ...imp.pins.map((p) => p.excerpt)].join('\n');
    const swallowed = /<!--\s*\/?SC-/i.test(bodies);
    if (lost && !errors) missed.push(`${name}: the importer drops something and the check calls it sound`);
    if (swallowed && !lin.issues.length) missed.push(`${name}: the importer swallows a marker into a block and the check says nothing`);
  }
  ok(`every loss Summaryception's importer makes is caught by the check (${cases.length} transplants)`, !missed.length, missed.join('; '));
  eq('a dossier whose fields are all empty: the importer drops it, and the check says so',
    [Object.keys(parseTransplant(extra[0][1]).ledger).length, lintTransplant(extra[0][1]).issues.some((i) => i.sev === 'error' && /only empty fields/.test(i.msg))], [0, true]);
  eq('a closer carrying a payload: the importer runs the block on, and the check says so',
    [/prose that is not a snippet/.test(parseTransplant(extra[1][1]).snippets[0].text), lintTransplant(extra[1][1]).issues.some((i) => i.sev === 'error' && /carries a payload/.test(i.msg))], [true, true]);
  eq('a dossier whose first field is indented: the importer keeps it, and the check raises no false alarm',
    [Object.keys(parseTransplant(extra[2][1]).ledger), lintTransplant(extra[2][1]).issues.filter((i) => i.sev === 'error').length], [['Oren'], 0]);
  eq('one empty field beside a full one is kept, and passes', lintTransplant(extra[3][1]).ok, true);
  /* the loss guard reads the same check: a rewrite that empties a dossier is refused */
  eq('a rewrite that empties a dossier\'s fields is a loss the guard refuses',
    Boolean(lostSomething('<!-- SC-LEDGER {"name":"Mira"} -->\nCORE: patient\n<!-- /SC-LEDGER -->\n', extra[0][1], 'transplant')), true);
}

/* --- the transplant check is the extension's own, answer for answer --- */
{
  const { lintTransplant, looksLikeTransplant } = await import('../js/doc/transplant.js');
  const fx = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/transplant-lint.json', import.meta.url), 'utf8'));
  const differ = fx.cases.filter((c) => JSON.stringify(lintTransplant(c.text)) !== JSON.stringify(c.want)).map((c) => c.name);
  ok(`the transplant check answers all ${fx.cases.length} cases as the extension does`, !differ.length, differ.join(', '));
  ok('a transplant is known by its markers', looksLikeTransplant(fx.cases[0].text) && !looksLikeTransplant('# PLOT ESSENTIAL'));
  const vandal = ('<!-- SC-SNIPPET ' + 'x'.repeat(40) + ' -- > <!-- sc-pin\n').repeat(20000);
  const t0 = performance.now(); lintTransplant(vandal); const ms = performance.now() - t0;
  ok(`a ${Math.round(vandal.length / 1024)}KB vandalised paste is checked in linear time (${ms.toFixed(0)}ms)`, ms < 1500, ms.toFixed(0));

  const { lostSomething } = await import('../js/doc/lint.js');
  const sound = fx.cases[0].text;
  ok('an edit that breaks a transplant marker is a loss', /could no longer read/.test(lostSomething(sound, sound.replace('<!-- SC-PIN -->', '<!-- sc-pin -->'), 'transplant') || ''));
  ok('removing a whole block cleanly is not', lostSomething(sound, sound.replace('<!-- SC-PIN -->\nThe promise at the lighthouse.\n<!-- /SC-PIN -->', ''), 'transplant') === null);
  ok('instructions and notes have nothing code can count', lostSomething('a\nb', '', 'instructions') === null && lostSomething('a', '', 'notes') === null);
}

/* --- another answer lands as a version; landing it twice is once --- */
{
  const w0 = { docs: [], chats: [{ id: 'c1', title: 't', turns: [{ role: 'writer', text: 'hi', at: 1 }, { role: 'maker', text: 'first', at: 2, cards: [], batches: [], edits: [] }] }] };
  const r2 = { project: w0, reply: 'second', cards: [], batches: [], edits: [] };
  const t2 = { role: 'maker', text: 'second', at: 3, cards: [], batches: [], edits: [] };
  const a = landTurn(w0, { chatId: 'c1', snapshot: new Map(), result: r2, makerTurn: t2, replaceAt: 1 });
  const turn = a.world.chats[0].turns[1];
  ok('another answer keeps the first as a version and shows the new one', a.world.chats[0].turns.length === 2 && turn.versions.length === 2 && turn.shown === 1 && turn.text === 'second' && turn.versions[0].text === 'first', JSON.stringify(turn));
  const b = landTurn(a.world, { chatId: 'c1', snapshot: new Map(), result: r2, makerTurn: t2, replaceAt: 1 });
  ok('landing the same answer twice changes nothing', b.already && b.world.chats[0].turns[1].versions.length === 2);
}

/* --- the Plot Essential Maker's matching law: spacing may differ, words may not --- */
{
  const doc = 'Claire is sixteen and ‘quiet’ — mostly.\n\n\nThe  harbour   wall stands.\nCase Matters Here.';
  const hit = (find) => { const r = locate(doc, find); return r.ok ? doc.slice(r.from, r.to) : 'REFUSED: ' + r.why; };
  eq('extra spaces and blank lines may differ', hit('The harbour wall stands.'), 'The  harbour   wall stands.');
  eq('straight quotes and a hyphen find curly quotes and a dash', hit("Claire is sixteen and 'quiet' - mostly."), 'Claire is sixteen and ‘quiet’ — mostly.');
  eq('a line break may be spaces in the quote only as a break', hit('mostly.\nThe harbour'), 'mostly.\n\n\nThe  harbour');
  ok('one word misquoted is refused, never written over the real one', !locate(doc, 'Claire is fifteen and ‘quiet’ — mostly.').ok);
  ok('a missing word is refused', !locate(doc, 'Claire is and ‘quiet’ — mostly.').ok);
  ok('case is a difference', !locate(doc, 'case matters here.').ok);
  const twice = 'a  b\na   b';
  ok('two places that match only after spacing are ambiguous and refused', /2 times/.test(locate(twice, 'a b').why || ''), JSON.stringify(locate(twice, 'a b')));
  const big = Array.from({ length: 3000 }, (_, i) => `line ${i} of the council record, where nothing moved`).join('\n');
  /* timed warm: the first calls compile the matcher, and on a slow two-core machine that
   * alone ran past the bound (34ms) while every warm miss took about 10ms. The bound
   * stays where it was \u2014 it is there to catch a search that grows with the square
   * of the document, which would be seconds, not milliseconds. */
  for (let i = 0; i < 5; i++) locate(big, 'a sentence that is not in the document at all, anywhere, in any form');
  /* the best of five rounds (v2.5): one round on a shared two-core machine counted another
   * process's burst against the code — 32ms and 52ms seen on 8 Oct with locate unchanged,
   * against 18–21ms a round otherwise. A search that grows with the square of the document
   * is slow in every round, so the bound still catches it. */
  let ms = Infinity;
  for (let round = 0; round < 5; round++) {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) locate(big, 'a sentence that is not in the document at all, anywhere, in any form');
    ms = Math.min(ms, (performance.now() - t0) / 20);
  }
  ok(`a miss on a ${Math.round(big.length / 1000)}k-character document is quick (${ms.toFixed(1)}ms)`, ms < 30, ms.toFixed(1));
}

/* --- a change that changes nothing is not reported as done --- */
{
  const same = applyEdit('WHERE: the Ribway\n', { find: 'WHERE: the Ribway', replace: 'WHERE: the Ribway' });
  ok('a replacement identical to what it found is refused with the reason', !same.ok && /exactly as they were/.test(same.why), JSON.stringify(same));
  const allSame = applyEdit('a b a', { find: 'a', replace: 'a', all: true });
  ok('and so is replacing everywhere with the same words', !allSame.ok);
  const real = applyEdit('WHERE: the Ribway\n', { find: 'WHERE: the Ribway', replace: 'WHERE: the Lighthouse' });
  ok('a real change still lands', real.ok && real.text === 'WHERE: the Lighthouse\n');
  ok('an append of nothing is refused', !applyEdit('a\n', { append: true, replace: '  ' }).ok);
  ok('and so is putting nothing under a line', !applyEdit('a\nb\n', { insert_after: 'a', replace: '' }).ok);
}

/* --- the worldbook is read and exported exactly as the extension does --- */
{
  const wbm = await import('../js/doc/worldbook.js');
  const fx = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/worldbook-export.json', import.meta.url), 'utf8'));
  const differ = fx.cases.filter((c) => {
    const p = wbm.parseWorldbook(c.text);
    return JSON.stringify(p) !== JSON.stringify(c.parsed) || JSON.stringify(p.error ? null : wbm.worldbookToST(p.entries)) !== JSON.stringify(c.st);
  }).map((c) => c.name);
  ok(`every worldbook reads and exports as the extension's does (${fx.cases.length} cases)`, !differ.length, differ.join(', '));
  const { lint } = await import('../js/doc/lint.js');
  const stMap = fx.cases.find((c) => c.name === "SillyTavern's own numbered map");
  const got = JSON.parse(lint(stMap.text, { kind: 'worldbook' }).text);
  ok('a SillyTavern worldbook brought in is read for what its fields mean', got.length === 3 && got[1].strategy === 'blue' && got[0].keys.join() === 'Brin,the smith'
     && got[0].name === 'Brin' && got[2].strategy === 'chain' && got[1].position === 'before_char' && got[2].depth === 6, JSON.stringify(got).slice(0, 200));
}

/* --- his crafts; a transplant's one certain repair; spacing seen by code --- */
{
  const { craftFor, originalCraft, ownCraft, DEFAULT_INSTRUCTIONS_CRAFT, setCraftForTests } = await import('../js/engine/crafts.js');
  setCraftForTests('auditor', 'THE AUDITOR ORIGINAL');
  eq('with nothing set, a keeper reads the original', await craftFor('auditor', {}), 'THE AUDITOR ORIGINAL');
  eq('with his own set, it reads his', await craftFor('auditor', { crafts: { auditor: 'His auditor.' } }), 'His auditor.');
  eq('an empty one is the original, not nothing', await craftFor('auditor', { crafts: { auditor: '   ' } }), 'THE AUDITOR ORIGINAL');
  eq('the instructions writer set the old way is still his', ownCraft({ instructionsCraft: 'Old way.' }, 'instructions'), 'Old way.');
  eq('and the new way wins over the old', ownCraft({ instructionsCraft: 'Old way.', crafts: { instructions: 'New way.' } }, 'instructions'), 'New way.');
  eq('the original instructions craft is the default', await originalCraft('instructions'), DEFAULT_INSTRUCTIONS_CRAFT);

  const { lint } = await import('../js/doc/lint.js');
  const { lintTransplant } = await import('../js/doc/transplant.js');
  const fx = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/transplant-lint.json', import.meta.url), 'utf8'));
  const wrong = fx.cases.find((c) => c.name === 'a marker in the wrong case').text;
  const fixed = lint(wrong, { kind: 'transplant' });
  ok('a transplant marker in the wrong case is put in the case the importer reads', fixed.changed && fixed.text.includes('<!-- SC-LEDGER {"name":"Aldric"} -->'));
  ok('after which the importer loses nothing to it', !lintTransplant(fixed.text).issues.some((x) => /case-mismatched/.test(x.msg)), JSON.stringify(lintTransplant(fixed.text).issues));
  const sound = fx.cases.find((c) => c.name === 'a sound transplant').text;
  ok('a sound transplant is not touched by a single character', lint(sound, { kind: 'transplant' }).changed === false);
  ok('nothing else in a transplant is touched by code', lint(fx.cases.find((c) => c.name === 'a snippet with no closer').text, { kind: 'transplant' }).changed === false);
  eq('a pasted transplant is known by its markers', guessKind('pasted.md', sound), 'transplant');

  const { spacingReport } = await import('../js/ui/docs.js');
  eq('spacing a model cannot see is found by code, line by line', spacingReport('fine line\nthis  has  doubled\n    indented is fine\ntrailing \n\ttabbed'),
     'doubled spaces inside a line on line 2; spaces at the end of a line on line 4; tabs on line 5');
  eq('and clean text has nothing to report', spacingReport('one\ntwo'), '');
}

/* --- what a worker reads is the document, all of it --- */
{
  const fx = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/transplant-lint.json', import.meta.url), 'utf8'));
  const sc = fx.cases.find((c) => c.name === 'a sound transplant').text;
  const w1 = { docs: [{ name: 'Harbour transplant.md', kind: 'transplant', text: sc }] };
  const seen = docBriefs(w1, { message: '*audit' });
  ok('a transplant reaches its worker whole, every marker in it', seen.includes(sc) && !/empty so far/.test(seen), seen.slice(0, 160));
  const instr = 'You are the narrator.\nNever speak for the user.\nKeep replies under 300 words.';
  ok('so does an instruction set with no headings', docBriefs({ docs: [{ name: 'Narrator.md', kind: 'instructions', text: instr }] }, {}).includes(instr));
  const pe = '# PLOT ESSENTIAL — Harbour — V1.0\nA paragraph under the title, before any section.\n\n## WORLD\n- a rule\n';
  ok('the text between a title and the first section reaches a worker', docBriefs({ docs: [{ name: 'PE.md', kind: 'pe', text: pe }] }, {}).includes('A paragraph under the title, before any section.'));
  const outline = brief(parseDoc(pe, 'pe'), 'PE.md', {});
  ok('and the outline shows it too, never dropping it', outline.includes('A paragraph under the title, before any section.'), outline);
  const long = 'x'.repeat(9000);
  const front = docBriefs({ docs: [{ name: 'Notes.md', kind: 'notes', text: long }] }, { forFront: true });
  ok('the front reads the start of a long heading-less document, and is told the rest is there', front.includes('x'.repeat(4000)) && !front.includes('x'.repeat(4001)) && /more characters of it are not shown/.test(front));
  eq('an empty document is still said to be empty', brief(parseDoc('', 'notes'), 'N.md', { whole: true }), 'N.md — it is empty so far.');
}

/* --- the front's text in each voice is grammar, not pronoun swaps --- */
{
  const first = openingFor(personaOf({ settings: { makerName: 'Eni', yourName: 'Bruce', person: 'first' }, personaFrame: 'I am {{char}}.' }),
    frontBody(personaOf({ settings: { makerName: 'Eni', yourName: 'Bruce', person: 'first' } })));
  ok('first person: "Bruce and I", "talks to me", "as myself"', first.includes('Bruce and I are building') && first.includes('Bruce only ever talks to me') && first.includes('I am the one who does the work'), first.slice(0, 300));
  ok('first person: no "talks to I", no "I and", no you or yourself anywhere', !/talks to I\b|\bI and |\byou\b|\byour(self)?\b/i.test(first.replace(/^I am Eni\.\s*/, '')), (first.match(/talks to I\b|\bI and |\byou\b|\byour(self)?\b/i) || [''])[0]);
  const second = frontBody(personaOf({ settings: { yourName: 'Bruce' } }));
  ok('second person reads as it always did', second.includes('You and Bruce are building') && second.includes('Bruce only ever talks to you'));
  const nobody = frontBody(personaOf({ settings: { person: 'first' } }));
  ok('first person with no names still reads as sentences', nobody.includes('The author and I are building') && nobody.includes('The author only ever talks to me') && !/undefined|null/.test(nobody), nobody.slice(0, 120));
}

/* --- every voice, named and not, reads as grammar a person would write --- */
{
  const BROKEN = /talks to I\b|behind I\b|\bI and\b|\bYou and they\b|\bThey and I\b|\bto I\b|documents yourself|\bI never edit\b.*yourself|\bundefined\b|\bnull\b|\$\{/;
  for (const [person, maker, you] of [['first', 'Eni', 'Bruce'], ['first', '', ''], ['you', 'Eni', 'Bruce'], ['you', '', ''], ['first', 'Eni', ''], ['you', '', 'Bruce']]) {
    const pp = personaOf({ settings: { person, makerName: maker, yourName: you } });
    const text = openingFor(pp, frontBody(pp));
    const bad = BROKEN.exec(text);
    ok(`${person}, ${maker || 'no maker'}, ${you || 'no name'}: no broken grammar`, !bad, bad && text.slice(Math.max(0, bad.index - 50), bad.index + 50));
    ok(`${person}, ${maker || 'no maker'}, ${you || 'no name'}: says how to hand a job to a helper`, text.includes('<helper name="the eye">'));
    if (person === 'first') ok(`${person}, ${maker || 'no maker'}, ${you || 'no name'}: nothing left in the second person`, !/\byou\b|\byour(?:self)?\b/i.test(text), text.slice(0, 80));
  }
}

/* --- the person follows how his instructions are written (Cozy Tavern M334) --- */
eq('a frame written as "I" is read as first person', framePerson("I am Eni. I keep the world straight and I talk the way Bruce likes."), 'first');
eq('a frame written as "you" is read as second person', framePerson('You are Eni. You keep the world straight and you talk the way Bruce likes.'), 'second');
eq('an empty frame is second person', framePerson(''), 'second');
eq('left alone, the setting follows the frame', personaOf({ settings: {}, personaFrame: "I am Eni and I love old maps." }).person, 'first');
eq('the old stored default follows the frame too', personaOf({ settings: { person: 'second' }, personaFrame: "I am Eni and I love old maps." }).person, 'first');
eq('"you" overrules a first-person frame', personaOf({ settings: { person: 'you' }, personaFrame: "I am Eni and I love old maps." }).person, 'second');
eq('"I" overrules a second-person frame', personaOf({ settings: { person: 'first' }, personaFrame: 'You are Eni.' }).person, 'first');
{
  const pp = personaOf({ settings: { makerName: 'Eni', yourName: 'Bruce' }, personaFrame: "I am {{char}}. I keep {{user}}'s worlds." });
  const text = openingFor(pp, frontBody(pp));
  ok('a first-person frame left alone gets the first-person house', text.startsWith("I am Eni. I keep Bruce's worlds.") && text.includes('Bruce and I are building') && !/\bYou and Bruce\b/.test(text), text.slice(0, 160));
}

/* --- a failure, said the way the persona can say it --- */
{
  const { plainFailure } = await import('../js/agents/run.js');
  eq('a refused key', plainFailure('the call did not go through — 401 Incorrect API key provided: sk-abc'), 'the connection turned the key away');
  eq('a busy provider', plainFailure('429 Too Many Requests'), 'the provider is too busy right now');
  eq('no answer', plainFailure('transport: timed out'), 'the provider did not answer');
  eq('too long', plainFailure("This model's maximum context length is 8192 tokens"), "the documents were too long for this connection's model");
}

/* --- the words houses use for "too long" --- */
{
  const { TOO_LONG } = await import('../js/agents/run.js');
  for (const said of [
    "This model's maximum context length is 8192 tokens. However, your messages resulted in 20000 tokens.",
    'prompt is too long: 250000 tokens > 200000 maximum',
    'Input is too long for requested model.',
    'This endpoint\'s maximum context length is 131072 tokens.',
    'the request exceeds the model\'s context window',
  ]) ok(`"${said.slice(0, 40)}…" is read as too long`, TOO_LONG.test(said));
  for (const said of ['Incorrect API key provided', 'Unrecognized request argument supplied: reasoning_effort', 'rate limit reached']) {
    ok(`"${said.slice(0, 40)}" is not`, !TOO_LONG.test(said));
  }
}

/* --- the persona's frame, in both voices; what it reads of a document --- */
{
  const pe = '# PLOT ESSENTIAL — Harbour — V1.0\n\n## WORLD\n- The city lives inside a dormant leviathan.\n\n## SCENE\nWHERE: the Ribway\n';
  const w = { docs: [{ name: 'Plot Essential.md', kind: 'pe', text: pe }] };
  ok('the persona reads the outline without character counts', !/characters/.test(docBriefs(w, { forFront: true })), docBriefs(w, { forFront: true }));
  ok('a worker reading an outline still has them, to choose what to ask for', /\d+ characters/.test(brief(parseDoc(pe, 'pe'), 'Plot Essential.md', {})));
}

/* --- a worldbook is repaired by code where code can read it --- */
{
  const { lint, readWorldbook } = await import('../js/doc/lint.js');
  const good = { name: 'Aldric', keys: ['Aldric'], content: 'a general', strategy: 'green' };
  const commas = '[' + JSON.stringify(good).slice(0, -1) + ',},]';
  const r1 = lint(commas, { kind: 'worldbook' });
  ok('a worldbook with trailing commas is put right by code', JSON.parse(r1.text).length === 1 && r1.found.some((f) => /put right/.test(f.check)), JSON.stringify(r1.found));
  ok('and a data repair is not reported as settings put back in range', !r1.found.some((f) => /set up wrong/.test(f.check)), JSON.stringify(r1.found));
  const raw = '[{"name":"Aldric","keys":["Aldric"],"content":"line one\nline two","strategy":"green"}]';
  eq('a raw line break inside a value is put right', JSON.parse(lint(raw, { kind: 'worldbook' }).text)[0].content, 'line one\nline two');
  const wrapped = JSON.stringify({ entries: { 0: good, 1: { ...good, name: 'Brin', keys: ['Brin'] } } });
  const r3 = lint(wrapped, { kind: 'worldbook' });
  ok('SillyTavern\'s numbered map is made one list', Array.isArray(JSON.parse(r3.text)) && JSON.parse(r3.text).length === 2, r3.text.slice(0, 80));
  const r4 = lint('[{"name": "A" "keys": []}]', { kind: 'worldbook' });
  ok('what no rule can read goes to the worldbook keeper, not the editor', r4.found.length === 1 && r4.found[0].worker === 'worldbook', JSON.stringify(r4.found));
  const r5 = lint(JSON.stringify([good, { ...good }]), { kind: 'worldbook' });
  ok('two entries with one name go to the worldbook keeper', r5.found.some((f) => /same name/.test(f.check) && f.worker === 'worldbook'), JSON.stringify(r5.found));
  ok('a sound worldbook is left exactly as it is', lint(JSON.stringify([good]), { kind: 'worldbook' }).changed === false);
  ok('readWorldbook says why when it cannot read', readWorldbook('{"x":1}').ok === false && /one list/.test(readWorldbook('{"x":1}').why));
}

/* --- everything in one file; bringing it back only adds --- */
{
  const store = await import('../js/store.js');
  const put = [];
  const worlds = { pA: { id: 'pA', title: 'Harbour', docs: [{ id: 'd1', name: 'PE.md', kind: 'pe', text: 'x' }], chats: [] } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (v) => ({ ok: true, status: 200, json: async () => v });
    if (u === '/api/projects') return json({ projects: Object.values(worlds).map((w) => ({ id: w.id, title: w.title })) });
    if (u.startsWith('/api/project/') && (!opts.method || opts.method === 'GET')) return json(worlds[u.split('/').pop()]);
    if (u.startsWith('/api/project/') && opts.method === 'PUT') { const w = JSON.parse(opts.body); put.push(w); worlds[w.id] = w; return json({ ok: true }); }
    return json({});
  };
  try {
    const b = await store.exportEverything();
    ok('a backup holds every world whole', b.format === store.BACKUP_FORMAT && b.worlds.length === 1 && b.worlds[0].docs[0].text === 'x');
    /* v2.5: his connections ride in it, keys and all (the old law left them out, so a copy
     * brought back to a new phone could not answer until every key was typed in again) */
    ok('and the connections, keys and all', Array.isArray((b.house || {}).connections));
    ok('a file that is not a backup is refused with the reason', !store.readBackup('{"a":1}').ok && !store.readBackup('not json').ok);
    const r = await store.restoreEverything(b);
    ok('bringing it back adds a new world beside the old one', r.added === 1 && Object.keys(worlds).length === 2);
    ok('under a fresh id, so nothing is replaced', put.length === 1 && put[0].id !== 'pA' && worlds.pA.title === 'Harbour');
    ok('and a title already in use says it was restored', put[0].title === 'Harbour (restored)', put[0].title);
    await store.restoreEverything(b);
    ok('a second restore gets its own title too', put[1].title === 'Harbour (restored 2)', put[1] && put[1].title);
  } finally { globalThis.fetch = realFetch; }
}

/* --- the extension's JSON repairs: never inside a string --- */
eq('a trailing comma outside strings is dropped', stripTrailingCommasOutsideStrings('[{"a":1,},]'), '[{"a":1}]');
eq('a comma inside a string value is never touched', stripTrailingCommasOutsideStrings('[{"replace":"Options: [a, b, ]"}]'), '[{"replace":"Options: [a, b, ]"}]');
ok('a raw line break inside a string is repaired', JSON.parse(escapeRawControlsInStrings('[{"replace":"one\ntwo"}]'))[0].replace === 'one\ntwo');
ok('structure outside strings is left alone', escapeRawControlsInStrings('[\n {"a":"b"}\n]') === '[\n {"a":"b"}\n]');
{
  const raw = '<edits>\n[\n  {"file":"a.md","find":"one","replace":"line one\nline two","reason":"x"},\n]\n</edits>';
  const r = parseEdits(raw);
  ok('a block with raw line breaks and a trailing comma still reads', r.edits.length === 1 && r.edits[0].replace === 'line one\nline two' && !r.warn, JSON.stringify(r));
  const keepsComma = parseEdits('<edits>[{"find":"x","replace":"list: [a, b, ]"}]</edits>');
  eq('and a value holding ", ]" survives every repair', keepsComma.edits[0].replace, 'list: [a, b, ]');
}

/* --- the last block is the answer; drafts are set aside --- */
{
  const drafted = 'Plan: <edits>[{"find":"Claire","replace":"Claire Reynolds"}]</edits> let me check. Final:\n<edits>[{"find":"Claire","replace":"Claire Reynolds"},{"find":"x","replace":"y"}]</edits>';
  const r = parseEdits(drafted);
  eq('only the last block is used', r.edits.length, 2);
  /* This line once required a note about the draft in r.warn. That note reached the cards as "Not done"
   * and the persona as a failure; a draft set aside is how the answer was written, so it is only counted. */
  ok('the draft is counted, never reported as something that went wrong', r.drafts === 1 && !r.warn, JSON.stringify(r));
  const same = parseEdits('<edits>[{"find":"a","replace":"b"}]</edits> <edits>[{"find":"a","replace":"b"}]</edits>');
  ok('the same block twice is one block and no note', same.edits.length === 1 && !same.warn, JSON.stringify(same));
  const cutFinal = parseEdits('<edits>[{"find":"old","replace":"draft"}]</edits> Final: <edits>[{"find":"a","replace":"b"},{"find":"c","rep');
  ok('a cut-off final block wins over an earlier complete draft', cutFinal.edits.length === 1 && cutFinal.edits[0].find === 'a', JSON.stringify(cutFinal));
  const prose = parseEdits('<edits>[{"find":"a","replace":"b"}]</edits> (I used an <edits> block above.)');
  ok('a prose mention after the block is not a cut-off block', prose.edits.length === 1 && !prose.cut, JSON.stringify(prose));
  eq('thinking written on the page is taken out of the notes', stripThinking('<think>plan <edits>[]</edits></think>I tidied the timeline.'), 'I tidied the timeline.');
}

/* --- a turn lands in the world as it stands NOW (Cozy Tavern M59, M185, M263) --- */
{
  const snap = new Map([['A.md', 'one'], ['B.md', 'two'], ['C.md', 'three']]);
  const result = { project: { docs: [
    { name: 'A.md', text: 'ONE', kind: 'pe' },
    { name: 'B.md', text: 'TWO', kind: 'pe' },
    { name: 'C.md', text: 'THREE', kind: 'pe' },
    { name: 'New.md', text: 'fresh', kind: 'notes' },
  ], recentSections: ['x'] } };
  const turn = {
    role: 'maker', text: 'done', at: 424242,
    cards: ['A.md', 'B.md', 'C.md', 'New.md'].map((n) => ({ status: 'applied', name: n, reason: 'r' })),
    batches: [{ id: 'b1', items: ['A.md', 'B.md', 'C.md', 'New.md'].map((n) => ({ name: n, before: null, afterHash: 'h' })) }],
  };
  const liveWorld = {
    docs: [{ name: 'A.md', text: 'one' }, { name: 'B.md', text: 'two, edited by hand meanwhile' }],
    chats: [{ id: 'c1', turns: [{ role: 'writer', text: 'go' }] }],
  };
  const r = landTurn(liveWorld, { chatId: 'c1', snapshot: snap, result, makerTurn: turn });
  const doc = (n) => r.world.docs.find((d) => d.name === n);
  eq('an untouched document takes the crew\'s change', doc('A.md').text, 'ONE');
  eq('a document he edited meanwhile keeps his words', doc('B.md').text, 'two, edited by hand meanwhile');
  ok('a document he deleted meanwhile stays deleted', !doc('C.md'));
  eq('a document the crew started arrives', doc('New.md').text, 'fresh');
  const cards = r.world.chats[0].turns[1].cards;
  ok('the kept hand edit is said on its card', cards.find((c) => c.name === 'B.md').status === 'refused' &&
    /by hand/.test(cards.find((c) => c.name === 'B.md').why));
  ok('the deletion is said on its card', /stays deleted/.test(cards.find((c) => c.name === 'C.md').why));
  eq('put-it-back never reaches a document that was not changed',
    r.world.chats[0].turns[1].batches[0].items.map((i) => i.name).sort(), ['A.md', 'New.md']);
  ok('the reply lands in the conversation that asked', r.landed && r.world.chats[0].turns.length === 2);
  ok('the world is not mutated in place', liveWorld.docs[0].text === 'one' && liveWorld.chats[0].turns.length === 1);
  const gone = landTurn({ docs: [{ name: 'A.md', text: 'one' }], chats: [] }, { chatId: 'c1', snapshot: snap, result, makerTurn: turn });
  ok('a deleted conversation lets the reply go and still lands the documents', !gone.landed && gone.world.docs.find((d) => d.name === 'A.md').text === 'ONE');
  const twice = landTurn(r.world, { chatId: 'c1', snapshot: snap, result, makerTurn: turn });
  ok('landing twice is landing once', twice.already === true && JSON.stringify(twice.world) === JSON.stringify(r.world));
  ok('the names never collide: a document he started meanwhile is kept',
    landTurn({ docs: [{ name: 'New.md', text: 'his own' }], chats: [{ id: 'c1', turns: [] }] },
      { chatId: 'c1', snapshot: snap, result, makerTurn: turn }).world.docs.find((d) => d.name === 'New.md').text === 'his own');
}

/* --- one voice on the wire (Cozy Tavern M321) --- */
eq('two from one side become one', oneVoice([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]), [{ role: 'user', content: 'a\n\nb' }]);
eq('an answer before any question is dropped', oneVoice([{ role: 'assistant', content: 'x' }, { role: 'user', content: 'q' }]), [{ role: 'user', content: 'q' }]);
eq('empty turns are dropped', oneVoice([{ role: 'user', content: 'q' }, { role: 'assistant', content: '  ' }, { role: 'user', content: 'r' }]), [{ role: 'user', content: 'q\n\nr' }]);

/* --- the workers hear the conversation (Cozy Tavern M226, M249) --- */
{
  const turns = [{ role: 'writer', text: 'the city is inside a leviathan' }, { role: 'maker', text: 'lovely' }, { role: 'writer', text: 'fold all that in' }];
  const talk = conversationFor(turns, p);
  ok('the worker hears what "all that" was', talk.includes('the city is inside a leviathan'));
  ok('the worker hears who said it, by name', talk.startsWith('Bruce: the city') && talk.includes('Eni: lovely'));
  ok('newest last', talk.trim().endsWith('fold all that in'));
  const long = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'maker' : 'writer', text: 'x'.repeat(300) + i }));
  const cut = conversationFor(long, p, 3000);
  ok('a cut in the conversation is said out loud', cut.startsWith('(earlier conversation is not shown'));
  ok('the cut keeps the newest', cut.includes('x'.repeat(300) + '199'));
}

/* --- "I changed it" with no block is sent back (Cozy Tavern M75, M118) --- */
ok('a claim of work is recognised', claimsAChange("I've updated Claire's age and moved the rule."));
ok('a claim of work is recognised in plain past', claimsAChange('We added the Ribway as its own entry.'));
ok('reading is not a claim of work', !claimsAChange('I checked the timeline and read every dossier; nothing needed changing.'));
ok('a quoted line is not a claim of work', !claimsAChange('The storyteller wrote "I changed my mind about the siege".'));
ok('a single-quoted line is not a claim of work', !claimsAChange("Her last words were 'I changed everything for you' and then she left."));
ok('a contraction is not mistaken for a quotation', claimsAChange("I've updated Claire's age, and I've moved the rule."));

/* --- a control token ends the answer (Cozy Tavern M117) --- */
eq('the answer ends at a leaked control token', endAtControlToken('All done.<|im_end|>\nuser: next'), 'All done.');
eq('an answer without one is untouched', endAtControlToken('All done.'), 'All done.');

/* --- the front calls him by name, never "the writer" (Cozy Tavern M327) --- */
ok('the front calls him by his name', frontBody(p).includes('Bruce'));
ok('the front never calls him "the writer"', !/the writer/i.test(frontBody(p)));
ok('with no name the front still reads as talk', !/the writer|undefined|null/i.test(frontBody(personaOf({ settings: {} }))));

/* --- SillyTavern's names read as his names (Cozy Tavern M361) --- */
eq('{{user}} and {{char}} read as the two names',
  voiceMacros('You are {{char}}. {{user}} is here. <USER> and <BOT>.', p), 'You are Eni. Bruce is here. Bruce and Eni.');
eq('an unset name never leaves a raw macro on the wire', voiceMacros('{{user}}', personaOf({ settings: {} })), 'the author');
eq('{{User}} in any case is his name', voiceMacros('{{User}} and {{ CHAR }}', p), 'Bruce and Eni');
eq('a preset\'s own <user> tag is markup, not a name', voiceMacros('<user>hi</user> <USER>', p), '<user>hi</user> Bruce');
ok('the house can point at an unfilled macro', unfilledMacros(personaOf({ settings: { makerName: 'Eni' }, personaFrame: '{{user}} and {{char}}' })).join() === '{{user}}');

/* --- the front reads the book without the workers' tools (Cozy Tavern M335) --- */
{
  /* the worker's tools only matter when the world is too big to send whole */
  const bigWorld = { docs: [{ name: 'Plot Essential.md', kind: 'pe', text: many },
    { name: 'Continuity File 1.md', kind: 'continuity', text: '# PLOT ESSENTIAL CONTINUITY — FILE 1\n\n## NOTES\n' + 'x'.repeat(WHOLE_LIMIT) }] };
  const forFront = docBriefs(bigWorld, { message: 'TIMELINE', forFront: true });
  const forWorker = docBriefs(bigWorld, { message: 'TIMELINE' });
  ok('the front is never taught to ask for pages', !forFront.includes('<need>'), forFront.slice(-200));
  ok('the front is never told what it may not rewrite', !/do not rewrite/i.test(forFront));
  ok('a worker still is, when the world is too big to send whole', forWorker.includes('<need>') && /do not rewrite/i.test(forWorker));
  const smallWorld = { docs: [{ name: 'Plot Essential.md', kind: 'pe', text: many }] };
  const wholeBrief = docBriefs(smallWorld, { message: 'nothing in particular' });
  const parsedMany = parseDoc(many, 'pe');
  ok('a world that fits reaches a worker whole — every section in full',
    parsedMany.sections.every((s) => wholeBrief.includes(s.text.trim().split('\n').slice(-1)[0])) && !wholeBrief.includes('<need>'));
}

/* --- either reason to stop stops it --- */
{
  const a = new AbortController(), b = new AbortController();
  const s1 = either(a.signal, b.signal);
  b.abort();
  ok('the channel\'s own timeout stops a worker even when the writer has not pressed Stop', s1.aborted);
  const c = new AbortController(), d = new AbortController();
  const s2 = either(c.signal, d.signal);
  c.abort();
  ok('the writer\'s Stop stops it too', s2.aborted);
}

/* --- worlds hold conversations; an old world moves in whole (Cozy Chat v5.4.0) --- */
{
  const old = { id: 'w', title: 'Old', docs: [{ name: 'A.md', text: 'x' }],
    turns: [{ role: 'writer', text: 'first', at: 100 }, { role: 'maker', text: 'second', at: 200 }] };
  const w = upgradeWorld(JSON.parse(JSON.stringify(old)));
  ok('an old world gets one conversation', w.chats.length === 1);
  eq('every turn moves across, in order', w.chats[0].turns.map((t) => t.text), ['first', 'second']);
  ok('the old list is gone, so nothing is kept twice', !('turns' in w));
  ok('the open conversation is set', w.openChat === w.chats[0].id);
  ok('the documents are untouched', w.docs[0].text === 'x');
  const again = upgradeWorld(JSON.parse(JSON.stringify(w)));
  ok('upgrading twice changes nothing', JSON.stringify(again) === JSON.stringify(w));
  const fresh = upgradeWorld({ id: 'n', title: 'New' });
  ok('a new world has somewhere to talk', fresh.chats.length === 1 && fresh.chats[0].turns.length === 0);
}

/* --- the undo net is shared across every conversation in a world --- */
{
  const w = { chats: [{ turns: [] }, { turns: [] }] };
  for (let i = 0; i < UNDO_KEPT + 4; i++) {
    w.chats[i % 2].turns.push({ at: i, batches: [{ id: 'b' + i, items: [{ name: 'A.md', before: 'x', afterHash: 'h' }] }] });
  }
  capUndo(w);
  const all = w.chats.flatMap((c) => c.turns).sort((a, b) => a.at - b.at).map((t) => t.batches[0]);
  eq('across conversations, the newest stay undoable', all.slice(-UNDO_KEPT).filter((b) => b.tooOld).length, 0);
  eq('across conversations, the oldest lose their payload', all.slice(0, 4).filter((b) => b.tooOld).length, 4);
}

/* --- the worldbook goes to SillyTavern in SillyTavern's shape (Cozy Chat v5.13.0) --- */
{
  const st = worldbookToST([
    { name: 'The Ribway', keys: ['Ribway', 'market'], content: 'a street', strategy: 'green', order: 50, position: 'before_char' },
    { name: 'The Rules', keys: [], content: 'always', strategy: 'blue', position: 'at_depth', depth: 2, probability: 60 },
    { name: 'Echo', keys: ['x'], content: 'y', strategy: 'chain' },
  ]);
  const e = st.entries;
  ok('a green entry fires on its keys', e['0'].selective === true && e['0'].constant === false && e['0'].key.join() === 'Ribway,market');
  ok('a blue entry is always on', e['1'].constant === true && e['1'].key.length === 0);
  ok('a chain entry is vectorized and keyless', e['2'].vectorized === true && e['2'].key.length === 0);
  ok('the name becomes the entry\'s title', e['0'].comment === 'The Ribway');
  ok('position is carried', e['0'].position === 0 && e['1'].position === 4 && e['2'].position === 1);
  ok('depth is carried only where it means something', e['1'].depth === 2 && e['0'].depth === 4);
  ok('a probability under a hundred switches probability on', e['1'].useProbability === true && e['1'].probability === 60);
}
eq('a pasted worldbook is known by its shape', guessKind('stuff.md', '[{"name":"x"}]'), 'worldbook');
eq('a pasted continuation file is known by its heading', guessKind('file.md', '# PLOT ESSENTIAL CONTINUITY — X — FILE 2'), 'continuity');
eq('one hour ago, in grammar', when(Date.now() - 3600 * 1000), '1 hour ago');
eq('two days ago, in grammar', when(Date.now() - 2 * 86400 * 1000), '2 days ago');
eq('a moment ago is just now', when(Date.now() - 5000), 'just now');
eq('a plot essential is the default', guessKind('Plot Essential.md', '# PLOT ESSENTIAL — X'), 'pe');
eq('a note that opens with a bracket is words, not a worldbook', guessKind('Scratch.md', '[OOC: remember the siege]\nmore'), 'pe');
eq('a SillyTavern export pasted in is a worldbook', guessKind('x.md', '{"entries":{"0":{"comment":"a"}}}'), 'worldbook');

/* ============================ long work: a hang guard, and cut answers (v1.1.6) */

{
  const { joinSeam, plainFailure } = await import('../js/agents/run.js');
  const call = await import('../js/agents/call.js');

  eq('a seam where the carry-on starts a little way back is joined once', joinSeam('the harbour wall was built by the guild', 'built by the guild in the flood year'), 'the harbour wall was built by the guild in the flood year');
  eq('a clean seam is joined as it is', joinSeam('{"find":"WHERE: the Rib', 'way"}'), '{"find":"WHERE: the Ribway"}');
  eq('a tiny accidental overlap is not taken for a restart', joinSeam('abc the', 'the end'), 'abc thethe end');


  /* the ceiling is a hang guard, and says it was one */
  ok('the ceiling is no longer three minutes', call.CALL_TIMEOUT_MS >= 20 * 60 * 1000, String(call.CALL_TIMEOUT_MS));
  call.setCallTimeoutForTests(60);
  try {
    const out = await call.enqueue('ceiling', 'x', ({ signal }) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ ok: false, error: 'stopped' }), { once: true });
    }));
    eq('a job that never comes back is let go, and says why — not "stopped"', out.error, call.TIMED_OUT);
    eq('and the persona is told it plainly', plainFailure(out.error), 'it took far too long and was let go');
    const quick = await call.enqueue('ceiling', 'y', async () => ({ ok: true, value: 1 }));
    ok('a job that finishes in time is untouched', quick.ok === true && quick.value === 1);
  } finally { call.setCallTimeoutForTests(30 * 60 * 1000); }
}


/* ============================ NO INVENTED DATES, NO NOISE CARDS */
{
  const { readEvents } = await import('../js/doc/lint.js');
  const HIS = ['e001 [~980 AG] [setup]: Jovan was born.', 'e003 [Wednesday 3rd of Hanami, 1001 AG, 14:00] [LEVERAGE]:', 'e004 [Sunday 20th of Shiraume, 1000 AG, 18:40]:',
    'e005 [Friday 3rd of Hanami, 1001 AG, 09:00] [POLITICAL]:', 'e006 [Mon 14 Apr 247, 09:00] [setup]: the template\'s own shape', 'e007 [setup]: a thing with no date at all', 'e008 [e005 follow-up]: an id is not a year'].join('\n');
  /* the craft's own standard (3.1): "Every event … carries a full date-time: [DD MMM YYYY, HH:MM]. No
   * exceptions" — his calendar's full stamps pass; a bare year is not one, and it is assigned, never left */
  eq('his own calendar\'s full stamps pass — ordinals, "of", month names; a bare year is not a full date-time', readEvents(HIS).undated, ['e001', 'e007', 'e008']);
  const f = lint('# PLOT ESSENTIAL — Soul Society — V1.0\n\n## TIMELINE\n' + HIS + '\n', { kind: 'pe', deliverable: true }).found.find((x) => x.check === 'an event without a full date-time');
  ok('the crew is told to assign them as the craft\'s Temporal Anchoring says', f && /e001, e007, e008 carry no full date-time/.test(f.said) && /Temporal Anchoring/.test(f.said) && /in order with the events around it/.test(f.said), f && f.said);
  eq('the craft\'s own fantasy example is a full date-time', readEvents('## TIMELINE\ne001 [Moonday 15th of Highsun, 847 AK, 14:30] [SETUP]: x\n').undated, []);
  /* the rest of its Mechanical Audit, read by code from his real event lines */
  const HIS_UPLOAD = ['### Calendar', 'Months: 1-Shiratsuyu, 2-Hatsuharu, 3-Hanami, 4-Samidare, 5-Mizube,', '6-Suzushiro, 7-Momiji, 8-Kogarashi, 9-Setsugetsu, 10-Fuyubi, 11-Maboroshi,', '12-Shiraume. 7-day week (Mon–Sun).', '', '## TIMELINE',
    'e001 [Thur 22nd of Shiraume, ~980 AG, 03:20] [SETUP]: Jovan Oda born.', '', 'e002 [Thur 5th of Hanami, ~980 AG, 11:00] [SETUP]: Yamamoto discovered the child.', '',
    'e004 [Sun 20th of Hanami, 1000 AG, 18:40]: Thousand Year Blood War.', '', 'e005 [Fri 3rd of Hanami, 1001 AG, 09:00] [POLITICAL]: ' + 'word '.repeat(90).trim()].join('\n');
  const audit = readEvents(HIS_UPLOAD);
  eq('his upload, read by code: the discovery dated before the birth', audit.lateOrder, ['e002 is dated before e001']);
  eq('an event with no tags', audit.untagged, ['e004']);
  eq('an event over the craft\'s 80-word ceiling', audit.long, ['e005']);
  eq('the STATE dated before the last event is caught', readEvents('# STATE: Mon 1 Jan 1000, 09:00 / x\n## TIMELINE\ne001 [Tue 2 Jan 1000, 10:00] [SETUP]: y\n').stateEarly, 'e001');
  eq('and one at or after it is not', readEvents('# STATE: Tue 2 Jan 1000, 11:00 / x\n## TIMELINE\ne001 [Tue 2 Jan 1000, 10:00] [SETUP]: y\n').stateEarly, '');
  const found = lint('# PLOT ESSENTIAL — X — V1.0\n\n' + HIS_UPLOAD + '\n', { kind: 'pe', deliverable: true }).found.map((y) => y.check);
  ok('each is handed to the chronicler as a finding', ['events out of time order', 'an event with no tags', 'an event over its word budget'].every((c) => found.includes(c)), JSON.stringify(found));
  /* each kind of document to its own budget, as the craft sets them */
  const fullDetail = '# PLOT ESSENTIAL CONTINUITY — X — FILE 2\n# STATE: Mon 1 Jan 1000, 09:00 / x\n\n## WHAT HAPPENED\ne010 [Mon 1 Jan 1000, 08:00] [SETUP]: ' + 'word '.repeat(120).trim() + '\n';
  eq('a continuation file keeps full detail: no 80-word ceiling on its events', lint(fullDetail, { kind: 'continuity', deliverable: true }).found.filter((y) => y.check === 'an event over its word budget').length, 0);
  eq('the plot essential is held to it', lint(fullDetail, { kind: 'pe', deliverable: true }).found.filter((y) => y.check === 'an event over its word budget').length, 1);
  const heavy = 'x '.repeat(4 * 7000 / 2);
  eq('a continuation file past the craft\'s 6,000 tokens is heavy; a plot essential of the same size is not',
    [lint(heavy, { kind: 'continuity', deliverable: true }).found.some((y) => y.check === 'the document has grown heavy'), lint(heavy, { kind: 'pe', deliverable: true }).found.some((y) => y.check === 'the document has grown heavy')], [true, false]);
  eq('a change that only moves spacing is no change', applyEdit('WHERE: the  Ribway\nLAST: x', { find: 'WHERE: the  Ribway', replace: 'WHERE: the Ribway' }).why, 'only the spacing would change');

}

/* ============================ BRANCH HERE: THE DOCUMENTS AS THEY STOOD, ON A COPY */
{
  const { rollBackTo } = await import('../js/doc/branch.js');
  const PE0 = '# PLOT ESSENTIAL — Soul Society — V1.0\n\n## TIMELINE\ne005 [Fri] [setup]: Shunsui appointed Jovan.\n\n## SCENE\nWHERE: the Ribway\n';
  const r1 = applyRun([{ name: 'Plot Essential.md', text: PE0 }], [{ file: 'Plot Essential.md', find: 'WHERE: the Ribway', replace: 'WHERE: the 13th Division barracks' }]);
  const PE1 = r1.texts.get('Plot Essential.md');
  const r2 = applyRun([{ name: 'Plot Essential.md', text: PE1 }], [{ file: 'Plot Essential.md', insert_after: 'e005 [Fri] [setup]: Shunsui appointed Jovan.', replace: 'e006 [Sun 09:00] [setup]: The courier packet had not reached the 13th or 2nd Division desks.' }]);
  const PE2 = r2.texts.get('Plot Essential.md');
  const PE3 = PE2.replace('Shunsui appointed Jovan.', 'Shunsui appointed Jovan, on his own authority.');
  const world = () => ({
    docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: PE3 }],
    chats: [{ id: 'k', turns: [{ role: 'writer', text: 'move the scene', at: 10 }, { role: 'maker', text: 'Moved.', at: 20, batches: [r1.batch] },
      { role: 'writer', text: 'add the packet', at: 30 }, { role: 'maker', text: 'Added.', at: 40, batches: [r2.batch] }] }],
    undo: [{ id: 'h1', docId: 'd1', name: 'Plot Essential.md', before: PE2, after: PE3, at: 50 }],
  });
  ok('the changes the tests roll back are real ones', r1.batch && r2.batch && PE1 !== PE0 && PE2 !== PE1);
  const at = (cut) => { const r = rollBackTo(world(), cut); return r.ok ? r.docs[0].text : 'refused: ' + r.why; };
  eq('rolled to after the last reply: his hand edit since is put back', at(40), PE2);
  eq('rolled to before the packet was added: the packet is gone, the scene still moved', at(30), PE1);
  eq('rolled to before anything: the book as it first was', at(10), PE0);
  eq('rolled to now: nothing changes', at(99), PE3);
  const w = world();
  rollBackTo(w, 10);
  eq('the world itself is never touched — only the copy is rolled', w.docs[0].text, PE3);
  const putBack = world();
  putBack.chats[0].turns[3].batches = [{ ...r2.batch, undone: true }];
  putBack.docs[0].text = PE1;
  putBack.undo = [];
  eq('a change already put back is not put back twice', rollBackTo(putBack, 10).docs[0].text, PE0);
  const moved = world();
  moved.undo = [];
  moved.docs[0].text = PE2.replace('The courier packet had not reached', 'The courier packet HAD reached');
  const refused = rollBackTo(moved, 30);
  ok('a change whose words were changed since cannot be put back: it says so, rather than roll half', !refused.ok && refused.why, JSON.stringify(refused).slice(0, 200));
}


/* ============================ the save line: deletes and house saves (v1.1.8) */
{
  const store = await import('../js/store.js');
  const log = [];
  const worlds = { pA: { id: 'pA', title: 'A', docs: [], chats: [] }, pB: { id: 'pB', title: 'B', docs: [], chats: [] } };
  let putsFail = true;
  let gate = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const m = opts.method || 'GET';
    const json = (v, status = 200) => ({ ok: status < 400, status, json: async () => v });
    if (u.startsWith('/api/project/')) {
      const id = u.split('/').pop();
      if (m === 'GET') return worlds[id] ? json(JSON.parse(JSON.stringify(worlds[id]))) : json({ error: 'not found' }, 404);
      if (m === 'PUT') {
        if (putsFail) return json({ error: 'down' }, 503);
        if (gate && id === 'pA') await gate.wait;
        log.push(`PUT ${id}`); worlds[id] = JSON.parse(opts.body); return json({ ok: true });
      }
      if (m === 'DELETE') { log.push(`DELETE ${id}`); delete worlds[id]; return json({ ok: true }); }
    }
    if (u === '/api/house' && m === 'PUT') {
      const h = JSON.parse(opts.body);
      if (h.settings && h.settings.slow) await new Promise((r) => setTimeout(r, 120));
      log.push(`HOUSE ${h.settings.makerName || '-'}/${h.settings.yourName || '-'}`);
      return json({ ok: true });
    }
    if (u === '/api/house') return json({ settings: {}, connections: [], agentConnections: {} });
    return json({});
  };
  try {
    /* two worlds waiting to be saved while the device was away */
    await store.updateWorld('pA', (w) => { w.title = 'A2'; return w; });
    await store.updateWorld('pB', (w) => { w.title = 'B2'; return w; });
    ok('both wait while the device is away', store.unsavedWorlds().sort().join() === 'pA,pB', store.unsavedWorlds().join());
    putsFail = false;
    let open; gate = { wait: new Promise((r) => { open = r; }) };
    const run = store.flush();                 /* A's save goes out and hangs */
    await new Promise((r) => setTimeout(r, 30));
    const gone = store.deleteProject('pB');     /* he deletes B while A is still saving */
    await new Promise((r) => setTimeout(r, 30));
    open();
    await run; await gone;
    ok('a world deleted while another was saving is never saved back', !log.includes('PUT pB') && log[log.length - 1] === 'DELETE pB' && !('pB' in worlds), log.join(' | '));
    ok('and the one that was saving still lands', log.includes('PUT pA') && worlds.pA.title === 'A2');

    /* two house saves a moment apart land in the order they were made */
    log.length = 0;
    await store.loadHouse();
    const h = store.getHouse();
    h.settings.slow = true; h.settings.makerName = 'Eni';
    const first = store.saveHouse(h);           /* the slow one goes first */
    h.settings.slow = false; h.settings.yourName = 'Bruce';
    const second = store.saveHouse(h);
    await Promise.all([first, second]);
    eq('house saves land in order, the newest last', log, ['HOUSE Eni/Bruce', 'HOUSE Eni/Bruce']);
  } catch (e) { ok('the save line test ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
}

/* ============================ where a change lands (v1.1.9) */
{
  const { applyEdit, applyRun } = await import('../js/doc/edits.js');
  const doc = '# PE\n\n## WORLD\n- The city lives inside a dormant leviathan.\n- The tide is red.\n';
  const r = applyEdit(doc, { insert_after: '- The city lives inside', replace: '- The Ribway floods at every tide.' });
  eq('a quote that stops partway along a line puts the new line under the whole line, never inside it', r.text,
    '# PE\n\n## WORLD\n- The city lives inside a dormant leviathan.\n- The Ribway floods at every tide.\n- The tide is red.\n');
  eq('a whole-line quote still lands right under it', applyEdit(doc, { insert_after: '- The tide is red.', replace: '- Salt in the air.' }).text,
    '# PE\n\n## WORLD\n- The city lives inside a dormant leviathan.\n- The tide is red.\n- Salt in the air.\n');
  eq('the last line with no ending still works', applyEdit('a\nb', { insert_after: 'b', replace: 'c' }).text, 'a\nb\nc');
  const docs = [{ name: 'Plot Essential.md', text: 'WHERE: the Ribway\n' }, { name: 'Notes.md', text: 'n\n' }];
  const loose = applyRun(docs, [{ file: 'plot essential', find: 'WHERE: the Ribway', replace: 'WHERE: the Quay' }]);
  ok('a document named the way a model names it is still found', loose.cards[0].status === 'applied' && loose.texts.get('Plot Essential.md') === 'WHERE: the Quay\n', JSON.stringify(loose.cards));
  const two = applyRun([{ name: 'A.md', text: 'x' }, { name: 'a.md', text: 'y' }], [{ file: 'A', find: 'x', replace: 'z' }]);
  ok('a loose name that fits two documents is refused, never guessed', two.cards[0].status === 'refused', JSON.stringify(two.cards));
}

/* ============================ a pasted persona with macros, no names (v1.1.10) */
{
  const { voiceMacros, openingFor, personaOf, MACROS } = await import('../js/agents/persona.js');
  const { frontBody } = await import('../js/agents/run.js');
  const paste = "You are {{char}}, a quiet archivist. {{user}} is your oldest friend. <BOT> keeps {{user}}'s worlds and <USER> trusts them.";

  /* names set: the macros read as the two names, exactly (the whole point of the boxes) */
  const named = personaOf({ settings: { makerName: 'Eni', yourName: 'Bruce' }, personaFrame: paste });
  const withNames = openingFor(named, frontBody(named));
  ok('names set: {{char}}/<BOT> read as the maker', /You are Eni, a quiet archivist/.test(withNames) && /Eni keeps Bruce's worlds/.test(withNames), withNames.slice(0, 120));
  ok('names set: {{user}}/<USER> read as him', /Bruce is your oldest friend/.test(withNames) && /Bruce trusts them/.test(withNames));
  ok('names set: not one brace or macro reaches the model', !MACROS.test(withNames) && !/\{\{|<USER>|<BOT>/.test(withNames), withNames.match(/\{\{[^}]*\}\}|<USER>|<BOT>/));

  /* names NOT set (the plug-and-play paste): still not one macro reaches the model */
  const bare = personaOf({ settings: {}, personaFrame: paste });
  const noNames = openingFor(bare, frontBody(bare));
  ok('names unset: not one brace or macro reaches the model', !MACROS.test(noNames) && !/\{\{|<USER>|<BOT>/.test(noNames), noNames.match(/\{\{[^}]*\}\}|<USER>|<BOT>/));
  ok('names unset: the fallback is a plain word, grammatical as subject and possessive', /You are the one telling this, a quiet archivist/.test(noNames) && /the one telling this keeps the author's worlds/.test(noNames), noNames.slice(0, 140));
  eq('a possessive macro folds into the word', voiceMacros("{{user}}'s map", personaOf({ settings: {} })), "the author's map");
  eq('a lower-case <user> tag is still left as the preset\'s own markup', voiceMacros('<user>x</user> <USER>', named), '<user>x</user> Bruce');
}

/* ============================ connections: does it think? (Cozy Tavern M348, M350, M351) (v1.1.12) */
{
  const { testConnection, listModels } = await import('../js/agents/call.js');
  const { familyStyle, buildRequest, readAnswer, modelsUrl, reportedIdentity } = await import('../js/providers.js');
  eq('thinking on an unusual channel is still thinking', readAnswer('openai', { choices: [{ message: { content: 'ready', reasoning_details_text: 'hmm, one word' } }] }).thinking, 'hmm, one word');
  eq('thinking tokens the answer reports are read', readAnswer('openai', { choices: [{ message: { content: 'ready' } }], usage: { completion_tokens_details: { reasoning_tokens: 312 } } }).thinkTokens, 312);
  ok('a reasoning object is never taken for words', readAnswer('openai', { choices: [{ message: { content: 'x', reasoning: { effort: 'low' } } }] }).thinking === '');
  eq('an alias is read by the weights its provider names', familyStyle({ url: 'https://api.synthetic.new/openai/v1', model: 'syn:large:vision', modelHf: 'moonshotai/Kimi-K3' }), 'kimi');
  eq('a listing says what a model is', reportedIdentity({ id: 'syn:large:vision', hugging_face_id: 'moonshotai/Kimi-K3', reasoning_parameters: { efforts: ['LOW', 'high'] } }), { hf: 'moonshotai/Kimi-K3', efforts: ['low', 'high'] });
  const fitted = buildRequest({ url: 'https://relay.example/v1', model: 'm', thinking: 'medium', modelEfforts: ['low', 'high'] }, { messages: [] }).body.reasoning_effort;
  ok('a level the model does not take is fitted to one it does, from its provider\'s list', ['low', 'high'].includes(fitted), fitted);
  eq('the list lives beside the chat address', modelsUrl({ url: 'https://api.deepseek.com' }), 'https://api.deepseek.com/v1/models');
  eq('and beside a /v1 address', modelsUrl({ url: 'https://openrouter.ai/api/v1/chat/completions' }), 'https://openrouter.ai/api/v1/models');

  const realFetch = globalThis.fetch;
  const bodies = [];
  let script = [];
  globalThis.fetch = async (url, init) => {
    const spec = JSON.parse(init.body);
    bodies.push(spec);
    const next = script.shift();
    return { json: async () => next };
  };
  const answer = (content, extra = {}) => ({ choices: [{ message: { content, ...extra }, finish_reason: 'stop' }] });
  try {
    script = [answer('ready', { reasoning_content: 'one word, so: ready' })];
    let r = await testConnection({ id: 'x', url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'k', thinking: 'high' });
    ok('thinking that comes back is confirmed, at the level he set', r.ok && r.thinks && /Thinking works on this connection/.test(r.words) && /\u201chigh\u201d/.test(r.words), r.words);

    bodies.length = 0;
    script = [answer('ready'), answer('ready', { reasoning_content: 'at the top it thinks' })];
    r = await testConnection({ id: 'x', url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'k', thinking: 'low' });
    ok('none at his level but some at the top: it says the LEVEL is the reason', r.ok && r.levelTooLow && /this LEVEL that gives none/.test(r.words), r.words);
    ok('and the second ask really went at the top level', bodies.length === 2 && JSON.stringify(bodies[1].body).includes('max'), JSON.stringify(bodies.map((b) => b.body.reasoning_effort || b.body.thinking)));

    script = [answer('ready'), answer('ready')];
    r = await testConnection({ id: 'x', url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'k', thinking: 'low' });
    ok('none at any level: it says the ADDRESS gives none', r.ok && !r.thinks && /at any level/.test(r.words), r.words);

    script = [{ choices: [{ message: { content: 'ready' } }], usage: { reasoning_tokens: 90 } }];
    r = await testConnection({ id: 'x', url: 'https://relay.example/v1', model: 'm', key: 'k', thinking: 'medium' });
    ok('thinking tokens with no words: it thought, and the address keeps the words', r.ok && r.thinks && r.hidden && /keeps the words to itself/.test(r.words), r.words);

    const conn = { id: 'x', url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'k', thinking: 'high' };
    script = [{ error: 'provider', status: 400, detail: 'unknown parameter: reasoning_effort' }, answer('ready', { reasoning_content: 'thought anyway' })];
    r = await testConnection(conn);
    ok('a refused level is learned from and asked again on the way (the fallback)', r.ok && conn.learned && conn.learned.drop.includes('reasoning_effort'), JSON.stringify(conn.learned));

    script = [{ error: 'provider', status: 401, detail: 'invalid api key' }];
    r = await testConnection({ id: 'x', url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'bad' });
    ok('a bad key says so, plainly', !r.ok && /invalid api key/.test(r.words), r.words);

    bodies.length = 0;
    script = [{ data: [{ id: 'syn:large:vision', hugging_face_id: 'moonshotai/Kimi-K3', reasoning_parameters: { efforts: ['low', 'high'] } }, { id: 'a-model' }] }];
    const lm = await listModels({ url: 'https://api.synthetic.new/openai/v1', key: 'k' });
    ok('the models on offer come back A to Z, each with what it is', lm.ok && lm.models[0].id === 'a-model' && lm.models[1].hf === 'moonshotai/Kimi-K3' && lm.models[1].efforts.join() === 'low,high', JSON.stringify(lm));
    ok('asked with a GET to the list address, key and all', bodies[0].method === 'GET' && bodies[0].url === 'https://api.synthetic.new/openai/v1/models' && bodies[0].headers.Authorization === 'Bearer k', JSON.stringify(bodies[0]).slice(0, 160));
  } finally { globalThis.fetch = realFetch; }
}

/* ============================ his words are his (v1.1.13) */
{
  const { lint } = await import('../js/doc/lint.js');
  const { applyRun } = await import('../js/doc/edits.js');
  const HIS = '# PE\n\n## WORLD\n### Rules\n- Magic costs memory.\nTBD: the name of the drowned king\n\n### Calendar\n\n## MC — Jovan (16)\nID: a salvager\n→ Mira: trusts her (P:40 R:0 S:0)\n\n### Mira (captain | active | 24)\nID: captain\nAGENDA: [HIDDEN]\nNOTE: [FLASHBACK] the first storm\n';
  const r0 = lint(HIS, { kind: 'pe' });
  ok('the craft\'s own [HIDDEN] and his one-word tags are never taken out', r0.text.includes('AGENDA: [HIDDEN]') && r0.text.includes('[FLASHBACK]'), r0.text);
  const crewLeft = HIS + '\nSomething [STALE_WORLD_STATE] was noted.\nUNRESOLVED: who sank the king\n\n## EMPTY NEW\n';
  const r1 = lint(crewLeft, { kind: 'pe', keep: HIS });
  ok('what the crew left is cleaned: an alert, a chore line, an empty heading it added', !r1.text.includes('[STALE_WORLD_STATE]') && !r1.text.includes('UNRESOLVED: who sank') && !r1.text.includes('## EMPTY NEW'), r1.text);
  ok('what was his stays: his TBD line, his empty heading, his bond, his tags', r1.text.includes('TBD: the name of the drowned king') && r1.text.includes('### Calendar') && r1.text.includes('→ Mira: trusts her') && r1.text.includes('AGENDA: [HIDDEN]'), r1.text);
  const r2 = lint(HIS, { kind: 'pe', keep: HIS });
  ok('his own typing, left as he typed it, loses nothing', r2.text.replace(/\n+$/, '') === HIS.replace(/\n+$/, ''), JSON.stringify(r2.found.map((f) => f.said)));
  const proj = { docs: [{ name: 'A.md', kind: 'pe', text: '# A\n\n## SCENE\nWHERE: x\n' }, { name: 'His.md', kind: 'pe', text: 'TBD: keep me\nsomething [OLD_NOTE] of his\n' }] };
  const sw = checkChanged(proj, new Set(['A.md']), new Map(proj.docs.map((d) => [d.name, d.text])));
  ok('a document nobody touched this turn is not rewritten', sw.project.docs[1].text === proj.docs[1].text, sw.project.docs[1].text);
  const cr = applyRun([{ name: 'Plot Essential.md', text: '' }], [{ create_file: 'Plot Essential.md', replace: '# PE\n' }]);
  ok('a plot essential cleared a moment ago can be written again by creating it', cr.cards[0].status === 'applied' && cr.texts.get('Plot Essential.md') === '# PE\n');
  const cr2 = applyRun([{ name: 'Plot Essential.md', text: 'x' }], [{ create_file: 'Plot Essential.md', replace: 'y' }]);
  ok('but creating over a document with words in it is still refused', cr2.cards[0].status === 'refused');

  /* the whole turn: "clear it and build it again" clears, then builds into the same document */
}


/* --- A WORLDBOOK, CHOSEN AND MADE: entries as plain data, put in by name (v1.4.0) --- */
{
  const { putEntries } = await import('../js/doc/entries.js');
  const { readWorldbook } = await import('../js/doc/lint.js');
  const read = (t) => (readWorldbook(t).entries || []);
  const at = (t, i) => read(t)[i] || {};
  const aldric = { name: 'Aldric', keys: ['Aldric', 'the general'], content: 'A blunt general. He says "never" when he means "not yet".', strategy: 'green', order: 200, position: 'after_char' };
  const ribway = { name: 'The Ribway', keys: ['Ribway'], content: "The rope-bridges between the leviathan's ribs.", strategy: 'green', order: 120, position: 'before_char' };

  const first = putEntries('', [aldric, ribway]);
  eq('entries begin a worldbook from nothing, one readable list, quotes and all', [first.ok, read(first.text).map((e) => e.name), at(first.text, 0).content], [true, ['Aldric', 'The Ribway'], aldric.content]);
  const keysOnly = putEntries(first.text, [{ name: 'aldric', keys: ['Aldric', 'the general', 'the old wolf'] }]);
  const after = read(keysOnly.text);
  eq('a change gives only what changes: his keys move, his content stays, his name is kept as it was', [after.length, (after[0] || {}).name, ((after[0] || {}).keys || []).length, (after[0] || {}).content], [2, 'Aldric', 3, aldric.content]);
  ok('and the card says it changed Aldric', /changed Aldric/.test(keysOnly.how || ''), keysOnly.how);
  const brin = putEntries(keysOnly.text, [{ name: 'Brin', keys: ['Brin'], content: 'The smith of the Ribway.', strategy: 'green' }]);
  eq('a new name is added at the end', read(brin.text).map((e) => e.name), ['Aldric', 'The Ribway', 'Brin']);
  eq('entries already there exactly as written change nothing, and say so the way the house drops', [putEntries(brin.text, [ribway]).ok, /already in the document/.test(putEntries(brin.text, [ribway]).why)], [false, true]);
  ok('an entry with no name has nowhere to go', /no name/.test(putEntries(brin.text, [{ keys: ['x'], content: 'y' }]).why || ''));
  ok('a new entry with nothing in it is refused', /no content/.test(putEntries(brin.text, [{ name: 'Ghost', keys: ['ghost'] }]).why || ''));
  const st = putEntries('', [{ comment: 'The War', key: [], content: 'The long war is in its ninth year.', constant: true }]);
  eq('an entry written in SillyTavern\'s shape is read for what it means', [at(st.text, 0).name, at(st.text, 0).strategy], ['The War', 'blue']);
  ok('a worldbook that cannot be read is refused, never written over', !putEntries('[{"name": "A" "keys": []}]', [ribway]).ok);
}

{
  const { putEntries } = await import('../js/doc/entries.js');
  const { readWorldbook } = await import('../js/doc/lint.js');
  const ent = [{ name: 'Aldric', keys: ['Aldric'], content: 'A general.', strategy: 'green' }];
  const pe = { name: 'Plot Essential.md', kind: 'pe', text: '# PLOT ESSENTIAL — X — V1.0\n## SCENE\nWHERE: x' };
  let r = applyRun([pe], [{ file: 'Ember Crown.json', entries: ent, reason: 'begin' }], { putEntries });
  eq('with no worldbook in the world, entries start one by the name they give', [(r.cards[0] || {}).status, (r.cards[0] || {}).how, r.texts.has('Ember Crown.json') ? (readWorldbook(r.texts.get('Ember Crown.json')).entries || []).length : 0, r.created], ['applied', 'started it', 1, ['Ember Crown.json']]);
  ok('and putting it back takes it away again', Boolean(r.batch) && (undoBatch([pe, { name: 'Ember Crown.json', text: r.texts.get('Ember Crown.json') }], r.batch).changes || []).some((c) => c.name === 'Ember Crown.json' && c.remove));
  const lore = { name: 'Lore.json', kind: 'worldbook', text: '[]' };
  r = applyRun([pe, lore], [{ file: 'Worldbook.json', entries: ent }], { putEntries });
  eq('with a worldbook there under another name, entries for a name not here are refused, never a second worldbook', [r.cards[0].status, r.cards[0].why, r.texts.has('Worldbook.json')], ['refused', 'there is no document by that name', false]);
  r = applyRun([pe, lore], [{ entries: ent }], { putEntries });
  eq('naming no document, they go into the one worldbook there is', [r.cards[0].status, (readWorldbook(r.texts.get('Lore.json')).entries || []).map((e) => e.name)], ['applied', ['Aldric']]);
  r = applyRun([pe, lore], [{ file: 'Plot Essential.md', entries: ent }], { putEntries });
  eq('entries never go into a plot essential', [r.cards[0].status, /not a worldbook/.test(r.cards[0].why), r.texts.get('Plot Essential.md')], ['refused', true, pe.text]);
  r = applyRun([pe], [{ file: 'Fresh.json', whole: true, replace: '[]' }, { file: 'Fresh.json', entries: ent }], { putEntries });
  eq('a worldbook written whole earlier in the same answer takes the entries after it', (readWorldbook(r.texts.get('Fresh.json')).entries || []).map((e) => e.name), ['Aldric']);
}

/* --- the worldbook keeper, through the real turn --- */

/* --- the worldbook's own checks: capitals, keys on one line, a stray quote --- */
{
  const { readWorldbook } = await import('../js/doc/lint.js');
  const r1 = lint(JSON.stringify([{ name: 'Ghost', keys: [], content: 'x', strategy: 'Green' }]), { kind: 'worldbook' });
  ok('"Green" is green: a capitalised green entry with no keys is seen, and handed to its keeper', r1.found.some((f) => /can never fire/.test(f.check) && f.worker === 'worldbook') && (JSON.parse(r1.text)[0] || {}).strategy === 'green', JSON.stringify(r1.found));
  const r2 = lint(JSON.stringify([{ name: 'Aldric', keys: 'Aldric, the general', content: 'x', strategy: 'green' }]), { kind: 'worldbook' });
  eq('keys written on one line are the keys, made a list — never an entry "that can never fire"', [JSON.parse(r2.text)[0].keys, r2.found.some((f) => /can never fire/.test(f.check))], [['Aldric', 'the general'], false]);
  const bare = '[\n  {"name": "Aldric", "keys": ["Aldric"], "content": "He said "never" twice.", "strategy": "green"}\n]';
  const r3 = readWorldbook(bare);
  eq('a quote left bare in an entry\'s words is read for what it is', [r3.ok, r3.ok && r3.entries[0].content], [true, 'He said "never" twice.']);
  const r4 = lint(bare, { kind: 'worldbook' });
  eq('and the worldbook is written back as data that reads', (() => { try { return JSON.parse(r4.text)[0].content; } catch (_) { return 'not readable'; } })(), 'He said "never" twice.');
}

/* --- a world made worldbook first takes its worldbook's name --- */
{
  const { nameWorld, DEFAULT_WORLD_TITLE } = await import('../js/doc/index.js');
  const w = (docs) => ({ title: DEFAULT_WORLD_TITLE, docs });
  const book = (name) => ({ name, kind: 'worldbook', text: '[{"name":"x","keys":["x"],"content":"y"}]' });
  const a = w([book('Ash Harbour.json')]); nameWorld(a);
  const b = w([book('Worldbook.json')]); nameWorld(b);
  const c = w([book('Ash Harbour.json'), { name: 'Plot Essential.md', kind: 'pe', text: '# PLOT ESSENTIAL — The Tide Court — V1.0\n## SCENE\nWHERE: x' }]); nameWorld(c);
  const d = w([book('World Info (copy).json')]); nameWorld(d);
  eq('a worldbook named for its world names the world; one named only for what it is does not; a plot essential\'s name comes first', [a.title, b.title, c.title, d.title], ['Ash Harbour', DEFAULT_WORLD_TITLE, 'The Tide Court', DEFAULT_WORLD_TITLE]);
}

/* --- one answer to how a world can be started --- */
{
  const { startChoices } = await import('../js/ui/docs.js');
  const labels = (docs) => startChoices(docs).map((c) => c.label);
  const pe = { name: 'P.md', kind: 'pe', text: '# PLOT ESSENTIAL — X — V1.0' };
  const wb = { name: 'W.json', kind: 'worldbook', text: '[]' };
  eq('a world with nothing in it can start either: a plot essential or a worldbook', labels([]), ['Start a plot essential', 'Start a worldbook', 'Build from a story card']);
  eq('a world with a worldbook can still start a plot essential, but not a second worldbook', labels([wb]), ['Start a plot essential', 'Build from a story card']);
  eq('a world with a plot essential makes its worldbook from it, so it offers no start', labels([pe]), []);
  eq('an empty worldbook is no worldbook yet', labels([{ ...wb, text: '' }]), ['Start a plot essential', 'Start a worldbook', 'Build from a story card']);
}

/* --- every shortcut, looked up rather than remembered (v1.4.2) --- */
{
  const { SHORTCUTS, allShortcuts, engineLines, WHO } = await import('../js/agents/shortcuts.js');
  const { houseCommand } = await import('../js/agents/router.js');
  const listed = allShortcuts();
  const names = listed.map((x) => x.cmd);
  const auditorCraft = readFileSync(join(ROOT, 'engine', 'sc-auditor.md'), 'utf8');
  const said = engineLines(SECTIONS, auditorCraft);
  /* every command his engine's table names, and every one the auditor's craft names, has its line */
  const missing = [...said.keys()].filter((c) => !names.includes(c));
  eq('every command in his engine and the auditor\'s craft is listed, so he can look it up', missing, []);
  ok('and the house\'s own *card is listed too', names.includes('*card'));
  eq('no command is listed twice', names.filter((c, i) => names.indexOf(c) !== i), []);
  /* each one goes where its line says: the house answers its own before anyone is asked; every
   * other one reaches the one he talks to, which reads his whole engine (v2.0) */
  const wrong = [];
  for (const x of listed) {
    const house = Boolean(houseCommand(x.cmd + (x.cmd === '*regress' ? ' a line' : '')));
    if ((x.who === 'house') !== house) wrong.push(`${x.cmd}: listed as ${x.who}, the house ${house ? 'answers' : 'does not answer'} it`);
    if (!['house', 'maker', 'auditor'].includes(x.who)) wrong.push(`${x.cmd}: listed as ${x.who}, who is nobody here`);
  }
  eq('each shortcut goes to the one its line says, through the house\'s own reading', wrong, []);
  ok('every line says what it does, who does it, and how to type it', listed.every((x) => x.does.length > 20 && WHO[x.who] && x.example.startsWith(x.cmd)), JSON.stringify(listed.filter((x) => !(x.does.length > 20 && WHO[x.who] && x.example.startsWith(x.cmd))).map((x) => x.cmd)));
  /* his engine's own words, read out of the files, never retyped */
  eq('*p is shown with his engine\'s own words for it', said.get('*p'), 'Update Pipeline (7.2); input = Storyteller output');
  eq('#q too', said.get('#q'), 'Full PE update from bullets — complete 7.2 pipeline');
  ok('*summarize brief is read as one command, not as *summarize', said.has('*summarize brief') && !said.has('*summarize'));
  ok('the auditor\'s *audit is shown in its craft\'s words', /^full review, REPORT ONLY/.test(said.get('*audit') || ''), said.get('*audit'));
  eq('every listed command but the house\'s own *card has its engine\'s words', names.filter((c) => c !== '*card' && !said.has(c)), []);
  ok('the groups are in the order he works: making one first', SHORTCUTS[0].group === 'Making one' && SHORTCUTS[0].items[0].cmd === '*new');
}

/* --- the plot essential's pipelines, foolproofed (v1.5.0) --- */
{
  const { frontBody } = await import('../js/agents/run.js');
  const { isNewStory } = await import('../js/agents/router.js');
  const { guessKind } = await import('../js/doc/kind.js');
  eq('a new story typed as one is known: *new, *source_new, *hybrid_new and a card — and nothing else', ['*new a steppe', 'x *source_new Bleach', '*hybrid_new mine', '*card\nX', 'a new idea', '*news', '#q'].map(isNewStory), [true, true, true, true, false, false, false]);
  eq('a skip bridge is a continuation file, by its name or by its heading', [guessKind('Skip Bridge 2.md', ''), guessKind('Bridge.md', '# SKIP BRIDGE 2 (skip target: the siege)\n## EVENTS')], ['continuity', 'continuity']);
  {
    const { commit: commitIt } = await import('../js/agents/run.js');
    const c = commitIt({ id: 'pk', docs: [{ id: 'd', name: 'Plot Essential.md', kind: 'pe', text: '# PLOT ESSENTIAL — X — V1.0' }], chats: [] },
      [{ file: 'The night of the siege.md', whole: true, replace: '## EVENTS\ne003 [Mon 14 Apr 247, 12:00] [siege]: The gates closed.' }], 'bridge', 'novelist');
    eq('whatever the novelist calls a document it starts, it is a bridge: a continuation file', (c.project.docs.find((d) => d.name === 'The night of the siege.md') || {}).kind, 'continuity');
  }
  const voices = [{ you: 'Bruce', person: 'second' }, { you: '', person: 'second' }, { you: 'Bruce', person: 'first' }, { you: '', person: 'first' }].map((v) => frontBody(v));
  ok('the one he brainstorms with is a co-writer, in all four voices', voices.every((t) => /as a co-writer, not a note-taker/.test(t) && /offer a couple of concrete ways it could go, and why/.test(t) && /only what only (?:Bruce|they) can decide/.test(t)));
  ok('and it speaks each in its own voice: \"I\" where the persona is \"I\", \"you\" where it is \"you\"', /While Bruce and I work a world out, I think it through/.test(voices[2]) && /While you and Bruce work a world out, think it through/.test(voices[0]));

}

/* ============================ the line-by-line audit (v1.6.1) */
{
  const { locate, applyEdit, ownWords } = await import('../js/doc/edits.js');
  /* a quote that fits in two overlapping places is two places: refused, never written at the first */
  eq('a find that fits in two overlapping places is refused', [locate('ab ab ab', 'ab ab').ok, /2 times/.test(locate('ab ab ab', 'ab ab').why || '')], [false, true]);
  eq('the same with only spacing different', locate('ab  ab  ab', 'ab ab').ok, false);
  eq('one place is still one place', [locate('x ab ab', 'ab ab').ok, locate('x ab ab', 'ab ab').from], [true, 2]);
  eq('a change that overlaps itself is refused, the document untouched', applyEdit('- - -', { find: '- -', replace: '* *' }).ok, false);
  eq('\u201cchange all\u201d still counts what it changes', applyEdit('aa aa aa', { find: 'aa', all: true, replace: 'b' }).how, 'changed all 3');
  /* what the persona re-reads of its own reply */
  eq('a tag named inside a sentence is its words', ownWords('Put <thinking> tags at the top, then write the scene.'), 'Put <thinking> tags at the top, then write the scene.');
  eq('a thought that opens the reply is not', ownWords('<think>plan it</think>\n\nAnswer.'), 'Answer.');
  eq('nor one the template opened, ended on its own line', ownWords('So my reply, warm.\n</think>\n\nAnswer.'), 'Answer.');
  eq('an unfinished thought that opens it leaves nothing', ownWords('<think>still planning'), '');
  eq('a closer named mid-sentence is words too', ownWords('End the plan with </thinking> and then write.'), 'End the plan with </thinking> and then write.');

}

/* ============================ the line-by-line audit, part 2 (v1.6.2) */
{
  const { applyRun } = await import('../js/doc/edits.js');
  const { lint, readEvents } = await import('../js/doc/lint.js');
  const { readChunk } = await import('../js/providers.js');
  /* one outcome per change, in order: a change that leaves the document as it was writes no card */
  const docs = [{ name: 'A.md', kind: 'pe', text: '# T\n\n## X\nold line\n' }];
  const run1 = applyRun(docs, [{ file: 'A.md', whole: true, replace: '# T\n\n## X\nold line\n' }, { file: 'A.md', find: 'old line', replace: 'new line' }, { file: 'A.md', find: 'missing', replace: 'x' }]);
  eq('each change has its own outcome, in order', [run1.perEdit.length, run1.perEdit[0], run1.perEdit[1] && run1.perEdit[1].status, run1.perEdit[2] && run1.perEdit[2].status], [3, null, 'applied', 'refused']);
  /* a marker taken out tidies only its own line; the craft's own indented lines keep their nesting */
  const tagged = '## GENERALIST NOTES\n- Checked the ages [STALE_WORLD_STATE]  now fine\n  - e007: still valid\n    - kept as it was\n';
  const out = lint(tagged, { kind: 'pe' }).text;
  ok('a marker taken out leaves every other line\'s spacing as it was', out.includes('\n  - e007: still valid\n    - kept as it was') && out.includes('- Checked the ages now fine'), JSON.stringify(out));
  /* an event tagged but written with no colon after its tags is tagged */
  eq('an event with tags and no colon is not sent to be tagged', readEvents('## TIMELINE\ne001 [Mon 14 Apr 247, 09:00] [setup] The showcase opened.\n').untagged, []);
  eq('one with no tags still is', readEvents('## TIMELINE\ne001 [Mon 14 Apr 247, 09:00] The showcase opened.\n').untagged, ['e001']);
  eq('and the usual shape reads as before', readEvents('## TIMELINE\ne001 [Mon 14 Apr 247, 09:00] [setup]: The showcase opened.\n').untagged, []);
  /* a streamed thought that is not words is not taken for words */
  eq('a reasoning field that is not text is not read as thinking', readChunk('openai', { choices: [{ delta: { reasoning: { text: 'x' } } }] }), null);
  eq('a reasoning field that is text still is', readChunk('openai', { choices: [{ delta: { reasoning: 'weighing it' } }] }), { text: '', thinking: 'weighing it' });

  /* through the real turn: a change that landed and is repeated in a re-quote is not
   * sent again, so it never comes back as a false \u201cnot done\u201d */
}

/* ============================ the audit, part 3: a backup brings the house setup back (v1.6.3) */
{
  const store = await import('../js/store.js');
  const { fillHouse } = store;
  const saved = { personaFrame: 'You are Eni.', settings: { makerName: 'Eni', yourName: 'Bruce', theme: 'tavern', smoothStreaming: 'off' }, crafts: { worldbook: 'my own keeper' } };
  let r = fillHouse({ settings: { theme: 'hearth', makerName: '', yourName: '' }, personaFrame: '' }, saved);
  eq('on an empty house: the instructions, the names and his own crafts come back', [r.house.personaFrame, r.house.settings.makerName, r.house.settings.yourName, r.house.crafts.worldbook, r.house.settings.smoothStreaming], ['You are Eni.', 'Eni', 'Bruce', 'my own keeper', 'off']);
  eq('a setting this house already has is never replaced', r.house.settings.theme, 'hearth');
  r = fillHouse({ settings: { makerName: 'Iron Man', yourName: '' }, personaFrame: 'You are Iron Man.', crafts: { worldbook: 'mine here' } }, saved);
  eq('nothing he has here is replaced, only what is empty is filled', [r.house.personaFrame, r.house.settings.makerName, r.house.settings.yourName, r.house.crafts.worldbook, r.filled], ['You are Iron Man.', 'Iron Man', 'Bruce', 'mine here', ['the names']]);
  /* through the real store: the file carries the crafts, and bringing it back fills the house on the device */
  const realFetch = globalThis.fetch;
  let houseOnDevice = { settings: { theme: 'hearth', makerName: '', yourName: '' }, connections: [], agentConnections: {}, personaFrame: '', crafts: { auditor: 'my auditor' } };
  const puts = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (v) => new Response(JSON.stringify(v), { status: 200 });
    if (u === '/api/house' && (init.method || 'GET') === 'GET') return json(houseOnDevice);
    if (u === '/api/house' && init.method === 'PUT') { houseOnDevice = JSON.parse(init.body); puts.push('house'); return json({ ok: true }); }
    if (u === '/api/projects') return json({ projects: [] });
    if (u.startsWith('/api/project/') && init.method === 'PUT') { puts.push('world'); return json({ ok: true }); }
    return json({});
  };
  try {
    await store.loadHouse();
    const file = await store.exportEverything();
    eq('the file carries his own crafts', file.house.crafts, { auditor: 'my auditor' });
    const back = await store.restoreEverything({ worlds: [{ title: 'Tide', docs: [], chats: [] }], house: saved });
    eq('bringing it back fills the house on the device, and says what it filled', [houseOnDevice.personaFrame, houseOnDevice.settings.yourName, houseOnDevice.crafts.worldbook, houseOnDevice.crafts.auditor, back.filled.length > 0, puts.includes('house')],
      ['You are Eni.', 'Bruce', 'my own keeper', 'my auditor', true, true]);
  } catch (e) { ok('the backup turns ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
}

/* ============================ SEARCHING THE INTERNET (v1.7.0) */
{
  const S = await import('../js/agents/search.js');
  const { callModel, onKey } = await import('../js/agents/call.js');
  eq('what is asked for: each once, at most three', S.readSearch('<search>Rukia Kuchiki rank</search> and <search>rukia kuchiki rank</search><search>a</search><search>b</search><search>c</search>'), ['Rukia Kuchiki rank', 'a', 'b']);
  eq('and the asking is never left in the words', S.stripSearch('Checking.\n<search>Rukia</search>\nDone.'), 'Checking.\n\nDone.');
  const hermes = { id: 'h1', name: 'Hermes', url: 'http://127.0.0.1:8642/v1', model: 'hermes-agent', key: 'old-key' };
  const front = { id: 'c1', name: 'front', url: 'https://relay.example/v1', model: 'm', key: 'k' };
  eq('who searches: the one he chose, else his Hermes Agent, else nobody', [
    S.searcherFor({ connections: [front, hermes], agentConnections: { searcher: 'c1' } }).id,
    S.searcherFor({ connections: [front, hermes], agentConnections: {} }).id,
    S.searcherFor({ connections: [front], agentConnections: {} })], ['c1', 'h1', null]);
  eq('off unless he turned it on', [S.searchOn({ settings: {} }), S.searchOn({ settings: { searchInternet: 'on' } })], [false, true]);
  const offP = frontBody({ you: 'Bruce', maker: 'Eni', person: 'second' });
  const onP = frontBody({ you: 'Bruce', maker: 'Eni', person: 'second' }, { search: true });
  eq('off, the one he talks to is told nothing about looking things up; on, it is told how', [/<search>|internet|looked up/.test(offP), /<search>/.test(onP)], [false, true]);


  /* a Hermes Agent narrates its tools in the stream; only its words are the answer */
  {
    const { readReply } = await import('../js/agents/call.js');
    const frames = 'event: hermes.tool.progress\ndata: {"toolCallId":"t1","tool":"web_search","label":"searching","status":"running"}\n\n' +
      'data: {"choices":[{"delta":{"content":"Sode no Shirayuki."}}]}\n\n' +
      'event: hermes.tool.progress\ndata: {"toolCallId":"t1","status":"completed","error":"none"}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const res = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frames)); c.close(); } }), { status: 200 });
    const got = await readReply('openai', res);
    eq('a Hermes Agent\'s tool narration is neither the answer nor its failure', [got.text, got.finish], ['Sode no Shirayuki.', 'stop']);
  }

  /* HERMES' KEY FOLLOWS HERMES: a refused key from a Hermes Agent is mended once, from the phone */
  const realFetch = globalThis.fetch;
  const asked = [];
  let keyAsked = 0;
  const heard = [];
  const stop = onKey((id, key) => heard.push([id, key]));
  globalThis.fetch = async (url, init) => {
    if (url === '/api/hermes/key') { keyAsked++; return wholeAnswer({ key: 'new-key' }); }
    const req = JSON.parse(init.body);
    asked.push(req.headers.Authorization);
    return req.headers.Authorization === 'Bearer new-key'
      ? wholeAnswer({ choices: [{ message: { content: 'found it' }, finish_reason: 'stop' }] })
      : wholeAnswer({ error: 'provider', status: 401, detail: 'invalid API key' });
  };
  try {
    const conn = { ...hermes };
    const out = await callModel(conn, { user: 'look', stream: false });
    eq('a refused key from Hermes: the key Hermes accepts is taken, and the call goes again', [out.ok, out.text, asked, conn.key, heard], [true, 'found it', ['Bearer old-key', 'Bearer new-key'], 'new-key', [['h1', 'new-key']]]);
    asked.length = 0; keyAsked = 0;
    const other = await callModel({ ...front, key: 'bad' }, { user: 'x', stream: false });
    eq('any other connection\'s refusal is said as it is, with no key looked for', [other.ok, keyAsked, asked.length], [false, 0, 1]);
  } catch (e) { ok('the key turns ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; stop(); }
}

/* ============================ THE NOTE AT THE END (v1.8.0) */
{
  const { fillHouse } = await import('../js/store.js');
  const filled = fillHouse({ settings: {}, postNote: '' }, { postNote: 'Be warm.' });
  eq('a backup brings the note back where the house has none, never over his', [filled.house.postNote, fillHouse({ settings: {}, postNote: 'mine' }, { postNote: 'Be warm.' }).house.postNote], ['Be warm.', 'mine']);
}

/* ============================ SMOOTH STREAMING: the pace (js/ui/pace.js, v1.6.0) */
{
  const { revealCount, takeChars, PACE_MS } = await import('../js/ui/pace.js');
  eq('nothing waiting, nothing shown', [revealCount(0, 16), revealCount(-5, 16)], [0, 0]);
  eq('at least one character a frame while anything waits, so it always ends', [revealCount(1, 16), revealCount(3, 1)], [1, 1]);
  eq('never more than is waiting', revealCount(10, 900), 10);
  /* a clump of 120 characters at sixty frames a second is spread over several
   * frames, not drawn at once; drawn frame by frame, the clump is all on screen
   * within a few multiples of PACE_MS and never stalls */
  let left = 120, frames = 0, first = 0;
  while (left > 0 && frames < 1000) { const n = revealCount(left, 16); if (!frames) first = n; left -= n; frames++; }
  ok('a clump is spread over several frames', first > 0 && first < 120 && frames >= 6, JSON.stringify({ first, frames }));
  ok('and is all on screen within about four times the pace', frames * 16 <= PACE_MS * 4 + 16, frames * 16);
  /* a model streaming steadily is followed at its own speed: the backlog settles
   * near its rate times the pace, so the words on screen lag it by about PACE_MS */
  let backlog = 0, drawn = 0;
  for (let f = 0; f < 600; f++) { backlog += 6; const n = revealCount(backlog, 16); backlog -= n; drawn += n; }
  ok('a steady stream is followed at its own speed, about PACE_MS behind', backlog <= 6 * (PACE_MS / 16) + 6 && drawn >= 600 * 6 - backlog, JSON.stringify({ backlog, drawn }));
  eq('a long frame (a busy or hidden page) catches up rather than stretching', revealCount(400, 1000), 400);
  eq('a character in two halves is never split', [takeChars('ab\ud83d\ude00cd', 3), takeChars('ab\ud83d\ude00cd', 2), takeChars('abc', 9)], ['ab\ud83d\ude00', 'ab', 'abc']);
}

/* ============================ v2.5: THE LAST AUDIT BEFORE HIS SUBSCRIPTION ENDED
 * Each check runs the real thing. They read what they need from the modules as they
 * find them, so run against an older copy every one of them reports, none of them
 * crashes the suite — that is how each was shown to fail without its fix. */
{
  const run = await import('../js/agents/run.js');
  const editsMod = await import('../js/doc/edits.js');
  const providers = await import('../js/providers.js');
  const callMod = await import('../js/agents/call.js');
  const kit = await import('../js/ui/kit.js');
  const merge = await import('../js/merge.js').catch(() => ({}));
  const store = await import('../js/store.js');
  const { FRONT } = await import('../js/agents/roster.js');
  const has = (m, name) => typeof m[name] === 'function';

  /* — the loss guard: a rebuild is counted, a surgical change is held to the craft's parts — */
  const world = { id: 'p25', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: PE }], chats: [] };
  const emilia = PE.slice(PE.indexOf('### Emilia'), PE.indexOf('## MINOR CHARACTERS'));
  const gone = commit(world, [{ file: 'Plot Essential.md', find: emilia, replace: '', reason: '*delete Emilia' }], 'as you asked');
  ok('*delete takes a person out: a change quoting exactly what it takes out is never refused as a loss',
    !gone.project.docs[0].text.includes('### Emilia') && !gone.guard && gone.cards.some((c) => c.status === 'applied'), gone.guard);
  const two = 'e001 [Mon 14 Apr 247, 09:00] [setup]: The showcase opened in the east hall.\ne002 [Mon 14 Apr 247, 11:30] [decisive]: Alaric\'s arm broke in the third bout.';
  const merged = commit(world, [{ file: 'Plot Essential.md', find: two, replace: 'e001-002 [Mon 14 Apr 247, 09:00] [setup]: The showcase opened; Alaric\'s arm broke in the third bout.', reason: 'one event' }], 'merge');
  ok('two events merged into one line land', !merged.guard && merged.project.docs[0].text.includes('e001-002'), merged.guard);
  const ended = commit(world, [{ file: 'Plot Essential.md', find: '→ Jovan: wary of him (P:30 R:0 S:0)\n', replace: '', reason: 'the bond ended' }], 'bond');
  ok('a bond that ended is taken out', !ended.guard && !ended.project.docs[0].text.includes('wary of him'), ended.guard);
  const rebuilt = commit(world, [{ file: 'Plot Essential.md', whole: true, replace: PE.replace(emilia, '') }], 'rebuild');
  ok('a rebuild that forgets a person is still refused, and says how to take one out on purpose',
    rebuilt.project.docs[0].text.includes('### Emilia') && /would have lost 1 dossiers/.test(rebuilt.guard || '') && /quoting exactly what goes/.test(rebuilt.guard || ''), rebuilt.guard);
  const noScene = commit(world, [{ file: 'Plot Essential.md', find: PE.slice(PE.indexOf('## SCENE')), replace: '' }], 'x');
  ok('no change, surgical or not, takes out what the craft requires', noScene.project.docs[0].text.includes('## SCENE') && /would have taken out the SCENE/.test(noScene.guard || ''), noScene.guard);

  /* — the craft's chore markers, and only them — */
  const story = PE.replace('## SCENE', '## THREADS\nUnresolved tension between the brothers simmers under every council vote.\n\n## SCENE');
  const kept = lint(story, { kind: 'pe', deliverable: true });
  ok('a story line that opens with "Unresolved" is the story, never taken for a note', kept.text.includes('Unresolved tension between the brothers'), kept.found.map((f) => f.said));
  const chores = lint(PE.replace('## SCENE', '## THREADS\nUNRESOLVED: who paid the guard\nUnresolved: the second key\nTBD\nneeds verification: her age\n\n## SCENE'), { kind: 'pe', deliverable: true });
  ok('the craft’s own chore markers still go', !/UNRESOLVED: who|Unresolved: the second|^TBD$|needs verification/m.test(chores.text), chores.text.slice(chores.text.indexOf('## MINOR'), chores.text.indexOf('## SCENE')));

  /* — an empty reply says the provider's own reason — */
  const why = has(run, 'emptyReplyWhy') ? run.emptyReplyWhy : () => '';
  ok('cut for length after only thinking: it ran out of room, and a larger Longest reply gives it room',
    /ran out of room/.test(why({ reason: 'length', thought: true })) && /Longest reply/.test(why({ reason: 'max_tokens', thought: true })), why({ reason: 'length', thought: true }));
  ok('blocked says blocked, with the provider’s own reason', /blocked it \(its reason: content_filter\)/.test(why({ reason: 'content_filter' })) && /blocked/.test(why({ reason: 'BLOCKLIST' })) && /blocked/.test(why({ reason: 'refusal' })));
  ok('an answer that ended with nothing in it gives the reason it gave', /ended the answer with no words in it \(its reason: stop\)/.test(why({ reason: 'stop' })));
  ok('a line that closed with no reason says so, never a guess', /gave no reason/.test(why({})));

  /* — the note at the end on an Anthropic-shaped address — */
  const late = [{ role: 'user', content: 'hi' }, { role: 'system', content: 'NOTE' }];
  const anth = providers.buildRequest({ url: 'https://api.anthropic.com/v1', model: 'claude-x', key: 'k' }, { system: 'S', messages: late });
  ok('on an Anthropic-shaped address the note rides at the end of his message at once — never a system message among the messages, which it refuses',
    anth.body.messages.every((m) => m.role !== 'system') && anth.body.messages[anth.body.messages.length - 1].content.endsWith('NOTE'), anth.body.messages);
  const elsewhere = providers.buildRequest({ url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'k' }, { system: 'S', messages: late });
  ok('elsewhere it stays a system message after his, until a model refuses one', elsewhere.body.messages.some((m, i) => i > 0 && m.role === 'system' && m.content === 'NOTE'));

  /* — an answer sent whole that stopped at its limit is a cut answer, in Anthropic's word too — */
  {
    const before = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'The harbour wall was built by' }], stop_reason: 'max_tokens' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    try {
      const got = await callMod.streamModel({ id: 'ca', url: 'https://api.anthropic.com/v1', model: 'claude-x', key: 'k' }, { system: 'S', messages: [{ role: 'user', content: 'hi' }] });
      ok('an answer sent whole that stopped at its limit is cut, so Go on is offered — in Anthropic’s word (max_tokens) too',
        got.cut === true && got.reason === 'max_tokens' && got.text === 'The harbour wall was built by', got);
    } catch (e) { ok('an answer sent whole that stopped at its limit is cut', false, String((e && e.stack) || e)); } finally { globalThis.fetch = before; }
  }

  /* — what was sent is kept as it went — */
  if (has(callMod, 'snapshotBody')) {
    const engineText = 'E'.repeat(1000);
    const body = { model: 'm', messages: [{ role: 'system', content: engineText }, { role: 'user', content: 'hi' }], thinking: { type: 'enabled', budget_tokens: 100 } };
    const snap = callMod.snapshotBody(body);
    body.messages[1].content = 'changed'; body.messages.push({ role: 'user', content: 'more' }); body.thinking.budget_tokens = 5;
    eq('later changes to a request never reach the record of what was sent', snap, { model: 'm', messages: [{ role: 'system', content: engineText }, { role: 'user', content: 'hi' }], thinking: { type: 'enabled', budget_tokens: 100 } });
  } else ok('later changes to a request never reach the record of what was sent', false, 'no snapshotBody');

  /* — how long it thought — */
  const took = has(kit, 'tookWords') ? kit.tookWords : () => '';
  eq('how long it thought: whole seconds first, never "1m 60s"', [took(119600), took(59400), took(59600), took(61000)], ['2m 0s', '59s', '1m 0s', '1m 1s']);

  /* — a thought written anywhere in a reply is a thought — */
  eq('a thought partway through a reply is not its words', editsMod.ownWords('Here is the plan.\n<thinking>\nshould I add Mira?\n</thinking>\nI added Mira.'), 'Here is the plan.\n\nI added Mira.');
  eq('a tag named inside a sentence is words', editsMod.ownWords('I never write <think> tags in a reply.'), 'I never write <think> tags in a reply.');
  ok('and one shown inside a code fence is words', editsMod.ownWords('The template:\n```\n<think>\n{{thought}}\n</think>\n```\nUse it.').includes('{{thought}}'));
  ok('a thought left open partway through was words after all', editsMod.ownWords('Done.\n<think>\nand then').includes('and then'));

  /* — a reply that ran past its own end — */
  const runaway = has(run, 'endAtRunaway') ? run.endAtRunaway : (t) => t;
  eq('it ends where his label begins', runaway('Added Mira.\n\nBruce said:\nnow make her older', { you: 'Bruce' }), 'Added Mira.');
  eq('or the house’s own note', runaway('Done.\n(From the house, not Bruce — what came of your last reply.)\nok', { you: 'Bruce' }), 'Done.');
  eq('or his own message typed again', runaway('Sure.\nUser: make the harbour older please and add a guard at the gate', { you: 'Bruce', message: 'make the harbour older please and add a guard at the gate' }), 'Sure.');
  eq('his message typed again is found whatever its fortieth character is', runaway('Sure.\nBruce: make the harbour older please and add a guard', { you: 'Bruce', message: 'make the harbour older please and add a guard' }), 'Sure.');
  const scene = 'Rewrote it.\n\n<file name="Scene.md">\nThe hall fell quiet.\nBruce said:\nnothing\n</file>';
  eq('never inside a document it is writing — a story may say "Bruce said:"', runaway(scene, { you: 'Bruce' }), scene);
  eq('and never emptied: a reply that opens by echoing the form is left whole', runaway('Bruce said:\nhello', { you: 'Bruce' }), 'Bruce said:\nhello');

  /* — the conversation window: all of it unless he says, opening on his words, said after the talk — */
  const talk = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'maker' : 'writer', text: `m${i}` }));
  const t60 = talk(60);
  if (has(run, 'talkShown')) {
    eq('nothing set: the whole conversation', [run.talkWindow({ settings: {} }), run.talkShown(t60, 0).shown.length, run.talkShown(t60, 0).left], [0, 60, 0]);
    const w = run.talkShown(t60, 11);
    eq('a window opens on his words: a reply whose message is left out goes with it', [w.shown[0].role, w.shown.length, w.left], ['writer', 10, 50]);
    eq('a number he set is his, under its own name; under six is six; the old name is never read', [run.talkWindow({ settings: { talkWindow: 40 } }), run.talkWindow({ settings: { talkWindow: 3 } }), run.talkWindow({ settings: { turnsOnScreen: 40 } })], [40, 6, 0]);
  } else ok('the conversation window', false, 'no talkShown');
  const msgs = run.makerMessagesFor({ house: { settings: { talkWindow: 10 } }, p: { you: 'Bruce', maker: 'Eni' }, past: t60, world: { docs: [], recentSections: [] }, message: 'build it' });
  const ask = msgs.findIndex((m) => m.content.includes('Bruce said:\nbuild it'));
  ok('the talk opens on his words, and nothing of the house’s is above it', msgs[0].role === 'user' && msgs[0].content === 'm50' && !msgs.slice(0, ask).some((m) => /From the house/.test(m.content)), msgs.slice(0, 2));
  ok('what was left out is said by the house with his message, after the talk', ask > 0 && /began 50 messages before the earliest one above/.test(msgs[ask].content), msgs[ask] && msgs[ask].content.slice(0, 300));
  const all = run.makerMessagesFor({ house: { settings: {} }, p: { you: 'Bruce', maker: 'Eni' }, past: t60, world: { docs: [], recentSections: [] }, message: 'build it' });
  ok('with nothing set, the first message of a long brainstorm is read — and nothing is said to be missing', all[0].content === 'm0' && !all.some((m) => /began \d+ messages/.test(m.content)), all[0]);

  /* — two windows' copies of one world, put together — */
  if (has(merge, 'mergeWorlds')) {
    const B = { id: 'w', title: 'T', docs: [{ id: 'd1', name: 'PE.md', text: 'a' }], chats: [{ id: 'c1', title: 'C', turns: [{ role: 'writer', text: 'hi', at: 1 }] }], openChat: 'c1', updated: 10 };
    const copy = () => JSON.parse(JSON.stringify(B));
    const L = copy(); L.title = 'Mine'; L.chats[0].turns.push({ role: 'writer', text: 'from here', at: 5 });
    const R = copy(); R.docs[0].text = 'b'; R.docs.push({ id: 'd2', name: 'Notes.md', text: 'n' }); R.chats[0].turns.push({ role: 'writer', text: 'from there', at: 4 }); R.updated = 20;
    const m = merge.mergeWorlds(B, L, R);
    eq('two windows’ changes to different things both stand', [m.world.title, m.world.docs.map((d) => d.text), m.conflicts], ['Mine', ['b', 'n'], []]);
    eq('a conversation talked on in both keeps every message of both', m.world.chats[0].turns.map((t) => t.text), ['hi', 'from there', 'from here']);
    eq('the stamp is the later one', m.world.updated, 20);
    const L2 = copy(); L2.docs[0].text = 'mine';
    const R2 = copy(); R2.docs[0].text = 'theirs';
    const m2 = merge.mergeWorlds(B, L2, R2);
    eq('the same thing changed differently: this window’s stands, and the clash is named', [m2.world.docs[0].text, m2.conflicts], ['mine', ['docs[d1].text']]);
    const L3 = copy(); L3.docs = [];
    const R3 = copy(); R3.chats[0].title = 'Renamed';
    eq('a document deleted here and untouched there stays deleted', merge.mergeWorlds(B, L3, R3).world.docs.length, 0);
    const R4 = copy(); R4.docs[0].text = 'changed there';
    eq('one changed there meanwhile is kept', merge.mergeWorlds(B, L3, R4).world.docs.map((d) => d.text), ['changed there']);
    const L5 = copy(); L5.docs.push({ id: 'dx', name: 'Scene.md', text: 'here' });
    const R5 = copy(); R5.docs.push({ id: 'dy', name: 'Scene.md', text: 'there' });
    const m5 = merge.mergeWorlds(B, L5, R5);
    eq('one name is one document: two started under one name keep this window’s, and the clash is named', [m5.world.docs.filter((d) => d.name === 'Scene.md').map((d) => d.text), m5.conflicts.includes('docs[Scene.md]')], [['here'], true]);
    const L6 = copy(); L6.openChat = 'mine';
    eq('where a page is (its open conversation) is never a clash', merge.mergeWorlds(B, L6, copy()).conflicts, []);
    /* a window that lands a reply also marks an older reply's way back too old (capUndo):
     * the other window's new messages are still kept, every one, in the order said */
    const T = { id: 'w', docs: [], chats: [{ id: 'c1', title: 'C', turns: [{ role: 'writer', text: 'q1', at: 10 }, { role: 'maker', text: 'a1', at: 11, batches: [{ id: 'u1', items: [] }] }] }] };
    const tcopy = () => JSON.parse(JSON.stringify(T));
    const TL = tcopy(); TL.chats[0].turns[1].batches[0].tooOld = true; TL.chats[0].turns.push({ role: 'writer', text: 'q2 here', at: 30 }, { role: 'maker', text: 'a2 here', at: 31 });
    const TR = tcopy(); TR.chats[0].turns.push({ role: 'writer', text: 'q2 there', at: 20 }, { role: 'maker', text: 'a2 there', at: 21 });
    const tm = merge.mergeWorlds(T, TL, TR);
    eq('a conversation talked on in two windows, one of them trimming an old way back: every message of both, in the order said, and no clash',
      [tm.world.chats[0].turns.map((t) => t.text), tm.world.chats[0].turns[1].batches[0].tooOld, tm.conflicts], [['q1', 'a1', 'q2 there', 'a2 there', 'q2 here', 'a2 here'], true, []]);
  } else ok('two windows put together', false, 'no merge.js');

  /* — everything in one file: his connections, keys and all; brought back, never doubled — */
  const fromFile = { settings: { turnsOnScreen: 40 }, connections: [{ id: 'cA', name: 'DeepSeek', url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'sk-1' }, { id: 'cB', name: 'Kimi', url: 'https://api.moonshot.ai/v1', model: 'kimi', key: 'sk-2' }], agentConnections: { [FRONT]: 'cA', eye: 'cB' } };
  const back = store.fillHouse({ settings: {}, connections: [{ id: 'cZ', name: 'mine', url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'sk-1' }], agentConnections: {} }, fromFile);
  eq('his connections come back beside his own, never doubled', (back.house.connections || []).map((c) => c.id), ['cZ', 'cB']);
  eq('who rides which comes back, onto the one here when it is the same connection', back.house.agentConnections, { [FRONT]: 'cZ', eye: 'cB' });
  eq('an older file’s 40 is the old default, never his window', [back.house.settings.talkWindow, back.house.settings.turnsOnScreen], [undefined, undefined]);
  eq('his own number from an older file is his window', store.fillHouse({ settings: {} }, { settings: { turnsOnScreen: 60 } }).house.settings.talkWindow, 60);
  const realFetch = globalThis.fetch;
  let dev = { settings: {}, connections: [{ id: 'c1', name: 'good', url: 'http://x/v1', model: 'm', key: 'sk-secret' }], agentConnections: { [FRONT]: 'c1' }, updated: 5 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
    if (u === '/api/house' && (init.method || 'GET') === 'GET') return json(dev);
    if (u === '/api/house' && init.method === 'PUT') { dev = { ...JSON.parse(init.body), updated: (dev.updated || 0) + 1 }; return json({ ok: true, updated: dev.updated }); }
    if (u === '/api/projects') return json({ projects: [] });
    return json({});
  };
  try {
    await store.loadHouse();
    const file = await store.exportEverything();
    eq('the file holds his connections, keys and all, and who rides which', [((file.house || {}).connections || []).map((c) => [c.id, c.key]), (file.house || {}).agentConnections], [[['c1', 'sk-secret']], { [FRONT]: 'c1' }]);
    dev = { settings: { turnsOnScreen: 40, theme: 'hearth' }, connections: [], agentConnections: {} };
    await store.loadHouse();
    eq('the old default 40 is not his: gone on load, and from the device', [store.getHouse().settings.turnsOnScreen, dev.settings.turnsOnScreen, store.getHouse().settings.talkWindow], [undefined, undefined, undefined]);
    dev = { settings: { turnsOnScreen: 24 }, connections: [], agentConnections: {} };
    await store.loadHouse();
    eq('his own number moves to the new name, on the device too', [store.getHouse().settings.talkWindow, dev.settings.talkWindow, 'turnsOnScreen' in dev.settings], [24, 24, false]);
    dev = { settings: { talkWindow: 40 }, connections: [], agentConnections: {} };
    await store.loadHouse();
    eq('a 40 he sets now is his, and stays', [store.getHouse().settings.talkWindow, dev.settings.talkWindow], [40, 40]);
  } catch (e) { ok('the v2.5 house turns ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
}

/* ================================================================ done */

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\nfailed:'); for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }

console.log('\nwhat each worker reads:');
for (const r of REPORT.sort((a, b) => b.chars - a.chars)) {
  console.log(`  ${r.worker.padEnd(14)} ${String(r.chars).padStart(7)} chars  ${String(r.sections).padStart(3)} parts`);
}
console.log(`  ${'the whole craft'.padEnd(14)} ${String(ENGINE.length).padStart(7)} chars  ${String(SECTIONS.size).padStart(3)} parts`);
