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
import { personaOf, greeting, openingFor, inPerson, voiceMacros, unfilledMacros } from '../js/agents/persona.js';
import { upgradeWorld } from '../js/store.js';
import { worldbookToST, guessKind } from '../js/ui/docs.js';
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

/* The craft file is asked for from the root, never relative to a caller. */
ok('the craft is fetched from the root',
  readFileSync(join(ROOT, 'js/engine/slices.js'), 'utf8').includes("fetcher('/engine/generalist.md'"));

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
eq('every complete change survives a broken one', salvageEdits('[{"find":"a","replace":"1"},{"find":"b "broken" q","replace":"2"},{"find":"c","replace":"3"}]').map((e) => e.find), ['a', 'c']);
{
  /* a stray quote inside the FIRST change inverts the scanner's idea of what
   * is a string for everything after it; the second pass recovers the rest,
   * and they must come back in the order they were written */
  const block = '[\n  {"find":"one "x","replace":"1"},\n  {"find":"two","replace":"2"},\n  {"find":"three","replace":"3"},\n  {"find":"four","replace":"4"}\n]';
  eq('salvaged changes come back in the order they were written', salvageEdits(block).map((e) => e.find), ['two', 'three', 'four']);
  const r = parseEdits('<edits>' + block + '</edits>');
  eq('the loss is counted exactly', r.warn, 'one of the changes could not be read and was left out; the 3 that could were used');
  const two = parseEdits('<edits>[\n{"find":"a "q","replace":"1"},\n{"find":"b "q","replace":"2"},\n{"find":"c","replace":"3"}\n]</edits>');
  eq('two lost, one kept, said in grammar', two.warn, '2 of the changes could not be read and were left out; the one that could be read was used');
}
ok('a block in the thinking channel is still a block', (() => {
  const r = parseEdits('<edits>[{"find":"a","replace":"b"}]</edits>');
  return r.edits.length === 1;
})());

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
  ok('and the draft is said to have been set aside', /set aside as a draft/.test(r.warn), r.warn);
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
eq('an unset name leaves its macro as written', voiceMacros('{{user}}', personaOf({ settings: {} })), '{{user}}');
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

/* ================================================================ done */

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\nfailed:'); for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }

console.log('\nwhat each worker reads:');
for (const r of REPORT.sort((a, b) => b.chars - a.chars)) {
  console.log(`  ${r.worker.padEnd(14)} ${String(r.chars).padStart(7)} chars  ${String(r.sections).padStart(3)} parts`);
}
console.log(`  ${'the whole craft'.padEnd(14)} ${String(ENGINE.length).padStart(7)} chars  ${String(SECTIONS.size).padStart(3)} parts`);
