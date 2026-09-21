/* CozyMaker — js/providers.js
 *
 * ONE way out to a model, for the front and for every worker alike. Until a
 * house has one way out, it has five, and four of them are wrong about
 * something — that is where "the worker answered with nothing" comes from.
 *
 * THE SETTINGS LAW: a value the writer set is sent, exactly as set. A value
 * the writer did NOT set is not sent at all, so the provider's own default
 * applies — the house has no business answering for him. Temperature, top-p,
 * thinking, the reply length: all of it his.
 *
 * The one and only override is a floor that prevents corruption: a model that
 * always thinks, pointed at a small reply budget, spends the whole budget
 * reasoning and returns an empty answer. Where a worker needs room for its
 * answer, the floor raises the ceiling; it never lowers one the writer set.
 *
 * Every call goes through the device's own server, so keys stay on the device
 * and no provider's browser rules can break a room.
 */

export const WORKER_ROOM = 2400;      /* a worker's answer needs this much room */
export const ALWAYS_THINKS_FLOOR = 16000;

/* Which house is this address. */
export function houseOf(url) {
  const u = String(url || '').toLowerCase();
  /* Anthropic's own address, and the Anthropic-shaped addresses other houses
   * publish under /anthropic (DeepSeek, Moonshot, Z.ai): same body, same path. */
  if (u.includes('api.anthropic.com') || /\/anthropic(\/v\d+)?\/?(messages\/?)?$/.test(u.split('?')[0])) return 'anthropic';
  if (u.includes('openrouter.ai')) return 'openrouter';
  if (u.includes('bigmodel.cn') || u.includes('z.ai')) return 'zai';
  if (u.includes('moonshot')) return 'moonshot';
  if (u.includes('deepseek')) return 'deepseek';
  if (u.includes('dashscope') || u.includes('qwen')) return 'qwen';
  return 'openai';
}

/* Models that think whether or not anyone asked. */
export function alwaysThinks(model) {
  const m = String(model || '').toLowerCase();
  return /(^|[^a-z])o[134](-|$)/.test(m) || m.includes('thinking') ||
         m.includes('reason') || /kimi-k[23]/.test(m) || m.includes('qwq');
}

function endpoint(conn) {
  const base = String(conn.url || '').replace(/\/+$/, '');
  if (!base) return '';
  if (/\/(chat\/completions|messages)$/.test(base)) return base;
  if (houseOf(base) === 'anthropic') return /\/v\d+$/.test(base) ? base + '/messages' : base + '/v1/messages';
  if (/\/v\d+$/.test(base)) return base + '/chat/completions';
  return base + '/v1/chat/completions';
}

function headersFor(conn) {
  const h = {};
  const house = houseOf(conn.url);
  if (house === 'anthropic') {
    h['x-api-key'] = conn.key || '';
    h['anthropic-version'] = '2023-06-01';
  } else {
    h['Authorization'] = 'Bearer ' + (conn.key || '');
  }
  if (house === 'openrouter') {
    h['HTTP-Referer'] = 'http://127.0.0.1/cozymaker';
    h['X-Title'] = 'CozyMaker';
  }
  return h;
}

/* THINKING, SPOKEN IN EACH HOUSE'S OWN WORDS — Cozy Tavern's, ported whole.
 *
 * Everything from here to buildRequest is a port of Cozy Tavern's proven
 * provider code (js/providers/effort.js, and the thinking half of
 * requestBody in openai.js and anthropic.js, at m363-001), changed only where
 * CozyMaker names a field differently (url for baseUrl, thinking for
 * reasoning.effort, thinkingBudget for reasoning.budgetTokens). It is held to
 * Tavern's real output by tests/fixtures/tavern-thinking.json — 198 cases
 * produced by running Tavern's own requestBody.
 *
 * One deliberate difference, the writer's own rule: a level he has NOT set is
 * not sent at all, and the provider's default applies. (Tavern reads an unset
 * level as Off.) */

export const EFFORT_RANK = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
export const LEVELS = EFFORT_RANK;

export const EFFORT_LEVELS = {
  anthropic: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  openai: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  openrouter: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  zai: ['off', 'low', 'high', 'max'],
  qwen: ['off', 'low', 'medium', 'high'],
  hermes: ['off', 'low', 'medium', 'high'],
  deepseek: ['off', 'low', 'high', 'max'],   /* M37 */
  kimi: ['low', 'high', 'max'],              /* M303: K3 always thinks */
  kimi2: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  none: ['off', 'low', 'medium', 'high'],
};

