/* CozyMaker — js/agents/persona.js
 *
 * THE LAW THIS FILE EXISTS FOR: the only intelligence the writer ever talks
 * to must sound like a person, and must sound like the person the writer
 * wrote. Everything this app says to that intelligence is written the way two
 * people talk to each other. No tags. No field names. No "system", no
 * "context", no "protocol", no "assistant", no square-bracket alerts. If a
 * sentence here would look strange inside a conversation between two friends
 * building a world together, it is wrong and it breaks the persona.
 *
 * The writer's own instructions go FIRST and are never edited, never wrapped,
 * never summarized. Whatever this file adds, it adds underneath them, in the
 * same voice.
 *
 * Two names and a choice of person, exactly as the writer sets them:
 *   makerName  — who is making this with him (Eni, Generalist, Iron Man …)
 *   yourName   — what he is called (Bruce, Jovan …)
 *   person     — 'second' addresses the maker as "you"; 'first' writes it as
 *                the maker's own voice, "I".
 */

export function personaOf(house) {
  const s = (house && house.settings) || {};
  const frame = (house && house.personaFrame) || '';
  return {
    maker: (s.makerName || '').trim(),
    you: (s.yourName || '').trim(),
    person: personOf(s.person, frame),
    frame,
  };
}

/* FIRST PERSON OR SECOND, AS HIS INSTRUCTIONS ARE WRITTEN (Cozy Tavern M334,
 * "Follow the frame"). A persona written as "I am Eni…" that is then handed
 * "You and Bruce are building…" reads two voices in one head: its own, and
 * somebody instructing it — and the second is the voice an assistant hears.
 * Left alone, the setting follows the frame's own opening words; "you" and
 * "first" are there to overrule it. A house saved before this setting existed
 * holds "second" only because that was the default then, and follows too:
 * for a frame written as "you" that is exactly what it was. */
