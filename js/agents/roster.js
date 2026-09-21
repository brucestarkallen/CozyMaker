/* CozyMaker — js/agents/roster.js
 *
 * Who does which quiet work, and on whose hands.
 *
 * The writer talks to exactly one intelligence: the one at the front. Every
 * other worker is backstage — it reads a brief, does one job, and hands back
 * document edits and a plain sentence about what it found. The writer never
 * sees a worker's words, which is why a worker may carry the craft's technical
 * language and the front-of-house may not.
 *
 * Any worker may be given its own connection: cheap, careful work can ride a
 * cheap model while the front keeps the good one. The chain is the worker's
 * own pick, then the general backstage pick, then the front's connection.
 */

export const FRONT = 'keeper';

export const WORKERS = [
  ['listener',      'The listener \u2014 hears what you said and sends the right one to it, or nobody'],
  ['builder',       'The builder — starts a new world, or rebuilds an old story without losing a word'],
  ['chronicler',    'The chronicler — folds what happened into the plot essential'],
  ['scribe',        'The scribe — turns notes, summaries or pasted prose into a clean continuation file'],
  ['editor',        'The editor — changes one exact thing and leaves the rest alone'],
  ['eye',           'The eye — reads the whole thing back and catches what slipped past'],
  ['showrunner',    'The showrunner — untangles a story that has grown knotted'],
  ['compressor',    'The compressor — says the same thing in fewer words, losing nothing'],
  ['novelist',      'The novelist — works out whether the story can reach where you want it'],
  ['diagnostician', 'The diagnostician — works out why the storyteller went wrong'],
  ['worldbook',     'The worldbook keeper — builds and keeps a SillyTavern worldbook, every field chosen per entry'],
  ['auditor',       'The memory auditor — audits and repairs a Summaryception transplant, markers intact'],
  ['instructions',  'The instructions writer — writes and keeps AI instruction sets and presets'],
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
