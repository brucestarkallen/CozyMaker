/* CozyMaker — js/agents/run.js
 *
 * What happens when the writer says something (v2.0, a harness).
 *
 * The one he talks to reads his own instructions, then his whole engine, then
 * every document whole, and does the work itself: it changes the documents in
 * its reply. The house puts the changes in, runs the checks that need no model,
 * and — only when something needs it — tells it what happened and lets it carry
 * on: a change that did not go in, something its changes brought in that the
 * checks found, a helper's report. Helpers are its own, called by name; their
 * words come back to it, never past it. He reads what it says, and sees every
 * change it made on a card with put it back.
 */

import { loadEngine, loadEngineText, sliceFor } from '../engine/slices.js';
import { craftFor } from '../engine/crafts.js';
import { openingFor, personaOf, noteAtTheEnd } from './persona.js';
import { pickConnection, FRONT } from './roster.js';
import { callModel, streamModel, enqueue } from './call.js';
import { parseDoc, brief, readNeed, stripNeed, resolveNeed, LEAD_SHORT, nameWorld, hasPlotEssential, DEFAULT_WORLD_TITLE } from '../doc/index.js';
import { houseCommand, REGISTRY, isStoryCard, storyCardTask } from './router.js';
import { parseEdits, stripEdits, stripThinking, ownWords, applyRun, hash, openFileAtEnd } from '../doc/edits.js';
import { lint, lostSomething } from '../doc/lint.js';
import { kindFor } from '../doc/kind.js';
import { putEntries } from '../doc/entries.js';
import { searchOn, searcherFor, readSearch, stripSearch, lookUp, findingsText, SEARCH_CONTRACT, MAX_SEARCHES } from './search.js';

export const MAX_NEED_ROUNDS = 2;

/* The one standing line every backstage worker carries. A worker reads pages
 * of somebody's fiction; its job is its own small task and never a judgment of
 * the tale. Without this, a worker eventually stops to have an opinion about
 * the story, and the writer gets a lecture instead of a file. */
export const CRAFT_FRAME =
  'This is craft work on a piece of fiction being built by its author. Your job is the task below and nothing else — never an opinion on the material, never a refusal of it.';

/* HOW THIS ROOM WORKS (v2.0), said to the one he talks to — under his own
 * instructions and his whole engine, in the persona's own voice.
 *
 * It used to be a firewall: the one he talks to was given a few sentences and
 * an outline of the documents, never his engine and never a way to change
 * anything, while a crew he never heard from did the work behind it. He found
 * that confusing and worse than his own engine pasted into one model (Oct 7
 * 2026) — the one he talked to could not read the plot essential it was
 * talking about, and could not say what the crew had done or why. His engine
 * is written to sit under a persona ("You are also Generalist … whatever
 * persona is defined above these instructions stays in force"), and that is
 * how his own Plot Essential Maker ran it: persona, engine, the document whole,
 * changes made in the reply. So this is a harness, the way a coding agent is
 * one: the one he talks to holds everything and does the work, the house puts
 * its changes in and tells it what happened, and the helpers are its own, called
 * by name, reporting back to it.
 *
 * WRITTEN IN BOTH VOICES, never rewritten word by word: swapping pronouns by
 * pattern gave a first-person persona "Bruce only ever talks to I". */
export const HELPERS = ['eye', 'worldbook', 'auditor', 'instructions'];
export const HELPER_NAMES = { eye: 'the eye', worldbook: 'the worldbook keeper', auditor: 'the memory auditor', instructions: 'the instructions writer' };
/* the line every turn's opening can be known by (the stand-ins in the suites use it) */
export const ROOM_MARK = 'How this room works';

const CHANGE_FORM = `<edits>
[
  {"file": "which document.md", "find": "words copied exactly from the document", "replace": "what they become", "reason": "why"},
  {"file": "which document.md", "insert_after": "an exact line to put it under", "replace": "the new text", "reason": "why"},
  {"file": "which document.md", "append": true, "replace": "text added at the very end", "reason": "why"}
]
</edits>`;
const FILE_FORM = `<file name="which document.md">
the whole document, word for word
</file>`;
const HELPER_FORM = '<helper name="the eye">what to read back, and what to look for</helper>';

export function frontBody(p, { search = false } = {}) {
  const him = (p && p.you) || 'the author';
  const Him = (p && p.you) || 'The author';
  const rules = (my) => [
    `- "find" and "insert_after" are copied character for character from the document as it stands. Quote the shortest stretch that appears only once.`,
    '- The block is valid data: a newline inside a string written as \\n, a double quote inside a string written as \\", no trailing commas. To change every place the same words appear, add "all": true.',
    `- A document is rebuilt whole only when the whole of it is being rebuilt: anything left out of it is deleted.`,
    `- {"file": "\u2026", "clear": true} empties a document and {"delete_file": "\u2026"} removes it \u2014 only when ${him} asks for that.`,
    '- Nothing written into a document may be a note, a flag, a marker or an instruction: what goes into a document is the story, and nothing else.',
    `- The tags appear only around a real change, never inside ${my} sentences.`,
  ].join('\n');
  const helperLines = (my) => [
    `- the eye \u2014 reads the documents back with fresh eyes against ${my} engine and puts right what is wrong. For after a big change, or when ${him} wants a second check.`,
    '- the worldbook keeper \u2014 builds and keeps a SillyTavern worldbook, with its own craft: every entry, its keys and its settings. Worldbook work is its own.',
    '- the memory auditor \u2014 audits and repairs a Summaryception transplant, with its own craft, every marker intact. Transplant work is its own.',
    '- the instructions writer \u2014 writes and keeps AI instruction sets and presets, with its own craft.',
  ].join('\n');
  /* THE ONE HE BRAINSTORMS WITH IS A CO-WRITER (v1.5.0, his ask), word for word as it
   * was, in each of the four voices */
  const named = Boolean(p && p.you);
  const coFirst = named
    ? `While ${him} and I work a world out, I think it through with ${him} as a co-writer, not a note-taker: where something is missing or does not hold together, I reason it out and offer a couple of concrete ways it could go, and why; I tell two people apart by what each one does that the other cannot, never by adjectives; and I say so plainly when the trouble would stall, or the place could not let it happen. I ask ${him} only what only ${him} can decide \u2014 a name, a taste, a yes or no.`
    : 'While we work a world out, I think it through with them as a co-writer, not a note-taker: where something is missing or does not hold together, I reason it out and offer a couple of concrete ways it could go, and why; I tell two people apart by what each one does that the other cannot, never by adjectives; and I say so plainly when the trouble would stall, or the place could not let it happen. I ask them only what only they can decide \u2014 a name, a taste, a yes or no.';
  const coSecond = named
    ? `While you and ${him} work a world out, think it through with ${him} as a co-writer, not a note-taker: where something is missing or does not hold together, reason it out and offer a couple of concrete ways it could go, and why; tell two people apart by what each one does that the other cannot, never by adjectives; and say so plainly when the trouble would stall, or the place could not let it happen. Ask ${him} only what only ${him} can decide \u2014 a name, a taste, a yes or no.`
    : 'While the two of you work a world out, think it through with them as a co-writer, not a note-taker: where something is missing or does not hold together, reason it out and offer a couple of concrete ways it could go, and why; tell two people apart by what each one does that the other cannot, never by adjectives; and say so plainly when the trouble would stall, or the place could not let it happen. Ask them only what only they can decide \u2014 a name, a taste, a yes or no.';
  if (p && p.person === 'first') {
    return [
      `${ROOM_MARK} \u2014 read alongside everything above.`,
      `${Him} and I are building the guide to a world together: the plot essential, its continuation files, the worldbook \u2014 the documents a storyteller will later read as the whole truth of that world. This is the comfortable room where they get made, so I talk like it: two people making something good, not a service desk. ${Him} only ever talks to me, and I am the one who does the work.`,
      `The documents. Every document in this world is in front of me, whole and word for word, at the end of what ${him} sends me. I read them there and answer from them: when ${him} asks what something says, I can see it.`,
      `Talking is not writing. Brainstorming, ideas, what-ifs, a world still being talked through, a question, an opinion \u2014 I answer it, and write nothing. Nothing goes into a document until ${him} asks for it to be written: build it, write it up, put that in, add it, change it, fold it in. A suggestion to put something into a document that already exists is an ask, however softly it is put. ${coFirst}`,
      `Changing a document. I make every change myself, in my reply \u2014 my engine's deliverables are delivered here as changes to the documents, never pasted into my reply. A change to part of a document goes in one block of changes:\n\n${CHANGE_FORM}\n\nA whole document \u2014 a new one, or one rebuilt from start to finish \u2014 is written out plainly, exactly as it should read, with nothing escaped:\n\n${FILE_FORM}\n\n${rules('my')}\n\nWhat I write outside the blocks is what ${him} reads, so it stays short: what I changed, where, and why \u2014 a few lines, never the document itself \u2014 and my answer. My engine's EXPERT EYE and SCAN EVIDENCE go between <audit> and </audit>: they are kept, folded under my reply, for when ${him} wants them.`,
      `What happens next. The house puts my changes in and runs its checks. When something needs me \u2014 a change that did not go in, something the checks found that my changes brought in, a helper's report \u2014 it tells me, with the documents as they now stand, and I put right what needs it and finish my answer. When everything went in cleanly, my reply stands as I wrote it. After any change to a plot essential or a continuation file, the eye reads back what I changed against my engine, and what it finds comes back to me to put right before I answer. A change I only describe in words has not happened.`,
      `My helpers. I can hand a job to one of them and have its report back before I answer:\n\n${HELPER_FORM}\n\n${helperLines('my')}\n\nA helper sees the documents and this conversation, never my thinking, so I write its task in full. What it changes goes in like my own changes, and what it says comes back to me. The plot essential and its continuation files are my own work: I hold the whole engine.`,
      search ? 'Searching. If something real is uncertain \u2014 a canon detail of an existing story, a real person, place, date or fact \u2014 and getting it wrong would matter, I have it looked up before I write it: each thing to look up goes between <search> and </search> (a few words each, at most three), and what is found is put in front of me.' : '',
      `A different story. If ${him} is starting a different story from the one in these documents \u2014 another world, to talk through or to build \u2014 I write only <new_world/>, and nothing else. The house opens a world of its own for it and hands it back to me there.`,
      `If I want to think it through first, I think inside <think> and </think> before I answer; ${him} never sees what is inside.`,
    ].filter(Boolean).join('\n\n');
  }
  return [
    `${ROOM_MARK} \u2014 read it alongside everything above.`,
    `You and ${him} are building the guide to a world together: the plot essential, its continuation files, the worldbook \u2014 the documents a storyteller will later read as the whole truth of that world. This is the comfortable room where they get made, so talk like it: two people making something good, not a service desk. ${Him} only ever talks to you, and you are the one who does the work.`,
    `The documents. Every document in this world is in front of you, whole and word for word, at the end of what ${him} sends you. Read them there and answer from them: when ${him} asks what something says, you can see it.`,
    `Talking is not writing. Brainstorming, ideas, what-ifs, a world still being talked through, a question, an opinion \u2014 answer it, and write nothing. Nothing goes into a document until ${him} asks for it to be written: build it, write it up, put that in, add it, change it, fold it in. A suggestion to put something into a document that already exists is an ask, however softly it is put. ${coSecond}`,
    `Changing a document. You make every change yourself, in your reply \u2014 your engine's deliverables are delivered here as changes to the documents, never pasted into your reply. A change to part of a document goes in one block of changes:\n\n${CHANGE_FORM}\n\nA whole document \u2014 a new one, or one rebuilt from start to finish \u2014 is written out plainly, exactly as it should read, with nothing escaped:\n\n${FILE_FORM}\n\n${rules('your')}\n\nWhat you write outside the blocks is what ${him} reads, so keep it short: what you changed, where, and why \u2014 a few lines, never the document itself \u2014 and your answer. Your engine's EXPERT EYE and SCAN EVIDENCE go between <audit> and </audit>: they are kept, folded under your reply, for when ${him} wants them.`,
    `What happens next. The house puts your changes in and runs its checks. When something needs you \u2014 a change that did not go in, something the checks found that your changes brought in, a helper's report \u2014 it tells you, with the documents as they now stand: put right what needs it, then finish your answer. When everything went in cleanly, your reply stands as you wrote it. After any change to a plot essential or a continuation file, the eye reads back what you changed against your engine, and what it finds comes back to you to put right before you answer. A change you only describe in words has not happened.`,
    `Your helpers. You can hand a job to one of them and have its report back before you answer:\n\n${HELPER_FORM}\n\n${helperLines('your')}\n\nA helper sees the documents and this conversation, never your thinking, so write its task in full. What it changes goes in like your own changes, and what it says comes back to you. The plot essential and its continuation files are your own work: you hold the whole engine.`,
    search ? 'Searching. If something real is uncertain \u2014 a canon detail of an existing story, a real person, place, date or fact \u2014 and getting it wrong would matter, have it looked up before you write it: each thing to look up goes between <search> and </search> (a few words each, at most three), and what is found is put in front of you.' : '',
    `A different story. If ${him} is starting a different story from the one in these documents \u2014 another world, to talk through or to build \u2014 write only <new_world/>, and nothing else. The house opens a world of its own for it and hands it back to you there.`,
    `If you want to think it through first, think inside <think> and </think> before you answer; ${him} never sees what is inside.`,
  ].filter(Boolean).join('\n\n');
}

