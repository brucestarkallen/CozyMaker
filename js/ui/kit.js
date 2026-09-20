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
