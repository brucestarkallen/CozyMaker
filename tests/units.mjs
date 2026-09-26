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
import { route } from '../js/agents/router.js';
import { buildRequest, readAnswer, readChunk, houseOf, alwaysThinks, thinkingFields, thinkingStyle, withoutThinking } from '../js/providers.js';
import { personaOf, greeting, openingFor, voiceMacros, unfilledMacros, framePerson } from '../js/agents/persona.js';
import { upgradeWorld } from '../js/store.js';
import { worldbookToST } from '../js/ui/docs.js';
import { guessKind, kindFor } from '../js/doc/kind.js';
import { when } from '../js/ui/kit.js';
import { callModel } from '../js/agents/call.js';
import { pickConnection } from '../js/agents/roster.js';
import { naturalize, commit, sweep, backstageBrief, capUndo, UNDO_KEPT, frontBody, landTurn, oneVoice, conversationFor, claimsAChange, endAtControlToken, docBriefs, either, WHOLE_LIMIT } from '../js/agents/run.js';

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

/* THE STAND-IN MODEL, AS THE WIRE CARRIES IT. Every call streams now — the
 * crew's as well as the front's — so a stand-in tells them apart by who is
 * asking: the crew's and the listener's instructions open with the house's own
 * frame. A stand-in that answers a worker with one whole JSON body is a
 * provider that ignored "stream", which the house reads too. */
const CREW_MARK = /This is craft work on a piece of fiction|You are the one who listens\./;
function forFront(req) {
  const b = req.body || {};
  const sys = typeof b.system === 'string' ? b.system : ((b.messages || []).find((m) => m.role === 'system') || {}).content || '';
  return Boolean(req.stream) && !CREW_MARK.test(sys);
}
function wholeAnswer(obj) { return new Response(JSON.stringify(obj), { status: 200 }); }
function sseAnswer(lines) {
  const text = lines.map((l) => 'data: ' + (typeof l === 'string' ? l : JSON.stringify(l)) + '\n\n').join('');
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status: 200 });
}

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
ok('the scribe is handed the auto-fix mandate', sliceFor(SECTIONS, 'scribe').text.includes('The Auto-Fix Mandate'));
ok('the scribe is NOT handed the cleanup workflow', !sliceFor(SECTIONS, 'scribe').text.includes('THE CLEANUP WORKFLOW'));
ok('the compressor is handed the compression techniques', sliceFor(SECTIONS, 'compressor').text.includes('Sequential Aggregation'));
ok('the compressor is NOT handed the skip workflow', !sliceFor(SECTIONS, 'compressor').text.includes('THE SKIP WORKFLOW'));
/* the alert list is known by its own heading and words, not by one alert's name
 * (that name is also used in 1.2, 2.3, 2.7, 7.7 and 13.6, which others read) */
const ALERTS = SECTIONS.get('12').text;
ok('the eye is handed the alert list', sliceFor(SECTIONS, 'eye').text.includes(ALERTS));
ok('the builder is NOT handed the alert list', !sliceFor(SECTIONS, 'builder').text.includes(ALERTS));

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
  const b = sliceFor(SECTIONS, 'builder').text;
  ok('the builder holds its own pre-delivery gate: the Verification Engine, Tier A, the CBPA, the Core Mandates',
    b.includes(SECTIONS.get('7.3').text) && b.includes(SECTIONS.get('2.4').text) && b.includes(SECTIONS.get('7.2').text) && b.includes(SECTIONS.get('1.1').text));
}

const REPORT = sliceReport(SECTIONS);
const biggest = Math.max(...REPORT.map((r) => r.chars));
ok('nobody carries the whole craft', biggest < ENGINE.length * 0.5, `biggest slice ${biggest} of ${ENGINE.length}`);

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

/* ============================================================ the router */

eq('a written command is obeyed', route('*optimize 3').map((r) => r.worker), ['compressor']);
eq('describing a world is brainstorming, not a build', route('here is my world: a drowned city of guild-houses').map((r) => r.worker), []);
eq('asking for the plot essential builds it', route('okay, make the plot essential from all that').map((r) => r.worker), ['builder']);
eq('plain words find the chronicler', route('fold all of that into the plot essential please').map((r) => r.worker), ['chronicler']);
eq('plain words find the editor', route('change Claire\'s age to 15').map((r) => r.worker), ['editor']);
eq('plain words find the showrunner', route('this has got convoluted, can you untangle it').map((r) => r.worker), ['showrunner']);
eq('plain words find the eye', route('are there any contradictions in this').map((r) => r.worker), ['eye']);
eq('plain words find the novelist', route('I want the siege to happen before the wedding').map((r) => r.worker), ['novelist']);
eq('plain words find the diagnostician', route('why did the storyteller say Claire already knew').map((r) => r.worker), ['diagnostician']);
eq('two asks in one sentence go to two workers',
  route('add dual affinity to Ivar and audit the ception').map((r) => r.worker), ['editor', 'scribe']);
eq('just talking sends nobody', route('hey'), []);
eq('a thank you sends nobody', route('thanks, that is lovely'), []);
eq('an opinion question sends nobody', route('what do you think of that name?'), []);
eq('a long message with nothing built yet is still only talk',
  route('x'.repeat(200), { hasPlotEssential: false }).map((r) => r.worker), []);
eq('a long description with something already built sends nobody',
  route('x'.repeat(200), { hasPlotEssential: true }), []);

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
  frontBody(personaOf({ settings: { makerName: 'Eni', yourName: 'Bruce', person: 'first' } }))).includes('Bruce only ever talks to me.'));

