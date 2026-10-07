/* CozyMaker — tests/harness.mjs
 *
 * THE HARNESS (v2.0), run whole. The one he talks to reads his instructions, his
 * whole engine and every document word for word, and changes the documents
 * itself; the house puts its changes in, runs its checks, and tells it what
 * happened only when something needs it; its helpers are its own and report
 * back to it. Every test here runs the real turn against a stand-in model on
 * the wire and asserts on what was sent and what came back.
 *
 *   node tests/harness.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cutSections, setEngineForTests } from '../js/engine/slices.js';
import { setCraftForTests } from '../js/engine/crafts.js';
import { runTurn, makeVisibleStream, visibleText, readHelpers, frontBody, landContinuation, landTurn, ROOM_MARK, CRAFT_FRAME, GO_ON, FRONT_ONLY, MAKER_FLOOR, MAX_STEPS } from '../js/agents/run.js';
import { undoBatch } from '../js/doc/edits.js';
import { SEARCH_MARK } from '../js/agents/search.js';
import { countOf } from '../js/agents/call.js';
import { EXAMPLE_FRAME, EXAMPLE_NOTE, shouldGiveExamples } from '../js/agents/examples.js';
import { personaOf, openingFor, noteAtTheEnd } from '../js/agents/persona.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ENGINE = readFileSync(join(ROOT, 'engine/generalist.md'), 'utf8');
setEngineForTests(cutSections(ENGINE), ENGINE);
setCraftForTests('worldbook', readFileSync(join(ROOT, 'engine/worldbook-maker.md'), 'utf8'));
setCraftForTests('auditor', readFileSync(join(ROOT, 'engine/sc-auditor.md'), 'utf8'));

let pass = 0, fail = 0;
const failures = [];
function eq2(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), got); }
function ok(name, cond, detail) { if (cond) { pass++; return; } fail++; failures.push(name + (detail !== undefined ? ` \u2014 ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : '')); }

const PE = `# PLOT ESSENTIAL \u2014 The Ashwood Pact \u2014 V1.0
# STATE: Tuesday 15 April 247 AGC, 09:24 / Council Chamber
# CALENDAR: Fantasy 12-month (AGC)

## WORLD
### Rules
- Epistemic Law: NPCs know ONLY what they personally witnessed.
- Majority is sixteen.

## MC \u2014 Jovan (17)
ID: Tall, dark-haired.
CORE: Reads a room before he speaks.

### Claire (student | core | 16)
ID: Small, freckled.
CORE: Stubborn, catches detail nobody else does.
\u2192 Jovan: refuses to back down (P:60 R:35 S:25)

## TIMELINE
e001 [Mon 14 Apr 247, 09:00] [setup]: The showcase opened in the east hall.

## SCENE
WHERE: Council Chamber / PRESENT: Jovan, Emilia / ACTIVITY: waiting
`;

const HOUSE = (extra = {}) => ({
  settings: { makerName: 'Eni', yourName: 'Bruce', person: 'you', ...(extra.settings || {}) },
  personaFrame: 'You are Eni, a warm and exacting co-writer.',
  postNote: extra.postNote || '',
  connections: [{ id: 'c1', name: 'good', url: 'http://stand.in/v1', model: 'm1' }].concat(extra.connections || []),
  agentConnections: { keeper: 'c1', ...(extra.agentConnections || {}) },
});
const WORLD = (docs = [{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: PE }]) => ({ id: 'w' + Math.random().toString(36).slice(2, 7), title: 'The Ashwood Pact', docs, chats: [{ id: 'c', title: 'First', turns: [] }] });

/* THE STAND-IN, ON THE WIRE. Who is asking is read from what it was given: the one
 * he talks to carries the room's own heading; a helper the craft frame; the
 * searcher its own. Every answer streams, in small pieces that cut tags in two. */
let calls = [];
function sse(text, { finish = 'stop', thinking = '', signal = null, slow = 0, usage = null } = {}) {
  const pieces = [];
  for (let i = 0; i < thinking.length; i += 9) pieces.push({ choices: [{ delta: { reasoning_content: thinking.slice(i, i + 9) } }] });
  for (let i = 0; i < text.length; i += 7) pieces.push({ choices: [{ delta: { content: text.slice(i, i + 7) } }] });
  pieces.push({ choices: [{ delta: {}, finish_reason: finish }] });
  if (usage) pieces.push({ choices: [], usage });
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(c) {
      for (const p of pieces) {
        if (signal && signal.aborted) { c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
        c.enqueue(enc.encode('data: ' + JSON.stringify(p) + '\n\n'));
        if (slow) await new Promise((r) => setTimeout(r, slow));
      }
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  }), { status: 200 });
}
function refusal(status, message) { return new Response(JSON.stringify({ error: 'refused', detail: message, status }), { status: 200 }); }
function stand(handlers) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) !== '/api/call') throw new Error('unexpected fetch ' + url);
    const sent = JSON.parse(init.body);
    const body = sent.body || {};
    const sys = typeof body.system === 'string' ? body.system : ((body.messages || []).find((m) => m.role === 'system') || {}).content || '';
    const msgs = (body.messages || []).filter((m) => m.role !== 'system' || m !== (body.messages || [])[0]);
    const who = sys.includes(ROOM_MARK) ? 'maker' : sys.includes(SEARCH_MARK) ? 'searcher' : sys.includes(CRAFT_FRAME) ? 'helper' : 'other';
    const n = calls.filter((c) => c.who === who).length;
    const call = { who, n, sys, msgs, body, last: (msgs[msgs.length - 1] || {}).content || '' };
    calls.push(call);
    const h = who === 'helper' && handlers.helper === undefined ? 'CLEAN \u2014 nothing wrong.' : handlers[who];
    const out = typeof h === 'function' ? h(call, init.signal) : h;
    if (out instanceof Response) return out;
    if (out && typeof out === 'object') return sse(out.text || '', { ...out, signal: init.signal });
    return sse(String(out || ''), { signal: init.signal });
  };
}
async function turn({ house = HOUSE(), world = WORLD(), message, history = [], forceWorker = null, signal } = {}) {
  const shown = [];
  const statuses = [];
  const r = await runTurn({ house, project: world, history, message, forceWorker, signal,
    onText: (t) => shown.push(t), onStatus: (l, d) => statuses.push([l, d || '']), onThinking: () => {} });
  return { r, shown: shown.join(''), statuses, world };
}
const makers = () => calls.filter((c) => c.who === 'maker');
const pe = (r) => ((r.project.docs || []).find((d) => d.name === 'Plot Essential.md') || {}).text || '';
const edits = (list) => `<edits>\n${JSON.stringify(list)}\n</edits>`;

