import http from 'node:http';
import crypto from 'node:crypto';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const ID_RE = /^[a-zA-Z0-9_-]+$/;
const NAME_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : null); } catch { resolve(undefined); }
    });
  });
}

function listen(server) {
  return new Promise((resolve) => { server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
}

function anthropicError(res, status, type, message, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'request-id': 'req_mock', ...extra });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
}

export function legacyModel(id) {
  return /haiku-4-5|sonnet-4-5|3-/.test(id);
}

export function validateAnthropic(body, issued) {
  if (!body || typeof body !== 'object') return 'Request body must be JSON.';
  if (typeof body.model !== 'string' || !body.model) return 'model: Field required';
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) return 'max_tokens: Field required';
  if (body.system !== undefined && typeof body.system !== 'string' && !(Array.isArray(body.system) && body.system.every(b => b?.type === 'text' && typeof b.text === 'string'))) return 'system: Input should be a valid string or a list of text blocks';
  const msgs = body.messages;
  if (!Array.isArray(msgs) || !msgs.length) return 'messages: at least one message is required';
  if (msgs[0].role !== 'user') return 'messages: first message must use the "user" role';
  if (msgs[msgs.length - 1].role !== 'user') return 'This model does not support assistant message prefill. The conversation must end with a user message.';
  const legacy = legacyModel(body.model);
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== 'user' && m.role !== 'assistant') return `messages.${i}.role: Input should be 'user' or 'assistant'`;
    if (i && msgs[i - 1].role === m.role) return `messages.${i}: roles must alternate (mock strict mode)`;
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    if (!Array.isArray(blocks) || !blocks.length) return `messages.${i}.content: must not be empty`;
    for (let j = 0; j < blocks.length; j++) {
      const b = blocks[j];
      const at = `messages.${i}.content.${j}`;
      const allowed = m.role === 'user' ? ['text', 'image', 'tool_result'] : ['text', 'thinking', 'redacted_thinking', 'tool_use'];
      if (!allowed.includes(b?.type)) return `${at}.type: '${b?.type}' is not allowed in a ${m.role} message`;
      if (b.type === 'text' && !String(b.text || '').trim()) return `${at}.text: text content blocks must be non-empty`;
      if (b.type === 'image') {
        const s = b.source || {};
        if (s.type === 'base64' && (!IMAGE_TYPES.has(s.media_type) || !s.data)) return `${at}.source: invalid base64 image`;
        if (s.type === 'url' && !/^https?:\/\//.test(s.url || '')) return `${at}.source.url: invalid url`;
        if (s.type !== 'base64' && s.type !== 'url') return `${at}.source.type: invalid`;
      }
      if (b.type === 'tool_use') {
        if (!ID_RE.test(b.id || '')) return `${at}.id: String should match pattern '^[a-zA-Z0-9_-]+$'`;
        if (!b.input || typeof b.input !== 'object' || Array.isArray(b.input)) return `${at}.input: Input should be a valid dictionary`;
      }
      if (b.type === 'thinking') {
        const sig = issued.get(b.signature);
        if (!sig) return `${at}: Invalid \`signature\` in \`thinking\` block.`;
        if (sig.system !== JSON.stringify(body.system ?? null)) return `${at}: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation.`;
      }
    }
    if (m.role === 'assistant') {
      const ids = blocks.filter(b => b.type === 'tool_use').map(b => b.id);
      if (ids.length && body.thinking?.type === 'enabled' && legacy && i === msgs.length - 2 && blocks[0].type !== 'thinking' && blocks[0].type !== 'redacted_thinking') {
        return `messages.${i}.content.0.type: Expected \`thinking\` or \`redacted_thinking\`, but found \`${blocks[0].type}\`. When \`thinking\` is enabled, a final \`assistant\` message must start with a thinking block.`;
      }
      if (ids.length) {
        const next = msgs[i + 1];
        const nb = typeof next?.content === 'string' ? [] : (next?.content || []);
        const lead = [];
        for (const b of nb) { if (b.type !== 'tool_result') break; lead.push(b.tool_use_id); }
        const missing = ids.filter(id => !lead.includes(id));
        if (missing.length) return `messages.${i}: \`tool_use\` ids were found without \`tool_result\` blocks immediately after: ${missing.join(', ')}`;
      }
    }
    if (m.role === 'user' && Array.isArray(m.content)) {
      const prev = msgs[i - 1];
      const open = new Set(prev?.role === 'assistant' && Array.isArray(prev.content) ? prev.content.filter(b => b.type === 'tool_use').map(b => b.id) : []);
      for (const b of m.content) if (b.type === 'tool_result' && !open.has(b.tool_use_id)) return `messages.${i}: unexpected \`tool_use_id\` found in \`tool_result\` blocks: ${b.tool_use_id}`;
    }
  }
  if (body.thinking) {
    const t = body.thinking;
    if (t.type === 'enabled') {
      if (!legacy) return 'thinking.type.enabled is not supported for this model. Use thinking.type.adaptive and output_config.effort to control thinking behavior.';
      if (!(t.budget_tokens >= 1024) || t.budget_tokens >= body.max_tokens) return 'thinking.budget_tokens: must be >= 1024 and less than max_tokens';
      if (body.temperature !== undefined && body.temperature !== 1) return '`temperature` may only be set to 1 when thinking is enabled.';
    } else if (t.type === 'adaptive') {
      if (legacy) return 'thinking.type.adaptive is not supported for this model.';
    } else return 'thinking.type: invalid';
  }
  if (!legacy) for (const k of ['temperature', 'top_p', 'top_k']) if (k in body) return `\`${k}\` is deprecated for this model.`;
  if ('temperature' in body && (body.temperature < 0 || body.temperature > 1)) return 'temperature: Input should be less than or equal to 1';
  if (body.stop_sequences !== undefined && (!Array.isArray(body.stop_sequences) || body.stop_sequences.some(s => typeof s !== 'string'))) return 'stop_sequences: Input should be a valid list';
  if (body.output_config && !EFFORTS.has(body.output_config.effort)) return 'output_config.effort: invalid';
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) return 'tools: Input should be a valid list';
    for (let i = 0; i < body.tools.length; i++) {
      const t = body.tools[i];
      if (!NAME_RE.test(t.name || '')) return `tools.${i}.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'`;
      if (t.input_schema?.type !== 'object') return `tools.${i}.input_schema.type: Input should be 'object'`;
      if ('parameters' in t || 'function' in t) return `tools.${i}: Extra inputs are not permitted`;
    }
  }
  for (const k of Object.keys(body)) {
    if (!['model', 'max_tokens', 'messages', 'system', 'stream', 'temperature', 'top_p', 'top_k', 'stop_sequences', 'thinking', 'output_config', 'tools', 'tool_choice', 'metadata', 'cache_control', 'fallbacks'].includes(k)) {
      return `${k}: Extra inputs are not permitted`;
    }
  }
  return null;
}

