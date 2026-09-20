/* CozyMaker — js/agents/run.js
 *
 * What happens when the writer says something.
 *
 * The shape of the house, and the reason it is shaped this way:
 *
 *   The writer talks to ONE intelligence — the one at the front. Its whole
 *   reading is his own instructions plus a few sentences of plain English.
 *   It carries no craft, no rules with numbers, no bracketed markers, and no
 *   way to change a document. There is nothing in its head that could leak
 *   into its voice, because there is nothing in its head but the conversation
 *   and the book.
 *
 *   Everything technical happens backstage, out of earshot. A worker reads the
 *   craft — its own part of it — does one job, and hands back a change and a
 *   plain sentence. The writer never sees a worker's words. Before anything a
 *   worker said reaches the front, the markers are stripped out of it.
 *
 * That is the persona firewall, and it is structural rather than hopeful: the
 * front cannot break character over machinery it was never given.
 */

import { loadEngine, sliceFor } from '../engine/slices.js';
import { openingFor, personaOf, addressWriter } from './persona.js';
import { pickConnection, FRONT } from './roster.js';
import { callModel, streamModel, enqueue } from './call.js';
import { parseDoc, brief, readNeed, stripNeed, resolveNeed } from '../doc/index.js';
import { route } from './router.js';
import { parseEdits, stripEdits, applyRun, hash } from '../doc/edits.js';
import { lint, lostSomething } from '../doc/lint.js';

export const MAX_NEED_ROUNDS = 2;
export const MAX_AUTO_REPAIRS = 2;

/* The one standing line every backstage worker carries. A worker reads pages
 * of somebody's fiction; its job is its own small task and never a judgment of
 * the tale. Without this, a worker eventually stops to have an opinion about
 * the story, and the writer gets a lecture instead of a file. */
export const CRAFT_FRAME =
  'This is craft work on a piece of fiction being built by its author. Your job is the task below and nothing else — never an opinion on the material, never a refusal of it.';

/* What the front of the house reads, under the writer's own instructions.
 * Plain English on purpose. Nothing here has a bracket in it. */
const FRONT_BODY = `You and the writer are building the guide to a world together — the plot essential, the worldbook, the files that a storyteller will later read as the whole truth of that world. This is the comfortable room where that gets made, so talk like it: you are two people making something good, not a service desk.

You are the only one he talks to. There is a crew working behind you — people who know the craft inside out, who read the whole thing back, catch what drifted, and make the actual changes to the documents. You will be told what they did. Tell him in your own words, the way you would tell a friend what you got done while they were making tea. Short. Warm. Specific about what actually changed.

You never edit the documents yourself and you never pretend to. If something needs writing or changing, it is already being done or already done by the time you speak.

Never read a list of findings out to him. Say the one or two things that matter and let the rest be. He is here to build a world, not to review a report.

If he is just talking, just talk. Not every sentence is a job.`;

