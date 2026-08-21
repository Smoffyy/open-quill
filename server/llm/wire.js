import { defaultKwargPayload } from '../lib/kwargs.js';

// Turns this app's internal `{ id, name, argsText }` calls into the OpenAI wire
// shape. Exported because the token counter posts the same conversation to
// llama.cpp's /apply-template, and that endpoint rejects anything without
// `type` and `function` — a 500 there silently downgrades an exact token count
// to a guess, which is the one thing the context-window code must not do.
export function wireToolCalls(protocol, calls) {
  return calls.map((c, i) => ({
    id: c.id || `call_${i}`,
    type: 'function',
    function: {
      name: c.name || c.function?.name || '',
      arguments: protocol === 'ollama'
        ? (c.args ?? safeParse(c.argsText ?? c.function?.arguments) ?? {})
        : (typeof c.argsText === 'string' ? c.argsText : JSON.stringify(c.args ?? safeParse(c.function?.arguments) ?? {}))
    }
  }));
}

export function normalizeMessages(protocol, messages) {
  return messages.map(m => {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const calls = wireToolCalls(protocol, m.tool_calls);
      return { role: 'assistant', content: (m.content && String(m.content).trim()) ? m.content : null, tool_calls: calls };
    }
    if (m.role === 'tool') {
      if (protocol === 'ollama') return { role: 'tool', tool_name: m.name || '', content: String(m.content ?? '') };
      return { role: 'tool', tool_call_id: m.tool_call_id || '', content: String(m.content ?? '') };
    }
    return { role: m.role, content: m.content };
  });
}
export function safeParse(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

export function requestKwargs(model) {
  if (model && model.resolved_kwargs && typeof model.resolved_kwargs === 'object') return model.resolved_kwargs;
  return defaultKwargPayload(model);
}

