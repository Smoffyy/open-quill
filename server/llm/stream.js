import { modelProvider, endpoint, authHeaders } from './provider.js';
import { samplingParams, ollamaOptions } from './sampling.js';
import { makeEmitter } from './emitter.js';
import { makeToolResolver } from '../tools/aliases.js';
import { normalizeMessages, requestKwargs } from './wire.js';
import { stripNestedKwargs, replayFieldOf } from '../lib/kwargs.js';
import { streamAnthropic } from './anthropic.js';
import { memoFor, postWithRecovery, upstreamMessage } from './compat.js';
import { queueKey, inLine } from './slots.js';
import { buildResponsesBody, fixResponsesBody, responsesHandler } from './responses.js';

export function replayField(model) {
  return replayFieldOf(model) || modelProvider(model).spec.replay || '';
}

export function chunkText(parts, type) {
  if (typeof parts === 'string') return parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(p => {
    if (!p || p.type !== type) return '';
    const v = p[type];
    return typeof v === 'string' ? v : chunkText(v, 'text');
  }).join('');
}

function mergeDetails(into, list) {
  for (const d of list) {
    if (!d || typeof d.type !== 'string') continue;
    const at = Number.isInteger(d.index) ? into.find(x => x.index === d.index && x.type === d.type) : null;
    if (!at) { into.push({ ...d }); continue; }
    for (const k of ['text', 'summary', 'data']) if (typeof d[k] === 'string') at[k] = (at[k] || '') + d[k];
    for (const [k, v] of Object.entries(d)) if (!['text', 'summary', 'data'].includes(k) && v != null) at[k] = v;
  }
}

const detailText = (list) => list.map(d => (d.type === 'reasoning.text' ? d.text : d.type === 'reasoning.summary' ? d.summary : '') || '').join('');

async function assertOk(res) {
  if (!res.ok || !res.body) { const t = await res.text().catch(() => ''); throw new Error(upstreamMessage(res.status, t)); }
}

async function providerFetch(url, init) {
  try { return await fetch(url, init); }
  catch (e) {
    if (e?.name === 'AbortError' || e?.code === 'EGRESS_BLOCKED') throw e;
    let where = url;
    try { where = new URL(url).origin; } catch {}
    throw new Error(`Could not reach the model provider at ${where} (${e?.cause?.code || e?.message || e}).`, { cause: e });
  }
}

function errorText(raw) {
  let e = raw;
  if (typeof e === 'string') { try { e = JSON.parse(e); } catch { return e.trim() || 'The model provider reported an error.'; } }
  const inner = e && typeof e === 'object' && e.error !== undefined ? e.error : e;
  if (typeof inner === 'string') return inner;
  return String(inner?.message || e?.message || 'The model provider reported an error.');
}

async function pumpLines(res, handle, finish) {
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) if (handle(line)) { await reader.cancel().catch(() => {}); finish(); return; }
  }
  buffer += decoder.decode();
  handle(buffer);
  finish();
}

export function canPrefill(model) {
  const { spec, base } = modelProvider(model);
  if (!spec.prefill) return false;
  const mem = memoFor(base, model.internal_name);
  if (mem.noPrefill) return false;
  return !(spec.protocol === 'anthropic' && model.has_reasoning && !mem.noThinking);
}

export function refusePrefill(model) {
  const { base } = modelProvider(model);
  memoFor(base, model.internal_name).noPrefill = true;
}

export function prefillWire(spec, messages, wire) {
  const last = messages[messages.length - 1];
  if (!last || !last.prefill || !spec.prefill) return {};
  if (spec.prefill.message) Object.assign(wire[wire.length - 1], spec.prefill.message);
  return spec.prefill.body || {};
}

export function streamCompletion(args) {
  const { spec, base } = modelProvider(args.model);
  return inLine(queueKey(args.model, spec, base), args.signal, () => streamDirect(args));
}