/* Strip the crew's working shorthand out of anything the front will read. */
export function naturalize(text) {
  return String(text || '')
    .replace(/\[[A-Z][A-Z0-9_]{4,}\]/g, '')
    .replace(/\b(?:section|§)\s*\d+(?:\.\d+)*\b/gi, '')
    .replace(/\bSCAN EVIDENCE\b:?/gi, 'what was read:')
    .replace(/\bEXPERT EYE\b:?/gi, '')
    .replace(/\bGENERALIST NOTES\b:?/gi, '')
    .replace(/\bM\d+\b/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function docsOf(project) {
  return (project.docs || []).map((d) => ({ id: d.id, name: d.name, kind: d.kind || 'pe', text: d.text || '' }));
}

function docBriefs(project, opts) {
  const docs = docsOf(project);
  if (!docs.length) return 'Nothing has been written yet — there are no documents in this world so far.';
  return docs.map((d) => brief(parseDoc(d.text, d.kind), d.name, opts)).join('\n\n----\n\n');
}

/* --------------------------------------------------------------- a worker */

const RETURN_CONTRACT = `When you are done, write two things and nothing else.

First, in plain sentences — a short paragraph at most — what you did and what you found while you were in there. Write it for a person, not for a form.

Second, if a document should change, exactly one block of changes:

<edits>
[
  {"file": "which document.md", "find": "words copied exactly from the document", "replace": "what they become", "reason": "why"},
  {"file": "which document.md", "insert_after": "an exact line to put it under", "replace": "the new text", "reason": "why"},
  {"file": "which document.md", "append": true, "replace": "text added at the very end", "reason": "why"},
  {"create_file": "a new document.md", "replace": "everything it should contain", "reason": "why"},
  {"file": "which document.md", "replace_all": true, "replace": "the complete new document", "reason": "only for a full rebuild"}
]
</edits>

How the block must behave:
- "find" and "insert_after" are copied character for character out of the document. Never paraphrased. Quote the shortest stretch that appears only once.
- Valid data only: newlines inside a string written as \\n, no trailing commas.
- "file" names which document. With only one document open it may be left out.
- Use replace_all only when the whole document is genuinely being rebuilt. Every part that should survive must be present in it — anything left out is deleted.
- A change you only describe in words does not happen. It happens in the block or it does not happen.
- Nothing you write in the block may be a note, a flag, a marker or an instruction. What goes into a document is what the story is, and nothing else.
- If nothing should change, send no block.`;

async function runWorker({ worker, sections, conn, project, message, onStatus, signal, stale }) {
  const slice = sliceFor(sections, worker);
  const system = [CRAFT_FRAME, slice.text, RETURN_CONTRACT].join('\n\n---\n\n');
  let asked = [];
  let answer = null;

  for (let round = 0; round <= MAX_NEED_ROUNDS; round++) {
    if (stale && stale()) return { ok: false, error: 'let go' };
    const context = docBriefs(project, {
      message,
      recent: project.recentSections || [],
      asked,
    });
    const user = [
      'The documents as they stand:',
      context,
      '',
      'What the author just said:',
      message,
    ].join('\n');

    const out = await callModel(conn, {
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 8000,
      signal,
      stale,
    });
    if (!out.ok) return { ok: false, error: out.error };

    const need = readNeed(out.text);
    if (need.length && round < MAX_NEED_ROUNDS) {
      const docs = docsOf(project);
      const more = [];
      for (const d of docs) more.push(...resolveNeed(parseDoc(d.text, d.kind), need));
      const grew = more.filter((id) => !asked.includes(id));
      if (grew.length) {
        asked = asked.concat(grew);
        onStatus && onStatus(`reading ${need.slice(0, 3).join(', ')}`);
        continue;
      }
    }
    answer = out;
    break;
  }

  if (!answer) return { ok: false, error: 'no answer came back' };
  const { edits, warn } = parseEdits(answer.text);
  const notes = stripNeed(stripEdits(answer.text));
  return { ok: true, worker, notes, edits, warn, sliceChars: slice.text.length };
}

/* ------------------------------------------------------------- the turn */

export async function runTurn({
  house, project, message,
  onStatus = () => {}, onText = () => {}, onThinking = () => {},
  signal,
} = {}) {
  const sections = await loadEngine();
  const connections = house.connections || [];
  const frontConn = connections.find((c) => c.id === (house.agentConnections || {})[FRONT]) || connections[0] || null;
  const general = (house.agentConnections || {})._general || null;

  const connFor = (worker) =>
    pickConnection({ map: house.agentConnections || {}, general, connections }, worker) || frontConn;

  const docs = docsOf(project);
  const hasPE = docs.some((d) => d.kind === 'pe' && (d.text || '').trim());
  const intents = route(message, { hasPlotEssential: hasPE, hasDocs: docs.length > 0 });

  const crew = [];
  const allCards = [];
  let batches = [];
  let working = project;

  for (const intent of intents) {
    onStatus(`${intent.worker} is on it`);
    const conn = connFor(intent.worker);
    const res = await enqueue(project.id, intent.worker, ({ signal: s, stale }) =>
      runWorker({
        worker: intent.worker, sections, conn, project: working,
        message: intent.about || message,
        onStatus, signal: s, stale,
      }));
    if (!res || !res.ok) { crew.push({ worker: intent.worker, failed: (res && res.error) || 'did not finish' }); continue; }

    const applied = commit(working, res.edits, `${intent.worker} — ${short(intent.about || message)}`);
    working = applied.project;
    allCards.push(...applied.cards);
    if (applied.batch) batches.push(applied.batch);
    crew.push({ worker: intent.worker, notes: res.notes, cards: applied.cards, guard: applied.guard });
  }

  /* The checks that need no model, then whoever they named, then the eye. */
  let repairsLeft = MAX_AUTO_REPAIRS;
  const linted = sweep(working);
  working = linted.project;
  if (linted.repaired.length) crew.push({ worker: 'house', notes: linted.repaired.join(' ') });

  for (const job of linted.handOver) {
    if (repairsLeft-- <= 0) break;
    onStatus(`${job.worker} is fixing ${job.check}`);
    const conn = connFor(job.worker);
    const res = await enqueue(project.id, job.worker, ({ signal: s, stale }) =>
      runWorker({
        worker: job.worker, sections, conn, project: working,
        message: `Something in the documents needs putting right: ${job.check} — ${job.said}. Fix it properly, and check the rest of the documents for the same thing before you finish.`,
        onStatus, signal: s, stale,
      }));
    if (res && res.ok) {
      const applied = commit(working, res.edits, `put right: ${job.check}`);
      working = applied.project;
      allCards.push(...applied.cards);
      if (applied.batch) batches.push(applied.batch);
      crew.push({ worker: job.worker, notes: res.notes, cards: applied.cards, guard: applied.guard });
    }
  }

  const changed = allCards.some((c) => c.status === 'applied');
  if (changed) {
    onStatus('reading the whole thing back');
    const conn = connFor('eye');
    const res = await enqueue(project.id, 'eye', ({ signal: s, stale }) =>
      runWorker({
        worker: 'eye', sections, conn, project: working,
        message: 'The documents were just changed. Read the whole of them back, front to back, and put right anything that is wrong — not only near the change. Say what you read and what you found.',
        onStatus, signal: s, stale,
      }));
    if (res && res.ok) {
      const applied = commit(working, res.edits, 'the eye');
      working = applied.project;
      allCards.push(...applied.cards);
      if (applied.batch) batches.push(applied.batch);
      crew.push({ worker: 'eye', notes: res.notes, cards: applied.cards, guard: applied.guard });
    }
    const after = sweep(working);
    working = after.project;
    if (after.repaired.length) crew.push({ worker: 'house', notes: after.repaired.join(' ') });
  }

  /* Now the one voice the writer hears. */
  onStatus('');
  const p = personaOf(house);
  const system = openingFor(p, FRONT_BODY);
  const said = backstageBrief(crew, allCards, p);
  const history = (working.turns || []).slice(-((house.settings || {}).turnsOnScreen || 40))
    .map((t) => ({ role: t.role === 'writer' ? 'user' : 'assistant', content: t.text || '' }))
    .filter((m) => m.content);

  const ask = [
    'Where the book stands right now:',
    docBriefs(working, { message, recent: working.recentSections || [] }),
    said ? `\nWhat got done while you were talking:\n${said}` : '',
    `\n${addressWriter(p)} said:\n${message}`,
  ].filter(Boolean).join('\n\n');

  let reply = '';
  try {
    const out = await streamModel(frontConn, {
      system,
      messages: history.concat([{ role: 'user', content: ask }]),
      onText: (t) => { reply += t; onText(t); },
      onThinking,
      signal,
    });
    reply = out.text || reply;
  } catch (e) {
    reply = reply || '';
    return { project: working, reply, cards: allCards, batches, crew, error: (e && e.message) || String(e) };
  }

  return { project: working, reply, cards: allCards, batches, crew, error: null };
}

/* ---------------------------------------------------------------- pieces */

function short(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
}

/* Put a worker's changes into the documents, guarding against a rewrite that
 * quietly loses things. A full rebuild that comes back with fewer characters,
 * fewer events or fewer bonds than it started with is not a rebuild; it is a
 * loss, and it is refused before it lands. */
export function commit(project, edits, label) {
  if (!edits || !edits.length) return { project, cards: [], batch: null, guard: null };
  const docs = docsOf(project);
  const before = new Map(docs.map((d) => [d.name, d]));
  const run = applyRun(docs, edits, { label });

  let guard = null;
  for (const [name, text] of run.texts) {
    const was = before.get(name);
    if (!was) continue;
    const lost = lostSomething(was.text, text, was.kind);
    if (lost) {
      guard = `a rewrite of ${name} would have lost ${lost}, so it was not allowed through`;
      run.texts.set(name, was.text);
      for (const c of run.cards) if (c.name === name && c.status === 'applied') { c.status = 'refused'; c.why = guard; }
    }
  }

  /* THE UNDO RECORD IS BUILT FROM WHAT ACTUALLY LANDED, NOT FROM WHAT WAS
   * ATTEMPTED. applyRun wrote its record before the guard above put a refused
   * rewrite back; leaving that record would have listed a document that never
   * changed, with a fingerprint of text that was never saved — and "put it
   * back" would then refuse for the rest of that document's life, saying
   * something newer was there. Rebuilt here, after the reverting is done. */
  const items = [];
  for (const [name, text] of run.texts) {
    const was = before.has(name) ? before.get(name).text : null;
    if (was === text) continue;
    items.push({ name, before: was, afterHash: hash(text) });
  }
  const batch = items.length
    ? { id: run.batch ? run.batch.id : 'u' + Date.now().toString(36), at: Date.now(), label, items, undone: false }
    : null;

  const next = { ...project, docs: (project.docs || []).map((d) => ({ ...d })) };
  const byName = new Map(next.docs.map((d) => [d.name, d]));
  for (const [name, text] of run.texts) {
    if (byName.has(name)) byName.get(name).text = text;
    else next.docs.push({ id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, kind: kindFromName(name), text });
  }
  const touched = run.cards.filter((c) => c.status === 'applied').map((c) => c.name);
  next.recentSections = recentFrom(next, touched, project.recentSections || []);
  return { project: next, cards: run.cards, batch, guard };
}

function kindFromName(name) {
  const n = String(name).toLowerCase();
  if (n.includes('worldbook') || n.endsWith('.json')) return 'worldbook';
  if (n.includes('continuity') || n.includes('file ') || n.includes('brief')) return 'continuity';
  if (n.includes('note')) return 'notes';
  return 'pe';
}

function recentFrom(project, touchedNames, prior) {
  const ids = [];
  for (const d of project.docs || []) {
    if (!touchedNames.includes(d.name)) continue;
    const parsed = parseDoc(d.text, d.kind);
    for (const s of parsed.sections.slice(-4)) ids.push(s.id);
  }
  return [...new Set(ids.concat(prior))].slice(0, 12);
}

/* The checks that need no model. Repairs land straight away; anything that
 * needs a person is handed to the worker whose job it is. */
export function sweep(project) {
  const next = { ...project, docs: (project.docs || []).map((d) => ({ ...d })) };
  const repaired = [];
  const handOver = [];
  for (const d of next.docs) {
    const r = lint(d.text, { kind: d.kind || 'pe', deliverable: (d.kind || 'pe') !== 'notes' });
    if (r.changed) d.text = r.text;
    for (const f of r.found) {
      if (f.repaired) repaired.push(`In ${d.name}, ${f.said}.`);
      else if (f.worker) handOver.push({ worker: f.worker, check: f.check, said: `${f.said} (in ${d.name})` });
    }
  }
  return { project: next, repaired, handOver };
}

/* What the front of the house is told about the backstage work — plain
 * sentences, markers already stripped out. */
export function backstageBrief(crew, cards, p) {
  const lines = [];
  for (const c of crew) {
    if (c.failed) { lines.push(`The ${c.worker} could not finish: ${c.failed}.`); continue; }
    if (c.notes) lines.push(naturalize(c.notes));
    if (c.guard) lines.push(c.guard + '.');
  }
  const applied = cards.filter((c) => c.status === 'applied');
  const refused = cards.filter((c) => c.status === 'refused');
  if (applied.length) {
    const byDoc = new Map();
    for (const c of applied) byDoc.set(c.name, (byDoc.get(c.name) || 0) + 1);
    lines.push('Changed: ' + [...byDoc].map(([n, k]) => `${n} (${k} change${k > 1 ? 's' : ''})`).join(', ') + '.');
  }
  if (refused.length) {
    lines.push('Not done: ' + refused.map((c) => `${c.name || 'a change'} — ${c.why}`).join('; ') + '.');
  }
  return lines.filter(Boolean).join('\n');
}
