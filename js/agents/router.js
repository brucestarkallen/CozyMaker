/* CozyMaker — js/agents/router.js
 *
 * What did the writer just ask for? He should never have to know, or type, a
 * command. He says "Ivar should have dual affinity too, and have a look at
 * that ception while you're there" and two different workers get sent, each
 * to its own job, exactly as the craft says to do it.
 *
 * This is deliberately arithmetic and not a model. It runs instantly, it costs
 * nothing, it is the same every time, and it is readable — when it sends the
 * wrong worker, the line that did it can be found and fixed. A model asked to
 * pick would be slower, dearer, and different on Tuesday.
 *
 * The most important rule here is the quiet one: a message that is just TALK
 * sends nobody. Asking a question, thinking out loud, saying "that's lovely" —
 * none of that should set machinery running. This is meant to be a comfortable
 * place to make something, and a comfortable place lets you talk.
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
  [/(^|\s)\*optimi[sz]e\b/i, 'compressor'],
  [/(^|\s)#skip\b/i, 'novelist'],
  [/(^|\s)\*ooc\b/i, 'diagnostician'],
  [/(^|\s)\*(show_full_file|show_spoilers|hide_spoilers|regress|next)\b/i, 'eye'],
];

/* Plain words. Each worker has the shapes of sentence that mean its job.
 * Ordered: the first that matches within a clause wins that clause. */
const PLAIN = [
  ['builder', [
    /\b(start|begin|create|build|make)\b.{0,24}\b(new|fresh)\b.{0,24}\b(story|world|plot essential|pe|setting|book)\b/i,
    /\bnew (story|world|plot essential|book|setting)\b/i,
    /\bhere('| i)s my (world|setting|premise|story idea|characters|cast|roster)\b/i,
    /\b(import|bring (in|over)|rebuild)\b.{0,30}\b(old|previous|existing|my) (story|doc|document|pe|plot essential)\b/i,
    /\bfrom scratch\b/i,
    /\bworld ?build/i,
  ]],
  ['chronicler', [
    /\b(fold|integrate|merge|roll)\b.{0,30}\b(in(to)?|to)\b.{0,20}\b(the )?(pe|plot essential)\b/i,
    /\bupdate the (pe|plot essential)\b/i,
    /\bhere('| i)s what (happened|the storyteller wrote|came back)\b/i,
    /\bthis is the (latest|last) (chapter|scene|output|reply)\b/i,
    /\b(record|log|capture) (this|these|what happened)\b/i,
  ]],
  ['scribe', [
    /\b(continuity|continuation) file\b/i,
    /\b(audit|clean up|fix|check) the (ception|summary|summaryception|bullets|notes)\b/i,
    /\bsummari[sz]e (these|this|the) (bullets|notes|summary|prose|log)\b/i,
    /\bturn (these|this) .{0,20}into a (file|brief|continuation)\b/i,
    /\bsummaryception\b/i,
  ]],
  ['editor', [
    /\b(change|set|make|update|fix|correct)\b[^.?!]{0,40}\b(to|into|as)\b/i,
    /\b(add|give|remove|delete|drop)\b[^.?!]{0,40}\b(to|from|for)\b[^.?!]{0,30}\b(profile|dossier|entry|core|id|skills|rels|character|npc)\b/i,
    /\b(add|give)\b[^.?!]{0,30}\bto\s+[A-Z][a-z]+/,
    /\b(his|her|their|its)\s+(age|name|rank|title|height|build|hair|eyes?)\s+(is|should be)\b/i,
    /\brename\b/i,
    /\bretcon\b/i,
    /\bdelete\s+[A-Z][a-z]+/,
  ]],
  ['showrunner', [
    /\b(clean ?up|tidy|untangle|declutter|reshape)\b/i,
    /\b(convoluted|tangled|knotted|messy|all over the place|hard to follow|lost the thread)\b/i,
    /\btoo many (subplots|threads|arcs|characters)\b/i,
    /\bwhat is (this|the) story even about\b/i,
  ]],
  ['compressor', [
    /\b(optimi[sz]e|compress|shorten|tighten|trim)\b/i,
    /\btoo (long|big|many tokens|heavy)\b/i,
    /\b(cut|reduce) the (size|tokens|length)\b/i,
    /\bfewer tokens\b/i,
  ]],
  ['novelist', [
    /\b#?skip\b/i,
    /\bi want\b[^.?!]{0,60}\bto happen\b/i,
    /\b(get|jump|move|fast ?forward)\b[^.?!]{0,30}\bto (the point|where|when)\b/i,
    /\bbridge\b[^.?!]{0,20}\b(to|between)\b/i,
    /\bwhat('| i)s the best scene\b/i,
  ]],
  ['diagnostician', [
    /\bwhy did the storyteller\b/i,
    /\b(the )?storyteller\b[^.?!]{0,40}\b(got it wrong|broke|contradicted|made (that|this) up|is confused)\b/i,
    /\bout of character\b/i,
    /\bwhere did (that|this) come from\b/i,
  ]],
  ['eye', [
    /\b(check|audit|review|go over|read back|look over)\b[^.?!]{0,30}\b(everything|the whole|all of it|the pe|the plot essential|the files?|for (mistakes|errors|problems|contradictions))\b/i,
    /\bis (it|everything|this) (consistent|right|clean|correct)\b/i,
    /\b(any|are there) (mistakes|errors|contradictions|problems)\b/i,
    /\bdoes (this|it) (make sense|hold up|hold together)\b/i,
  ]],
];

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

function readOne(text) {
  for (const [re, worker] of COMMANDS) if (re.test(text)) return { worker, why: 'written command', strong: true };
  for (const [worker, shapes] of PLAIN) {
    for (const re of shapes) if (re.test(text)) return { worker, why: 'plain words', strong: false };
  }
  return null;
}

/* The whole read. Returns [] when the writer is simply talking. */
export function route(message, { hasPlotEssential = true, hasDocs = true } = {}) {
  const text = String(message || '').trim();
  if (!text) return [];
  for (const re of JUST_TALKING) if (re.test(text)) return [];

  const found = [];
  const seen = new Set();
  for (const part of clauses(text)) {
    const hit = readOne(part);
    if (!hit) continue;
    if (seen.has(hit.worker)) continue;
    seen.add(hit.worker);
    found.push({ ...hit, about: part });
  }

  if (!found.length) {
    /* Nothing named a job. If there is no plot essential yet and the writer
     * has written something substantial, he is describing a world — that is a
     * build, never an update. The craft is explicit about this one. */
    if (!hasPlotEssential && text.length > 160) {
      return [{ worker: 'builder', why: 'there is nothing built yet and this reads like a world', about: text, strong: false }];
    }
    return [];
  }

  /* A build swallows everything else in the same breath: you cannot edit a
   * dossier in a document that does not exist yet. */
  if (found.some((f) => f.worker === 'builder') && !hasDocs) {
    return found.filter((f) => f.worker === 'builder');
  }
  return found;
}
