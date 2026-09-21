/* CozyMaker — js/doc/index.js
 *
 * THE RULE THIS FILE EXISTS FOR: a worker is always shown the WHOLE SHAPE of
 * a document, and the full text of only the parts it is working on.
 *
 * The usual way — pick the passages that look most like the writer's sentence
 * and send those — is how a maker writes a second dossier for a character who
 * already has one, and how it contradicts a rule it was never shown. A world
 * is not a blob of prose; it is a named, indexed thing. So every call carries
 * a one-line entry for every section that exists (a dossier costs about
 * fifteen words to name) and the body of the handful in play. Two hundred
 * entries still fit, and nothing is ever invisible.
 *
 * A worker that needs a body it was not given asks for it by name, and gets
 * it. It never has to guess, and it never has to invent.
 */

export const ALWAYS = ['SCENE', 'CURRENT SCENE', 'STATE', 'CALENDAR'];

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

/* ------------------------------------------------------- markdown documents */

const EVENT = /^\s*(e\d{3,}(?:\s*[-–]\s*\d{3,})?)\s*(\[[^\]]*\])?/;

export function parseDoc(text, kind = 'pe') {
  const src = String(text || '');
  if (kind === 'worldbook') return parseWorldbook(src);

  const lines = src.split('\n');
  const head = [];
  const lead = [];
  const sections = [];
  let current = null;
  let inFence = false;
  const counts = Object.create(null);

  const close = (endLine) => {
    if (!current) return;
    current.text = lines.slice(current.from, endLine).join('\n').replace(/\s+$/, '');
    sections.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('```')) inFence = !inFence;
    if (!inFence && /^#{2,3}\s+\S/.test(l)) {
      close(i);
      const level = l.startsWith('###') ? 3 : 2;
      const title = l.replace(/^#{2,3}\s+/, '').trim();
      const base = slug(title) || 'section';
      counts[base] = (counts[base] || 0) + 1;
      const id = counts[base] > 1 ? `${base}-${counts[base]}` : base;
      current = { id, level, title, from: i, text: '' };
      continue;
    }
    if (!current && !inFence && /^#\s+\S/.test(l)) { head.push(l.trim()); continue; }
    if (!current && l.trim() && head.length === 0 && /^#/.test(l)) { head.push(l.trim()); continue; }
    /* EVERYTHING BEFORE THE FIRST SECTION IS PART OF THE DOCUMENT. A marker
     * file, an instruction set, a note, the paragraph under a title: none of
     * it has a section heading, and all of it used to be dropped from what a
     * worker read, so a transplant reached the auditor as an empty document. */
    if (!current) lead.push(l);
  }
  close(lines.length);

  /* Events live inside whichever section holds them. */
  for (const s of sections) {
    const ev = [];
    for (const l of s.text.split('\n')) {
      const m = EVENT.exec(l);
      if (m) ev.push({ id: m[1].replace(/\s+/g, ''), tag: (m[2] || '').replace(/[[\]]/g, ''), line: l.trim() });
    }
    if (ev.length) s.events = ev;
  }

  return { kind, head, lead: lead.join('\n').replace(/^\s+|\s+$/g, ''), sections, raw: src };
}

function parseWorldbook(src) {
  let entries = [];
  try {
    const parsed = JSON.parse(src || '[]');
    if (Array.isArray(parsed)) entries = parsed;
  } catch (_) { /* a worldbook mid-edit may not parse; the lint reports it */ }
  const counts = Object.create(null);
  const sections = entries.map((e, n) => {
    const base = slug(e && e.name) || ('entry-' + (n + 1));
    counts[base] = (counts[base] || 0) + 1;
    const id = counts[base] > 1 ? `${base}-${counts[base]}` : base;
    return {
      id, level: 3,
      title: (e && e.name) || `entry ${n + 1}`,
      entry: e,
      text: JSON.stringify(e, null, 2),
    };
  });
  return { kind: 'worldbook', head: [], sections, raw: src, entries, parsed: entries.length > 0 || /^\s*\[\s*\]\s*$/.test(src || '') };
}

/* ------------------------------------------------------------- the index */

export function indexLines(doc, { counts = true } = {}) {
  const out = [];
  const say = (line) => (counts ? line : line.replace(/ \u2014 [\d,]+ characters?:? ?/, ' \u2014 ').replace(/ \u2014 $/, ''));
  for (let i = 0; i < doc.sections.length; i++) {
    const s = doc.sections[i];
    /* A heading whose content is other headings is a grouping, not a section
     * with eight characters in it. "WORLD — 8 characters" in every brief is
     * noise, and worse, it reads as though the world were empty. */
    const next = doc.sections[i + 1];
    const body = s.text.split('\n').slice(1).join('').trim();
    if (!body && next && next.level > s.level) {
      out.push(`${s.level === 3 ? '  ' : ''}${s.title} — what follows is under this`);
      continue;
    }
    out.push(say(indexLine(doc, s)));
  }
  return out;
}

function indexLine(doc, s) {
  const pad = s.level === 3 ? '  ' : '';
  if (doc.kind === 'worldbook') {
    const e = s.entry || {};
    const keys = Array.isArray(e.keys) ? e.keys.join(', ') : '';
    const gist = String(e.content || '').replace(/\s+/g, ' ').slice(0, 70);
    return `${pad}${s.title}${keys ? ` — keys: ${keys}` : ''}${gist ? ` — ${gist}…` : ''}`;
  }
  if (s.events && s.events.length) {
    const first = s.events[0].id;
    const last = s.events[s.events.length - 1].id;
    const tags = [...new Set(s.events.map((e) => e.tag).filter(Boolean))].slice(0, 6).join(', ');
    return `${pad}${s.title} — ${s.events.length} events, ${first} to ${last}${tags ? ` (${tags})` : ''}`;
  }
  const gist = s.text.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 74);
  return `${pad}${s.title} — ${s.text.length} characters${gist ? `: ${gist}…` : ''}`;
}

/* Which sections carry their full body this turn.
 *   — anything the writer's own sentence names
 *   — anything touched in the last few turns
 *   — the live moment and the world's hard rules, always
 *   — the most recent events in full; older ones stay as their index line
 *   — anything a worker asked for by name
 */
export function inPlay(doc, { message = '', recent = [], asked = [], recentEvents = 8, whole = false } = {}) {
  /* WHOLE, WHEN IT FITS (the Plot Essential Maker sends every document whole,
   * never truncated, because a worker quoting from memory misquotes). Every
   * section in full, nothing trimmed; the index-and-sections way is only for
   * a world too big to send whole. */
  if (whole) return doc.sections.map((s) => ({ id: s.id, title: s.title, trimmed: false, text: s.text }));
  const wanted = new Set();
  const msg = ' ' + String(message).toLowerCase() + ' ';

  for (const s of doc.sections) {
    const t = s.title.toLowerCase();
    const bare = t.replace(/\s*\(.*$/, '').trim();
    if (ALWAYS.some((a) => t.includes(a.toLowerCase()))) { wanted.add(s.id); continue; }
    if (/^world$/.test(bare) || /^rules$/.test(bare) || /^calendar$/.test(bare)) { wanted.add(s.id); continue; }
    if (bare.length >= 3 && msg.includes(bare)) { wanted.add(s.id); continue; }
    /* a dossier heading is "Name (rank | tier | age)" — match the name alone */
    const name = bare.split('—').pop().trim();
    if (name.length >= 3 && msg.includes(name.toLowerCase())) wanted.add(s.id);
  }
  for (const id of recent) if (doc.sections.some((s) => s.id === id)) wanted.add(id);
  for (const id of asked) if (doc.sections.some((s) => s.id === id)) wanted.add(id);

  /* An event-bearing section is never sent whole once it has grown; the last
   * handful of events go in full and the rest are already named in the index. */
  const bodies = [];
  for (const s of doc.sections) {
    if (!wanted.has(s.id)) continue;
    if (s.events && s.events.length > recentEvents && !asked.includes(s.id)) {
      const tail = s.events.slice(-recentEvents);
      const cut = s.text.indexOf(tail[0].line);
      bodies.push({
        id: s.id, title: s.title, trimmed: true,
        text: `## ${s.title}\n(the earlier events are listed in the shape above)\n` +
              (cut >= 0 ? s.text.slice(cut) : tail.map((e) => e.line).join('\n')),
      });
      continue;
    }
    bodies.push({ id: s.id, title: s.title, trimmed: false, text: s.text });
  }
  return bodies;
}

/* What a worker actually reads about a document: its header, the whole shape,
 * and the bodies in play. Written the way one person describes a book to
 * another, because the front of the house reads this too. */
/* how much of the text before the first section a partial reading shows */
export const LEAD_SHORT = 4000;

export function brief(doc, name, opts = {}) {
  /* WHOLE MEANS THE FILE ITSELF, WORD FOR WORD (the Plot Essential Maker sends
   * every document whole). Never a rebuilding of it from parsed pieces: what
   * the worker quotes must be exactly what is there. */
  if (opts.whole) {
    const raw = String(doc.raw || '');
    return raw.trim() ? `${name} — as it stands right now, whole, word for word:\n\n${raw}` : `${name} — it is empty so far.`;
  }
  const parts = [];
  parts.push(`${name} — as it stands right now`);
  if (doc.head.length) parts.push(doc.head.join('\n'));
  const lead = doc.lead || '';
  const cap = Number.isFinite(opts.leadCap) ? opts.leadCap : Infinity;
  const leadCut = lead.length > cap;
  if (lead) {
    parts.push(leadCut
      ? `${lead.slice(0, cap)}\n\u2026 (${(lead.length - cap).toLocaleString()} more characters of it are not shown here)`
      : lead);
  }
  if (doc.sections.length) {
    parts.push(`Everything that is in it:\n${indexLines(doc, { counts: !opts.forFront }).join('\n')}`);
  } else if (!lead) {
    parts.push('It is empty so far.');
  }
  const bodies = inPlay(doc, opts);
  if (bodies.length) {
    parts.push(`The parts in front of us right now, in full:\n\n${bodies.map((b) => b.text).join('\n\n')}`);
  }
  /* WHAT YOU HAVE NOT SEEN, YOU MAY NOT REWRITE. Every part of this document
   * is real and already written; only some of it is in front of the reader
   * right now. Without this sentence a worker shown eight of forty events can
   * hand back a "complete" document holding eight, and mean it honestly. */
  const partial = leadCut || bodies.length < doc.sections.length || bodies.some((b) => b.trimmed);
  /* The front of the house reads the book the way a friend would: what is in
   * it and what is in front of them. It is never taught the workers' tools —
   * a way to ask for pages it cannot use, a rule about rewriting it will never
   * do. Machinery in its reading is machinery in its voice (Cozy Tavern M335:
   * the teller's thinking read like an auditor's because it had been ordered
   * to). */
  if (partial && opts.forFront) {
    parts.push('The rest of it is written and real — it is listed above by name.');
  } else if (partial) {
    parts.push(
      'Everything else is real and already written — it is listed above by name. ' +
      'If you need to read one of them word for word before you change anything, ' +
      'say so like this and it will be put in front of you: <need>name, other name</need>\n' +
      `Because you have not been shown all of ${name}, do not rewrite the whole of it. ` +
      'Change the parts you can see, by name.'
    );
  }
  return parts.join('\n\n');
}

/* Resolve the names a worker asked for back onto section ids. */
export function resolveNeed(doc, names) {
  const out = [];
  for (const raw of names) {
    const want = String(raw).trim().toLowerCase();
    if (!want) continue;
    let hit = doc.sections.find((s) => s.id === want || s.title.toLowerCase() === want);
    if (!hit) hit = doc.sections.find((s) => s.title.toLowerCase().startsWith(want));
    if (!hit) hit = doc.sections.find((s) => s.title.toLowerCase().includes(want));
    if (hit) out.push(hit.id);
  }
  return [...new Set(out)];
}

export function readNeed(text) {
  const out = [];
  const re = /<need>([\s\S]*?)<\/need>/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    for (const part of m[1].split(',')) { const t = part.trim(); if (t) out.push(t); }
  }
  return out;
}

export function stripNeed(text) {
  return String(text || '').replace(/<need>[\s\S]*?<\/need>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}
