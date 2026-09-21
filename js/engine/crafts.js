/* CozyMaker — js/engine/crafts.js
 * The crafts that are not sliced from the generalist engine: the Plot Essential
 * and Instructions Maker's Worldbook Maker and Summaryception Auditor, carried
 * over as they are (engine/crafts.json records the source and the only words
 * changed: its "docedits" is this house's "edits"), and the instructions
 * writer's craft, which is the writer's own to set. */

const FILES = { worldbook: 'worldbook-maker.md', auditor: 'sc-auditor.md' };
const cache = new Map();

export const DEFAULT_INSTRUCTIONS_CRAFT = [
  'You write and keep AI instruction sets: system prompts, presets, character and persona definitions, and rules that another model will follow.',
  '',
  'Keep the author\'s voice and structure. Change only what the job asks for; everything else stays word for word.',
  'Every rule must be followable: one instruction per idea, stated once, in the imperative, with no two rules that pull against each other. When two do, say which wins, or ask.',
  'Say what to do, not only what to avoid. Give the reason when a model would otherwise misapply the rule.',
  'No commentary inside the instructions themselves: they are read by a model at work, not by a reader.',
  'Before you change anything, read the whole document: a new rule that repeats or contradicts an old one is the commonest way instruction sets decay.',
].join('\n');

/* His own version of a craft, if he has set one (an older house kept the
 * instructions writer's under instructionsCraft). */
export function ownCraft(house, worker) {
  const set = house && house.crafts && typeof house.crafts[worker] === 'string' ? house.crafts[worker]
    : worker === 'instructions' && house && typeof house.instructionsCraft === 'string' ? house.instructionsCraft : '';
  return set.trim() ? set : '';
}

export async function craftFor(worker, house, fetcher = fetch) {
  if (!FILES[worker] && worker !== 'instructions') return null;
  return ownCraft(house, worker) || originalCraft(worker, fetcher);
}

export async function originalCraft(worker, fetcher = fetch) {
  if (worker === 'instructions') return DEFAULT_INSTRUCTIONS_CRAFT;
  const f = FILES[worker];
  if (!f) return null;
  if (cache.has(f)) return cache.get(f);
  const res = await fetcher('/engine/' + f, { cache: 'no-store' });
  if (!res.ok) throw new Error(`the craft file could not be read (engine/${f})`);
  const text = await res.text();
  cache.set(f, text);
  return text;
}

export function setCraftForTests(worker, text) { if (FILES[worker]) cache.set(FILES[worker], text); }