/* A helper, by the name the one he talks to calls it. */
export function helperId(name) {
  const n = String(name || '').toLowerCase().replace(/^\s*the\s+/, '').trim();
  if (!n) return null;
  if (/\beyes?\b/.test(n)) return 'eye';
  if (/world\s*-?\s*book|lore\s*book|world info/.test(n)) return 'worldbook';
  if (/memory|auditor|transplant|summaryception/.test(n)) return 'auditor';
  if (/instruction|preset/.test(n)) return 'instructions';
  return null;
}

/* What the one he talks to wrote OUTSIDE its documents and blocks of changes:
 * where its helper calls, its searches and its new-world word are read — never
 * from inside a document it is writing (an instruction set may well mention a
 * helper). */
function outsideBlocks(raw) {
  let t = stripEdits(String(raw || ''));
  /* a block of changes left open at the end (cut) is not words either */
  const lo = t.toLowerCase().replace(/<(\/?)docedits>/g, '<$1edits>');
  const at = lo.lastIndexOf('<edits>');
  if (at !== -1 && lo.indexOf('</edits>', at) === -1) t = t.slice(0, at);
  return t;
}
const HELPER_TAG = /<helper\b([^>]*)>([\s\S]*?)<\/helper\s*>/gi;
export function readHelpers(raw) {
  const out = [];
  for (const m of outsideBlocks(raw).matchAll(HELPER_TAG)) {
    const at = /(?:name|for|to)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1] || '');
    const name = at ? (at[1] || at[2] || at[3] || '').trim() : '';
    out.push({ name, id: helperId(name), task: String(m[2] || '').trim() });
  }
  return out;
}
export function wantsNewWorld(raw) { return /<new_world\s*\/?>/i.test(outsideBlocks(raw)); }

/* WHAT HE READS of a reply: its words, never its documents, blocks, helper calls,
 * searches or the new-world word. */
export function visibleText(raw) {
  let t = outsideBlocks(raw);
  t = t.replace(HELPER_TAG, '');
  const open = t.search(/<helper\b/i);
  if (open !== -1) t = t.slice(0, open);
  t = t.replace(/<new_world\s*\/?>(?:\s*<\/new_world>)?/gi, '');
  t = stripSearch(stripNeed(t));
  t = t.replace(/<audit>[\s\S]*?<\/audit>/gi, '');
  const half = t.search(/<audit>/i);
  if (half !== -1) t = t.slice(0, half);
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* THE SAME, AS IT STREAMS. The words go to the screen as they come; a document,
 * a block of changes, a helper call, a search or the new-world word is held back
 * whole — said on the status line instead ("writing Plot Essential.md · 1,240
 * words so far"). A tag cut in two by a chunk is held until it is whole. */
/* the engine's own check of a reply, between <audit> and </audit>: kept, folded under it */
export function readAudit(raw) {
  return [...outsideBlocks(raw).matchAll(/<audit>([\s\S]*?)<\/audit>/gi)].map((m) => m[1].trim()).filter(Boolean).join('\n\n');
}
const OPENERS = [
  { re: /<audit>/i, close: /<\/audit>/i, kind: 'audit' },
  { re: /<(?:doc)?edits>/i, close: /<\/(?:doc)?edits>/i, kind: 'edits' },
  { re: /<file\s+(?:name|path)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^>\n]+?))\s*\/?>/i, close: /<\/file\s*>/i, kind: 'file' },
  { re: /<helper\b([^>]*)>/i, close: /<\/helper\s*>/i, kind: 'helper' },
  { re: /<search>/i, close: /<\/search>/i, kind: 'search' },
  { re: /<need>/i, close: /<\/need>/i, kind: 'need' },
  { re: /<new_world\s*\/?>/i, close: null, kind: 'new_world' },
];
const OPENER_WORDS = ['edits', 'docedits', 'file', 'helper', 'search', 'need', 'new_world', 'audit'];
function couldOpen(tail) {
  const w = tail.slice(1).toLowerCase();
  return OPENER_WORDS.some((x) => x.startsWith(w) || w.startsWith(x));
}
export function makeVisibleStream(emit, onBlock = () => {}) {
  let buf = '';
  let inside = null;
  const nameOf = (o, m) => {
    if (o.kind === 'file') return (m[1] || m[2] || m[3] || '').trim();
    if (o.kind === 'helper') { const at = /(?:name|for|to)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1] || ''); return at ? (at[1] || at[2] || at[3] || '').trim() : ''; }
    return '';
  };
  function feed(chunk) {
    buf += String(chunk || '');
    for (;;) {
      if (inside) {
        const m = inside.close.exec(buf);
        if (!m) {
          const keep = Math.min(buf.length, 12);
          inside.body += buf.slice(0, buf.length - keep);
          buf = buf.slice(buf.length - keep);
          onBlock(inside.kind, inside.name, inside.body, false);
          return;
        }
        inside.body += buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        onBlock(inside.kind, inside.name, inside.body, true);
        inside = null;
        continue;
      }
      let best = null;
      for (const o of OPENERS) {
        const m = o.re.exec(buf);
        if (m && (!best || m.index < best.m.index)) best = { o, m };
      }
      if (best) {
        if (best.m.index) emit(buf.slice(0, best.m.index));
        buf = buf.slice(best.m.index + best.m[0].length);
        if (!best.o.close) { onBlock(best.o.kind, '', '', true); continue; }
        inside = { kind: best.o.kind, close: best.o.close, name: nameOf(best.o, best.m), body: '' };
        onBlock(inside.kind, inside.name, '', false);
        continue;
      }
      const lt = buf.lastIndexOf('<');
      if (lt !== -1 && buf.indexOf('>', lt) === -1 && buf.length - lt < 200 && couldOpen(buf.slice(lt))) {
        if (lt) emit(buf.slice(0, lt));
        buf = buf.slice(lt);
        return;
      }
      if (buf) emit(buf);
      buf = '';
      return;
    }
  }
  /* the stream is over: a block left open is never shown; a held '<' that never
   * became a tag is words after all */
  function end() {
    if (inside) { inside = null; buf = ''; return; }
    if (buf) emit(buf);
    buf = '';
  }
  return { feed, end, get hiding() { return Boolean(inside); } };
}

