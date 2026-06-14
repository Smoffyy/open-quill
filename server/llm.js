import { getSetting } from './db.js';

function endpoint(p) {
  const base = (getSetting('api_base_url') || 'http://localhost:1234/v1').replace(/\/$/, '');
  return base + p;
}
function authHeaders() {
  const key = getSetting('api_key') || '';
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

function applyPromptVars(text, vars) {
  if (!text) return text || '';
  return text
    .replace(/\{\{\s*currentDateTime\s*\}\}/gi, (vars && vars.currentDateTime) || '')
    .replace(/\{\{\s*currentUser\s*\}\}/gi, (vars && vars.currentUser) || '');
}

// system prompt order: base, summary, sandbox, then the reasoning toggle token last
export function buildMessages(model, history, extended, sandboxPrompt, summaryText, vars = {}) {
  let sys = applyPromptVars(model.system_prompt || '', vars);
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

// only the params the admin actually filled in get sent; everything else is left to the server default
export function samplingParams(model) {
  const out = {};
  const fl = (v) => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
  const it = (v) => (v === '' || v == null || isNaN(parseInt(v))) ? null : parseInt(v);
  const map = { temperature: fl, top_p: fl, presence_penalty: fl, frequency_penalty: fl, repetition_penalty: fl, min_p: fl, top_k: it, seed: it };
  for (const [k, conv] of Object.entries(map)) { const v = conv(model[k]); if (v != null) out[k] = v; }
  return out;
}
export async function streamCompletion({ model, messages, signal, onEvent }) {
  const res = await fetch(endpoint('/chat/completions'), {
    method: 'POST',
    headers: authHeaders(),
    signal,
    body: JSON.stringify({ model: model.internal_name, messages, stream: true, ...samplingParams(model) })
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`Upstream error ${res.status}: ${t.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let inThink = false;
  let carry = '';
  const TOPEN = (model.think_open && model.think_open.trim()) || '<think>';
  const TCLOSE = (model.think_close && model.think_close.trim()) || '</think>';

  // longest suffix of s that is a prefix of tag — so a tag split across chunks isn't missed
  const heldBack = (s, tag) => {
    for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) if (s.endsWith(tag.slice(0, n))) return n;
    return 0;
  };
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') { flush(); return; }
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta || {};
        if (delta.reasoning_content) onEvent({ type: 'reasoning', text: delta.reasoning_content });
        if (delta.reasoning) onEvent({ type: 'reasoning', text: delta.reasoning });
        if (delta.content) emitContent(delta.content);
      } catch { /* keep-alive / partial line */ }
    }
  }
  flush();
}

export async function generateTitle(model, userText, assistantText) {
  try {
    const res = await fetch(endpoint('/chat/completions'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: model.internal_name,
        stream: false,
        messages: [
          { role: 'system', content: 'Generate a short 2-5 word title for this conversation. Reply with the title only, no quotes, no punctuation at the end.' },
          { role: 'user', content: `User: ${userText}\nAssistant: ${assistantText}`.slice(0, 1500) }
        ]
      })
    });
    const json = await res.json();
    let t = json.choices?.[0]?.message?.content?.trim() || '';
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const to = (model.think_open && model.think_open.trim()) || '<think>';
    const tc = (model.think_close && model.think_close.trim()) || '</think>';
    t = t.replace(/^["'#\s]+|["'.\s]+$/g, '').replace(new RegExp(esc(to) + '[\\s\\S]*?' + esc(tc), 'g'), '').trim();
    return t.split('\n').pop().slice(0, 60) || 'New chat';
  } catch { return 'New chat'; }
}

const SUMMARY_SYSTEM = `You are compacting a long conversation so it can continue without exceeding the context window. Write a thorough but concise summary of everything so far, in past tense as notes. PRESERVE: the user's goals and intent, every decision made, concrete facts and requirements, the state and names of any files/code produced, important values or snippets, and any open questions or next steps. OMIT pleasantries and filler. Do not address the user; this is internal context. Output only the summary.`;

export async function summarizeConversation(model, priorSummary, msgs) {
  const flat = msgs.map(m => {
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) text = m.content.map(p => p.type === 'text' ? p.text : '[image]').join(' ');
    return `${(m.role || 'user').toUpperCase()}: ${text}`;
  }).join('\n\n');
  const user = (priorSummary && priorSummary.trim())
    ? `Summary of the conversation up to an earlier point:\n${priorSummary.trim()}\n\nNewer messages to fold into the summary:\n\n${flat}`
    : `Conversation to summarize:\n\n${flat}`;
  try {
    const res = await fetch(endpoint('/chat/completions'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ model: model.internal_name, stream: false, messages: [{ role: 'system', content: SUMMARY_SYSTEM }, { role: 'user', content: user }] })
    });
    const json = await res.json();
    let t = json.choices?.[0]?.message?.content?.trim() || '';
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const to = (model.think_open && model.think_open.trim()) || '<think>';
    const tc = (model.think_close && model.think_close.trim()) || '</think>';
    t = t.replace(new RegExp(esc(to) + '[\\s\\S]*?' + esc(tc), 'g'), '').trim();
    return t || priorSummary || '';
  } catch { return priorSummary || ''; }
}
