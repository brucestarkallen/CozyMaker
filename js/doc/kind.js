/* CozyMaker — js/doc/kind.js
 *
 * WHAT KIND OF DOCUMENT THIS IS — one rule, for the screen and the crew alike.
 *
 * The kind decides everything that happens to a document afterwards: which
 * checks run on it (a plot essential's checks take out "TBD:" lines, empty
 * headings and bonds on the main character — none of which may ever be done
 * to an instruction set), which worker's jobs it offers, and how the listener
 * names it. There used to be two guesses: the one for a document he brings
 * in, which read its name and its words, and a thinner one for a document the
 * crew started, which read only its name and knew nothing of instruction sets
 * or transplants. So an instruction set the instructions writer started as
 * "Eni.md" became a plot essential, and was tidied like one.
 *
 * Now there is one guess, and a document the crew starts is first of all the
 * kind its maker makes. */

import { looksLikeTransplant } from './transplant.js';

/* A worldbook is known by what it IS — data that reads as a list of entries —
 * never by a first character: a pasted note that opens "[OOC: …]" is words. */
function readsAsWorldbook(t) {
  if (!/^[[{]/.test(t)) return false;
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) || Boolean(v && typeof v === 'object' && v.entries);
  } catch (_) { return false; }
}

export function guessKind(name, text = '') {
  const n = String(name).toLowerCase();
  const t = String(text).trim();
  if (looksLikeTransplant(t) || n.includes('transplant')) return 'transplant';
  if (n.endsWith('.json') || n.includes('worldbook') || readsAsWorldbook(t)) return 'worldbook';
  if (/instruction|system prompt|preset/.test(n)) return 'instructions';
  if (n.includes('continuity') || n.includes('brief') || /file\s*\d/.test(n) || /^#\s*PLOT ESSENTIAL CONTINUITY/i.test(t)) return 'continuity';
  if (n.includes('note')) return 'notes';
  return 'pe';
}

/* The workers who only ever make one kind of document. The rest — the
 * builder above all, whose *import writes a plot essential AND continuation
 * files in one answer — are read by the name and the words. */
const MAKES = { instructions: 'instructions', worldbook: 'worldbook', auditor: 'transplant', scribe: 'continuity' };

export function kindFor(name, text = '', maker = null) {
  return (maker && MAKES[maker]) || guessKind(name, text);
}
