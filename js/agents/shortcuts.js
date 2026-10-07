/* CozyMaker — js/agents/shortcuts.js
 *
 * EVERY SHORTCUT, AND WHAT IT DOES HERE — so he can look one up instead of
 * remembering it. Nothing in the house listed them: a written command worked if
 * he already knew it, and a thing he cannot find does not exist. Since v2.0 every
 * one his engine names goes to the one he talks to, which reads his whole engine;
 * the house answers its own (houseCommand) before anyone is asked.
 *
 * What each line says is what happens IN THIS HOUSE — who does it, what comes
 * back, what changes — never a law of the craft: the craft's own words for each
 * command are read out of the craft itself (engineLines), word for word, so the
 * two can never disagree. tests/units.mjs holds this list to the router: every
 * command the craft or the auditor's craft names has a line here, and each one
 * goes to the one this list says it goes to. */

export const SHORTCUTS = [
  { group: 'Making one', items: [
    { cmd: '*new', who: 'maker', example: '*new a drowned harbour city ruled by a tide-cult',
      does: 'Builds a new plot essential with you. If what you have said so far is not enough to build from, it asks you a few questions first; then it writes the whole plot essential from everything you said. The same as tapping Start a plot essential, or saying \u201cbuild it\u201d.' },
    { cmd: '*source_new', who: 'maker', example: '*source_new Bleach, just after the Soul Society arc',
      does: 'Builds a plot essential from an existing story \u2014 an anime, a book, a game \u2014 with its canon as the truth it starts from.' },
    { cmd: '*hybrid_new', who: 'maker', example: '*hybrid_new my own captain, inside Bleach',
      does: 'Your own characters inside an existing story: the source\u2019s rules hold for its own people and places, yours for yours, and any clash between them is said.' },
    { cmd: '*card', who: 'maker', example: '*card \u2014 then paste the story card',
      does: 'A story card from Isekai Zero, AI Dungeon and the like becomes a plot essential ready to play, in a world of its own, with what makes it more immersive added. The same as Build from a story card. (CozyMaker\u2019s own; your engine does not have it.)' },
    { cmd: '*import', who: 'maker', example: '*import \u2014 then paste the old story',
      does: 'Brings in an old story or document whole: its world, people and rules become the plot essential in full, and its long story log becomes continuation files. Nothing is summarized away.' },
  ] },
  { group: 'Keeping it up to date', items: [
    { cmd: '*p', who: 'maker', example: '*p \u2014 then paste what the storyteller wrote',
      does: 'Folds the latest story into the plot essential: what happened, whom it changed, and where the scene stands now.' },
    { cmd: '#q', who: 'maker', example: '#q \u2014 then paste the pages or notes',
      does: 'The full fold: everything you paste \u2014 story pages, notes, bullet points \u2014 goes into the plot essential, with nothing left out. For a story played in Cozy Tavern, paste its exported story here.' },
    { cmd: '*continuity', who: 'maker', example: '*continuity \u2014 then paste notes, a summary or a Summaryception export',
      does: 'Writes a continuation file in full detail, numbered after the ones already here.' },
    { cmd: '*summarize brief', who: 'maker', example: '*summarize brief \u2014 then paste the notes',
      does: 'The same as *continuity, written shorter.' },
  ] },
  { group: 'Changing one thing', items: [
    { cmd: '*edit', who: 'maker', example: '*edit Rukia is a lieutenant',
      does: 'Changes that one thing and leaves everything else alone.' },
    { cmd: '*retcon', who: 'maker', example: '*retcon Jovan joined the division a year earlier',
      does: 'Changes a past fact, and puts right everything that leaned on the old one.' },
    { cmd: '*delete', who: 'maker', example: '*delete Aldric',
      does: 'Removes a character. Characters are only ever removed when you say so like this.' },
  ] },
  { group: 'Tidying and checking', items: [
    { cmd: '*cleanup', who: 'maker', example: '*cleanup the middle arc feels tangled',
      does: 'Reads the whole story like a director and brings you a plan to untangle it. Nothing is cut until you say yes. The same as Tidy it up.' },
    { cmd: '#prune', who: 'maker', example: '#prune the old side threads',
      does: 'A list of exactly what would be cut. Nothing goes until you say yes.' },
    { cmd: '*optimize', who: 'maker', example: '*optimize',
      does: 'Makes a document shorter without losing anything that matters. The same as Make it shorter.' },
    { cmd: '*ooc', who: 'maker', example: '*ooc \u2014 then paste the exchange that went wrong',
      does: 'Works out why the storyteller went wrong: the fault, what caused it, and the fix.' },
    { cmd: '*regress', who: 'house', example: '*regress Rukia keeps being called an unseated officer',
      does: 'Keeps that line in the Anti-regression registry, a notes document every update reads beside the plot essential. It never goes into the plot essential itself.' },
  ] },
  { group: 'Where the story goes', items: [
    { cmd: '#skip', who: 'maker', example: '#skip to the night of the siege',
      does: 'Works out whether the story can get there from where it stands. If it can, it writes the bridge as events, never as prose.' },
  ] },
  { group: 'On the screen', items: [
    { cmd: '*show_full_file', who: 'house', example: '*show_full_file',
      does: 'Opens the plot essential, whole.' },
    { cmd: '*next', who: 'house', example: '*next',
      does: 'Carries on a reply that was cut off \u2014 the same as Go on. With nothing cut off, it says so.' },
    { cmd: '*show_spoilers', who: 'house', example: '*show_spoilers',
      does: 'Nothing in CozyMaker is ever hidden, so this and *hide_spoilers only say so.' },
    { cmd: '*hide_spoilers', who: 'house', example: '*hide_spoilers',
      does: 'The same: nothing here is hidden.' },
  ] },
  { group: 'For a Summaryception transplant', items: [
    { cmd: '*audit', who: 'auditor', example: '*audit',
      does: 'Reads the whole transplant and reports what is wrong, with the evidence. Changes nothing.' },
    { cmd: '*fix', who: 'auditor', example: '*fix',
      does: 'Puts right what the last audit found, change by change.' },
    { cmd: '*brief', who: 'auditor', example: '*brief',
      does: 'A short paragraph telling a fresh storyteller where the story stands, said in the conversation and never written into the document.' },
  ] },
];

