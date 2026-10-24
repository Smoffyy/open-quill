import { db, getSetting } from '../db.js';
import { oneShot, oneShotFull } from './oneshot.js';
import { canPrefill } from './stream.js';

export function resolveTitleModel(chattingModel) {
  if (getSetting('auto_title_model_mode', 'current') !== 'specific') return chattingModel;
  const id = getSetting('auto_title_model_id', '');
  return (id && db.models.byId(id)) || chattingModel;
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

Be concise but complete. Preserve specifics (names, numbers, snippets) over prose. Images are described in full and kept separately, so refer to an image only briefly by its name. Omit pleasantries and filler. Output only the summary.`;

export function summaryMessages(priorSummary, msgs, maxTokens = 0) {
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
  const system = maxTokens > 0 ? `${SUMMARY_SYSTEM}\n\nThe whole summary must stay well under ${maxTokens} tokens.` : SUMMARY_SYSTEM;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

const skipThinking = new Set();

function closedThought(model) {
  const open = (model.think_open && model.think_open.trim()) || '<think>';
  const close = (model.think_close && model.think_close.trim()) || '</think>';
  return { role: 'assistant', content: open + '\n\n' + close + '\n\n', prefill: true };
}

export async function summarizeConversation(model, priorSummary, msgs, { maxTokens = 0 } = {}) {
  return oneShotAnswer(model, summaryMessages(priorSummary, msgs, maxTokens), { maxTokens });
}

export async function oneShotAnswer(model, messages, { maxTokens = 0 } = {}) {
  const ask = async (list) => {
    try { return stripThink(model, (await oneShotFull(model, list, { maxTokens })).text || '').trim(); }
    catch { return ''; }
  };
  const key = String(model.id || model.internal_name || '');
  if (!skipThinking.has(key)) {
    const text = await ask(messages);
    if (text || !canPrefill(model)) return text;
  }
  const text = await ask([...messages, closedThought(model)]);
  if (text) skipThinking.add(key);
  return text;
}