export const EFFORT_ALIAS = {
  zai: { medium: 'high', xhigh: 'max' },
  deepseek: { medium: 'high', xhigh: 'max' },
  kimi: { off: 'low', medium: 'high', xhigh: 'max' },
};

function isAnthropicShape(conn) { return houseOf(conn && conn.url) === 'anthropic'; }

/* Which family's words this connection speaks (Tavern familyStyle). */
export function familyStyle(conn) {
  const c = conn || {};
  if (isAnthropicShape(c)) return 'anthropic';
  const url = String(c.url || '').toLowerCase();
  const model = String(c.model || '').toLowerCase();
  const any = (re) => re.test(model);
  if (c.preset === 'hermes' || model === 'hermes-agent') return 'hermes';
  if (c.preset === 'openrouter' || url.includes('openrouter.ai')) return 'openrouter';
  const kimiHost = url.includes('moonshot') || /(^|[/.])kimi\.(ai|com)([/:]|$)/.test(url);
  if (any(/kimi[-_.]?k[3-9]/) || (kimiHost && /^k[3-9]\b/.test(model))) return 'kimi';
  if (kimiHost && /^kimi/.test(model)) return /k2\.?7-code/.test(model) ? 'none' : 'kimi2';
  if (c.preset === 'zai' || url.includes('api.z.ai') || any(/\bglm\b|^glm|glm-/)) return 'zai';
  if (any(/qwen/)) return 'qwen';
  if (c.preset === 'deepseek' || url.includes('deepseek') || any(/^deepseek/)) return 'deepseek';
  return 'openai';
}
export const thinkingStyle = familyStyle;

export function glmVersion(conn) {
  const m = /glm[-_.]?(\d+)(?:[._](\d+))?/.exec(String((conn && conn.model) || '').toLowerCase());
  return m ? Number(m[1]) + (m[2] ? Number('0.' + m[2]) : 0) : null;
}

/* A model that cannot be told not to think (Tavern alwaysThinks). */
export function cannotStopThinking(conn) {
  const style = familyStyle(conn);
  if (style === 'kimi') return true;
  if (style === 'zai') { const v = glmVersion(conn); return v !== null && v >= 5.3; }
  return false;
}

export function zaiWire(effort, version) {
  const e = effort === 'medium' ? 'high' : effort === 'xhigh' ? 'max' : effort;
  if (version !== null && version >= 5.3) return { thinking: { type: 'enabled' }, reasoning_effort: e === 'off' ? 'low' : e };
  if (version !== null && version < 5.2) return { thinking: { type: e === 'off' ? 'disabled' : 'enabled' } };
  if (e === 'off') return { thinking: { type: 'disabled' } };
  return { thinking: { type: 'enabled' }, reasoning_effort: e === 'low' ? 'high' : e };
}

/* The level this connection can actually SAY (Tavern effortFor). */
export function effortFor(style, eff) {
  const lv = EFFORT_LEVELS[style] || EFFORT_LEVELS.openai;
  const e = (EFFORT_ALIAS[style] && EFFORT_ALIAS[style][eff]) || eff;
  let r = EFFORT_RANK.indexOf(e);
  if (r < 0) r = 0;
  while (r > 0 && lv.indexOf(EFFORT_RANK[r]) < 0) r--;
  if (lv.indexOf(EFFORT_RANK[r]) >= 0) return EFFORT_RANK[r];
  if (lv.indexOf('off') < 0) { const least = lv.find((l) => l !== 'off'); if (least) return least; }
  return 'off';
}

export function hostIsOpenAI(url) { return /(^|\/\/)api\.openai\.com(\/|$)/i.test(String(url || '')); }

/* The thinking ROOM (M308): only Claude takes a budget directly (never under
 * its own floor of 1,024), and through OpenRouter only Claude and Gemini. For
 * every other model a number here is never sent — the level decides. */
