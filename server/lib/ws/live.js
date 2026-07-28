import { clients } from './broadcast.js';

const STALE_MS = 45 * 60 * 1000;

const turns = new Map();
export const aborts = new Map();
export const steers = new Map();

export function beginTurn(userId, chatId, modelId) {
  if (!chatId) return null;
  const rec = {
    userId,
    chatId,
    modelId: modelId || null,
    messageId: null,
    phase: 'queued',
    content: '',
    reasoning: '',
    live: null,
    steers: [],
    status: null,
    startedAt: Date.now()
  };
  turns.set(chatId, rec);
  return rec;
}

export function endTurn(chatId) {
  if (!chatId) return;
  turns.delete(chatId);
  aborts.delete(chatId);
  steers.delete(chatId);
}

export function activeTurn(chatId) {
  const rec = chatId ? turns.get(chatId) : null;
  if (!rec) return null;
  if (Date.now() - rec.startedAt > STALE_MS) { endTurn(chatId); return null; }
  return rec;
}

export function snapshotsFor(userId) {
  const out = [];
  const cutoff = Date.now() - STALE_MS;
  for (const rec of turns.values()) {
    if (rec.userId !== userId) continue;
    if (rec.startedAt < cutoff) continue;
    out.push({
      chatId: rec.chatId,
      messageId: rec.messageId,
      modelId: rec.modelId,
      phase: rec.phase,
      content: rec.content,
      reasoning: rec.reasoning,
      live: rec.live,
      steers: rec.steers.slice(),
      status: rec.status
    });
  }
  return out;
}

export function record(m) {
  if (!m || typeof m.type !== 'string' || !m.chatId) return;
  const rec = turns.get(m.chatId);
  if (!rec) return;
  switch (m.type) {
    case 'queued':
      rec.phase = 'queued';
      break;
    case 'start':
      rec.messageId = m.messageId || null;
      rec.phase = 'generating';
      rec.content = '';
      rec.reasoning = '';
      rec.live = null;
      rec.steers = [];
      rec.status = null;
      break;
    case 'content':
      rec.content += m.text || '';
      rec.phase = 'generating';
      break;
    case 'reasoning':
      rec.reasoning += m.text || '';
      if (!rec.content) rec.phase = 'thinking';
      break;
    case 'tool_live':
    case 'tool_exec':
      rec.live = (m.type === 'tool_live' ? m.live : m.call) || null;
      break;
    case 'tool_live_delta':
      if (rec.live) rec.live = { ...rec.live, content: (rec.live.content || '') + (m.text || '') };
      break;
    case 'status':
      rec.status = m.phase === 'generating'
        ? null
        : { phase: m.phase, processed: m.processed, total: m.total, cache: m.cache, pct: m.pct, ms: m.ms };
      break;
    case 'steered':
      if (Array.isArray(m.notes)) rec.steers = [...rec.steers, ...m.notes];
      break;
    case 'done':
      endTurn(m.chatId);
      break;
    default:
      break;
  }
}

export function sendLive(userId, raw) {
  let m = null;
  try { m = JSON.parse(raw); } catch { m = null; }
  if (m) record(m);
  for (const [sock, st] of clients.entries()) {
    if (sock.readyState !== 1 || st.userId !== userId) continue;
    try { sock.send(raw); } catch {}
  }
}