export function framePerson(frameText) {
  const head = String(frameText || '').slice(0, 800);
  const first = (head.match(/(?:^|[\s"“(])(?:I am|I’m|I'm|I will|I tell|I speak|I\b|my\b|me\b|myself\b)/g) || []).length;
  const second = (head.match(/\b(?:you are|you’re|you're|you will|you tell|you\b|your\b|yourself\b)/gi) || []).length;
  return first > second ? 'first' : 'second';
}
export function personOf(setting, frameText) {
  if (setting === 'first') return 'first';
  if (setting === 'you') return 'second';
  return framePerson(frameText);
}

/* How the app names the two of them in a sentence. */
export function names(p) {
  return {
    maker: p.maker || 'you',
    makerSelf: p.maker || 'I',
    you: p.you || 'the writer',
  };
}

/* The greeting line that opens everything the app hands the maker. In second
 * person it reads like someone leaning in: "Hey Eni, this is Bruce." In first
 * person it reads as the maker's own thought. With no names set it simply
 * says nothing rather than inventing a placeholder. */
export function greeting(p) {
  if (!p.maker && !p.you) return '';
  if (p.person === 'first') {
    if (p.maker && p.you) return `I'm ${p.maker}, and ${p.you} is here with me.`;
    if (p.maker) return `I'm ${p.maker}.`;
    return `${p.you} is here with me.`;
  }
  if (p.maker && p.you) return `Hey ${p.maker}, this is ${p.you}.`;
  if (p.maker) return `Hey ${p.maker}.`;
  return `This is ${p.you}.`;
}

/* The whole opening the front-of-house intelligence reads. The writer's own
 * instructions first and untouched; then, in the same conversational voice,
 * what this place is and how the two of them work here. */
/* {{user}} and {{char}} — and <USER> and <BOT> — are SillyTavern's names for
 * the two of them. His instructions come from there, and sent raw they reach
 * the model as template syntax (Cozy Tavern M361). They are read as his names,
 * whole words only, exactly as SillyTavern does; a macro whose name box is
 * empty reads as a plain word (below). */
/* {{user}} is read in any case, as SillyTavern reads it; <USER> and <BOT> only
 * in capitals — a preset's own <user> tag is markup, not a name. {user} and {char}
 * with one brace are read too (v2.5): it is how he writes them himself, and left
 * alone they reached the model as braces — the one thing this file exists to stop.
 * Never ${user} (a template's own), never {username} or {"user": …}. */
export const MACROS = /\{\{\s*([Uu][Ss][Ee][Rr]|[Cc][Hh][Aa][Rr])\s*\}\}|<(USER|BOT)>|(\$?)\{\s*([Uu][Ss][Ee][Rr]|[Cc][Hh][Aa][Rr])\s*\}/g;
/* which of the two a macro names, in any of its forms; null for ${user}, a template's
 * own (told apart by its $ rather than by a lookbehind, which an older browser cannot
 * read at all — and a pattern it cannot read stops the whole page) */
function macroFor(curly, angle, dollar, single) {
  if (curly) return curly.toLowerCase();
  if (single) return dollar ? null : single.toLowerCase();
  return angle && angle.toUpperCase() === 'USER' ? 'user' : 'char';
}
/* A MACRO NEVER REACHES THE MODEL AS BRACES. When he has set the name, the
 * macro reads as it — the whole point of the two boxes. When he has NOT (a
 * preset pasted in and the names not yet filled), a raw {{user}} in what the
 * model reads is exactly the persona-break he does not want, so it falls back
 * to a plain word that is grammatical wherever the macro sat — as a subject,
 * an object or a possessive — never “{{char}}”. Setting the names is still
 * better, and the house nudges him to (unfilledMacros); this only makes sure
 * nothing machine-like leaks while he has not. */
const MACRO_FALLBACK = { user: 'the author', char: 'the one telling this' };
export function voiceMacros(text, p) {
  return String(text || '').replace(MACROS, (whole, curly, angle, dollar, single) => {
    const which = macroFor(curly, angle, dollar, single);
    if (!which) return whole;
    const name = which === 'user' ? p.you : p.maker;
    return name || MACRO_FALLBACK[which];
  });
}
export function unfilledMacros(p) {
  const found = new Set();
  for (const m of String(p.frame || '').matchAll(MACROS)) {
    const which = macroFor(m[1], m[2], m[3], m[4]);
    if (!which) continue;
    /* said in the form he wrote it, so he can find it in what he wrote */
    const said = m[4] ? `{${which}}` : `{{${which}}}`;
    if (which === 'user' && !p.you) found.add(said);
    if (which === 'char' && !p.maker) found.add(said);
  }
  return [...found];
}

/* HIS NAME WHERE HIS ENGINE SAYS "THE USER" (v2.6, his ask; Cozy Tavern M327's "the
 * writer" → his name). His engine says "the user" more than fifty times, and the crafts
 * the helpers read say it too: a model handed "When the user gives a command…" over and
 * over thinks "the user wants…", in an assistant's voice, under any persona. So where
 * an engine or a craft speaks of the person it works with, it reads his name — or, with
 * no name set, "the author", the engine's own other word for him. Only "user" changes:
 * the files on disk stay word for word, every other word of them is sent as written, and
 * a form not listed here is left as written, never guessed at. Never a document, never
 * the talk: those are his and the story's. */
export const possessive = (name) => name + (/s$/i.test(name) ? "'" : "'s");
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function writerWord(p) { return (p && p.you) || 'the author'; }
/* his engine is read this way for every turn and for the context line: the last few
 * long texts are remembered (about 5ms a pass over the whole engine on a desktop) */
const NAMED = [];
export function inNames(text, p) {
  const src = String(text || '');
  const key = `${(p && p.you) || ''}\u0000${(p && p.maker) || ''}`;
  const long = src.length > 4000;
  if (long) { const hit = NAMED.find((x) => x.key === key && x.src === src); if (hit) return hit.out; }
  const out = namesIn(src, p);
  if (long) { NAMED.unshift({ key, src, out }); NAMED.length = Math.min(NAMED.length, 4); }
  return out;
}
/* "the user" only. A SillyTavern macro in an engine or a craft is left as written: it can be
 * what the craft teaches a document to say — {{user}} in a worldbook entry is SillyTavern's to
 * fill when the story runs, and read here as "Bruce" it would be written into the entry. */
function namesIn(t, p) {
  if (!/user/i.test(t)) return t;
  const n = writerWord(p);
  const N = capital(n);
  const ns = possessive(n);
  return t
    /* the compounds, each said the way a person would say it */
    .replace(/\bA USER-REPORTED error\b/g, `An error ${n} REPORTED`)
    .replace(/\buser-approved content\b/g, `content ${n} approved`)
    .replace(/\buser-authored field text\b/g, `field text ${n} wrote`)
    .replace(/\bdirect user authorship\b/g, `${ns} direct authorship`)
    .replace(/\bdirect user commands\b/g, `${ns} direct commands`)
    .replace(/\bEXPLICIT user command\b/g, `an EXPLICIT command from ${n}`)
    .replace(/\bexplicit user instruction\b/g, `an explicit instruction from ${n}`)
    .replace(/\bUser-expectation mismatch\b/g, `A mismatch with ${ns} expectations`)
    .replace(/\bthe user\/AI\b/g, `${n}/the AI`)
    .replace(/\buser (input|approval|decision)\b/g, `${ns} $1`)
    /* "the user", "a user" — the person, by name */
    .replace(/\b([Tt])he user['’]s\b/g, (m, t0) => (t0 === 'T' ? capital(ns) : ns))
    .replace(/\b([Tt])he user\b(?![-/])/g, (m, t0) => (t0 === 'T' ? N : n))
    .replace(/\b([Aa]) user\b(?![-/'’])/g, (m, a) => (a === 'A' ? N : n))
    /* a line or a sentence that opens on "User" (an example's speaker, a table's head) */
    .replace(/(^|\n|[.!?;:]\s+|>\s*)User\b(?![-'’])/g, (m, lead) => `${lead}${N}`)
    /* "user" as the one who does something */
    .replace(/\buser (?=(?:chooses|describes|approves|picks|must|can|runs|says|said|asks|wants|decides)\b)/g, `${n} `);
}

export function openingFor(p, body) {
  const bits = [];
  if (p.frame && p.frame.trim()) bits.push(voiceMacros(p.frame.trim(), p));
  const hello = greeting(p);
  if (hello) bits.push(hello);
  /* the body is written in the persona's own voice already (run.js frontBody) */
  bits.push(body);
  return bits.join('\n\n');
}

/* THE NOTE AT THE END (v1.8.0; Cozy Tavern's, and SillyTavern's post-history
 * instructions). His own words, anything at all, sent after his message on every
 * turn to the one he talks to — read last, nearest the answer. Never wrapped,
 * never added to: his {{user}} and {{char}} read as the names, as in the frame.
 * Sent as a system message unless he chooses a user message; held back while
 * "Send the note at the end" is off, and never sent empty. */
export function noteAtTheEnd(house, p) {
  const h = house || {};
  const s = h.settings || {};
  const text = String(h.postNote || '').trim();
  if (!text || s.sendNote === 'off') return null;
  return { role: s.noteRole === 'user' ? 'user' : 'system', content: voiceMacros(text, p) };
}

/* How the app refers to the writer in its own sentences. */
export function addressWriter(p) {
  return p.you || 'the author';
}
