import { resolveProvider, providerSpec } from './providers.js';
import { defaultKwargPayload, oneShotKwargPayload, stripNestedKwargs } from './lib/kwargs.js';
import { parseTextToolCalls } from './tools.js';

function modelProvider(model) {
  return providerSpec(resolveProvider(model?.provider_id));
}
function endpoint(base, p) { return base.replace(/\/$/, '') + p; }
function authHeaders(key) {
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

function applyPromptVars(text, vars) {
  if (!text) return text || '';
  return text
    .replace(/\{\{\s*currentDateTime\s*\}\}/gi, (vars && vars.currentDateTime) || '')
    .replace(/\{\{\s*currentUser\s*\}\}/gi, (vars && vars.currentUser) || '');
}

// system prompt order: base, summary, sandbox, then the reasoning toggle token last
export function buildMessages(model, history, extended, sandboxPrompt, summaryText, vars = {}, instructions = '') {
  let sys = applyPromptVars(model.system_prompt || '', vars);
  if (instructions && instructions.trim()) sys = (sys ? sys + '\n\n' : '') + "The user has provided the following instructions to keep in mind across all conversations. Follow them unless they conflict with safety or a direct request in the conversation:\n" + instructions.trim();
  if (summaryText && summaryText.trim()) sys = (sys ? sys + '\n\n' : '') + 'Summary of the earlier part of this conversation (older messages were compacted to save context, treat this as established context):\n' + summaryText.trim();
  if (sandboxPrompt) sys = (sys ? sys + '\n\n' : '') + sandboxPrompt;
  if (model.has_reasoning && !model.effort_enabled) {
    const tok = extended ? model.reasoning_token : model.non_reasoning_token;
    if (tok && tok.trim()) sys = (sys ? sys + '\n' : '') + tok.trim();
  }
  const msgs = [];
  if (sys.trim()) msgs.push({ role: 'system', content: sys });
  for (const m of history) msgs.push({ role: m.role, content: m.content });
  return msgs;
}

export function samplingParams(model, spec) {
  const allowed = spec?.samplers || [];
  const remap = spec?.remap || {};
  const fl = (v) => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
  const it = (v) => (v === '' || v == null || isNaN(parseInt(v))) ? null : parseInt(v);
  const map = { temperature: fl, top_p: fl, presence_penalty: fl, frequency_penalty: fl, repetition_penalty: fl, min_p: fl, top_k: it, seed: it, max_tokens: it };
  const out = {};
  for (const k of allowed) {
    const conv = map[k]; if (!conv) continue;
    const v = conv(model[k]); if (v == null) continue;
    out[remap[k] || k] = v;
  }
  return out;
}

function ollamaOptions(model, spec) {
  const params = samplingParams(model, spec);
  const ctx = parseInt(model.num_ctx); if (Number.isFinite(ctx) && ctx > 0) params.num_ctx = ctx;
  return params;
}

const TEXT_CALL_TAGS = [
  { open: '<tool_call>', close: '</tool_call>', keepOpen: false },
  { open: '<|tool_call|>', close: '<|/tool_call|>', keepOpen: false },
  { open: '<tool_calls>', close: '</tool_calls>', keepOpen: false },
  { open: '<function_call>', close: '</function_call>', keepOpen: false },
  { open: '[TOOL_CALLS]', close: '[/TOOL_CALLS]', keepOpen: false },
  { open: '<function=', close: '</function>', keepOpen: true },
  { open: '<function name=', close: '</function>', keepOpen: true }
];

const heldBack = (s, tag) => { for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) if (s.endsWith(tag.slice(0, n))) return n; return 0; };