const strip = (v) => JSON.stringify(v, (k, x) => (k === 'cache_control' ? undefined : x));
const systemText = (s) => (Array.isArray(s) ? s.map(b => b.text).join('\n\n') : (s || ''));

// Prompt caching as the API applies it: a prefix written by one request is read back by
// a later request that starts with the same bytes. Segments are the tool list, the
// system prompt and each message, in render order.
export function simulateCache(body, store) {
  const segs = [strip(body.tools || []), systemText(body.system), ...body.messages.map(strip)];
  const keys = segs.map((_, i) => strip(segs.slice(0, i + 1)));
  const size = (from, to) => segs.slice(from, to + 1).reduce((n, s) => n + Math.ceil(s.length / 4), 0);
  const marks = [];
  if (body.tools?.some(t => t.cache_control)) marks.push(0);
  if (Array.isArray(body.system) && body.system.some(b => b.cache_control)) marks.push(1);
  if (body.cache_control) marks.push(segs.length - 1);
  let hit = -1;
  for (let i = keys.length - 1; i >= 0; i--) if (store.has(keys[i])) { hit = i; break; }
  const top = marks.length ? Math.max(...marks) : -1;
  for (const m of marks) store.add(keys[m]);
  const read = hit >= 0 ? size(0, hit) : 0;
  const write = top > hit ? size(hit + 1, top) : 0;
  return { input_tokens: size(0, segs.length - 1) - read - write, cache_read_input_tokens: read, cache_creation_input_tokens: write };
}

