import { samplingParams } from './sampling.js';
import { safeParse } from './wire.js';
import { errorDetail } from './compat.js';

const EFFORT_KEYS = new Set(['reasoning_effort', 'effort']);
const FINISH = { __proto__: null, max_output_tokens: 'length', content_filter: 'content_filter' };

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  return content.filter(p => p && p.type === 'text').map(p => p.text || '').join('\n');
};

function userContent(content) {
  if (!Array.isArray(content)) return String(content ?? '');
  const parts = [];
  for (const p of content) {
    if (!p) continue;
    if (p.type === 'text' && String(p.text || '').trim()) parts.push({ type: 'input_text', text: p.text });
    else if (p.type === 'image_url') {
      const url = String(p.image_url?.url ?? p.image_url ?? '');
      if (url) parts.push({ type: 'input_image', image_url: url });
    }
  }
  return parts;
}

function callItem(c, i) {
  const args = typeof c.argsText === 'string' ? c.argsText : JSON.stringify(c.args ?? safeParse(c.function?.arguments) ?? {});
  return { type: 'function_call', call_id: c.id || `call_${i}`, name: c.name || c.function?.name || '', arguments: args || '{}' };
}

function reasoningItem(b) {
  const item = { type: 'reasoning', id: b.id, summary: Array.isArray(b.summary) ? b.summary : [] };
  if (b.encrypted_content) item.encrypted_content = b.encrypted_content;
  return item;
}

function assistantItems(m, seq) {
  const out = [];
  const text = textOf(m.content);
  if (text.trim()) out.push({ role: 'assistant', content: text });
  const calls = (m.tool_calls || []).map(c => callItem(c, seq.n++));
  const byId = new Map(calls.map(c => [c.call_id, c]));
  const blocks = Array.isArray(m.blocks) ? m.blocks : [];
  for (const b of blocks) {
    if (b?.type === 'reasoning' && b.id) out.push(reasoningItem(b));
    else if (b?.type === 'function_call' && byId.has(b.call_id)) { out.push(byId.get(b.call_id)); byId.delete(b.call_id); }
  }
  out.push(...byId.values());
  return out;
}

export function toResponsesInput(messages) {
  const items = [];
  const seq = { n: 0 };
  for (const m of messages || []) {
    if (!m) continue;
    if (m.role === 'system') {
      const text = textOf(m.content);
      if (text.trim()) items.push({ role: 'system', content: text });
    } else if (m.role === 'assistant') {
      items.push(...assistantItems(m, seq));
    } else if (m.role === 'tool') {
      items.push({ type: 'function_call_output', call_id: m.tool_call_id || '', output: String(m.content ?? '') || '(no output)' });
    } else {
      const content = userContent(m.content);
      if (Array.isArray(content) ? content.length : content.trim()) items.push({ role: 'user', content });
    }
  }
  return repair(items);
}

function repair(items) {
  const calls = new Set();
  const answered = new Set();
  for (const it of items) {
    if (it.type === 'function_call') calls.add(it.call_id);
    if (it.type === 'function_call_output' && calls.has(it.call_id)) answered.add(it.call_id);
  }
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'function_call_output' && !calls.has(it.call_id)) {
      out.push({ role: 'user', content: 'Tool result: ' + it.output });
      continue;
    }
    out.push(it);
    if (it.type === 'function_call' && !answered.has(it.call_id)) {
      out.push({ type: 'function_call_output', call_id: it.call_id, output: '(no result)' });
      answered.add(it.call_id);
    }
  }
  return out;
}

export function toResponsesTools(tools) {
  return (Array.isArray(tools) ? tools : []).map(t => {
    const fn = t?.function || t || {};
    const parameters = fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object', properties: {} };
    return { type: 'function', name: fn.name, description: fn.description || '', parameters, strict: false };
  }).filter(t => t.name);
}

export function responsesKwargs(payload) {
  const body = {};
  const merge = (k, v) => {
    if (EFFORT_KEYS.has(k)) body.reasoning = { ...body.reasoning, effort: v };
    else if (k === 'verbosity') body.text = { ...body.text, verbosity: v };
    else if ((k === 'reasoning' || k === 'text') && v && typeof v === 'object') body[k] = { ...body[k], ...v };
    else body[k] = v;
  };
  for (const [k, v] of Object.entries(payload || {})) {
    if (k === 'chat_template_kwargs') continue;
    if (k === 'extra_body') { if (v && typeof v === 'object') for (const [n, x] of Object.entries(v)) merge(n, x); }
    else merge(k, v);
  }
  return body;
}

