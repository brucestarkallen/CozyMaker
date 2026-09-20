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

/* How each house spells "do not think" and "think this much". Only spoken
 * when the connection actually says something about thinking. */
function applyThinking(body, conn, house, room) {
  const t = conn.thinking;
  if (t === undefined || t === null || t === '') {
    /* The writer said nothing. Say nothing — except where saying nothing
     * corrupts the answer: a model that always thinks needs room left over. */
    if (alwaysThinks(conn.model) && body.max_tokens !== undefined) {
      body.max_tokens = Math.max(body.max_tokens, ALWAYS_THINKS_FLOOR);
    } else if (alwaysThinks(conn.model) && body.max_completion_tokens !== undefined) {
      body.max_completion_tokens = Math.max(body.max_completion_tokens, ALWAYS_THINKS_FLOOR);
    }
    return;
  }
  const off = t === 'off' || t === false || t === 'none';
  if (house === 'anthropic') {
    if (off) return;                       /* no thinking block at all */
    const budget = Number(conn.thinkingBudget) || 4000;
    body.thinking = { type: 'enabled', budget_tokens: budget };
    body.max_tokens = Math.max(body.max_tokens || 0, budget + room);
    return;
  }
  if (house === 'zai') { body.thinking = { type: off ? 'disabled' : 'enabled' }; return; }
  if (house === 'openrouter') {
    body.reasoning = off ? { enabled: false } : { effort: String(t) };
    return;
  }
  if (house === 'qwen') { body.enable_thinking = !off; return; }
  if (house === 'moonshot' || house === 'deepseek' || house === 'openai') {
    if (off) { body.reasoning_effort = 'minimal'; return; }
    body.reasoning_effort = String(t);
  }
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
export function readChunk(house, obj) {
  if (!obj) return null;
  if (house === 'anthropic') {
    if (obj.type === 'content_block_delta') {
      const d = obj.delta || {};
      if (d.type === 'text_delta') return { text: d.text || '', thinking: '' };
      if (d.type === 'thinking_delta') return { text: '', thinking: d.thinking || '' };
    }
    return null;
  }
  const d = (obj.choices && obj.choices[0] && obj.choices[0].delta) || {};
  const text = typeof d.content === 'string' ? d.content : '';
  const thinking = d.reasoning_content || d.reasoning || '';
  if (!text && !thinking) return null;
  return { text, thinking };
}
