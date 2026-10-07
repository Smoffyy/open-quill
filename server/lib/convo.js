import { db, getSetting } from '../db.js';
import { roleOf } from './roles.js';
import { memberContext, languageName } from './memberctx.js';
import { docsVars } from './modeldocs.js';
import { summarizeConversation, summaryMessages, oneShotAnswer } from '../llm/index.js';
import { activePath } from './tree.js';
import { historyText } from './history.js';
import { isTextLike, readUploadText, readImageDataUri, imageKind, imageMime } from './uploads.js';
import { isDocumentName } from './extract.js';
import { contextBudget, canCount, countExact } from './ctxwindow.js';

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
    summarized: !!(upto && m.created_at <= upto && !m.pinned),
    msg: historyMessage(m, model)
  }));
}

export function chatHistory(chat, model, skipId = null) {
  return historyRows(chat, model).filter(r => !r.summarized && r.id !== skipId).map(r => r.msg);
}

export const CUT_NOTE = '[This reply was cut off here before it was finished.]';
const ACTIVITY_NOTE = '[What happened during this reply, in order. Times are UTC.]';

function stamp(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function activityText(list) {
  return list.map(e => {
    const when = stamp(e.at);
    if (e.kind === 'call') return `[${when}] Tool call: ${e.name}\nArguments: ${e.args}`;
    if (e.kind === 'result') return `[${when}] Result of ${e.name} (${e.ok ? 'succeeded' : 'failed'}):\n${e.text}`;
    if (e.kind === 'steer') return `[${when}] The user steered this reply part way through:\n${e.notes.map(n => '- ' + n).join('\n')}`;
    return `[${when}] ${e.text}`;
  }).join('\n\n');
}

function historyMessage(m, model) {
  let text = historyText(m.content || '').replace(/\n{3,}/g, '\n\n');
  if (m.role === 'assistant' && m.truncated) text = (text.trim() ? text.trimEnd() + '\n\n' : '') + CUT_NOTE;
  if (m.role === 'assistant' && Array.isArray(m.activity) && m.activity.length) {
    text = ACTIVITY_NOTE + '\n\n' + activityText(m.activity) + (text.trim() ? '\n\nReply:\n' + text : '');
  }
  const atts = m.attachments || [];
  const images = [];
  if (atts.length) {
    const notes = [];
    for (const a of atts) {
      const kind = imageKind(a);
      if (kind === 'vision' && model.has_vision) { const uri = readImageDataUri(a); if (uri) images.push(uri); }
      else if (kind === 'other' && model.has_vision) notes.push(`[Attached image: ${a.name} - its format (${imageMime(a)}) cannot be passed to the model, so you cannot view it. Ask the user for a PNG, JPEG, GIF or WebP copy.]`);
      else if (kind) notes.push(`[Attached image: ${a.name} — this model cannot see images, so tell the user you cannot view it.]`);
      else if (isTextLike(a)) {
        const body = readUploadText(a.url);
        notes.push(body
          ? `--- Attached file: ${a.name} ---\n${body}`
          : `[Attached file: ${a.name} — the file is empty or could not be read.]`);
      } else if (isDocumentName(a.name)) notes.push(`[Attached file: ${a.name} - no readable text could be extracted from this document (it may be scanned images only, password protected, or damaged), so its contents are not available to you. Say so rather than guessing what it contains.]`);
      else notes.push(`[Attached file: ${a.name}${a.type ? ` (${a.type})` : ''} - this is a binary format the server cannot read as text, so its contents are not available to you. Say so rather than guessing what it contains.]`);
    }
    if (notes.length) text = (text ? text + '\n\n' : '') + notes.join('\n\n');
  }
  if (!images.length) return { role: m.role, content: text };
  const parts = [];
  if (text) parts.push({ type: 'text', text });
  for (const url of images) parts.push({ type: 'image_url', image_url: { url } });
  return { role: m.role, content: parts };
}

const IMAGE_DETAIL_TOKENS = 1024;
const MAX_SUMMARY_IMAGES = 24;
const DESCRIBE_IMAGE = 'You describe an image in full detail so the description can stand in for the image later, in a text-only conversation. Cover what it shows, its layout and composition, every piece of visible text quoted exactly, all numbers, labels and colours, and anything else someone might ask about. Plain prose, no preamble.';

async function describeImage(model, a) {
  if (!model || !model.has_vision) return '';
  const uri = readImageDataUri(a);
  if (!uri) return '';
  return oneShotAnswer(model, [
    { role: 'system', content: DESCRIBE_IMAGE },
    { role: 'user', content: [{ type: 'text', text: `Describe the attached image "${a.name || 'image'}".` }, { type: 'image_url', image_url: { url: uri } }] }
  ], { maxTokens: IMAGE_DETAIL_TOKENS });
}

async function enrichForSummary(model, rows) {
  const out = [];
  for (const m of rows) {
    let text = m.content || '';
    const atts = Array.isArray(m.attachments) ? m.attachments : [];
    const notes = [];
    const images = [];
    let changed = false;
    for (const a of atts) {
      if (imageKind(a) !== 'vision') continue;
      const name = a.name || 'image';
      let detail = typeof a.image_detail === 'string' ? a.image_detail : '';
      if (!detail) {
        detail = await describeImage(model, a);
        if (detail) { a.image_detail = detail; changed = true; }
      }
      if (detail) images.push({ url: a.url, name, detail });
      notes.push(detail ? `[Attached image "${name}": ${detail}]` : `[Attached image: ${name}]`);
    }
    if (changed) { try { db.messages.update(m.id, { attachments: atts }); } catch {} }
    if (notes.length) text = (text ? text + '\n\n' : '') + notes.join('\n');
    out.push({ role: m.role, content: text, images });
  }
  return out;
}

function keepImages(prev, added) {
  const list = (Array.isArray(prev) ? prev : []).filter(i => !added.some(a => a.url === i.url));
  return [...list, ...added].slice(-MAX_SUMMARY_IMAGES);
}

export function summaryText(row, recallOn = false) {
  const summary = String(row?.summary || '').trim();
  const images = Array.isArray(row?.summary_images) ? row.summary_images : [];
  if (!images.length) return summary;
  const lead = recallOn
    ? 'These images were shared earlier and are no longer attached. To look at one again, call recall with its name.'
    : 'These images were shared earlier and are no longer attached.';
  const lines = images.map(i => `- "${i.name}": ${i.detail}`);
  return (summary ? summary + '\n\n' : '') + '## Images from earlier in the conversation\n' + lead + '\n' + lines.join('\n');
}

const FOLD_AT = 0.65;
const FOLD_TO = 0.4;
const MAX_FOLDS = 4;
const SHORTEN_TRIES = 6;
const folding = new Set();

export function recentWindow(model) {
  const n = parseInt(model && model.recent_window);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

function summaryCap(ctx) {
  return Math.max(256, Math.min(2048, Math.floor(ctx * 0.25)));
}

function halve(msg) {
  const text = String(msg.content || '');
  const keep = Math.floor(text.length / 4);
  return { ...msg, content: text.slice(0, keep) + '\n\n[... middle of this message left out of the summary ...]\n\n' + text.slice(-keep) };
}

async function fitBatch(model, prior, entries, cap, room) {
  const fits = async (k) => {
    const msgs = entries.slice(0, k).filter(e => e.msg).map(e => e.msg);
    if (!msgs.length) return true;
    const n = await countExact(model, summaryMessages(prior, msgs, cap));
    return n > 0 && n <= room;
  };
  if (await fits(entries.length)) return entries.length;
  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (await fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  if (lo > 0) return lo;
  const first = entries.findIndex(e => e.msg);
  if (first === -1) return 0;
  for (let i = 0; i < SHORTEN_TRIES; i++) {
    entries[first].msg = halve(entries[first].msg);
    if (await fits(first + 1)) return first + 1;
  }
  return 0;
}

export async function foldStep(ws, chat, model) {
  const fresh = db.chats.byId(chat.id);
  const upto = fresh.summary && fresh.summary_upto ? fresh.summary_upto : 0;
  const after = activePath(chat.id).filter(m => m.created_at > upto);
  const recent = recentWindow(model);
  if (after.length <= recent + 1) return false;
  const batch = after.slice(0, after.length - recent);
  const { ctx } = await contextBudget(model);
  const cap = ctx > 0 ? summaryCap(ctx) : 0;
  const prior = fresh.summary || '';
  const enriched = await enrichForSummary(model, batch.filter(m => !m.pinned));
  let next = 0;
  const entries = batch.map(row => ({ row, msg: row.pinned ? null : enriched[next++] }));
  const exact = canCount(model) && ctx > 0;
  let take = exact ? await fitBatch(model, prior, entries, cap, ctx - cap) : entries.length;
  if (!take) return false;
  if (ws) { try { ws.send(JSON.stringify({ type: 'compacting', chatId: chat.id })); } catch {} }
  let summary = '';
  while (take > 0) {
    const msgs = entries.slice(0, take).filter(e => e.msg).map(e => e.msg);
    summary = msgs.length ? await summarizeConversation(model, prior, msgs, { maxTokens: cap }) : prior;
    if (summary || exact) break;
    take = Math.floor(take / 2);
  }
  if (summary) {
    const images = entries.slice(0, take).flatMap(e => (e.msg && e.msg.images) || []);
    db.chats.update(chat.id, { summary, summary_upto: entries[take - 1].row.created_at, ...(images.length ? { summary_images: keepImages(fresh.summary_images, images) } : {}) });
  }
  if (ws) { try { ws.send(JSON.stringify({ type: 'compacted', chatId: chat.id })); } catch {} }
  return !!summary;
}

export async function foldHistory(chat, model, used, measure = null) {
  if (folding.has(chat.id)) return false;
  const { ctx } = await contextBudget(model);
  if (!(ctx > 0) || !(used > ctx * FOLD_AT)) return false;
  folding.add(chat.id);
  let folded = false;
  try {
    for (let i = 0; i < MAX_FOLDS; i++) {
      if (!(await foldStep(null, chat, model))) break;
      folded = true;
      if (!measure) break;
      const left = await measure();
      if (!left || left <= ctx * FOLD_TO) break;
    }
  } catch (e) {
    console.warn('[fold]', e.message);
  } finally {
    folding.delete(chat.id);
  }
  return folded;
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

export function promptVars(userId, { model = null, client = null } = {}) {
  const u = userId ? db.users.byId(userId) : null;
  const name = u ? (u.display_name || (u.email ? u.email.split('@')[0] : '') || 'User') : 'User';
  const ctx = memberContext(u, client);
  const now = new Date();
  const timeZone = ctx.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const fmt = (opts) => {
    try { return now.toLocaleString(undefined, { ...opts, timeZone: timeZone || undefined }); }
    catch { return now.toString(); }
  };
  return {
    currentUser: name,
    currentDateTime: fmt({ dateStyle: 'full', timeStyle: 'short' }),
    currentDate: fmt({ dateStyle: 'full' }),
    currentTime: fmt({ timeStyle: 'short' }),
    timeZone,
    userLanguage: languageName(ctx.language),
    userRole: u ? roleOf(u) : '',
    device: ctx.device,
    modelName: model ? (model.display_name || model.internal_name || '') : '',
    ...docsVars(model),
    instanceName: getSetting('app_name', 'open-quill') || 'open-quill',
    supportContact: getSetting('support_contact', '') || ''
  };
}