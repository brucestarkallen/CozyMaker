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
 * whole words only, exactly as SillyTavern does. A macro whose name box is
 * empty is left as written rather than guessed at. */
/* {{user}} is read in any case, as SillyTavern reads it; <USER> and <BOT> only
 * in capitals — a preset's own <user> tag is markup, not a name. */
export const MACROS = /\{\{\s*([Uu][Ss][Ee][Rr]|[Cc][Hh][Aa][Rr])\s*\}\}|<(USER|BOT)>/g;
export function voiceMacros(text, p) {
  return String(text || '').replace(MACROS, (whole, curly, angle) => {
    const which = (curly || (angle && angle.toUpperCase() === 'USER' ? 'user' : 'char')).toLowerCase();
    const name = which === 'user' ? p.you : p.maker;
    return name || whole;
  });
}
export function unfilledMacros(p) {
  const found = new Set();
  for (const m of String(p.frame || '').matchAll(MACROS)) {
    const which = (m[1] || (m[2] && m[2].toUpperCase() === 'USER' ? 'user' : 'char')).toLowerCase();
    if (which === 'user' && !p.you) found.add('{{user}}');
    if (which === 'char' && !p.maker) found.add('{{char}}');
  }
  return [...found];
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

/* How the app refers to the writer in its own sentences. */
export function addressWriter(p) {
  return p.you || 'the author';
}
