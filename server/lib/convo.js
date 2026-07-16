import { db, getSetting } from '../db.js';
import { oneShot, stripThink, summarizeConversation } from '../llm.js';
import { resolveProvider } from '../providers.js';
import { activePath } from './tree.js';
import { historyText } from './history.js';
import { isTextLike, readUploadText, readImageDataUri } from './uploads.js';
import { modelCtx } from './models.js';
import { pinnedFilesPrompt, lastUserQuery } from './prompts.js';

export const STYLE_PRESETS = {
  concise: 'Respond concisely. Get to the point immediately, cut filler, hedging, and restatement, and keep answers as short as they can be while remaining complete and correct. Prefer tight prose over long lists.',
  explanatory: 'Respond in an explanatory, educational way. Walk through the reasoning behind answers, define terms the user may not know, use short examples or analogies where they aid understanding, and make sure the user leaves knowing WHY, not just WHAT.',
  formal: 'Respond in a polished, professional register suitable for business or academic contexts. Use complete sentences, precise vocabulary, and a measured tone. Avoid slang, contractions where practical, and overly casual phrasing.'
};

export function styleTextFor(userId, styleId) {
  const id = String(styleId || '').trim();
  if (!id || id === 'normal') return '';
  if (STYLE_PRESETS[id]) return STYLE_PRESETS[id];
  const u = userId ? db.users.byId(userId) : null;
  const custom = (Array.isArray(u?.styles) ? u.styles : []).find(x => x.id === id);
  return custom && custom.prompt ? String(custom.prompt) : '';
}

// history for the active branch, minus whatever the summary already covers
export async function chatHistory(chat, model) {
  const fresh = db.chats.byId(chat.id) || chat;
  const upto = fresh.summary && fresh.summary_upto ? fresh.summary_upto : 0;
  let rows = activePath(chat.id);
  if (upto) rows = rows.filter(m => m.created_at > upto || m.pinned);
  return rows.map(m => {
    let text = historyText(m.content || '').replace(/\n{3,}/g, '\n\n');
    const atts = m.attachments || [];
    const images = [];
    if (atts.length) {
      const notes = [];
      for (const a of atts) {
        const isImage = a.type && a.type.startsWith('image/');
        if (isImage && model.has_vision) { const uri = readImageDataUri(a); if (uri) images.push(uri); }
        else if (isTextLike(a)) notes.push(`--- Attached file: ${a.name} ---\n${readUploadText(a.url)}`);
        else notes.push(`[Attached ${isImage ? 'image' : 'file'}: ${a.name}]`);
      }
      if (notes.length) text = (text ? text + '\n\n' : '') + notes.join('\n\n');
    }
    if (images.length) {
      const parts = [];
      if (text) parts.push({ type: 'text', text });
      for (const url of images) parts.push({ type: 'image_url', image_url: { url } });
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: text };
  });
}

function estTextTokens(s) {
  if (!s) return 0;
  let cjk = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af)) cjk++; }
  return Math.ceil((s.length - cjk) / 3.6) + cjk;
}

export function estimateTokens(messages) {
  let total = 0;
  for (const m of messages) {
    total += 4;
    if (typeof m.content === 'string') total += estTextTokens(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) total += p.type === 'text' ? estTextTokens(p.text || '') : 850;
    if (Array.isArray(m.tool_calls)) for (const c of m.tool_calls) total += estTextTokens((c.argsText || '') + (c.name || '')) + 8;
  }
  return total;
}

const CTX_TRIM_NOTE = '[Earlier part of this message was trimmed to fit the model context window.]\n\n';
function trimMsgToTokens(m, allowedTokens) {
  const keep = Math.max(400, Math.floor(Math.max(60, allowedTokens) * 3.4));
  if (typeof m.content === 'string') {
    if (m.content.length <= keep) return m;
    return { ...m, content: CTX_TRIM_NOTE + m.content.slice(-keep) };
  }
  if (Array.isArray(m.content)) {
    let joined = m.content.filter(p => p.type === 'text').map(p => p.text || '').join('\n\n');
    if (joined.length > keep) joined = CTX_TRIM_NOTE + joined.slice(-keep);
    return { ...m, content: joined || '[content trimmed to fit the model context window]' };
  }
  return m;
}

