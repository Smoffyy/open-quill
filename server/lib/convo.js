import { db, getSetting } from '../db.js';
import { oneShot, stripThink, summarizeConversation } from '../llm/index.js';
import { resolveProvider } from '../providers.js';
import { activePath } from './tree.js';
import { historyText } from './history.js';
import { isTextLike, readUploadText, readImageDataUri } from './uploads.js';
import { modelCtx } from './models.js';
import { pinnedFilesPrompt } from './prompts.js';
import { llamaTokenCount, isLlamaCpp } from './llamacpp.js';

export const STYLE_PRESETS = {
  __proto__: null,
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
export function historyRows(chat, model) {
  const fresh = db.chats.byId(chat.id) || chat;
  const upto = fresh.summary && fresh.summary_upto ? fresh.summary_upto : 0;
  return activePath(chat.id).map(m => ({
    id: m.id,
    role: m.role,
    pinned: !!m.pinned,
    excluded: !!m.excluded,
    summarized: !!(upto && m.created_at <= upto && !m.pinned),
    msg: historyMessage(m, model)
  }));
}

export function chatHistory(chat, model) {
  return historyRows(chat, model).filter(r => !r.summarized && !r.excluded).map(r => r.msg);
}

function historyMessage(m, model) {
  let text = historyText(m.content || '').replace(/\n{3,}/g, '\n\n');
  const atts = m.attachments || [];
  const images = [];
  if (atts.length) {
    const notes = [];
    for (const a of atts) {
      const isImage = a.type && a.type.startsWith('image/');
      if (isImage && model.has_vision) { const uri = readImageDataUri(a); if (uri) images.push(uri); }
      else if (isImage) notes.push(`[Attached image: ${a.name} — this model cannot see images, so tell the user you cannot view it.]`);
      else if (isTextLike(a)) {
        const body = readUploadText(a.url);
        notes.push(body
          ? `--- Attached file: ${a.name} ---\n${body}`
          : `[Attached file: ${a.name} — the file is empty or could not be read.]`);
      } else notes.push(`[Attached file: ${a.name} — this is a binary format the server cannot read as text, so its contents are not available to you. Say so rather than guessing what it contains.]`);
    }
    if (notes.length) text = (text ? text + '\n\n' : '') + notes.join('\n\n');
  }
  if (!images.length) return { role: m.role, content: text };
  const parts = [];
  if (text) parts.push({ type: 'text', text });
  for (const url of images) parts.push({ type: 'image_url', image_url: { url } });
  return { role: m.role, content: parts };
}

export const textTokens = estTextTokens;

function countCjk(s, from, to) {
  let cjk = 0;
  for (let i = from; i < to; i++) { const c = s.charCodeAt(i); if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af)) cjk++; }
  return cjk;
}

const TOK_CACHE = new Map();
const TOK_CACHE_MIN = 1024;
const TOK_CACHE_MAX_CHARS = 4 << 20;
let tokCacheChars = 0;

function estTextTokens(s) {
  if (!s) return 0;
  if (s.length < TOK_CACHE_MIN) {
    const c = countCjk(s, 0, s.length);
    return Math.ceil((s.length - c) / 3.6) + c;
  }
  const hit = TOK_CACHE.get(s);
  if (hit !== undefined) {
    TOK_CACHE.delete(s);
    TOK_CACHE.set(s, hit);
    return hit;
  }
  const cjk = countCjk(s, 0, s.length);
  const n = Math.ceil((s.length - cjk) / 3.6) + cjk;
  if (s.length <= TOK_CACHE_MAX_CHARS) {
    TOK_CACHE.set(s, n);
    tokCacheChars += s.length;
    while (tokCacheChars > TOK_CACHE_MAX_CHARS) {
      const oldest = TOK_CACHE.keys().next().value;
      if (oldest === undefined) break;
      tokCacheChars -= oldest.length;
      TOK_CACHE.delete(oldest);
    }
  }
  return n;
}

export function makeTokenCounter() {
  let plain = 0, cjk = 0;
  return {
    add(chunk) {
      if (!chunk) return;
      const c = countCjk(chunk, 0, chunk.length);
      cjk += c;
      plain += chunk.length - c;
    },
    get tokens() { return Math.ceil(plain / 3.6) + cjk; }
  };
}

export function messageTokens(m) {
  let total = 4;
  if (typeof m.content === 'string') total += estTextTokens(m.content);
  else if (Array.isArray(m.content)) for (const p of m.content) total += p.type === 'text' ? estTextTokens(p.text || '') : 850;
  if (Array.isArray(m.tool_calls)) for (const c of m.tool_calls) total += estTextTokens((c.argsText || '') + (c.name || '')) + 8;
  return total;
}