/* THE FIREWALL: nothing the front reads may carry the craft's machinery. */
const FRONT_TEXT = openingFor(p, frontBody(p));
ok('the front of the house is given no bracketed markers', !/\[[A-Z][A-Z0-9_]{4,}\]/.test(FRONT_TEXT));
ok('the front of the house is given no section numbers', !/§|\bsection \d/i.test(FRONT_TEXT));
ok('the front of the house is given no way to edit', !FRONT_TEXT.includes('<edits>'));
ok('the front of the house is given no command words', !/\*new|\*continuity|#q\b/.test(FRONT_TEXT));
ok('the front of the house is small', FRONT_TEXT.length < 2500, `${FRONT_TEXT.length} chars`);

eq('a marker never reaches the front', naturalize('Fixed it [PARROT_FIX] per M5 section 8.3'), 'Fixed it per');
ok('plain words survive untouched', naturalize('Claire is sixteen now.') === 'Claire is sixteen now.');

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

const swept = sweep(project);
ok('the sweep repairs what it can', !swept.project.docs[0].text.includes('[EPISTEMIC_VIOLATION]'));
ok('the sweep reports what it repaired', swept.repaired.length > 0);
ok('the sweep hands the rest to a worker', swept.handOver.some((h) => h.worker === 'chronicler'));
ok('what is handed over names the document', swept.handOver.every((h) => /Plot Essential\.md/.test(h.said)));

const told = backstageBrief(
  [{ worker: 'editor', notes: 'Changed her age [PARROT_FIX] per M5.' }],
  [{ status: 'applied', name: 'Plot Essential.md', reason: 'her age' },
   { status: 'refused', name: 'Plot Essential.md', why: 'those words appear twice' }], p);
ok('the front is told in plain words', !/\[[A-Z_]+\]/.test(told), told);
ok('the front is told what changed', told.includes('Plot Essential.md (1 change)'));
ok('the front is told what did not', /Not done/.test(told));

ok('a token count is roughly right', Math.abs(estimateTokens('a'.repeat(400)) - 100) <= 1);

/* ============ the faults the other two frontends already paid for ======== */

/* A question is somebody thinking out loud. Answering it is the front of the
 * house's work, not a worker's. */
for (const talk of [
  'does that make her too similar to Aldric?',
  'do you think the world is too big',
  'is she too similar to the other one?',
  'should we cut some of the subplots?',
  'what would you call a city like that?',
  'how many characters do we have now?',
  'why is the timeline like that',
  'that makes sense to me',
  'can you explain why you did it that way',
]) eq(`asking, not telling: ${talk}`, route(talk).map((r) => r.worker), []);

/* …but manners are not a question. */
eq('manners do not hide an instruction', route("can you change Claire's age to 15").map((r) => r.worker), ['editor']);
eq('politeness at the front is stripped', route('could you please fold all that into the plot essential').map((r) => r.worker), ['chronicler']);
/* …and some jobs ARE questions by nature. */
eq('a question that is its own job still lands', route('why did the storyteller say Claire already knew').map((r) => r.worker), ['diagnostician']);
eq('asking for a check still lands', route('are there any contradictions in this').map((r) => r.worker), ['eye']);
eq('asking whether it holds up still lands', route('does this make sense').map((r) => r.worker), ['eye']);

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
ok('a stray tag never reaches the front', !/<edits|<need/.test(naturalize('done <edits> [ half a block')));

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

/* --- A BUILD, THROUGH THE REAL TURN: the plain form lands, and one left open is carried on --- */
{
  const { runTurn, fileLeftOpen } = await import('../js/agents/run.js');
  const PE = '# PLOT ESSENTIAL — The Leviathan Quarter — V1.0\n\n## WORLD\n### Rules\n- The city lives inside a dormant leviathan.\n\n## SCENE\nWHERE: the Ribway / LAST: "Hold the rope," Mira said.';
  const house = { connections: [{ id: 'c1', url: 'https://relay.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: { yourName: 'Bruce' }, personaFrame: '' };
  const empty = () => ({ id: 'pb', docs: [], chats: [], recentSections: [] });
  let builder = () => '';
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    if (forFront(req)) {
      const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Built.' } }] }) + '\n\ndata: [DONE]\n\n';
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    }
    const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
    const msgs = req.body.messages.filter((m) => m.role !== 'system');
    asked.push(msgs[msgs.length - 1].content);
    const out = /PROACTIVE CO-WRITER/.test(sys) ? builder(msgs) : 'Read it all back; nothing else needed changing.';
    return new Response(JSON.stringify({ choices: [{ message: { content: out }, finish_reason: 'stop' }] }), { status: 200 });
  };
  try {
    builder = () => 'I built it from everything you said.\n\n<file name="Plot Essential.md">\n' + PE + '\n</file>';
    let r = await runTurn({ house, project: empty(), message: 'Build the plot essential now.', forceWorker: 'builder' });
    const doc = r.project.docs.find((d) => d.name === 'Plot Essential.md');
    eq('a build written plainly lands whole, bare quotes and all', [doc && doc.text, doc && doc.kind], [PE, 'pe']);
    ok('the build is a change he can put back', r.batches.length >= 1 && r.cards.some((c) => c.status === 'applied' && c.how === 'started it'));

    asked.length = 0;
    builder = (msgs) => (msgs.length === 1 ? 'Here it is.\n\n<file name="Plot Essential.md">\n' + PE.slice(0, 60) : PE.slice(60) + '\n</file>');
    r = await runTurn({ house, project: empty(), message: 'Build the plot essential now.', forceWorker: 'builder' });
    const doc2 = r.project.docs.find((d) => d.name === 'Plot Essential.md');
    ok('a document left open is carried on, not asked for again from nothing', asked.includes(fileLeftOpen('Plot Essential.md')), JSON.stringify(asked.slice(0, 3)).slice(0, 300));
    eq('and it lands whole once finished', doc2 && doc2.text, PE);

    builder = (msgs) => (msgs.length === 1 ? 'I wrote it all.\n<file name="Plot Essential.md">\n' + PE + '\n' : '');
    r = await runTurn({ house, project: empty(), message: 'Build the plot essential now.', forceWorker: 'builder' });
    ok('a document never finished is never written', !r.project.docs.length, JSON.stringify(r.project.docs.map((d) => d.name)));
    ok('and he is told plainly, on a card', r.cards.some((c) => c.status === 'refused' && /cut off before it finished/.test(c.why || '')), JSON.stringify(r.cards));
  } catch (e) { ok('the whole-turn build tests ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
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
  const swept = sweep(made.project, new Set(['Eni.md']), new Map());
  eq('and the plot essential checks never touch it (its TBD line and its empty heading stay)', swept.project.docs[0].text, HIS);
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

/* --- each document goes to the one who knows it --- */
{
  const pick = (m) => route(m).map((r) => r.worker).join(',');
  eq('*audit is the memory auditor', pick('*audit'), 'auditor');
  eq('*cleanup aimed at the transplant is the auditor, not the showrunner', pick('*cleanup the transplant'), 'auditor');
  eq('*cleanup aimed at the worldbook is the worldbook keeper', pick('*cleanup the worldbook'), 'worldbook');
  eq('*cleanup on its own is still the showrunner', pick('*cleanup'), 'showrunner');
  eq('asking for a worldbook entry sends the worldbook keeper', pick('add an entry for Aldric to the worldbook'), 'worldbook');
  eq('a question about the worldbook is talk', pick('what is in the worldbook?'), '');
  const { craftFor, DEFAULT_INSTRUCTIONS_CRAFT, setCraftForTests } = await import('../js/engine/crafts.js');
  eq('the instructions writer works his way when he has set one', await craftFor('instructions', { instructionsCraft: 'Mine.' }), 'Mine.');
  eq('and by the default when he has not', await craftFor('instructions', {}), DEFAULT_INSTRUCTIONS_CRAFT);
  const fetched = [];
  const fakeFetch = async (u) => { fetched.push(u); return { ok: true, text: async () => 'WORLDBOOK CRAFT' }; };
  eq('the worldbook keeper reads its craft file', await craftFor('worldbook', {}, fakeFetch), 'WORLDBOOK CRAFT');
  eq('from the engine folder', fetched[0], '/engine/worldbook-maker.md');
  eq('a worker with no craft of its own reads its slice', await craftFor('editor', {}), null);
  const wb = (await import('node:fs')).readFileSync(new URL('../engine/worldbook-maker.md', import.meta.url), 'utf8');
  ok('the worldbook craft is the extension\'s, with its block called by this house\'s name', wb.includes('YOU OWN EVERY FIELD') && wb.includes('edits block') && !wb.includes('docedits'));
  const d = parseEdits('<docedits>[{"find":"a","replace":"b"}]</docedits>');
  ok('a block written in the extension\'s name is read all the same', d.edits.length === 1, JSON.stringify(d));
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
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) locate(big, 'a sentence that is not in the document at all, anywhere, in any form');
  const ms = (performance.now() - t0) / 20;
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

/* --- a bare yes runs what was just offered --- */
{
  const { confirmsOffer, offersIn } = await import('../js/agents/router.js');
  for (const y of ['yes', 'Yes please', 'do it', 'go ahead', 'sure, go ahead!', 'yep. do it']) ok(`"${y}" is a yes`, confirmsOffer(y));
  for (const n of ['no', 'yes, and make her older', 'yes but not the timeline', 'what do you think?']) ok(`"${n}" is not a bare yes`, !confirmsOffer(n));
  eq('the offer in a reply is found', offersIn("That's a lovely thought. Want me to fold that into the plot essential?").join('|'), 'fold that into the plot essential');
  eq('"should I" is an offer too', offersIn('Should I move the scene to the Quay?').join('|'), 'move the scene to the Quay');
  eq('"I can\'t" is not', offersIn("I can't see a timeline yet.").join('|'), '');
  eq('an offer phrased as a question still names its job', route('move the scene to the Quay', { asStatement: true }).map((r) => r.worker).join(), 'editor');
}

/* --- the front's text in each voice is grammar, not pronoun swaps --- */
{
  const first = openingFor(personaOf({ settings: { makerName: 'Eni', yourName: 'Bruce', person: 'first' }, personaFrame: 'I am {{char}}.' }),
    frontBody(personaOf({ settings: { makerName: 'Eni', yourName: 'Bruce', person: 'first' } })));
  ok('first person: "Bruce and I", "talks to me", "as myself"', first.includes('Bruce and I are building') && first.includes('Bruce only ever talks to me.') && first.includes('as myself'), first.slice(0, 300));
  ok('first person: no "talks to I", no "I and", no you or yourself anywhere', !/talks to I\b|\bI and |\byou\b|\byour(self)?\b/i.test(first.replace(/^I am Eni\.\s*/, '')), (first.match(/talks to I\b|\bI and |\byou\b|\byour(self)?\b/i) || [''])[0]);
  const second = frontBody(personaOf({ settings: { yourName: 'Bruce' } }));
  ok('second person reads as it always did', second.includes('You and Bruce are building') && second.includes('Bruce only ever talks to you.'));
  const nobody = frontBody(personaOf({ settings: { person: 'first' } }));
  ok('first person with no names still reads as sentences', nobody.startsWith('The two of us are building') && nobody.includes('The person I am making this with only ever talks to me.') && !/undefined|null/.test(nobody), nobody.slice(0, 120));
}

/* --- every voice, named and not, reads as grammar a person would write --- */
{
  const BROKEN = /talks to I\b|behind I\b|\bI and\b|\bYou and they\b|\bThey and I\b|\bto I\b|documents yourself|\bI never edit\b.*yourself|\bundefined\b|\bnull\b|\$\{/;
  for (const [person, maker, you] of [['first', 'Eni', 'Bruce'], ['first', '', ''], ['you', 'Eni', 'Bruce'], ['you', '', ''], ['first', 'Eni', ''], ['you', '', 'Bruce']]) {
    const pp = personaOf({ settings: { person, makerName: maker, yourName: you } });
    const text = openingFor(pp, frontBody(pp));
    const bad = BROKEN.exec(text);
    ok(`${person}, ${maker || 'no maker'}, ${you || 'no name'}: no broken grammar`, !bad, bad && text.slice(Math.max(0, bad.index - 50), bad.index + 50));
    ok(`${person}, ${maker || 'no maker'}, ${you || 'no name'}: says a decision waits on him`, /cannot go further until/.test(text));
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

/* --- what the persona is told about who said what: the whole turn, on the wire --- */
{
  const { runTurn, GO_ON, FRONT_ONLY } = await import('../js/agents/run.js');
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    if (forFront(req)) {
      sent.push(req.body);
      const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Mm.' } }] }) + '\n\ndata: [DONE]\n\n';
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    }
    return wholeAnswer({ choices: [{ message: { content: 'fine' }, finish_reason: 'stop' }] });
  };
  const world = { id: 'pn', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: '# PE\n\n## SCENE\nWHERE: the Ribway\n' }], chats: [], recentSections: [] };
  const conn = [{ id: 'c1', url: 'https://relay.example/v1', model: 'm', key: 'k' }];
  const last = () => { const b = sent[sent.length - 1]; return b.messages[b.messages.length - 1].content; };
  try {
    await runTurn({ house: { connections: conn, agentConnections: {}, settings: {}, personaFrame: 'You are a quiet archivist.' }, project: world, message: 'hi there, lovely evening' });
    ok('with no name set, his words are never labelled "you said"', !/\byou said:/i.test(last()) && /What was just said to you:\nhi there, lovely evening$/.test(last()), last().slice(-120));
    await runTurn({ house: { connections: conn, agentConnections: {}, settings: { yourName: 'Bruce' }, personaFrame: '' }, project: world, message: 'hi there, lovely evening' });
    ok('with his name set, his words are under his name', /Bruce said:\nhi there, lovely evening$/.test(last()), last().slice(-80));
    const history = [{ role: 'writer', text: 'tell me about the harbour', at: 1 }, { role: 'maker', text: 'The harbour wall was built by the', at: 2, cut: true }];
    await runTurn({ house: { connections: conn, agentConnections: {}, settings: { yourName: 'Bruce' }, personaFrame: '' }, project: world, history, message: GO_ON, forceWorker: FRONT_ONLY });
    ok('Go on is the house\'s note, never put in his mouth', last().endsWith(GO_ON) && !/Bruce said:/.test(last()), last().slice(-200));
    ok('Go on carries on from the reply that was cut, which comes just before it', sent[sent.length - 1].messages.some((m) => m.role === 'assistant' && /built by the$/.test(m.content)));
  } finally { globalThis.fetch = realFetch; }
}

/* --- A STORY CARD (*card): the whole paste is one job for the builder, framed as *new --- */
{
  const { isStoryCard, storyCardTask } = await import('../js/agents/router.js');
  const { writtenCommand } = await import('../js/agents/router.js');
  const CARD = 'Her Highness Needs A Minute\n\nIn public: flawless. In private: a disaster. You saw. You\'re hired.\n\nYou are hereby appointed Special Liaison to the Crown. Your job: clean up her messes before the court sees them.\n\nOpening: The door slams. "Close it," she hisses. "Now."';
  const r = route('*card\n\n' + CARD, { hasPlotEssential: false, hasDocs: false });
  eq('a story card is one job, for the builder — never a worker per paragraph', r.map((x) => x.worker), ['builder']);
  eq('even in a world with documents, where "clean up her messes" once sent the showrunner too',
    route('*card\n\n' + CARD, { hasPlotEssential: true, hasDocs: true }).map((x) => x.worker), ['builder']);
  ok('and the builder is given the whole card, every paragraph', r[0] && r[0].about.includes('clean up her messes') && r[0].about.endsWith('"Close it," she hisses. "Now."'), r[0] && r[0].about.slice(-80));
  ok('framed as the craft\'s *new, reading the card as a blueprint', r[0] && /the craft's \*new, reading the card as a blueprint \(the Blueprint Ingestion Protocol in 7\.1\)/.test(r[0].about));
  ok('with his leave to add what makes it more immersive, and never to stop and ask', r[0] && /add whatever makes it more immersive/.test(r[0].about) && /do not stop to ask/.test(r[0].about));
  const said = route('I play Jovan, 24, a disgraced knight.\n*card\n' + CARD, { hasPlotEssential: true, hasDocs: true });
  ok('what he says before the card travels with it', said.length === 1 && /What he said with it:\nI play Jovan, 24, a disgraced knight\./.test(said[0].about));
  eq('it is a written command: the listener is not asked', [writtenCommand('*card ' + CARD), isStoryCard('*CARD x'), isStoryCard('a card game')], [true, true, false]);
  ok('a bare *card still reaches the builder, which asks for the card', /ask him to paste the story card/.test(storyCardTask('')));
}

/* --- a story card, through the real turn --- */
{
  const { runTurn } = await import('../js/agents/run.js');
  const { LISTENER_MARK } = await import('../js/agents/listener.js');
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
    const user = (req.body.messages.filter((m) => m.role === 'user').pop() || {}).content || '';
    if (forFront(req)) { seen.push(['front', user]); return sseAnswer([{ choices: [{ delta: { content: 'It is built.' }, finish_reason: 'stop' }] }, '[DONE]']); }
    const who = sys.includes(LISTENER_MARK) ? 'listener' : /PROACTIVE CO-WRITER/.test(sys) ? 'builder' : 'worker';
    seen.push([who, user]);
    const out = who === 'builder'
      ? 'Built it from the card. I added a calendar, the palace, and named the steward.\n<file name="Plot Essential.md">\n# PLOT ESSENTIAL — Her Highness Needs A Minute — V1.0\n\n## SCENE\nWHERE: the Rose Antechamber\nLAST: "Close it," she hisses. "Now."\n</file>'
      : 'Read it all back.';
    return wholeAnswer({ choices: [{ message: { content: out }, finish_reason: 'stop' }] });
  };
  try {
    const house = { connections: [{ id: 'c1', url: 'https://relay.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: { yourName: 'Bruce' }, personaFrame: '' };
    const r = await runTurn({ house, project: { id: 'pcard', title: 'A new world', docs: [], chats: [], recentSections: [] },
      message: '*card\nHer Highness Needs A Minute\n\nIn public: flawless. In private: a disaster.\n\nYour job: clean up her messes.\n\nOpening: "Close it," she hisses. "Now."' });
    const builder = seen.find(([w]) => w === 'builder');
    eq('a story card goes straight to the builder: no listener, no other worker', seen.filter(([w]) => w !== 'front' && w !== 'worker').map(([w]) => w), ['builder']);
    ok('the builder is told what the job is, and given the whole card as he pasted it',
      builder && /What the author just asked for:\nBuild a plot essential from a story card/.test(builder[1]) && /The card, as he pasted it:\nHer Highness Needs A Minute/.test(builder[1]) && /Your job: clean up her messes\./.test(builder[1]));
    ok('and the plot essential lands, ready', r.project.docs.some((d) => d.name === 'Plot Essential.md' && /Rose Antechamber/.test(d.text)));
  } catch (e) { ok('the story-card turn ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
}

/* --- his everyday phrases reach the right one --- */
{
  const pick = (m) => route(m).map((r) => r.worker).join(',');
  eq('"Claire is 17 now, not 16" is a correction', pick('Claire is 17 now, not 16'), 'editor');
  eq('"her age should be 17, not 16" too', pick('her age should be 17, not 16'), 'editor');
  eq('"Claire is sad now" with no correction is talk', pick('Claire is sad now'), '');
  eq('a what-if about a change is a question, not a change', pick('would that move Claire to the city?'), '');
  eq('"can you" is still a request', pick("can you change Claire's age to fifteen"), 'editor');
  eq('"could we" is too', pick('could we move the scene to the Quay?'), 'editor');
  eq('whether the story can reach somewhere goes to the novelist', pick('can the story realistically reach a war by chapter ten?'), 'novelist');
  /* "build it", with no plot essential yet, is the ask to build one */
  const fresh = (m) => route(m, { hasPlotEssential: false, hasDocs: false }).map((r) => r.worker).join(',');
  for (const m of ['ok build it', "let's build it!", 'go ahead and build it', 'build the world from what we said', 'write it up', 'can you build it?', 'yes, build it', 'create the world now'])
    eq(`"${m}" in a new world builds it`, fresh(m), 'builder');
  for (const m of ['the guild would build it into the tides', 'make it darker', 'build it around the lighthouse', 'how would you build it?', 'maybe build it later', 'write it in first person'])
    eq(`"${m}" in a new world is still talk`, fresh(m), '');
  eq('with a plot essential already there, "build it" is left to the listener', route('ok build it', { hasPlotEssential: true, hasDocs: true }).length, 0);
  eq('"turn this into a plot essential" builds, whatever is there', pick('turn this into a plot essential'), 'builder');
  eq('and so does "how do we get to the wedding"', pick('how do we get to the wedding without rushing it?'), 'novelist');
}

/* --- a failure, said the way the persona can say it --- */
{
  const { plainFailure } = await import('../js/agents/run.js');
  eq('a refused key', plainFailure('the call did not go through — 401 Incorrect API key provided: sk-abc'), 'the connection turned the key away');
  eq('a busy provider', plainFailure('429 Too Many Requests'), 'the provider is too busy right now');
  eq('no answer', plainFailure('transport: timed out'), 'the provider did not answer');
  eq('too long', plainFailure("This model's maximum context length is 8192 tokens"), "the documents were too long for this connection's model");
}

/* --- THE PERSONA HEARS ONLY THE STORY: every kind of turn, through the real pipeline --- */
{
  const { runTurn } = await import('../js/agents/run.js');
  const { setCraftForTests } = await import('../js/engine/crafts.js');
  setCraftForTests('auditor', 'AUDITOR CRAFT');
  const persona = 'You are {{char}}, a quiet archivist who loves old maps. {{user}} is your oldest friend.';
  const house = { connections: [{ id: 'c1', url: 'https://relay.example/v1', model: 'm', key: 'k' }], agentConnections: {},
    settings: { makerName: 'Eni', yourName: 'Bruce', person: 'second' }, personaFrame: persona };
  const PE = '# PLOT ESSENTIAL — Harbour — V1.0\n\n## WORLD\n### Rules\n- The city lives inside a dormant leviathan.\n\n## SCENE\nWHERE: the Ribway\n';
  const world = () => ({ id: 'pw', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: PE }], chats: [], recentSections: [] });
  const edit = (find, to) => 'Moved it.\n\n<edits>\n' + JSON.stringify([{ file: 'Plot Essential.md', find, replace: to, reason: 'moved the scene' }]) + '\n</edits>';
  let answer = () => 'Read it all back; nothing else needed changing.';
  const fronts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    if (forFront(req)) {
      fronts.push(req.body);
      const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'All right.' } }] }) + '\n\ndata: [DONE]\n\n';
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    }
    const user = (req.body.messages.find((m) => m.role === 'user') || {}).content || '';
    const out = answer(user);
    return wholeAnswer(typeof out === 'string' ? { choices: [{ message: { content: out }, finish_reason: 'stop' }] } : out);
  };
  const MACHINERY = /\bTiers? [ABC]\b|\bProtocol \d+\b|\bCBPA\b|Named-Person Gate|Disease Scan|Stale-Assumption|Mechanical Audit|Verification Engine|Anti-Parrot|Auto-Fix Mandate|Deliverable Purity|RELS Gate|MC Exclusion|<\/?(?:edits|docedits|need)>|replace_all|\bthe (?:builder|chronicler|scribe|editor|eye|showrunner|compressor|novelist|diagnostician|worldbook keeper|memory auditor|instructions writer)\b|\bworkers?\b|\bcrew\b|backstage|people working behind|\bslice\b|§|\bM-[A-Z]{3,}\b|\bapi\b|\b40[13]\b|sk-abc|set aside as a draft|\bdraft\b|\bJSON\b|\bcraft\b|could not finish/i;
  const heard = () => { const b = fronts[fronts.length - 1]; return [b.messages.map((m) => m.content).join('\n')].join('\n'); };
  const check = (name) => {
    const b = fronts[fronts.length - 1];
    const sys = (b.messages.find((m) => m.role === 'system') || {}).content || '';
    const all = b.messages.map((m) => m.content).join('\n');
    ok(`${name}: the persona leads, word for word, names filled in`, sys.startsWith('You are Eni, a quiet archivist who loves old maps. Bruce is your oldest friend.'), sys.slice(0, 90));
    const leak = MACHINERY.exec(all);
    ok(`${name}: nothing the persona hears names the machinery`, !leak, leak && all.slice(Math.max(0, leak.index - 60), leak.index + 60));
  };
  try {
    fronts.length = 0;
    await runTurn({ house, project: world(), message: 'what do you think of the harbour so far?' });
    check('talk');
    ok('talk: nothing is said to have changed', !/What got done/.test(heard()));

    answer = (user) => (/What the author just asked for/.test(user) ? edit('WHERE: the Ribway', 'WHERE: the Quay') : 'Read it all back; nothing else needed changing.');
    let r = await runTurn({ house, project: world(), message: '*edit move the scene to the Quay' });
    check('a change');
    ok('a change: the persona is told what changed, by document', /Changed: Plot Essential\.md \(1 change\)/.test(heard()) && /WHERE: the Quay/.test(r.project.docs[0].text));

    answer = (user) => (/What the author just asked for/.test(user) ? { error: 'provider', status: 401, detail: 'Incorrect API key provided: sk-abc' } : 'fine');
    r = await runTurn({ house, project: world(), message: '*edit move the scene to the Quay' });
    check('a failure');
    ok('a failure: said plainly to the persona', /Something could not be done this time: the connection turned the key away\./.test(heard()));
    ok('a failure: the exact reason is on a card for him', r.cards.some((c) => c.failure && /401|API key/i.test(c.why)));

    answer = (user) => (/What the author just asked for|could not be placed/.test(user) ? edit('WHERE: the Ribwayy', 'WHERE: the Quay') : 'fine');
    r = await runTurn({ house, project: world(), message: '*edit move the scene to the Quay' });
    check('a quote that never fit');
    ok('a quote that never fit: said plainly as not done', /Not done: Plot Essential\.md — those words are not in the document as written/.test(heard()));

    answer = (user) => (/What the author just asked for/.test(user)
      ? 'Plan:\n<edits>[{"file":"Plot Essential.md","find":"WHERE: the Ribway","replace":"WHERE: the Quay"}]</edits>\nFinal:\n' + edit('WHERE: the Ribway', 'WHERE: the Quay') : 'fine');
    r = await runTurn({ house, project: world(), message: '*edit move the scene to the Quay' });
    check('a draft on the page');
    ok('a draft on the page: no card says something went wrong', !r.cards.some((c) => c.status === 'refused'), JSON.stringify(r.cards.map((c) => c.why)));

    /* a worker that reports in the craft's own names for its checks, which every worker now reads (v1.2.4) */
    answer = (user) => (/What the author just asked for/.test(user)
      ? 'Moved it, per Protocol 20. Tier A passed; Named-Person Gate clean; Disease Scan on ages clean; CBPA on the request; Anti-Parrot pass done; RELS Gate held; Verification Engine run.\n\n<edits>\n' + JSON.stringify([{ file: 'Plot Essential.md', find: 'WHERE: the Ribway', replace: 'WHERE: the Quay', reason: 'moved the scene' }]) + '\n</edits>'
      : 'Read it all back. Tier A/B checks clean; Mechanical Audit clean; Deliverable Purity Test passed.');
    await runTurn({ house, project: world(), message: '*edit move the scene to the Quay' });
    check('a worker who names its checks');

    answer = () => 'M-SCAN read every block. M-RECORD holds. The ledger for Claire is sound.';
    const sc = { id: 'pw', docs: [{ id: 'd2', name: 'Harbour transplant.md', kind: 'transplant', text: '<!-- SC-TRANSPLANT {"v":1} -->' }], chats: [], recentSections: [] };
    await runTurn({ house, project: sc, message: '*audit Harbour transplant.md', forceWorker: 'auditor' });
    check('an audit');

    answer = (user) => (/What the author just asked for/.test(user) ? edit('WHERE: the Ribway', 'WHERE: the Quay') : 'fine');
    const history = [{ role: 'writer', text: 'the Ribway feels wrong for this scene', at: 1 },
      { role: 'maker', text: "It does feel cramped. Want me to move the scene to the Quay?", at: 2 }];
    r = await runTurn({ house, project: world(), history, message: 'yes' });
    check('a yes');
    ok('a yes: runs what was offered, and the change lands', /WHERE: the Quay/.test(r.project.docs[0].text), r.project.docs[0].text.slice(-30));
    ok('a yes: the persona is told it changed', /Changed: Plot Essential\.md/.test(heard()));
    const moved = [{ role: 'maker', text: 'Want me to move the scene to the Quay?', at: 2 }, { role: 'writer', text: 'hmm, let me think', at: 3 }];
    r = await runTurn({ house, project: world(), history: moved, message: 'yes' });
    ok('a yes after he has moved on does not reach back to an older offer', /WHERE: the Ribway/.test(r.project.docs[0].text), r.project.docs[0].text.slice(-30));

    /* a report he asked for is the answer; a read-back he did not ask for is aside */
    answer = () => 'Claire is 16 in one event and 17 in the next. The harbour wall is built twice.';
    await runTurn({ house, project: world(), message: 'Check Plot Essential.md for anything wrong', forceWorker: 'eye' });
    check('a check he asked for');
    ok('a check he asked for: its findings reach the persona as the answer to give',
      /What came back on what Bruce asked for \(the answer to give Bruce, all of it that matters\):\nClaire is 16 in one event and 17 in the next\. The harbour wall is built twice\./.test(heard()), heard().slice(-400));
    answer = (user) => (/What the author just asked for/.test(user) ? edit('WHERE: the Ribway', 'WHERE: the Quay') : 'Read every line back: the harbour wall is built twice.');
    /* real work (not a one-field edit, which the craft reads with its required scan only) is read back afterwards */
    await runTurn({ house, project: world(), message: 'Tidy up Plot Essential.md.', forceWorker: 'showrunner' });
    ok('a read-back he did not ask for is set aside, to mention only if it matters',
      /Read back afterwards, without being asked \(mention it only if it matters\):\nRead every line back: the harbour wall is built twice\./.test(heard()), heard().slice(-400));

    /* a re-quote that repeats a change which already landed: one honest "not done", and no repeated note */
    answer = (user) => (/What the author just asked for|could not be placed/.test(user)
      ? 'Moved it.\n<edits>' + JSON.stringify([{ file: 'Plot Essential.md', find: 'WHERE: the Ribway', replace: 'WHERE: the Quay' },
        { file: 'Plot Essential.md', find: 'a line that is not there', replace: 'x' }]) + '</edits>' : 'fine');
    r = await runTurn({ house, project: world(), message: '*edit move the scene to the Quay' });
    check('a re-quote that repeats itself');
    ok('a re-quote that repeats a landed change: that change is not refused afterwards',
      r.cards.filter((c) => c.status === 'refused').length === 1 && r.cards.filter((c) => c.status === 'applied').length === 1, JSON.stringify(r.cards.map((c) => [c.status, c.why])));
    ok('and its words reach the persona once', (heard().match(/Moved it\./g) || []).length === 1, heard().slice(-300));
  } finally { globalThis.fetch = realFetch; }
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
  for (const person of ['second', 'first']) {
    const body = frontBody({ you: 'Bruce', maker: 'Eni', person });
    ok(`${person} person: a report he asked for is the answer to give`, /what came back is the answer/.test(body) && /all of it that matters/.test(body), body);
    ok(`${person} person: no rule left that cuts his report to one or two things`, !/one or two things/.test(body), body);
  }
  eq('the engine\'s command words reach the persona as plain words', naturalize('Ran *cleanup, then #q and (*audit) — see *optimize.'), 'Ran cleanup, then q and (audit) — see optimize.');
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
    ok('and no connections or keys', !('connections' in (b.house || {})) && !JSON.stringify(b).includes('"key"'));
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

/* ================================================ the listener (v1.1.5) */

{
  const { readJobs, listenerPrompt, listenerReading, LISTENER_MARK } = await import('../js/agents/listener.js');
  const { runTurn, versionOf, readAsk, jobFor } = await import('../js/agents/run.js');

  /* --- reading its answer --- */
  eq('a plain answer is read', readJobs('{"jobs":[{"worker":"editor","task":"Make Mira twenty."}]}').jobs, [{ worker: 'editor', task: 'Make Mira twenty.', resumes: false }]);
  eq('fenced and with a trailing comma, still read', readJobs('```json\n{"jobs":[{"worker":"the Editor","task":"x",},]}\n```').jobs.map((j) => j.worker), ['editor']);
  eq('nothing to do is an answer too', readJobs('{"jobs": []}'), { ok: true, jobs: [], clear: [], delete: [] });
  eq('a document to clear and one to delete are read by name', readJobs('{"jobs": [], "clear": ["Plot Essential.md"], "delete": "Notes.md"}'), { ok: true, jobs: [], clear: ['Plot Essential.md'], delete: ['Notes.md'] });
  ok('prose is not an answer', !readJobs('I think the editor should do it.').ok);
  ok('someone who is not on the crew is not an answer', !readJobs('{"jobs":[{"worker":"storyteller","task":"x"}]}').ok);
  ok('the listener cannot send itself', !readJobs('{"jobs":[{"worker":"listener","task":"x"}]}').ok);
  eq('two jobs for one worker become one job, both parts kept', readJobs('{"jobs":[{"worker":"editor","task":"a"},{"worker":"editor","task":"b"}]}').jobs, [{ worker: 'editor', task: 'a\n\nAnd: b', resumes: false }]);
  eq('an answer written after its thinking is still read', readJobs('<think>hmm</think>{"jobs":[{"worker":"eye","task":"check"}]}').jobs.map((j) => j.worker), ['eye']);

  /* --- what it reads --- */
  const reading = listenerReading(SECTIONS);
  ok('it reads the craft\'s own law on reading a request (7.6), and only that: a short reading answers fast', /Command Parsing \(Free-Form Input\)/.test(reading) && !/11 · COMMANDS/.test(reading) && reading.length < 4000, String(reading.length));
  const pr = listenerPrompt({ frame: 'FRAME', reading, docs: [{ name: 'Plot Essential.md', kind: 'pe', text: PE }], talk: 'Bruce: hello', open: [{ worker: 'showrunner', ask: 'Cut the north arc? Yes or no.' }], message: 'yes', p: { you: 'Bruce', maker: 'Eni' } });
  ok('it is told who does what, with the craft\'s commands that are theirs', /- showrunner: .*\*cleanup, #prune/.test(pr.system) && /- editor: .*\*edit/.test(pr.system), pr.system.slice(-900));
  ok('it sees what is waiting on him, word for word', pr.user.includes('The showrunner put this to him and is waiting for his answer:\nCut the north arc? Yes or no.'));
  ok('it sees the documents by name and section, never their text', pr.user.includes('Plot Essential.md — the plot essential: ') && !pr.user.includes('Majority is sixteen.'), pr.user.slice(0, 200));
  ok('what he just said comes last', pr.user.endsWith('What Bruce just said:\nyes'));

  /* --- the ask a worker leaves, and the craft's own marker --- */
  eq('an ask is taken out of the notes', readAsk('I read it all.\n<ask>Cut the north arc?</ask>'), { ask: 'Cut the north arc?', rest: 'I read it all.' });
  eq('an ask cut off at the end is still an ask', readAsk('Notes.\n<ask>Cut the north arc? Or keep').ask, 'Cut the north arc? Or keep');
  const back = jobFor({ worker: 'showrunner', task: 'He approved only the safe cuts.', resumes: true }, [{ worker: 'showrunner', ask: 'MANIFEST: cut A, reshape B.' }], 'only the safe ones', { you: 'Bruce' });
  ok('his answer goes back with what was asked, word for word, and his own words', back.about === 'He approved only the safe cuts.\n\nWhat you put to Bruce last time, word for word:\nMANIFEST: cut A, reshape B.\n\nWhat Bruce said back:\nonly the safe ones', back.about);
  ok('a job that answers nothing gets its task alone', jobFor({ worker: 'editor', task: 'Make Mira twenty.', resumes: false }, [{ worker: 'showrunner', ask: 'x' }], 'y', {}).about === 'Make Mira twenty.');
  eq('a kept version keeps what it asked', versionOf({ text: 't', asks: [{ worker: 'showrunner', ask: 'x' }] }).asks, [{ worker: 'showrunner', ask: 'x' }]);

  /* --- whole turns, on the wire --- */
  const calls = [];
  let listenerSays = () => 'not sure';
  let workerSays = () => 'Read it all back; nothing else needed changing.';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    if (forFront(req)) {
      calls.push({ who: 'front', url: req.url, body: req.body });
      const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Mm.' } }] }) + '\n\ndata: [DONE]\n\n';
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    }
    const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
    const user = (req.body.messages.find((m) => m.role === 'user') || {}).content || '';
    const who = sys.includes(LISTENER_MARK) ? 'listener' : 'worker';
    calls.push({ who, url: req.url, sys, user });
    const out = who === 'listener' ? listenerSays(user) : workerSays(user, sys);
    return wholeAnswer({ choices: [{ message: { content: out }, finish_reason: 'stop' }] });
  };
  const house = { connections: [{ id: 'c1', url: 'https://one.example/v1', model: 'm', key: 'k' }, { id: 'c2', url: 'https://two.example/v1', model: 'm2', key: 'k' }],
    agentConnections: {}, settings: { makerName: 'Eni', yourName: 'Bruce' }, personaFrame: 'You are Eni.' };
  const PE1 = '# PLOT ESSENTIAL — Harbour — V1.0\n\n## WORLD\n### Rules\n- The city lives inside a dormant leviathan.\n\n## SCENE\nWHERE: the Ribway\n';
  const world = () => ({ id: 'pl', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: PE1 }], chats: [], recentSections: [] });
  const heard = () => { const f = calls.filter((c) => c.who === 'front').pop(); return f.body.messages[f.body.messages.length - 1].content; };
  const listened = () => calls.filter((c) => c.who === 'listener');
  const edit = (find, to) => 'Done.\n<edits>' + JSON.stringify([{ file: 'Plot Essential.md', find, replace: to, reason: 'x' }]) + '</edits>';
  try {
    /* words no keyword table knows */
    const plain = 'the kingdom deserves a second moon, pale and slow';
    ok('the old keyword reading sends nobody for it (why the listener exists)', route(plain).length === 0);
    listenerSays = () => '{"jobs":[{"worker":"editor","task":"Add to the world\'s rules: the kingdom has a second moon, pale and slow."}]}';
    workerSays = (user) => (/What the author just asked for:\nAdd to the world's rules/.test(user) ? 'Added.\n<edits>' + JSON.stringify([{ file: 'Plot Essential.md', insert_after: '- The city lives inside a dormant leviathan.', replace: '- A second moon, pale and slow, crosses the sky.', reason: 'his world' }]) + '</edits>' : 'Read it all back.');
    let r = await runTurn({ house, project: world(), message: plain });
    ok('the listener sends the right one, and the change lands', /A second moon, pale and slow/.test(r.project.docs[0].text), r.project.docs[0].text);
    ok('the persona is told it changed', /Changed: Plot Essential\.md/.test(heard()), heard().slice(-300));
    ok('the listener heard the conversation and the craft, not the documents\' text', listened().length === 1 && /Command Parsing/.test(listened()[0].sys) && !listened()[0].user.includes('dormant leviathan'), listened()[0].user.slice(0, 200));

    /* nothing readable from the listener: the old reading, so a turn never fails because of it */
    calls.length = 0;
    listenerSays = () => 'hm, hard to say';
    workerSays = (user) => (/What the author just asked for/.test(user) ? edit('WHERE: the Ribway', 'WHERE: the Quay') : 'fine');
    r = await runTurn({ house, project: world(), message: 'move the scene to the Quay' });
    ok('an unreadable listener falls back to the old reading, and the change still lands', /WHERE: the Quay/.test(r.project.docs[0].text), r.project.docs[0].text.slice(-40));

    /* a listener that decides it is talk: nothing runs, and the persona is told nothing changed */
    calls.length = 0;
    listenerSays = () => '{"jobs": []}';
    r = await runTurn({ house, project: world(), message: 'move the scene to the Quay, maybe? not sure yet' });
    ok('talk sends nobody', calls.filter((c) => c.who === 'worker').length === 0 && r.project.docs[0].text === PE1);
    ok('and the persona hears of no change', !/Changed:/.test(heard()));

    /* written commands and greetings never wait on the listener */
    calls.length = 0;
    workerSays = (user) => (/What the author just asked for/.test(user) ? edit('WHERE: the Ribway', 'WHERE: the Quay') : 'fine');
    await runTurn({ house, project: world(), message: '*edit move the scene to the Quay' });
    ok('a written command goes straight to its worker', listened().length === 0 && calls.some((c) => c.who === 'worker'));
    calls.length = 0;
    await runTurn({ house, project: world(), message: 'thanks!' });
    ok('a thank-you with nothing waiting asks nobody', listened().length === 0 && calls.filter((c) => c.who === 'worker').length === 0);
    calls.length = 0;
    listenerSays = () => '{"jobs": []}';
    await runTurn({ house, project: world(), message: 'sure' });
    ok('"sure" is heard by the listener: after an offer it is the answer', listened().length === 1);

    /* the listener rides its own connection when he gives it one */
    calls.length = 0;
    await runTurn({ house: { ...house, agentConnections: { listener: 'c2' } }, project: world(), message: 'what a lovely harbour' });
    ok('the listener rides its own connection', listened().length === 1 && listened()[0].url.startsWith('https://two.example'), listened()[0] && listened()[0].url);
    ok('and the front keeps the front\'s', calls.filter((c) => c.who === 'front').every((c) => c.url.startsWith('https://one.example')));

    /* THE ROUND TRIP: a worker that needs his say, his answer, the same worker again */
    calls.length = 0;
    const MANIFEST = 'Cleanup plan: cut the duplicated harbour rule; reshape nothing else. Approve all, or only the safe cuts?';
    /* only the showrunner asks; the eye that reads back afterwards just reads */
    workerSays = (user, sys) => (!/THE CLEANUP WORKFLOW/.test(sys) ? 'Read it all back.'
      : /What you put to Bruce last time, word for word:/.test(user)
        ? edit('- The city lives inside a dormant leviathan.', '- The city lives inside a leviathan that is dormant, not dead.')
        : `I read the whole plot essential.\n<ask>${MANIFEST}</ask>`);
    r = await runTurn({ house, project: world(), message: 'Tidy up Plot Essential.md.', forceWorker: 'showrunner' });
    ok('a worker that waits on him is kept on the turn, word for word', r.asks.length === 1 && r.asks[0].worker === 'showrunner' && r.asks[0].ask === MANIFEST, JSON.stringify(r.asks));
    ok('nothing changed while it waits', r.project.docs[0].text === PE1);
    ok('the persona is told to put all of it to him', heard().includes('Still to decide') && heard().includes(MANIFEST) && heard().includes('cannot go further until Bruce decides'), heard().slice(-400));
    const history = [{ role: 'writer', text: 'Tidy up Plot Essential.md.', at: 1 }, { role: 'maker', text: 'Here is the plan — all of it, or only the safe cuts?', at: 2, asks: r.asks }];
    calls.length = 0;
    listenerSays = (user) => (user.includes(MANIFEST) ? '{"jobs":[{"worker":"showrunner","task":"Bruce approved only the safe cuts.","resumes":true}]}' : '{"jobs":[]}');
    r = await runTurn({ house, project: world(), history, message: 'only the safe cuts, go' });
    const sr = calls.find((c) => c.who === 'worker' && /THE CLEANUP WORKFLOW/.test(c.sys));
    ok('his answer reaches the same worker with its own plan, word for word, and his words', sr && sr.user.includes(`What you put to Bruce last time, word for word:\n${MANIFEST}`) && sr.user.includes('What Bruce said back:\nonly the safe cuts, go'), sr && sr.user.slice(-400));
    ok('and the approved change lands', /dormant, not dead/.test(r.project.docs[0].text), r.project.docs[0].text);
    ok('once answered, nothing is waiting any more', r.asks.length === 0);

    /* a worker that follows the craft's own marker instead of the tag */
    calls.length = 0;
    workerSays = () => 'CLEANUP MANIFEST\nNOISE — REMOVE (1): the duplicated rule. [PERMISSION_REQUEST]';
    r = await runTurn({ house, project: world(), message: 'Tidy up Plot Essential.md.', forceWorker: 'showrunner' });
    ok('the craft\'s own permission marker is read as waiting on him', r.asks.length === 1 && /NOISE — REMOVE/.test(r.asks[0].ask));

    /* the craft's #prune has a home */
    eq('#prune goes to the showrunner', route('#prune the minor characters').map((x) => x.worker), ['showrunner']);
  } finally { globalThis.fetch = realFetch; }
}

/* ============================ long work: a hang guard, and cut answers (v1.1.6) */

{
  const { joinSeam, CARRY_ON, runTurn, plainFailure } = await import('../js/agents/run.js');
  const call = await import('../js/agents/call.js');

  eq('a seam where the carry-on starts a little way back is joined once', joinSeam('the harbour wall was built by the guild', 'built by the guild in the flood year'), 'the harbour wall was built by the guild in the flood year');
  eq('a clean seam is joined as it is', joinSeam('{"find":"WHERE: the Rib', 'way"}'), '{"find":"WHERE: the Ribway"}');
  eq('a tiny accidental overlap is not taken for a restart', joinSeam('abc the', 'the end'), 'abc thethe end');

  /* a worker's answer cut at its limit is carried on, and the change lands whole */
  const bodies = [];
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    if (forFront(req)) {
      const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Mm.' } }] }) + '\n\ndata: [DONE]\n\n';
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    }
    const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
    let content = 'Read it all back.';
    let finish = 'stop';
    if (/Edit Mode Discipline/.test(sys)) {
      bodies.push(req.body);
      n++;
      if (n === 1) { content = 'Moved it.\n<edits>[{"file":"Plot Essential.md","find":"WHERE: the Rib'; finish = 'length'; }
      else content = 'way","replace":"WHERE: the Quay","reason":"he asked"}]</edits>';
    }
    /* the way a provider streams it: the words in pieces, the reason it stopped on the last */
    const half = Math.ceil(content.length / 2);
    return sseAnswer([{ choices: [{ delta: { content: content.slice(0, half) } }] }, { choices: [{ delta: { content: content.slice(half) }, finish_reason: finish }] }, '[DONE]']);
  };
  try {
    const house = { connections: [{ id: 'c1', url: 'https://one.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: { yourName: 'Bruce' }, personaFrame: '' };
    const world = { id: 'pc', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: '# PE\n\n## SCENE\nWHERE: the Ribway\n' }], chats: [], recentSections: [] };
    const r = await runTurn({ house, project: world, message: '*edit move the scene to the Quay' });
    ok('an answer cut at its limit is carried on, and the change lands whole', /WHERE: the Quay/.test(r.project.docs[0].text) && !r.cards.some((c) => c.status === 'refused'), r.project.docs[0].text + JSON.stringify(r.cards));
    const second = bodies[1] && bodies[1].messages.filter((m) => m.role !== 'system');
    ok('the worker is shown what it wrote and asked only for the rest', second && second.length === 3 && second[1].role === 'assistant' &&
      second[1].content.endsWith('WHERE: the Rib') && second[2].content === CARRY_ON, JSON.stringify(second && second.map((m) => m.role)));
    ok('the same job is not asked for again from the start', bodies.length === 2, `${bodies.length} calls`);
  } finally { globalThis.fetch = realFetch; }

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

/* ============================ THE CREW'S CALLS STREAM, AND EVERY SHAPE OF ANSWER IS READ */
{
  const call = await import('../js/agents/call.js');
  const { runTurn } = await import('../js/agents/run.js');
  const conn = { url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'k' };
  const realFetch = globalThis.fetch;
  let script = [];
  const specs = [];
  globalThis.fetch = async (url, init) => { specs.push(JSON.parse(init.body)); const next = script.shift(); return typeof next === 'function' ? next() : next; };
  try {
    /* a worker's call is streamed, words and thinking each on their own channel */
    const seen = [];
    script = [() => sseAnswer([{ choices: [{ delta: { reasoning_content: 'Let me see. ' } }] }, { choices: [{ delta: { content: 'I built ' } }] },
      { choices: [{ delta: { content: 'it whole.' }, finish_reason: 'stop' }] }, '[DONE]'])];
    let r = await call.callModel(conn, { user: 'x', onProgress: (p) => seen.push(p.text) });
    eq('a worker\'s call goes out streamed', [specs[0].stream, specs[0].body.stream], [true, true]);
    eq('its words and its thinking come back apart', [r.ok, r.text, r.thinking, r.finish], [true, 'I built it whole.', 'Let me see. ', 'stop']);
    ok('how far along it is was told as it arrived', seen.length >= 1 && seen[seen.length - 1] === 'I built it whole.', JSON.stringify(seen));

    script = [() => sseAnswer([{ choices: [{ delta: { content: 'half a docu' }, finish_reason: 'length' }] }, '[DONE]'])];
    r = await call.callModel(conn, { user: 'x' });
    eq('an answer cut at its limit says so', [r.text, r.finish], ['half a docu', 'length']);

    /* the device's word that the provider refused comes as one JSON object, not a stream */
    script = [wholeAnswer({ error: 'provider', status: 401, detail: 'Incorrect API key provided' })];
    let t0 = Date.now();
    r = await call.callModel(conn, { user: 'x' });
    ok('a refusal is read from a streamed call, and a bad key is not waited on', !r.ok && /Incorrect API key/.test(r.error) && Date.now() - t0 < 1500, JSON.stringify(r));

    /* a provider that ignored "stream" and answered in one piece */
    script = [wholeAnswer({ choices: [{ message: { content: 'all at once', reasoning_content: 'thought' }, finish_reason: 'stop' }] })];
    r = await call.callModel(conn, { user: 'x' });
    eq('a provider that answered in one piece is read too', [r.ok, r.text, r.thinking], [true, 'all at once', 'thought']);

    /* an error in the middle of a stream is an error, and a passing one is tried again */
    script = [() => sseAnswer([{ choices: [{ delta: { content: 'I bu' } }] }, { error: { message: 'Overloaded, try again', type: 'overloaded_error' } }]),
      () => sseAnswer([{ choices: [{ delta: { content: 'I built it.' }, finish_reason: 'stop' }] }, '[DONE]'])];
    t0 = Date.now();
    r = await call.callModel(conn, { user: 'x' });
    eq('an error mid-stream is never taken for a finished answer: it is asked again whole', [r.ok, r.text], [true, 'I built it.']);
    script = [() => sseAnswer([{ choices: [{ delta: { content: 'I bu' } }] }, { error: { message: 'content policy', code: 400 } }])];
    r = await call.callModel(conn, { user: 'x' });
    ok('a mid-stream refusal that waiting cannot fix is said, not retried', !r.ok && /content policy/.test(r.error), JSON.stringify(r));
    script = [() => sseAnswer([{ choices: [{ delta: { content: 'I bu' } }] }, { error: { message: 'the reasoning went wrong in the middle' } }])];
    t0 = Date.now();
    const thinker = { url: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'k', thinking: 'high' };
    r = await call.callModel(thinker, { user: 'x' });
    ok('an uncoded error mid-answer is said once, at once — not retried as a lost connection', !r.ok && Date.now() - t0 < 1500 && script.length === 0, `${Date.now() - t0}ms`);
    ok('and it teaches the house nothing about thinking: the request itself was taken', !thinker.learned, JSON.stringify(thinker.learned));

    /* a stream that ended having said nothing, and never said it was done */
    script = [() => new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }),
      () => sseAnswer([{ choices: [{ delta: { content: 'there now' }, finish_reason: 'stop' }] }, '[DONE]'])];
    r = await call.callModel(conn, { user: 'x' });
    eq('a stream that ended before anything came is asked again', [r.ok, r.text], [true, 'there now']);
    script = [() => sseAnswer([{ choices: [{ delta: { role: 'assistant' } }] }]),
      () => sseAnswer([{ choices: [{ delta: { content: 'there now' }, finish_reason: 'stop' }] }, '[DONE]'])];
    r = await call.callModel(conn, { user: 'x' });
    eq('a stream that opened, said nothing and dropped is asked again', [r.ok, r.text], [true, 'there now']);
    script = [() => sseAnswer([{ choices: [{ delta: { role: 'assistant' }, finish_reason: 'stop' }] }, '[DONE]'])];
    r = await call.callModel(conn, { user: 'x' });
    eq('but one that said it was done with nothing is an empty answer, for the worker to judge', [r.ok, r.text], [true, '']);

    /* Claude's own stream shape */
    script = [() => sseAnswer([{ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Claude ' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'wrote this' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, { type: 'message_stop' }])];
    r = await call.callModel({ url: 'https://api.anthropic.com', model: 'claude-x', key: 'k' }, { user: 'x' });
    eq('Claude\'s stream is read the same way, its cut included', [r.text, r.thinking, r.finish], ['Claude wrote this', 'hm', 'length']);

    /* "Try it" asks all at once: only a whole answer reports its thinking tokens */
    specs.length = 0;
    script = [wholeAnswer({ choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }], usage: { completion_tokens_details: { reasoning_tokens: 120 } } })];
    const tried = await call.testConnection({ id: 'x', url: 'https://api.openai.com/v1', model: 'o3', key: 'k', thinking: 'high' });
    ok('"Try it" asks all at once, and still hears thinking the address keeps to itself', specs[0] && !specs[0].stream && !specs[0].body.stream && tried.thinks && tried.hidden, JSON.stringify([specs[0] && specs[0].stream, tried]));

    /* the front: a provider that ignored "stream" used to reach him as an empty reply */
    script = [wholeAnswer({ choices: [{ message: { content: 'The harbour wall was paid for by the guild.' }, finish_reason: 'stop' }] })];
    const said = [];
    const front = await call.streamModel(conn, { system: 's', messages: [{ role: 'user', content: 'q' }], onText: (t) => said.push(t) });
    eq('the front reads a whole answer too, and shows it', [front.text, said.join('')], ['The harbour wall was paid for by the guild.', 'The harbour wall was paid for by the guild.']);

    /* a reply the provider breaks off partway is kept as cut — never passed off as finished */
    script = [() => sseAnswer([{ choices: [{ delta: { content: 'The harbour wall was paid for by' } }] }, { error: { message: 'upstream went away', code: 502 } }])];
    const broken = await call.streamModel(conn, { system: 's', messages: [{ role: 'user', content: 'q' }] });
    eq('a reply the provider breaks off partway is kept as cut, by the provider', [broken.text, broken.cut, broken.cutBy], ['The harbour wall was paid for by', true, 'provider']);
    script = [() => sseAnswer([{ choices: [{ delta: { content: 'Whole.' }, finish_reason: 'length' }] }, '[DONE]'])];
    const long = await call.streamModel(conn, { system: 's', messages: [{ role: 'user', content: 'q' }] });
    eq('one cut at its limit is still cut, and not blamed on the provider', [long.cut, long.cutBy], [true, undefined]);
    globalThis.fetch = async (url, init) => {
      const req = JSON.parse(init.body);
      if (forFront(req)) return sseAnswer([{ choices: [{ delta: { content: 'It was paid for by the' } }] }, { error: { message: 'upstream went away', code: 502 } }]);
      return wholeAnswer({ choices: [{ message: { content: '{"jobs":[]}' }, finish_reason: 'stop' }] });
    };
    const turn = await runTurn({ house: { connections: [{ id: 'c1', url: 'https://relay.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: {}, personaFrame: '' },
      project: { id: 'pc2', docs: [], chats: [], recentSections: [] }, message: 'who paid for the harbour wall?' });
    eq('through the real turn: the reply is kept, cut, with the reason, and no failure', [turn.reply, turn.cut, turn.cutBy, turn.error], ['It was paid for by the', true, 'provider', null]);

    /* the status line: who is on what, and how far along, through the real turn */
    const statuses = [];
    globalThis.fetch = async (url, init) => {
      const req = JSON.parse(init.body);
      if (forFront(req)) return sseAnswer([{ choices: [{ delta: { content: 'Built.' } }] }, '[DONE]']);
      const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
      if (/PROACTIVE CO-WRITER/.test(sys)) {
        const words = '<file name="Plot Essential.md">\n# PLOT ESSENTIAL — Tide — V1.0\n\n## SCENE\nWHERE: the salt flats, where the tide decides who rules\n</file>';
        return sseAnswer([{ choices: [{ delta: { content: 'I built it. ' } }] }, { choices: [{ delta: { content: words }, finish_reason: 'stop' }] }, '[DONE]']);
      }
      return sseAnswer([{ choices: [{ delta: { content: 'Read it all back.' }, finish_reason: 'stop' }] }, '[DONE]']);
    };
    const out = await runTurn({ house: { connections: [{ id: 'c1', url: 'https://relay.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: {}, personaFrame: '' },
      project: { id: 'ps', docs: [], chats: [], recentSections: [] }, message: 'build it', forceWorker: 'builder', onStatus: (label, detail) => statuses.push([label, detail || '']) });
    ok('the build still lands, streamed', out.project.docs.some((d) => /the tide decides who rules/.test(d.text)), JSON.stringify(out.project.docs.map((d) => d.name)));
    ok('the status says who is on it, with how far along beside it', statuses.some(([l, d]) => l === 'the builder is on it' && /^\d[\d,]* words so far$/.test(d)), JSON.stringify(statuses));
    ok('and the words-so-far never replaces the label', !statuses.some(([l]) => /words so far/.test(l)));
  } catch (e) { ok('the streaming tests ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
}

/* ============================ THE READ-BACK CHECKS WHAT CHANGED; THE MODEL HE TALKS TO DECIDES WHO WORKS */
{
  const { runTurn } = await import('../js/agents/run.js');
  const { LISTENER_MARK } = await import('../js/agents/listener.js');
  const realFetch = globalThis.fetch;
  const sent = [];
  let chronicler = '';
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
    const user = (req.body.messages.filter((m) => m.role === 'user').pop() || {}).content || '';
    const who = forFront(req) ? 'front' : sys.includes(LISTENER_MARK) ? 'listener' : /Evidenced CLEAN vs False CLEAN/.test(sys) ? 'eye' : /PROACTIVE CO-WRITER/.test(sys) ? 'builder' : 'worker';
    sent.push({ who, url: req.url, user, sys });
    if (who === 'front') return sseAnswer([{ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }, '[DONE]']);
    if (who === 'listener') return wholeAnswer({ choices: [{ message: { content: '{"jobs":[{"worker":"chronicler","task":"Add that the courier packet is still in transit."}]}' }, finish_reason: 'stop' }] });
    if (who === 'builder') return wholeAnswer({ choices: [{ message: { content: 'Built.\n<file name="Plot Essential.md">\n# PLOT ESSENTIAL — Soul Society — V1.0\n\n## SCENE\nWHERE: the 1st Division\n</file>' }, finish_reason: 'stop' }] });
    if (who === 'eye') return wholeAnswer({ choices: [{ message: { content: 'Checked it; it holds.' }, finish_reason: 'stop' }] });
    return wholeAnswer({ choices: [{ message: { content: chronicler }, finish_reason: 'stop' }] });
  };
  try {
    const house = { connections: [{ id: 'c1', url: 'https://front.example/v1', model: 'the-smart-one', key: 'k' }, { id: 'c2', url: 'https://crew.example/v1', model: 'the-cheap-one', key: 'k' }],
      agentConnections: { keeper: 'c1', _general: 'c2' }, settings: { yourName: 'Bruce' }, personaFrame: '' };
    const world = () => ({ id: 'prb', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: '# PLOT ESSENTIAL — Soul Society — V1.0\n\n## TIMELINE\ne005 [Fri 3rd of Hanami] [setup]: Shunsui appointed Jovan.\n\n## SCENE\nWHERE: the 1st Division\n' }], chats: [], recentSections: [] });
    chronicler = 'Added the packet.\n<edits>[{"file":"Plot Essential.md","insert_after":"e005 [Fri 3rd of Hanami] [setup]: Shunsui appointed Jovan.","replace":"e006 [Sun 5th of Hanami] [setup]: The courier packet had not reached the 13th or 2nd Division desks.","reason":"the packet in transit"}]</edits>';
    await runTurn({ house, project: world(), message: 'so maybe we should add that the documents are still with the courier' });
    const listener = sent.find((s) => s.who === 'listener');
    const worker = sent.find((s) => s.who === 'worker');
    eq('the one who decides who works rides the model he talks to, not the crew\'s', [listener && new URL(listener.url).host, worker && new URL(worker.url).host], ['front.example', 'crew.example']);
    const eye = sent.find((s) => s.who === 'eye');
    ok('the read-back is handed this turn\'s changes, as they now read', eye && /Check these changes, and what they touch:\n- Plot Essential\.md: put it under/.test(eye.user) && /now reads: e006 \[Sun 5th of Hanami\] \[setup\]: The courier packet had not reached/.test(eye.user), eye && eye.user.slice(0, 400));
    ok('and told to leave everything else exactly as it is — never the whole book, front to back', eye && /Leave everything else exactly as it is/.test(eye.user) && /change nothing for it/.test(eye.user) && !/front to back/.test(eye.user));
    ok('the words a change replaced are marked as gone, never to be quoted', eye && /was \(gone from the document \u2014 never quote it\)/.test(eye.user) || !/was:/.test(eye.user));
    ok('the crew is told never to drop a fact by removing a "repeat"', worker && /Never remove a passage as a repeat of another unless every fact in it is stated in the one that stays/.test(worker.sys));
    const front = sent.filter((s) => s.who === 'front').pop();
    ok('the persona has a place to think that he never sees', front && /think inside <think> and <\/think> before you answer/.test(front.sys));
    sent.length = 0;
    await runTurn({ house, project: { id: 'pnew', docs: [], chats: [], recentSections: [] }, message: '*new build it', forceWorker: 'builder' });
    const eye2 = sent.find((s) => s.who === 'eye');
    ok('after a build the read-back reads the new document through', eye2 && /A document was written whole this turn: read that one through\./.test(eye2.user));
  } catch (e) { ok('the read-back tests ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
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
  eq('a change that only moves spacing is no change', applyEdit('WHERE: the  Ribway\nLAST: x', { find: 'WHERE: the  Ribway', replace: 'WHERE: the Ribway' }).why, 'only the spacing would change');

  const { runTurn } = await import('../js/agents/run.js');
  const { LISTENER_MARK } = await import('../js/agents/listener.js');
  const realFetch = globalThis.fetch;
  const asked = [];
  let round = 0;
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
    const user = (req.body.messages.filter((m) => m.role === 'user').pop() || {}).content || '';
    if (forFront(req)) return sseAnswer([{ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }, '[DONE]']);
    if (sys.includes(LISTENER_MARK)) return wholeAnswer({ choices: [{ message: { content: '{"jobs":[{"worker":"editor","task":"Add the packet."}]}' }, finish_reason: 'stop' }] });
    asked.push({ user, sys });
    round++;
    const out = round === 1
      ? 'Done.\n<edits>' + JSON.stringify([
        { file: 'Plot Essential.md', append: true, replace: 'e005 [Friday 3rd of Hanami, 1001 AG, 09:00] [POLITICAL]: Shunsui appointed Jovan.', reason: 'already there' },
        { file: 'Plot Essential.md', find: 'WHERE: the 1st  Division', replace: 'WHERE: the 1st Division', reason: 'no change' },
        { file: 'Plot Essential.md', replace: 'something with no instruction', reason: 'shapeless' },
      ]) + '</edits>'
      : 'Left it out.';
    return wholeAnswer({ choices: [{ message: { content: out }, finish_reason: 'stop' }] });
  };
  try {
    const house = { connections: [{ id: 'c1', url: 'https://relay.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: { yourName: 'Bruce' }, personaFrame: '' };
    const doc = '# PLOT ESSENTIAL — Soul Society — V1.0\n\n## TIMELINE\ne005 [Friday 3rd of Hanami, 1001 AG, 09:00] [POLITICAL]: Shunsui appointed Jovan.\n\n## SCENE\nWHERE: the 1st  Division\n';
    const r = await runTurn({ house, project: { id: 'pn', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: doc }], chats: [], recentSections: [] }, message: 'add that Shunsui appointed Jovan' });
    eq('what is already there, and a spacing-only change, reach him as no card at all', r.cards.filter((c) => /already in the document|only the spacing/.test(c.why || '')).length, 0);
    ok('a change with nothing saying what to do goes back to the worker once, not to him', asked.length === 2 && /a change came with nothing saying what to do/.test(asked[1].user), asked.map((a) => a.user.slice(0, 80)).join(' | '));
    ok('and the document is exactly as it was', r.project.docs[0].text === doc);
    ok('the crew is told: one fact in one place, nothing invented, and a missing date-time assigned as its craft says', /Write each fact once, in the place the document keeps it/.test(asked[0].sys) && /Never invent a fact the documents do not hold or plainly imply\. A missing date-time is the one your craft assigns/.test(asked[0].sys));
  } catch (e) { ok('the noise-card tests ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
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

/* ============================ A THOUGHT WRITTEN INTO THE REPLY IS THINKING, NOT THE REPLY */
{
  const call = await import('../js/agents/call.js');
  const { runTurn } = await import('../js/agents/run.js');
  const { LISTENER_MARK } = await import('../js/agents/listener.js');
  const conn = { url: 'https://neuralwatt.example/v1', model: 'glm', key: 'k' };
  const realFetch = globalThis.fetch;
  let next = null;
  globalThis.fetch = async () => next();
  try {
    /* the leading span, its tags cut in two across chunks, as a server sends it */
    const shown = [];
    next = () => sseAnswer(['<thi', 'nk>He is asking for the paperwork to ', 'move. So my response, in my voice:</th', 'ink>\n\nThe packet is still in the courier\'s bag.'].map((c, i, all) => ({ choices: [{ delta: { content: c }, finish_reason: i === all.length - 1 ? 'stop' : null }] })).concat(['[DONE]']));
    let r = await call.streamModel(conn, { system: 's', messages: [{ role: 'user', content: 'q' }], onText: (t) => shown.push(t) });
    eq('a thought sent inside the words is moved to the thinking, even with its tags cut across chunks',
      [r.text, r.thinking, shown.join('')], ["The packet is still in the courier's bag.", 'He is asking for the paperwork to move. So my response, in my voice:', "The packet is still in the courier's bag."]);
    /* no opening tag at all — the model's template opened it */
    next = () => sseAnswer([{ choices: [{ delta: { content: 'He is looking at his own book. So my response, short and warm:\n</think>\n\nAdded — the packet is in transit.' }, finish_reason: 'stop' }] }, '[DONE]']);
    r = await call.streamModel(conn, { system: 's', messages: [{ role: 'user', content: 'q' }] });
    eq('a lone closing tag: everything before it was the thought', [r.text, r.thinking], ['Added — the packet is in transit.', 'He is looking at his own book. So my response, short and warm:']);
    /* a whole answer, not streamed */
    next = () => wholeAnswer({ choices: [{ message: { content: '<think>weighing it</think>Here it is.' }, finish_reason: 'stop' }] });
    r = await call.callModel(conn, { user: 'x' });
    eq('and in a whole answer', [r.text, r.thinking], ['Here it is.', 'weighing it']);
    next = () => sseAnswer([{ choices: [{ delta: { content: 'A < B, and the tide > the moon.' }, finish_reason: 'stop' }] }, '[DONE]']);
    r = await call.streamModel(conn, { system: 's', messages: [{ role: 'user', content: 'q' }] });
    eq('words with no thought in them are untouched', [r.text, r.thinking], ['A < B, and the tide > the moon.', '']);
    eq('the crew\'s answers lose a thought with no opening tag too', stripThinking('I will add the line.\n</think>\nDone.\n<edits>[]</edits>'), 'Done.\n<edits>[]</edits>');

    /* through the real turn: the reply is the answer, the thought is kept, and the persona's past replies go back clean */
    const fronts = [];
    let listenerSays = '{"jobs":[]}';
    globalThis.fetch = async (url, init) => {
      const req = JSON.parse(init.body);
      const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
      if (forFront(req)) { fronts.push(req.body); return sseAnswer([{ choices: [{ delta: { content: '<think>plan it</think>Of course.' }, finish_reason: 'stop' }] }, '[DONE]']); }
      if (sys.includes(LISTENER_MARK)) { fronts.push({ listener: sys }); return wholeAnswer({ choices: [{ message: { content: listenerSays }, finish_reason: 'stop' }] }); }
      return wholeAnswer({ choices: [{ message: { content: 'Added it.\n<edits>[{"file":"Plot Essential.md","append":true,"replace":"e006 [Sun] [setup]: The packet was still in transit."}]</edits>' }, finish_reason: 'stop' }] });
    };
    const house = { connections: [{ id: 'c1', url: 'https://relay.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: { yourName: 'Bruce' }, personaFrame: '' };
    const world = () => ({ id: 'pt', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: '# PLOT ESSENTIAL — Soul Society — V1.0\n\n## TIMELINE\ne005 [Fri] [setup]: Shunsui appointed Jovan.\n' }], chats: [], recentSections: [] });
    const history = [{ role: 'writer', text: 'hi', at: 1 }, { role: 'maker', text: 'He is looking at his own book. So my response:\n</think>\nHello!', at: 2 }];
    const turn = await runTurn({ house, project: world(), history, message: 'the tide should feel like a character' });
    eq('through the real turn: the reply is the answer, and its thought is kept with it', [turn.reply, turn.thinking], ['Of course.', 'plan it']);
    const sent = fronts.find((f) => f.messages);
    ok('the persona\'s earlier reply goes back without the thought that was in it', sent && JSON.stringify(sent.messages).includes('"Hello!"') && !JSON.stringify(sent.messages).includes('looking at his own book'), sent && JSON.stringify(sent.messages).slice(0, 300));
    ok('and it is told to answer directly, never its notes on how to answer', sent && /never your notes to yourself about how to answer/.test(sent.messages[0].content));

    /* his own words: a soft "maybe we should add that…" to a book that exists */
    fronts.length = 0;
    const HIS = 'So maybe we should add that Jovan just got accepted to seiretei and actually have been assigned to Thirteen division last week and the documents is on the move to Thirteenth Division desk and the second division but rukia and sui feng doesn\'t know since it\'s still moving. And idk how Jovan just got accepted without academy probably the bankai case and who approved logically shunsui?';
    eq('his message, read by the keyword reading with a plot essential there: an ask to write it', route(HIS, { hasPlotEssential: true, hasDocs: true }).map((j) => j.worker), ['editor']);
    eq('an idea floated with no ask to write it stays talk', route('maybe the guild owns a dragon?', { hasPlotEssential: true, hasDocs: true }).length, 0);
    /* the listener hears it as talk and sends nobody (what happened): the persona is told nothing was written */
    listenerSays = '{"jobs":[]}';
    const told = await runTurn({ house, project: world(), message: HIS });
    const frontSaw = fronts.filter((f) => f.messages).pop();
    ok('when the listener sends nobody for words that read like a job, the persona is told plainly nothing was written',
      told.project.docs[0].text === world().docs[0].text && frontSaw && /Nothing was changed just now: nobody was sent to do it\. If what Bruce asked for is already in the documents/.test(frontSaw.messages[frontSaw.messages.length - 1].content)
      && /Never say you changed something just now\./.test(frontSaw.messages[frontSaw.messages.length - 1].content));
    fronts.length = 0;
    await runTurn({ house, project: world(), message: 'the tide should feel like a character' });
    ok('plain talk carries no such line', !fronts.filter((f) => f.messages).some((f) => /Nothing was changed just now/.test(JSON.stringify(f.messages))));

    /* "did you add it?" after the edit landed: the persona answers from the house's record, not its memory */
    const landed = { role: 'maker', text: 'He is looking at his own book… (a thought, shown as a reply)', at: 3,
      cards: [{ status: 'applied', name: 'Plot Essential.md', how: 'put it under e005', reason: 'the courier packet, per Protocol 20', now: 'e006 [Sun 09:00] [setup]: The courier packet had not reached the 13th or 2nd Division desks.' }],
      batches: [{ id: 'b1', undone: false }] };
    const undone = { role: 'maker', text: 'Moved the scene.', at: 5,
      cards: [{ status: 'applied', name: 'Plot Essential.md', how: 'exact', reason: 'moved the scene', now: 'WHERE: the Quay' }],
      batches: [{ id: 'b2', undone: true }] };
    fronts.length = 0;
    await runTurn({ house, project: world(), history: [{ role: 'writer', text: 'add the paperwork', at: 2 }, landed, { role: 'writer', text: 'move the scene', at: 4 }, undone], message: 'did you add it?' });
    const asked = fronts.filter((f) => f.messages).pop();
    const last = asked ? asked.messages[asked.messages.length - 1].content : '';
    ok('asked "did you add it?", the persona is shown the change that stands, with the words it wrote',
      /Changed earlier in this conversation, and standing now \(newest first\)/.test(last) && /Plot Essential\.md: put it under e005 \(the courier packet\) \u2014 now reads: \u201ce006 \[Sun 09:00\] \[setup\]: The courier packet had not reached the 13th or 2nd Division desks\.\u201d/.test(last), last.slice(last.indexOf('Changed earlier'), last.indexOf('Changed earlier') + 400));
    ok('a change that was put back is not in the record', !/WHERE: the Quay/.test(last));
    ok('and the record carries no machinery (the crew\'s "per Protocol 20" is gone)', !/Protocol 20/.test(last));
    const workerSys = [];
    const standIn = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const req = JSON.parse(init.body);
      const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
      if (forFront(req)) return sseAnswer([{ choices: [{ delta: { content: 'It is already in.' }, finish_reason: 'stop' }] }, '[DONE]']);
      if (!sys.includes(LISTENER_MARK)) workerSys.push(sys);
      return wholeAnswer({ choices: [{ message: { content: sys.includes(LISTENER_MARK) ? '{"jobs":[{"worker":"editor","task":"Add the courier packet line."}]}' : 'It is already there.' }, finish_reason: 'stop' }] });
    };
    await runTurn({ house, project: world(), message: 'add that the packet is still with the courier' });
    ok('the crew is told: what is already in the document is not written again', workerSys.length && workerSys.every((sy) => /If what he asks for is already in the document as it stands, change nothing, and say that it is already there\./.test(sy)));
    globalThis.fetch = standIn;
    listenerSays = 'not readable';          /* the listener's answer lost: the keyword reading decides */
    const edit = await runTurn({ house, project: world(), message: HIS });
    ok('and through the real turn, even with the listener\'s answer lost, it is written', edit.project.docs[0].text.includes('The packet was still in transit.'), edit.project.docs[0].text);
    ok('what the listener is told: a soft suggestion to add to an existing document is an ask, and a question with it is part of the job',
      fronts.some((f) => f.listener && /A suggestion to put something into a document that already exists IS an ask, however softly he puts it/.test(f.listener) && /a question he asks with it \(how, who, why\) is part of the job/.test(f.listener)));
  } catch (e) { ok('the thought-splitting tests ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
}

/* ============================ HIS ANSWER STARTS WHILE THE LISTENER READS */
{
  const { runTurn } = await import('../js/agents/run.js');
  const { LISTENER_MARK } = await import('../js/agents/listener.js');
  const realFetch = globalThis.fetch;
  const house = { connections: [{ id: 'c1', url: 'https://relay.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: { yourName: 'Bruce' }, personaFrame: '' };
  const world = () => ({ id: 'pe1', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: '# PLOT ESSENTIAL — Tide — V1.0\n\n## WORLD\n### Rules\n- The tide decides who rules.\n\n## SCENE\nWHERE: the salt flats\n' }], chats: [], recentSections: [] });
  let log, gate, open, listenerSays, fronts, frontSays;
  const reset = () => {
    log = []; fronts = [];
    gate = new Promise((r) => { open = r; });
    listenerSays = '{"jobs":[]}';
    frontSays = () => [{ choices: [{ delta: { content: 'It already does, a little.' }, finish_reason: 'stop' }] }, '[DONE]'];
  };
  /* a stream that honours Stop and a letting-go, the way a real one does */
  const streamOf = (lines, signal, slow = 0) => new Response(new ReadableStream({
    async start(c) {
      const enc = new TextEncoder();
      signal && signal.addEventListener('abort', () => { try { c.error(new DOMException('let go', 'AbortError')); } catch (_) {} }, { once: true });
      for (const l of lines) {
        if (signal && signal.aborted) return;
        c.enqueue(enc.encode('data: ' + (typeof l === 'string' ? l : JSON.stringify(l)) + '\n\n'));
        if (slow) await new Promise((r) => setTimeout(r, slow));
      }
      try { c.close(); } catch (_) {}
    },
  }), { status: 200 });
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
    if (forFront(req)) {
      fronts.push(req.body);
      log.push(fronts.length === 1 ? 'front asked' : 'front asked again');
      const lines = frontSays(fronts.length);
      if (!Array.isArray(lines)) return lines;
      return streamOf(lines, init.signal, fronts.length === 1 ? 40 : 0);
    }
    if (sys.includes(LISTENER_MARK)) {
      log.push('listener asked');
      await gate;
      log.push('listener answered');
      return wholeAnswer({ choices: [{ message: { content: listenerSays }, finish_reason: 'stop' }] });
    }
    log.push('worker');
    return wholeAnswer({ choices: [{ message: { content: 'Added it.\n<edits>[{"file":"Plot Essential.md","insert_after":"- The tide decides who rules.","replace":"- The kingdom has a second moon."}]</edits>' }, finish_reason: 'stop' }] });
  };
  const run = async (message, extra = {}) => {
    const heard = { text: [], thinking: [] };
    setTimeout(() => open(), 120);
    const r = await runTurn({ house, project: world(), message,
      onText: (t, at) => heard.text.push([t, at, Date.now(), log.includes('listener answered')]),
      onThinking: (t, at) => heard.thinking.push([t, at, Date.now(), log.includes('listener answered')]), ...extra });
    return { r, heard };
  };
  try {
    /* talk: the reply is asked for at once, and shown only once the listener has answered */
    reset();
    let { r, heard } = await run('the tide should feel like a character');
    eq('talk: his answer is asked for at the same moment the listener reads', log.slice(0, 2).sort(), ['front asked', 'listener asked']);
    ok('talk: nothing of it is shown before the listener has answered', heard.text.length > 0 && heard.text.every(([, , , after]) => after === true),
      JSON.stringify(heard.text.map(([t, , , after]) => [t, after])));
    eq('talk: one reply, the one that was started, word for word', [fronts.length, r.reply, r.error], [1, 'It already does, a little.', null]);

    /* the same words it would have had: the early reply reads exactly what the ordinary one reads */
    const early = fronts[0];
    reset();
    listenerSays = 'not an answer at all';           /* the old reading runs, and sends nobody */
    ({ r } = await run('the tide should feel like a character'));
    eq('talk: the early reply reads exactly what the ordinary one reads', JSON.stringify(fronts[0].messages), JSON.stringify(early.messages));

    /* a job the keyword reading could not see: the early reply is let go unseen */
    reset();
    listenerSays = '{"jobs":[{"worker":"editor","task":"Add a second moon to the rules."}]}';
    frontSays = (n) => (n === 1
      ? [{ choices: [{ delta: { content: 'EARLY WORDS ' } }] }, { choices: [{ delta: { content: 'that must never show' } }] }, { choices: [{ delta: { content: '.' }, finish_reason: 'stop' }] }, '[DONE]']
      : [{ choices: [{ delta: { content: 'Two moons it is.' }, finish_reason: 'stop' }] }, '[DONE]']);
    ({ r, heard } = await run('give the kingdom a second moon'));
    ok('a job after all: the early reply never reaches him', !heard.text.some(([t]) => /EARLY|never show/.test(t)), JSON.stringify(heard.text.map(([t]) => t)));
    eq('a job after all: he hears the reply written after the work', [r.reply, fronts.length], ['Two moons it is.', 2]);
    ok('and that one is told what got done', /What got done while you were talking/.test(JSON.stringify(fronts[1].messages)));
    ok('and the change landed', /second moon/.test(r.project.docs[0].text));

    /* a job the keyword reading does see: nothing is started early */
    reset();
    listenerSays = '{"jobs":[{"worker":"editor","task":"Change the rule."}]}';
    ({ r } = await run('change the rule to say the tide decides nothing'));
    eq('an obvious job starts nothing early: one reply, after the work', [fronts.length, log.indexOf('front asked') > log.indexOf('worker')], [1, true]);

    /* something waits on him: his words are likely its answer, so nothing is started early */
    reset();
    const history = [{ role: 'writer', text: 'tidy it', at: 1 }, { role: 'maker', text: 'Here is the plan.', at: 2, asks: [{ worker: 'showrunner', ask: 'PLAN: cut the old subplot. Go ahead?' }] }];
    ({ r } = await run('sounds right to me', { history }));
    ok('with something waiting on him, the reply waits for the listener', log.indexOf('front asked') > log.indexOf('listener answered'), JSON.stringify(log));

    /* the early reply failed before a word came: the ordinary one is asked for, and he still gets his answer */
    reset();
    frontSays = (n) => (n === 1 ? wholeAnswer({ error: 'provider', status: 429, detail: 'Too Many Requests' }) : [{ choices: [{ delta: { content: 'Here I am.' }, finish_reason: 'stop' }] }, '[DONE]']);
    ({ r } = await run('the tide should feel like a character'));
    eq('an early reply that failed before a word costs him nothing: the ordinary one comes', [r.reply, r.error, fronts.length], ['Here I am.', null, 2]);
    reset();
    frontSays = () => wholeAnswer({ error: 'provider', status: 401, detail: 'Incorrect API key provided' });
    ({ r } = await run('the tide should feel like a character'));
    eq('but a bad key is not asked twice: it is said, once', [fronts.length, /Incorrect API key/.test(r.error || '')], [1, true]);

    /* Stop while the listener reads: nothing is shown, and the turn says it stopped */
    reset();
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 30);
    ({ r, heard } = await run('the tide should feel like a character', { signal: stop.signal }));
    eq('Stop while the listener reads: nothing is shown, and it stopped', [r.stopped === true, heard.text.length], [true, 0]);

    /* "ok build it" in a new world, while the listener's answer cannot be read:
     * it is still a build, and no reply is started early for it */
    reset();
    listenerSays = 'hm, hard to say';
    const blank = { id: 'pe2', docs: [], chats: [], recentSections: [] };
    const builderSaid = [];
    const before = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const req = JSON.parse(init.body);
      const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
      if (/PROACTIVE CO-WRITER/.test(sys)) { builderSaid.push(1); log.push('builder'); return wholeAnswer({ choices: [{ message: { content: 'Built.\n<file name="Plot Essential.md">\n# PLOT ESSENTIAL — Salt — V1.0\n\n## SCENE\nWHERE: the quay\n</file>' }, finish_reason: 'stop' }] }); }
      return before(url, init);
    };
    setTimeout(() => open(), 30);
    r = await runTurn({ house, project: blank, message: 'ok build it', history: [{ role: 'writer', text: 'a drowned city where the guilds own the tides', at: 1 }, { role: 'maker', text: 'Lovely. Who holds the keys to the lock gates?', at: 2 }] });
    globalThis.fetch = before;
    eq('"ok build it" builds even when the listener\'s answer cannot be read', [builderSaid.length, r.project.docs.map((d) => d.name)], [1, ['Plot Essential.md']]);
    eq('and nothing was started early for it: one reply, after the build', [fronts.length, log.includes('builder') && log.indexOf('front asked') > log.indexOf('builder')], [1, true]);

    /* thinking held while the listener read keeps the moment it really arrived */
    reset();
    frontSays = () => [{ choices: [{ delta: { reasoning_content: 'Mm, the tide as a character...' } }] }, { choices: [{ delta: { content: 'Yes.' }, finish_reason: 'stop' }] }, '[DONE]'];
    ({ r, heard } = await run('the tide should feel like a character'));
    ok('thinking held unseen carries the moment it really arrived', heard.thinking.length === 1 && heard.thinking[0][3] === true && heard.thinking[0][1] > 0 && heard.thinking[0][1] < heard.thinking[0][2] - 40,
      JSON.stringify(heard.thinking.map(([, at, shown]) => shown - at)));
  } catch (e) { ok('the early-reply tests ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
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

/* ============================ chatting stays chatting; clear and delete work (v1.1.12) */
{
  const { runTurn, landTurn } = await import('../js/agents/run.js');
  const { LISTENER_MARK } = await import('../js/agents/listener.js');
  const { undoBatch } = await import('../js/doc/edits.js');
  const calls = [];
  let listenerSays = () => '{"jobs": []}';
  let workerSays = () => 'Read it all back.';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    if (forFront(req)) {
      calls.push({ who: 'front' });
      const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Mm.' } }] }) + '\n\ndata: [DONE]\n\n';
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    }
    const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
    const user = (req.body.messages.find((m) => m.role === 'user') || {}).content || '';
    const who = sys.includes(LISTENER_MARK) ? 'listener' : /Evidenced CLEAN vs False CLEAN/.test(sys) ? 'eye' : /PROACTIVE CO-WRITER/.test(sys) ? 'builder' : 'worker';
    calls.push({ who, user });
    const out = who === 'listener' ? listenerSays(user) : workerSays(user, sys);
    return wholeAnswer({ choices: [{ message: { content: out }, finish_reason: 'stop' }] });
  };
  const house = { connections: [{ id: 'c1', url: 'https://one.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: { makerName: 'Eni', yourName: 'Bruce' }, personaFrame: 'You are Eni.' };
  /* a plot essential with leftover findings: undated events, a name inside a trait */
  const MESSY = '# PLOT ESSENTIAL — Harbour — V1.0\n\n## WORLD\n### Rules\n- The city lives inside a dormant leviathan.\n\n## TIMELINE\ne001 Mira arrives.\ne002 The tide turns.\n\n## SCENE\nWHERE: the Ribway\n';
  const world = () => ({ id: 'pq', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: MESSY }, { id: 'd2', name: 'Notes.md', kind: 'notes', text: 'ideas' }], chats: [], recentSections: [] });
  const heavy = () => calls.filter((c) => c.who !== 'front' && c.who !== 'listener');
  try {
    /* a question, with findings sitting in the document: nobody works, the persona just answers */
    let r = await runTurn({ house, project: world(), message: 'what do you think of Mira so far?' });
    ok('a question sends no worker, even with leftover findings in the document', heavy().length === 0, calls.map((c) => c.who).join(','));
    ok('and changes nothing', r.project.docs[0].text === MESSY);

    /* brainstorming with nothing built: never a build, whether the listener answers or not */
    const BRAIN = 'ok so I am thinking a drowned city where the guilds own the tides, and Mira is a salvager who hates the guild, and there is a lighthouse keeper who knows too much. Still thinking about the magic.';
    const fresh = () => ({ id: 'pb', docs: [], chats: [], recentSections: [] });
    calls.length = 0;
    r = await runTurn({ house, project: fresh(), message: BRAIN });
    ok('brainstorming builds nothing when the listener hears it as talk', !calls.some((c) => c.who === 'builder') && r.project.docs.length === 0);
    calls.length = 0;
    listenerSays = () => 'hm';
    r = await runTurn({ house, project: fresh(), message: BRAIN });
    ok('and nothing when the listener cannot answer either — the old "long message builds" rule is gone', !calls.some((c) => c.who === 'builder') && r.project.docs.length === 0, calls.map((c) => c.who).join(','));

    /* when he says build it, the builder reads the whole brainstorm, however long */
    calls.length = 0;
    listenerSays = () => '{"jobs":[{"worker":"builder","task":"Build the plot essential from everything Bruce said."}]}';
    const long = [];
    for (let i = 0; i < 40; i++) long.push({ role: i % 2 ? 'maker' : 'writer', text: (i === 0 ? 'FIRST IDEA: the guilds own the tides. ' : 'more brainstorming. ') + 'x'.repeat(900), at: i });
    await runTurn({ house, project: fresh(), history: long, message: 'okay, make the plot essential now' });
    const b = calls.find((c) => c.who === 'builder');
    ok('asked to build, the builder reads the whole brainstorm — its first idea too', b && b.user.includes('FIRST IDEA: the guilds own the tides.'), b ? 'first idea missing' : 'no builder');

    /* clear: the house empties it; the guard against loss does not stop what he asked for */
    calls.length = 0;
    listenerSays = () => '{"jobs": [], "clear": ["plot essential"]}';
    r = await runTurn({ house, project: world(), message: 'clear the plot essential' });
    ok('"clear the plot essential" empties it', r.project.docs.find((d) => d.name === 'Plot Essential.md').text === '', JSON.stringify(r.cards));
    ok('no worker was sent for it, and nothing read it back', heavy().length === 0, calls.map((c) => c.who).join(','));
    ok('its card says so, with a way to put it back', r.cards.some((c) => c.status === 'applied' && c.how === 'cleared it') && r.batches.length === 1);
    const back = undoBatch(r.project.docs.map((d) => ({ name: d.name, text: d.text })), r.batches[0]);
    ok('putting it back restores every word', back.ok && back.changes[0].text === MESSY);

    /* delete: gone from the world, gone where it lands, and it can come back */
    calls.length = 0;
    listenerSays = () => '{"jobs": [], "delete": ["Notes.md"]}';
    const w0 = world();
    r = await runTurn({ house, project: w0, message: 'delete the notes, I do not need them' });
    ok('"delete the notes" deletes it', !r.project.docs.some((d) => d.name === 'Notes.md'));
    const snap = new Map(w0.docs.map((d) => [d.name, d.text]));
    const liveWorld = { ...w0, chats: [{ id: 'ch', turns: [] }] };
    const landed = landTurn(liveWorld, { chatId: 'ch', snapshot: snap, result: r, makerTurn: { role: 'maker', text: 'Mm.', at: 5, cards: r.cards, batches: r.batches } });
    ok('and it is deleted in the world it lands in', !landed.world.docs.some((d) => d.name === 'Notes.md'));
    const undo = undoBatch(landed.world.docs.map((d) => ({ name: d.name, text: d.text })), r.batches[0]);
    ok('and it can come back, with its kind', undo.ok && undo.changes[0].add === true && undo.changes[0].text === 'ideas' && undo.changes[0].kind === 'notes', JSON.stringify(undo));
    const handChanged = { ...w0, docs: w0.docs.map((d) => (d.name === 'Notes.md' ? { ...d, text: 'he typed more' } : d)), chats: [{ id: 'ch', turns: [] }] };
    const kept = landTurn(handChanged, { chatId: 'ch', snapshot: snap, result: r, makerTurn: { role: 'maker', text: 'Mm.', at: 6, cards: r.cards, batches: r.batches } });
    ok('a document he changed by hand meanwhile is kept, never deleted from under him', kept.world.docs.some((d) => d.name === 'Notes.md' && d.text === 'he typed more'));

    /* a worker cannot clear a document by claiming to be the house */
    calls.length = 0;
    listenerSays = () => '{"jobs":[{"worker":"editor","task":"tidy the notes"}]}';
    workerSays = () => 'Done.\n<edits>[{"house": true, "clear": true, "file": "Plot Essential.md"}]</edits>';
    r = await runTurn({ house, project: world(), message: 'tidy the wording in the notes' });
    ok('a worker\'s edit that claims to be the house clears nothing', r.project.docs[0].text === MESSY, r.project.docs[0].text.slice(0, 40));

    /* a one-field edit is not read back in full (the craft's *edit: required scan only) */
    calls.length = 0;
    listenerSays = () => '{"jobs":[{"worker":"editor","task":"Move the scene to the Quay."}]}';
    workerSays = (user, sys) => (/Evidenced CLEAN vs False CLEAN/.test(sys) ? 'read back' : 'Moved.\n<edits>' + JSON.stringify([{ file: 'Plot Essential.md', find: 'WHERE: the Ribway', replace: 'WHERE: the Quay' }]) + '</edits>');
    r = await runTurn({ house, project: world(), message: 'move the scene to the Quay' });
    ok('a one-field edit lands without a full read-back after it', /WHERE: the Quay/.test(r.project.docs[0].text) && !calls.some((c) => c.who === 'eye'), calls.map((c) => c.who).join(','));
  } catch (e) { ok('the chatting tests ran', false, String((e && e.stack) || e)); } finally { globalThis.fetch = realFetch; }
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
  const { sweep, runTurn } = await import('../js/agents/run.js');
  const { applyRun } = await import('../js/doc/edits.js');
  const { LISTENER_MARK } = await import('../js/agents/listener.js');
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
  const sw = sweep(proj, new Set(['A.md']), new Map(proj.docs.map((d) => [d.name, d.text])));
  ok('a document nobody touched this turn is not rewritten', sw.project.docs[1].text === proj.docs[1].text, sw.project.docs[1].text);
  const cr = applyRun([{ name: 'Plot Essential.md', text: '' }], [{ create_file: 'Plot Essential.md', replace: '# PE\n' }]);
  ok('a plot essential cleared a moment ago can be written again by creating it', cr.cards[0].status === 'applied' && cr.texts.get('Plot Essential.md') === '# PE\n');
  const cr2 = applyRun([{ name: 'Plot Essential.md', text: 'x' }], [{ create_file: 'Plot Essential.md', replace: 'y' }]);
  ok('but creating over a document with words in it is still refused', cr2.cards[0].status === 'refused');

  /* the whole turn: "clear it and build it again" clears, then builds into the same document */
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    if (forFront(req)) {
      const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Mm.' } }] }) + '\n\ndata: [DONE]\n\n';
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    }
    const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
    const out = sys.includes(LISTENER_MARK) ? '{"jobs":[{"worker":"builder","task":"Build the plot essential again from the talk."}],"clear":["Plot Essential.md"]}'
      : /PROACTIVE CO-WRITER/.test(sys) ? 'Built it.\n<edits>[{"create_file":"Plot Essential.md","replace":"# PLOT ESSENTIAL — Anew — V1.0\\n\\n## SCENE\\nWHERE: the lighthouse\\n"}]</edits>'
      : 'Read it all back.';
    return wholeAnswer({ choices: [{ message: { content: out }, finish_reason: 'stop' }] });
  };
  try {
    const house = { connections: [{ id: 'c1', url: 'https://one.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: { yourName: 'Bruce' }, personaFrame: '' };
    const r = await runTurn({ house, project: { id: 'pz', docs: [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: HIS }], chats: [], recentSections: [] }, message: 'clear the plot essential and build it again from what we said' });
    ok('"clear it and build it again" clears, then writes the new one into the same document', r.project.docs.length === 1 && /Anew/.test(r.project.docs[0].text) && !/Jovan/.test(r.project.docs[0].text), JSON.stringify(r.cards.map((c) => [c.status, c.how || c.why])));
  } finally { globalThis.fetch = realFetch; }
}

/* ============================ a change that changed nothing (v1.1.14) */
{
  const { runTurn } = await import('../js/agents/run.js');
  const { LISTENER_MARK } = await import('../js/agents/listener.js');
  const calls = [];
  let editorSays = () => '';
  let front = '';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const req = JSON.parse(init.body);
    if (forFront(req)) {
      const m = req.body.messages; front = m[m.length - 1].content;
      const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Mm.' } }] }) + '\n\ndata: [DONE]\n\n';
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }), { status: 200 });
    }
    const sys = (req.body.messages.find((m) => m.role === 'system') || {}).content || '';
    const user = (req.body.messages.find((m) => m.role === 'user') || {}).content || '';
    let out = 'Read it all back.';
    if (sys.includes(LISTENER_MARK)) out = '{"jobs":[{"worker":"editor","task":"Make Rukia a lieutenant."}]}';
    else if (/Edit Mode Discipline/.test(sys)) { calls.push(user); out = editorSays(user, calls.length); }
    return wholeAnswer({ choices: [{ message: { content: out }, finish_reason: 'stop' }] });
  };
  const BLEACH = '# PLOT ESSENTIAL — Bleach — V1.0\n\n### Rukia (shinigami | active | 150)\nRANK: unseated officer\nID: a quiet shinigami\n\n### Renji (shinigami | active | 150)\nRANK: lieutenant\n';
  const world = () => ({ id: 'pbl', docs: [{ id: 'd1', name: 'Bleach.md', kind: 'pe', text: BLEACH }], chats: [], recentSections: [] });
  const house = { connections: [{ id: 'c1', url: 'https://one.example/v1', model: 'm', key: 'k' }], agentConnections: {}, settings: { yourName: 'Bruce' }, personaFrame: '' };
  const blk = (edits) => 'Done.\n<edits>' + JSON.stringify(edits) + '</edits>';
  try {
    /* the real change lands; four "change X to X" are sent back once, the worker says they were right: he sees nothing */
    editorSays = (user, n) => (n === 1 ? blk([
      { file: 'Bleach.md', find: 'RANK: unseated officer', replace: 'RANK: lieutenant' },
      { file: 'Bleach.md', find: 'ID: a quiet shinigami', replace: 'ID: a quiet shinigami' },
      { file: 'Bleach.md', find: 'ID: a quiet shinigami', replace: 'ID: a quiet shinigami' },
      { file: 'Bleach.md', find: 'ID: a quiet shinigami', replace: 'ID: a quiet shinigami' },
      { file: 'Bleach.md', find: 'ID: a quiet shinigami', replace: 'ID: a quiet shinigami' },
    ]) : 'Those were already right.');
    let r = await runTurn({ house, project: world(), message: 'make Rukia a lieutenant' });
    ok('the real change lands', r.project.docs[0].text.includes('RANK: lieutenant\nID: a quiet shinigami'), r.project.docs[0].text);
    ok('a change that changed nothing is never shown to him as "not done"', !r.cards.some((c) => /leaves the words exactly/.test(c.why || '')), JSON.stringify(r.cards.map((c) => [c.status, c.why])));
    ok('nor told to the persona', !/Not done/.test(front) && !/leaves the words/.test(front), front.slice(-200));
    ok('it went back to the worker once, listed once, not four times', calls.length === 2 && (calls[1].match(/put back the very words it found/g) || []).length === 1, calls.length);

    /* the worker meant a change and wrote the old words back: sent back, it sends the real one, and it lands */
    calls.length = 0;
    editorSays = (user, n) => (n === 1 ? blk([{ file: 'Bleach.md', find: 'RANK: unseated officer', replace: 'RANK: unseated officer' }])
      : blk([{ file: 'Bleach.md', find: 'RANK: unseated officer', replace: 'RANK: lieutenant' }]));
    r = await runTurn({ house, project: world(), message: 'make Rukia a lieutenant' });
    ok('a change the worker botched by writing the old words back is caught, and the real one lands', r.project.docs[0].text.includes('RANK: lieutenant\nID:'), r.project.docs[0].text);

    /* a genuine failure repeated is still shown — once */
    calls.length = 0;
    editorSays = () => blk([{ file: 'Bleach.md', find: 'NOT THERE AT ALL', replace: 'x' }, { file: 'Bleach.md', find: 'NOT THERE AT ALL', replace: 'x' }]);
    r = await runTurn({ house, project: world(), message: 'make Rukia a lieutenant' });
    const misses = r.cards.filter((c) => c.status === 'refused' && /not in the document/.test(c.why || ''));
    ok('a real failure is still shown, once, not once per copy', misses.length === 1, misses.length);
  } finally { globalThis.fetch = realFetch; }
}

/* ================================================================ done */

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\nfailed:'); for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }

console.log('\nwhat each worker reads:');
for (const r of REPORT.sort((a, b) => b.chars - a.chars)) {
  console.log(`  ${r.worker.padEnd(14)} ${String(r.chars).padStart(7)} chars  ${String(r.sections).padStart(3)} parts`);
}
console.log(`  ${'the whole craft'.padEnd(14)} ${String(ENGINE.length).padStart(7)} chars  ${String(SECTIONS.size).padStart(3)} parts`);