export function truncateForRollingCtx(chatId, msgs, ctx) {
  const reserve = Math.min(Math.max(256, Math.floor(ctx * 0.15)), 1536);
  const budget = Math.max(512, ctx - reserve);
  if (calibratedTokens(chatId, msgs) <= budget) return { msgs, dropped: 0, trimmed: false };
  const out = msgs.slice();
  let dropped = 0;
  const nonSys = () => out.reduce((a, m, i) => { if (m.role !== 'system') a.push(i); return a; }, []);
  while (calibratedTokens(chatId, out) > budget) {
    const idxs = nonSys();
    if (idxs.length <= 1) break;
    out.splice(idxs[0], 1);
    dropped++;
  }
  let trimmed = false;
  if (calibratedTokens(chatId, out) > budget) {
    const idxs = nonSys();
    if (idxs.length) {
      const i = idxs[0];
      const rest = out.filter((_, j) => j !== i);
      const allowed = budget - calibratedTokens(chatId, rest) - 8;
      const before = out[i];
      out[i] = trimMsgToTokens(before, allowed);
      trimmed = out[i] !== before;
    }
  }
  return { msgs: out, dropped, trimmed };
}

export async function rollingCtxFor(model) {
  if (model.enable_summaries) return 0;
  const prov = resolveProvider(model.provider_id);
  if (!prov || prov.type !== 'llamacpp') return 0;
  const ctx = await modelCtx(model);
  return ctx > 0 ? ctx : 0;
}

// once we get near the context limit, fold older turns into chat.summary
// one summarization pass over older persisted turns; returns true if it compacted
async function describeImageForSummary(model, a) {
  if (!model || !model.has_vision) return '';
  const uri = readImageDataUri(a);
  if (!uri) return '';
  try {
    let d = await oneShot(model, [
      { role: 'system', content: 'You write short factual descriptions of images so their content survives in a text-only conversation summary. Reply with 1-3 plain sentences describing what the image shows, including any visible text. No preamble, no markdown.' },
      { role: 'user', content: [{ type: 'text', text: `Describe the attached image "${a.name || 'image'}" concisely.` }, { type: 'image_url', image_url: { url: uri } }] }
    ]);
    d = stripThink(model, d).trim().replace(/\s+/g, ' ');
    return d.slice(0, 700);
  } catch { return ''; }
}

async function enrichForSummary(model, rows) {
  const out = [];
  for (const m of rows) {
    let text = m.content || '';
    const atts = Array.isArray(m.attachments) ? m.attachments : [];
    const notes = [];
    let changed = false;
    for (const a of atts) {
      const isImage = a.type && a.type.startsWith('image/');
      if (!isImage) continue;
      let d = typeof a.summary_desc === 'string' ? a.summary_desc : '';
      if (!d) {
        d = await describeImageForSummary(model, a);
        if (d) { a.summary_desc = d; changed = true; }
      }
      notes.push(d ? `[Attached image "${a.name || 'image'}": ${d}]` : `[Attached image: ${a.name || 'image'}]`);
    }
    if (changed) { try { db.messages.update(m.id, { attachments: atts }); } catch {} }
    if (notes.length) text = (text ? text + '\n\n' : '') + notes.join('\n');
    out.push({ role: m.role, content: text });
  }
  return out;
}