export function anthropicTurn({ thinking = '', text = '', tools = [], stop, usage = {}, chunk = 7 } = {}) {
  const events = [];
  const id = 'msg_' + crypto.randomBytes(6).toString('hex');
  const u = { input_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1, ...usage };
  events.push({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, usage: u } });
  let index = 0;
  const signatures = [];
  if (thinking) {
    const sig = 'sig_' + crypto.randomBytes(8).toString('hex');
    signatures.push(sig);
    events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
    for (let i = 0; i < thinking.length; i += chunk) events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: thinking.slice(i, i + chunk) } });
    events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: sig } });
    events.push({ type: 'content_block_stop', index });
    index++;
  }
  if (text) {
    events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    for (let i = 0; i < text.length; i += chunk) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: text.slice(i, i + chunk) } });
    events.push({ type: 'content_block_stop', index });
    index++;
  }
  for (const t of tools) {
    const json = JSON.stringify(t.input || {});
    events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } });
    for (let i = 0; i < json.length; i += chunk) events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(i, i + chunk) } });
    events.push({ type: 'content_block_stop', index });
    index++;
  }
  events.push({ type: 'message_delta', delta: { stop_reason: stop || (tools.length ? 'tool_use' : 'end_turn'), stop_sequence: null }, usage: { output_tokens: u.output_tokens + 20 } });
  events.push({ type: 'message_stop' });
  return { events, signatures };
}

export async function mockAnthropic({ key = 'sk-ant-test', respond, models = [], rejectCache = false } = {}) {
  const requests = [];
  const issued = new Map();
  const cache = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const headers = req.headers;
    if (headers['x-api-key'] !== key) return anthropicError(res, 401, 'authentication_error', 'invalid x-api-key');
    if (!headers['anthropic-version']) return anthropicError(res, 400, 'invalid_request_error', 'anthropic-version: header is required');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const limit = Number(url.searchParams.get('limit')) || 20;
      const after = url.searchParams.get('after_id');
      const start = after ? models.findIndex(m => m.id === after) + 1 : 0;
      const page = models.slice(start, start + limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: page.map(m => ({ type: 'model', created_at: '2026-01-01T00:00:00Z', display_name: m.id, ...m })), has_more: start + limit < models.length, first_id: page[0]?.id || null, last_id: page[page.length - 1]?.id || null }));
    }
    const one = /^\/v1\/models\/(.+)$/.exec(url.pathname);
    if (req.method === 'GET' && one) {
      const m = models.find(x => x.id === decodeURIComponent(one[1]));
      if (!m) return anthropicError(res, 404, 'not_found_error', 'model: ' + one[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ type: 'model', display_name: m.id, created_at: '2026-01-01T00:00:00Z', ...m }));
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/messages') return anthropicError(res, 404, 'not_found_error', 'Not found');
    const body = await readBody(req);
    const entry = { body, headers, at: Date.now() };
    requests.push(entry);
    const invalid = (rejectCache && /cache_control/.test(JSON.stringify(body)) ? 'cache_control: Extra inputs are not permitted' : null) || validateAnthropic(body, issued);
    if (invalid) { entry.rejected = invalid; return anthropicError(res, 400, 'invalid_request_error', invalid); }
    const out = await respond(body, requests.length - 1, entry);
    if (out.status) return anthropicError(res, out.status, out.type || 'api_error', out.message || 'error', out.headers || {});
    entry.cache = simulateCache(body, cache);
    const turn = out.events ? out : anthropicTurn({ ...out, usage: { ...entry.cache, ...(out.usage || {}) } });
    for (const s of turn.signatures || []) issued.set(s, { system: JSON.stringify(body.system ?? null) });
    if (!body.stream) {
      const content = [];
      for (const e of turn.events) {
        if (e.type === 'content_block_start') content[e.index] = { ...e.content_block };
        if (e.type === 'content_block_delta') {
          const b = content[e.index];
          if (e.delta.type === 'text_delta') b.text += e.delta.text;
          if (e.delta.type === 'thinking_delta') b.thinking += e.delta.thinking;
          if (e.delta.type === 'signature_delta') b.signature = e.delta.signature;
          if (e.delta.type === 'input_json_delta') b.partial = (b.partial || '') + e.delta.partial_json;
        }
      }
      for (const b of content) if (b?.type === 'tool_use') { b.input = JSON.parse(b.partial || '{}'); delete b.partial; }
      const start = turn.events.find(e => e.type === 'message_start').message;
      const delta = turn.events.find(e => e.type === 'message_delta');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ...start, content, stop_reason: delta.delta.stop_reason, usage: { ...start.usage, ...delta.usage } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const e of turn.events) {
      if (res.destroyed) return;
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      if (out.delayMs) await new Promise(r => { setTimeout(r, out.delayMs); });
    }
    res.end();
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, requests, issued, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

