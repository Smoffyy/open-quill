import { modelProvider, endpoint, authHeaders } from './provider.js';
import { samplingParams, ollamaOptions } from './sampling.js';
import { makeEmitter } from './emitter.js';
import { makeToolResolver } from '../tools/aliases.js';
import { normalizeMessages, requestKwargs } from './wire.js';
import { stripNestedKwargs } from '../lib/kwargs.js';

export async function streamCompletion({ model, messages, tools, signal, onEvent }) {
  const { spec, base, key } = modelProvider(model);
  const hasTools = Array.isArray(tools) && tools.length > 0;
  const wire = normalizeMessages(spec.protocol, messages);
  const pending = new Map();
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
      if (calls.length) { textCalls.length = 0; onEvent({ type: 'tool_calls', calls }); return; }
    }
    if (textCalls.length) onEvent({ type: 'tool_calls', calls: textCalls.splice(0, textCalls.length) });
  };

  if (spec.protocol === 'ollama') {
    const res = await fetch(endpoint(base, '/api/chat'), {
      method: 'POST', headers: authHeaders(key), signal,
      body: JSON.stringify({ model: model.internal_name, messages: wire, stream: true, think: !!model.has_reasoning, options: ollamaOptions(model, spec), ...(hasTools ? { tools } : {}), ...stripNestedKwargs(requestKwargs(model)) })
    });
    if (!res.ok || !res.body) { const t = await res.text().catch(() => ''); throw new Error(`Upstream error ${res.status}: ${t.slice(0, 300)}`); }
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    const handle = (line) => {
      const t = line.trim(); if (!t) return false;
      try {
        const json = JSON.parse(t);
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
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) if (handle(line)) { await reader.cancel().catch(() => {}); flush(); finishCalls(); return; }
    }
    buffer += decoder.decode();
    handle(buffer);
    flush(); finishCalls(); return;
  }

  const res = await fetch(endpoint(base, '/chat/completions'), {
    method: 'POST', headers: authHeaders(key), signal,
    body: JSON.stringify({ model: model.internal_name, messages: wire, stream: true, stream_options: { include_usage: true }, ...(spec.timingsPerToken ? { timings_per_token: true } : {}), ...(spec.promptProgress ? { return_progress: true } : {}), ...(hasTools ? { tools, tool_choice: 'auto' } : {}), ...samplingParams(model, spec), ...requestKwargs(model) })
  });
  if (!res.ok || !res.body) { const t = await res.text().catch(() => ''); throw new Error(`Upstream error ${res.status}: ${t.slice(0, 300)}`); }
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  const handle = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return true;
    try {
      const json = JSON.parse(data);
      if (json.prompt_progress) onEvent({ type: 'prompt_progress', progress: json.prompt_progress });
      if (json.timings) onEvent({ type: 'timings', timings: json.timings });
      if (json.usage) { const u = json.usage; onEvent({ type: 'usage', usage: { prompt: u.prompt_tokens || 0, completion: u.completion_tokens || 0, total: u.total_tokens || ((u.prompt_tokens || 0) + (u.completion_tokens || 0)) } }); }
      else if (json.timings) {
        const pn = json.timings.prompt_n || 0, cn = json.timings.predicted_n || 0;
        if (pn || cn) onEvent({ type: 'usage', usage: { prompt: pn, completion: cn, total: pn + cn } });
      }
      const fin = json.choices?.[0]?.finish_reason;
      if (fin) onEvent({ type: 'finish', reason: String(fin) });
      const delta = json.choices?.[0]?.delta || {};
      if (delta.reasoning_content) emitReasoning(delta.reasoning_content);
      if (typeof delta.reasoning === 'string' && delta.reasoning) emitReasoning(delta.reasoning);
      if (delta.content) emitContent(delta.content);
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = Number.isInteger(tc.index) ? tc.index : callSeq;
          let cur = pending.get(idx);
          if (!cur) { cur = { id: `call_${nonce}_${idx}`, name: '', argsText: '' }; pending.set(idx, cur); callSeq = Math.max(callSeq, idx + 1); }
          if (tc.id) cur.id = tc.id;
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
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) if (handle(line)) { await reader.cancel().catch(() => {}); flush(); finishCalls(); return; }
  }
  buffer += decoder.decode();
  handle(buffer);
  flush();
  finishCalls();
}