/* ---------------------------------------------------------------- 1. plain talk */
{
  stand({ maker: 'Claire is the one who notices. I would keep her stubborn.' });
  const { r, shown } = await turn({ message: 'what do you think of Claire?' });
  ok('plain talk: one call, and it is the one he talks to \u2014 nobody decides for it first', calls.length === 1 && calls[0].who === 'maker', calls.map((c) => c.who));
  const sys = calls[0].sys;
  ok('it reads his own instructions first, word for word', sys.startsWith('You are Eni, a warm and exacting co-writer.'), sys.slice(0, 60));
  ok('it is greeted in his names', sys.includes('Hey Eni, this is Bruce.'));
  ok('it reads his WHOLE engine, word for word', sys.includes(ENGINE), `${sys.length} chars, engine ${ENGINE.length}`);
  ok('his engine comes after his instructions, the room after the engine', sys.indexOf('You are Eni') < sys.indexOf(ENGINE.slice(0, 200)) && sys.indexOf(ENGINE.slice(0, 200)) < sys.indexOf(ROOM_MARK));
  const ask = calls[0].last;
  ok('it reads the plot essential whole, word for word', ask.includes(PE.trim()), ask.slice(0, 200));
  ok('his words come after the documents, under his name', ask.indexOf('Bruce said:\nwhat do you think of Claire?') > ask.indexOf('## SCENE'));
  ok('the reply is what it said', r.reply === 'Claire is the one who notices. I would keep her stubborn.', r.reply);
  ok('and what streamed to the screen is the same words', shown === r.reply, shown);
  ok('nothing changed, nothing to put back', !r.cards.length && !r.batches.length && pe(r) === PE);
  ok('it is given room to write a document (the floor), never less', calls[0].body.max_tokens >= MAKER_FLOOR, calls[0].body.max_tokens);
}

/* -------------------------------------------- 2. a change it makes itself, in one step */
{
  stand({ maker: 'Done \u2014 majority is fifteen now.\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen.', replace: '- Majority is fifteen.', reason: 'the world got younger' }]) });
  const { r, shown, statuses } = await turn({ message: 'make the age of majority fifteen' });
  ok('a change that goes in cleanly: one call to the one he talks to, then the eye reads it back \u2014 clean, so nothing more', calls.map((c) => c.who).join(',') === 'maker,helper' && /Read back what was changed just now in Plot Essential\.md/.test(calls[1].last) && r.review && r.review.clean, calls.map((c) => c.who));
  ok('the change is in the document', pe(r).includes('- Majority is fifteen.') && !pe(r).includes('- Majority is sixteen.'));
  ok('nothing else moved', pe(r).replace('- Majority is fifteen.', '- Majority is sixteen.') === PE);
  ok('one card says what changed, and why', r.cards.length === 1 && r.cards[0].status === 'applied' && r.cards[0].reason === 'the world got younger', r.cards);
  ok('it can be put back', r.batches.length === 1 && undoBatch(r.project.docs, r.batches[0]).ok);
  ok('he reads its words, never the block', r.reply === 'Done \u2014 majority is fifteen now.', r.reply);
  ok('nothing of the block ever reached the screen while it streamed', !/<edits|find|Majority is sixteen|\[|\]/.test(shown), shown);
  ok('the status line said it was writing the changes', statuses.some(([l]) => l === 'writing the changes'), statuses);
}

/* ------------------------------------- 3. a quote that missed goes back to it, once */
{
  stand({ maker: (c) => (c.n === 0
    ? 'Changing it.\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen!', replace: '- Majority is fifteen.' }])
    : 'Quoted it right this time \u2014 it is in.\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen.', replace: '- Majority is fifteen.' }])) });
  const { r, shown } = await turn({ message: 'majority fifteen please' });
  ok('a missed quote: two steps', makers().length === 2, calls.map((c) => c.who));
  const rep = calls[1].last;
  ok('the house says it is the house, not him', rep.startsWith('(From the house, not Bruce'), rep.slice(0, 80));
  ok('it is told exactly what it quoted and why it missed', rep.includes('you quoted: "- Majority is sixteen!"') && /not in the document as written/.test(rep), rep.slice(0, 600));
  ok('it is shown the documents as they stand now', rep.includes('The documents, as they stand now, whole, word for word') && rep.includes('- Majority is sixteen.'));
  const line = 'CORE: Reads a room before he speaks.';
  const copies = calls[1].msgs.reduce((k, m) => k + String(m.content).split(line).length - 1, 0);
  ok('and only one copy of the documents is in what it reads \u2014 the newest, at the end of the house\u2019s note', copies === 1 && rep.includes(line), copies);
  ok('his message says the documents have changed and where the only copy is', calls[1].msgs.some((m) => m.role === 'user' && m.content.includes('The documents have changed since this was said') && m.content.includes('Bruce said:\nmajority fifteen please')));
  ok('its first reply is in front of it as it wrote it', calls[1].msgs.some((m) => m.role === 'assistant' && m.content.includes('- Majority is sixteen!')));
  ok('the second try lands', pe(r).includes('- Majority is fifteen.'));
  ok('no "not done" card for a miss it then put right', !r.cards.some((c) => c.status === 'refused'), r.cards);
  ok('he reads both steps, in order, as one reply', r.reply === 'Changing it.\n\nQuoted it right this time \u2014 it is in.', r.reply);
  ok('the screen showed the same', shown === r.reply, JSON.stringify(shown));
}
{
  stand({ maker: (c) => (c.n === 0
    ? 'Changing it.\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen!', replace: '- Majority is fifteen.' }])
    : 'I could not find those words to change.') });
  const { r } = await turn({ message: 'majority fifteen please' });
  ok('a miss it did not put right is still on a card for him', r.cards.filter((c) => c.status === 'refused').length === 1, r.cards);
  ok('and the document is untouched', pe(r) === PE);
}