export function estimateTokens(messages) {
  let total = 0;
  for (const m of messages) total += messageTokens(m);
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
  const ratio = calibRatio(chatId);
  const n = msgs.length;
  const costs = new Array(n);
  let est = 0;
  let nonSysCount = 0;
  for (let i = 0; i < n; i++) {
    const c = messageTokens(msgs[i]);
    costs[i] = c;
    est += c;
    if (msgs[i].role !== 'system') nonSysCount++;
  }
  const scaled = () => Math.round(est * ratio);
  if (scaled() <= budget) return { msgs, dropped: 0, trimmed: false };
  const drop = new Uint8Array(n);
  let dropped = 0;
  for (let i = 0; i < n && nonSysCount > 1 && scaled() > budget; i++) {
    if (msgs[i].role === 'system') continue;
    drop[i] = 1;
    est -= costs[i];
    nonSysCount--;
    dropped++;
  }
  const out = [];
  const cost = [];
  for (let i = 0; i < n; i++) if (!drop[i]) { out.push(msgs[i]); cost.push(costs[i]); }
  let trimmed = false;
  if (scaled() > budget) {
    const i = out.findIndex(m => m.role !== 'system');
    if (i !== -1) {
      const allowed = budget - Math.round((est - cost[i]) * ratio) - 8;
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

export const FALLBACK_CTX = 8192;

export function compactThreshold(model, ctxOverride) {
  if (!model.enable_summaries) return Infinity;
  const over = parseInt(ctxOverride, 10);
  const manual = parseInt(model.num_ctx, 10);
  const ctx = (Number.isFinite(over) && over > 0) ? over : ((Number.isFinite(manual) && manual > 0) ? manual : FALLBACK_CTX);
  const padding = Math.max(0.03, Math.min(0.6, model.summary_padding || 0.125));
  return Math.floor(ctx * (1 - padding));
}

export async function exactTokens(chatId, model, messages) {
  if (isLlamaCpp(model)) {
    const n = await llamaTokenCount(model, messages);
    if (n > 0) {
      updateCalib(chatId, n, estimateTokens(messages));
      return n;
    }
  }
  return calibratedTokens(chatId, messages);
}

const TOOL_TRIM_NOTE = '[Tool output trimmed to fit the context window. Re-run the tool if you need the full result.]';

export function trimInTurn(inTurn, keepRecent = 2) {
  const toolIdx = [];
  for (let i = 0; i < inTurn.length; i++) if (inTurn[i] && inTurn[i].role === 'tool') toolIdx.push(i);
  if (toolIdx.length <= keepRecent) return { list: inTurn, trimmed: 0 };
  const protect = new Set(toolIdx.slice(-keepRecent));
  let trimmed = 0;
  const list = inTurn.map((m, i) => {
    if (m.role !== 'tool' || protect.has(i)) return m;
    const text = String(m.content ?? '');
    if (text.length <= 400 || m.__trimmed) return m;
    trimmed++;
    return { ...m, __trimmed: true, content: text.slice(0, 200) + '\n' + TOOL_TRIM_NOTE + '\n' + text.slice(-200) };
  });
  return { list, trimmed };
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

export function calibRatio(chatId) {
  const c = chatId && tokenCalib.get(chatId);
  return c ? c.ratio : 1;
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

function userMemoryBlock(u) {
  if (getSetting('memory_enabled', '0') !== '1') return '';
  if (!u || u.prefs?.memoryEnabled === false) return '';
  const mem = (u.memory || '').trim();
  if (!mem) return '';
  return 'Things you remember about this user from earlier conversations (the user can view and edit this memory at any time):\n' + mem;
}

export function combinedInstructions(chat) {
  const userId = chat && chat.user_id;
  const u = userId ? db.users.byId(userId) : null;
  const parts = [];
  const ui = (u && u.instructions) ? u.instructions : '';
  if (ui && ui.trim()) parts.push(ui.trim());
  const mem = userMemoryBlock(u);
  if (mem) parts.push(mem);
  if (chat && chat.instructions && chat.instructions.trim()) parts.push(chat.instructions.trim());
  return parts.join('\n\n');
}

export function instrFor(chat) {
  const base = combinedInstructions(chat);
  let pinned;
  try { pinned = pinnedFilesPrompt(chat); } catch { pinned = ''; }
  return pinned ? (base ? base + '\n\n' + pinned : pinned) : base;
}
