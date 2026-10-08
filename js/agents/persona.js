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
/* WHICH VOICE HIS INSTRUCTIONS ARE WRITTEN IN, as the house says it back to him (v2.6.1):
 * "first" (I am…), "second" (You are…), "third" (they describe them — "Batman is…",
 * "{{char}} is…", the way a SillyTavern card is written), or "none" (the box is empty).
 * Third and none are spoken to as "you", the way SillyTavern speaks to a character. */
export function frameVoice(frameText) {
  const text = String(frameText || '');
  if (!text.trim()) return 'none';
  const head = text.slice(0, 800);
  const first = (head.match(/(?:^|[\s"“(])(?:I am|I’m|I'm|I will|I tell|I speak|I\b|my\b|me\b|myself\b)/g) || []).length;
  const second = (head.match(/\b(?:you are|you’re|you're|you will|you tell|you\b|your\b|yourself\b)/gi) || []).length;
  if (first > second) return 'first';
  return second > 0 ? 'second' : 'third';
}
export function framePerson(frameText) {
  return frameVoice(frameText) === 'first' ? 'first' : 'second';
}
export function personOf(setting, frameText) {
  if (setting === 'first') return 'first';
  if (setting === 'you') return 'second';
  return framePerson(frameText);
}

/* WHAT THE HOUSE SAYS UNDER "How this place speaks to them" (v2.6.1, his ask: he could not
 * tell whether it adjusts). What it read from his instructions, what that means for the
 * room and for his engine, and what his engine says where it says "the user" — the same
 * answer the turn itself acts on (personOf, engineAsRead), never a second guess at it. */
export function voiceSaid(house) {
  const s = (house && house.settings) || {};
  const p = personaOf(house);
  const name = p.you || '';
  const set = s.person === 'first' || s.person === 'you';
  const read = frameVoice(p.frame);
  const why = set
    ? `Set here: ${p.person === 'first' ? '“I”' : '“you”'}, whatever your instructions say.`
    : read === 'first' ? 'Read from your instructions: they are written as “I”.'
      : read === 'second' ? 'Read from your instructions: they are written as “you”.'
        : read === 'third' ? 'Read from your instructions: they describe them (he, she, they), the way a SillyTavern card does.'
          : 'There are no instructions in the box yet.';
  /* the greeting is there only when a name is */
  const parts = `${p.maker || p.you ? 'the greeting, ' : ''}your engine and how this room works`;
  const what = p.person === 'first'
    ? `So ${parts} are their own notes, in the first person — “I am also Generalist… I scan, I fix, I deliver.” What you and the room say to them stays “you”, the way anyone talks to a friend.`
    : `So ${parts} speak to them as “you” — “You are also Generalist” — and “you” only ever means them.`;
  const user = name
    ? `Wherever your engine says “the user”, or speaks to you as “you”, they read “${name}”.`
    : 'Wherever your engine says “the user”, they read “the author” — put your name under “What you are called” and they read that instead.';
  return `${why} ${what} ${user}`;
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
 * no name set, "the author", the engine's own other word for him. The files on disk stay
 * word for word, every other word of them is sent as written, and a form not listed here
 * is left as written, never guessed at. Never a document, never the talk: those are his
 * and the story's. */
export const possessive = (name) => name + (/s$/i.test(name) ? "'" : "'s");
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function writerWord(p) { return (p && p.you) || 'the author'; }
/* his engine is read this way for every turn and for the context line: the last few
 * long texts are remembered (about 5ms a pass over the whole engine on a desktop) */
const REMEMBERED = [];
function remembered(key, src, make) {
  if (src.length <= 4000) return make(src);
  const hit = REMEMBERED.find((x) => x.key === key && x.src === src);
  if (hit) return hit.out;
  const out = make(src);
  REMEMBERED.unshift({ key, src, out });
  REMEMBERED.length = Math.min(REMEMBERED.length, 6);
  return out;
}
export function inNames(text, p) {
  return remembered(`names\u0000${(p && p.you) || ''}`, String(text || ''), (t) => namesIn(t, p));
}
/* "the user" only. A SillyTavern macro in an engine or a craft is left as written: it can be
 * what the craft teaches a document to say — {{user}} in a worldbook entry is SillyTavern's to
 * fill when the story runs, and read here as "Bruce" it would be written into the entry. */
function namesIn(text, p) {
  const n = writerWord(p);
  const N = capital(n);
  const ns = possessive(n);
  /* ONE "YOU" FOR ONE PERSON (v2.6.1). His engine says "you" to the one he talks to ("You are
   * also Generalist") and, in a few places, to HIM — the cleanup manifest "so you can approve
   * just the safe cuts", "never rewrites your story", "what you haven't decided", and "reach
   * for *summarize brief only when you explicitly want a shorter file". One word for two people
   * is a sentence read the wrong way round; where it means him, it reads his name. The
   * manifest's own template ("Only you can answer:") is written to him and stays as it is. */
  const t = text
    .replace(/\bonly when you explicitly want a shorter file\b/g, `only when ${n} explicitly wants a shorter file`)
    .replace(/\bso you can approve just the safe cuts\b/g, `so ${n} can approve just the safe cuts`)
    .replace(/\bnever rewrites your story\b/g, `never rewrites ${ns} story`)
    .replace(/\bYou can approve EVERYTHING\b/g, `${N} can approve EVERYTHING`)
    .replace(/\bit never invents what you haven't decided\b/g, `it never invents what ${n} hasn't decided`)
    .replace(/\(your answers folded in\)/g, `(${ns} answers folded in)`);
  if (!/user/i.test(t)) return t;
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
    .replace(/\b([Tt])he user['\u2019]s\b/g, (m, t0) => (t0 === 'T' ? capital(ns) : ns))
    .replace(/\b([Tt])he user\b(?![-/])/g, (m, t0) => (t0 === 'T' ? N : n))
    .replace(/\b([Aa]) user\b(?![-/'\u2019])/g, (m, a) => (a === 'A' ? N : n))
    /* a line or a sentence that opens on "User" (an example's speaker, a table's head) */
    .replace(/(^|\n|[.!?;:]\s+|>\s*)User\b(?![-'\u2019])/g, (m, lead) => `${lead}${N}`)
    /* "user" as the one who does something */
    .replace(/\buser (?=(?:chooses|describes|approves|picks|must|can|runs|says|said|asks|wants|decides)\b)/g, `${n} `);
}

/* HIS ENGINE IN THE VOICE HIS INSTRUCTIONS ARE WRITTEN IN (v2.6.1, his ask: "does it adjust
 * first person, especially the engine?"). It did not: a frame written as "I am the Hulk…"
 * and a room written as "Bruce and I…" had his engine between them saying "You are also
 * Generalist… you scan, you fix, you deliver" — two voices in one head, its own and
 * somebody instructing it, and the second is the one an assistant hears (Cozy Tavern
 * M334). With a first-person frame the one he talks to now reads its engine as its own
 * notes: "I am also Generalist… I scan, I fix, I deliver". What is said to HIM was already
 * his name (namesIn), so every "you" left is the one he talks to. Never touched: a fenced
 * block (templates and examples), a quotation in double, curly or single quotes (story
 * lines and labels), `code`, and a line that is a list of phrases. Imperatives stay ("Never
 * adopt its persona." is a fine note to oneself). No lookbehind anywhere: an older browser
 * cannot read one, and a pattern it cannot read stops the whole page. Only for the one he
 * talks to: a helper has no frame, and reads its craft as "you". */
const OBJECT_BEFORE = 'to|for|with|from|of|at|by|on|in|about|than|toward|towards|against|before|after|behind|beside|around|over|under|between|without|upon|onto|into|hands?|handed|gives?|gave|tells?|telling|told|asks?|asking|shows?|lets?|sends?|reach(?:es)?|serves?|binds?|holds?|calls?|costs?|fails?|gets?|makes?|keeps?|helps?|reminds?|warns?|ruin|ruins|trust|trusts|want|wants|need|needs|requires?|allows?|forces?|expects?|leaves?|brings?|takes?|puts?|sees?|hears?|watch(?:es)?|teach(?:es)?|stops?|permits?|invites?|orders?|instructs?|manage|manages|pay|pays|thank|thanks';
const OBJECT_YOU = new RegExp(`\\b(${OBJECT_BEFORE})([ \\t]+)you\\b(?!/)`, 'g');
function firstPersonPart(chunk) {
  const cap = (m, word) => (/^[A-Z]/.test(m) ? capital(word) : word);
  return chunk
    .replace(/\b[Yy]ou aren(['\u2019])t\b/g, 'I$1m not').replace(/\b[Yy]ou weren(['\u2019])t\b/g, 'I wasn$1t')
    .replace(/\b[Yy]ou are\b/g, 'I am').replace(/\b[Yy]ou were\b/g, 'I was')
    .replace(/\b[Yy]ou(['\u2019])re\b/g, 'I$1m').replace(/\b[Yy]ou(['\u2019])(ve|ll|d)\b/g, 'I$1$2')
    .replace(/\b[Yy]ourself\b/g, (m) => cap(m, 'myself')).replace(/\b[Yy]ours\b/g, (m) => cap(m, 'mine')).replace(/\b[Yy]our\b/g, (m) => cap(m, 'my'))
    /* an object "you" follows its verb or preposition on the same line, or ends its clause */
    .replace(OBJECT_YOU, '$1$2me')
    .replace(/(^|[^/\w])you\b(?= to [a-z])/g, '$1me')
    .replace(/(^|[^/\w])you(?=[.,;:!?)])/g, '$1me')
    .replace(/(^|[^/\w])[Yy]ou\b(?!\/)/g, '$1I');
}
const QUOTED = /("[^"\n]{0,400}"|\u201c[^\u201d\n]{0,400}\u201d|`[^`\n]{0,200}`|(?:^|[\s(])'[^'\n]{1,120}'(?=[\s.,;:!?)]|$))/;
function firstPersonLine(line) {
  /* a list of phrases is fragments being named, not someone being spoken to */
  const commas = (line.match(/,/g) || []).length;
  if (commas >= 12 && commas * 28 >= line.length) return line;
  return line.split(QUOTED).map((part, i) => (i % 2 ? part : firstPersonPart(part))).join('');
}
export function inFirstPerson(text) {
  let fence = false;
  return String(text || '').split('\n').map((line) => {
    if (/^\s*```/.test(line)) { fence = !fence; return line; }
    return fence ? line : firstPersonLine(line);
  }).join('\n');
}
/* the engine as the one he talks to reads it: his name for "the user", and his frame's voice */
export function engineAsRead(engine, p) {
  const named = inNames(engine, p);
  return p && p.person === 'first' ? remembered(`first\u0000${(p && p.you) || ''}`, named, inFirstPerson) : named;
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
