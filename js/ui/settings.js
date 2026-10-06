/* CozyMaker — js/ui/settings.js
 * The house: who you are talking to, who is working behind them, and how the
 * place looks. */

import * as store from '../store.js';
import { $, el, openSheet, toast, applyTheme, redraw, field, input, select, group, fold, downloadText } from './kit.js';
import { WORKERS, FRONT } from '../agents/roster.js';
import { personaOf, unfilledMacros } from '../agents/persona.js';
import { testConnection, listModels } from '../agents/call.js';
import { spokenAs, learnedFacts, alwaysThinks, cannotStopThinking, hermesLike } from '../providers.js';
import { SEARCHER, searcherFor } from '../agents/search.js';
import { loadEngine, sliceReport } from '../engine/slices.js';
import { craftFor } from '../engine/crafts.js';
import { SHORTCUTS, WHO, engineLines } from '../agents/shortcuts.js';

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
  body.append(searchSection(house));
  body.append(shortcutsSection(house));
  body.append(lookSection(house));
  body.append(underTheFloorSection());
  body.append(versionLine());
}

/* THE VERSION, ALWAYS IN PLAIN SIGHT. It used to live only in a toast behind a
 * button named for something else, so there was no way to just look it up —
 * and a thing he cannot find is a thing that is not there. This sits at the
 * foot of the house, always shown, and says the folder his work lives in too. */
function versionLine() {
  const g = el('div', 'group');
  const line = el('p', 'hint', 'CozyMaker');
  g.append(line);
  fetch('/api/version', { cache: 'no-store' }).then((x) => x.json())
    .then((r) => { line.textContent = `CozyMaker \u00b7 version ${r.version}` + (r.home ? ` \u00b7 your work is kept in ${r.home}` : ''); })
    .catch(() => { line.textContent = 'CozyMaker \u2014 the little server did not answer, so the version could not be read'; });
  return g;
}

/* ------------------------------------------------------- who you are with */

/* WHAT HE TYPES HERE IS KEPT AS HE TYPES IT. These boxes used to save only on
 * "change", which a browser fires when the box loses focus: a persona pasted
 * in and the app then left — the phone's back button, another app — was
 * never saved, and nothing said so. Now a pause of 0.7s saves it, leaving the
 * box saves it, and the page being hidden saves whatever is still waiting. */
let unsaved = null;
function keepAsTyped(box, keep) {
  let timer = null;
  const now = () => {
    clearTimeout(timer); timer = null;
    if (unsaved === now) unsaved = null;
    return Promise.resolve().then(keep).catch((e) => toast('That could not be saved: ' + ((e && e.message) || e)));
  };
  box.addEventListener('input', () => { clearTimeout(timer); unsaved = now; timer = setTimeout(now, 700); });
  box.addEventListener('change', now);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && unsaved) unsaved(); });