function makeToolTextFilter(onText, onCalls, isAllowed) {
  let carry = '', buf = '', block = null;
  if (!isAllowed) return { feed: (raw) => { if (raw) onText(raw); }, flush: () => {} };
  const feed = (raw) => {
    let text = carry + raw; carry = '';
    while (text.length) {
      if (!block) {
        let best = null;
        for (const tag of TEXT_CALL_TAGS) {
          const i = text.indexOf(tag.open);
          if (i !== -1 && (!best || i < best.i)) best = { i, tag };
        }
        if (!best) {
          let hold = 0;
          for (const tag of TEXT_CALL_TAGS) hold = Math.max(hold, heldBack(text, tag.open));
          if (text.length - hold > 0) onText(text.slice(0, text.length - hold));
          carry = text.slice(text.length - hold);
          return;
        }
        if (best.i > 0) onText(text.slice(0, best.i));
        block = best.tag;
        buf = best.tag.keepOpen ? best.tag.open : '';
        text = text.slice(best.i + best.tag.open.length);
      } else {
        const ci = text.indexOf(block.close);
        if (ci === -1) {
          const hold = heldBack(text, block.close);
          buf += text.slice(0, text.length - hold);
          carry = text.slice(text.length - hold);
          return;
        }
        buf += text.slice(0, ci);
        const calls = parseTextToolCalls(buf, isAllowed);
        if (calls.length) onCalls(calls);
        else onText((block.keepOpen ? '' : block.open) + buf + block.close);
        text = text.slice(ci + block.close.length);
        block = null; buf = '';
      }
    }
  };
  const flush = () => {
    if (block) {
      const rest = buf + carry;
      const calls = parseTextToolCalls(rest, isAllowed);
      if (calls.length) onCalls(calls);
      else onText((block.keepOpen ? '' : block.open) + rest);
      block = null; buf = ''; carry = '';
      return;
    }
    if (carry) { onText(carry); carry = ''; }
  };
  return { feed, flush };
}

function makeEmitter(model, onEvent, onCalls, isAllowed) {
  let inThink = false, carry = '';
  const TOPEN = (model.think_open && model.think_open.trim()) || '<think>';
  const TCLOSE = (model.think_close && model.think_close.trim()) || '</think>';
  const contentFilter = makeToolTextFilter((text) => onEvent({ type: 'content', text }), onCalls, isAllowed);
  const reasonFilter = makeToolTextFilter((text) => onEvent({ type: 'reasoning', text }), onCalls, isAllowed);
  const emitContent = (raw) => {
    let text = carry + raw; carry = '';
    while (text.length) {
      if (!inThink) {
        const open = text.indexOf(TOPEN);
        if (open === -1) { const h = heldBack(text, TOPEN); if (text.length - h) contentFilter.feed(text.slice(0, text.length - h)); carry = text.slice(text.length - h); return; }
        if (open > 0) contentFilter.feed(text.slice(0, open));
        text = text.slice(open + TOPEN.length); inThink = true;
      } else {
        const close = text.indexOf(TCLOSE);
        if (close === -1) { const h = heldBack(text, TCLOSE); if (text.length - h) reasonFilter.feed(text.slice(0, text.length - h)); carry = text.slice(text.length - h); return; }
        if (close > 0) reasonFilter.feed(text.slice(0, close));
        text = text.slice(close + TCLOSE.length); inThink = false;
      }
    }
  };
  const emitReasoning = (raw) => { if (raw) reasonFilter.feed(raw); };
  const flush = () => {
    if (carry) { (inThink ? reasonFilter : contentFilter).feed(carry); carry = ''; }
    contentFilter.flush();
    reasonFilter.flush();
  };
  return { emitContent, emitReasoning, flush };
}

function normalizeMessages(protocol, messages) {
  return messages.map(m => {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const calls = m.tool_calls.map((c, i) => ({
        id: c.id || `call_${i}`,
        type: 'function',
        function: {
          name: c.name || c.function?.name || '',
          arguments: protocol === 'ollama'
            ? (c.args ?? safeParse(c.argsText ?? c.function?.arguments) ?? {})
            : (typeof c.argsText === 'string' ? c.argsText : JSON.stringify(c.args ?? safeParse(c.function?.arguments) ?? {}))
        }
      }));
      return { role: 'assistant', content: (m.content && String(m.content).trim()) ? m.content : null, tool_calls: calls };
    }
    if (m.role === 'tool') {
      if (protocol === 'ollama') return { role: 'tool', tool_name: m.name || '', content: String(m.content ?? '') };
      return { role: 'tool', tool_call_id: m.tool_call_id || '', content: String(m.content ?? '') };
    }
    return { role: m.role, content: m.content };
  });
}
function safeParse(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function requestKwargs(model) {
  if (model && model.resolved_kwargs && typeof model.resolved_kwargs === 'object') return model.resolved_kwargs;
  return defaultKwargPayload(model);
}

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
  const { emitContent, emitReasoning, flush } = makeEmitter(model, onEvent, addTextCalls, toolNames.size ? (n) => toolNames.has(n) : null);
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
          return true;
        }
      } catch {}
      return false;
    };
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) if (handle(line)) { flush(); finishCalls(); return; }
    }
    buffer += decoder.decode();
    handle(buffer);
    flush(); finishCalls(); return;
  }

  const res = await fetch(endpoint(base, '/chat/completions'), {
    method: 'POST', headers: authHeaders(key), signal,
    body: JSON.stringify({ model: model.internal_name, messages: wire, stream: true, stream_options: { include_usage: true }, ...(hasTools ? { tools, tool_choice: 'auto' } : {}), ...samplingParams(model, spec), ...requestKwargs(model) })
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
      if (json.usage) { const u = json.usage; onEvent({ type: 'usage', usage: { prompt: u.prompt_tokens || 0, completion: u.completion_tokens || 0, total: u.total_tokens || ((u.prompt_tokens || 0) + (u.completion_tokens || 0)) } }); }
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
    for (const line of lines) if (handle(line)) { flush(); finishCalls(); return; }
  }
  buffer += decoder.decode();
  handle(buffer);
  flush();
  finishCalls();
}

