import { resolveProvider, providerSpec } from './providers.js';

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
  if (summaryText && summaryText.trim()) sys = (sys ? sys + '\n\n' : '') + 'Summary of the earlier part of this conversation (older messages were compacted to save context — treat this as established context):\n' + summaryText.trim();
  if (sandboxPrompt) sys = (sys ? sys + '\n\n' : '') + sandboxPrompt;
  if (model.has_reasoning) {
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

function makeEmitter(model, onEvent) {
  let inThink = false, carry = '';
  const TOPEN = (model.think_open && model.think_open.trim()) || '<think>';
  const TCLOSE = (model.think_close && model.think_close.trim()) || '</think>';
  const heldBack = (s, tag) => { for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) if (s.endsWith(tag.slice(0, n))) return n; return 0; };
  const emitContent = (raw) => {
    let text = carry + raw; carry = '';
    while (text.length) {
      if (!inThink) {
        const open = text.indexOf(TOPEN);
        if (open === -1) { const h = heldBack(text, TOPEN); if (text.length - h) onEvent({ type: 'content', text: text.slice(0, text.length - h) }); carry = text.slice(text.length - h); return; }
        if (open > 0) onEvent({ type: 'content', text: text.slice(0, open) });
        text = text.slice(open + TOPEN.length); inThink = true;
      } else {
        const close = text.indexOf(TCLOSE);
        if (close === -1) { const h = heldBack(text, TCLOSE); if (text.length - h) onEvent({ type: 'reasoning', text: text.slice(0, text.length - h) }); carry = text.slice(text.length - h); return; }
        if (close > 0) onEvent({ type: 'reasoning', text: text.slice(0, close) });
        text = text.slice(close + TCLOSE.length); inThink = false;
      }
    }
  };
  const flush = () => { if (carry) { onEvent({ type: inThink ? 'reasoning' : 'content', text: carry }); carry = ''; } };
  return { emitContent, flush };
}

export async function streamCompletion({ model, messages, signal, onEvent }) {
  const { spec, base, key } = modelProvider(model);
  const { emitContent, flush } = makeEmitter(model, onEvent);

  if (spec.protocol === 'ollama') {
    const res = await fetch(endpoint(base, '/api/chat'), {
      method: 'POST', headers: authHeaders(key), signal,
      body: JSON.stringify({ model: model.internal_name, messages, stream: true, think: !!model.has_reasoning, options: ollamaOptions(model, spec) })
    });
    if (!res.ok || !res.body) { const t = await res.text().catch(() => ''); throw new Error(`Upstream error ${res.status}: ${t.slice(0, 300)}`); }
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    const handle = (line) => {
      const t = line.trim(); if (!t) return false;
      try {
        const json = JSON.parse(t);
        const msg = json.message || {};
        if (msg.thinking) onEvent({ type: 'reasoning', text: msg.thinking });
        if (msg.content) emitContent(msg.content);
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
      for (const line of lines) if (handle(line)) { flush(); return; }
    }
    buffer += decoder.decode();
    handle(buffer);
    flush(); return;
  }

  const res = await fetch(endpoint(base, '/chat/completions'), {
    method: 'POST', headers: authHeaders(key), signal,
    body: JSON.stringify({ model: model.internal_name, messages, stream: true, stream_options: { include_usage: true }, ...samplingParams(model, spec) })
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
      if (delta.reasoning_content) onEvent({ type: 'reasoning', text: delta.reasoning_content });
      if (delta.reasoning) onEvent({ type: 'reasoning', text: delta.reasoning });
      if (delta.content) emitContent(delta.content);
    } catch {}
    return false;
  };
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) if (handle(line)) { flush(); return; }
  }
  buffer += decoder.decode();
  handle(buffer);
  flush();
}

export async function oneShot(model, messages) {
  const { spec, base, key } = modelProvider(model);
  if (spec.protocol === 'ollama') {
    const res = await fetch(endpoint(base, '/api/chat'), {
      method: 'POST', headers: authHeaders(key),
      body: JSON.stringify({ model: model.internal_name, messages, stream: false, think: false, options: ollamaOptions(model, spec) })
    });
    if (!res.ok) return '';
    const json = await res.json();
    return json.message?.content?.trim() || '';
  }
  const res = await fetch(endpoint(base, '/chat/completions'), {
    method: 'POST', headers: authHeaders(key),
    body: JSON.stringify({ model: model.internal_name, stream: false, messages })
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