/* One change, as a key: the same document, the same place, the same words. */
function editKey(e) {
  /* the entries a worldbook change carries are its words: two different sets of
   * entries for one worldbook are two changes, never one made twice */
  const entries = e.entries !== undefined ? e.entries : e.entry;
  return JSON.stringify([e.file || e.create_file || '', e.find || '', e.insert_after || '', e.append === true, e.replace_all === true, e.all === true, e.whole === true, e.replace || '', entries === undefined ? null : entries]);
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
/* THE ONE HE TALKS TO READS EVERY DOCUMENT WHOLE up to this many characters
 * (about 100,000 tokens, beside his engine's 31,000): it answers about them and
 * changes them, and his models hold far more. A model too small for it says so,
 * and is given the outline and the parts in play instead (runTurn). */
export const MAKER_WHOLE = 400000;

export function docBriefs(project, opts) {
  const docs = docsOf(project);
  if (!docs.length) return 'Nothing has been written yet — there are no documents in this world so far.';
  const size = docs.reduce((n, d) => n + (d.text || '').length, 0);
  const whole = !opts.forFront && !opts.partial && size <= (opts.limit || WHOLE_LIMIT);
  /* the text before a document's first section: the front and a model too
   * small for the whole world read the start of it; any other worker reads
   * it all, up to the same limit a whole world has */
  const leadCap = opts.forFront || opts.partial ? LEAD_SHORT : WHOLE_LIMIT;
  return docs.map((d) => brief(parseDoc(d.text, d.kind), d.name, { ...opts, whole, leadCap })).join('\n\n----\n\n');
}

/* --------------------------------------------------------------- a worker */

const RETURN_CONTRACT = `When you are done, write these and nothing else.

First, in plain sentences — a short paragraph at most — what you did and what you found while you were in there, and what you read and checked to know it. Write it for a person, not for a form.

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
- If what he asks for is already in the document as it stands, change nothing, and say that it is already there.
- Never remove a passage as a repeat of another unless every fact in it is stated in the one that stays; fold whatever differs into that one first.
- Write each fact once, in the place the document keeps it. Never copy a fact into a second place so that two passages "carry the same information" \u2014 that is how a document ends up saying everything twice, and then contradicting itself.
- Never invent a fact the documents do not hold or plainly imply \u2014 unless making it is the job itself: a build, or something he asked you to add or develop; then make it fit everything already established. A missing date-time is the one your craft always assigns: from elapsed time, scene pacing and the calendar, in order with the events around it.
- If nothing should change, send neither.

Last, and only if the job cannot be finished until he decides something — the craft tells you to get his go-ahead first, or there is a question only he can answer — put everything he has to decide between <ask> and </ask>: the plan or the options, and the questions, complete enough to answer with nothing else in front of him. Make only the changes that do not wait on his answer. His answer will come back to you together with what you asked, word for word.`;

/* THE WORLDBOOK KEEPER'S ENTRIES, AS DATA (doc/entries.js). Its craft — the
 * extension's, carried over word for word — writes a change to a worldbook as an
 * append or a find and replace on the worldbook's text: a list of entries inside
 * a JSON string, every quote escaped twice. One left bare lost every entry, and
 * asked again in that form, the keeper slipped the same way (reproduced through
 * the real turn). The house's own words, given after its craft, ask for entries
 * as plain data instead; the craft's forms still land when they are well made. */
export const WORLDBOOK_FORM = `For a worldbook, entries go into the block of changes as data \u2014 never inside a string:

<edits>
[
  {"file": "the worldbook.json", "entries": [
    {"name": "Aldric", "keys": ["Aldric", "the general"], "content": "\u2026", "strategy": "green", "order": 200, "position": "after_char"},
    {"name": "The Ribway", "keys": ["Ribway", "the rope-bridges"], "content": "\u2026", "strategy": "green", "order": 120, "position": "before_char"}
  ], "reason": "why"}
]
</edits>

- An entry whose name is not in the worldbook yet is added: write it whole.
- An entry whose name is already there is changed: give its name and only the fields that change \u2014 every field you leave out stays exactly as it is.
- One change can carry as many entries as the job needs. A worldbook is never rewritten whole to add to it or to change part of it.
- This is how entries are written here, in place of an append or a find and replace on the worldbook's text, and in place of beginning an empty one with an append: those put a list inside a string, where one stray quote loses every entry.
- A worldbook rebuilt from start to finish \u2014 and only then \u2014 is written whole, as plain JSON, between <file name="\u2026"> and </file>.`;

/* WHICH WORLDBOOK, SAID TO THE KEEPER BY NAME. Told only "put it in the
 * worldbook here, or start one if there is none", the keeper followed its
 * craft's first rule — begin with an append — into a document that did not
 * exist, and the whole first worldbook was refused as "no document by that
 * name" (reproduced through the real turn). The house knows what is here, so
 * it says: the worldbook by its name, or that there is none yet and what to call
 * it. And a keeper with nothing to build from asks first, the way the builder's
 * craft interviews before a world it has never heard of (7.1). */
function fileSafe(title) {
  return String(title || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
export function worldbookNote(project, p) {
  const who = (p && p.you) || 'the author';
  const books = docsOf(project || {}).filter((d) => d.kind === 'worldbook');
  if (books.length === 1) {
    const b = books[0];
    return `The worldbook in this world is ${b.name}${(b.text || '').trim() ? '' : ' \u2014 empty so far'}: entries go into it, by that name.`;
  }
  if (books.length > 1) return `The worldbooks in this world are ${books.map((b) => b.name).join(', ')}: name the one each change is for.`;
  const title = project && project.title && project.title !== DEFAULT_WORLD_TITLE ? fileSafe(project.title) : '';
  return 'There is no worldbook in this world yet: your entries start one. ' +
    (title ? `Call it ${title}.json.` : 'Call it after the world, by the name the talk gives it \u2014 Ash Harbour.json, say \u2014 or Worldbook.json if it has no name yet.') +
    ` If nothing in the talk or the documents tells you what this world is, write nothing yet: put to ${who}, in <ask>, the few things you need to begin \u2014 what the world is, who is in it, where it happens.`;
}

/* The workers who make or fold a whole document out of the conversation. */
export const WHOLE_TALK = new Set(['builder', 'worldbook', 'chronicler', 'scribe']);

/* THE ANTI-REGRESSION REGISTRY, SAID TO EVERY WORKER ON HIS ENGINE. *regress keeps an
 * entry in it (router.js); a document every worker can see is not a document every
 * worker checks against, and the registry's own first line says every update is
 * checked against it — so every worker on the craft is told it is there and that
 * it is right: what it lists may not come back, and material that repeats one is
 * the storyteller's mistake (the craft's [REGRESSION_DETECTED], fixed as it goes). */
const ON_THE_CRAFT = new Set(['builder', 'chronicler', 'scribe', 'editor', 'eye', 'showrunner', 'compressor', 'novelist', 'diagnostician']);
export function registryNote(project, worker) {
  if (!ON_THE_CRAFT.has(worker)) return '';
  const reg = docsOf(project || {}).find((d) => d.name.toLowerCase() === REGISTRY.toLowerCase());
  const lines = reg ? reg.text.split('\n').filter((l) => /^\s*-\s+\S/.test(l)) : [];
  if (!lines.length) return '';
  return `${REGISTRY} lists what the storyteller has got wrong before \u2014 ${lines.length} thing${lines.length === 1 ? '' : 's'}. It is right: nothing you write may bring any of it back, and where the material in front of you repeats one of them, that is the storyteller's mistake, written down as the registry has it.`;
}

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

async function runWorker({ worker, sections, conn, project, message, talk, fromHouse = false, asker = '', onStatus, onProgress, signal, stale, craft = null, note = '', searcher = null, onSent = null }) {
  /* a worker with a craft of its own reads that; the rest read their slice */
  const own = craft || sliceFor(sections, worker).text;
  /* searching the internet is his switch: off, the worker reads exactly what it always did */
  const system = [CRAFT_FRAME, own, RETURN_CONTRACT, searcher ? SEARCH_CONTRACT : '', worker === 'worldbook' ? WORLDBOOK_FORM : ''].filter(Boolean).join('\n\n---\n\n');
  /* what it had looked up on the internet, kept for every later round */
  const found = [];
  let searched = false;
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
      /* what the house knows about where this job's work goes (the keeper's worldbook, by name) */
      note ? `\n${note}` : '',
      found.length ? `\n${findingsText(found)}` : '',
      /* Whose job this is, said plainly: the author's own words, or the house
       * asking for a read-back or a repair. A house job presented as his
       * request is a note put in his mouth. */
      fromHouse ? '\nWhat the house needs from you (the author did not write this — it follows from his last request):'
        : asker ? `\nWhat ${asker} needs from you \u2014 ${asker} is making this with the author, and this is part of it:` : '\nWhat the author just asked for:',
      message,
      nudge ? `\n${nudge}` : '',
    ].filter(Boolean).join('\n');

    /* how far along it is, counted over every piece of the answer so far */
    const told = (before) => (onProgress ? (p) => onProgress({ text: before + (p.text || ''), thinking: p.thinking || '' }) : undefined);
    let out = await callModel(conn, { system, messages: [{ role: 'user', content: user }], maxTokens: 8000, signal, stale, onProgress: told(''), onSent });
    for (let more = 0; out.ok && more < MAX_CARRY_ON; more++) {
      const cutAtLimit = CUT_FINISH.test(out.finish || '') && (out.text || '').trim();
      const leftOpen = openFileAtEnd(out.text);
      if (!cutAtLimit && !leftOpen) break;
      if ((stale && stale()) || (signal && signal.aborted)) break;
      onStatus && onStatus(`the ${worker}'s answer ran long \u2014 asking for the rest`);
      const rest = await callModel(conn, { onSent, system, messages: [
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

    /* IT ASKED FOR SOMETHING TO BE LOOKED UP ON THE INTERNET (only while searching is
     * on): the searcher looks, and the same worker is asked again with what came
     * back in front of it. Once per job, and it never costs a round of reading. */
    const wants = searcher && !searched ? readSearch(out.text) : [];
    if (wants.length) {
      searched = true;
      found.push(...await lookUp(searcher, wants, { signal, stale, onStatus, onSent }));
      if ((stale && stale()) || (signal && signal.aborted)) return { ok: false, error: 'stopped' };
      onStatus && onStatus(`the ${worker} is on it, with what was found`);
      round--;
      continue;
    }

    /* A BLOCK THAT LANDED IN THE THINKING IS STILL A BLOCK (Cozy Chat
     * v5.13.1). A model that reasons on its own channel sometimes writes its
     * changes there; ignoring them would report "nothing changed" when the
     * work was done. The visible answer wins when both have one. */
    let parsed = parseEdits(out.text);
    if (!parsed.edits.length && !parsed.warn && out.thinking && /<(?:doc)?edits>|<file\s/i.test(out.thinking)) {
      parsed = parseEdits(out.thinking);
    }
    /* THE DOCUMENTS COME OUT BEFORE THE THINKING DOES. A document written whole
     * can hold the word <thinking> — an instruction set or a preset very often
     * does — and the thought-stripper, run over the whole answer, cut it there:
     * everything after it went, his question in <ask> with it, and the job
     * waited on an answer he was never asked for. */
    const fromAsk = readAsk(stripThinking(stripEdits(out.text)));
    let notes = stripSearch(stripThinking(stripNeed(fromAsk.rest)));
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

/* A turn for the one he talks to alone: "go on" after a reply that was cut off. */
export const FRONT_ONLY = '__front__';

/* GO ON IS THE HOUSE'S NOTE, NOT HIS WORDS. It used to arrive under "Bruce
 * said:" as "Carry on from exactly where you stopped. No repetition and no
 * preamble" — an order in a voice he never uses, put in his mouth. */
export const GO_ON = 'Your last reply was cut off partway through. Carry straight on from the exact word where it stopped \u2014 without going back over it, and with nothing before it.';

/* HOW FAR ONE TURN MAY GO. A step is one reply from the one he talks to; the
 * house only asks for another when something needs it (a change that did not go
 * in, what the checks found, a helper's report, a search, parts it asked to
 * read). Helpers per step and lookups per turn are capped so a turn always ends. */
export const MAX_STEPS = 6;
export const MAX_HELPERS = 4;
/* what the second pass reads back: the documents his engine is the craft of */
const REVIEWED_KINDS = new Set(['pe', 'continuity']);
function kindOfName(project, name) {
  const d = ((project && project.docs) || []).find((x) => x.name === name);
  return d ? (d.kind || 'pe') : '';
}
/* the room a reply needs to write a document in it (the floor every worker had):
 * a value he set that is higher is his; nothing lower than this is sent */
export const MAKER_FLOOR = 8000;

/* A block, a document or a helper call left open at the very end of a reply. */
function openBlockAtEnd(text) {
  const t = String(text || '').replace(/<(\/?)docedits>/gi, '<$1edits>');
  const file = openFileAtEnd(t);
  if (file) return { file };
  const lo = t.toLowerCase();
  const e = lo.lastIndexOf('<edits>');
  if (e !== -1 && lo.indexOf('</edits>', e) === -1) return { edits: true };
  const h = lo.lastIndexOf('<helper');
  if (h !== -1 && lo.indexOf('</helper', h) === -1) return { helper: true };
  return null;
}

/* THE CHECKS, ON WHAT THIS TURN BROUGHT IN. The repairs code is certain of are
 * made; anything that needs judgment goes to the one he talks to — but only what
 * this turn's changes brought in. The old sweep handed every finding in a touched
 * document to a worker on every change, so a small edit to a document that was
 * already heavy, or already had an undated event, sent the compressor or the
 * chronicler through the whole of it: the churn behind a cluttered plot essential. */
function findingKey(name, f) {
  return `${name}\u0000${f.check}\u0000${/grown heavy/.test(f.check) ? '' : f.said}`;
}
export function checkChanged(project, names, startTexts) {
  const next = { ...project, docs: (project.docs || []).map((d) => ({ ...d })) };
  const repaired = [];
  const found = [];
  const fixed = new Map();
  for (const d of next.docs) {
    if (!names.has(d.name)) continue;
    const kind = d.kind || 'pe';
    const start = startTexts.has(d.name) ? startTexts.get(d.name) : null;
    const r = lint(d.text, { kind, deliverable: kind !== 'notes', keep: start });
    if (r.changed) { fixed.set(d.name, { from: d.text, to: r.text }); d.text = r.text; }
    const before = new Set();
    if (start !== null) {
      for (const f of lint(start, { kind, deliverable: kind !== 'notes', keep: start }).found) {
        if (!f.repaired) before.add(findingKey(d.name, f));
      }
    }
    for (const f of r.found) {
      if (f.repaired) repaired.push(`In ${d.name}, ${f.said}.`);
      else if (!before.has(findingKey(d.name, f))) found.push({ key: findingKey(d.name, f), name: d.name, check: f.check, said: f.said });
    }
  }
  return { project: next, repaired, found, fixed };
}

/* AN UNDO RECORD MATCHES WHAT IS IN THE DOCUMENT AFTER THE CHECKS. The checks
 * repair a change in the same turn (a working marker taken out, a score put in
 * range); the record still held the text from before that repair, so "put it
 * back" refused for ever, saying something newer was there (reproduced on 1.8.0:
 * a change carrying "[EPISTEMIC_VIOLATION]", taken out by the checks, could never
 * be put back). Every record of this turn is stamped with what the documents
 * really hold now. */
function restamp(batches, fixed) {
  for (const [name, { from, to }] of fixed) {
    const was = hash(from);
    for (let i = batches.length - 1; i >= 0; i--) {
      const it = (batches[i].items || []).find((x) => x.name === name && !x.removed);
      if (!it) continue;
      if (it.afterHash === was) it.afterHash = hash(to);
      break;
    }
  }
}

/* WHAT THE ONE HE TALKS TO READS, built in one place (v2.4): by the turn for every
 * step, and by the room's context line for the message he has not sent yet — so the
 * number on screen is the size of the real thing, never a second guess at it. */
export function makerSystemFor(house, engine) {
  const p = personaOf(house);
  const searcher = searchOn(house) ? searcherFor(house) : null;
  return openingFor(p, [engine, frontBody(p, { search: Boolean(searcher) })].filter(Boolean).join('\n\n---\n\n'));
}

/* WHAT WAS ALREADY CHANGED, AND STILL STANDS — the house's own record, so "did you
 * add it?" is answered from what is so, never from memory */
export function standingFor(past) {
  const lines = [];
  for (let i = past.length - 1; i >= 0 && lines.length < 8; i--) {
    const t = past[i];
    if (!t || t.role !== 'maker' || !(t.batches || []).some((b) => !b.undone)) continue;
    for (const c of (t.cards || []).filter((x) => x.status === 'applied')) {
      if (lines.length >= 8) break;
      const why = String(c.reason || '').replace(/\s+/g, ' ').trim();
      lines.push(`- ${c.name}: ${c.how || 'changed'}${why ? ` (${why})` : ''}`);
    }
  }
  return lines.length ? `Changed earlier in this conversation, and standing now (newest first) \u2014 for reference, never to repeat as new:\n${lines.join('\n')}` : '';
}

export function makerMessagesFor({ house, p, past, world, working = world, message = '', standing = '', houseNotes = [], small = false, asked = [], goOn = false, extra = [] }) {
  const n = (house.settings || {}).turnsOnScreen || 40;
  const earlier = (small ? past.slice(-6) : past.slice(-n)).map((t) => (t.role === 'writer' ? { role: 'user', content: t.text || '' } : { role: 'assistant', content: ownWords(t.text || '') }));
  /* ONE COPY OF THE DOCUMENTS, EVER (v2.2). Once a step has changed them, the copy in
   * his message is out of date: it is taken out, and the documents as they stand now
   * ride at the end of the house's latest note only — so a quote is never taken from
   * a copy that no longer holds. */
  let lastNote = -1;
  for (let i = extra.length - 1; i >= 0; i--) if (extra[i].role === 'user') { lastNote = i; break; }
  const docsHere = lastNote === -1
    ? [small ? 'The documents, as they stand right now \u2014 too long for this model to read whole, so the outline and the parts in play:' : 'The documents, as they stand right now \u2014 whole, word for word:',
      docBriefs(world, { message, recent: world.recentSections || [], asked, partial: small, limit: MAKER_WHOLE })]
    : ['The documents have changed since this was said. They are shown as they stand now at the end of the house\u2019s latest note, below \u2014 the only copy to read and to quote from.'];
  const later = extra.map((m, i) => (i === lastNote
    ? { role: 'user', content: `${m.content}\n\nThe documents, as they stand now${small ? ' (the outline and the parts in play)' : ', whole, word for word'} \u2014 the only copy to read and to quote from:\n\n${docBriefs(working, { message, recent: working.recentSections || [], asked, partial: small, limit: MAKER_WHOLE })}` }
    : m));
  const ask = [
    ...docsHere,
    standing ? `\n${standing}` : '',
    houseNotes.length ? `\n${houseNotes.join('\n\n')}` : '',
    /* his words under his name; with no name set, never "you said:" (it tells the
     * persona it said them itself); Go on is the house's note, with no speaker */
    goOn ? `\n${message}` : `\n${p.you ? `${p.you} said:` : 'What was just said to you:'}\n${message}`,
  ].filter(Boolean).join('\n\n');
  const last = noteAtTheEnd(house, p);
  return oneVoice(earlier.concat([{ role: 'user', content: ask }], later, last ? [last] : []));
}

/* The reading the next message would send, as it stands now: the context line. */
export async function readingFor({ house, project, history = [], message = '' }) {
  const engine = await loadEngineText();
  const past = (history || []).filter((t) => !t.failed);
  return {
    system: makerSystemFor(house, engine),
    messages: makerMessagesFor({ house, p: personaOf(house), past, world: project, message, standing: standingFor(past) }),
  };
}

/* What the house tells the one he talks to between steps — never in his voice. */
function stepReport({ p, landed = [], back = [], other = [], repaired = [], found = [], helpers = [], unknown = [], foundText = '', parts = '', nudge = '', docs = '' }) {
  const him = (p && p.you) || 'the author';
  const lines = [`(From the house, not ${him} \u2014 what came of your last reply.)`];
  if (landed.length) lines.push(`Went in: ${landed.join(', ')}.`);
  if (back.length) {
    lines.push('Did not go in:\n' + back.map((c, i) => `${i + 1}. ${c.name ? `${c.name} \u2014 ` : ''}${c.why}${c.find ? `\n   you quoted: "${String(c.find).slice(0, 400)}"` : ''}`).join('\n') +
      '\nA quote must match the document word for word \u2014 only spacing and the shape of quote marks may differ \u2014 using the shortest stretch that appears only once. Quote again from the documents as they stand now, below; send only the changes that did not go in.');
  }
  for (const o of other) lines.push(o);
  if (repaired.length) lines.push(`The house put right by itself: ${repaired.join(' ')}`);
  if (found.length) lines.push('The checks found something your changes brought in \u2014 put it right the way your engine says to:\n' + found.map((f) => `- ${f.check} \u2014 ${f.said} (in ${f.name})`).join('\n'));
  for (const h of helpers) {
    const who = HELPER_NAMES[h.id] || h.name;
    if (h.failed) { lines.push(`${who} could not do it: ${h.failed}.`); continue; }
    const made = (h.cards || []).filter((c) => c.status === 'applied');
    const missed = (h.cards || []).filter((c) => c.status === 'refused');
    lines.push(`${who.charAt(0).toUpperCase()}${who.slice(1)} says:\n${h.notes || '(nothing in words)'}` +
      (made.length ? `\nIts changes went in: ${[...new Set(made.map((c) => c.name))].join(', ')} (${made.length}).` : '\nIt changed nothing.') +
      (missed.length ? `\nOf its changes, these did not go in: ${missed.map((c) => `${c.name || 'a change'} \u2014 ${c.why}`).join('; ')}.` : '') +
      (h.ask ? `\nIt needs ${him} to decide:\n${h.ask}` : ''));
  }
  if (unknown.length) lines.push(`There is no helper called ${unknown.map((u) => `\u201c${u}\u201d`).join(' or ')}. Your helpers are ${Object.values(HELPER_NAMES).join(', ')}.`);
  if (foundText) lines.push(foundText);
  if (parts) lines.push(parts);
  if (nudge) lines.push(nudge);
  lines.push(`Put right what needs it, then finish your answer to ${him} \u2014 ${him} has already read what you wrote, so carry on from there and never say it again. If nothing needs doing, just finish your answer.`);
  return lines.join('\n\n');
}

export async function runTurn({
  house, project, history = [], message, forceWorker = null,
  onStatus = () => {}, onText = () => {}, onThinking = () => {},
  signal,
} = {}) {
  const [sections, engine] = await Promise.all([loadEngine(), loadEngineText()]);
  const connections = house.connections || [];
  const frontConn = connections.find((c) => c.id === (house.agentConnections || {})[FRONT]) || connections[0] || null;
  const general = (house.agentConnections || {})._general || null;
  const connFor = (worker) => pickConnection({ map: house.agentConnections || {}, general, connections }, worker) || frontConn;
  const p = personaOf(house);
  const searcher = searchOn(house) ? searcherFor(house) : null;
  const goOn = forceWorker === FRONT_ONLY;
  /* WHAT THE HOUSE IS DOING, SAID ONCE, WITH HOW FAR ALONG IT IS BESIDE IT */
  let doing = '';
  const status = (label, detail = '') => { doing = label; onStatus(label, detail); };
  const progress = (p2) => {
    const words = (String(p2.text || '').match(/\S+/g) || []).length;
    if (words) status(doing, `${words.toLocaleString()} words so far`);
    else if (String(p2.thinking || '').trim()) status(doing, 'thinking it through');
  };
  const stopped = () => Boolean(signal && signal.aborted);

  const past = (history || []).filter((t) => !t.failed);
  const docs = docsOf(project);
  const hasPE = hasPlotEssential(docs);
  /* what the one he talks to reads: his instructions, then his whole engine, then
   * how this room works — nothing of it ever changes between steps */
  const makerSystem = makerSystemFor(house, engine);
  /* WHAT WAS SENT, every request of the turn, kept for him (app.js keeps it on the
   * device): each with who it was for, and for the one he talks to, where its
   * reading's three parts lie in what was sent */
  const sent = [];
  const recorder = (who, parts = null) => (rec) => { const r = { who, ...rec }; if (parts) r.parts = parts; sent.push(r); return r; };
  const engineAt = engine ? makerSystem.indexOf(engine) : -1;
  const roomAt = makerSystem.lastIndexOf(ROOM_MARK);
  const makerParts = [
    { name: 'Your instructions for them, and the greeting', where: 'system', start: 0, end: engineAt > 0 ? engineAt : Math.max(0, roomAt) },
    { name: 'Your engine \u2014 engine/generalist.md, word for word', where: 'system', start: engineAt, end: engineAt + (engine || '').length },
    { name: 'How this room works', where: 'system', start: roomAt, end: makerSystem.length },
  ].filter((x) => x.start >= 0 && x.end > x.start);
  /* WHAT WAS ALREADY CHANGED, AND STILL STANDS — the house's own record, so
   * "did you add it?" is answered from what is so, never from memory */
  const standing = standingFor(past);

  const crew = [];
  const allCards = [];
  const batches = [];
  const asks = [];
  const turnEdits = [];
  const landed = new Set();
  let working = project;
  const startTexts = new Map(docs.map((d) => [d.name, d.text]));
  const talk = conversationFor(past.concat([{ role: 'writer', text: message }]), p);
  const buildTalk = conversationFor(past.concat([{ role: 'writer', text: message }]), p, BUILD_TALK);

  /* the house's own notes on his message, said before his words */
  const houseNotes = [];
  /* *regress: the house keeps the entry itself, in the registry (router.js houseCommand) */
  const kept = goOn ? null : houseCommand(message);
  if (kept && kept.what === 'regress' && kept.rest) {
    const applied = commit(working, [{ house: true, registry: kept.rest, file: REGISTRY, reason: 'you asked for it to be kept' }], 'as you asked');
    working = applied.project;
    if (applied.batch) { batches.push(applied.batch); turnEdits.push({ label: 'as you asked', edits: [{ house: true, registry: kept.rest, file: REGISTRY, reason: 'you asked for it to be kept' }] }); }
    const already = applied.cards.some((c) => c.status === 'refused' && /already in the document/.test(c.why || ''));
    allCards.push(...applied.cards.filter((c) => c.status === 'applied'));
    houseNotes.push(already ? `The house already keeps that line in ${REGISTRY}, word for word.` : `The house has kept that line in ${REGISTRY}, which every update is checked against.`);
  }
  /* *card is the house's own shortcut, not his engine's: what it means is said */
  if (!goOn && isStoryCard(message)) {
    const card = /(^|\s)\*card\b/i.exec(message);
    houseNotes.push(`(*card is this house's own shortcut; what it asks of you:)\n${storyCardTask(message.slice(card.index + card[0].length).trim(), message.slice(0, card.index).trim())}`);
  }

  let small = false;
  let asked = [];
  /* the documents in his message are the world as the turn began — every step reads
   * the same opening (and its prefix stays the same); the house's report after each
   * step carries the documents as they stand by then */
  let opening = null;
  const makerMessages = (world, extra) => makerMessagesFor({ house, p, past, world, working, message, standing, houseNotes, small, asked, goOn, extra });

  /* ONE STEP: a reply from the one he talks to, streamed, its words on screen as
   * they come and everything else held back; cut inside a document, a block or a
   * helper call, it is carried on — a document half-written is never written */
  let reply = '';
  let thinking = '';
  /* the words of the step in flight, as shown: kept if he stops it partway */
  let streamed = '';
  let quiet = false;
  let held = '';
  const step = async (extra, n) => {
    streamed = '';
    held = '';
    /* WHAT STREAMS IS WHAT HE WILL READ: the space a block leaves behind is held
     * until words follow it, a run of blank lines is one, and the step starts with
     * no space of its own — the same words, spaced the same, as the reply kept */
    let started = false;
    let space = '';
    const show = (t) => { streamed += t; if (quiet) held += t; else onText(t); };
    const vis = makeVisibleStream((t) => {
      if (!t) return;
      const body = t.replace(/\s+$/, '');
      const tail = t.slice(body.length);
      if (!body) { if (started) space += tail; return; }
      if (!started) {
        started = true;
        const lead = body.replace(/^\s+/, '');
        show((reply ? '\n\n' : '') + lead);
      } else {
        const run = space + body.slice(0, body.length - body.replace(/^\s+/, '').length);
        show((/\n[ \t]*\n/.test(run) ? '\n\n' : run.replace(/[ \t]+\n/g, '\n')) + body.replace(/^\s+/, ''));
      }
      space = tail;
    }, (kind, name, body, done) => {
      if (done) { status(''); return; }
      const words = (String(body || '').match(/\S+/g) || []).length;
      const label = kind === 'file' ? `writing ${name || 'a document'}` : kind === 'edits' ? 'writing the changes'
        : kind === 'helper' ? `handing it to ${HELPER_NAMES[helperId(name)] || name || 'a helper'}` : kind === 'search' ? 'asking for a search' : kind === 'audit' ? 'checking its work' : '';
      if (label) status(label, words ? `${words.toLocaleString()} words so far` : '');
    });
    if (!opening || small) opening = working;
    const messages = makerMessages(opening, extra);
    let thought = '';
    const think = (t) => { thought += t; onThinking(t); };
    let out = await streamModel(frontConn, { system: makerSystem, messages, onText: (t) => vis.feed(t), onThinking: think, signal, floor: MAKER_FLOOR,
      onSent: recorder(`the one you talk to \u2014 step ${n + 1}`, makerParts) });
    let raw = out.text || '';
    for (let more = 0; out.cut && out.cutBy !== 'provider' && more < MAX_CARRY_ON && openBlockAtEnd(raw); more++) {
      if (stopped()) break;
      const open = openBlockAtEnd(raw);
      const rest = await streamModel(frontConn, { system: makerSystem, signal, floor: MAKER_FLOOR, onText: (t) => vis.feed(t), onThinking: think,
        onSent: recorder(`the one you talk to \u2014 step ${n + 1}, carried on`, makerParts),
        messages: messages.concat([{ role: 'assistant', content: raw }, { role: 'user', content: open.file ? fileLeftOpen(open.file) : CARRY_ON }]) });
      if (!String(rest.text || '').trim()) break;
      raw = joinSeam(raw, rest.text);
      out = { ...rest, text: raw };
    }
    vis.end();
    return { raw: endAtControlToken(raw), thought, cut: Boolean(out.cut), cutBy: out.cutBy || (out.cut ? 'length' : '') };
  };

  /* A HELPER, sent by the one he talks to: its own craft, the documents as they
   * stand, the talk, and the task in full. A quote of its that missed goes back to
   * it once (the Plot Essential Maker's v0.11.9). Its changes land like any; its
   * words go back to the one who sent it. */
  const sendHelper = async (worker, about, label, requoting = false) => {
    let craft = null;
    try { craft = await craftFor(worker, house); }
    catch (e) { const why = (e && e.message) || String(e); crew.push({ worker, failed: why }); return { failed: plainFailure(why) }; }
    const res = await enqueue(project.id, worker, ({ signal: s, stale }) =>
      runWorker({ worker, sections, conn: connFor(worker), project: working, message: about,
        talk: WHOLE_TALK.has(worker) ? buildTalk : talk,
        note: worker === 'worldbook' ? worldbookNote(working, p) : registryNote(working, worker),
        asker: p.maker || 'the one making this with the author',
        onStatus: status, onProgress: progress, signal: either(signal, s), stale, craft, searcher, onSent: recorder(HELPER_NAMES[worker]) }));
    if (!res || !res.ok) { const why = (res && res.error) || 'did not finish'; crew.push({ worker, failed: why }); return { failed: /^(?:stopped|let go)$/.test(why) ? 'it was stopped' : plainFailure(why) }; }
    if (res.ask) asks.push({ worker, ask: res.ask, at: Date.now() });
    const fresh = (res.edits || []).map((e) => { const own = { ...e }; delete own.house; return own; }).filter((e) => !landed.has(editKey(e)));
    const applied = commit(working, fresh, label, worker);
    working = applied.project;
    fresh.forEach((e, i) => { const c = applied.perEdit ? applied.perEdit[i] : applied.cards[i]; if (c === null || (c && c.status === 'applied')) landed.add(editKey(e)); });
    if (fresh.length) turnEdits.push({ label, edits: fresh, maker: worker });
    if (applied.batch) batches.push(applied.batch);
    crew.push({ worker, notes: requoting ? '' : res.notes, cards: applied.cards, guard: applied.guard, warn: res.warn });
    const { placed, back } = sortCards(applied.cards);
    allCards.push(...placed);
    if (res.warn) allCards.push({ status: 'refused', name: '', reason: '', why: res.warn });
    if (!back.length || requoting || stopped()) { allCards.push(...back); return { notes: res.notes, ask: res.ask, cards: applied.cards }; }
    status(`asking ${HELPER_NAMES[worker]} to look at ${back.length > 1 ? 'those changes' : 'that change'} again`);
    const here = ((working && working.docs) || []).map((d) => d.name);
    const list = back.map((c, i) => `${i + 1}. ${c.name ? `In ${c.name}, ` : ''}${c.find ? `the change quoted:\n"${c.find}"\n\u2014 ` : ''}${c.why}.`).join('\n\n');
    const again = await sendHelper(worker,
      `Some of your changes could not be placed, or changed nothing:\n\n${list}\n\nA quote must match the document word for word \u2014 only spacing and the shape of quote marks may differ \u2014 using the shortest stretch that appears only once. The documents here are: ${here.length ? here.join(', ') : 'none yet'}. The documents are shown as they stand now, with every change that did land. Send only these changes again. Nothing else.`,
      `${label} (looked at again)`, true);
    if (!again.cards || !again.cards.some((c) => c.status === 'applied')) allCards.push(...back);
    return { notes: res.notes, ask: res.ask, cards: applied.cards.concat(again.cards || []) };
  };

  const extra = [];
  const raised = new Set();
  let pending = [];
  let cut = null;
  let nudgedClaim = false;
  let toldToSpeak = false;
  let lookups = 0;
  let needRounds = 0;
  let needNudged = false;
  const changedAny = () => allCards.some((c) => c.status === 'applied');
  const audits = [];
  let review = null;
  let readUpTo = allCards.length;
  const readBack = async (fresh) => {
    const names = [...new Set(fresh.map((c) => c.name))];
    const cut2 = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > 600 ? `${s.slice(0, 600)}\u2026` : s; };
    const changes = fresh.map((c) => `- ${c.name}: ${c.how || 'changed'}${c.reason ? ` (${c.reason})` : ''}${c.was ? `\n  was: ${cut2(c.was)}` : ''}${c.now ? `\n  now: ${cut2(c.now)}` : ''}`).join('\n');
    const task = `Read back what was changed just now in ${names.join(', ')}, against your craft \u2014 the Verification Engine and the Expert Eye. Find what these changes got wrong or broke: a wrong fact, a contradiction with the rest of the document, a date out of order, a name spelled two ways, anything your craft forbids. Read the whole document for that, but judge only these changes and what they touch.\n\nThe changes:\n${changes}\n\nChange nothing yourself. Begin your answer with CLEAN if nothing is wrong, or with FOUND and then each mistake: the exact words as they stand now, and what they should be.`;
    let craft = null;
    try { craft = await craftFor('eye', house); } catch (_) { /* its slice of the engine, as always */ }
    const res = await enqueue(project.id, 'eye', ({ signal: s, stale }) =>
      runWorker({ worker: 'eye', sections, conn: connFor('eye'), project: working, message: task, talk, note: registryNote(working, 'eye'),
        asker: p.maker || 'the one making this with the author', onStatus: status, onProgress: progress, signal: either(signal, s), stale, craft,
        onSent: recorder('the eye \u2014 reading it back') }));
    if (!res || !res.ok) return { clean: false, found: false, notes: '', failed: plainFailure((res && res.error) || 'did not finish'), at: Date.now() };
    const said = String(res.notes || '').trim();
    const clean = /^\W*CLEAN\b/i.test(said);
    const notes = said.replace(/^\W*(?:CLEAN|FOUND)\b[\s:.\u2014-]*/i, '').trim();
    crew.push({ worker: 'eye', notes: said, review: true });
    return { clean, found: !clean && Boolean(notes), notes, at: Date.now() };
  };
  const fail = (error, isStop) => {
    const partial = isStop && !quiet ? streamed.replace(/^\s+/, '') : '';
    const said = partial ? (reply ? `${reply}\n\n${partial}` : partial) : reply;
    /* a failure after words were already said is still said: on a card, exactly */
    const told = !isStop && said ? [{ status: 'refused', name: '', reason: '', failure: true, why: `${plainFailure(error)} (${String(error).slice(0, 160)})` }] : [];
    return { project: working, reply: said, thinking, cards: allCards.concat(pending, told), batches, crew, edits: turnEdits, asks, error: said && !isStop ? null : error, stopped: Boolean(isStop), sent, audit: audits.join('\n\n'), review };
  };

  for (let n = 0; n < MAX_STEPS; n++) {
    if (stopped()) return fail('stopped', true);
    status('');
    let got;
    try { got = await step(extra, n); }
    catch (e) {
      if ((e && e.name === 'AbortError') || stopped()) return fail('stopped', true);
      const why = (e && e.message) || String(e);
      /* A MODEL TOO SMALL FOR THE WHOLE WORLD STILL GETS THE JOB DONE: the outline
       * and the parts in play, the newest talk, and <need> for the rest */
      if (!small && TOO_LONG.test(why)) { small = true; status("the whole world is too long for this model \u2014 reading the outline instead"); n--; continue; }
      return fail(why, false);
    }
    if (got.thought) thinking = thinking ? `${thinking}\n\n${got.thought}` : got.thought;
    const ownCheck = readAudit(got.raw);
    if (ownCheck) audits.push(ownCheck);
    /* the step is done: its words are counted below, never again as words in flight */
    streamed = '';
    const raw = got.raw;
    /* A DIFFERENT STORY, IN A WORLD THAT HAS ONE: nothing is done here — the room
     * starts it in a world of its own and reads his words again there (app.js) */
    if (n === 0 && !goOn && wantsNewWorld(raw)) {
      if (hasPE) return { project, reply: '', thinking: '', cards: [], batches: [], crew: [], edits: [], asks: [], error: null, newStory: true };
      extra.push({ role: 'assistant', content: raw }, { role: 'user', content: `(From the house, not ${(p && p.you) || 'the author'}.) There is no plot essential in this world yet, so this world is the one for the new story \u2014 carry on here.` });
      continue;
    }
    const seen = visibleText(raw);
    const calls = readHelpers(raw);

    /* ITS CHANGES. A block that landed in the thinking is still a block (Cozy Chat
     * v5.13.1); the visible answer wins when both have one. Clear and delete are
     * the house's acts, and the one he talks to may ask for them; nothing else it
     * writes may claim to be the house. */
    let parsed = parseEdits(raw);
    if (!parsed.edits.length && !parsed.warn && got.thought && /<(?:doc)?edits>|<file\s/i.test(got.thought)) parsed = parseEdits(got.thought);
    /* a quiet step's words are his to read only if it brought the change it was asked for */
    const keepWords = !quiet || parsed.edits.length > 0 || calls.length > 0;
    if (quiet && keepWords && held) onText(held);
    quiet = false;
    if (seen && keepWords) reply = reply ? `${reply}\n\n${seen}` : seen;
    const own = parsed.edits.map((e) => {
      const x = { ...e };
      delete x.registry;
      if (x.clear === true || typeof x.delete_file === 'string') x.house = true; else delete x.house;
      return x;
    }).filter((e) => !landed.has(editKey(e)));
    const report = { p, landed: [], back: [], other: [], repaired: [], found: [], helpers: [], unknown: [] };
    let follow = false;
    if (own.length) {
      status('putting the changes in');
      const label = `${p.maker || 'your maker'} \u2014 ${short(message)}`;
      const applied = commit(working, own, label);
      working = applied.project;
      own.forEach((e, i) => { const c = applied.perEdit ? applied.perEdit[i] : applied.cards[i]; if (c === null || (c && c.status === 'applied')) landed.add(editKey(e)); });
      turnEdits.push({ label, edits: own, maker: null });
      if (applied.batch) batches.push(applied.batch);
      const { placed, back } = sortCards(applied.cards);
      allCards.push(...placed.filter((c) => c.status === 'applied'));
      const refusedHere = placed.filter((c) => c.status === 'refused');
      const made = placed.filter((c) => c.status === 'applied');
      if (made.length) {
        const per = new Map();
        for (const c of made) per.set(c.name, (per.get(c.name) || 0) + 1);
        report.landed = [...per].map(([nm, k]) => `${nm} (${k} change${k > 1 ? 's' : ''})`);
      }
      /* what did not go in goes back to it — and is shown to him only if it is
       * still not in when the turn ends */
      pending = back.concat(refusedHere);
      report.back = pending;
      if (pending.length) follow = true;
      crew.push({ worker: 'maker', cards: applied.cards, guard: applied.guard });
    }
    if (parsed.warn) { report.other.push(`Some of your changes could not be read: ${parsed.warn}. Send them again as valid data \u2014 a whole document goes between <file name="\u2026"> and </file>, written plainly.`); follow = true; }

    /* ITS HELPERS, in the order it named them; their reports come back to it */
    for (const h of calls.slice(0, MAX_HELPERS)) {
      if (stopped()) return fail('stopped', true);
      if (!h.id) { report.unknown.push(h.name || '(no name)'); follow = true; continue; }
      status(`${HELPER_NAMES[h.id]} is on it`);
      const res = await sendHelper(h.id, h.task || message, `${HELPER_NAMES[h.id]} \u2014 ${short(h.task || message)}`);
      if (h.id === 'eye') readUpTo = allCards.length;
      report.helpers.push({ id: h.id, name: h.name, notes: res.notes || '', cards: res.cards || [], ask: res.ask || '', failed: res.failed || '' });
      follow = true;
    }
    if (calls.length > MAX_HELPERS) { report.other.push(`Only the first ${MAX_HELPERS} helper calls are run in one reply; the rest were not.`); follow = true; }
    if (stopped()) return fail('stopped', true);

    /* THE CHECKS, on the documents this step changed, and only what it brought in */
    const touched = new Set(allCards.filter((c) => c.status === 'applied' && c.name).map((c) => c.name));
    if (touched.size) {
      const checked = checkChanged(working, touched, startTexts);
      working = checked.project;
      restamp(batches, checked.fixed);
      report.repaired = checked.repaired;
      if (checked.repaired.length) crew.push({ worker: 'house', notes: checked.repaired.join(' ') });
      report.found = checked.found.filter((f) => !raised.has(f.key));
      for (const f of report.found) raised.add(f.key);
      if (report.found.length) follow = true;
    }

    /* SEARCHING, when his switch is on: what it asked for is looked up */
    let foundText = '';
    /* read outside its documents: an instruction set it writes may well say <search> */
    const outside = stripEdits(raw);
    const wants = searcher && lookups < MAX_SEARCHES ? readSearch(outside) : [];
    if (wants.length) {
      lookups += wants.length;
      foundText = findingsText(await lookUp(searcher, wants.slice(0, MAX_SEARCHES), { signal, onStatus: status, onSent: recorder('the searcher') }));
      if (stopped()) return fail('stopped', true);
      follow = true;
    }
    /* PARTS IT ASKED TO READ, when the world was too long to show whole */
    let parts = '';
    const need = readNeed(outside);
    if (need.length) {
      const shownWhole = !small && docsOf(working).reduce((k, d) => k + (d.text || '').length, 0) <= MAKER_WHOLE;
      let grew = [];
      if (!shownWhole && needRounds < MAX_NEED_ROUNDS) {
        needRounds++;
        const more = [];
        for (const d of docsOf(working)) more.push(...resolveNeed(parseDoc(d.text, d.kind), need));
        grew = more.filter((id) => !asked.includes(id));
        asked = asked.concat(grew);
      }
      /* A REPLY SPENT ONLY ON ASKING TO READ MORE (Cozy Tavern M221): when nothing more
       * can be shown, it is told so once, and to do the job with what it has */
      if (grew.length) { parts = `The parts you asked for are now shown in full in the documents below (${need.join(', ')}).`; follow = true; }
      else if (!needNudged) { needNudged = true; parts = 'You have been shown everything that can be shown this time. Do the job now with what is in front of you \u2014 the documents below are all there is.'; follow = true; }
    }
    /* \u201cI changed it\u201d with nothing changed is sent back for the change, once */
    let nudge = '';
    if (!follow && !nudgedClaim && !own.length && !parsed.warn && !changedAny() && claimsAChange(seen)) {
      nudgedClaim = true;
      quiet = true;
      nudge = 'You said you changed something, but no change came back \u2014 a change only happens inside a block of changes or a file. Send it now, or say plainly that nothing was changed.';
      follow = true;
    }
    if (!follow) {
      if (got.cut) cut = { cutBy: got.cutBy || 'length' };
      /* THE SECOND PASS (v2.2, his ask). Any change this turn made to a plot essential
       * or a continuation file that the eye has not seen is read back by it, against
       * its part of the engine, before the turn ends. It changes nothing itself; what
       * it finds goes to the one he talks to, which puts it right in one more step.
       * Once a turn. */
      if (!got.cut && !review && n + 1 < MAX_STEPS) {
        const fresh = allCards.slice(readUpTo).filter((c) => c.status === 'applied' && REVIEWED_KINDS.has(kindOfName(working, c.name)));
        if (fresh.length) {
          status('the eye is reading it back');
          review = await readBack(fresh);
          readUpTo = allCards.length;
          if (stopped()) return fail('stopped', true);
          if (review.found) {
            extra.push({ role: 'assistant', content: raw }, { role: 'user', content: stepReport({ p, other: [
              `The eye read back what you changed this turn, against your engine, and found:\n${review.notes}\n\nPut right what is wrong, the way your engine says to \u2014 or, where the eye is mistaken, say why in a line. Then finish your answer.`] }) });
            continue;
          }
        }
      }
      /* changes made and not a word said about them: one more step to say them */
      if (!seen && !reply && changedAny() && !toldToSpeak && n + 1 < MAX_STEPS) {
        toldToSpeak = true;
        extra.push({ role: 'assistant', content: raw }, { role: 'user', content: `(From the house, not ${(p && p.you) || 'the author'}.) Your changes went in. Now tell ${(p && p.you) || 'the author'}, in your own voice, what you did.` });
        continue;
      }
      break;
    }
    extra.push({ role: 'assistant', content: raw }, { role: 'user', content: stepReport({ ...report, foundText, parts, nudge }) });
  }
  status('');
  if (stopped()) return fail('stopped', true);
  allCards.push(...pending);
  const out = { project: working, reply, thinking, cards: allCards, batches, crew, edits: turnEdits, asks, error: null, sent, audit: audits.join('\n\n'), review };
  if (cut) { out.cut = true; out.cutBy = cut.cutBy; }
  return out;
}

/* Cards that go back to whoever wrote them, and cards that stand. A missed quote,
 * a change that put back the very words it found, one with nothing saying what to
 * do, one with nowhere to go, and a rewrite the loss guard refused all go back;
 * what is already there, or only spacing, is done and says nothing. */
function sortCards(cards) {
  const back = [];
  const placed = [];
  for (const c of cards || []) {
    if (c.status !== 'refused') { placed.push(c); continue; }
    const why = c.why || '';
    if (/already in the document|only the spacing would change/.test(why)) continue;
    if (/not in the document as written|appear \d+ times|leaves the words exactly as they were|did not say what to do|there is no document by that name|did not say which document|is not a worldbook|entry came with no name|came with no content|was not an entry|carried no entries|cannot be read as data right now|would have lost/.test(why)) back.push(c);
    else placed.push(c);
  }
  return { placed, back };
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
  return { text: t.text, thinking: t.thinking || '', thinkingMs: t.thinkingMs, cards: t.cards || [], edits: t.edits || [], asks: t.asks || [], cut: Boolean(t.cut), cutBy: t.cutBy || '', failed: Boolean(t.failed), at: t.at, batches: [], sent: t.sent || [], audit: t.audit || '', review: t.review || null, context: t.context || null };
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
  const { next, conflicts } = mergeDocs(world, snapshot, result);
  const cards = (makerTurn.cards || []).map((c) =>
    c.status === 'applied' && conflicts.has(c.name) ? { ...c, status: 'refused', why: conflicts.get(c.name) } : c);
  const batches = (makerTurn.batches || [])
    .map((b) => ({ ...b, items: (b.items || []).filter((it) => !conflicts.has(it.name)) }))
    .filter((b) => b.items.length);
  const chat = next.chats.find((c) => c.id === chatId);
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

/* The documents a turn changed, put into the world as it stands NOW: his hand
 * edits made meanwhile win, a document he deleted stays deleted. One way for a
 * turn and for the rest of a cut reply. */
function mergeDocs(world, snapshot, result) {
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
    if (!now) { conflicts.set(d.name, 'it was deleted while the work went on, so it stays deleted'); continue; }
    if (now.text !== start) { conflicts.set(d.name, 'you changed it by hand while the work went on, so your version was kept'); continue; }
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
    if (now.text !== start) { conflicts.set(name, 'you changed it by hand while the work went on, so it was kept'); continue; }
    next.docs = next.docs.filter((d) => d.name !== name);
  }
  if (result.project && result.project.recentSections) next.recentSections = result.project.recentSections;
  nameWorld(next);
  return { next, conflicts };
}

/* GO ON LANDS LIKE ANY TURN. The rest of a cut reply used to be words only, because
 * the one he talks to never changed a document; now it does, so what the rest
 * changed lands the same way a turn's changes do, its cards and changes join the
 * reply it finishes, and its words join that reply's words. */
export function landContinuation(world, { chatId, snapshot, result, at, words, makerTurn }) {
  const { next, conflicts } = mergeDocs(world, snapshot, result);
  const chat = next.chats.find((c) => c.id === chatId);
  const t = chat && (chat.turns || [])[at];
  if (!t) return { world: next, landed: false, conflicts };
  const cards = (makerTurn.cards || []).map((c) =>
    c.status === 'applied' && conflicts.has(c.name) ? { ...c, status: 'refused', why: conflicts.get(c.name) } : c);
  const batches = (makerTurn.batches || [])
    .map((b) => ({ ...b, items: (b.items || []).filter((it) => !conflicts.has(it.name)) }))
    .filter((b) => b.items.length);
  const joined = words ? t.text + (/\s$/.test(t.text) || /^\s/.test(words) ? '' : ' ') + words : t.text;
  const turn = {
    ...t, text: joined, cut: makerTurn.cut, cutBy: makerTurn.cutBy,
    thinking: [t.thinking, makerTurn.thinking].filter(Boolean).join('\n\n'),
    thinkingMs: ((t.thinkingMs || 0) + (makerTurn.thinkingMs || 0)) || undefined,
    cards: (t.cards || []).concat(cards), batches: (t.batches || []).concat(batches), edits: (t.edits || []).concat(makerTurn.edits || []),
    sent: (t.sent || []).concat(makerTurn.sent || []),
    audit: [t.audit, makerTurn.audit].filter(Boolean).join('\n\n'),
    review: makerTurn.review || t.review || null,
    context: makerTurn.context || t.context || null,
  };
  if (t.versions) turn.versions = t.versions.map((v, j) => (j === t.shown ? { ...v, text: joined, cut: makerTurn.cut, cutBy: makerTurn.cutBy } : v));
  chat.turns = chat.turns.map((x, i) => (i === at ? turn : x));
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
  const run = applyRun(docs, edits, { label, putEntries });

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
  return { project: next, cards: run.cards, batch, guard, perEdit: run.perEdit };
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
