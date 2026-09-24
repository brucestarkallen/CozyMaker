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
import { parseDoc, brief, readNeed, stripNeed, resolveNeed, LEAD_SHORT, nameWorld } from '../doc/index.js';
import { route, confirmsOffer, offersIn, writtenCommand, justGreeting } from './router.js';
import { listen, LISTENER, LISTEN_TALK } from './listener.js';
import { parseEdits, stripEdits, stripThinking, applyRun, hash, openFileAtEnd } from '../doc/edits.js';
import { lint, lostSomething } from '../doc/lint.js';
import { kindFor } from '../doc/kind.js';

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
/* WRITTEN IN BOTH VOICES, never rewritten word by word: swapping pronouns by
 * pattern gave a first-person persona "Bruce only ever talks to I" and
 * "I and Bruce are building". */
export function frontBody(p) {
  const him = p.you || '';
  const WORLD = 'the guide to a world together \u2014 the plot essential, the worldbook, the files a storyteller will later read as the whole truth of that world';
  if (p.person === 'first') {
    if (him) return `${him} and I are building ${WORLD}. This is the comfortable room where that gets made, so I talk like it: two people making something good, not a service desk.

${him} only ever talks to me. Changes to the documents are made as we talk, and before I answer I am told exactly what changed. I speak of it in my own voice, as myself: short, warm, and specific about what actually changed.

Only what I am told changed has changed. If nothing is listed, nothing changed, so I never say I added, fixed or wrote something that is not listed. If ${him} asked for something that was not done, I say so plainly and offer to do it.

When ${him} asked for something to be checked, audited, diagnosed or judged, what came back is the answer: I give ${him} all of it that matters, in my own voice, not read out as a list. What was read back without being asked, I mention only if it matters.

When something cannot go further until ${him} decides, I put all of it to ${him} \u2014 every point there is to decide, in my own voice \u2014 and let ${him} choose.

If ${him} is just talking, I just talk. Not every sentence is a job.`;
    return `The two of us are building ${WORLD}. This is the comfortable room where that gets made, so I talk like it: two people making something good, not a service desk.

The person I am making this with only ever talks to me. Changes to the documents are made as we talk, and before I answer I am told exactly what changed. I speak of it in my own voice, as myself: short, warm, and specific about what actually changed.

Only what I am told changed has changed. If nothing is listed, nothing changed, so I never say I added, fixed or wrote something that is not listed. If they asked for something that was not done, I say so plainly and offer to do it.

When they asked for something to be checked, audited, diagnosed or judged, what came back is the answer: I give them all of it that matters, in my own voice, not read out as a list. What was read back without being asked, I mention only if it matters.

When something cannot go further until they decide, I put all of it to them \u2014 every point there is to decide, in my own voice \u2014 and let them choose.

If they are just talking, I just talk. Not every sentence is a job.`;
  }
  if (him) return `You and ${him} are building ${WORLD}. This is the comfortable room where that gets made, so talk like it: two people making something good, not a service desk.

${him} only ever talks to you. Changes to the documents are made as you talk, and before you answer you are told exactly what changed. Speak of it in your own voice, as yourself: short, warm, and specific about what actually changed.

Only what you are told changed has changed. If nothing is listed, nothing changed, so never say you added, fixed or wrote something that is not listed. If ${him} asked for something that was not done, say so plainly and offer to do it.

When ${him} asked for something to be checked, audited, diagnosed or judged, what came back is the answer: give ${him} all of it that matters, in your own voice, not read out as a list. What was read back without being asked, mention only if it matters.

When something cannot go further until ${him} decides, put all of it to ${him} \u2014 every point there is to decide, in your own voice \u2014 and let ${him} choose.

If ${him} is just talking, just talk. Not every sentence is a job.`;
  return `The two of you are building ${WORLD}. This is the comfortable room where that gets made, so talk like it: two people making something good, not a service desk.

The person you are making this with only ever talks to you. Changes to the documents are made as you talk, and before you answer you are told exactly what changed. Speak of it in your own voice, as yourself: short, warm, and specific about what actually changed.

Only what you are told changed has changed. If nothing is listed, nothing changed, so never say you added, fixed or wrote something that is not listed. If they asked for something that was not done, say so plainly and offer to do it.

When they asked for something to be checked, audited, diagnosed or judged, what came back is the answer: give them all of it that matters, in your own voice, not read out as a list. What was read back without being asked, mention only if it matters.

When something cannot go further until they decide, put all of it to them \u2014 every point there is to decide, in your own voice \u2014 and let them choose.

If they are just talking, just talk. Not every sentence is a job.`;
}

/* Strip the crew's working shorthand out of anything the front will read. */
/* One change, as a key: the same document, the same place, the same words. */
function editKey(e) {
  return JSON.stringify([e.file || e.create_file || '', e.find || '', e.insert_after || '', e.append === true, e.replace_all === true, e.all === true, e.whole === true, e.replace || '']);
}

