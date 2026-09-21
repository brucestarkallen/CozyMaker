/* CozyMaker — js/ui/kit.js
 * The small shared pieces every panel uses. It depends on nothing of ours, so
 * nothing can end up importing in a circle. */

export const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function openSheet(id) { $(id).classList.add('open'); }
export function closeSheet(id) { $(id).classList.remove('open'); }

export function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('on'), 2600);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'hearth');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
}

/* The room redraws itself when a panel changes something. Registered by the
 * room, called by the panels — so no panel has to know about the room. */
const redrawers = new Set();
export function onRedraw(fn) { redrawers.add(fn); return () => redrawers.delete(fn); }
export function redraw() { for (const fn of redrawers) { try { fn(); } catch (_) {} } }

export function field(label, input) {
  const l = el('label', 'field');
  l.append(el('span', '', label), input);
  return l;
}

export function input(value, placeholder, type = 'text') {
  const i = document.createElement('input');
  i.type = type;
  i.value = value == null ? '' : value;
  if (placeholder) i.placeholder = placeholder;
  i.autocomplete = 'off'; i.autocapitalize = 'off'; i.spellcheck = false;
  return i;
}

export function select(options, value) {
  const s = document.createElement('select');
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    if (v === value) o.selected = true;
    s.append(o);
  }
  return s;
}

export function group(title, hint) {
  const g = el('div', 'group');
  g.append(el('h3', '', title));
  if (hint) g.append(el('p', 'hint', hint));
  return g;
}

/* ONE DOOR, MANY HANDLES. "Tidy it up" on a document, "Start a plot essential"
 * in an empty world — each sends its job through the same conversation the
 * writer types into, and shows up there in his own words. There is no second
 * pipeline behind a button; a button is only a way to find the door. */
const askers = new Set();
export function onAsk(fn) { askers.add(fn); return () => askers.delete(fn); }
export function ask(text, worker) {
  for (const fn of askers) Promise.resolve().then(() => fn(text, worker)).catch((e) => toast(`That did not start: ${(e && e.message) || e}`));
}

export function when(ms) {
  if (!ms) return 'not yet';
  const d = Math.floor((Date.now() - ms) / 1000);
  const ago = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (d < 90) return 'just now';
  if (d < 3600) return ago(Math.round(d / 60), 'minute');
  if (d < 86400) return ago(Math.round(d / 3600), 'hour');
  return ago(Math.round(d / 86400), 'day');
}

/* A FOLD THAT OPENS ON THIS PHONE. Native <details> failed to expand on the
 * writer's Android (the Plot Essential Maker's v0.4.1), so every fold here is
 * a plain button that shows and hides what is under it. */
export function fold(label, content, { open = false, className = 'fold' } = {}) {
  const box = el('div', className);
  const head = el('button', 'fold-head', (open ? '\u25be ' : '\u25b8 ') + label);
  head.type = 'button';
  const body = el('div', 'fold-body');
  if (typeof content === 'string') body.textContent = content; else body.append(content);
  body.hidden = !open;
  head.addEventListener('click', (e) => {
    e.stopPropagation();
    body.hidden = !body.hidden;
    head.textContent = (body.hidden ? '\u25b8 ' : '\u25be ') + label;
  });
  box.append(head, body);
  return box;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied.'); return true; }
  catch (_) {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t); t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (__) {}
    t.remove();
    toast(ok ? 'Copied.' : 'Select and copy.');
    return ok;
  }
}

/* Hand him a file. */
export function downloadText(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