export function buildResponsesBody(model, spec, { messages, tools = [], kwargs = {}, mem = null, stream = true, maxTokens = 0 }) {
  const body = {
    model: model.internal_name,
    input: toResponsesInput(messages),
    stream,
    store: false,
    ...samplingParams(model, spec),
    ...responsesKwargs(kwargs)
  };
  if (maxTokens > 0) body.max_output_tokens = maxTokens;
  const list = toResponsesTools(tools);
  if (list.length) { body.tools = list; body.tool_choice = 'auto'; }
  if (body.reasoning?.effort && body.reasoning.effort !== 'none') {
    if (!body.reasoning.summary && !mem?.noSummary) body.reasoning = { ...body.reasoning, summary: 'auto' };
    if (!body.include) body.include = ['reasoning.encrypted_content'];
  }
  return body;
}

export function fixResponsesBody(status, text, body, mem) {
  if (status !== 400) return null;
  const { message, param } = errorDetail(text);
  if (body.reasoning?.summary && (/summar/i.test(message) || /summary/.test(param))) {
    mem.noSummary = true;
    const { summary, ...reasoning } = body.reasoning;
    return { ...body, reasoning };
  }
  const replayed = body.input.some(it => it.type === 'reasoning');
  if (replayed && /reasoning|encrypted/i.test(message)) {
    return { ...body, input: body.input.filter(it => it.type !== 'reasoning') };
  }
  return null;
}

export function usageOf(u) {
  const prompt = u?.input_tokens || 0;
  const completion = u?.output_tokens || 0;
  return { prompt, completion, total: u?.total_tokens || prompt + completion, cacheRead: u?.input_tokens_details?.cached_tokens || 0, cacheWrite: 0 };
}

export function responsesHandler({ emitContent, emitReasoning, onEvent, nonce }) {
  const pending = new Map();
  const blocks = [];
  const state = { failure: '', done: false };
  const callAt = (index) => pending.get(index);

  const handle = (json) => {
    const t = json.type;
    if (t === 'response.output_text.delta' || t === 'response.refusal.delta') { if (json.delta) emitContent(json.delta); }
    else if (t === 'response.reasoning_summary_text.delta' || t === 'response.reasoning_text.delta') { if (json.delta) emitReasoning(json.delta); }
    else if (t === 'response.reasoning_summary_part.added') { if (json.summary_index > 0) emitReasoning('\n\n'); }
    else if (t === 'response.output_item.added' && json.item?.type === 'function_call') {
      const it = json.item;
      const cur = { id: it.call_id || `call_${nonce}_${json.output_index}`, name: it.name || '', argsText: it.arguments || '' };
      pending.set(json.output_index, cur);
      onEvent({ type: 'tool_call_delta', index: json.output_index, id: cur.id, name: cur.name, argsText: cur.argsText });
    } else if (t === 'response.function_call_arguments.delta') {
      const cur = callAt(json.output_index);
      if (cur && json.delta) {
        cur.argsText += json.delta;
        onEvent({ type: 'tool_call_delta', index: json.output_index, id: cur.id, name: cur.name, argsText: cur.argsText });
      }
    } else if (t === 'response.function_call_arguments.done') {
      const cur = callAt(json.output_index);
      if (cur && typeof json.arguments === 'string') cur.argsText = json.arguments;
    } else if (t === 'response.output_item.done') {
      const it = json.item || {};
      if (it.type === 'reasoning' && it.id) blocks[json.output_index] = reasoningItem(it);
      else if (it.type === 'function_call') {
        const cur = callAt(json.output_index);
        if (cur && typeof it.arguments === 'string') cur.argsText = it.arguments;
        blocks[json.output_index] = { type: 'function_call', call_id: cur?.id || it.call_id };
      }
    } else if (t === 'response.completed' || t === 'response.incomplete') {
      const r = json.response || {};
      if (r.usage) onEvent({ type: 'usage', usage: usageOf(r.usage) });
      const reason = t === 'response.incomplete' ? (FINISH[r.incomplete_details?.reason] || 'length') : (pending.size ? 'tool_calls' : 'stop');
      onEvent({ type: 'finish', reason });
      state.done = true;
    } else if (t === 'response.failed') {
      state.failure = String(json.response?.error?.message || 'The model provider reported an error.');
      state.done = true;
    } else if (t === 'error') {
      state.failure = String(json.message || json.error?.message || 'The model provider reported an error.');
      state.done = true;
    }
    return state.done;
  };

  const calls = () => [...pending.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c).filter(c => c.name);
  const kept = () => blocks.filter(Boolean);
  return { handle, state, calls, blocks: kept };
}

export function responsesText(json) {
  const out = [];
  for (const it of json?.output || []) {
    if (it?.type !== 'message') continue;
    for (const c of it.content || []) if (c?.type === 'output_text' && c.text) out.push(c.text);
  }
  return (out.join('') || json?.output_text || '').trim();
}