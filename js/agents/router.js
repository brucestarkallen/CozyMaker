/* CozyMaker — js/agents/router.js
 *
 * The written commands, read exactly, and the old keyword reading of plain
 * words — which is now only the fallback.
 *
 * Plain words are read by the listener (listener.js): the craft's own law
 * (7.6) is to parse a request for intent, never to match it to the nearest
 * command keyword, and a table of keywords could not do that — "give the
 * kingdom a second moon" named no keyword and reached no one, and "only the
 * safe cuts" could never answer a plan that was waiting on him. What is kept
 * here serves two purposes: a written command (*edit, #q, #prune …) is already
 * exact and goes straight to its worker without waiting on anybody; and when
 * the listener cannot be reached or answers with nothing readable, this
 * reading is used so a turn never fails because of it.
 *
 * The quiet rule still holds in both: a message that is just TALK sends
 * nobody.
 */

/* The written commands still work, for anyone who knows them. */
const COMMANDS = [
  [/(^|\s)\*(source_new|hybrid_new|new)\b/i, 'builder'],
  [/(^|\s)\*import\b/i, 'builder'],
  [/(^|\s)#q\b/i, 'chronicler'],
  [/(^|\s)\*p\b/i, 'chronicler'],
  [/(^|\s)\*summari[sz]e\s+brief\b/i, 'scribe'],
  [/(^|\s)\*continuity\b/i, 'scribe'],
  [/(^|\s)\*(edit|retcon|delete)\b/i, 'editor'],
  [/(^|\s)\*cleanup\b/i, 'showrunner'],
  /* the craft's controlled pruning: a manifest first, like *cleanup's */
  [/(^|\s)#prune\b/i, 'showrunner'],
  [/(^|\s)\*optimi[sz]e\b/i, 'compressor'],
  [/(^|\s)#skip\b/i, 'novelist'],
  [/(^|\s)\*ooc\b/i, 'diagnostician'],
  [/(^|\s)\*(show_full_file|show_spoilers|hide_spoilers|regress|next)\b/i, 'eye'],
  /* the Summaryception auditor's own commands (its brief, carried over) */
  [/(^|\s)\*(audit|fix|brief)\b/i, 'auditor'],
];

/* A written command anywhere in the message: exact already, so it keeps its
 * instant path and never waits on the listener. */
export function writtenCommand(message) {
  const text = String(message || '');
  return COMMANDS.some(([re]) => re.test(text));
}

/* The craft's command words by the worker they belong to, for the listener. */
export const COMMAND_WORDS = {
  builder: '*new, *source_new, *hybrid_new, *import',
  chronicler: '*p, #q',
  scribe: '*continuity, *summarize brief',
  editor: '*edit, *retcon, *delete',
  showrunner: '*cleanup, #prune',
  compressor: '*optimize',
  novelist: '#skip',
  diagnostician: '*ooc',
  eye: '*regress, *show_full_file, *show_spoilers, *hide_spoilers',
  auditor: '*audit, *fix, *brief, and *cleanup or *optimize aimed at a transplant',
  worldbook: '*cleanup, *optimize, *edit aimed at a worldbook',
};

/* A greeting or a thank-you, and nothing else: the only thing that skips the
 * listener. "ok", "sure", "yeah" are NOT here — said after an offer or a
 * question from the crew, they are the answer to it. */
const GREETING = /^\s*(?:hi|hey|hello|yo|morning|evening|good (?:morning|evening|night)|thanks|thank you|thx|ta|cheers|haha+|lol|lmao)\b[\s.!?]*$/i;
export function justGreeting(message) { return GREETING.test(String(message || '')); }

/* Plain words. Each worker has the shapes of sentence that mean its job.
 *
 * TWO LISTS, AND THE REASON FOR THEM: "does that make her too similar to
 * Aldric?" used to send the editor, and "do you think the world is too big"
 * used to send the compressor, because both hold the words a job is usually
 * asked in. They are questions. A question is somebody thinking out loud, and
 * answering it is the front of the house's work, not a worker's.
 *
 *   always    — shapes that ARE questions by nature ("why did the storyteller
 *               …", "are there any contradictions") and mean the job whichever
 *               way they are put.
 *   statement — shapes that only mean the job when the writer is telling
 *               rather than asking. Suppressed inside a question.
 *
 * A politeness opener ("can you", "could you", "please") is stripped first, so
 * "can you change Claire's age to fifteen" is still an instruction. */
const PLAIN = [
  ['worldbook', { always: [], statement: [/\b(worldbook|lorebook|world info)\b/i] }],
  ['auditor', { always: [], statement: [/\b(transplant|summaryception)\b/i] }],
  ['instructions', { always: [], statement: [/\b(system prompt|instruction set|ai instructions|instructions (document|doc|file)|(my|the|this) preset)\b/i] }],
  /* ONLY AN EXPLICIT ASK BUILDS. "Here's my world…", "worldbuilding a city…",
   * a long message with no plot essential yet — all brainstorming, and each
   * used to start a plot essential he never asked for. */
  ['builder', { always: [], statement: [
    /\b(start|begin|create|build|make|write|draft)\b.{0,24}\b(the |a |my |our |this )?(new |fresh )?(plot essential|pe)\b/i,
    /\b(import|bring (in|over)|rebuild)\b.{0,30}\b(old|previous|existing|my) (story|doc|document|pe|plot essential)\b/i,
    /\bturn (?:this|it|that|all (?:of )?(?:this|that)|everything|(?:our|the|my) (?:talk|brainstorm|ideas|notes))\s+into\s+(?:a |the |my |our )?(?:new )?(?:plot essential|pe)\b/i,
  ] }],
  ['chronicler', { always: [], statement: [
    /\b(fold|integrate|merge|roll)\b.{0,30}\b(in(to)?|to)\b.{0,20}\b(the )?(pe|plot essential)\b/i,
    /\bupdate the (pe|plot essential)\b/i,
    /\bhere('| i)s what (happened|the storyteller wrote|came back)\b/i,
    /\bthis is the (latest|last) (chapter|scene|output|reply)\b/i,
    /\b(record|log|capture) (this|these|what happened)\b/i,
  ] }],
  ['scribe', { always: [], statement: [
    /\b(continuity|continuation) file\b/i,
    /\b(audit|clean up|fix|check) the (ception|summary|summaryception|bullets|notes)\b/i,
    /\bsummari[sz]e (these|this|the) (bullets|notes|summary|prose|log)\b/i,
    /\bturn (these|this) .{0,20}into a (file|brief|continuation)\b/i,
    /\bsummaryception\b/i,
  ] }],
  ['editor', { always: [], statement: [
    /\b(change|set|make|update|fix|correct|switch|shift|put|move(?!\s+on\b))\b[^.?!]{0,40}\b(to|into|as)\b/i,
    /\b(add|give|remove|delete|drop)\b[^.?!]{0,40}\b(to|from|for)\b[^.?!]{0,30}\b(profile|dossier|entry|core|id|skills|rels|character|npc)\b/i,
    /\b(add|give)\b[^.?!]{0,30}\bto\s+[A-Z][a-z]+/,
    /\b(his|her|their|its)\s+(age|name|rank|title|height|build|hair|eyes?)\s+(is|should be)\b/i,
    /* an explicit correction: "Claire is 17 now, not 16", "her age should be 17, not 16" */
    /\b(?:is|are)\s+[^.?!,]{1,30}\s+now\b[^.?!]{0,30}\bnot\b/i,
    /\bshould be\b[^.?!]{1,40}\bnot\b/i,
    /\brename\b/i,
    /\bretcon\b/i,
    /\bdelete\s+[A-Z][a-z]+/,
  ] }],
  ['showrunner', { always: [], statement: [
    /\b(clean ?up|tidy|untangle|declutter|reshape)\b/i,
    /\b(convoluted|tangled|knotted|messy|all over the place|hard to follow|lost the thread)\b/i,
    /\btoo many (subplots|threads|arcs|characters)\b/i,
  ] }],
  ['compressor', { always: [], statement: [
    /\b(optimi[sz]e|compress|shorten|tighten|trim)\b/i,
    /\btoo (long|big|many tokens|heavy)\b/i,
    /\b(cut|reduce) the (size|tokens|length)\b/i,
    /\bfewer tokens\b/i,
  ] }],
  ['novelist', { always: [/\b#?skip\b/i,
    /* whether the story can get somewhere is a question by nature */
    /\bcan (?:the story|it|we|this)\b[^.?!]{0,30}\b(?:reach|get to|get there|arrive at|build to|lead to|end up)\b/i,
    /\bhow (?:do|can|would|could) (?:we|the story|it)\b[^.?!]{0,20}\b(?:get|reach|build) to\b/i,
  ], statement: [
    /\bi want\b[^.?!]{0,60}\bto happen\b/i,
    /\b(get|jump|move|fast ?forward)\b[^.?!]{0,30}\bto (the point|where|when)\b/i,
    /\bbridge\b[^.?!]{0,20}\b(to|between)\b/i,
    /\bwhat('| i)s the best scene\b/i,
  ] }],
  ['diagnostician', { always: [
    /\bwhy did the storyteller\b/i,
    /\bwhere did (that|this) come from\b/i,
  ], statement: [
    /\b(the )?storyteller\b[^.?!]{0,40}\b(got it wrong|broke|contradicted|made (that|this) up|is confused)\b/i,
    /\bout of character\b/i,
  ] }],
  ['eye', { always: [
    /\bis (it|everything|this) (consistent|right|clean|correct)\b/i,
    /\b(any|are there) (mistakes|errors|contradictions|problems)\b/i,
    /\bdoes (this|it) (make sense|hold up|hold together)\b/i,
  ], statement: [
    /\b(check|audit|review|go over|read back|look over)\b[^.?!]{0,30}\b(everything|the whole|all of it|the pe|the plot essential|the files?|for (mistakes|errors|problems|contradictions))\b/i,
  ] }],
];

/* "BUILD IT." With no plot essential yet, "it" can only be the world being
 * talked through: "ok build it", "let's build it", "go ahead and build the
 * world", "write it up", "can you build it?". These are the plainest asks
 * there are, and the rule above — which builds only when the plot essential
 * is named, so talking a world through never starts one unasked — missed
 * every one: said while the listener's answer could not be read, "ok build
 * it" was taken for talk and nothing was built. Only a whole short sentence
 * that IS the ask; a sentence that merely holds "build" ("the guild would
 * build it into the tides") is talk. */
const BUILD_IT = new RegExp(
  '^\\s*(?:(?:ok(?:ay)?|alright|all right|right|yes|yeah|yep|cool|great|perfect|good|now|so|then|please|lovely|nice)[\\s,.!]+)*' +
  '(?:(?:go ahead and|let\'?s|lets|please|now|just)\\s+)*' +
  '(?:build|create|make|write|draft|put)\\s+' +
  '(?:it|this|that|the world|this world|our world|the whole thing|it all|all of (?:it|this|that)|everything)' +
  '(?:\\s+(?:up|together|down|out))?' +
  '(?:\\s+(?:now|then|please|for me|already|from (?:all )?(?:this|that|what we (?:said|discussed|talked about|have|worked out)|everything|the (?:talk|conversation|brainstorm))))*' +
  '\\s*[.!?]*\\s*$', 'i');

/* Somebody asking, not telling. */
const ASKING = /^\s*(do|does|did|is|are|was|were|am|should|shall|would|could|can|may|might|will|have|has|what|why|how|who|whom|whose|when|where|which)\b/i;
/* …unless the question mark is only manners. */
/* Politeness is "can YOU", "could WE": a request wearing a question mark. "Can
 * the story reach it?" and "would that move Claire to the city?" are real
 * questions, and stripping their first word made them instructions: the second
 * sent the editor to change a document on a what-if. */
const MANNERS = /^\s*(please\s+)?(can|could|would|will)\s+(you|we)\s+(please\s+)?/i;

/* Sentences that are conversation and nothing else — no worker, just talk. */
const JUST_TALKING = [
  /^\s*(hi|hey|hello|yo|morning|evening|thanks|thank you|ta|nice|lovely|great|cool|ok|okay|sure|yeah|yep|no|nope|hmm+|haha|lol)\b[\s.!?]*$/i,
  /^\s*what (do|would) you think\b/i,
  /^\s*how (are|is) (you|it going)\b/i,
];

/* Split a message where two different asks are genuinely joined. Conservative:
 * only splits on a joiner, and only keeps the split when the halves actually
 * want different workers. */
function clauses(message) {
  const raw = String(message || '');
  const parts = raw.split(/\n{2,}|(?:^|\s)(?:and also|and then|also,|, and then|, and also)(?:\s|$)|(?:\s)and\s(?=(?:audit|check|clean|optimi|summari|fold|integrate|have a look|look at|run|do)\b)/i);
  return parts.map((p) => String(p || '').trim()).filter(Boolean);
}

function readOne(text, asStatement = false) {
  for (const [re, worker] of COMMANDS) if (re.test(text)) return { worker, why: 'written command', strong: true };

  /* Strip the manners first: "can you change her age to fifteen" is an
   * instruction wearing a question mark. What is left is judged on its own. */
  const polite = MANNERS.test(text);
  const bare = polite ? text.replace(MANNERS, '') : text;
  const asking = !asStatement && !polite && ASKING.test(text);

  for (const [worker, shapes] of PLAIN) {
    for (const re of shapes.always) if (re.test(bare)) return { worker, why: 'plain words', strong: false };
  }
  if (asking) return null;
  for (const [worker, shapes] of PLAIN) {
    for (const re of shapes.statement) if (re.test(bare)) return { worker, why: 'plain words', strong: false };
  }
  return null;
}

/* The whole read. Returns [] when the writer is simply talking. */
export function route(message, { hasPlotEssential = true, hasDocs = true, asStatement = false } = {}) {
  const text = String(message || '').trim();
  if (!text) return [];
  for (const re of JUST_TALKING) if (re.test(text)) return [];

  /* A COMMAND AIMED AT A WORLDBOOK OR A TRANSPLANT IS ITS KEEPER'S. The plot
   * essential's *cleanup knows nothing of a worldbook's fields or a
   * transplant's markers, and would tidy them the wrong way. */
  if (/(^|\s)\*(cleanup|optimi[sz]e|audit|fix|brief|edit|retcon|delete)\b/i.test(text)) {
    if (/\b(transplant|summaryception)\b/i.test(text)) return [{ worker: 'auditor', why: 'a command aimed at the transplant', about: text, strong: true }];
    if (/\b(worldbook|lorebook|world info)\b/i.test(text)) return [{ worker: 'worldbook', why: 'a command aimed at the worldbook', about: text, strong: true }];
  }

  const found = [];
  const seen = new Set();
  for (const part of clauses(text)) {
    const hit = readOne(part, asStatement);
    if (!hit) continue;
    if (seen.has(hit.worker)) continue;
    seen.add(hit.worker);
    found.push({ ...hit, about: part });
  }

  if (!found.length) {
    /* Nothing named a job. "Build it", said while there is no plot essential
     * yet, is still the ask to build one (BUILD_IT above). Anything else is
     * talk: describing a world, however much of it, is brainstorming, and
     * only an explicit ask builds. */
    const bare = text.replace(MANNERS, '');
    if (!hasPlotEssential && BUILD_IT.test(bare)) return [{ worker: 'builder', why: 'a build asked for in plain words', about: text, strong: false }];
    return [];
  }

  /* A build swallows everything else in the same breath: you cannot edit a
   * dossier in a document that does not exist yet. */
  if (found.some((f) => f.worker === 'builder') && !hasDocs) {
    return found.filter((f) => f.worker === 'builder');
  }
  return found;
}

/* A BARE YES RUNS WHAT WAS JUST OFFERED. The front offers ("want me to fold
 * that into the plot essential?") and he answers "yes": a word that names no
 * job, so it reached no one. The offer itself names the job, so the sentences
 * where the front offered something are read as the instruction he agreed to.
 * Only a bare yes: "yes, and make her older" is routed as its own words. */
const CONFIRM = /^\s*(?:(?:yes|yeah|yep|yup|sure|ok|okay|alright|all right|please|go ahead|do it|do that|go for it|please do|sounds good|let'?s do (?:it|that)|sure thing|of course|absolutely|definitely)[\s,.!]*){1,3}$/i;
export function confirmsOffer(message) { return CONFIRM.test(String(message || '')); }

const OFFER = /\b(?:(?:do you |would you )?(?:want|like) me to|you'?d like me to|shall i|should i|i can|i could)\s+(.+)/i;
export function offersIn(text) {
  const out = [];
  for (const sentence of String(text || '').split(/(?<=[.?!])\s+|\n+/)) {
    const m = OFFER.exec(sentence);
    if (!m) continue;
    const job = m[1].replace(/\s*(?:for you|now|right now|next|if you like|if you want)?\s*[?.!]*\s*$/i, '').trim();
    if (job) out.push(job);
  }
  return out;
}