export async function oneShot(model, messages) {
  const { spec, base, key } = modelProvider(model);
  if (spec.protocol === 'ollama') {
    const res = await fetch(endpoint(base, '/api/chat'), {
      method: 'POST', headers: authHeaders(key),
      body: JSON.stringify({ model: model.internal_name, messages, stream: false, think: false, options: ollamaOptions(model, spec), ...stripNestedKwargs(oneShotKwargPayload(model)) })
    });
    if (!res.ok) return '';
    const json = await res.json();
    return json.message?.content?.trim() || '';
  }
  const res = await fetch(endpoint(base, '/chat/completions'), {
    method: 'POST', headers: authHeaders(key),
    body: JSON.stringify({ model: model.internal_name, stream: false, messages, ...oneShotKwargPayload(model) })
  });
  if (!res.ok) return '';
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || '';
}

export function stripThink(model, raw) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const to = (model.think_open && model.think_open.trim()) || '<think>';
  const tc = (model.think_close && model.think_close.trim()) || '</think>';
  return raw.replace(new RegExp(esc(to) + '[\\s\\S]*?' + esc(tc), 'g'), '');
}

export async function generateTitle(model, userText, assistantText) {
  try {
    let raw = await oneShot(model, [
      { role: 'system', content: 'Generate a short 2-5 word title for this conversation. Respond with ONLY a single JSON object in exactly this format and nothing else: {"title": "your concise title here"}. No markdown, no code fences, no commentary. The title must be plain text with no surrounding quotes or trailing punctuation.' },
      { role: 'user', content: `User: ${userText}\nAssistant: ${assistantText}`.slice(0, 1500) }
    ]);
    raw = stripThink(model, raw).replace(/```(?:json)?/gi, '').trim();
    let t = '';
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) { try { const parsed = JSON.parse(match[0]); if (parsed && typeof parsed.title === 'string') t = parsed.title; } catch {} }
    if (!t) t = raw.replace(/^["'#\s]+|["'.\s]+$/g, '').split('\n').pop();
    t = (t || '').replace(/^["'\s]+|["'.\s]+$/g, '').slice(0, 60);
    return t || 'New chat';
  } catch { return 'New chat'; }
}

const SUMMARY_SYSTEM = `You are compacting a long conversation so it can continue without exceeding the context window. Produce a dense, factual summary as internal notes (not addressed to the user), organized under these exact headings, omitting any that are empty:

## Goals
What the user is ultimately trying to accomplish, and their stated intent.

## Decisions
Concrete decisions, conclusions, and agreements reached so far.

## Facts & Constraints
Important values, requirements, names, preferences, and constraints to remember.

## Artifacts & State
Files, code, or documents produced, with their names and current state.

## Open Questions / Next Steps
Anything unresolved or planned.

Be concise but complete. Preserve specifics (names, numbers, snippets) over prose. Omit pleasantries and filler. Output only the summary.`;

export async function summarizeConversation(model, priorSummary, msgs) {
  const flat = msgs.map(m => {
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) text = m.content.map(p => p.type === 'text' ? p.text : '[image]').join(' ');
    text = text.replace(/\[\[OQR:[A-Za-z0-9+/=]+\]\]/g, '');
    return `${(m.role || 'user').toUpperCase()}: ${text}`;
  }).join('\n\n');
  const user = (priorSummary && priorSummary.trim())
    ? `Summary of the conversation up to an earlier point:\n${priorSummary.trim()}\n\nNewer messages to fold into the summary:\n\n${flat}`
    : `Conversation to summarize:\n\n${flat}`;
  try {
    let t = await oneShot(model, [{ role: 'system', content: SUMMARY_SYSTEM }, { role: 'user', content: user }]);
    t = stripThink(model, t).trim();
    return t || priorSummary || '';
  } catch { return priorSummary || ''; }
}
