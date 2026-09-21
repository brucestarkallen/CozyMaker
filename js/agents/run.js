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
import { craftFor } from '../engine/crafts.js';
import { openingFor, personaOf, addressWriter } from './persona.js';
import { pickConnection, FRONT } from './roster.js';
import { callModel, streamModel, enqueue } from './call.js';
import { parseDoc, brief, readNeed, stripNeed, resolveNeed, LEAD_SHORT } from '../doc/index.js';
import { route } from './router.js';
import { parseEdits, stripEdits, stripThinking, applyRun, hash } from '../doc/edits.js';
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
 * Plain English on purpose. Nothing here has a bracket in it, and it calls him
 * by his name: a house that talks about "the writer" and "he" reads like a
 * form, and the voice that reads it starts to sound like one (Cozy Tavern
 * M327). With no name set, it simply talks to him. */
export function frontBody(p) {
  const him = p.you || '';
  const who = him || 'the person you are making this with';
  return `You and ${him || 'they'} are building the guide to a world together — the plot essential, the worldbook, the files a storyteller will later read as the whole truth of that world. This is the comfortable room where that gets made, so talk like it: two people making something good, not a service desk.

${him ? `${him} only ever talks to you.` : 'You are the only one they talk to.'} There are people working behind you who know the craft inside out — they read the whole thing back, catch what drifted, and make the actual changes to the documents. You will be told what they did. Tell ${him || 'them'} in your own words, the way you would tell a friend what got done while they made tea. Short. Warm. Specific about what actually changed.

You never edit the documents yourself and you never pretend to. If something needs writing or changing, it is already being done or already done by the time you speak.

Never read a list of findings out to ${who}. Say the one or two things that matter and let the rest be.

If ${him || 'they'} ${him ? 'is' : 'are'} just talking, just talk. Not every sentence is a job.`;
}

/* Strip the crew's working shorthand out of anything the front will read. */
export function naturalize(text) {
  return String(text || '')
    .replace(/<\/?(?:edits|need)>?/gi, '')
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

/* THE CONVERSATION REACHES THE WORKERS. "Fold all that into the plot
 * essential" means nothing to a worker that was never shown "all that" — and a
 * worker told to use something it never receives will invent it (Cozy Tavern
 * M249: the world agent was told to use a record it was never given; M226: the
 * extractor could not see the story it was writing down). So every worker is
 * handed the talk that led here, newest last. If it has to be cut, the cut is
 * said out loud (M265: no silent cut). */
export const TALK_BUDGET = 24000;

export function conversationFor(turns, p, budget = TALK_BUDGET) {
  const him = p.you || 'The author';
  const maker = p.maker || 'The maker';
  const lines = [];
  let used = 0;
  let cut = false;
  const list = (turns || []).filter((t) => (t.text || '').trim());
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    const line = `${t.role === 'writer' ? him : maker}: ${t.text.trim()}`;
    if (used + line.length > budget && lines.length) { cut = true; break; }
    lines.unshift(line);
    used += line.length;
  }
  if (!lines.length) return '';
  return (cut ? '(earlier conversation is not shown here — it is older than what follows)\n\n' : '') + lines.join('\n\n');
}

function docsOf(project) {
  return (project.docs || []).map((d) => ({ id: d.id, name: d.name, kind: d.kind || 'pe', text: d.text || '' }));
}

/* A worker reads every document whole when the world fits in this many
 * characters (about 30,000 tokens); past it, the index and the sections in
 * play, with <need> for the rest. */
export const WHOLE_LIMIT = 120000;