window.addEventListener('pagehide', () => { if (unsaved) unsaved(); });

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
  keepAsTyped(frame, async () => {
    const h = store.getHouse();
    if (h.personaFrame === frame.value) return;
    h.personaFrame = frame.value;
    await store.saveHouse(h);
    showMacros();
  });
  g.append(field('Their instructions, in your own words', frame));
  g.append(macroNote);
  showMacros();

  /* THE NOTE AT THE END — SillyTavern's post-history instructions, Cozy Tavern's
   * note at the end: anything he likes, sent after his message on every turn, read
   * last. Its switch keeps the words and stops sending them; its role is his. */
  const note = document.createElement('textarea');
  note.className = 'plain';
  note.style.minHeight = '110px';
  note.value = house.postNote || '';
  note.placeholder = 'Anything you like \u2014 a reminder, a rule, a mood. Sent after your message, every turn.';
  keepAsTyped(note, async () => {
    const h = store.getHouse();
    if ((h.postNote || '') === note.value) return;
    h.postNote = note.value;
    await store.saveHouse(h);
  });
  g.append(field('The note at the end', note));
  g.append(el('p', 'hint', 'Your post-history instructions: read last, right after your message, on every turn \u2014 {{user}} and {{char}} read as the two names, as in their instructions.'));
  const sendNote = select([
    ['on', 'On \u2014 sent on every turn'],
    ['off', 'Off \u2014 kept here, not sent'],
  ], house.settings.sendNote === 'off' ? 'off' : 'on');
  sendNote.addEventListener('change', () => save('sendNote', sendNote.value));
  g.append(field('Send the note at the end', sendNote));
  const noteRole = select([
    ['system', 'A system message \u2014 like SillyTavern\u2019s post-history instructions'],
    ['user', 'A user message \u2014 added to the end of yours'],
  ], house.settings.noteRole === 'user' ? 'user' : 'system');
  noteRole.addEventListener('change', () => save('noteRole', noteRole.value));
  g.append(field('Sent after your message as', noteRole));

  const maker = input(house.settings.makerName, 'Eni, Iron Man, Lothar — anyone');
  keepAsTyped(maker, () => (store.getHouse().settings.makerName === maker.value.trim() ? null : save('makerName', maker.value.trim()).then(showMacros)));
  g.append(field('What they are called', maker));

  const you = input(house.settings.yourName, 'Bruce, Jovan — whatever they should call you');
  keepAsTyped(you, () => (store.getHouse().settings.yourName === you.value.trim() ? null : save('yourName', you.value.trim()).then(showMacros)));
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
    grow.append(el('small', '', `${c.model || 'no model'} \u00b7 ${hostOf(c.url)}`));
    /* WHAT THIS CONNECTION SAYS ABOUT THINKING, WHERE HE LOOKS (Cozy Tavern
     * M22-A, M303, M349, M350): the level and how it is actually spoken on this
     * wire; a model that cannot be told Off says what its Off is; and what the
     * model itself taught the house. */
    const level = c.thinking || '';
    if (level || alwaysThinks(c.model) || alwaysThinks(c.modelHf) || cannotStopThinking(c)) {
      grow.append(el('small', 'conn-line', `thinking: ${level || 'whatever the model does on its own'} \u2014 ${spokenAs(c)}`));
    }
    const taught = learnedFacts(c);
    const listed = Array.isArray(c.modelEfforts) && c.modelEfforts.length ? c.modelEfforts : null;
    if ((taught && (taught.efforts || taught.drop.length || taught.offThinks || taught.down)) || listed || c.modelHf) {
      const bits = [];
      if (c.modelHf) bits.push(`it is ${c.modelHf}`);
      if (taught && taught.efforts) bits.push('takes ' + taught.efforts.join(', '));
      else if (listed) bits.push('takes ' + listed.join(', ') + ' (from its provider\'s list)');
      if (taught && taught.drop.length) bits.push('does not take ' + taught.drop.map((f) => `\u201c${f}\u201d`).join(', '));
      if (taught && taught.offThinks) bits.push('Off does not stop it, so Off asks for its least');
      if (taught && taught.down) bits.push('refused thinking today, so none is sent until tomorrow');
      grow.append(el('small', 'conn-line', 'learned from the model: ' + bits.join(' \u00b7 ')));
    }
    /* the last test, kept on the connection: the answer stays where he can read it */
    const result = el('small', 'conn-line conn-test', c.tested && c.tested.words ? `Last tried ${new Date(c.tested.at).toLocaleString()}: ${c.tested.words}` : '');
    result.hidden = !(c.tested && c.tested.words);
    grow.append(result);
    grow.addEventListener('click', () => editConnection(c.id));
    row.append(grow);
    const test = el('button', 'btn quiet', 'Try it');
    test.addEventListener('click', async (e) => {
      e.stopPropagation();
      test.textContent = '\u2026';
      test.disabled = true;
      const out = await testConnection(c);
      test.textContent = 'Try it';
      test.disabled = false;
      c.tested = { at: Date.now(), words: out.words, ok: out.ok, thinks: Boolean(out.thinks) };
      result.textContent = `Last tried just now: ${out.words}`;
      result.hidden = false;
      toast(out.words.split(' \u2014 ')[0].slice(0, 90));
      try { await store.saveHouse(store.getHouse()); } catch (_) { /* the line on screen still says it */ }
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
  /* THE MODELS ON OFFER (Cozy Tavern M348): picked from the provider's own list,
   * a model is kept with what it is — the weights behind an alias, the levels
   * of thinking it takes — so thinking is spoken to it right without guessing. */
  let offered = [];
  let picked = c.modelHf || c.modelEfforts ? { id: c.model, hf: c.modelHf || '', efforts: c.modelEfforts || null } : null;
  const listBtn = el('button', 'btn quiet small', 'Show the models on offer');
  const pick = document.createElement('select');
  pick.hidden = true;
  const listNote = el('p', 'hint', '');
  listNote.hidden = true;
  listBtn.addEventListener('click', async () => {
    listBtn.disabled = true;
    listNote.hidden = false;
    listNote.textContent = 'Asking what\u2019s on offer\u2026';
    const r = await listModels({ ...c, url: url.value.trim(), key: key.value.trim(), model: model.value.trim() });
    listBtn.disabled = false;
    if (!r.ok) { listNote.textContent = `The list did not come: ${r.error}. The model name above still stands.`; return; }
    if (!r.models.length) { listNote.textContent = 'The list came back empty \u2014 the model name above still stands.'; return; }
    offered = r.models;
    pick.innerHTML = '';
    const first = document.createElement('option');
    first.value = ''; first.textContent = `${offered.length} on offer \u2014 pick one`;
    pick.append(first);
    for (const m of offered) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.id + (m.hf ? ` (${m.hf})` : ''); pick.append(o); }
    pick.hidden = false;
    listNote.textContent = 'Picking one fills the model name and keeps what it is.';
  });
  pick.addEventListener('change', () => {
    const m = offered.find((x) => x.id === pick.value);
    if (!m) return;
    model.value = m.id;
    picked = m;
  });
  const listRow = el('div', 'btnrow');
  listRow.append(listBtn);
  g.append(listRow, pick, listNote);
  g.append(field('Key', key));
  g.append(field('Temperature', temp));
  g.append(field('Top-p', topP));
  g.append(field('Longest reply', maxTok));
  g.append(field('Thinking', thinking));
  g.append(field('How much thinking, when it is on', budget));

  const row = el('div', 'btnrow');
  const saveBtn = el('button', 'btn', 'Save');
  saveBtn.addEventListener('click', async () => {
    /* what the last "Try it" said was said of this address, this model, this
     * key, this thinking — change any of them and it no longer describes this
     * connection, so it goes rather than stand there looking current */
    const tried = () => JSON.stringify([c.url || '', c.model || '', c.key || '', c.thinking || '', c.thinkingBudget ?? '']);
    const before = tried();
    c.name = name.value.trim() || model.value.trim() || 'a connection';
    c.url = url.value.trim();
    c.model = model.value.trim();
    /* what the model is travels with its name, and only with its name */
    if (picked && picked.id === c.model) {
      if (picked.hf) c.modelHf = picked.hf; else delete c.modelHf;
      if (picked.efforts) c.modelEfforts = picked.efforts; else delete c.modelEfforts;
    } else { delete c.modelHf; delete c.modelEfforts; }
    c.key = key.value.trim();
    setNumberOrDrop(c, 'temperature', temp.value);
    setNumberOrDrop(c, 'topP', topP.value);
    setNumberOrDrop(c, 'maxTokens', maxTok.value);
    if (thinking.value === '') delete c.thinking; else c.thinking = thinking.value;
    setNumberOrDrop(c, 'thinkingBudget', budget.value);
    if (tried() !== before) delete c.tested;
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
      /* like every other delete here, it asks first — and this one keeps no copy:
       * keys are never put in a backup, so the key goes with it */
      if (!confirm(`Remove the connection \u201c${c.name || c.model || 'unnamed'}\u201d? Its key goes with it \u2014 keys are never kept in a backup.`)) return;
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
  /* what an empty pick means, said truly: the listener rides the one he talks
   * to; everyone else, whatever "Everyone behind them" is set to (it used to
   * say "the same as the front" for everyone, and was wrong once that was set) */
  for (const [id, what] of WORKERS) {
    const own = [['', id === 'listener' ? 'the same as the one you talk to' : 'the same as everyone behind them']].concat(house.connections.map((c) => [c.id, c.name || c.model]));
    const s = select(own, house.agentConnections[id] || '');
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

/* ----------------------------------------------------- searching the internet */

/* SEARCH THE INTERNET (v1.7.0), his switch. Off, nothing is looked up and every
 * request is exactly what it was. On, anything real the crew or the one he talks
 * to is not sure of is looked up first, by the connection that searches — his
 * Hermes Agent, whose own web tools do it (js/agents/search.js). */
function searchSection(house) {
  const g = group('Searching the internet',
    'When it is on, anything real they are not sure of \u2014 a canon detail of an existing story, a real name, place or date \u2014 is looked up on the internet first, instead of guessed. Off, nothing is looked up, exactly as before.');
  const on = select([
    ['off', 'Off \u2014 nothing is looked up'],
    ['on', 'On \u2014 what they are not sure of is looked up first'],
  ], house.settings.searchInternet === 'on' ? 'on' : 'off');
  g.append(field('Search the internet', on));
  const hermes = house.connections.filter((c) => hermesLike(c));
  const who = select([['', hermes.length ? `your Hermes Agent (${hermes[0].name || hermes[0].model})` : 'nobody yet \u2014 add your Hermes Agent as a connection']]
    .concat(house.connections.map((c) => [c.id, c.name || c.model])), house.agentConnections[SEARCHER] || '');
  g.append(field('Who searches the internet', who));
  const note = el('p', 'hint', '');
  const say = () => {
    const h = store.getHouse();
    const missing = h.settings.searchInternet === 'on' && !searcherFor(h);
    note.textContent = missing ? 'Nothing can search yet: add your Hermes Agent as a connection above (its address is http://127.0.0.1:8642/v1, its model hermes-agent), and it is used here on its own.' : '';
    note.hidden = !missing;
  };
  on.addEventListener('change', async () => { await save('searchInternet', on.value); say(); });
  who.addEventListener('change', async () => {
    const h = store.getHouse();
    if (who.value) h.agentConnections[SEARCHER] = who.value;
    else delete h.agentConnections[SEARCHER];
    await store.saveHouse(h);
    say();
  });
  g.append(note);
  say();
  return g;
}

/* ------------------------------------------------------------ shortcuts */

/* EVERY SHORTCUT, LOOKED UP RATHER THAN REMEMBERED (js/agents/shortcuts.js). Folded
 * shut, like every busy part of the house; opened, each says what it does here,
 * who does it, how to type it, and his engine's own words for it, read out of the
 * engine file itself. */
function shortcutsSection(house) {
  const g = group('Shortcuts',
    'You never need these \u2014 say it in plain words and it reaches the same one. They are for when you would rather type the short way. Each says what it does here, with your engine\u2019s own words for it underneath.');
  const list = el('div', 'shortcuts');
  const engineSlots = [];
  for (const part of SHORTCUTS) {
    list.append(el('h4', 'shortcut-group', part.group));
    for (const s of part.items) {
      const box = el('div', 'shortcut');
      box.append(el('div', 'cmd', s.cmd));
      box.append(el('div', 'does', s.does));
      box.append(el('div', 'meta', `Who does it: ${WHO[s.who] || s.who}.`));
      box.append(el('div', 'meta', `Try it: ${s.example}`));
      const engine = el('div', 'engine', '');
      engine.hidden = true;
      box.append(engine);
      engineSlots.push([s.cmd, engine]);
      list.append(box);
    }
  }
  const f = fold('every shortcut, and what it does', list);
  g.append(f);
  Promise.all([loadEngine(), craftFor('auditor', house).catch(() => '')]).then(([sections, auditor]) => {
    const said = engineLines(sections, auditor);
    for (const [cmd, node] of engineSlots) {
      const words = said.get(cmd);
      if (words) { node.textContent = `In your engine: ${words}`; node.hidden = false; }
    }
  }).catch(() => { /* the engine's own words are an addition; the list stands without them */ });
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

  /* SMOOTH STREAMING (SillyTavern's name for it). A provider sends words in
   * clumps; on, a clump flows in over the next moment instead of landing at once,
   * and the words on screen keep pace with the model (js/ui/pace.js). Off, each
   * piece is drawn the frame it arrives. Read on every frame: a change applies to
   * a reply already being written. */
  const smooth = select([
    ['on', 'On \u2014 the words flow in evenly as they are written'],
    ['off', 'Off \u2014 each piece shows the moment it arrives'],
  ], house.settings.smoothStreaming === 'off' ? 'off' : 'on');
  smooth.addEventListener('change', () => save('smoothStreaming', smooth.value));
  g.append(field('Smooth streaming', smooth));
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
  const keep = group('Everything, in one file', 'Every world with its documents and conversations, and how you set the house up \u2014 their instructions, the names, your settings and your own crafts. Not your connections or keys \u2014 those stay on this device. Bringing a file back only ever adds: worlds come back beside yours, and a setting comes back only where this house has none.');
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
      const { added, filled } = await store.restoreEverything(r.backup);
      toast(`${added} world${added === 1 ? '' : 's'} brought back, beside the ones already here` +
        (filled && filled.length ? ` \u2014 and ${filled.join(', ')}, which this house did not have yet.` : '.'));
      draw();
      redraw();
    } catch (e) { toast('That could not be brought back: ' + ((e && e.message) || e)); }
  });
  krow.append(out, inn, file);
  keep.append(krow);
  g.append(keep);

  return g;
}
