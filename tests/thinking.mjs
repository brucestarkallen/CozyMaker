/* CozyMaker — tests/thinking.mjs
 * The thinking layer held to Cozy Tavern's REAL output: every case in
 * fixtures/tavern-thinking.json was produced by running Tavern's own
 * requestBody. CozyMaker's buildRequest must say exactly the same thing. */
import fs from 'node:fs';
import { buildRequest, lessonFrom, fitEffort, learnedFacts, learnKey } from '../js/providers.js';

let passed = 0; const failed = [];
const ok = (name, cond, detail = '') => { if (cond) passed++; else failed.push(`${name}${detail ? ' — ' + detail : ''}`); };
const KEYS = ['thinking', 'reasoning_effort', 'reasoning', 'enable_thinking', 'model_options', 'output_config', 'temperature', 'top_p'];
const { cases } = JSON.parse(fs.readFileSync(new URL('./fixtures/tavern-thinking.json', import.meta.url)));

let same = 0;
for (const { conn, want } of cases) {
  const r = buildRequest({ key: 'k', ...conn }, { system: 's', messages: [{ role: 'user', content: 'x' }] });
  const got = {};
  for (const k of KEYS) if (k in r.body) got[k] = r.body[k];
  if (r.body.thinking && r.body.thinking.budget_tokens) got.maxAboveBudget = r.body.max_tokens > r.body.thinking.budget_tokens;
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) same++;
  else failed.push(`${conn.model} at ${conn.url} [${conn.thinking}${conn.thinkingBudget ? ' room ' + conn.thinkingBudget : ''}${conn.temperature !== undefined ? ' temp ' + conn.temperature : ''}] — Tavern ${b}, CozyMaker ${a}`);
}
ok(`every level set says what Cozy Tavern says (${same} of ${cases.length})`, same === cases.length);

/* His rule: nothing set, nothing sent — for every house in the grid. */
const pairs = [...new Map(cases.map((c) => [c.conn.url + '|' + c.conn.model, c.conn])).values()];
const leaks = pairs.filter((c) => {
  const r = buildRequest({ key: 'k', url: c.url, model: c.model }, { messages: [{ role: 'user', content: 'x' }] });
  return KEYS.slice(0, 6).some((k) => k in r.body);
});
ok(`a level he has not set sends nothing, on all ${pairs.length} connections`, !leaks.length, leaks.map((c) => c.model).join(', '));
const tempKept = buildRequest({ key: 'k', url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', temperature: 0.7, topP: 0.9 }, { messages: [] }).body;
ok('with thinking not set, his temperature and top-p go to Claude as set', tempKept.temperature === 0.7 && tempKept.top_p === 0.9);

/* What a refusal teaches (M350) */
const lesson = lessonFrom("Invalid value for reasoning_effort: 'medium'. Supported values are: 'low', 'high'.", { reasoning_effort: 'medium' });
ok('a refusal that lists values is read for them', JSON.stringify(lesson.allowed) === JSON.stringify(['low', 'high']), JSON.stringify(lesson));
ok('a refusal that names a field it does not take is read for it',
  lessonFrom('Unrecognized request argument supplied: thinking', { thinking: { type: 'enabled' } }).badField === 'thinking');
ok('a level is fitted to the nearest one it takes, never above', fitEffort('max', ['low', 'high']) === 'high' && fitEffort('medium', ['low', 'high']) === 'low');
ok('Off is fitted to "none" where it is taken', fitEffort('off', ['none', 'low', 'high'], true) === 'none');
const taught = { key: 'k', url: 'https://relay.example/v1', model: 'm1', thinking: 'medium' };
taught.learned = { for: learnKey(taught), at: Date.now(), efforts: ['low', 'high'], drop: ['thinking'] };
const tb = buildRequest(taught, { messages: [] }).body;
ok('what the model taught is applied: its levels, and the field it refused left out', tb.reasoning_effort === 'low' && !('thinking' in tb), JSON.stringify(tb));
const stale = { ...taught, learned: { ...taught.learned, at: Date.now() - 31 * 86400000 } };
ok('a lesson older than thirty days is forgotten', learnedFacts(stale) === null);
const moved = { ...taught, model: 'm2' };
ok('a lesson belongs to one model at one address', learnedFacts(moved) === null);
const down = { ...taught, learned: { for: learnKey(taught), at: Date.now(), downAt: Date.now() } };
ok('a plain refusal silences thinking for a day', !['thinking', 'reasoning_effort'].some((k) => k in buildRequest(down, { messages: [] }).body));
const healed = { ...taught, learned: { for: learnKey(taught), at: Date.now(), downAt: Date.now() - 25 * 3600000 } };
ok('and heals by itself after it', 'reasoning_effort' in buildRequest(healed, { messages: [] }).body);
const offThinks = { key: 'k', url: 'https://relay.example/v1', model: 'm3', thinking: 'off' };
offThinks.learned = { for: learnKey(offThinks), at: Date.now(), offThinks: true };
ok('an Off the model ignored asks for its least instead of its own default', buildRequest(offThinks, { messages: [] }).body.reasoning_effort === 'low');

console.log(`\n${passed} passed, ${failed.length} failed`);
for (const f of failed.slice(0, 40)) console.log('  ✗ ' + f);
if (failed.length > 40) console.log(`  … and ${failed.length - 40} more`);
process.exit(failed.length ? 1 : 0);
