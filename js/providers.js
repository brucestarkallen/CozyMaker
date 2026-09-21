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
  if (u.includes('api.anthropic.com')) return 'anthropic';
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
  if (houseOf(base) === 'anthropic') return base + '/v1/messages';
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

/* THINKING, SPOKEN IN EACH HOUSE'S OWN WORDS.
 *
 * Every spelling below is the one Cozy Tavern proved on the wire, milestone by
 * milestone, and is copied here rather than re-guessed:
 *   M37  — DeepSeek: thinking:{type:enabled|disabled}, reasoning_effort low|high|max
 *   M303 — Kimi K3: top-level reasoning_effort low|high|max ONLY; it always
 *          thinks, so "off" is spoken as its lightest, "low"; never the K2
 *          thinking block
 *   M303 — Kimi K2.x on Moonshot: a switch only; reasoning_effort not taken
 *   M349 — GLM: its generation decides its words
 * The first version of this file sent DeepSeek "off" as reasoning_effort
 * "minimal" — a word DeepSeek does not have — so a worker on a no-thinking
 * DeepSeek connection could fail every single call. */

export const LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

export function thinkingStyle(conn) {
  const url = String(conn.url || '').toLowerCase();
  const model = String(conn.model || '').toLowerCase();
  const kimiHost = url.includes('moonshot') || /(^|[/.])kimi\.(ai|com)([/:]|$)/.test(url);
  if (/kimi[-_.]?k[3-9]/.test(model) || (kimiHost && /^k[3-9]\b/.test(model))) return 'kimi';
  if (kimiHost && /^kimi/.test(model)) return 'kimi2';
  if (url.includes('api.anthropic.com')) return 'anthropic';
  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('bigmodel.cn') || url.includes('z.ai')) return 'zai';
  if (url.includes('deepseek') || /^deepseek/.test(model)) return 'deepseek';
  if (url.includes('dashscope') || /^qwen/.test(model)) return 'qwen';
  return 'openai';
}

function glmVersion(model) {
  const m = /glm[-_]?(\d+(?:\.\d+)?)/i.exec(String(model || ''));
  return m ? parseFloat(m[1]) : null;
}

/* The fields to add for a level, or {} for "say nothing". */
export function thinkingFields(conn, level) {
  const t = level === false || level === 'none' ? 'off' : level;
  if (t === undefined || t === null || t === '' || !LEVELS.includes(t)) return {};
  const off = t === 'off';
  const style = thinkingStyle(conn);
  switch (style) {
    case 'deepseek':
      if (off) return { thinking: { type: 'disabled' } };
      return { thinking: { type: 'enabled' }, reasoning_effort: { low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' }[t] };
    case 'kimi':
      return { reasoning_effort: { off: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' }[t] };
    case 'kimi2':
      return { thinking: { type: off ? 'disabled' : 'enabled' } };
    case 'zai': {
      const v = glmVersion(conn.model);
      if (v !== null && v >= 5.3) return { thinking: { type: 'enabled' }, reasoning_effort: off ? 'low' : t };
      if (v !== null && v < 5.2) return { thinking: { type: off ? 'disabled' : 'enabled' } };
      if (off) return { thinking: { type: 'disabled' } };
      return { thinking: { type: 'enabled' }, reasoning_effort: t === 'low' ? 'high' : t };
    }
    case 'qwen':
      return { enable_thinking: !off };
    case 'openrouter':
      return off ? { reasoning: { enabled: false } } : { reasoning: { effort: t === 'max' || t === 'xhigh' ? 'high' : t } };
    case 'anthropic':
      return {};  /* handled with its budget below */
    default:
      return off ? {} : { reasoning_effort: t === 'max' || t === 'xhigh' ? 'high' : t };
  }
}

export const THINKING_FIELDS = ['thinking', 'reasoning_effort', 'reasoning', 'enable_thinking'];
export const REASONING_REFUSAL = /reasoning|effort|thinking|budget_tokens|enable_thinking/i;

/* A reply budget that thinking cannot eat. A worker's room is the size of its
 * answer; a model that thinks spends that same budget on the thinking first,
 * and the answer comes back empty (Cozy Tavern M315). Only ever raised. */
function thinks(conn) {
  const t = conn.thinking;
  if (t === 'off' || t === false || t === 'none') {
    /* two families cannot be told not to think: Kimi K3, and GLM from 5.3 */
    const style = thinkingStyle(conn);
    if (style === 'kimi') return true;
    if (style === 'zai') { const v = glmVersion(conn.model); return v !== null && v >= 5.3; }
    return false;
  }
  if (LEVELS.includes(t)) return true;
  return alwaysThinks(conn.model);
}

function applyThinking(body, conn, house, room) {
  const t = conn.thinking;
  const said = t !== undefined && t !== null && t !== '';
  if (house === 'anthropic') {
    if (!said || t === 'off' || t === false || t === 'none') return;
    const budget = Number(conn.thinkingBudget) || 4000;
    body.thinking = { type: 'enabled', budget_tokens: budget };
    body.max_tokens = Math.max(body.max_tokens || 0, budget + room);
    return;
  }
  if (said) Object.assign(body, thinkingFields(conn, t));
  if (thinks(conn)) {
    for (const k of ['max_tokens', 'max_completion_tokens']) {
      if (body[k] !== undefined) body[k] = Math.max(body[k], ALWAYS_THINKS_FLOOR);
    }
  }
}

/* The same request with every thinking field taken off — for the one retry a
 * refusal earns. A level the model will not take steps down and goes again,
 * instead of eating the message (Cozy Chat v5.22.1, Cozy Tavern M350). */
export function withoutThinking(body) {
  const b = { ...body };
  for (const f of THINKING_FIELDS) delete b[f];
  return b;
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
  applyThinking(body, conn, house, room);
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
