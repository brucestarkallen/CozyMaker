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
import { parseEdits, stripEdits, tolerantJson, locate, applyEdit, applyRun, undoBatch, hash } from '../js/doc/edits.js';
import { lint, countOf, lostSomething, readEvents, namedPersonGate } from '../js/doc/lint.js';
import { route } from '../js/agents/router.js';
import { buildRequest, readAnswer, readChunk, houseOf, alwaysThinks } from '../js/providers.js';
import { personaOf, greeting, openingFor, inPerson } from '../js/agents/persona.js';
import { pickConnection } from '../js/agents/roster.js';
import { naturalize, commit, sweep, backstageBrief, capUndo, UNDO_KEPT } from '../js/agents/run.js';

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
ok('the eye is handed the alert list', sliceFor(SECTIONS, 'eye').text.includes('[FALSE_VERIFICATION]'));
ok('the builder is NOT handed the alert list', !sliceFor(SECTIONS, 'builder').text.includes('[FALSE_VERIFICATION]'));

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
ok('a near miss still lands when it is clearly the one', close.ok && close.how === 'close', JSON.stringify(close));
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
ok('an undated event is handed to the chronicler',
  L.found.some((f) => f.worker === 'chronicler' && /no date/.test(f.check)));
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
eq('plain words find the builder', route('here is my world: a drowned city of guild-houses').map((r) => r.worker), ['builder']);
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
eq('a long description with nothing built yet is a build',
  route('x'.repeat(200), { hasPlotEssential: false }).map((r) => r.worker), ['builder']);
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
ok('"do not think" is spoken in this house\'s words', req.body.reasoning_effort === 'minimal');

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
  { text: 'hi', thinking: 'mm', finish: 'stop' });
eq('an anthropic-shaped answer is read',
  readAnswer('anthropic', { content: [{ type: 'thinking', thinking: 'mm' }, { type: 'text', text: 'hi' }], stop_reason: 'end_turn' }),
  { text: 'hi', thinking: 'mm', finish: 'end_turn' });
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
eq('first person turns it around', greeting({ ...p, person: 'first' }), "I'm Eni. Bruce is here, and we're building this together.");
eq('with no names it says nothing rather than inventing one', greeting({ maker: '', you: '', person: 'second' }), '');
const opening = openingFor(p, 'You and the writer are building something.');
ok('the writer\'s own instructions come first and untouched', opening.startsWith('You are Eni. You swear a bit.'));
ok('the greeting follows them', opening.includes('Hey Eni, this is Bruce.'));
ok('first person rewrites the body too',
  openingFor({ ...p, person: 'first' }, 'You are building something.').includes('I am building something.'));

/* THE FIREWALL: nothing the front reads may carry the craft's machinery. */
const FRONT_TEXT = openingFor(p, readFileSync(join(ROOT, 'js/agents/run.js'), 'utf8')
  .split('const FRONT_BODY = `')[1].split('`;')[0]);
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

/* The craft file is asked for from the root, never relative to a caller. */
ok('the craft is fetched from the root',
  readFileSync(join(ROOT, 'js/engine/slices.js'), 'utf8').includes("fetcher('/engine/generalist.md'"));

/* ================================================================ done */

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\nfailed:'); for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }

console.log('\nwhat each worker reads:');
for (const r of REPORT.sort((a, b) => b.chars - a.chars)) {
  console.log(`  ${r.worker.padEnd(14)} ${String(r.chars).padStart(7)} chars  ${String(r.sections).padStart(3)} parts`);
}
console.log(`  ${'the whole craft'.padEnd(14)} ${String(ENGINE.length).padStart(7)} chars  ${String(SECTIONS.size).padStart(3)} parts`);
