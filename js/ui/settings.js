/* CozyMaker — js/ui/settings.js
 * The house: who you are talking to, who is working behind them, and how the
 * place looks. */

import * as store from '../store.js';
import { $, el, openSheet, toast, applyTheme, redraw, field, input, select, group, fold, downloadText } from './kit.js';
import { WORKERS, FRONT } from '../agents/roster.js';
import { personaOf, unfilledMacros } from '../agents/persona.js';
import { callModel } from '../agents/call.js';
import { loadEngine, sliceReport } from '../engine/slices.js';
import { craftFor } from '../engine/crafts.js';

const THEMES = [
  ['hearth', 'Hearth — warm and low'],
  ['tavern', 'The tavern at night — purple sky, a bard, somebody buying a round'],
  ['dusk', 'Dusk — cool and quiet'],
  ['paper', 'Paper — light'],
];
/* The levels Cozy Tavern proved on the wire, and nothing else — each house
 * is spoken to in its own words (js/providers.js). Left on the first, nothing
 * about thinking is sent at all and the provider decides. */
const THINKING = [
  ['', "Whatever the model does on its own"],
  ['off', 'Off'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['xhigh', 'XHigh'],
  ['max', 'Max'],
];

export function openHouse() {
  draw();
  openSheet('houseSheet');
}

function draw() {
  const house = store.getHouse();
  const body = $('houseBody');
  body.innerHTML = '';
  body.append(whoSection(house));
  body.append(connectionsSection(house));
  body.append(crewSection(house));
  body.append(lookSection(house));
  body.append(underTheFloorSection());
}

/* ------------------------------------------------------- who you are with */

function whoSection(house) {
  const g = group('Who you are making this with',
    'Whatever you write here goes to them first and is never touched. Everything this place adds underneath it is written the way two people talk — so nothing in here can knock them out of character.');

  const frame = document.createElement('textarea');
  frame.className = 'plain';
  frame.style.minHeight = '140px';
  frame.value = house.personaFrame || '';
  frame.placeholder = 'Paste your own instructions here — who they are, how they talk, all of it.';
  const macroNote = el('p', 'hint');
  const showMacros = () => {
    const missing = unfilledMacros(personaOf(store.getHouse()));
    macroNote.textContent = missing.length
      ? `Your instructions say ${missing.join(' and ')} — fill in the ${missing.length > 1 ? 'two names' : 'name'} below and ${missing.length > 1 ? 'they are' : 'it is'} read as ${missing.length > 1 ? 'those names' : 'that name'}, the way SillyTavern does.`
      : '';
    macroNote.style.display = missing.length ? '' : 'none';
  };
  frame.addEventListener('change', async () => {
    house.personaFrame = frame.value;
    await store.saveHouse(house);
    showMacros();
    toast('Saved.');
  });
  g.append(field('Their instructions, in your own words', frame));
  g.append(macroNote);
  showMacros();

  const maker = input(house.settings.makerName, 'Eni, Iron Man, Lothar — anyone');
  maker.addEventListener('change', () => save('makerName', maker.value.trim()).then(showMacros));
  g.append(field('What they are called', maker));

  const you = input(house.settings.yourName, 'Bruce, Jovan — whatever they should call you');
  you.addEventListener('change', () => save('yourName', you.value.trim()).then(showMacros));
  g.append(field('What you are called', you));

  /* "second" was only ever the old default: it follows the frame now */
  const shown = house.settings.person === 'first' ? 'first' : house.settings.person === 'you' ? 'you' : 'follow';
  const person = select([
    ['follow', 'The way your instructions are written'],
    ['you', 'As "you" — "Hey Eni, this is Bruce."'],
    ['first', 'As "I" — "I\'m Eni."'],
  ], shown);
  person.addEventListener('change', () => save('person', person.value));
  g.append(field('How this place speaks to them', person));

  return g;
}

function save(key, value) {
  const house = store.getHouse();
  house.settings[key] = value;
  return store.saveHouse(house).then(() => { if (key === 'theme') applyTheme(value); redraw(); });
}

/* ----------------------------------------------------------- connections */

function connectionsSection(house) {
  const g = group('Connections',
    'What you set here is what gets sent — your temperature, your top-p, your thinking. What you leave alone is not sent at all, so the provider does whatever it normally does.');

  for (const c of house.connections) {
    const row = el('div', 'row');
    const grow = el('div', 'grow');
    grow.append(el('b', '', c.name || c.model || 'unnamed'));
    grow.append(el('small', '', `${c.model || 'no model'} · ${hostOf(c.url)}`));
    grow.addEventListener('click', () => editConnection(c.id));
    row.append(grow);
    const test = el('button', 'btn quiet', 'Try it');
    test.addEventListener('click', async (e) => {
      e.stopPropagation();
      test.textContent = '…';
      const out = await callModel(c, { user: 'Reply with the single word: ready', maxTokens: 24 });
      test.textContent = 'Try it';
      if (!out.ok) return toast(`No — ${out.error}`);
      if (!out.text.trim()) return toast('It answered, but with nothing. Give it more room to reply, or turn its thinking down.');
      toast(`Working — it said "${out.text.trim().slice(0, 40)}"`);
    });
    row.append(test);
    g.append(row);
  }

  const add = el('button', 'btn quiet', house.connections.length ? 'Add another' : 'Add one');
  add.addEventListener('click', () => editConnection(null));
  const row = el('div', 'btnrow');
  row.append(add);
  g.append(row);
  return g;
}

function hostOf(url) {
  try { return new URL(url).host; } catch (_) { return url ? String(url).slice(0, 30) : 'no address'; }
}

function editConnection(id) {
  const house = store.getHouse();
  const existing = house.connections.find((c) => c.id === id);
  const c = existing || {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: '', url: '', model: '', key: '',
  };

  const body = $('houseBody');
  body.innerHTML = '';
  const g = group(existing ? 'This connection' : 'A new connection', '');

  const name = input(c.name, 'What to call it');
  const url = input(c.url, 'https://api.deepseek.com');
  const model = input(c.model, 'deepseek-chat');
  const key = input(c.key, 'the key', 'password');
  const temp = input(c.temperature, 'leave empty for the provider\'s own', 'number');
  temp.step = '0.05';
  const topP = input(c.topP, 'leave empty for the provider\'s own', 'number');
  topP.step = '0.05';
  const maxTok = input(c.maxTokens, 'leave empty for the provider\'s own', 'number');
  const thinking = select(THINKING, c.thinking === undefined || c.thinking === null ? '' : String(c.thinking));
  const budget = input(c.thinkingBudget, '4000', 'number');

  g.append(field('Name', name));
  g.append(field('Address', url));
  g.append(field('Model', model));
  g.append(field('Key', key));
  g.append(field('Temperature', temp));
  g.append(field('Top-p', topP));
  g.append(field('Longest reply', maxTok));
  g.append(field('Thinking', thinking));
  g.append(field('How much thinking, when it is on', budget));

  const row = el('div', 'btnrow');
  const saveBtn = el('button', 'btn', 'Save');
  saveBtn.addEventListener('click', async () => {
    c.name = name.value.trim() || model.value.trim() || 'a connection';
    c.url = url.value.trim();
    c.model = model.value.trim();
    c.key = key.value.trim();
    setNumberOrDrop(c, 'temperature', temp.value);
    setNumberOrDrop(c, 'topP', topP.value);
    setNumberOrDrop(c, 'maxTokens', maxTok.value);
    if (thinking.value === '') delete c.thinking; else c.thinking = thinking.value;
    setNumberOrDrop(c, 'thinkingBudget', budget.value);
    if (!existing) house.connections.push(c);
    if (!house.agentConnections[FRONT]) house.agentConnections[FRONT] = c.id;
    await store.saveHouse(house);
    draw();
    toast('Saved.');
  });
  const back = el('button', 'btn quiet', 'Back');
  back.addEventListener('click', draw);
  row.append(saveBtn, back);
  if (existing) {
    const del = el('button', 'btn danger', 'Remove');
    del.addEventListener('click', async () => {
      house.connections = house.connections.filter((x) => x.id !== c.id);
      for (const k of Object.keys(house.agentConnections)) {
        if (house.agentConnections[k] === c.id) delete house.agentConnections[k];
      }
      await store.saveHouse(house);
      draw();
    });
    row.append(del);
  }
  g.append(row);
  body.append(g);
}

/* NOTHING SET MEANS NOTHING SENT. An empty box removes the value entirely
 * rather than storing a zero the writer never chose. */
function setNumberOrDrop(obj, key, raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') { delete obj[key]; return; }
  const n = Number(s);
  if (Number.isFinite(n)) obj[key] = n; else delete obj[key];
}

/* ------------------------------------------------------------- the crew */

function crewSection(house) {
  const g = group('Who does what',
    'The one at the front is the only one you ever talk to. Everyone else works behind them and you never see their words. Any of them can have their own connection — quick careful work can ride a cheap model while the front keeps the good one.');

  const options = [['', 'the same as the front']].concat(house.connections.map((c) => [c.id, c.name || c.model]));
  const frontOptions = house.connections.map((c) => [c.id, c.name || c.model]);

  const front = select(frontOptions.length ? frontOptions : [['', 'no connection yet']], house.agentConnections[FRONT] || '');
  front.addEventListener('change', async () => {
    house.agentConnections[FRONT] = front.value;
    await store.saveHouse(house);
  });
  g.append(field('The one you talk to', front));

  const general = select(options, house.agentConnections._general || '');
  general.addEventListener('change', async () => {
    if (general.value) house.agentConnections._general = general.value;
    else delete house.agentConnections._general;
    await store.saveHouse(house);
  });
  g.append(field('Everyone behind them, unless said otherwise', general));

  const detailsInner = el('div', '');
  const details = fold('give someone their own connection', detailsInner, { className: 'fold thinking' });
  details.style.maxHeight = 'none';
  for (const [id, what] of WORKERS) {
    const s = select(options, house.agentConnections[id] || '');
    s.addEventListener('change', async () => {
      if (s.value) house.agentConnections[id] = s.value;
      else delete house.agentConnections[id];
      await store.saveHouse(house);
    });
    detailsInner.append(field(what, s));
  }
  g.append(details);
  return g;
}

/* ------------------------------------------------------------- the look */

function lookSection(house) {
  const g = group('The look', '');
  const theme = select(THEMES, house.settings.theme || 'hearth');
  theme.addEventListener('change', () => save('theme', theme.value));
  g.append(field('Coat of paint', theme));

  const turns = input(house.settings.turnsOnScreen || 40, '40', 'number');
  turns.addEventListener('change', () => save('turnsOnScreen', Math.max(6, Number(turns.value) || 40)));
  g.append(field('How much of the conversation they are given each time', turns));
  return g;
}

/* ------------------------------------------------------ under the floor */

function underTheFloorSection() {
  const g = group('Under the floor',
    'The whole craft lives in one file, engine/generalist.md. Nothing here restates it — each worker is handed only the parts of it their job needs.');
  const detailsInner = el('div', '');
  const details = fold('what each of them reads', detailsInner, { className: 'fold thinking' });
  details.style.maxHeight = 'none';
  const pre = el('div', '', 'reading…');
  pre.style.whiteSpace = 'pre';
  pre.className = 'scrollx';
  detailsInner.append(pre);
  loadEngine().then((sections) => {
    const rows = sliceReport(sections);
    let whole = 0;
    for (const s of sections.values()) whole += s.text.length;
    pre.textContent = rows
      .sort((a, b) => b.chars - a.chars)
      .map((r) => `${r.worker.padEnd(14)} ${String(r.chars).padStart(7)} chars  ${String(r.sections).padStart(3)} parts${r.missing.length ? '  MISSING ' + r.missing.join(',') : ''}`)
      .join('\n') + `\n\nthe whole craft ${whole} chars — nobody carries all of it`;
    /* the three with a craft of their own, carried over from the Plot Essential Maker or set by him */
    return Promise.all(['worldbook', 'auditor', 'instructions'].map((w) => craftFor(w, store.getHouse())
      .then((t) => `${w.padEnd(14)} ${String(t.length).padStart(7)} chars  its own craft`)
      .catch((e) => `${w.padEnd(14)} could not be read: ${e.message}`)))
      .then((lines) => { pre.textContent += '\n\n' + lines.join('\n'); });
  }).catch((e) => { pre.textContent = 'could not read the craft file: ' + e.message; });
  g.append(details);

  /* everything in one file, and back again by adding only */
  const keep = group('Everything, in one file', 'Every world with its documents and conversations. Not your connections or keys \u2014 those stay on this device. Bringing a file back only ever adds: nothing here is replaced.');
  const krow = el('div', 'btnrow');
  const out = el('button', 'btn quiet', 'Save everything to a file');
  out.addEventListener('click', async () => {
    try {
      const b = await store.exportEverything();
      const day = new Date(b.at).toISOString().slice(0, 10);
      downloadText(`CozyMaker backup ${day}.json`, JSON.stringify(b));
      toast(`${b.worlds.length} world${b.worlds.length === 1 ? '' : 's'} saved to a file.`);
    } catch (e) { toast('That could not be saved: ' + ((e && e.message) || e)); }
  });
  const inn = el('button', 'btn quiet', 'Bring everything back from a file');
  const file = document.createElement('input');
  file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
  inn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    const r = store.readBackup(await f.text());
    if (!r.ok) return toast(r.why);
    try {
      const { added } = await store.restoreEverything(r.backup);
      toast(`${added} world${added === 1 ? '' : 's'} brought back, beside the ones already here.`);
      redraw();
    } catch (e) { toast('That could not be brought back: ' + ((e && e.message) || e)); }
  });
  krow.append(out, inn, file);
  keep.append(krow);
  g.append(keep);

  const row = el('div', 'btnrow');
  const where = el('button', 'btn quiet', 'Where the work lives');
  where.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/version', { cache: 'no-store' }).then((x) => x.json());
      toast(`${r.home} — version ${r.version}`);
    } catch (_) { toast('The little server did not answer.'); }
  });
  row.append(where);
  g.append(row);
  return g;
}