/* ------------------------------------------ 4. a helper, called by name, reports back */
{
  stand({
    maker: (c) => (c.n === 0
      ? 'Let me have the eye read Claire back.\n<helper name="the eye">Read back Claire\u2019s dossier: is her CORE free of other people\u2019s names, and does it match what she does?</helper>'
      : 'The eye sharpened her core; the rest holds.'),
    helper: 'Read Claire\u2019s dossier and the timeline. Her core was vague.\n\n' + edits([{ file: 'Plot Essential.md', find: 'CORE: Stubborn, catches detail nobody else does.', replace: 'CORE: Stubborn; catches the detail nobody else does.', reason: 'clearer' }]),
  });
  const { r, shown } = await turn({ message: 'is Claire right?' });
  ok('the order on the wire: the one he talks to, its helper, then back to it', calls.map((c) => c.who).join(',') === 'maker,helper,maker', calls.map((c) => c.who));
  const eye = calls[1];
  ok('the eye reads its own part of the engine, not all of it', eye.sys.includes('Evidenced CLEAN vs False CLEAN') && eye.sys.length < ENGINE.length * 0.6, eye.sys.length);
  ok('the eye is given the task as it was written for it', eye.last.includes('is her CORE free of other people\u2019s names'), eye.last.slice(-400));
  ok('and told who asked', eye.last.includes('What Eni needs from you'));
  const rep = calls[2].last;
  ok('what the eye said comes back to the one he talks to', rep.includes('The eye says:') && rep.includes('Her core was vague.') && rep.includes('Its changes went in: Plot Essential.md (1)'), rep.slice(0, 500));
  ok('the eye\u2019s change is in the document', pe(r).includes('CORE: Stubborn; catches the detail nobody else does.'));
  ok('and on a card', r.cards.some((c) => c.status === 'applied' && c.reason === 'clearer'));
  ok('the helper call never reached the screen', !shown.includes('<helper') && !shown.includes('is her CORE free'), shown);
  ok('he reads both steps', r.reply === 'Let me have the eye read Claire back.\n\nThe eye sharpened her core; the rest holds.', r.reply);
}
{
  stand({ maker: (c) => (c.n === 0 ? '<helper name="the builder">build it</helper>' : 'I will build it myself.') });
  const { r } = await turn({ message: 'build it' });
  const rep = calls[1] ? calls[1].last : '';
  ok('a helper that does not exist is said, with the ones that do', /There is no helper called \u201cthe builder\u201d/.test(rep) && rep.includes('the eye, the worldbook keeper, the memory auditor, the instructions writer'), rep.slice(0, 300));
  ok('and nobody was sent', !calls.some((c) => c.who === 'helper'));
  ok('the reply is what it said after', r.reply === 'I will build it myself.', r.reply);
}
{
  stand({
    maker: (c) => (c.n === 0 ? '<helper name="eye">tidy</helper>' : 'Done.'),
    helper: 'Removing it.\n\n' + edits([{ delete_file: 'Plot Essential.md' }, { file: 'Plot Essential.md', clear: true }]),
  });
  const { r } = await turn({ message: 'check it' });
  ok('a helper can never delete or clear a document \u2014 only the one he talks to, when he asks', pe(r) === PE && (r.project.docs || []).length === 1, (r.project.docs || []).map((d) => d.name));
}

/* ---------------------------------------- 5. the checks: only what this turn brought in */
{
  stand({ maker: (c) => (c.n === 0
    ? 'Added the duel.\n\n' + edits([{ file: 'Plot Essential.md', insert_after: 'e001 [Mon 14 Apr 247, 09:00] [setup]: The showcase opened in the east hall.', replace: 'e002 [duel]: Claire challenged Jovan in the east hall.' }])
    : 'Dated it.\n\n' + edits([{ file: 'Plot Essential.md', find: 'e002 [duel]:', replace: 'e002 [Mon 14 Apr 247, 11:00] [duel]:' }])) });
  const { r } = await turn({ message: 'add that Claire challenged Jovan' });
  const rep = calls[1] ? calls[1].last : '';
  ok('an undated event it brought in is found by the checks and handed back to it', makers().length === 2 && /without a full date-time/.test(rep), rep.slice(0, 400));
  ok('it puts it right in the second step', pe(r).includes('e002 [Mon 14 Apr 247, 11:00] [duel]: Claire challenged Jovan in the east hall.'));
  ok('the only other call is the eye reading it back, once', calls.filter((c) => c.who !== 'maker').length === 1 && /Read back what was changed just now/.test(calls.find((c) => c.who !== 'maker').last));
}
{
  const OLD = PE.replace('e001 [Mon 14 Apr 247, 09:00] [setup]:', 'e001 [setup]:');
  stand({ maker: 'Fifteen.\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen.', replace: '- Majority is fifteen.' }]) });
  const { r } = await turn({ world: WORLD([{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: OLD }]), message: 'majority fifteen' });
  ok('a finding that was already there before this turn is not raised \u2014 no churn through the whole document', makers().length === 1, calls.map((c) => c.last.slice(0, 120)));
  ok('and the old line is left exactly as it was', pe(r).includes('e001 [setup]: The showcase'));
}

/* ------------------- 6. put it back still works after the checks repaired a change */
{
  stand({ maker: 'Fifteen.\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen.', replace: '- Majority is fifteen. [EPISTEMIC_VIOLATION]' }]) });
  const { r } = await turn({ message: 'majority fifteen' });
  ok('the checks take a working marker out of what it wrote', pe(r).includes('- Majority is fifteen.') && !pe(r).includes('[EPISTEMIC_VIOLATION]'));
  const u = undoBatch(r.project.docs, r.batches[0]);
  ok('and the change can still be put back (on 1.8.0 it refused for ever)', u.ok && u.changes[0].text === PE, u.why);
}
{
  stand({ maker: (c) => (c.n === 0
    ? 'Added.\n\n' + edits([{ file: 'Plot Essential.md', insert_after: 'e001 [Mon 14 Apr 247, 09:00] [setup]: The showcase opened in the east hall.', replace: 'e002 [duel]: Claire challenged Jovan.' }])
    : 'Dated.\n\n' + edits([{ file: 'Plot Essential.md', find: 'e002 [duel]:', replace: 'e002 [Mon 14 Apr 247, 11:00] [duel]:' }])) });
  const { r } = await turn({ message: 'add the challenge' });
  let docs = r.project.docs.map((d) => ({ name: d.name, text: d.text }));
  let chain = true;
  for (const b of r.batches.slice().reverse()) {
    const u = undoBatch(docs, b);
    if (!u.ok) { chain = false; break; }
    for (const ch of u.changes) docs = docs.map((d) => (d.name === ch.name ? { ...d, text: ch.text } : d));
  }
  ok('two steps of changes to one document put back newest first, all the way to where he was', chain && docs[0].text === PE, chain);
}