function currentTurn(messages) {
  let last = -1;
  messages.forEach((m, i) => { if (m.role === 'user') last = i; });
  return messages.slice(last + 1);
}

function replayRule(body, { signatures = null, reasoningContent = false, details = null } = {}) {
  for (const m of currentTurn(body.messages)) {
    if (m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    if (signatures) {
      for (const c of m.tool_calls) {
        if (!signatures.has(c.extra_content?.google?.thought_signature)) return { message: `Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly. Additional data, function call \`${c.function?.name}\`, position 2.`, param: null };
      }
    }
    if (reasoningContent && body.tools?.length && !String(m.reasoning_content || '').trim()) {
      return { message: 'The `reasoning_content` in the thinking mode must be passed back to the API.', param: null };
    }
    if (details && !(Array.isArray(m.reasoning_details) && m.reasoning_details.some(d => details.has(d.signature)))) {
      return { message: 'messages: thinking blocks are missing from the assistant turn that called a tool', param: null };
    }
  }
  return null;
}

export function validateOpenAi(body, { rejects = {}, replay = null } = {}) {
  if (!body || typeof body !== 'object') return { message: 'We could not parse the JSON body of your request.' };
  if (typeof body.model !== 'string') return { message: 'you must provide a model parameter', param: 'model' };
  if (!Array.isArray(body.messages) || !body.messages.length) return { message: "'messages' is a required property", param: 'messages' };
  for (const [param, message] of Object.entries(rejects[body.model] || {})) {
    if (param in body) return { message, param, code: 'unsupported_parameter' };
  }
  if (replay) {
    const bad = replayRule(body, replay);
    if (bad) return bad;
  }
  const open = new Set();
  for (let i = 0; i < body.messages.length; i++) {
    const m = body.messages[i];
    if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(m.role)) return { message: `Invalid value: '${m.role}'.`, param: `messages[${i}].role` };
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const c of m.tool_calls) {
        if (c.type !== 'function' || typeof c.function?.name !== 'string' || typeof c.function?.arguments !== 'string') return { message: 'Invalid tool_calls', param: `messages[${i}].tool_calls` };
        open.add(c.id);
      }
    } else if (m.role === 'tool') {
      if (!open.has(m.tool_call_id)) return { message: "Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.", param: `messages[${i}].role` };
    } else if (m.role !== 'tool' && open.size) {
      return { message: "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'.", param: 'messages' };
    }
    if (m.role !== 'tool' && m.role !== 'assistant') open.clear();
    if (m.role === 'tool') open.delete(m.tool_call_id);
  }
  if (body.tools) {
    for (let i = 0; i < body.tools.length; i++) {
      const t = body.tools[i];
      if (t.type !== 'function' || !NAME_RE.test(t.function?.name || '')) return { message: `Invalid 'tools[${i}].function.name'`, param: `tools[${i}].function.name` };
    }
  }
  if ('temperature' in body && (body.temperature < 0 || body.temperature > 2)) return { message: 'Invalid temperature', param: 'temperature' };
  return null;
}

