/* CozyMaker — js/agents/roster.js
 *
 * Who does the work, and on whose hands (v2.0).
 *
 * The writer talks to exactly one intelligence, and it does the work: it reads
 * his whole engine and every document, and changes them itself. Its helpers are
 * its own — it calls them by name, writes their task, and reads what they say
 * back before it answers him. Any helper may be given its own connection:
 * careful work can ride a cheap model while the one he talks to keeps the good
 * one. The chain is the helper's own pick, then the pick for all of them, then
 * the connection of the one he talks to.
 */

export const FRONT = 'keeper';

export const WORKERS = [
  ['eye',           'The eye \u2014 reads the documents back with fresh eyes and puts right what slipped past'],
  ['worldbook',     'The worldbook keeper \u2014 builds and keeps a SillyTavern worldbook, every field chosen per entry'],
  ['auditor',       'The memory auditor \u2014 audits and repairs a Summaryception transplant, markers intact'],
  ['instructions',  'The instructions writer \u2014 writes and keeps AI instruction sets and presets'],
];

export const WORKER_IDS = WORKERS.map((r) => r[0]);

/* map: house.agentConnections ({worker: connectionId}); general: the backstage
 * pick for anyone without their own; connections: every saved connection.
 * Returns the connection to use, or null so the caller falls back to the
 * front's own. A pick that names a deleted connection degrades to the next
 * link in the chain rather than silently shadowing it. */
export function pickConnection({ map = {}, general = null, connections = [] }, worker) {
  const own = map && map[worker];
  if (own) {
    const hit = connections.find((c) => c.id === own);
    if (hit) return hit;
  }
  if (general) return connections.find((c) => c.id === general) || null;
  return null;
}
