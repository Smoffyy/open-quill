import Anthropic, { APIError, APIUserAbortError, APIConnectionError } from '@anthropic-ai/sdk';
import { samplingParams } from './sampling.js';
import { safeParse, requestKwargs } from './wire.js';
import { memoFor } from './compat.js';

export const ANTHROPIC_VERSIONED = /\/v1\/?$/;
export const DEFAULT_MAX_TOKENS = 32000;
export const ONESHOT_MAX_TOKENS = 4096;
const MIN_BUDGET = 1024;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const EFFORT_KEYS = new Set(['effort', 'reasoning_effort']);
const RESERVED = new Set(['model', 'messages', 'system', 'stream', 'max_tokens', 'tools', 'thinking', 'output_config']);
const DROPPABLE = ['temperature', 'top_p', 'top_k', 'stop_sequences', 'eager_input_streaming', 'output_config', 'cache_control', 'fallbacks'];
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = /^claude-(?:fable-5-1|opus-5-5|opus-5|sonnet-5-5)(?:$|[-@])/;
const EPHEMERAL = { type: 'ephemeral' };
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
export function anthropicClient({ base, key }) {
  return new Anthropic({
    apiKey: key || '',
    authToken: null,
    baseURL: String(base || '').replace(ANTHROPIC_VERSIONED, '').replace(/\/+$/, ''),
    maxRetries: 2,
    fetch: (...args) => globalThis.fetch(...args)
  });
}

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  return content.filter(p => p && p.type === 'text').map(p => p.text || '').join('\n');
};

export function toolUseId(id, i = 0) {
  const clean = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return clean || 'toolu_' + i;
}

function imageBlock(url) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(url || ''));
  if (m) {
    const type = m[1].toLowerCase();
    if (!IMAGE_TYPES.has(type)) return { type: 'text', text: '[An attached image in an unsupported format (' + type + ') was left out.]' };
    return { type: 'image', source: { type: 'base64', media_type: type, data: m[2] } };
  }
  if (/^https?:\/\//i.test(String(url || ''))) return { type: 'image', source: { type: 'url', url: String(url) } };
  return null;
}

function contentBlocks(content) {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const p of content) {
    if (!p) continue;
    if (p.type === 'text' && String(p.text || '').trim()) out.push({ type: 'text', text: p.text });
    else if (p.type === 'image_url') {
      const b = imageBlock(p.image_url?.url ?? p.image_url);
      if (b) out.push(b);
    }
  }
  return out;
}

