/* CozyMaker — js/agents/listener.js
 *
 * WHO, IF ANYONE, SHOULD ACT ON WHAT HE JUST SAID.
 *
 * The craft's own law (section 7.6): a request is parsed for INTENT, never
 * matched to the nearest command keyword; one message can hold several
 * operations and each gets its own job; a world built across several messages
 * stays a build. A keyword table cannot follow that law. "Give the kingdom a
 * second moon" or "just the safe cuts" names no keyword, so it reached no one —
 * while the persona was told only what changed, and nothing had.
 *
 * So a model reads it, the way the craft says to: the craft's own words on
 * reading a request (7.6) and its command list (11), the conversation, the
 * shape of the documents, and anything the crew is still waiting on him for.
 * It answers with jobs, or with none. It never talks to him and never touches
 * a document; nothing it says reaches the persona.
 *
 * Written commands keep their instant path (router.js), because they are
 * already exact. If the listener cannot be reached, or answers with nothing
 * readable, the old reading is used (router.js route and the bare yes to an
 * offer), so a turn never fails because of it.
 */

import { WORKERS } from './roster.js';
import { callModel } from './call.js';
import { COMMAND_WORDS } from './router.js';
import { parseDoc } from '../doc/index.js';
import { stripThinking, stripTrailingCommasOutsideStrings, escapeRawControlsInStrings } from '../doc/edits.js';

export const LISTENER = 'listener';
export const LISTENER_MARK = 'You are the one who listens.';
export const LISTEN_TALK = 5000;
export const MAX_JOBS = 5;

/* The craft's own words on reading a request, and its commands. */
export function listenerReading(sections) {
  const parts = [];
  for (const id of ['7.6']) {
    const s = sections && sections.get && sections.get(id);
    if (s && s.text) parts.push(s.text);
  }
  return parts.join('\n\n---\n\n');
}

const KIND = {
  pe: 'the plot essential', continuity: 'a continuation file', worldbook: 'a SillyTavern worldbook',
  transplant: 'a Summaryception transplant', instructions: 'an instruction set', notes: 'notes',
};

/* What exists, by name: enough to know what there is to work on, never the
 * text itself — the listener judges requests, not documents. */
export function shapeOf(docs) {
  if (!docs || !docs.length) return 'None yet — nothing has been written in this world.';
  return docs.map((d) => {
    const parsed = parseDoc(d.text || '', d.kind || 'pe');
    const titles = parsed.sections.map((s) => s.title).slice(0, 40);
    const more = parsed.sections.length > titles.length ? `, and ${parsed.sections.length - titles.length} more` : '';
    const empty = (d.text || '').trim() ? '' : ' (empty)';
    return `- ${d.name} — ${KIND[d.kind] || 'a document'}${empty}${titles.length ? `: ${titles.join(', ')}${more}` : ''}`;
  }).join('\n');
}

/* The crew as the listener sees it: the id to answer with, what each does,
 * and the craft's commands that are theirs. */
export function crewLines() {
  return WORKERS.filter(([id]) => id !== LISTENER).map(([id, what]) => {
    const does = String(what).replace(/^[^\u2014]*\u2014\s*/, '');
    const words = COMMAND_WORDS[id] ? ` (the craft's ${COMMAND_WORDS[id]})` : '';
    return `- ${id}: ${does}${words}`;
  }).join('\n');
}