/* ------------------------ 7. a whole document, cut at the limit, is carried on */
{
  const NEW = PE.replace('## SCENE', '### Mira (smith | core | 30)\nID: Broad, scarred hands.\nCORE: Fixes what others throw away.\n\n## SCENE');
  const half = Math.floor(NEW.length / 2);
  stand({ maker: (c) => (c.n === 0
    ? { text: 'Rebuilt it with Mira in.\n\n<file name="Plot Essential.md">\n' + NEW.slice(0, half), finish: 'length' }
    : NEW.slice(half) + '\n</file>') });
  const { r, statuses } = await turn({ message: 'rebuild it with Mira the smith' });
  ok('cut inside a document, it is asked for the rest', makers().length === 2 && /stopped inside <file name="Plot Essential.md">/.test(makers()[1].last), calls.map((c) => c.last.slice(0, 120)));
  ok('the document is written whole, nothing lost at the seam', pe(r).trimEnd() === NEW.trimEnd() && pe(r).startsWith('# PLOT ESSENTIAL'), pe(r).length + ' vs ' + NEW.length);
  ok('he never sees the document in the reply', r.reply === 'Rebuilt it with Mira in.', r.reply);
  ok('the status line said which document it was writing, and how far along', statuses.some(([l, d]) => l === 'writing Plot Essential.md' && /words so far/.test(d)), statuses.filter(([l]) => /writing/.test(l)).slice(0, 3));
  ok('the reply is not marked cut \u2014 the house finished it', !r.cut);
}
{
  stand({ maker: { text: 'The harbour wall was built by the', finish: 'length' } });
  const { r } = await turn({ message: 'tell me about the wall' });
  ok('cut in its words (no document open) is a cut reply, for Go on', r.cut === true && r.reply === 'The harbour wall was built by the' && calls.length === 1, [r.cut, r.reply]);
}

/* ------------------------------------------------------- 8. a different story */
{
  stand({ maker: '<new_world/>' });
  const { r } = await turn({ message: "let's start a new story about a glass steppe" });
  ok('a new story in a world that has a plot essential: handed back for a world of its own', r.newStory === true && calls.length === 1);
  ok('nothing was written here', pe(r) === PE && !r.batches.length);
}
{
  stand({ maker: (c) => (c.n === 0 ? '<new_world/>' : "A glass steppe \u2014 let's talk it through.") });
  const { r } = await turn({ world: WORLD([]), message: "let's start a new story about a glass steppe" });
  ok('with no plot essential here, this world is the new one: it carries on here', !r.newStory && r.reply === "A glass steppe \u2014 let's talk it through." && calls.length === 2, [r.newStory, r.reply]);
}

/* ------------------------------------------- 9. clear and delete, when he asks */
{
  stand({ maker: 'Gone, and the plot essential is empty.\n\n' + edits([{ delete_file: 'Notes.md' }, { file: 'Plot Essential.md', clear: true }]) });
  const { r } = await turn({ world: WORLD([{ id: 'd1', name: 'Plot Essential.md', kind: 'pe', text: PE }, { id: 'd2', name: 'Notes.md', kind: 'notes', text: 'old notes' }]), message: 'delete my notes and clear the plot essential' });
  ok('the one he talks to deletes a document he asked to be deleted', !(r.project.docs || []).some((d) => d.name === 'Notes.md'));
  ok('and clears one he asked to be cleared', pe(r) === '' && (r.project.docs || []).some((d) => d.name === 'Plot Essential.md'));
  ok('both on cards, both can be put back', r.cards.filter((c) => c.status === 'applied').length === 2 && undoBatch(r.project.docs, r.batches[0]).ok);
}

/* ---------------------------------------------- 10. *regress and *card, said by the house */
{
  stand({ maker: 'Kept \u2014 she stays a lieutenant.' });
  const { r } = await turn({ message: '*regress Rukia keeps being called an unseated officer' });
  const reg = (r.project.docs || []).find((d) => d.name === 'Anti-regression registry.md');
  ok('*regress: the house keeps the line itself', reg && reg.text.includes('- Rukia keeps being called an unseated officer'));
  ok('and the one he talks to is told it is kept', calls[0].last.includes('The house has kept that line in Anti-regression registry.md'));
}
{
  stand({ maker: 'Built.' });
  await turn({ world: WORLD([]), message: 'I play the knight.\n*card\nTitle: Her Highness Needs A Minute\nPremise: a princess hides from her own coronation.' });
  ok('*card: the one he talks to is told what the house\u2019s own shortcut means, with the card', calls[0].last.includes("*card is this house's own shortcut") && calls[0].last.includes('Premise: a princess hides') && calls[0].last.includes('I play the knight.'));
}

/* ----------------------------------------------- 11. searching, his switch */
{
  const house = HOUSE({ settings: { searchInternet: 'on' }, connections: [{ id: 'h', name: 'Hermes', url: 'http://127.0.0.1:8642/v1', model: 'hermes-agent' }] });
  stand({
    maker: (c) => (c.n === 0 ? '<search>Bleach 13th Division lieutenant</search>' : 'Rukia is the lieutenant there, as canon has it.'),
    searcher: 'Rukia Kuchiki became lieutenant of the 13th Division (Bleach wiki).',
  });
  const { r } = await turn({ house, message: 'who is the 13th Division lieutenant in canon?' });
  ok('on: the room tells it how to have something looked up', calls[0].sys.includes('<search>'));
  ok('what it asked for is looked up, and put in front of it', calls.map((c) => c.who).join(',') === 'maker,searcher,maker' && calls[2].last.includes('Rukia Kuchiki became lieutenant'), calls.map((c) => c.who));
  ok('the search never reaches him', r.reply === 'Rukia is the lieutenant there, as canon has it.', r.reply);
  stand({ maker: 'Hello.' });
  await turn({ message: 'hi' });
  ok('off: not one word of searching is in what it reads', !calls[0].sys.includes('<search>') && !/Searching\./.test(calls[0].sys));
}

/* ------------------------------------------------------------- 12. Stop */
{
  const ctl = new AbortController();
  stand({ maker: (c, signal) => (c.n === 0
    ? 'Changed it, and having the eye look.\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen.', replace: '- Majority is fifteen.' }]) + '\n<helper name="the eye">read it back</helper>'
    : { text: 'unused', signal }),
    helper: () => { ctl.abort(); return 'Read it.'; } });
  const { r } = await turn({ message: 'fifteen, and check it', signal: ctl.signal });
  ok('Stop stops the turn', r.stopped === true && r.error === 'stopped', [r.stopped, r.error]);
  ok('what went in before Stop stays in, with its card and its way back', pe(r).includes('- Majority is fifteen.') && r.batches.length >= 1);
  ok('and the words he already saw are kept', r.reply === 'Changed it, and having the eye look.', r.reply);
  ok('nothing was asked of the one he talks to after Stop', calls.filter((c) => c.who === 'maker').length === 1, calls.map((c) => c.who));
}