function toolInput(c) {
  const raw = c.args ?? safeParse(c.argsText ?? c.function?.arguments);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function resultContent(content) {
  const text = String(content ?? '');
  return text.trim() ? text : '(no output)';
}

function repair(out, prefill = false) {
  const fixed = [];
  for (let i = 0; i < out.length; i++) {
    const msg = out[i];
    if (msg.role === 'user') {
      const prev = fixed[fixed.length - 1];
      const open = new Set(prev?.role === 'assistant' ? prev.content.filter(b => b.type === 'tool_use').map(b => b.id) : []);
      const results = [];
      const rest = [];
      for (const b of msg.content) {
        if (b.type === 'tool_result' && open.has(b.tool_use_id)) { results.push(b); open.delete(b.tool_use_id); }
        else if (b.type === 'tool_result') rest.push({ type: 'text', text: 'Tool result: ' + (typeof b.content === 'string' ? b.content : '') });
        else rest.push(b);
      }
      for (const id of open) results.push({ type: 'tool_result', tool_use_id: id, content: '(no result)', is_error: true });
      fixed.push({ role: 'user', content: [...results, ...rest] });
      continue;
    }
    fixed.push(msg);
    const ids = msg.content.filter(b => b.type === 'tool_use').map(b => b.id);
    if (ids.length && out[i + 1]?.role !== 'user') {
      fixed.push({ role: 'user', content: ids.map(id => ({ type: 'tool_result', tool_use_id: id, content: '(no result)', is_error: true })) });
    }
  }
  if (!fixed.length || fixed[0].role !== 'user') fixed.unshift({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
  if (fixed[fixed.length - 1].role === 'assistant' && !prefill) fixed.push({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
  return fixed;
}

export function toAnthropic(messages) {
  const system = [];
  const out = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };
  let toolIndex = 0;
  for (const m of messages || []) {
    if (!m) continue;
    if (m.role === 'system') {
      const text = textOf(m.content);
      if (!text.trim()) continue;
      if (!out.length) system.push(text);
      else push('user', [{ type: 'text', text: '<system_note>\n' + text + '\n</system_note>' }]);
    } else if (m.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: toolUseId(m.tool_call_id), content: resultContent(m.content) }]);
    } else if (m.role === 'assistant') {
      const blocks = Array.isArray(m.blocks) ? m.blocks.filter(b => b && (b.type === 'thinking' || b.type === 'redacted_thinking')) : [];
      const text = m.prefill ? textOf(m.content).trimEnd() : textOf(m.content);
      if (text.trim()) blocks.push({ type: 'text', text });
      for (const c of m.tool_calls || []) {
        blocks.push({ type: 'tool_use', id: toolUseId(c.id, toolIndex++), name: c.name || c.function?.name || '', input: toolInput(c) });
      }
      push('assistant', blocks);
    } else {
      push('user', contentBlocks(m.content));
    }
  }
  const last = messages?.[messages.length - 1];
  return { system: system.join('\n\n'), messages: repair(out, last?.role === 'assistant' && !!last.prefill) };
}

export function stripThinking(messages) {
  return messages.map(m => (m.role !== 'assistant' ? m : {
    ...m,
    content: m.content.filter(b => b.type !== 'thinking' && b.type !== 'redacted_thinking')
  })).filter(m => m.content.length);
}

export function toAnthropicTools(tools) {
  return (Array.isArray(tools) ? tools : []).map(t => {
    const fn = t?.function || t || {};
    const schema = fn.parameters && typeof fn.parameters === 'object' ? { ...fn.parameters } : {};
    if (schema.type !== 'object') schema.type = 'object';
    if (!schema.properties) schema.properties = {};
    return { name: fn.name, description: fn.description || '', input_schema: schema, eager_input_streaming: true };
  }).filter(t => t.name);
}

export function legacyThinking(id) {
  const name = String(id || '').replace(/^.*?(?=claude-)/, '');
  return /^claude-(?:3|instant)/.test(name) || /^claude-(?:opus|sonnet|haiku)-4(?:-[015])?(?:-\d{8}|-latest)?(?:@\d{8}|-v\d+(?::\d+)?)?$/.test(name);
}

function splitKwargs(payload) {
  let effort = null;
  const body = {};
  const take = (k, v) => { if (EFFORT_KEYS.has(k) && EFFORTS.has(String(v))) effort = String(v); };
  for (const [k, v] of Object.entries(payload || {})) {
    if (k === 'chat_template_kwargs' || k === 'extra_body') {
      if (v && typeof v === 'object') for (const [n, x] of Object.entries(v)) take(n, x);
    } else if (EFFORT_KEYS.has(k)) take(k, v);
    else if (!RESERVED.has(k)) body[k] = v;
  }
  return { effort, body };
}

export function buildParams(model, spec, { messages, tools = [], memo: mem = null, oneShot = false, kwargs = null } = {}) {
  const conv = toAnthropic(messages);
  const sampling = samplingParams(model, spec);
  const asked = parseInt(sampling.max_tokens, 10);
  delete sampling.max_tokens;
  if (Number.isFinite(sampling.temperature)) sampling.temperature = Math.min(1, Math.max(0, sampling.temperature));
  let maxTokens = asked > 0 ? asked : (oneShot ? ONESHOT_MAX_TOKENS : DEFAULT_MAX_TOKENS);
  if (mem?.maxTokens && maxTokens > mem.maxTokens) maxTokens = mem.maxTokens;
  const { effort, body } = splitKwargs(kwargs || requestKwargs(model));
  const params = { ...body, model: model.internal_name, max_tokens: maxTokens, messages: conv.messages, ...sampling };
  if (conv.system.trim()) params.system = conv.system;
  if (model.has_reasoning && !oneShot && !mem?.noThinking) {
    if (legacyThinking(model.internal_name)) {
      const budget = Math.max(MIN_BUDGET, Math.min(Math.floor(maxTokens / 2), 32000));
      params.max_tokens = Math.max(maxTokens, budget + MIN_BUDGET);
      params.thinking = { type: 'enabled', budget_tokens: budget };
      delete params.temperature;
      delete params.top_k;
    } else {
      params.thinking = { type: 'adaptive', display: 'summarized' };
    }
  }
  if (effort) params.output_config = { effort };
  const list = toAnthropicTools(tools);
  if (list.length) params.tools = list;
  if (!oneShot) cacheBreakpoints(params);
  if (!oneShot && FALLBACK_MODELS.test(String(model.internal_name || '').replace(/^.*?(?=claude-)/, ''))) params.fallbacks = 'default';
  if (mem) applyMemo(params, mem);
  return params;
}

// Tools render first, then the system prompt, then the conversation. A marker on the
// last tool and on the system prompt lets every chat on this model reuse that prefix;
// the top-level marker moves with the conversation, so each step of a tool loop and
// the next turn read the history back at a tenth of the input price.
export function cacheBreakpoints(params) {
  if (params.tools?.length) params.tools = params.tools.map((t, i, all) => (i === all.length - 1 ? { ...t, cache_control: EPHEMERAL } : t));
  if (typeof params.system === 'string' && params.system.trim()) params.system = [{ type: 'text', text: params.system, cache_control: EPHEMERAL }];
  params.cache_control = EPHEMERAL;
  return params;
}

function uncache(params) {
  delete params.cache_control;
  if (Array.isArray(params.system)) params.system = params.system.map(b => b.text).join('\n\n');
  if (params.tools) params.tools = params.tools.map(({ cache_control, ...t }) => t);
}

export function usageOf(u) {
  const read = u?.cache_read_input_tokens || 0;
  const write = u?.cache_creation_input_tokens || 0;
  const prompt = (u?.input_tokens || 0) + read + write;
  const completion = u?.output_tokens || 0;
  return { prompt, completion, total: prompt + completion, cacheRead: read, cacheWrite: write };
}

function applyMemo(params, mem) {
  for (const k of mem.drop) {
    if (k === 'eager_input_streaming') { if (params.tools) params.tools = params.tools.map(({ eager_input_streaming, ...t }) => t); }
    else if (k === 'cache_control') uncache(params);
    else delete params[k];
  }
  if (mem.noThinking) {
    delete params.thinking;
    params.messages = stripThinking(params.messages);
  }
}

export function errorText(err) {
  const body = err?.error;
  const inner = body?.error?.message || body?.message;
  return String(inner || err?.message || err || '');
}

export function rejectedParam(message, params) {
  const msg = String(message || '');
  for (const k of DROPPABLE) {
    const present = k === 'eager_input_streaming' ? params.tools?.some(t => t.eager_input_streaming)
      : k === 'cache_control' ? ('cache_control' in params || Array.isArray(params.system)) : k in params;
    if (present && new RegExp('\\b' + k + '\\b').test(msg)) return k;
  }
  return null;
}

export function recover(err, params, mem) {
  if (!(err instanceof APIError) || err.status !== 400) return null;
  const msg = errorText(err);
  const hasThinking = params.messages.some(m => m.role === 'assistant' && m.content.some(b => b.type === 'thinking' || b.type === 'redacted_thinking'));
  if (hasThinking && /signature/i.test(msg) && /thinking/i.test(msg)) {
    return { ...params, messages: stripThinking(params.messages) };
  }
  if (params.thinking && /must start with a thinking block|expected [`'"]?thinking/i.test(msg)) {
    mem.noThinking = true;
    const next = { ...params, messages: stripThinking(params.messages) };
    delete next.thinking;
    return next;
  }
  const cap = /max_tokens:?\s*(\d+)\s*>\s*(\d+)/i.exec(msg);
  if (cap && Number(cap[2]) > 0) {
    mem.maxTokens = Number(cap[2]);
    const next = { ...params, max_tokens: mem.maxTokens };
    if (next.thinking?.budget_tokens >= mem.maxTokens) next.thinking = { ...next.thinking, budget_tokens: Math.max(MIN_BUDGET, Math.floor(mem.maxTokens / 2)) };
    return next;
  }
  const bad = rejectedParam(msg, params);
  if (bad) {
    mem.drop.add(bad);
    const next = { ...params };
    applyMemo(next, { drop: new Set([bad]) });
    return next;
  }
  return null;
}

function abortError() {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

export function friendlyError(err, model, base) {
  if (err instanceof APIUserAbortError) return abortError();
  if (err instanceof APIConnectionError) {
    const cause = err.cause;
    if (cause?.code === 'EGRESS_BLOCKED' || cause?.name === 'AbortError') return cause;
    let where = base;
    try { where = new URL(base).origin; } catch {}
    return new Error(`Could not reach the model provider at ${where} (${cause?.code || cause?.message || err.message}).`, { cause: err });
  }
  if (!(err instanceof APIError)) return err;
  const detail = errorText(err);
  const id = model?.internal_name || '';
  const lead = {
    400: 'Anthropic rejected the request',
    401: 'Anthropic rejected the API key. Check the key on this connection',
    403: 'This API key is not allowed to use this model',
    404: `Anthropic has no model named "${id}". Check the model id`,
    413: 'The request is too large for Anthropic',
    429: 'Anthropic is rate limiting this key. Try again shortly',
    529: 'Anthropic is overloaded right now. Try again shortly'
  }[err.status] || 'Anthropic returned an error';
  return new Error(`Upstream error ${err.status}: ${lead}. ${detail}`.trim(), { cause: err });
}

const FINISH = { __proto__: null, end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length', tool_use: 'tool_calls', pause_turn: 'pause_turn', refusal: 'refusal' };

export async function runWithRecovery(params, mem, attempt) {
  let current = params;
  for (let tries = 0; ; tries++) {
    try {
      return await attempt(current);
    } catch (err) {
      const next = tries < 4 && !err?.__oqStreamed ? recover(err, current, mem) : null;
      if (!next) throw err;
      current = next;
    }
  }
}

export async function streamAnthropic({ model, spec, base, key, messages, tools, signal, onEvent }) {
  const client = anthropicClient({ base, key });
  const mem = memoFor(base, model.internal_name);
  const params = buildParams(model, spec, { messages, tools, memo: mem });
  try {
    await runWithRecovery(params, mem, (p) => streamOnce(client, p, signal, onEvent));
  } catch (err) {
    throw friendlyError(err, model, base);
  }
}

async function streamOnce(client, params, signal, onEvent) {
  const blocks = [];
  let usage = usageOf(null);
  let streamed = false;
  let stop = '';
  let wrote = false;
  const stream = client.messages.stream(params, { signal, ...(params.fallbacks ? { headers: { 'anthropic-beta': FALLBACK_BETA } } : {}) });
  try {
    for await (const ev of stream) {
      streamed = true;
      if (ev.type === 'message_start') {
        usage = usageOf(ev.message?.usage);
        onEvent({ type: 'usage', usage });
      } else if (ev.type === 'content_block_start') {
        const b = ev.content_block || {};
        if (b.type === 'tool_use') {
          blocks[ev.index] = { type: 'tool_use', id: b.id, name: b.name, argsText: '' };
          onEvent({ type: 'tool_call_delta', index: ev.index, id: b.id, name: b.name, argsText: '' });
        } else if (b.type === 'thinking') blocks[ev.index] = { type: 'thinking', thinking: b.thinking || '', signature: b.signature || '' };
        else if (b.type === 'redacted_thinking') blocks[ev.index] = { type: 'redacted_thinking', data: b.data };
        else if (b.type === 'text') {
          blocks[ev.index] = { type: 'text' };
          if (b.text) { wrote = true; onEvent({ type: 'content', text: b.text }); }
        }
      } else if (ev.type === 'content_block_delta') {
        const d = ev.delta || {};
        const b = blocks[ev.index];
        if (d.type === 'text_delta' && d.text) { wrote = true; onEvent({ type: 'content', text: d.text }); }
        else if (d.type === 'thinking_delta' && b) {
          b.thinking += d.thinking || '';
          if (d.thinking) onEvent({ type: 'reasoning', text: d.thinking });
        } else if (d.type === 'signature_delta' && b) b.signature = (b.signature || '') + (d.signature || '');
        else if (d.type === 'input_json_delta' && b) {
          b.argsText += d.partial_json || '';
          onEvent({ type: 'tool_call_delta', index: ev.index, id: b.id, name: b.name, argsText: b.argsText });
        }
      } else if (ev.type === 'message_delta') {
        const u = ev.usage || {};
        const next = Number.isFinite(u.input_tokens) ? usageOf(u) : { ...usage };
        if (Number.isFinite(u.output_tokens)) next.completion = u.output_tokens;
        next.total = next.prompt + next.completion;
        usage = next;
        onEvent({ type: 'usage', usage });
        if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
      }
    }
  } catch (err) {
    if (streamed && err && typeof err === 'object') err.__oqStreamed = true;
    throw err;
  }
  if (stop) onEvent({ type: 'finish', reason: FINISH[stop] || stop });
  if (stop === 'refusal' && !wrote) onEvent({ type: 'content', text: 'The model declined to answer this request.' });
  const calls = blocks.filter(b => b?.type === 'tool_use').map(b => ({ id: b.id, name: b.name, argsText: b.argsText || '{}' }));
  if (calls.length && stop !== 'max_tokens' && stop !== 'refusal') {
    const thinking = blocks.filter(b => b && (b.type === 'thinking' || b.type === 'redacted_thinking'));
    onEvent({ type: 'tool_calls', calls, blocks: thinking });
  }
}

export async function oneShotAnthropic({ model, spec, base, key, messages, kwargs, signal }) {
  const client = anthropicClient({ base, key });
  const mem = memoFor(base, model.internal_name);
  const params = buildParams(model, spec, { messages, memo: mem, oneShot: true, kwargs });
  try {
    const res = await runWithRecovery(params, mem, (p) => client.messages.create(p, { signal }));
    const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return { text, usage: usageOf(res.usage) };
  } catch (err) {
    throw friendlyError(err, model, base);
  }
}

export async function listAnthropicModels({ base, key }) {
  const client = anthropicClient({ base, key });
  const out = [];
  for await (const m of client.models.list({ limit: 100 })) out.push({ id: m.id, name: m.display_name || m.id, context: m.max_input_tokens || 0, maxOutput: m.max_tokens || 0 });
  return out;
}

export async function anthropicModelInfo({ base, key }, id) {
  const m = await anthropicClient({ base, key }).models.retrieve(id);
  return { context: Number(m?.max_input_tokens) || 0, maxOutput: Number(m?.max_tokens) || 0 };
}

export async function countAnthropicTokens({ model, spec, base, key, messages, tools = [] }) {
  const p = buildParams(model, spec, { messages, tools, memo: memoFor(base, model.internal_name) });
  const body = { model: p.model, messages: p.messages };
  if (Array.isArray(p.system)) body.system = p.system.map(b => b.text).join('\n\n');
  else if (p.system) body.system = p.system;
  if (p.tools) body.tools = p.tools.map(({ cache_control, eager_input_streaming, ...t }) => t);
  if (p.thinking) body.thinking = p.thinking;
  const res = await anthropicClient({ base, key }).messages.countTokens(body);
  return Number(res?.input_tokens) || 0;
}