export function listenerPrompt({ frame, reading, docs, talk, open = [], message, p = {} }) {
  const him = p.you || 'the author';
  const front = p.maker ? `${p.maker}, who answers him` : 'one voice that answers him';
  const system = [
    frame,
    `${LISTENER_MARK} ${him} talks with ${front}; behind that voice a crew does the actual work on his documents. ` +
      `You read what ${him} just said \u2014 in the light of the conversation, the documents, and anything the crew is still waiting on him for \u2014 ` +
      'and decide who on the crew, if anyone, should act on it now. You never answer him, and you never do the work yourself.',
    reading ? `How the craft reads a request:\n\n${reading}` : '',
    `The crew, and what each of them does:\n${crewLines()}`,
    [
      'Answer with one JSON object and nothing else:',
      '{"jobs": [{"worker": "editor", "task": "\u2026", "resumes": false}], "clear": [], "delete": []}',
      '',
      'HE DECIDES WHEN WRITING STARTS. This outranks the craft\'s own reading above. Brainstorming, ideas, what-ifs, a world or characters he is still talking through, a question, an opinion he wants: that is conversation, and it is answered by the one he talks to \u2014 send nobody. Nothing is written into a document until he asks for it to be written: make it, build it, start the plot essential, write it up, put that in, add it, change it, fold it in, update it. A suggestion to put something into a document that already exists IS an ask, however softly he puts it \u2014 \u201cmaybe we should add that\u2026\u201d, \u201cwe should add\u2026\u201d, \u201clet\u2019s add\u2026\u201d, \u201cthat should be in the file\u201d \u2014 and a question he asks with it (how, who, why) is part of the job, for the worker to reason out and write in. Talking through a world that has no plot essential yet stays conversation. When you cannot tell, it is conversation.',
      '',
      '- "jobs" is empty when he is only talking, brainstorming, sharing a thought, asking an opinion or a question, or turning something down.',
      '- One job for each distinct thing he wants done \u2014 never two operations merged into one \u2014 in the order they should happen.',
      '- "worker" is one of the names above, exactly as written there.',
      '- "task" says exactly what that worker is to do: the names, the numbers, the change itself, and his own words where they matter. When he agrees to something offered in the conversation, the task is that thing, spelled out in full.',
      '- When the crew is waiting on him and what he said answers them, send it back to that same worker with "resumes": true, and say in the task what he decided \u2014 all of it, which part of it, or what he wants instead.',
      '- A check, an audit or a fix of the documents goes to the one who does it only when he asks for the documents to be checked, audited or fixed. A question about the story is answered in conversation.',
      '- "clear" lists the documents he wants emptied, and "delete" the ones he wants gone \u2014 by their names above, and only when he says so (clear it, empty it, wipe it, delete it, get rid of it). The house does those itself; never send a worker for them.',
    ].join('\n'),
  ].filter(Boolean).join('\n\n---\n\n');

  const waiting = open.length
    ? `Still waiting on ${him}:\n\n` + open.map((o) => `The ${o.worker} put this to him and is waiting for his answer:\n${o.ask}`).join('\n\n')
    : '';
  const user = [
    `The documents in this world:\n${shapeOf(docs)}`,
    talk ? `The conversation so far, newest last:\n\n${talk}` : 'Nothing has been said before this.',
    waiting,
    `What ${him} just said:\n${message}`,
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/* Read the listener's answer. Anything that is not a list of jobs for people
 * who exist is not an answer: the caller falls back to the old reading. */
export function readJobs(text) {
  const valid = WORKERS.map((w) => w[0]).filter((id) => id !== LISTENER);
  const t = stripThinking(String(text || '')).replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, why: 'no answer in the expected shape' };
  const raw = t.slice(start, end + 1);
  let obj = null;
  for (const candidate of [raw, stripTrailingCommasOutsideStrings(escapeRawControlsInStrings(raw))]) {
    try { obj = JSON.parse(candidate); break; } catch (_) { /* try the repaired one */ }
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.jobs)) return { ok: false, why: 'no list of jobs' };
  const jobs = [];
  for (const j of obj.jobs) {
    if (!j || typeof j !== 'object') continue;
    const said = String(j.worker || '').trim().toLowerCase().replace(/^the\s+/, '');
    const worker = valid.includes(said) ? said : valid.find((id) => said.split(/[^a-z]+/).includes(id));
    if (!worker) continue;
    const task = String(j.task || '').trim();
    const same = jobs.find((x) => x.worker === worker);
    if (same) {
      if (task) same.task = same.task ? `${same.task}\n\nAnd: ${task}` : task;
      same.resumes = same.resumes || j.resumes === true;
      continue;
    }
    jobs.push({ worker, task, resumes: j.resumes === true });
  }
  if (obj.jobs.length && !jobs.length) return { ok: false, why: 'it named nobody on the crew' };
  const names = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).map((x) => String(x || '').trim()).filter(Boolean);
  return { ok: true, jobs: jobs.slice(0, MAX_JOBS), clear: names(obj.clear), delete: names(obj.delete) };
}

export async function listen({ conn, frame, sections, docs, talk, open, message, p, signal, stale }) {
  const { system, user } = listenerPrompt({ frame, reading: listenerReading(sections), docs, talk, open, message, p });
  const out = await callModel(conn, { system, messages: [{ role: 'user', content: user }], maxTokens: 600, signal, stale });
  if (!out.ok) return { ok: false, error: out.error };
  let read = readJobs(out.text);
  if (!read.ok && out.thinking) {
    const again = readJobs(out.thinking);
    if (again.ok) read = again;
  }
  return read;
}