export async function compactStep(ws, chat, model) {
  const fresh = db.chats.byId(chat.id);
  const upto = fresh.summary && fresh.summary_upto ? fresh.summary_upto : 0;
  const recent = recentWindow(model);
  const after = activePath(chat.id).filter(m => m.created_at > upto);
  if (after.length <= recent + 1) return false;
  const cut = after.length - recent;
  const toSummarize = after.slice(0, cut).filter(m => !m.pinned);
  if (!toSummarize.length) return false;
  const marker = after[cut - 1].created_at;
  try { ws.send(JSON.stringify({ type: 'compacting', chatId: chat.id })); } catch {}
  const enriched = await enrichForSummary(model, toSummarize);
  const summary = await summarizeConversation(model, fresh.summary, enriched);
  db.chats.update(chat.id, { summary, summary_upto: marker });
  try { ws.send(JSON.stringify({ type: 'compacted', chatId: chat.id })); } catch {}
  return !!summary;
}

export function recentWindow(model) {
  const n = parseInt(model && model.recent_window);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

export function compactThreshold(model, ctxOverride) {
  const ctx = Number.isFinite(parseInt(ctxOverride)) && parseInt(ctxOverride) > 0 ? parseInt(ctxOverride) : parseInt(model.num_ctx);
  if (!model.enable_summaries || !ctx || ctx <= 0) return Infinity;
  const padding = Math.max(0.03, Math.min(0.6, model.summary_padding || 0.125));
  return Math.floor(ctx * (1 - padding));
}

export const tokenCalib = new Map();

export function updateCalib(chatId, actualPrompt, estimated) {
  if (!chatId || !actualPrompt || !estimated || estimated < 200) return;
  const raw = actualPrompt / estimated;
  if (!Number.isFinite(raw)) return;
  const ratio = Math.max(0.25, Math.min(4, raw));
  const prev = tokenCalib.get(chatId);
  tokenCalib.set(chatId, { ratio: prev ? prev.ratio * 0.4 + ratio * 0.6 : ratio, at: Date.now() });
  if (tokenCalib.size > 2000) {
    const cutoff = Date.now() - 6 * 3600 * 1000;
    for (const [k, v] of tokenCalib) if (v.at < cutoff) tokenCalib.delete(k);
  }
}

export function calibratedTokens(chatId, messages) {
  const est = estimateTokens(messages);
  const c = chatId && tokenCalib.get(chatId);
  return c ? Math.round(est * c.ratio) : est;
}

export function promptVars(userId) {
  const u = userId ? db.users.byId(userId) : null;
  const name = u ? (u.display_name || (u.email ? u.email.split('@')[0] : '') || 'User') : 'User';
  const now = new Date();
  let dt;
  try { dt = now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }); }
  catch { dt = now.toString(); }
  return { currentUser: name, currentDateTime: dt };
}

function userInstructions(userId) {
  const u = userId ? db.users.byId(userId) : null;
  return (u && u.instructions) ? u.instructions : '';
}

function userMemoryBlock(userId) {
  if (getSetting('memory_enabled', '0') !== '1') return '';
  const u = userId ? db.users.byId(userId) : null;
  if (!u || u.prefs?.memoryEnabled === false) return '';
  const mem = (u.memory || '').trim();
  if (!mem) return '';
  return 'Things you remember about this user from earlier conversations (the user can view and edit this memory at any time):\n' + mem;
}

export function combinedInstructions(chat) {
  const parts = [];
  const ui = userInstructions(chat && chat.user_id);
  if (ui && ui.trim()) parts.push(ui.trim());
  const mem = userMemoryBlock(chat && chat.user_id);
  if (mem) parts.push(mem);
  if (chat && chat.instructions && chat.instructions.trim()) parts.push(chat.instructions.trim());
  return parts.join('\n\n');
}

export async function instrFor(chat, query) {
  const base = combinedInstructions(chat);
  let pinned = '';
  try { pinned = await pinnedFilesPrompt(chat, query == null ? lastUserQuery(chat.id) : query); } catch { pinned = ''; }
  return pinned ? (base ? base + '\n\n' + pinned : pinned) : base;
}