export const CLAUDE_BUDGET_FLOOR = 1024;
export function budgetFor(conn) {
  const c = conn || {};
  const asked = Number(c.thinkingBudget) > 0 ? Math.round(Number(c.thinkingBudget)) : 0;
  const model = String(c.model || '').toLowerCase();
  const url = String(c.url || '').toLowerCase();
  if (isAnthropicShape(c)) {
    if (/deepseek/.test(url + ' ' + model)) return { sent: false, tokens: 0 };
    const tokens = asked ? Math.max(CLAUDE_BUDGET_FLOOR, asked) : 0;
    return { sent: Boolean(tokens), tokens };
  }
  if (familyStyle(c) === 'openrouter' && /^(anthropic|google)\//.test(model)) return { sent: Boolean(asked), tokens: asked };
  return { sent: false, tokens: 0 };
}

/* What the model itself taught the house (M350): the levels a refusal said it
 * takes, a field it does not take, an Off that did not stop it. Kept per model
 * at its address, for thirty days. A plain refusal of thinking is kept for a
 * day (M319) — one that happened for a passing reason heals by itself. */
export const LEARN_FOR_MS = 30 * 24 * 60 * 60 * 1000;
export const REFUSAL_MEMORY_MS = 24 * 60 * 60 * 1000;
export function learnKey(conn) { return String((conn && conn.model) || '') + '@' + String((conn && conn.url) || ''); }
export function learnedFacts(conn, now = Date.now()) {
  const L = conn && conn.learned;
  if (!L || L.for !== learnKey(conn)) return null;
  if (Number.isFinite(L.at) && now - L.at > LEARN_FOR_MS) return null;
  return {
    efforts: Array.isArray(L.efforts) && L.efforts.length ? L.efforts : null,
    drop: Array.isArray(L.drop) ? L.drop : [],
    offThinks: L.offThinks === true,
    down: Number.isFinite(L.downAt) && now - L.downAt <= REFUSAL_MEMORY_MS,
  };
}

const EFFORT_WORDS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const OFFERS = /(supported values|allowed values|valid values|accepted values|possible values|available values|one of|must be|should be|expected|only supports?|options are|choose from|permitted values)/i;
const NOT_TAKEN = '(?:unrecognized|unknown|unsupported|not supported|extra (?:inputs?|fields?|arguments?)|not permitted|not allowed|unexpected|invalid (?:parameter|field|argument|key)|no such|does not support|doesn.t support)';
export function lessonFrom(detail, body) {
  const text = String(detail || '');
  const b = body && typeof body === 'object' ? body : {};
  let allowed = null;
  const m = OFFERS.exec(text);
  if (m) {
    const refused = [b.reasoning_effort, b.reasoning && b.reasoning.effort].filter((x) => typeof x === 'string');
    const words = [...new Set((text.slice(m.index).toLowerCase().match(/[a-z]+/g) || []).filter((w) => EFFORT_WORDS.includes(w) && !refused.includes(w)))];
    if (words.length) allowed = EFFORT_WORDS.filter((w) => words.includes(w));
  }
  let badField = null;
  for (const f of ['thinking', 'enable_thinking', 'reasoning_effort', 'reasoning', 'chat_template_kwargs', 'model_options', 'output_config']) {
    if (!(f in b)) continue;
    const near = new RegExp(NOT_TAKEN + '[^.]{0,80}["\'`]?\\b' + f + '\\b(?!_)|\\b' + f + '\\b(?!_)["\'`]?[^.]{0,80}' + NOT_TAKEN, 'i');
    if (near.test(text)) { badField = f; break; }
  }
  return { allowed, badField };
}
export function fitEffort(value, allowed, isOff = false) {
  if (!Array.isArray(allowed) || !allowed.length) return value;
  const thinking = EFFORT_RANK.filter((l) => l !== 'off' && allowed.includes(l));
  if (isOff || value === 'none' || value === 'off') return allowed.includes('none') ? 'none' : (thinking[0] || allowed[0]);
  if (allowed.includes(value)) return value;
  const r = EFFORT_RANK.indexOf(value);
  let best = '';
  for (const l of thinking) if (EFFORT_RANK.indexOf(l) <= r) best = l;
  return best || thinking[0] || allowed.find((a) => a !== 'none') || value;
}

export const THINKING_FIELDS = ['thinking', 'reasoning_effort', 'reasoning', 'enable_thinking', 'model_options', 'output_config'];
export const REASONING_REFUSAL = /reasoning|effort|thinking|budget_tokens|enable_thinking/i;

/* The OpenAI-shaped house's thinking fields for a level (Tavern requestBody). */
export function thinkingFields(conn, level) {
  const set = level === false || level === 'none' ? 'off' : level;
  if (set === undefined || set === null || set === '' || !EFFORT_RANK.includes(set)) return {};
  const style = familyStyle(conn);
  const effort = effortFor(style, set);
  const b = {};
  if (style === 'none') return b;
  if (style === 'openrouter') {
    const budget = budgetFor(conn).tokens;
    b.reasoning = effort === 'off' ? { enabled: false } : (budget ? { max_tokens: budget } : { effort });
  } else if (style === 'zai') {
    const w = zaiWire(effort, glmVersion(conn));
    b.thinking = w.thinking;
    if (w.reasoning_effort) b.reasoning_effort = w.reasoning_effort;
  } else if (style === 'qwen') {
    b.enable_thinking = effort !== 'off';
  } else if (style === 'hermes') {
    if (effort !== 'off') b.model_options = { reasoning: { enabled: true, effort } };
  } else if (style === 'kimi') {
    if (effort !== 'off') b.reasoning_effort = effort;
  } else if (style === 'kimi2') {
    b.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
  } else if (style === 'deepseek') {
    b.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
    if (effort !== 'off') b.reasoning_effort = effort;
  } else {
    if (effort !== 'off') b.reasoning_effort = effort;
    if (!hostIsOpenAI(conn && conn.url)) b.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
  }
  return b;
}

/* Does this request make the model think? Then a worker's reply room is
 * raised so the thinking cannot eat the answer (M315). Only ever raised. */
function thinks(conn) {
  const t = conn.thinking;
  if (t === 'off' || t === false || t === 'none') return cannotStopThinking(conn);
  if (EFFORT_RANK.includes(t)) return true;
  return alwaysThinks(conn.model) || cannotStopThinking(conn);
}

function applyThinking(body, conn, house) {
  const t = conn.thinking === false || conn.thinking === 'none' ? 'off' : conn.thinking;
  const said = t !== undefined && t !== null && t !== '' && EFFORT_RANK.includes(t);
  const learned = said ? learnedFacts(conn) : null;
  if (said && learned && learned.down) {
    /* refused within the last day: nothing is spent on it again today */
  } else if (house === 'anthropic') {
    if (said) {
      const effort = effortFor('anthropic', t);
      const on = effort !== 'off';
      const url = String(conn.url || '') + ' ' + String(conn.model || '');
      if (/deepseek/i.test(url)) {
        /* M37: DeepSeek behind the Anthropic shape takes reasoning:{effort}, none disables */
        const ladder = { off: 'none', low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' };
        body.reasoning = { effort: ladder[effort] || 'none' };
        if (on) { body.temperature = 1; delete body.top_p; }
      } else if (on) {
        const budget = budgetFor(conn).tokens;
        if (budget) {
          body.thinking = { type: 'enabled', budget_tokens: budget };
          if (body.max_tokens <= budget) body.max_tokens = budget + 4096;
        } else {
          /* adaptive thinking with an effort level — the full ladder */
          body.thinking = { type: 'adaptive' };
          body.output_config = { effort };
        }
        /* Claude takes no other temperature while it thinks, and no top-p. */
        body.temperature = 1;
        delete body.top_p;
      }
    }
  } else if (said) {
    Object.assign(body, thinkingFields(conn, t));
  }
  if (learned && !learned.down) {
    const style = familyStyle(conn);
    if (t === 'off' && learned.offThinks && style !== 'hermes') {
      const least = learned.efforts ? fitEffort('low', learned.efforts) : 'low';
      if ('thinking' in body) body.thinking = { type: 'enabled' };
      if ('enable_thinking' in body) body.enable_thinking = true;
      if (style === 'openrouter') body.reasoning = { effort: least };
      else body.reasoning_effort = least;
    }
    for (const f of learned.drop) delete body[f];
    if (learned.efforts) {
      if (typeof body.reasoning_effort === 'string') body.reasoning_effort = fitEffort(body.reasoning_effort, learned.efforts, t === 'off' && !learned.offThinks);
      if (body.reasoning && typeof body.reasoning.effort === 'string') body.reasoning.effort = fitEffort(body.reasoning.effort, learned.efforts);
    }
  }
  if (house !== 'anthropic' && thinks(conn)) {
    for (const k of ['max_tokens', 'max_completion_tokens']) {
      if (body[k] !== undefined) body[k] = Math.max(body[k], ALWAYS_THINKS_FLOOR);
    }
  }
}

/* The same request with every thinking field taken off. */
export function withoutThinking(body) {
  const b = { ...body };
  for (const f of THINKING_FIELDS) delete b[f];
  return b;
}

/* How the chosen level is actually spoken on this wire, in words — for the
 * connection's "Try it". */
export function spokenAs(conn) {
  const probe = { max_tokens: 1000 };
  applyThinking(probe, { ...conn }, houseOf(conn.url));
  const shown = {};
  for (const k of [...THINKING_FIELDS, 'temperature']) if (k in probe) shown[k] = probe[k];
  return Object.keys(shown).length ? JSON.stringify(shown) : 'nothing about thinking is sent — the provider decides';
}

/* Build the request one house understands. */
export function buildRequest(conn, { system, messages, maxTokens, room = 512, stream = false }) {
  const house = houseOf(conn.url);
  const body = {};
  const limit = Number.isFinite(maxTokens) ? Math.round(maxTokens) : null;

  if (house === 'anthropic') {
    body.model = conn.model;
    body.max_tokens = limit || 4096;
    if (system) body.system = system;
    body.messages = messages.map((m) => ({ role: m.role, content: m.content }));
  } else {
    body.model = conn.model;
    const list = [];
    if (system) list.push({ role: 'system', content: system });
    for (const m of messages) list.push({ role: m.role, content: m.content });
    body.messages = list;
    if (limit) body.max_tokens = limit;
  }

  /* Only what the writer set. */
  if (Number.isFinite(conn.temperature)) body.temperature = conn.temperature;
  if (Number.isFinite(conn.topP)) body.top_p = conn.topP;
  applyThinking(body, conn, house);
  if (stream) body.stream = true;

  return { url: endpoint(conn), headers: headersFor(conn), body, house };
}

/* Pull the answer out, whichever shape came back. Thinking is kept on its own
 * channel so the answer text is only ever the answer. */
export function readAnswer(house, data) {
  if (!data || typeof data !== 'object') return { text: '', thinking: '', finish: 'empty' };
  if (data.error) {
    const d = data.detail || data.error;
    return { text: '', thinking: '', finish: 'error', error: typeof d === 'string' ? d : JSON.stringify(d) };
  }
  if (house === 'anthropic') {
    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('');
    const thinking = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking || '').join('');
    return { text, thinking, finish: data.stop_reason || 'stop' };
  }
  const choice = (data.choices && data.choices[0]) || {};
  const msg = choice.message || {};
  const text = typeof msg.content === 'string'
    ? msg.content
    : Array.isArray(msg.content) ? msg.content.map((c) => c.text || '').join('') : '';
  const thinking = msg.reasoning_content || msg.reasoning || '';
  return { text, thinking, finish: choice.finish_reason || 'stop' };
}

/* One streamed chunk, whichever shape. Returns {text, thinking}. */
/* A reply the provider cut short at its limit says so (Cozy Tavern M244,
 * M246: a line the wire cut was stored as a finished line, and only the
 * writer could tell). */
export function readChunk(house, obj) {
  if (!obj) return null;
  if (house === 'anthropic') {
    if (obj.type === 'content_block_delta') {
      const d = obj.delta || {};
      if (d.type === 'text_delta') return { text: d.text || '', thinking: '' };
      if (d.type === 'thinking_delta') return { text: '', thinking: d.thinking || '' };
    }
    if (obj.type === 'message_delta' && obj.delta && obj.delta.stop_reason === 'max_tokens') return { text: '', thinking: '', cut: true };
    return null;
  }
  const choice = (obj.choices && obj.choices[0]) || {};
  const d = choice.delta || {};
  const text = typeof d.content === 'string' ? d.content : '';
  const thinking = d.reasoning_content || d.reasoning || '';
  const cut = choice.finish_reason === 'length';
  if (!text && !thinking && !cut) return null;
  return cut ? { text, thinking, cut } : { text, thinking };
}