/* ------------------------------ 13. changes with no words get one step to say them */
{
  stand({ maker: (c) => (c.n === 0 ? edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen.', replace: '- Majority is fifteen.' }]) : 'Fifteen it is.') });
  const { r } = await turn({ message: 'majority fifteen' });
  ok('a reply that was only a block: asked once to say what it did', makers().length === 2 && /Now tell Bruce, in your own voice, what you did/.test(makers()[1].last) && r.reply === 'Fifteen it is.', [calls.length, r.reply]);
}

/* -------------------- 14. "I changed it" with nothing changed: asked once, quietly */
{
  stand({ maker: (c) => (c.n === 0 ? "I've updated Claire's age to 17."
    : 'Here it is.\n\n' + edits([{ file: 'Plot Essential.md', find: '### Claire (student | core | 16)', replace: '### Claire (student | core | 17)' }])) });
  const { r, shown } = await turn({ message: 'Claire is 17 now' });
  ok('a claimed change with no block is sent back for the block', makers().length === 2 && /no change came back/.test(makers()[1].last));
  ok('and the change it then sends lands, its words joining the reply', pe(r).includes('### Claire (student | core | 17)') && r.reply === "I've updated Claire's age to 17.\n\nHere it is." && shown === r.reply, [r.reply, shown]);
}
{
  stand({ maker: (c) => (c.n === 0 ? 'I made Rukia a lieutenant back in the first draft, so she already is one.' : 'Right \u2014 nothing was changed just now.') });
  const { r, shown } = await turn({ message: 'is Rukia a lieutenant?' });
  ok('when the claim was about the past, the second answer is never shown to him', r.reply === 'I made Rukia a lieutenant back in the first draft, so she already is one.' && shown === r.reply, [r.reply, shown]);
}

/* --------------------- 15. his note at the end is the last thing read, every step */
{
  stand({ maker: (c) => (c.n === 0 ? '<helper name="the eye">look</helper>' : 'Done.'), helper: 'Fine.' });
  await turn({ house: HOUSE({ postNote: 'Stay warm, {{user}}.' }), message: 'check it' });
  const makers = calls.filter((c) => c.who === 'maker');
  ok('his note at the end is the last message of every step, his names read', makers.length === 2 && makers.every((c) => { const m = c.msgs[c.msgs.length - 1]; return m.role === 'system' && m.content === 'Stay warm, Bruce.'; }), makers.map((c) => c.msgs.slice(-1)));
  ok('and nobody else is sent it', !calls.filter((c) => c.who !== 'maker').some((c) => JSON.stringify(c.body).includes('Stay warm')));
}

/* ------------------------------ 16. a model too small for the whole world */
{
  stand({ maker: (c) => (c.n === 0 ? refusal(400, "This model's maximum context length is 32768 tokens. Please reduce the length of the messages.")
    : c.n === 1 ? '<need>Claire</need>' : 'Claire is sixteen.') });
  const { r } = await turn({ message: 'how old is Claire?' });
  ok('too long: asked again with the outline, which tells it how to ask for more', calls.length === 3 && calls[1].last.includes('Everything that is in it:') && calls[1].last.includes('<need>'), calls.map((c) => c.last.slice(0, 160)));
  ok('the part it asked for is put in front of it in full', calls[2].last.includes('CORE: Stubborn, catches detail nobody else does.'));
  ok('and it answers', r.reply === 'Claire is sixteen.', r.reply);
}

/* --------------------------------------------- 17. Go on lands like a turn */
{
  stand({ maker: 'and the rest of it.\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen.', replace: '- Majority is fifteen.' }]) });
  const world = WORLD();
  world.chats[0].turns = [{ role: 'writer', text: 'go', at: 1 }, { role: 'maker', text: 'Here is the first part', cut: true, cutBy: 'length', cards: [], batches: [], edits: [], at: 2 }];
  const { r } = await turn({ world, history: world.chats[0].turns, message: GO_ON, forceWorker: FRONT_ONLY });
  ok('Go on: the house\u2019s note, no speaker', calls[0].last.trim().endsWith(GO_ON) && !calls[0].last.includes('Bruce said:'));
  const snapshot = new Map(world.docs.map((d) => [d.name, d.text]));
  const landed = landContinuation(world, { chatId: 'c', snapshot, result: r, at: 1, words: r.reply, makerTurn: { cards: r.cards, batches: r.batches, edits: r.edits, cut: false, cutBy: '', thinking: '' } });
  const t = landed.world.chats[0].turns[1];
  ok('what the rest changed lands in the documents', landed.world.docs[0].text.includes('- Majority is fifteen.'));
  ok('its words join the cut reply, which is no longer cut', t.text === 'Here is the first part and the rest of it.' && !t.cut, t.text);
  ok('its cards and its way back join that reply', t.cards.length === 1 && t.batches.length === 1 && t.edits.length === 1);
  const again = landTurn(world, { chatId: 'c', snapshot, result: r, makerTurn: { role: 'maker', text: r.reply, cards: r.cards, batches: r.batches, at: 99 } });
  ok('a turn still lands the ordinary way', again.landed && again.world.chats[0].turns.length === 3);
}

/* ------------------------------------- 18. what streams to the screen, piece by piece */
{
  const said = [];
  const blocks = [];
  const v = makeVisibleStream((t) => said.push(t), (kind, name, body, done) => blocks.push([kind, name, done]));
  for (const piece of ['Hello <ed', 'its>[{"a":1}]</ed', 'its> world <file name="A.md">x', 'x</fi', 'le> end <3 and a < b', ' <helper name="the eye">t</helper> done<new_world/>.']) v.feed(piece);
  v.end();
  ok('the words stream; blocks, documents and helper calls never do, even cut in two', said.join('') === 'Hello  world  end <3 and a < b  done.', JSON.stringify(said.join('')));
  ok('each block is named as it is written', blocks.some((b) => b[0] === 'file' && b[1] === 'A.md') && blocks.some((b) => b[0] === 'helper' && b[1] === 'the eye') && blocks.some((b) => b[0] === 'edits' && b[2]));
  const raw = 'Hi.\n<edits>[{"file":"x","find":"a","replace":"b"}]</edits>\n<file name="B.md">\nbody\n</file>\n<helper name="eye">go</helper>\n<search>q</search>\nBye.';
  ok('what he reads of a whole reply: only its words', visibleText(raw) === 'Hi.\n\nBye.', JSON.stringify(visibleText(raw)));
  ok('a helper call inside a document it writes is part of the document, never a call', readHelpers('<file name="Prompt.md">\nuse <helper name="eye">x</helper> here\n</file>\nDone.').length === 0);
  ok('helper names are read loosely', readHelpers('<helper name="Worldbook Keeper">a</helper><helper for=\'memory auditor\'>b</helper><helper name=eye>c</helper>').map((h) => h.id).join(',') === 'worldbook,auditor,eye');
}