function reasoningDelta(dialect, piece, i, signature) {
  if (dialect === 'mistral') return { content: [{ type: 'thinking', thinking: [{ type: 'text', text: piece }] }] };
  if (dialect === 'openrouter') return { reasoning: piece, reasoning_details: [{ type: 'reasoning.text', text: piece, format: 'anthropic-claude-v1', index: 0, ...(signature ? { signature } : {}) }] };
  return { reasoning_content: piece };
}

export function openAiChunks({ reasoning = '', text = '', tools = [], finish, usage = { prompt_tokens: 30, completion_tokens: 12 }, cached = 0, chunk = 6, includeUsage = true, dialect = '', sign = null, detailSignature = '' } = {}) {
  const id = 'chatcmpl-' + crypto.randomBytes(5).toString('hex');
  const base = { id, object: 'chat.completion.chunk', created: 1, model: 'mock' };
  const out = [{ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }];
  for (let i = 0; i < reasoning.length; i += chunk) {
    const last = i + chunk >= reasoning.length;
    out.push({ ...base, choices: [{ index: 0, delta: reasoningDelta(dialect, reasoning.slice(i, i + chunk), i, last ? detailSignature : ''), finish_reason: null }] });
  }
  for (let i = 0; i < text.length; i += chunk) out.push({ ...base, choices: [{ index: 0, delta: { content: text.slice(i, i + chunk) }, finish_reason: null }] });
  tools.forEach((t, idx) => {
    const args = JSON.stringify(t.input || {});
    const extra = sign ? { extra_content: { google: { thought_signature: sign(t) } } } : {};
    out.push({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: idx, id: t.id, type: 'function', function: { name: t.name, arguments: '' }, ...extra }] }, finish_reason: null }] });
    for (let i = 0; i < args.length; i += chunk) out.push({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: idx, function: { arguments: args.slice(i, i + chunk) } }] }, finish_reason: null }] });
  });
  out.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish || (tools.length ? 'tool_calls' : 'stop') }] });
  if (includeUsage) out.push({ ...base, choices: [], usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens, prompt_tokens_details: { cached_tokens: cached } } });
  return out;
}

