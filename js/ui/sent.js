/* CozyMaker — js/ui/sent.js
 *
 * WHAT WAS SENT (v2.1, his ask, as Cozy Chat and Cozy Tavern have it). Every
 * request a reply cost — each step of the one he talks to, each helper, each
 * search — kept on the device, and shown two ways: in parts, each with how many
 * tokens it is, and raw, exactly as it went, with Copy. The count is the
 * service's own when it sent one; otherwise an estimate, and said so.
 */

import { $, el, openSheet, copyText } from './kit.js';
import { estimateTokens } from '../doc/index.js';

export async function saveSent(worldId, key, record) {
  try {
    const res = await fetch(`/api/sent/${encodeURIComponent(worldId)}/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
    });
    return res.ok;
  } catch (_) { return false; }
}

async function loadSent(worldId, key) {
  try {
    const res = await fetch(`/api/sent/${encodeURIComponent(worldId)}/${encodeURIComponent(key)}`);
    return res.ok ? await res.json() : null;
  } catch (_) { return null; }
}

/* the text of what a request carried: its system words, and its messages */
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && (x.text || x.content)) || '').join('') : c ? JSON.stringify(c) : '');
function systemOf(body) {
  if (typeof body.system === 'string') return body.system;
  if (Array.isArray(body.system)) return textOf(body.system);
  const first = (body.messages || [])[0];
  return first && first.role === 'system' ? textOf(first.content) : '';
}
function messagesOf(body) {
  const all = body.messages || [];
  return typeof body.system === 'undefined' && all[0] && all[0].role === 'system' ? all.slice(1) : all;
}
const settingsOf = (body) => { const o = {}; for (const k of Object.keys(body || {})) if (!['messages', 'system'].includes(k)) o[k] = body[k]; return o; };
const ROLE = { user: 'sent as user', assistant: 'sent as the assistant (its own earlier words)', system: 'sent as system' };
const tokensIn = (r) => estimateTokens(systemOf(r.body || {}) + messagesOf(r.body || {}).map((m) => textOf(m.content)).join(''));

/* one line for a whole reply: how many requests, how many tokens in and out */
export function sentSummary(requests) {
  let counted = 0, est = 0, out = 0, cached = 0, all = true, ms = 0;
  for (const r of requests) {
    const u = r.usage;
    if (u && Number.isFinite(u.in)) { counted += u.in; cached += u.cached || 0; } else { all = false; est += tokensIn(r); }
    if (u && Number.isFinite(u.out)) out += u.out;
    ms += r.ms || 0;
  }
  const bits = [`${requests.length} request${requests.length === 1 ? '' : 's'}`];
  if (all && requests.length) bits.push(`${counted.toLocaleString()} tokens in${out ? `, ${out.toLocaleString()} out` : ''}${cached ? ` (${cached.toLocaleString()} read from cache)` : ''} \u2014 counted by the service`);
  else if (counted) bits.push(`${counted.toLocaleString()} tokens in counted by the service, about ${est.toLocaleString()} more estimated`);
  else bits.push(`about ${est.toLocaleString()} tokens in \u2014 an estimate; the service sent no count`);
  if (ms) bits.push(`${(ms / 1000).toFixed(1)}s all told`);
  return bits.join(' \u00b7 ');
}

function partBlock(name, text, where) {
  const wrap = el('div', 'sent-part');
  const row = el('div', 'sent-row');
  const open = el('button', 'sent-name', name);
  open.type = 'button';
  open.setAttribute('aria-expanded', 'false');
  const copy = el('button', 'btn quiet small', 'Copy');
  copy.addEventListener('click', () => copyText(text));
  row.append(open, el('span', 'sent-tok', `~${estimateTokens(text).toLocaleString()} tokens`), copy);
  wrap.append(row);
  if (where) wrap.append(el('div', 'sent-where', where));
  open.addEventListener('click', () => {
    const now = open.getAttribute('aria-expanded') !== 'true';
    open.setAttribute('aria-expanded', now ? 'true' : 'false');
    let pre = wrap.querySelector('.sent-text');
    if (now && !pre) { pre = el('pre', 'sent-text', text); wrap.append(pre); }
    if (pre) pre.hidden = !now;
  });
  return wrap;
}

function requestHead(r, i, n) {
  let where = r.url || '';
  try { const u = new URL(r.url); where = u.host + u.pathname; } catch (_) { /* as it was */ }
  const head = el('div', 'sent-req-head');
  const u = r.usage;
  const count = u && Number.isFinite(u.in) ? `${u.in.toLocaleString()} in${Number.isFinite(u.out) ? ` \u00b7 ${u.out.toLocaleString()} out` : ''} (counted)` : `~${tokensIn(r).toLocaleString()} in (estimated)`;
  head.append(el('b', '', `${n > 1 ? `${i + 1}. ` : ''}${r.who || 'a request'}`));
  head.append(el('small', '', `${r.model || 'the model'} at ${where} \u00b7 ${count}${r.ms ? ` \u00b7 ${(r.ms / 1000).toFixed(1)}s` : ''}${r.error ? ` \u00b7 refused: ${r.error}` : ''}`));
  return head;
}

function drawParts(box, requests) {
  requests.forEach((r, i) => {
    const wrap = el('div', 'sent-req');
    wrap.append(requestHead(r, i, requests.length));
    const body = r.body || {};
    const system = systemOf(body);
    if (r.parts && r.parts.length) {
      for (const pt of r.parts) wrap.append(partBlock(pt.name, system.slice(pt.start, pt.end), 'in the system prompt'));
    } else if (system) wrap.append(partBlock('Its instructions', system, 'the system prompt'));
    messagesOf(body).forEach((m, k) => {
      const text = textOf(m.content);
      const first = text.trim().split('\n')[0].slice(0, 70);
      wrap.append(partBlock(`Message ${k + 1}${first ? ` \u2014 \u201c${first}${text.trim().length > first.length ? '\u2026' : ''}\u201d` : ''}`, text, ROLE[m.role] || `sent as ${m.role}`));
    });
    box.append(wrap);
  });
}

function drawRaw(box, requests) {
  requests.forEach((r, i) => {
    const wrap = el('div', 'sent-req');
    const head = requestHead(r, i, requests.length);
    const all = el('button', 'btn quiet small', 'Copy all');
    all.addEventListener('click', () => copyText(JSON.stringify(r.body, null, 2)));
    head.append(all);
    wrap.append(head);
    const block = (label, text) => {
      const b = el('div', 'sent-part');
      const row = el('div', 'sent-row');
      const copy = el('button', 'btn quiet small', 'Copy');
      copy.addEventListener('click', () => copyText(text));
      row.append(el('span', 'sent-role', label), copy);
      b.append(row, el('pre', 'sent-text', text));
      return b;
    };
    const settings = settingsOf(r.body);
    if (Object.keys(settings).length) wrap.append(block('settings', JSON.stringify(settings, null, 2)));
    const body = r.body || {};
    if (typeof body.system !== 'undefined') wrap.append(block('system', textOf(body.system)));
    for (const m of body.messages || []) wrap.append(block(m.role || '?', textOf(m.content)));
    box.append(wrap);
  });
}

export async function openSent(worldId, keys, when = '') {
  const body = $('sentBody');
  body.textContent = '';
  openSheet('sentSheet');
  body.append(el('p', 'hint', 'Fetching what was sent\u2026'));
  const records = [];
  for (const k of keys || []) { const r = await loadSent(worldId, k); if (r) records.push(r); }
  const requests = records.flatMap((r) => r.requests || []);
  body.textContent = '';
  if (!requests.length) {
    body.append(el('p', 'hint', 'What was sent for this reply is not kept any more \u2014 the newest 40 replies of each world are.'));
    return;
  }
  body.append(el('p', 'sent-sum', sentSummary(requests) + (when ? ` \u00b7 ${when}` : '')));
  const tabs = el('div', 'sent-tabs');
  const parts = el('div', 'sent-view');
  const raw = el('div', 'sent-view');
  raw.hidden = true;
  const tab = (label, show) => {
    const b = el('button', 'btn quiet small sent-tab', label);
    b.addEventListener('click', () => {
      for (const x of tabs.children) x.classList.toggle('on', x === b);
      parts.hidden = show !== parts;
      raw.hidden = show !== raw;
      if (show === raw && !raw.childNodes.length) drawRaw(raw, requests);
    });
    tabs.append(b);
    return b;
  };
  tab('In parts', parts).classList.add('on');
  tab('Raw', raw);
  body.append(tabs, parts, raw);
  drawParts(parts, requests);
}