export function naturalize(text) {
  return String(text || '')
    /* the engine's command words, said as plain words */
    .replace(/(^|[\s(])[*#](source_new|hybrid_new|new|import|q|p|summari[sz]e|continuity|edit|retcon|delete|cleanup|optimi[sz]e|skip|ooc|show_full_file|show_spoilers|hide_spoilers|regress|next|audit|fix|brief)\b/gi, '$1$2')
    .replace(/<\/?(?:edits|docedits|need|ask)>?/gi, '')
    .replace(/<file\b[^>]*>|<\/file\s*>/gi, '')
    .replace(/\bM-[A-Z]{3,}\b/g, '')
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
export const BUILD_TALK = 120000;

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

const RETURN_CONTRACT = `When you are done, write these and nothing else.

First, in plain sentences — a short paragraph at most — what you did and what you found while you were in there. Write it for a person, not for a form.

Second, if a document should change, the change itself.

A change to part of a document goes in exactly one block of changes:

<edits>
[
  {"file": "which document.md", "find": "words copied exactly from the document", "replace": "what they become", "reason": "why"},
  {"file": "which document.md", "insert_after": "an exact line to put it under", "replace": "the new text", "reason": "why"},
  {"file": "which document.md", "append": true, "replace": "text added at the very end", "reason": "why"}
]
</edits>

A whole document \u2014 a new one, or one rebuilt from start to finish \u2014 is never put inside the block. Write it out plainly, exactly as it should read, with nothing escaped:

<file name="which document.md">
the whole document, word for word
</file>

How they must behave:
- "find" and "insert_after" are copied character for character out of the document. Never paraphrased. Quote the shortest stretch that appears only once.
- The block is valid data: a newline inside a string written as \\n, a double quote inside a string written as \\", no trailing commas.
- "file" names which document. With only one document open it may be left out.
- Rebuild a document whole only when the whole of it is genuinely being rebuilt. Every part that should survive must be in what you write \u2014 anything left out is deleted.
- A change you only describe in words does not happen. It happens in the block or in a file, or it does not happen.
- Nothing you write into a document may be a note, a flag, a marker or an instruction. What goes into a document is what the story is, and nothing else.
- If nothing should change, send neither.

Last, and only if the job cannot be finished until he decides something — the craft tells you to get his go-ahead first, or there is a question only he can answer — put everything he has to decide between <ask> and </ask>: the plan or the options, and the questions, complete enough to answer with nothing else in front of him. Make only the changes that do not wait on his answer. His answer will come back to you together with what you asked, word for word.`;

/* WHAT WAITS ON HIM (the craft's approval gates: the cleanup manifest, a
 * scene proposed before a bridge is built, the new-world interview and seed,
 * a protected field, a change that outgrew its scope). A worker puts it in
 * <ask>; a worker that follows the craft's own marker instead is read the
 * same way. It is kept on the turn, put to him whole by the persona, and his
 * answer goes back to the same worker with this, word for word. */
export const CRAFT_ASKS = /\[PERMISSION_REQUEST\]|\[SCOPE_CREEP_WARNING\]|\bPending approval\b|\bCLEANUP MANIFEST\b/;
export function readAsk(text) {
  const t = String(text || '');
  const found = [...t.matchAll(/<ask>([\s\S]*?)(?:<\/ask>|$)/gi)].map((m) => m[1].trim()).filter(Boolean);
  if (!found.length) return { ask: '', rest: t };
  return { ask: found.join('\n\n'), rest: t.replace(/<ask>[\s\S]*?(?:<\/ask>|$)/gi, '').trim() };
}

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

/* AN ANSWER CUT AT ITS LENGTH LIMIT IS CARRIED ON, NOT ASKED FOR AGAIN. The
 * old way asked for the same block again, which met the same limit: with no
 * "Longest reply" set a worker gets 8,000 tokens, the craft calls a mature
 * plot essential 8,000 tokens (7.4), and *import writes several files at once.
 * Some providers cannot give more in one answer however much is asked. So the
 * worker is shown what it wrote and asked for the rest, and the pieces are
 * joined where they meet. */
export const MAX_CARRY_ON = 4;
export const CARRY_ON = 'You were cut off by the length limit partway through that answer. Carry on from the exact character where it stopped \u2014 no repeating, no starting over, nothing before it.';
/* A DOCUMENT LEFT OPEN IS CARRIED ON TOO. A model that stops inside
 * <file name="…"> without its closer either finished and forgot it, or was
 * cut; either way the next words finish it, and written half-way it would
 * never be written at all. */
export function fileLeftOpen(name) {
  return `Your answer stopped inside <file name="${name}"> without its closing </file>. If the document was finished, send only </file>. If it was not, carry on from the exact character where it stopped \u2014 no repeating, no starting over, nothing before it.`;
}
const CUT_FINISH = /^(?:length|max_tokens)$/i;
export function joinSeam(a, b) {
  const head = String(a || '');
  const tail = String(b || '');
  if (!tail) return head;
  /* a model carrying on often starts a little way back: the overlap goes once */
  for (let k = Math.min(400, head.length, tail.length); k >= 12; k--) {
    if (head.endsWith(tail.slice(0, k))) return head + tail.slice(k);
  }
  return head + tail;
}

async function runWorker({ worker, sections, conn, project, message, talk, fromHouse = false, onStatus, onProgress, signal, stale, craft = null }) {
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

    /* how far along it is, counted over every piece of the answer so far */
    const told = (before) => (onProgress ? (p) => onProgress({ text: before + (p.text || ''), thinking: p.thinking || '' }) : undefined);
    let out = await callModel(conn, { system, messages: [{ role: 'user', content: user }], maxTokens: 8000, signal, stale, onProgress: told('') });
    for (let more = 0; out.ok && more < MAX_CARRY_ON; more++) {
      const cutAtLimit = CUT_FINISH.test(out.finish || '') && (out.text || '').trim();
      const leftOpen = openFileAtEnd(out.text);
      if (!cutAtLimit && !leftOpen) break;
      if ((stale && stale()) || (signal && signal.aborted)) break;
      onStatus && onStatus(`the ${worker}'s answer ran long \u2014 asking for the rest`);
      const rest = await callModel(conn, { system, messages: [
        { role: 'user', content: user }, { role: 'assistant', content: out.text }, { role: 'user', content: cutAtLimit ? CARRY_ON : fileLeftOpen(leftOpen) },
      ], maxTokens: 8000, signal, stale, onProgress: told(out.text) });
      /* nothing more came: asking again would only bring nothing again */
      if (!rest.ok || !String(rest.text || '').trim()) break;
      out = { ...rest, text: joinSeam(out.text, rest.text), thinking: [out.thinking, rest.thinking].filter(Boolean).join('\n\n') };
    }
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
    if (!parsed.edits.length && !parsed.warn && out.thinking && /<(?:doc)?edits>|<file\s/i.test(out.thinking)) {
      parsed = parseEdits(out.thinking);
    }
    const fromAsk = readAsk(stripThinking(out.text));
    let notes = stripThinking(stripNeed(stripEdits(fromAsk.rest)));
    let ask = fromAsk.ask;
    if (!ask && !parsed.edits.length && CRAFT_ASKS.test(notes)) { ask = notes; notes = ''; }

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
      } else if (parsed.fileCut && !parsed.edits.length) {
        why = `${parsed.fileCut} was cut off before it finished, so it was not written. Write it again whole, between <file name="${parsed.fileCut}"> and </file>.`;
      } else if (parsed.warn && !parsed.edits.length) {
        why = `Your block of changes could not be used (${parsed.warn}). Send the whole block again as valid data \u2014 newlines inside strings written as \\n, a double quote inside a string written as \\", no trailing commas. A whole document goes between <file name="\u2026"> and </file> instead, written plainly.`;
      } else if (!parsed.edits.length && claimsAChange(notes)) {
        why = 'You said you changed something, but no change came back \u2014 a change only happens inside the block of changes or a file. Send it now.';
      }
      if (why) { nudged = true; nudge = why; onStatus && onStatus(`asking the ${worker} again`); continue; }
    }
    answer = { out, parsed, notes, ask };
    break;
  }

  if (!answer) return { ok: false, error: 'no answer came back' };
  return { ok: true, worker, notes: answer.notes, edits: answer.parsed.edits, warn: answer.parsed.warn, ask: answer.ask, sliceChars: own.length };
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

/* GO ON IS THE HOUSE'S NOTE, NOT HIS WORDS. It used to arrive under "Bruce
 * said:" as "Carry on from exactly where you stopped. No repetition and no
 * preamble" — an order in a voice he never uses, put in his mouth. */
export const GO_ON = 'Your last reply was cut off partway through. Carry straight on from the exact word where it stopped \u2014 without going back over it, and with nothing before it.';

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
  /* WHAT THE CREW IS DOING, SAID ONCE, WITH HOW FAR ALONG IT IS BESIDE IT. The
   * label says who is on what; the detail ("1,240 words so far") changes as a
   * streamed answer arrives, and never restarts the clock the label carries. */
  let doing = '';
  const status = (label, detail = '') => { doing = label; onStatus(label, detail); };
  const progress = (p2) => {
    const words = (String(p2.text || '').match(/\S+/g) || []).length;
    if (words) status(doing, `${words.toLocaleString()} words so far`);
    else if (String(p2.thinking || '').trim()) status(doing, 'thinking it through');
  };
  /* STOP MEANS STOP. The first version let the crew go and then called the
   * front anyway. Every step now looks first. */
  const stopped = () => Boolean(signal && signal.aborted);

  const past = (history || []).filter((t) => !t.failed);
  const docs = docsOf(project);
  const hasPE = docs.some((d) => d.kind === 'pe' && (d.text || '').trim());
  const lastTurn = past[past.length - 1];
  const lastMaker = lastTurn && lastTurn.role === 'maker' ? lastTurn : null;
  /* What the crew is still waiting on him for: only what was put to him in the
   * answer right before this message. Once he has moved on, it is closed. */
  const open = !forceWorker && lastMaker && Array.isArray(lastMaker.asks)
    ? lastMaker.asks.filter((a) => a && a.worker && a.ask) : [];
  /* THE OLD READING, kept for when the listener cannot answer: a bare yes runs
   * what the front just offered (router.js offersIn), else the keyword table. */
  const oldReading = () => {
    const offered = lastMaker && confirmsOffer(message) ? offersIn(lastMaker.text) : [];
    const agreed = [];
    for (const o of offered) {
      for (const i of route(o, { hasPlotEssential: hasPE, hasDocs: docs.length > 0, asStatement: true })) {
        if (agreed.some((x) => x.worker === i.worker)) continue;
        agreed.push({ ...i, about: `${o.charAt(0).toUpperCase()}${o.slice(1)} (offered just now; ${addressWriter(p)} said "${String(message).trim()}").`, why: 'agreed to what was offered' });
      }
    }
    return agreed.length ? agreed : route(message, { hasPlotEssential: hasPE, hasDocs: docs.length > 0 });
  };
  /* WHAT THE ONE AT THE FRONT READS, one way whenever it is written: his
   * instructions and the house's plain words; then the talk, the book as it
   * stands, what got done, what waits on him, and what he just said. */
  const frontSystem = openingFor(p, frontBody(p));
  const frontMessages = (world, said, waiting) => {
    const n = (house.settings || {}).turnsOnScreen || 40;
    const earlier = past.slice(-n).map((t) => ({ role: t.role === 'writer' ? 'user' : 'assistant', content: t.text || '' }));
    const ask = [
      'Where the book stands right now:',
      docBriefs(world, { message, recent: world.recentSections || [], forFront: true }),
      said ? `\nWhat got done while you were talking:\n${said}` : '',
      waiting.length ? `\n${waitingBrief(waiting, p)}` : '',
      /* his words under his name; with no name set, never "you said:", which
       * tells the persona it said them itself. Go on is the house's note and
       * carries no speaker at all. */
      forceWorker === FRONT_ONLY ? `\n${message}` : `\n${p.you ? `${p.you} said:` : 'What was just said to you:'}\n${message}`,
    ].filter(Boolean).join('\n\n');
    return oneVoice(earlier.concat([{ role: 'user', content: ask }]));
  };
  let early = null;
  let earlyKept = false;
  let intents;
  let acts = [];
  if (forceWorker === FRONT_ONLY) intents = [];
  else if (forceWorker) intents = [{ worker: forceWorker, about: message, why: 'asked for by name' }];
  else if (writtenCommand(message)) intents = route(message, { hasPlotEssential: hasPE, hasDocs: docs.length > 0 });
  else if (!open.length && justGreeting(message)) intents = [];
  else {
    /* THE LISTENER (listener.js): what he said, read for intent the way the
     * craft's own 7.6 says to, with the conversation and whatever is waiting
     * on him. On the same channel as every worker, so Stop and a change of
     * world let it go like any other job. */
    status('reading that');
    /* HIS ANSWER STARTS WHILE THE LISTENER READS. Most of what he says while he
     * talks a world through is conversation, and it used to wait on a whole
     * model call (the listener) before the one he talks to began — ten or
     * thirty seconds on a model that thinks. So when nothing about it looks
     * like a job and nothing waits on him, the reply starts at the same moment,
     * held unseen: if the listener sends nobody, it is shown the instant the
     * listener has answered, word for word what it would have been; if the
     * listener sends somebody, it is let go and never seen. */
    const plainTalk = !open.length && !route(message, { hasPlotEssential: hasPE, hasDocs: docs.length > 0 }).length &&
      !(lastMaker && confirmsOffer(message) && offersIn(lastMaker.text).length);
    if (plainTalk) {
      const sameWords = frontMessages(project, '', []);
      early = heldFront((t, th, sig) => streamModel(frontConn, { system: frontSystem, messages: sameWords, onText: t, onThinking: th, signal: either(signal, sig) }));
    }
    const heard = await enqueue(project.id, LISTENER, ({ signal: s, stale }) => listen({
      conn: connFor(LISTENER), frame: CRAFT_FRAME, sections, docs, open, message, p,
      talk: conversationFor(past, p, LISTEN_TALK), signal: either(signal, s), stale,
    }));
    if (stopped()) { if (early) early.drop(); return { project, reply: '', cards: [], batches: [], crew: [], edits: [], asks: [], error: 'stopped', stopped: true }; }
    intents = heard && heard.ok ? heard.jobs.map((j) => jobFor(j, open, message, p)) : oldReading();
    if (heard && heard.ok) {
      acts = [
        ...(heard.clear || []).map((f) => ({ house: true, clear: true, file: f, reason: 'you asked for it to be cleared' })),
        ...(heard.delete || []).map((f) => ({ house: true, delete_file: f, reason: 'you asked for it to be deleted' })),
      ];
    }
    /* nobody to send and nothing to clear: what was started is what he gets */
    if (early) {
      earlyKept = !intents.length && !acts.length;
      if (!earlyKept) early.drop();
    }
  }
  const talk = conversationFor(past.concat([{ role: 'writer', text: message }]), p);
  /* the documents as he left them before this turn: what the checks never take out */
  const startTexts = new Map(docsOf(project).map((d) => [d.name, d.text]));
  /* WHEN HE SAYS BUILD IT, THE BUILDER READS THE WHOLE BRAINSTORM. Nothing is
   * written while he talks a world through, so everything he said is still
   * only in the conversation — a builder shown the last 24,000 characters
   * of it would build from the end of the brainstorm. */
  const buildTalk = conversationFor(past.concat([{ role: 'writer', text: message }]), p, BUILD_TALK);

  const crew = [];
  const allCards = [];
  /* the same failure, said once: a worker that sent one change four times does
   * not make four cards (the "not done" he saw four times over) */
  const refusedOnce = new Set();
  allCards.push = function pushCards(...items) {
    for (const c of items) {
      if (c && c.status === 'refused') {
        const k = `${c.name || ''}\u0000${c.find || ''}\u0000${c.why || ''}`;
        if (refusedOnce.has(k)) continue;
        refusedOnce.add(k);
      }
      Array.prototype.push.call(this, c);
    }
    return this.length;
  };
  const batches = [];
  const asks = [];
  /* every change the crew made this turn, in order, so another version of
   * this answer can be put back and this one made again, exactly */
  const turnEdits = [];
  const landed = new Set();
  let working = project;

  const send = async (worker, about, label, fromHouse = false, requoting = false) => {
    let craft = null;
    /* a failure is said plainly to the front, and shown exactly on a card */
    const failed = (why) => {
      crew.push({ worker, failed: why });
      if (!/^(?:stopped|let go)$/.test(why)) allCards.push({ status: 'refused', name: '', reason: '', failure: true, why: `${plainFailure(why)} (${String(why).slice(0, 160)})` });
      return [];
    };
    try { craft = await craftFor(worker, house); }
    catch (e) { return failed((e && e.message) || String(e)); }
    const res = await enqueue(project.id, worker, ({ signal: s, stale }) =>
      runWorker({ worker, sections, conn: connFor(worker), project: working, message: about, talk: worker === 'builder' ? buildTalk : talk, fromHouse, onStatus: status, onProgress: progress, signal: either(signal, s), stale, craft }));
    if (!res || !res.ok) return failed((res && res.error) || 'did not finish');
    if (res.ask) asks.push({ worker, ask: res.ask, at: Date.now() });
    /* a change already made this turn is not made again: a re-quote that
     * repeats one that landed would only come back as a false "not done" */
    const fresh = (res.edits || []).map((e) => { const own = { ...e }; delete own.house; return own; }).filter((e) => !landed.has(editKey(e)));
    const applied = commit(working, fresh, label, worker);
    working = applied.project;
    fresh.forEach((e, i) => { if (applied.cards[i] && applied.cards[i].status === 'applied') landed.add(editKey(e)); });
    if (fresh.length) turnEdits.push({ label, edits: fresh, maker: worker });
    if (applied.batch) batches.push(applied.batch);
    /* a re-quote's own words add nothing: it is the same work, placed again */
    crew.push({ worker, notes: requoting ? '' : res.notes, cards: applied.cards, guard: applied.guard, warn: res.warn, fromHouse });
    if (res.warn) allCards.push({ status: 'refused', name: '', reason: '', why: res.warn });

    /* A QUOTE THAT MISSED GOES BACK ONCE (the Plot Essential Maker's v0.11.9:
     * matching stays strict, and the failure is handed to the one who wrote
     * it). Only spacing and quote marks may differ from the document; a
     * change that quoted anything else is sent back with exactly what it
     * quoted and why it missed, and the worker quotes again from the
     * documents as they now stand. */
    const missed = applied.cards.filter((c) => c.status === 'refused' && c.find &&
      /not in the document as written|appear \d+ times/.test(c.why || ''));
    /* A CHANGE THAT PUT BACK THE VERY WORDS IT FOUND CHANGED NOTHING. It used to
     * reach him as "not done: that change leaves the words exactly as they
     * were" — four times over when a worker sent four, a failure he could do
     * nothing about, over a document that had not moved. Either the words were
     * already right (then there is nothing to report), or the worker meant a
     * change and wrote the old words back (then the change he asked for never
     * happened). So it goes back once, with the missed quotes: the worker sends
     * the real change, or leaves it out — and he never sees it either way. */
    const unchanged = applied.cards.filter((c) => c.status === 'refused' && c.find &&
      /leaves the words exactly as they were/.test(c.why || ''));
    const placed = applied.cards.filter((c) => !missed.includes(c) && !unchanged.includes(c));
    allCards.push(...placed);
    const back = [...missed, ...unchanged];
    if (!back.length || requoting || stopped()) { allCards.push(...missed); return applied.cards; }
    status(`asking the ${worker} to look at ${back.length > 1 ? 'those changes' : 'that change'} again`);
    const seen = new Set();
    const list = back.filter((c) => { const k = `${c.name}\u0000${c.find}\u0000${c.why}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((c, i) => (unchanged.includes(c)
        ? `${i + 1}. In ${c.name}, the change put back the very words it found, so nothing changed:\n"${c.find}"`
        : `${i + 1}. In ${c.name}, the change quoted:\n"${c.find}"\n\u2014 ${c.why}.`)).join('\n\n');
    const again = await send(worker,
      `Some of your changes could not be placed, or changed nothing:\n\n${list}\n\n` +
      'A quote must match the document word for word \u2014 only spacing and the shape of quote marks may differ \u2014 using the shortest stretch that appears only once. ' +
      'A change that put back the words it found changed nothing: if you meant to change those words, send it again with the new words; if they were already right, leave it out. ' +
      'The documents are shown as they stand now, with every change that did land. Send only these changes again. Nothing else.',
      `${label} (looked at again)`, true, true);
    if (!again.length) allCards.push(...missed);
    return applied.cards;
  };

  /* WHAT HE ASKED TO BE CLEARED OR DELETED, done by the house itself, first —
   * "clear it and start again with a harbour town" clears, then builds. */
  if (acts.length && !stopped()) {
    const applied = commit(working, acts, 'as you asked');
    working = applied.project;
    turnEdits.push({ label: 'as you asked', edits: acts });
    if (applied.batch) batches.push(applied.batch);
    allCards.push(...applied.cards);
  }

  for (const intent of intents) {
    if (stopped()) break;
    status(`the ${intent.worker} is on it`);
    await send(intent.worker, intent.about || message, `${intent.worker} — ${short(intent.about || message)}`);
  }

  /* THE CHECKS FOLLOW A CHANGE, NEVER A CONVERSATION. They ran on every turn, so
   * a question — "what do you think of her?" — sent up to two heavy workers
   * whenever the plot essential had any leftover finding (an undated event, a
   * document grown heavy), and he waited on them before the persona said a word.
   * They now run only when this turn changed a document. */
  const changed = () => allCards.some((c) => c.status === 'applied');
  const touched = () => new Set(allCards.filter((c) => c.status === 'applied' && c.name).map((c) => c.name));
  if (!stopped() && changed()) {
    let repairsLeft = MAX_AUTO_REPAIRS;
    const linted = sweep(working, touched(), startTexts);
    working = linted.project;
    if (linted.repaired.length) crew.push({ worker: 'house', notes: linted.repaired.join(' ') });
    for (const job of linted.handOver) {
      if (stopped() || repairsLeft-- <= 0) break;
      status(`the ${job.worker} is fixing ${job.check}`);
      await send(job.worker,
        `Something in the documents needs putting right: ${job.check} — ${job.said}. Fix it properly, and check the rest of the documents for the same thing before you finish.`,
        `put right: ${job.check}`, true);
    }
  }

  /* THE READ-BACK FOLLOWS REAL WORK. The craft's own *edit is "one field, one
   * character, one fact. Required scan only" (11, 7.7): a full read-back after
   * a surgical edit is the scope creep it forbids, and doubles the wait. A
   * clear or a delete he asked for has nothing to read back. */
  const surgical = intents.length > 0 && intents.every((i) => i.worker === 'editor');
  if (!stopped() && changed() && intents.length && !surgical) {
    status('reading the whole thing back');
    await send('eye',
      'The documents were just changed. Read the whole of them back, front to back, and put right anything that is wrong — not only near the change. Say what you read and what you found.',
      'the eye', true);
    const after = sweep(working, touched(), startTexts);
    working = after.project;
    if (after.repaired.length) crew.push({ worker: 'house', notes: after.repaired.join(' ') });
  }

  status('');
  if (stopped()) return { project: working, reply: '', cards: allCards, batches, crew, edits: turnEdits, asks, error: 'stopped', stopped: true };

  /* Now the one voice the writer hears. */
  const said = backstageBrief(crew, allCards, p);
  const messages = frontMessages(working, said, asks);

  let reply = '';
  try {
    const out = early && earlyKept
      ? await early.keep((t, at) => { reply += t; onText(t, at); }, onThinking,
        () => streamModel(frontConn, { system: frontSystem, messages, onText: (t) => { reply += t; onText(t); }, onThinking, signal }))
      : await streamModel(frontConn, {
        system: frontSystem, messages,
        onText: (t) => { reply += t; onText(t); },
        onThinking, signal,
      });
    reply = endAtControlToken(out.text || reply);
    if (out.cut) return { project: working, reply, cards: allCards, batches, crew, edits: turnEdits, asks, error: null, cut: true };
  } catch (e) {
    const aborted = (e && e.name === 'AbortError') || stopped();
    return {
      project: working, reply: endAtControlToken(reply), cards: allCards, batches, crew, edits: turnEdits, asks,
      error: aborted ? 'stopped' : ((e && e.message) || String(e)), stopped: aborted,
    };
  }
  return { project: working, reply, cards: allCards, batches, crew, edits: turnEdits, asks, error: null };
}

/* A REPLY STARTED EARLY AND HELD UNSEEN (see the listener, in runTurn). What
 * arrives is kept with the moment it arrived, so a thinking box shown later
 * still says how long the model really thought. keep() shows what was held,
 * then lets the rest arrive live; if the early reply failed before a word of
 * it came, for a reason that starting early could have caused — the provider
 * busy, a limit on calls at once, a dropped line — the ordinary one is asked
 * for instead (again()), so starting early can never cost him his answer. A
 * bad key or a wrong model fails the same way twice, so it is said as it is.
 * drop() lets it go unseen. */
const PASSING = (status) => !status || status === 408 || status === 429 || status >= 500;
export function heldFront(start) {
  const ctl = new AbortController();
  const held = [];
  let live = null;
  let spoke = false;
  const toText = (t) => { spoke = true; if (live) live.text(t); else held.push(['text', t, Date.now()]); };
  const toThinking = (t) => { if (live) live.thinking(t); else held.push(['thinking', t, Date.now()]); };
  const done = Promise.resolve().then(() => start(toText, toThinking, ctl.signal)).then((out) => ({ ok: true, out }), (e) => ({ ok: false, e }));
  return {
    drop() { ctl.abort(); },
    async keep(onText, onThinking, again) {
      for (const [k, t, at] of held.splice(0)) (k === 'text' ? onText : onThinking)(t, at);
      live = { text: (t) => onText(t), thinking: (t) => onThinking(t) };
      const r = await done;
      if (r.ok) return r.out;
      if (!spoke && !(r.e && r.e.name === 'AbortError') && PASSING(Number(r.e && r.e.status) || 0)) return again();
      throw r.e;
    },
  };
}

/* A job the listener chose. When it answers something a worker put to him,
 * that worker gets back its own words, whole, and what he said to them —
 * never a retelling (the persona's retelling is in the conversation too). */
export function jobFor(j, open, message, p) {
  const who = (p && p.you) || 'the author';
  const waiting = j.resumes ? (open || []).find((o) => o.worker === j.worker) : null;
  const task = j.task || message;
  const about = waiting
    ? `${task}\n\nWhat you put to ${who} last time, word for word:\n${waiting.ask}\n\nWhat ${who} said back:\n${message}`
    : task;
  return { worker: j.worker, about, why: waiting ? 'his answer to what was put to him' : 'the listener' };
}

/* What waits on him, as the persona is told it: put all of it to him. */
export function waitingBrief(asks, p) {
  const who = (p && p.you) || 'the author';
  return `Still to decide \u2014 this cannot go further until ${who} decides. Put every point of it to ${who}, in your own voice, and leave the choice there:\n` +
    asks.map((a) => naturalize(a.ask)).join('\n\n');
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
  return { text: t.text, thinking: t.thinking || '', thinkingMs: t.thinkingMs, cards: t.cards || [], edits: t.edits || [], asks: t.asks || [], cut: Boolean(t.cut), failed: Boolean(t.failed), at: t.at, batches: [] };
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
  /* A DOCUMENT DELETED THIS TURN IS DELETED WHERE IT LANDS. Only additions and
   * changes used to be carried over, so a delete he asked for came back. If he
   * changed it by hand while the crew worked, his version stays. */
  const kept = new Set(((result.project && result.project.docs) || []).map((d) => d.name));
  for (const [name, start] of snapshot) {
    if (kept.has(name) || !(result.project && result.project.docs)) continue;
    const now = live.get(name);
    if (!now) continue;
    if (now.text !== start) { conflicts.set(name, 'you changed it by hand while the crew worked, so it was kept'); continue; }
    next.docs = next.docs.filter((d) => d.name !== name);
  }
  const cards = (makerTurn.cards || []).map((c) =>
    c.status === 'applied' && conflicts.has(c.name) ? { ...c, status: 'refused', why: conflicts.get(c.name) } : c);
  const batches = (makerTurn.batches || [])
    .map((b) => ({ ...b, items: (b.items || []).filter((it) => !conflicts.has(it.name)) }))
    .filter((b) => b.items.length);
  const chat = next.chats.find((c) => c.id === chatId);
  if (result.project && result.project.recentSections) next.recentSections = result.project.recentSections;
  nameWorld(next);
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
export function commit(project, edits, label, maker = null) {
  if (!edits || !edits.length) return { project, cards: [], batch: null, guard: null };
  const docs = docsOf(project);
  const before = new Map(docs.map((d) => [d.name, d]));
  const run = applyRun(docs, edits, { label });

  let guard = null;
  for (const [name, text] of run.texts) {
    const was = before.get(name);
    if (!was) continue;
    if ((run.cleared || []).includes(name)) continue;   /* he asked for it emptied: that is not a loss */
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
  for (const d of run.deleted || []) items.push({ name: d.name, before: d.text, afterHash: null, removed: true, kind: (before.get(d.name) || {}).kind || 'pe' });
  const batch = items.length
    ? { id: run.batch ? run.batch.id : 'u' + Date.now().toString(36), at: Date.now(), label, items, undone: false }
    : null;

  const gone = new Set((run.deleted || []).map((d) => d.name));
  const next = { ...project, docs: (project.docs || []).filter((d) => !gone.has(d.name)).map((d) => ({ ...d })) };
  const byName = new Map(next.docs.map((d) => [d.name, d]));
  for (const [name, text] of run.texts) {
    if (byName.has(name)) byName.get(name).text = text;
    /* a document the crew starts is the kind its maker makes, else what its
     * name and words say it is — the one rule the screen uses (doc/kind.js) */
    else next.docs.push({ id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, kind: kindFor(name, text, maker), text });
  }
  const touched = run.cards.filter((c) => c.status === 'applied').map((c) => c.name);
  next.recentSections = recentFrom(next, touched, project.recentSections || []);
  return { project: next, cards: run.cards, batch, guard };
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
export function sweep(project, only = null, before = null) {
  const next = { ...project, docs: (project.docs || []).map((d) => ({ ...d })) };
  const repaired = [];
  const handOver = [];
  for (const d of next.docs) {
    /* only the documents this turn changed: a document nobody touched is not
     * rewritten because another one was */
    if (only && !only.has(d.name)) continue;
    const r = lint(d.text, { kind: d.kind || 'pe', deliverable: (d.kind || 'pe') !== 'notes', keep: before ? before.get(d.name) : null });
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
/* A failure, in words the front can say as itself: no role names, no status
 * codes, no provider's text. The exact reason goes on a card for him. */
export function plainFailure(error) {
  const e = String(error || '');
  if (/without finishing/i.test(e)) return 'it took far too long and was let go';
  if (/^stopped$|let go/i.test(e)) return 'it was stopped';
  if (TOO_LONG.test(e)) return "the documents were too long for this connection's model";
  if (/\b(?:401|403)\b|api.?key|unauthori[sz]ed|forbidden|permission/i.test(e)) return 'the connection turned the key away';
  if (/\b429\b|rate.?limit|too many requests|overloaded|capacity|quota/i.test(e)) return 'the provider is too busy right now';
  if (/transport|timed? ?out|did not (?:answer|open)|econn|network|connection (?:reset|refused)|failed to fetch/i.test(e)) return 'the provider did not answer';
  if (/\b5\d\d\b|server error|internal error|bad gateway|unavailable/i.test(e)) return 'the provider had a fault on its side';
  if (/craft file/i.test(e)) return 'its instructions could not be read';
  return 'the provider would not do it';
}

export function backstageBrief(crew, cards, p) {
  const who = (p && p.you) || 'the author';
  const lines = [];
  /* WHAT HE ASKED FOR IS THE ANSWER; WHAT THE HOUSE READ BACK ON ITS OWN IS
   * ASIDE. A check, an audit, a diagnosis he asked for is what he wants to
   * hear, all of it that matters; notes are shown nowhere else, so a report
   * cut to one sentence here is a report lost. */
  const asked = [], aside = [], other = [];
  for (const c of crew) {
    if (c.failed) { other.push(`Something could not be done this time: ${plainFailure(c.failed)}.`); continue; }
    if (c.notes) {
      const said = naturalize(c.notes);
      const into = c.fromHouse ? aside : asked;
      if (said && !into.includes(said)) into.push(said);
    }
    if (c.guard) other.push(c.guard + '.');
    if (c.warn) other.push(`Some changes did not come through: ${c.warn}.`);
  }
  if (asked.length) lines.push(`What came back on what ${who} asked for (the answer to give ${who}, all of it that matters):\n${asked.join('\n')}`);
  if (aside.length) lines.push(`Read back afterwards, without being asked (mention it only if it matters):\n${aside.join('\n')}`);
  lines.push(...other);
  const applied = cards.filter((c) => c.status === 'applied');
  const refused = cards.filter((c) => c.status === 'refused' && !c.failure);
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