export async function mockOpenAi({ key = 'sk-test', respond, models = [], rejects = {}, prefix = '', dialect = '', signatures = false, reasoningContent = false, details = false } = {}) {
  const requests = [];
  const issued = { signatures: new Set(), details: new Set() };
  const replay = (signatures || reasoningContent || details)
    ? { signatures: signatures ? issued.signatures : null, reasoningContent, details: details ? issued.details : null }
    : null;
  const sign = signatures ? () => { const s = 'sig_' + crypto.randomBytes(6).toString('hex'); issued.signatures.add(s); return s; } : null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const fail = (status, message, param = null, code = null) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message, type: status === 401 ? 'invalid_request_error' : 'invalid_request_error', param, code } }));
    };
    if (req.headers.authorization !== 'Bearer ' + key) return fail(401, 'Incorrect API key provided: sk-***. You can find your API key at https://platform.openai.com/account/api-keys.', null, 'invalid_api_key');
    if (req.method === 'GET' && url.pathname.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: models.map(id => ({ id, object: 'model', owned_by: 'mock' })) }));
    }
    if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) return fail(404, 'Not found');
    if (prefix && !url.pathname.startsWith(prefix)) return fail(404, 'Wrong path ' + url.pathname);
    const body = await readBody(req);
    const entry = { body, headers: req.headers };
    requests.push(entry);
    const bad = validateOpenAi(body, { rejects, replay });
    if (bad) { entry.rejected = bad.message; return fail(400, bad.message, bad.param, bad.code); }
    const out = await respond(body, requests.length - 1, entry);
    if (out.status) return fail(out.status, out.message || 'error', out.param || null, out.code || null);
    const detailSignature = details && out.reasoning ? 'ds_' + crypto.randomBytes(6).toString('hex') : '';
    if (detailSignature) issued.details.add(detailSignature);
    const chunks = openAiChunks({ dialect, sign, detailSignature, ...out, includeUsage: !!body.stream_options?.include_usage });
    if (!body.stream) {
      const text = out.text || '';
      const content = dialect === 'mistral' && out.reasoning ? [{ type: 'thinking', thinking: [{ type: 'text', text: out.reasoning }] }, { type: 'text', text }] : text;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: 'chatcmpl-x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const sent = out.streamError ? chunks.filter(c => !c.usage && !c.choices[0]?.finish_reason) : chunks;
    for (const c of sent) {
      if (res.destroyed) return;
      res.write('data: ' + JSON.stringify(c) + '\n\n');
      if (out.delayMs) await new Promise(r => { setTimeout(r, out.delayMs); });
    }
    if (out.streamError) {
      res.write('data: ' + JSON.stringify({ error: { code: 500, message: out.streamError, type: 'server_error' } }) + '\n\n');
      return res.end();
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

const RESPONSES_KEYS = new Set(['model', 'input', 'instructions', 'stream', 'store', 'temperature', 'top_p', 'max_output_tokens', 'tools', 'tool_choice',
  'parallel_tool_calls', 'reasoning', 'text', 'include', 'metadata', 'truncation', 'user', 'previous_response_id', 'prompt_cache_key', 'service_tier']);

export function validateResponses(body, { rejects = {}, efforts = {}, issued = new Map() } = {}) {
  if (!body || typeof body !== 'object') return { message: 'We could not parse the JSON body of your request.' };
  if (typeof body.model !== 'string' || !body.model) return { message: "Missing required parameter: 'model'.", param: 'model' };
  for (const k of Object.keys(body)) if (!RESPONSES_KEYS.has(k)) return { message: `Unsupported parameter: '${k}'.`, param: k, code: 'unsupported_parameter' };
  for (const [param, message] of Object.entries(rejects[body.model] || {})) {
    const present = param.split('.').reduce((at, k) => (at && typeof at === 'object' && k in at ? at[k] : undefined), body) !== undefined;
    if (present) return { message, param, code: 'unsupported_parameter' };
  }
  const allowed = efforts[body.model];
  if (body.reasoning !== undefined) {
    if (!body.reasoning || typeof body.reasoning !== 'object') return { message: "Invalid type for 'reasoning'.", param: 'reasoning' };
    if (allowed && body.reasoning.effort !== undefined && !allowed.includes(body.reasoning.effort)) {
      return { message: `Unsupported value: '${body.reasoning.effort}' is not supported with the '${body.model}' model. Supported values are: ${allowed.map(v => `'${v}'`).join(', ')}.`, param: 'reasoning.effort', code: 'unsupported_value' };
    }
    if (body.reasoning.summary !== undefined && !['auto', 'concise', 'detailed'].includes(body.reasoning.summary)) return { message: "Invalid value for 'reasoning.summary'.", param: 'reasoning.summary' };
  }
  if (body.include !== undefined && (!Array.isArray(body.include) || body.include.some(v => v !== 'reasoning.encrypted_content'))) return { message: "Invalid value for 'include'.", param: 'include' };
  const input = body.input;
  if (!(typeof input === 'string' && input) && !(Array.isArray(input) && input.length)) return { message: "Missing required parameter: 'input'.", param: 'input' };
  if (Array.isArray(input)) {
    const calls = new Set();
    const answered = new Set();
    for (let i = 0; i < input.length; i++) {
      const it = input[i];
      const at = `input[${i}]`;
      if (it?.type === 'function_call') {
        if (typeof it.call_id !== 'string' || !it.call_id || typeof it.name !== 'string' || typeof it.arguments !== 'string') return { message: `Invalid '${at}': function_call needs call_id, name and string arguments.`, param: at };
        calls.add(it.call_id);
      } else if (it?.type === 'function_call_output') {
        if (!calls.has(it.call_id)) return { message: `No tool call found for function call output with call_id ${it.call_id}.`, param: 'input' };
        if (typeof it.output !== 'string') return { message: `Invalid type for '${at}.output'.`, param: `${at}.output` };
        answered.add(it.call_id);
      } else if (it?.type === 'reasoning') {
        const known = issued.get(it.id);
        if (!known || known.encrypted !== it.encrypted_content) return { message: `The encrypted content for item ${it.id} could not be verified.`, param: 'input' };
        const next = input[i + 1];
        if (!next || (next.type !== 'function_call' && next.type !== 'reasoning' && next.role !== 'assistant')) return { message: `Item '${it.id}' of type 'reasoning' was provided without its required following item.`, param: 'input' };
      } else if (it?.type === undefined || it?.type === 'message') {
        if (!['user', 'assistant', 'system', 'developer'].includes(it?.role)) return { message: `Invalid value: '${it?.role}'. Supported values are: 'user', 'assistant', 'system', and 'developer'.`, param: `${at}.role` };
        if (Array.isArray(it.content)) {
          for (let j = 0; j < it.content.length; j++) {
            const p = it.content[j];
            const ok = it.role === 'assistant' ? ['output_text', 'refusal'] : ['input_text', 'input_image', 'input_file'];
            if (!ok.includes(p?.type)) return { message: `Invalid value: '${p?.type}'. Supported values are: ${ok.map(v => `'${v}'`).join(', ')}.`, param: `${at}.content[${j}].type` };
            if (p.type === 'input_image' && !/^(data:image\/(png|jpeg|gif|webp);base64,|https?:\/\/)/.test(p.image_url || '')) return { message: `Invalid '${at}.content[${j}].image_url'.`, param: `${at}.content[${j}].image_url` };
          }
        } else if (typeof it.content !== 'string') return { message: `Invalid type for '${at}.content'.`, param: `${at}.content` };
      } else return { message: `Invalid value: '${it?.type}'.`, param: `${at}.type` };
    }
    for (const id of calls) if (!answered.has(id)) return { message: `No tool output found for function call ${id}.`, param: 'input' };
  }
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) return { message: "Invalid type for 'tools'.", param: 'tools' };
    for (let i = 0; i < body.tools.length; i++) {
      const t = body.tools[i];
      if ('function' in t) return { message: `Missing required parameter: 'tools[${i}].name'.`, param: `tools[${i}].name` };
      if (t.type !== 'function' || !NAME_RE.test(t.name || '')) return { message: `Invalid 'tools[${i}].name'.`, param: `tools[${i}].name` };
      if (!t.parameters || t.parameters.type !== 'object') return { message: `Invalid schema for function '${t.name}'.`, param: `tools[${i}].parameters` };
    }
  }
  if ('temperature' in body && (body.temperature < 0 || body.temperature > 2)) return { message: 'Invalid temperature', param: 'temperature' };
  return null;
}

