/* CozyMaker — js/agents/search.js
 *
 * SEARCHING THE INTERNET (v1.7.0). His own switch, in The house: off, nothing is
 * ever looked up and every request is exactly what it was; on, anything real the
 * crew or the one he talks to is not sure of — a canon detail of an existing
 * story, a real person, place or date — is looked up before it is written or
 * said, instead of guessed.
 *
 * The looking-up is done by a connection that can search: his Hermes Agent on the
 * phone, the same backend Cozy Chat uses, whose own web tools do the searching.
 * The models that write here cannot search; they ask (the listener in its answer,
 * a worker with <search>what</search>), the house asks the searcher, and what it
 * found is put in front of them in plain words.
 *
 * Nothing here ever reaches the persona as machinery: it is told what was looked
 * up and what came back, the way a friend would say it. */

import { callModel } from './call.js';
import { WORKER_ROOM, hermesLike } from '../providers.js';
import { stripThinking } from '../doc/edits.js';

export const SEARCHER = 'searcher';
/* how many things one ask may look up, and how much of what comes back is kept */
export const MAX_SEARCHES = 3;
export const FOUND_CHARS = 3000;
export const SEARCH_MARK = 'You search the internet';

export function searchOn(house) {
  return Boolean(house && house.settings && house.settings.searchInternet === 'on');
}

/* The connection that searches: the one he chose, else his Hermes Agent when he
 * has one. Null when there is none — then searching is as good as off. */
export function searcherFor(house) {
  const connections = (house && house.connections) || [];
  const chosen = ((house && house.agentConnections) || {})[SEARCHER];
  const own = chosen ? connections.find((c) => c.id === chosen) : null;
  return own || connections.find((c) => hermesLike(c)) || null;
}

/* What is asked for, between <search> and </search>: each one search, a few
 * words to a line, the same one never twice, at most MAX_SEARCHES. */
const ASKED = /<search>([\s\S]*?)<\/search>/gi;
export function readSearch(text) {
  const out = [];
  for (const m of String(text || '').matchAll(ASKED)) {
    const q = m[1].replace(/\s+/g, ' ').trim().slice(0, 200);
    if (q && !out.some((x) => x.toLowerCase() === q.toLowerCase())) out.push(q);
  }
  return out.slice(0, MAX_SEARCHES);
}
export function stripSearch(text) {
  return String(text || '').replace(/<search>[\s\S]*?<\/search>/gi, '').replace(/<\/?search>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}

export const SEARCH_SYSTEM = `${SEARCH_MARK} for the people writing a story with an author. Look up exactly what you are asked, with your web tools, and answer from what you actually find: the facts that bear on it, plainly, each with where it came from (the site, or a link). Keep to what was asked. If you find nothing you can trust, say so in one sentence \u2014 never fill a gap from memory.`;

/* Look each thing up, one after another (the agent is one agent). Returns what
 * came back for each, or why it could not be looked up. */
export async function lookUp(conn, queries, { signal, stale, onStatus, onSent } = {}) {
  const results = [];
  for (const query of queries || []) {
    if ((signal && signal.aborted) || (stale && stale())) break;
    onStatus && onStatus(`searching the internet for ${query.length > 60 ? query.slice(0, 57) + '\u2026' : query}`);
    const out = await callModel(conn, {
      onSent,
      system: SEARCH_SYSTEM,
      messages: [{ role: 'user', content: `Look this up on the internet: ${query}` }],
      maxTokens: WORKER_ROOM, signal, stale,
    });
    const found = out.ok ? stripThinking(out.text || '').trim() : '';
    if (found) results.push({ query, ok: true, found: found.length > FOUND_CHARS ? found.slice(0, FOUND_CHARS) + '\u2026' : found });
    else results.push({ query, ok: false, why: out.ok ? 'nothing came back' : (out.error || 'the search did not go through') });
  }
  return results;
}

/* What was found, said plainly — for a worker, and for the one he talks to. */
export function findingsText(results) {
  if (!results || !results.length) return '';
  return 'Looked up on the internet just now:\n\n' + results.map((r) => (r.ok
    ? `${r.query}\n${r.found}`
    : `${r.query}\n(it could not be looked up: ${r.why} \u2014 so it is not known from the internet)`)).join('\n\n');
}

/* What a worker is told, only while searching is on. */
export const SEARCH_CONTRACT = 'If something real is uncertain \u2014 a canon detail of an existing story, a real person, place, date or fact \u2014 and getting it wrong would matter, have it looked up on the internet before you write it: put each thing to look up between <search> and </search> (a few words each, at most three), and write nothing else in that answer. What is found will be put in front of you, and you then do the job.';