export function docBriefs(project, opts) {
  const docs = docsOf(project);
  if (!docs.length) return 'Nothing has been written yet — there are no documents in this world so far.';
  const size = docs.reduce((n, d) => n + (d.text || '').length, 0);
  const whole = !opts.forFront && !opts.partial && size <= WHOLE_LIMIT;
  /* the text before a document's first section: the front and a model too
   * small for the whole world read the start of it; any other worker reads
   * it all, up to the same limit a whole world has */
  const leadCap = opts.forFront || opts.partial ? LEAD_SHORT : WHOLE_LIMIT;
  return docs.map((d) => brief(parseDoc(d.text, d.kind), d.name, { ...opts, whole, leadCap })).join('\n\n----\n\n');
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

/* A first-person claim that something was changed. Quoted text is taken out
 * first, so a worker quoting the story is never mistaken for one claiming work
 * (Cozy Tavern M118). */
const CLAIMED = /\b(i|we)(?:'ve| have)?\s+(?:now\s+|also\s+|just\s+)?(changed|updated|added|removed|fixed|rewrote|rewritten|moved|renamed|replaced|put|set|made|folded|merged|created|trimmed|cut|tightened|corrected|edited|inserted|deleted|built|started|restructured|reorganised|reorganized|compressed|condensed)\b/i;
export function claimsAChange(notes) {
  /* A single quote opens a quotation only after a space or a bracket and
   * closes before one — otherwise "I've … Claire's" reads as a quotation and
   * the claim inside it is deleted along with it. */
  const bare = String(notes || '')
    .replace(/"[^"]*"|“[^”]*”|‘[^’]*’/g, ' ')
    .replace(/(^|[\s(])'[^'\n]{6,}'(?=[\s.,;:!?)]|$)/g, '$1 ');
  return CLAIMED.test(bare);
}

/* A provider saying the request is longer than its model can take, in the
 * words the houses use (OpenAI, Anthropic, DeepSeek, OpenRouter, local). */
export const TOO_LONG = /(maximum context|context length|context window|context_length|too many tokens|prompt is too long|input is too long|reduce the length|exceeds? (?:the )?(?:model'?s? )?(?:maximum|max|context)|token limit)/i;
export const TALK_WHEN_SMALL = 6000;

async function runWorker({ worker, sections, conn, project, message, talk, fromHouse = false, onStatus, signal, stale, craft = null }) {
  /* a worker with a craft of its own reads that; the rest read their slice */
  const own = craft || sliceFor(sections, worker).text;
  const system = [CRAFT_FRAME, own, RETURN_CONTRACT].join('\n\n---\n\n');
  let asked = [];
  let answer = null;
  let nudged = false;
  let nudge = '';
  /* A MODEL TOO SMALL FOR THE WHOLE WORLD STILL GETS THE JOB DONE. When the
   * provider says the request is too long, the same worker is asked once more
   * with the outline and the parts in play (it can ask for more with <need>),
   * and only the newest part of the talk. What it detects, the house repairs. */
  let small = false;

  for (let round = 0; round <= MAX_NEED_ROUNDS + 1; round++) {
    if ((stale && stale()) || (signal && signal.aborted)) return { ok: false, error: 'stopped' };
    const context = docBriefs(project, { message, recent: project.recentSections || [], asked, partial: small });
    /* The documents go last before the job — nearest the answer, where
     * copying from them word for word is surest. */
    const user = [
      talk ? `The conversation so far, newest last:\n\n${talk}\n` : '',
      'The documents as they stand:',
      context,
      /* Whose job this is, said plainly: the author's own words, or the house
       * asking for a read-back or a repair. A house job presented as his
       * request is a note put in his mouth. */
      fromHouse ? '\nWhat the house needs from you (the author did not write this — it follows from his last request):' : '\nWhat the author just asked for:',
      message,
      nudge ? `\n${nudge}` : '',
    ].filter(Boolean).join('\n');

    const out = await callModel(conn, { system, messages: [{ role: 'user', content: user }], maxTokens: 8000, signal, stale });
    if (!out.ok) {
      if (!small && TOO_LONG.test(out.error || '')) {
        small = true;
        if (talk && talk.length > TALK_WHEN_SMALL) talk = '(earlier talk left out: the model is small)\n' + talk.slice(-TALK_WHEN_SMALL);
        onStatus && onStatus(`the whole world is too long for the ${worker}'s model \u2014 reading the outline instead`);
        round--;
        continue;
      }
      return { ok: false, error: out.error };
    }

    const need = readNeed(out.text);
    if (need.length && round < MAX_NEED_ROUNDS) {
      const docs = docsOf(project);
      const more = [];
      for (const d of docs) more.push(...resolveNeed(parseDoc(d.text, d.kind), need));
      const grew = more.filter((id) => !asked.includes(id));
      if (grew.length) { asked = asked.concat(grew); onStatus && onStatus(`reading ${need.slice(0, 3).join(', ')}`); continue; }
    }

    /* A BLOCK THAT LANDED IN THE THINKING IS STILL A BLOCK (Cozy Chat
     * v5.13.1). A model that reasons on its own channel sometimes writes its
     * changes there; ignoring them would report "nothing changed" when the
     * work was done. The visible answer wins when both have one. */
    let parsed = parseEdits(out.text);
    if (!parsed.edits.length && !parsed.warn && out.thinking && /<edits>/i.test(out.thinking)) {
      parsed = parseEdits(out.thinking);
    }
    const notes = stripThinking(stripNeed(stripEdits(out.text)));

    /* NOTHING LOST IN SILENCE — each of these earns exactly one more try, told
     * plainly what went wrong (Cozy Tavern M75, M75-003, M117):
     *   an empty answer is not "nothing to do";
     *   an unreadable block is asked for again as clean data;
     *   "I changed it" with no block is sent back for the block. */
    if (!nudged) {
      let why = '';
      if (!out.text.trim() && !parsed.edits.length) {
        why = 'Your answer came back empty. Do the job now: a few plain sentences, then the block of changes if anything should change.';
      } else if (need.length && !parsed.edits.length && !notes.trim()) {
        /* A turn spent entirely on fetching (Cozy Tavern M221): its last
         * round asked to read more and did nothing else. */
        why = 'You have been shown everything that can be shown this time. Do the job now with what is in front of you: a few plain sentences, then the block of changes.';
      } else if (parsed.warn && !parsed.edits.length) {
        why = `Your block of changes could not be used (${parsed.warn}). Send the whole block again as valid data — newlines inside strings written as \\n, no trailing commas.`;
      } else if (!parsed.edits.length && claimsAChange(notes)) {
        why = 'You said you changed something, but no block of changes came back — a change only happens inside the block. Send the block now.';
      }
      if (why) { nudged = true; nudge = why; onStatus && onStatus(`asking the ${worker} again`); continue; }
    }
    answer = { out, parsed, notes };
    break;
  }

  if (!answer) return { ok: false, error: 'no answer came back' };
  return { ok: true, worker, notes: answer.notes, edits: answer.parsed.edits, warn: answer.parsed.warn, sliceChars: own.length };
}

/* ------------------------------------------------------------- the turn */

/* Two reasons to stop — the writer's Stop and the channel's own timeout — and
 * either one must stop the worker. Passing only the first quietly disabled
 * the timeout on every turn. */
export function either(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  if (a.aborted || b.aborted) ctl.abort();
  a.addEventListener('abort', stop, { once: true });
  b.addEventListener('abort', stop, { once: true });
  return ctl.signal;
}

/* ONE VOICE ON THE WIRE (Cozy Tavern M321, Cozy Chat's seam rule). Roles
 * alternate; two turns in a row from one side are folded into one; the very
 * first is always the writer's, because a model handed an answer before any
 * question is being handed a mistake, and some addresses refuse it outright. */
export function oneVoice(messages) {
  const out = [];
  for (const m of messages) {
    const content = String(m.content || '').trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/* A control token leaked into an answer ends the answer there (Cozy Tavern
 * M117). What follows it is the model talking to itself. */
export function endAtControlToken(text) {
  const t = String(text || '');
  const m = /<\|[a-z_]{2,24}\|>|<\/s>|<\|end\|>/i.exec(t);
  return m ? t.slice(0, m.index).trimEnd() : t;
}

/* A turn for the front alone: "go on" after a reply that was cut off. */
export const FRONT_ONLY = '__front__';

export async function runTurn({
  house, project, history = [], message, forceWorker = null,
  onStatus = () => {}, onText = () => {}, onThinking = () => {},
  signal,
} = {}) {
  const sections = await loadEngine();
  const connections = house.connections || [];
  const frontConn = connections.find((c) => c.id === (house.agentConnections || {})[FRONT]) || connections[0] || null;
  const general = (house.agentConnections || {})._general || null;
  const connFor = (worker) =>
    pickConnection({ map: house.agentConnections || {}, general, connections }, worker) || frontConn;
  const p = personaOf(house);
  /* STOP MEANS STOP. The first version let the crew go and then called the
   * front anyway. Every step now looks first. */
  const stopped = () => Boolean(signal && signal.aborted);

  const past = (history || []).filter((t) => !t.failed);
  const docs = docsOf(project);
  const hasPE = docs.some((d) => d.kind === 'pe' && (d.text || '').trim());
  const intents = forceWorker === FRONT_ONLY ? []
    : forceWorker
    ? [{ worker: forceWorker, about: message, why: 'asked for by name' }]
    : route(message, { hasPlotEssential: hasPE, hasDocs: docs.length > 0 });
  const talk = conversationFor(past.concat([{ role: 'writer', text: message }]), p);

  const crew = [];
  const allCards = [];
  const batches = [];
  /* every change the crew made this turn, in order, so another version of
   * this answer can be put back and this one made again, exactly */
  const turnEdits = [];
  let working = project;

  const send = async (worker, about, label, fromHouse = false, requoting = false) => {
    let craft = null;
    try { craft = await craftFor(worker, house); }
    catch (e) { crew.push({ worker, failed: (e && e.message) || String(e) }); return []; }
    const res = await enqueue(project.id, worker, ({ signal: s, stale }) =>
      runWorker({ worker, sections, conn: connFor(worker), project: working, message: about, talk, fromHouse, onStatus, signal: either(signal, s), stale, craft }));
    if (!res || !res.ok) { crew.push({ worker, failed: (res && res.error) || 'did not finish' }); return []; }
    const applied = commit(working, res.edits, label);
    working = applied.project;
    if (res.edits && res.edits.length) turnEdits.push({ label, edits: res.edits });
    if (applied.batch) batches.push(applied.batch);
    crew.push({ worker, notes: res.notes, cards: applied.cards, guard: applied.guard, warn: res.warn });
    if (res.warn) allCards.push({ status: 'refused', name: '', reason: '', why: res.warn });

    /* A QUOTE THAT MISSED GOES BACK ONCE (the Plot Essential Maker's v0.11.9:
     * matching stays strict, and the failure is handed to the one who wrote
     * it). Only spacing and quote marks may differ from the document; a
     * change that quoted anything else is sent back with exactly what it
     * quoted and why it missed, and the worker quotes again from the
     * documents as they now stand. */
    const missed = applied.cards.filter((c) => c.status === 'refused' && c.find &&
      /not in the document as written|appear \d+ times/.test(c.why || ''));
    const landed = applied.cards.filter((c) => !missed.includes(c));
    allCards.push(...landed);
    if (!missed.length || requoting || stopped()) { allCards.push(...missed); return applied.cards; }
    onStatus(`asking the ${worker} to quote again`);
    const list = missed.map((c, i) =>
      `${i + 1}. In ${c.name}, the change quoted:\n"${c.find}"\n— ${c.why}.`).join('\n\n');
    const again = await send(worker,
      `Some of your changes could not be placed, because what they quote is not in the document word for word — only spacing and the shape of quote marks may differ:\n\n${list}\n\n` +
      'The documents are shown as they stand now, with every change that did land. Send only these changes again, each quoting the document exactly: the shortest stretch that appears only once. Nothing else.',
      `${label} (quoted again)`, true, true);
    if (!again.length) allCards.push(...missed);
    return applied.cards;
  };

  for (const intent of intents) {
    if (stopped()) break;
    onStatus(`the ${intent.worker} is on it`);
    await send(intent.worker, intent.about || message, `${intent.worker} — ${short(intent.about || message)}`);
  }

  if (!stopped()) {
    let repairsLeft = MAX_AUTO_REPAIRS;
    const linted = sweep(working);
    working = linted.project;
    if (linted.repaired.length) crew.push({ worker: 'house', notes: linted.repaired.join(' ') });
    for (const job of linted.handOver) {
      if (stopped() || repairsLeft-- <= 0) break;
      onStatus(`the ${job.worker} is fixing ${job.check}`);
      await send(job.worker,
        `Something in the documents needs putting right: ${job.check} — ${job.said}. Fix it properly, and check the rest of the documents for the same thing before you finish.`,
        `put right: ${job.check}`, true);
    }
  }

  if (!stopped() && allCards.some((c) => c.status === 'applied')) {
    onStatus('reading the whole thing back');
    await send('eye',
      'The documents were just changed. Read the whole of them back, front to back, and put right anything that is wrong — not only near the change. Say what you read and what you found.',
      'the eye', true);
    const after = sweep(working);
    working = after.project;
    if (after.repaired.length) crew.push({ worker: 'house', notes: after.repaired.join(' ') });
  }

  onStatus('');
  if (stopped()) return { project: working, reply: '', cards: allCards, batches, crew, edits: turnEdits, error: 'stopped', stopped: true };

  /* Now the one voice the writer hears. */
  const system = openingFor(p, frontBody(p));
  const said = backstageBrief(crew, allCards, p);
  const n = (house.settings || {}).turnsOnScreen || 40;
  const earlier = past.slice(-n).map((t) => ({ role: t.role === 'writer' ? 'user' : 'assistant', content: t.text || '' }));
  const ask = [
    'Where the book stands right now:',
    docBriefs(working, { message, recent: working.recentSections || [], forFront: true }),
    said ? `\nWhat got done while you were talking:\n${said}` : '',
    `\n${addressWriter(p)} said:\n${message}`,
  ].filter(Boolean).join('\n\n');
  const messages = oneVoice(earlier.concat([{ role: 'user', content: ask }]));

  let reply = '';
  try {
    const out = await streamModel(frontConn, {
      system, messages,
      onText: (t) => { reply += t; onText(t); },
      onThinking, signal,
    });
    reply = endAtControlToken(out.text || reply);
    if (out.cut) return { project: working, reply, cards: allCards, batches, crew, edits: turnEdits, error: null, cut: true };
  } catch (e) {
    const aborted = (e && e.name === 'AbortError') || stopped();
    return {
      project: working, reply: endAtControlToken(reply), cards: allCards, batches, crew, edits: turnEdits,
      error: aborted ? 'stopped' : ((e && e.message) || String(e)), stopped: aborted,
    };
  }
  return { project: working, reply, cards: allCards, batches, crew, edits: turnEdits, error: null };
}

/* LANDING A TURN IN THE WORLD AS IT STANDS NOW (Cozy Tavern M59: overlapping
 * writes lost each other; M263: the writer's own words stand; M185: a page he
 * let go stays gone). The crew worked from the documents as they were when
 * he pressed send. If, while they worked, he changed a document by hand, his
 * version stays and the crew's change to that document is refused with the
 * reason — never silently overwritten. A document he deleted stays deleted.
 * The reply goes into the conversation that asked for it; if that
 * conversation was deleted meanwhile, the documents still land and the reply
 * is let go. */
/* One version of an answer, as kept while another is shown: its words, its
 * cards and the changes it made, never its undo payload, because a version
 * that is not shown has had its changes put back. */
export function versionOf(t) {
  return { text: t.text, thinking: t.thinking || '', thinkingMs: t.thinkingMs, cards: t.cards || [], edits: t.edits || [], cut: Boolean(t.cut), failed: Boolean(t.failed), at: t.at, batches: [] };
}

export function landTurn(world, { chatId, snapshot, result, makerTurn, replaceAt = null }) {
  /* Landing twice is landing once. A copy of the world opened in the moment
   * between this reply being saved elsewhere and the save finishing lacks the
   * reply; landing it again there must add it once, and on a copy that already
   * has it must change nothing at all. */
  const already = (world.chats || []).find((c) => c.id === chatId);
  const hasIt = (t) => t.role === 'maker' && (t.at === makerTurn.at || (t.versions || []).some((v) => v.at === makerTurn.at));
  if (already && (already.turns || []).some(hasIt)) {
    return { world, landed: true, conflicts: new Map(), already: true };
  }
  const next = { ...world, docs: (world.docs || []).map((d) => ({ ...d })), chats: (world.chats || []).map((c) => ({ ...c })) };
  const conflicts = new Map();
  const live = new Map(next.docs.map((d) => [d.name, d]));
  for (const d of (result.project && result.project.docs) || []) {
    const start = snapshot.has(d.name) ? snapshot.get(d.name) : undefined;
    const now = live.get(d.name);
    if (start === undefined) {
      if (now) { conflicts.set(d.name, 'a document with that name was started by hand meanwhile, so yours was kept'); continue; }
      next.docs.push({ ...d });
      continue;
    }
    if (d.text === start) continue;
    if (!now) { conflicts.set(d.name, 'it was deleted while the crew worked, so it stays deleted'); continue; }
    if (now.text !== start) { conflicts.set(d.name, 'you changed it by hand while the crew worked, so your version was kept'); continue; }
    now.text = d.text;
  }
  const cards = (makerTurn.cards || []).map((c) =>
    c.status === 'applied' && conflicts.has(c.name) ? { ...c, status: 'refused', why: conflicts.get(c.name) } : c);
  const batches = (makerTurn.batches || [])
    .map((b) => ({ ...b, items: (b.items || []).filter((it) => !conflicts.has(it.name)) }))
    .filter((b) => b.items.length);
  const chat = next.chats.find((c) => c.id === chatId);
  if (result.project && result.project.recentSections) next.recentSections = result.project.recentSections;
  if (!chat) return { world: next, landed: false, conflicts };
  const fresh = { ...makerTurn, cards, batches };
  const old = replaceAt !== null ? (chat.turns || [])[replaceAt] : null;
  if (old && old.role === 'maker') {
    /* ANOTHER ANSWER: the old one is kept as a version (a failed one is not
     * worth keeping), and the new one is shown. */
    let versions = old.versions ? old.versions.map((v, i) => (i === old.shown ? versionOf(old) : v)) : [versionOf(old)];
    if (old.failed) versions = versions.filter((v) => !v.failed);
    versions = [...versions, versionOf(fresh)];
    const turns = chat.turns.slice();
    turns[replaceAt] = versions.length > 1 ? { ...fresh, versions, shown: versions.length - 1 } : fresh;
    chat.turns = turns;
  } else {
    chat.turns = [...(chat.turns || []), fresh];
  }
  chat.updated = Date.now();
  return { world: next, landed: true, conflicts };
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

export const UNDO_KEPT = 20;

/* AN UNDO RECORD HOLDS A WHOLE DOCUMENT. Twenty of them is a comfortable
 * safety net; two hundred is a copy of the plot essential per turn sitting in
 * the world file for ever, and it is the writer's phone that carries it. The
 * newest stay undoable. Older ones keep their card — the record of what
 * happened is never thrown away — and lose only the text behind it. */
export function capUndo(project, keep = UNDO_KEPT) {
  /* Every conversation in the world shares the one net, newest first. */
  const turns = [];
  for (const c of project.chats || []) for (const t of c.turns || []) turns.push(t);
  for (const t of project.turns || []) turns.push(t);
  turns.sort((a, b) => (a.at || 0) - (b.at || 0));
  const all = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    for (const b of turns[i].batches || []) all.push(b);
  }
  let trimmed = false;
  for (let n = keep; n < all.length; n++) {
    const b = all[n];
    if (b.tooOld) continue;
    b.tooOld = true;
    for (const item of b.items || []) delete item.before;
    trimmed = true;
  }
  return trimmed;
}

/* What the front of the house is told about the backstage work — plain
 * sentences, markers already stripped out. */
export function backstageBrief(crew, cards, p) {
  const lines = [];
  for (const c of crew) {
    if (c.failed) { lines.push(`The ${c.worker} could not finish: ${c.failed}.`); continue; }
    if (c.notes) lines.push(naturalize(c.notes));
    if (c.guard) lines.push(c.guard + '.');
    if (c.warn) lines.push(`Some of the ${c.worker}'s changes did not come through: ${c.warn}.`);
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