export function responsesEvents({ reasoning = '', text = '', tools = [], incomplete = '', usage = { input_tokens: 30, output_tokens: 12 }, cached = 0, chunk = 6, encrypt = false, summaryParts = 1 } = {}, issued = new Map()) {
  const events = [];
  const output = [];
  const id = 'resp_' + crypto.randomBytes(6).toString('hex');
  let seq = 0;
  const push = (e) => events.push({ ...e, sequence_number: seq++ });
  push({ type: 'response.created', response: { id, object: 'response', status: 'in_progress', output: [] } });
  if (reasoning) {
    const index = output.length;
    const rid = 'rs_' + crypto.randomBytes(6).toString('hex');
    push({ type: 'response.output_item.added', output_index: index, item: { id: rid, type: 'reasoning', summary: [] } });
    const parts = summaryParts > 1 ? [reasoning.slice(0, Math.ceil(reasoning.length / 2)), reasoning.slice(Math.ceil(reasoning.length / 2))] : [reasoning];
    parts.forEach((part, si) => {
      push({ type: 'response.reasoning_summary_part.added', item_id: rid, output_index: index, summary_index: si, part: { type: 'summary_text', text: '' } });
      for (let i = 0; i < part.length; i += chunk) push({ type: 'response.reasoning_summary_text.delta', item_id: rid, output_index: index, summary_index: si, delta: part.slice(i, i + chunk) });
      push({ type: 'response.reasoning_summary_text.done', item_id: rid, output_index: index, summary_index: si, text: part });
    });
    const item = { id: rid, type: 'reasoning', summary: parts.map(p => ({ type: 'summary_text', text: p })) };
    if (encrypt) { item.encrypted_content = 'enc_' + crypto.randomBytes(8).toString('hex'); issued.set(rid, { encrypted: item.encrypted_content }); }
    push({ type: 'response.output_item.done', output_index: index, item });
    output.push(item);
  }
  if (text) {
    const index = output.length;
    const mid = 'msg_' + crypto.randomBytes(6).toString('hex');
    push({ type: 'response.output_item.added', output_index: index, item: { id: mid, type: 'message', role: 'assistant', status: 'in_progress', content: [] } });
    push({ type: 'response.content_part.added', item_id: mid, output_index: index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    for (let i = 0; i < text.length; i += chunk) push({ type: 'response.output_text.delta', item_id: mid, output_index: index, content_index: 0, delta: text.slice(i, i + chunk) });
    push({ type: 'response.output_text.done', item_id: mid, output_index: index, content_index: 0, text });
    const item = { id: mid, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
    push({ type: 'response.output_item.done', output_index: index, item });
    output.push(item);
  }
  for (const t of tools) {
    const index = output.length;
    const fid = 'fc_' + crypto.randomBytes(6).toString('hex');
    const args = JSON.stringify(t.input || {});
    push({ type: 'response.output_item.added', output_index: index, item: { id: fid, type: 'function_call', status: 'in_progress', call_id: t.id, name: t.name, arguments: '' } });
    for (let i = 0; i < args.length; i += chunk) push({ type: 'response.function_call_arguments.delta', item_id: fid, output_index: index, delta: args.slice(i, i + chunk) });
    push({ type: 'response.function_call_arguments.done', item_id: fid, output_index: index, arguments: args });
    const item = { id: fid, type: 'function_call', status: 'completed', call_id: t.id, name: t.name, arguments: args };
    push({ type: 'response.output_item.done', output_index: index, item });
    output.push(item);
  }
  const u = { input_tokens: usage.input_tokens, input_tokens_details: { cached_tokens: cached }, output_tokens: usage.output_tokens, output_tokens_details: { reasoning_tokens: reasoning ? 8 : 0 }, total_tokens: usage.input_tokens + usage.output_tokens };
  const response = { id, object: 'response', status: incomplete ? 'incomplete' : 'completed', incomplete_details: incomplete ? { reason: incomplete } : null, output, usage: u };
  push({ type: incomplete ? 'response.incomplete' : 'response.completed', response });
  return { events, response };
}

export async function mockResponses({ key = 'sk-test', respond, models = [], rejects = {}, efforts = {} } = {}) {
  const requests = [];
  const issued = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const fail = (status, message, param = null, code = null) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message, type: 'invalid_request_error', param, code } }));
    };
    if (req.headers.authorization !== 'Bearer ' + key) return fail(401, 'Incorrect API key provided: sk-***. You can find your API key at https://platform.openai.com/account/api-keys.', null, 'invalid_api_key');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: models.map(id => ({ id, object: 'model', owned_by: 'mock' })) }));
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') return fail(400, 'Use the Responses API for function calling.', null, 'unsupported_api');
    if (req.method !== 'POST' || url.pathname !== '/v1/responses') return fail(404, 'Not found');
    const body = await readBody(req);
    const entry = { body, headers: req.headers };
    requests.push(entry);
    const bad = validateResponses(body, { rejects, efforts, issued });
    if (bad) { entry.rejected = bad.message; return fail(400, bad.message, bad.param, bad.code); }
    const out = await respond(body, requests.length - 1, entry);
    if (out.status) return fail(out.status, out.message || 'error', out.param || null, out.code || null);
    const encrypt = Array.isArray(body.include) && body.include.includes('reasoning.encrypted_content');
    const { events, response } = responsesEvents({ ...out, encrypt }, issued);
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(response));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const e of events) {
      if (res.destroyed) return;
      if (out.streamError && (e.type === 'response.completed' || e.type === 'response.incomplete')) {
        const failed = { type: 'response.failed', sequence_number: e.sequence_number, response: { ...e.response, status: 'failed', error: { code: 'server_error', message: out.streamError } } };
        res.write(`event: response.failed\ndata: ${JSON.stringify(failed)}\n\n`);
        break;
      }
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      if (out.delayMs) await new Promise(r => { setTimeout(r, out.delayMs); });
    }
    res.end();
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}/v1`, requests, issued, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}