/* The house's own name for each one who does the work. */
export const WHO = {
  maker: 'the one you talk to, with your whole engine',
  auditor: 'the one you talk to, who hands it to the memory auditor',
  house: 'the house itself \u2014 nobody is asked',
};

export function allShortcuts() { return SHORTCUTS.flatMap((g) => g.items); }

/* THE CRAFT'S OWN WORDS FOR EACH COMMAND, read out of the craft: the rows of its
 * command table (11), and the auditor's \u201c=== COMMANDS ===\u201d lines. Every command
 * a row names gets that row's words. */
export function engineLines(sections, auditorCraft = '') {
  const out = new Map();
  const table = sections && sections.get && sections.get('11');
  for (const line of String((table && table.text) || '').split('\n')) {
    const bar = line.indexOf('|');
    if (bar === -1 || !line.trim().startsWith('`')) continue;
    const words = line.slice(bar + 1).trim();
    for (const m of line.slice(0, bar).matchAll(/`([*#][a-z_]+(?:\s+brief)?)/gi)) {
      if (!out.has(m[1])) out.set(m[1], words);
    }
  }
  let inCommands = false;
  for (const line of String(auditorCraft || '').split('\n')) {
    if (/^===\s*COMMANDS\s*===/.test(line)) { inCommands = true; continue; }
    if (inCommands && /^===/.test(line)) break;
    const m = inCommands && /^(\*[a-z_]+)\s+-\s+(.+)$/i.exec(line.trim());
    if (m && !out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}