/* ----------------------------------- 19. the room, in every voice, as a person writes */
{
  const voices = [{ person: 'second', you: 'Bruce', maker: 'Eni' }, { person: 'second', you: '', maker: '' }, { person: 'first', you: 'Bruce', maker: 'Eni' }, { person: 'first', you: '', maker: '' }];
  for (const v of voices) {
    const t = frontBody(v, { search: true });
    const name = `${v.person} person, ${v.you ? 'named' : 'unnamed'}`;
    const broken = /\b(?:talks to I|I and \w+ are|you and they|they and I|undefined|null)\b|\{\{/i;
    ok(`the room (${name}) has no broken grammar`, !broken.test(t) && !/(?:^|[.:!?]\s+)the author/.test(t), (t.match(broken) || t.match(/(?:^|[.:!?]\s+)the author.{0,30}/) || [''])[0]);
    ok(`the room (${name}) says how to change a document, call a helper and start a new world`, t.includes('<edits>') && t.includes('<file name=') && t.includes('<helper name="the eye">') && t.includes('<new_world/>'));
    ok(`the room (${name}) is in its own voice`, v.person === 'first' ? /\bI make every change myself\b/.test(t) && !/\bYou make every change\b/.test(t) : /\bYou make every change yourself\b/.test(t));
  }
}

/* -------------------------------------------------- 20. a turn always ends */
{
  stand({ maker: (c) => `Try ${c.n}.\n\n` + edits([{ file: 'Plot Essential.md', find: `never there ${c.n}`, replace: 'x' }]) });
  const { r } = await turn({ message: 'loop' });
  ok(`a reply that never lands stops after ${MAX_STEPS} steps, and says what did not go in`, calls.length === MAX_STEPS && r.cards.some((c) => c.status === 'refused'), calls.length);
}

/* ------------------------- 21. a failure after words were said is still said */
{
  stand({ maker: (c) => (c.n === 0 ? 'Asking the eye.\n<helper name="eye">look</helper>' : refusal(401, 'Incorrect API key provided')), helper: 'Fine.' });
  const { r } = await turn({ message: 'check it' });
  ok('a failure in a later step is on a card, exactly, beside the words already said', r.reply === 'Asking the eye.' && r.cards.some((c) => c.failure && /key/.test(c.why)), r.cards);
}
{
  stand({ maker: 'Here.\n\n<file name="Prompt.md">\nWhen unsure, write <search>the thing</search> and wait.\n</file>' });
  const { r } = await turn({ house: HOUSE({ settings: { searchInternet: 'on' }, connections: [{ id: 'h', name: 'Hermes', url: 'http://127.0.0.1:8642/v1', model: 'hermes-agent' }] }), message: 'write me a prompt' });
  ok('a <search> inside a document it writes is part of the document, never a lookup', makers().length === 1 && !calls.some((c) => c.who === 'searcher') && ((r.project.docs || []).find((d) => d.name === 'Prompt.md') || {}).text.includes('<search>the thing</search>'), calls.map((c) => c.who));
}

/* ------------------------------ 22. what was kept from the house before it */
{
  stand({ maker: 'Hello.' });
  const h = HOUSE(); h.settings.yourName = '';
  await turn({ house: h, message: 'hi there' });
  ok('with no name set, his words are never "you said:" \u2014 they are what was just said to it', calls[0].last.includes('What was just said to you:\nhi there') && !/\byou said:/i.test(calls[0].last));
}
{
  const world = WORLD();
  world.chats[0].turns = [{ role: 'writer', text: 'how should the prompt open?', at: 1 }, { role: 'maker', text: 'put <thinking> tags at the top, then write the scene', at: 2 }];
  stand({ maker: 'Yes.' });
  await turn({ world, history: world.chats[0].turns, message: 'and then?' });
  ok('its own earlier reply goes back whole \u2014 a tag named in a sentence is words', calls[0].msgs.some((m) => m.role === 'assistant' && m.content === 'put <thinking> tags at the top, then write the scene'));
}
{
  stand({ maker: { text: 'Fifteen now.', thinking: 'I will change it.\n<edits>[{"file":"Plot Essential.md","find":"- Majority is sixteen.","replace":"- Majority is fifteen."}]</edits>' } });
  const { r } = await turn({ message: 'majority fifteen' });
  ok('a block written in its thinking is still a block (Cozy Chat v5.13.1)', pe(r).includes('- Majority is fifteen.') && r.reply === 'Fifteen now.', r.reply);
}
{
  let late = 0;
  stand({ maker: (c) => {
    const last = c.msgs[c.msgs.length - 1];
    if (last.role === 'system') { late++; return refusal(400, 'System message must be at the beginning of the conversation'); }
    return 'Warm, always.';
  } });
  const house = HOUSE({ postNote: 'Stay warm.' });
  const { r } = await turn({ house, message: 'hello' });
  const second = calls[1];
  ok('a model that takes no system message after his: the note goes at the end of his message, the same turn', late === 1 && second && second.msgs[second.msgs.length - 1].role === 'user' && second.last.trim().endsWith('Stay warm.') && r.reply === 'Warm, always.', [late, second && second.last.slice(-60)]);
  ok('and that is remembered for the model', Boolean(house.connections[0].learned && house.connections[0].learned.noLateSystem));
}
{
  stand({
    maker: (c) => (c.n === 0 ? '<helper name="the worldbook keeper">Start the worldbook for this world from what Bruce said.</helper>' : 'The worldbook is started, with the city in it.'),
    helper: (c) => 'Started it.\n\n' + edits([{ file: 'The Ashwood Pact.json', entries: [{ name: 'Ash Harbour', keys: [], content: 'A drowned harbour city. She says "the sea keeps what it is owed."', strategy: 'blue', order: 300, position: 'before_char' }], reason: 'the world' }]),
  });
  const { r } = await turn({ message: 'start a worldbook for this world' });
  const keeper = calls.find((c) => c.who === 'helper');
  ok('the worldbook keeper reads its own craft, and is told which worldbook to start, by name', keeper && /worldbook architect for SillyTavern/.test(keeper.sys) && keeper.last.includes('There is no worldbook in this world yet') && keeper.last.includes('Call it The Ashwood Pact.json'), keeper && keeper.last.slice(-500));
  const book = (r.project.docs || []).find((d) => d.name === 'The Ashwood Pact.json');
  ok('its entries, handed over as data with their quotes, start the worldbook', book && book.kind === 'worldbook' && JSON.parse(book.text)[0].content.includes('"the sea keeps what it is owed."'), book && book.text.slice(0, 200));
}
{
  stand({
    maker: (c) => (c.n === 0 ? '<helper name="worldbook keeper">Start the worldbook.</helper>' : 'Before it can start: what is the world called, and who rules it?'),
    helper: 'There is nothing to build from yet.\n\n<ask>What is this world called, and who rules it?</ask>',
  });
  const { r } = await turn({ world: WORLD([]), message: 'start a worldbook' });
  ok('what a helper needs him to decide comes back to the one he talks to, word for word', calls[2] && calls[2].last.includes('It needs Bruce to decide:\nWhat is this world called, and who rules it?') && r.asks.length === 1 && r.reply.startsWith('Before it can start'), calls.map((c) => c.who));
}
{
  stand({
    maker: (c) => (c.n === 0 ? '<helper name="the instructions writer">Write a short prompt that opens with a thinking block.</helper>' : 'It wrote the prompt, and it has one question.'),
    helper: 'Wrote it.\n\n<file name="Opening.md">\nOpen with <thinking> and plan the scene.\n</file>\n\n<ask>Should the plan be in English or in Japanese?</ask>',
  });
  const { r } = await turn({ world: WORLD([]), message: 'write me a prompt' });
  const doc = (r.project.docs || []).find((d) => d.name === 'Opening.md');
  ok('a document a helper writes holding <thinking> is written whole, and its question after it is kept', doc && doc.text === 'Open with <thinking> and plan the scene.' && calls[2] && calls[2].last.includes('Should the plan be in English or in Japanese?'), [doc && doc.text, calls.length]);
}
{
  stand({
    maker: (c) => (c.n === 0 ? '<helper name="the eye">tighten Claire</helper>' : 'Done.'),
    helper: (c) => (c.n === 0 ? 'Tightened.\n\n' + edits([{ file: 'Plot Essential.md', find: 'CORE: Stubborn, catches detail nobody ELSE does.', replace: 'CORE: Stubborn; catches what others miss.' }])
      : 'Quoted it right.\n\n' + edits([{ file: 'Plot Essential.md', find: 'CORE: Stubborn, catches detail nobody else does.', replace: 'CORE: Stubborn; catches what others miss.' }])),
  });
  const { r } = await turn({ message: 'tighten Claire' });
  ok('a helper\u2019s quote that missed goes back to the helper once, and lands', calls.filter((c) => c.who === 'helper').length === 2 && /could not be placed/.test(calls.filter((c) => c.who === 'helper')[1].last) && pe(r).includes('CORE: Stubborn; catches what others miss.') && !r.cards.some((c) => c.status === 'refused'), calls.map((c) => c.who));
}
{
  const house = HOUSE({ settings: { searchInternet: 'on' }, connections: [{ id: 'h', name: 'Hermes', url: 'http://127.0.0.1:8642/v1', model: 'hermes-agent' }] });
  stand({
    maker: (c) => (c.n === 0 ? '<helper name="the worldbook keeper">Add an entry for the 13th Division as canon has it.</helper>' : 'Added, from canon.'),
    helper: (c) => (c.n === 0 ? '<search>Bleach 13th Division captain</search>' : 'Added it.\n\n' + edits([{ file: 'The Ashwood Pact.json', entries: [{ name: '13th Division', keys: ['13th Division'], content: 'Led by Ukitake.', strategy: 'green' }] }])),
    searcher: 'Jushiro Ukitake was captain of the 13th Division (Bleach wiki).',
  });
  await turn({ house, message: 'add the 13th division to the worldbook' });
  const helpers = calls.filter((c) => c.who === 'helper');
  ok('a helper that needs a fact while it works has it looked up, and is asked again with it', calls.some((c) => c.who === 'searcher') && helpers.length === 2 && helpers[1].last.includes('Jushiro Ukitake was captain'), calls.map((c) => c.who));
}
{
  stand({ maker: (c) => (c.n === 0 ? '<helper name="the eye">look</helper>' : 'Done.'), helper: 'Fine.' });
  await turn({ house: HOUSE({ connections: [{ id: 'c2', name: 'cheap', url: 'http://cheap.in/v1', model: 'cheap-model' }], agentConnections: { eye: 'c2' } }), message: 'check it' });
  ok('a helper given its own connection rides it; the one he talks to keeps his', calls.find((c) => c.who === 'helper').body.model === 'cheap-model' && calls.filter((c) => c.who === 'maker').every((c) => c.body.model === 'm1'));
}

/* ------------------------------------------- 23. what was sent, every request of it (v2.1) */
{
  stand({
    maker: (c) => (c.n === 0 ? 'Asking the eye.\n<helper name="the eye">look</helper>' : { text: 'Done.', usage: { prompt_tokens: 41234, completion_tokens: 56, prompt_tokens_details: { cached_tokens: 40000 } } }),
    helper: 'Fine.',
  });
  const house = HOUSE(); house.connections[0].key = 'sk-very-secret';
  const { r } = await turn({ house, message: 'check it' });
  const sent = r.sent || [];
  ok('every request of the turn is kept, in order, with who it was for', sent.map((x) => x.who).join(' | ') === 'the one you talk to \u2014 step 1 | the eye | the one you talk to \u2014 step 2', sent.map((x) => x.who));
  ok('each with where it went, its model and its body exactly as sent', sent.every((x) => x.url === 'http://stand.in/v1/chat/completions' && x.model === 'm1' && Array.isArray(x.body.messages)) && JSON.stringify(sent[0].body) === JSON.stringify(calls[0].body), sent.map((x) => x.url));
  ok('never his key', !JSON.stringify(sent).includes('sk-very-secret'));
  const sys = sent[0].body.messages[0].content;
  const part = (name) => (sent[0].parts || []).find((x) => x.name.startsWith(name));
  ok('the one he talks to\u2019s reading is cut into its three parts, exactly', part('Your engine') && sys.slice(part('Your engine').start, part('Your engine').end) === ENGINE
    && sys.slice(part('How this room works').start, part('How this room works').end).startsWith('How this room works')
    && sys.slice(0, part('Your instructions').end).startsWith('You are Eni'), (sent[0].parts || []).map((x) => [x.name, x.start, x.end]));
  ok('the service\u2019s own count is kept when it sends one', sent[2].usage && sent[2].usage.in === 41234 && sent[2].usage.out === 56 && sent[2].usage.cached === 40000, sent[2].usage);
  ok('and is left empty when it does not, never made up', sent[0].usage === null, sent[0].usage);
  ok('how long each took', sent.every((x) => Number.isFinite(x.ms)));
}
{
  eq2('a count in OpenAI\u2019s shape', countOf({ prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 64 } }), { in: 100, out: 7, cached: 64 });
  eq2('in Anthropic\u2019s, what was read from cache counted in', countOf({ input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 }), { in: 100, out: 5, cached: 90 });
  eq2('in DeepSeek\u2019s', countOf({ prompt_tokens: 50, completion_tokens: 2, prompt_cache_hit_tokens: 30 }), { in: 50, out: 2, cached: 30 });
  eq2('nothing said is nothing', countOf({}), null);
}

/* ------------------------------------------- 24. the example he starts from (v2.1) */
{
  const p = personaOf({ settings: { makerName: 'Lilith', yourName: 'Bruce' }, personaFrame: EXAMPLE_FRAME });
  const opening = openingFor(p, 'BODY');
  ok('the example reads as his names, in the voice it is written in', opening.startsWith('You are Lilith, a vampire.') && opening.includes('Now you keep worlds with Bruce.') && !opening.includes('{{'), opening.slice(0, 80));
  const note = noteAtTheEnd({ settings: { makerName: 'Lilith', yourName: 'Bruce' }, postNote: EXAMPLE_NOTE }, p);
  ok('the example note at the end reads as the names, sent as a system message unless he says user', note && note.role === 'system' && note.content.startsWith('Stay Lilith:') && note.content.includes('Answer Bruce first'));
  ok('and as a user message when he says so', noteAtTheEnd({ settings: { noteRole: 'user' }, postNote: EXAMPLE_NOTE }, p).role === 'user');
  ok('a brand-new house begins with the example', shouldGiveExamples({ settings: {}, personaFrame: '', postNote: '', connections: [] }));
  ok('a house he has set up is never touched', !shouldGiveExamples({ settings: {}, personaFrame: 'You are Eni.', postNote: '', connections: [] }) && !shouldGiveExamples({ settings: {}, personaFrame: '', postNote: '', connections: [{ id: 'c' }] }) && !shouldGiveExamples({ settings: { examplesGiven: true }, connections: [] }));
}

/* ------------------------------------------- 25. the second pass (v2.2) */
{
  stand({
    maker: (c) => (c.n === 0
      ? 'Made her easier to sway.\n\n' + edits([{ file: 'Plot Essential.md', find: 'CORE: Stubborn, catches detail nobody else does.', replace: 'CORE: Easily swayed, misses details.' }])
      : 'The eye was right \u2014 she still refuses Jovan, so she stays stubborn.\n\n' + edits([{ file: 'Plot Essential.md', find: 'CORE: Easily swayed, misses details.', replace: 'CORE: Stubborn, but rattled since the duel.' }])),
    helper: 'FOUND\n- "CORE: Easily swayed, misses details." contradicts her bond "\u2192 Jovan: refuses to back down": she should stay stubborn.\n\n' + edits([{ file: 'Plot Essential.md', find: 'ID: Small, freckled.', replace: 'ID: THE EYE WROTE THIS' }]),
  });
  const { r } = await turn({ message: 'make Claire easier to sway' });
  const eye = calls.filter((c) => c.who === 'helper');
  ok('what changed is read back by the eye before the turn ends, with exactly what changed', eye.length === 1 && eye[0].last.includes('was: CORE: Stubborn, catches detail nobody else does.') && eye[0].last.includes('now: CORE: Easily swayed, misses details.') && eye[0].sys.includes('Evidenced CLEAN vs False CLEAN'), eye.map((c) => c.last.slice(-500)));
  ok('what it found goes to the one he talks to, which puts it right in one more step', makers().length === 2 && makers()[1].last.includes('The eye read back what you changed this turn') && makers()[1].last.includes('contradicts her bond') && pe(r).includes('CORE: Stubborn, but rattled since the duel.'), makers().map((c) => c.last.slice(0, 200)));
  ok('the eye changes nothing itself \u2014 one writer', !pe(r).includes('THE EYE WROTE THIS') && pe(r).includes('ID: Small, freckled.'));
  ok('once a turn: the fix is not read back again', eye.length === 1);
  ok('and the turn says what the eye found', r.review && r.review.found && /contradicts her bond/.test(r.review.notes) && !/^FOUND/.test(r.review.notes), r.review);
  ok('he reads both steps\u2019 summaries, nothing more', r.reply === 'Made her easier to sway.\n\nThe eye was right \u2014 she still refuses Jovan, so she stays stubborn.', r.reply);
}
{
  stand({ maker: 'A worldbook entry for the harbour.\n\n' + edits([{ file: 'The Ashwood Pact.json', entries: [{ name: 'Harbour', keys: ['harbour'], content: 'A cold harbour.', strategy: 'green' }] }]) });
  const { r } = await turn({ message: 'add the harbour to the worldbook' });
  ok('a worldbook is not read back by the plot essential\u2019s eye', !calls.some((c) => c.who === 'helper') && !r.review);
  stand({ maker: 'Nothing to change.' });
  const t2 = await turn({ message: 'what do you think?' });
  ok('and nothing is read back when nothing changed', !calls.some((c) => c.who === 'helper') && !t2.r.review);
}
{
  stand({ maker: (c) => (c.n === 0 ? 'Fifteen, and having the eye look.\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen.', replace: '- Majority is fifteen.' }]) + '\n<helper name="the eye">read back the age of majority</helper>' : 'The eye is happy.'), helper: 'Fine \u2014 the age reads cleanly.' });
  await turn({ message: 'majority fifteen, and check it' });
  ok('when the one he talks to already sent the eye after its change, it is not sent twice', calls.filter((c) => c.who === 'helper').length === 1, calls.map((c) => c.who));
}
{
  stand({ maker: 'Fifteen.\n<audit>EXPERT EYE: TIER A \u2014 CLEAN. SCAN EVIDENCE: e001 checked.</audit>\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen.', replace: '- Majority is fifteen.' }]) });
  const { r, shown, statuses } = await turn({ message: 'majority fifteen' });
  ok('his engine\u2019s own check never fills the message: he reads a short summary', r.reply === 'Fifteen.' && !shown.includes('EXPERT EYE'), [r.reply, shown]);
  ok('it is kept, for the fold under the reply', r.audit === 'EXPERT EYE: TIER A \u2014 CLEAN. SCAN EVIDENCE: e001 checked.', r.audit);
  ok('while it streams, the line says it is checking its work', statuses.some(([l]) => l === 'checking its work'), statuses.map((x) => x[0]).filter(Boolean));
  ok('the room tells it to keep the message short and the check in the block', calls[0].sys.includes('keep it short: what you changed, where, and why') && calls[0].sys.includes('<audit>'));
}
{
  const ctl = new AbortController();
  stand({ maker: 'Fifteen.\n\n' + edits([{ file: 'Plot Essential.md', find: '- Majority is sixteen.', replace: '- Majority is fifteen.' }]), helper: () => { ctl.abort(); return 'CLEAN'; } });
  const { r } = await turn({ message: 'majority fifteen', signal: ctl.signal });
  ok('Stop during the read-back stops the turn, and the change stays with its way back', r.stopped && pe(r).includes('- Majority is fifteen.') && r.batches.length === 1, [r.stopped, r.error]);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('  FAIL ' + f); process.exit(1); }