async function streamDirect({ model, messages, tools, signal, onEvent }) {
  const { spec, base, key } = modelProvider(model);
  if (spec.protocol === 'anthropic') return streamAnthropic({ model, spec, base, key, messages, tools, signal, onEvent });
  const hasTools = Array.isArray(tools) && tools.length > 0;
  const pending = new Map();
  const details = [];
  let callSeq = 0;
  const nonce = Math.random().toString(36).slice(2, 8);
  const toolNames = new Set(hasTools ? tools.map(t => t && t.function && t.function.name).filter(Boolean) : []);
  const textCalls = [];
  const addTextCalls = (calls) => {
    for (const c of calls) {
      const idx = textCalls.length;
      const cid = `call_${nonce}_t${idx}`;
      textCalls.push({ id: cid, name: c.name, argsText: c.argsText });
      onEvent({ type: 'tool_call_delta', index: 1000 + idx, id: cid, name: c.name, argsText: c.argsText });
    }
  };
  const { emitContent, emitReasoning, flush } = makeEmitter(model, onEvent, addTextCalls, makeToolResolver(toolNames));
  const finishCalls = () => {
    if (pending.size) {
      const calls = [...pending.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c).filter(c => c.name);
      pending.clear();
      if (calls.length) { textCalls.length = 0; onEvent({ type: 'tool_calls', calls, ...(details.length ? { blocks: details } : {}) }); return; }
    }
    if (textCalls.length) onEvent({ type: 'tool_calls', calls: textCalls.splice(0, textCalls.length) });
  };
  let failure = '';
  const pump = async (res, handle) => {
    await pumpLines(res, handle, () => { flush(); if (!failure) finishCalls(); });
    if (failure) throw new Error(failure);
  };

  if (spec.protocol === 'responses') {
    const mem = memoFor(base, model.internal_name);
    const res = await postWithRecovery({
      url: endpoint(base, '/responses'), headers: authHeaders(key), signal, send: providerFetch, mem, fix: fixResponsesBody,
      body: buildResponsesBody(model, spec, { messages, tools, kwargs: requestKwargs(model), mem })
    });
    const rh = responsesHandler({ emitContent, emitReasoning, onEvent, nonce });
    const handle = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return false;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return true;
      try { return rh.handle(JSON.parse(data)); } catch { return false; }
    };
    await pumpLines(res, handle, () => {
      flush();
      if (rh.state.failure) return;
      const calls = rh.calls();
      if (calls.length) { textCalls.length = 0; onEvent({ type: 'tool_calls', calls, blocks: rh.blocks() }); }
      else if (textCalls.length) onEvent({ type: 'tool_calls', calls: textCalls.splice(0, textCalls.length) });
    });
    if (rh.state.failure) throw new Error(rh.state.failure);
    return;
  }

  const wire = normalizeMessages(spec.protocol, messages, replayField(model));
  const fill = prefillWire(spec, messages, wire);

  if (spec.protocol === 'ollama') {
    const res = await providerFetch(endpoint(base, '/api/chat'), {
      method: 'POST', headers: authHeaders(key), signal,
      body: JSON.stringify({ model: model.internal_name, messages: wire, stream: true, think: !!model.has_reasoning, options: ollamaOptions(model, spec), ...(hasTools ? { tools } : {}), ...fill, ...stripNestedKwargs(requestKwargs(model)) })
    });
    await assertOk(res);
    const handle = (line) => {
      const t = line.trim(); if (!t) return false;
      try {
        const json = JSON.parse(t);
        if (json.error) { failure = errorText(json); return true; }
        const msg = json.message || {};
        if (msg.thinking) emitReasoning(msg.thinking);
        if (msg.content) emitContent(msg.content);
        if (Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            const idx = callSeq++;
            const cid = tc.id || `call_${nonce}_${idx}`;
            const argsText = typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {});
            pending.set(idx, { id: cid, name: tc.function?.name || '', argsText });
            onEvent({ type: 'tool_call_delta', index: idx, id: cid, name: tc.function?.name || '', argsText });
          }
        }
        if (json.done) {
          const p = json.prompt_eval_count || 0, c = json.eval_count || 0;
          if (p || c) onEvent({ type: 'usage', usage: { prompt: p, completion: c, total: p + c } });
          if (json.done_reason) onEvent({ type: 'finish', reason: String(json.done_reason) });
          return true;
        }
      } catch {}
      return false;
    };
    return pump(res, handle);
  }

  const res = await postWithRecovery({
    url: endpoint(base, '/chat/completions'), headers: authHeaders(key), signal, send: providerFetch,
    mem: memoFor(base, model.internal_name),
    body: { model: model.internal_name, messages: wire, stream: true, stream_options: { include_usage: true }, ...(spec.timingsPerToken ? { timings_per_token: true } : {}), ...(spec.promptProgress ? { return_progress: true } : {}), ...(hasTools ? { tools, tool_choice: 'auto' } : {}), ...fill, ...samplingParams(model, spec), ...requestKwargs(model) }
  });
  const handle = (line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('error:')) { failure = errorText(trimmed.slice(6)); return true; }
    if (!trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return true;
    try {
      const json = JSON.parse(data);
      if (json.error) { failure = errorText(json); return true; }
      if (json.prompt_progress) onEvent({ type: 'prompt_progress', progress: json.prompt_progress });
      if (json.timings) onEvent({ type: 'timings', timings: json.timings });
      if (json.usage) { const u = json.usage; onEvent({ type: 'usage', usage: { prompt: u.prompt_tokens || 0, completion: u.completion_tokens || 0, total: u.total_tokens || ((u.prompt_tokens || 0) + (u.completion_tokens || 0)), cacheRead: u.prompt_tokens_details?.cached_tokens || 0, cacheWrite: 0 } }); }
      else if (json.timings) {
        const pn = json.timings.prompt_n || 0, cn = json.timings.predicted_n || 0;
        if (pn || cn) onEvent({ type: 'usage', usage: { prompt: pn, completion: cn, total: pn + cn } });
      }
      const fin = json.choices?.[0]?.finish_reason;
      if (fin) onEvent({ type: 'finish', reason: String(fin) });
      const delta = json.choices?.[0]?.delta || {};
      const said = typeof delta.reasoning === 'string' && delta.reasoning;
      if (delta.reasoning_content) emitReasoning(delta.reasoning_content);
      if (said) emitReasoning(said);
      if (Array.isArray(delta.reasoning_details)) {
        mergeDetails(details, delta.reasoning_details);
        const shown = !said && !delta.reasoning_content && detailText(delta.reasoning_details);
        if (shown) emitReasoning(shown);
      }
      if (typeof delta.content === 'string') { if (delta.content) emitContent(delta.content); }
      else if (Array.isArray(delta.content)) {
        const thought = chunkText(delta.content, 'thinking');
        const text = chunkText(delta.content, 'text');
        if (thought) emitReasoning(thought);
        if (text) emitContent(text);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = Number.isInteger(tc.index) ? tc.index : callSeq;
          let cur = pending.get(idx);
          if (!cur) { cur = { id: `call_${nonce}_${idx}`, name: '', argsText: '' }; pending.set(idx, cur); callSeq = Math.max(callSeq, idx + 1); }
          if (tc.id) cur.id = tc.id;
          if (tc.extra_content && typeof tc.extra_content === 'object') cur.extra = tc.extra_content;
          const nm = tc.function?.name;
          if (nm) { if (!cur.name) cur.name = nm; else if (cur.name !== nm) cur.name += nm; }
          const a = tc.function?.arguments;
          if (typeof a === 'string') cur.argsText += a;
          else if (a && typeof a === 'object') cur.argsText = JSON.stringify(a);
          onEvent({ type: 'tool_call_delta', index: idx, id: cur.id, name: cur.name, argsText: cur.argsText });
        }
      }
    } catch {}
    return false;
  };
  return pump(res, handle);
}