import { clients } from './broadcast.js';

const STALE_MS = 45 * 60 * 1000;

const turns = new Map();
export const aborts = new Map();
export const steers = new Map();
// A turn registers a fresh AbortController for every step, so aborting the one
// that happens to be current only cancels that step — a stop that lands while a
// tool is running hits an already-finished controller and the loop carries on to
// the next step. This set is the durable answer to "the user asked me to stop",
// and the agentic loop checks it at every point it could otherwise continue.
export const stops = new Set();
const asks = new Map();
export const ASK_TIMEOUT_MS = 30 * 60 * 1000;

export function waitForAnswer(chatId, signal, timeoutMs = ASK_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const finish = (r) => {
      if (asks.get(chatId)?.finish !== finish) return;
      asks.delete(chatId);
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const onAbort = () => finish({ stopped: true });
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
    asks.get(chatId)?.finish({ stopped: true });
    asks.set(chatId, { finish });
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  });
}

export function answerQuestion(chatId, answer) {
  const pending = asks.get(chatId);
  if (!pending) return false;
  pending.finish(answer);
  return true;
}

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
    promptTokens: 0,
    ask: null,
    startedAt: Date.now(),
    seenAt: Date.now()
  };
  stops.delete(chatId);
  turns.set(chatId, rec);
  return rec;
}

export function endTurn(chatId) {
  if (!chatId) return;
  asks.get(chatId)?.finish({ stopped: true });
  turns.delete(chatId);
  aborts.delete(chatId);
  steers.delete(chatId);
  stops.delete(chatId);
}

const isStale = (rec) => Date.now() - rec.seenAt > STALE_MS && !asks.has(rec.chatId);

export function activeTurn(chatId) {
  const rec = chatId ? turns.get(chatId) : null;
  if (!rec) return null;
  if (isStale(rec)) { endTurn(chatId); return null; }
  return rec;
}

export function snapshotsFor(userId) {
  const out = [];
  for (const rec of turns.values()) {
    if (rec.userId !== userId) continue;
    if (isStale(rec)) continue;
    out.push({
      chatId: rec.chatId,
      messageId: rec.messageId,
      modelId: rec.modelId,
      phase: rec.phase,
      content: rec.content,
      reasoning: rec.reasoning,
      live: rec.live,
      steers: rec.steers.slice(),
      status: rec.status,
      promptTokens: rec.promptTokens,
      ask: rec.ask
    });
  }
  return out;
}

export function record(m) {
  if (!m || typeof m.type !== 'string' || !m.chatId) return;
  const rec = turns.get(m.chatId);
  if (!rec) return;
  rec.seenAt = Date.now();
  switch (m.type) {
    case 'queued':
      rec.phase = 'queued';
      break;
    case 'start':
      rec.messageId = m.messageId || null;
      rec.phase = 'generating';
      rec.content = typeof m.content === 'string' ? m.content : '';
      rec.reasoning = typeof m.reasoning === 'string' ? m.reasoning : '';
      rec.live = null;
      rec.steers = [];
      rec.status = null;
      rec.promptTokens = 0;
      break;
    case 'prompt_size':
      rec.promptTokens = m.tokens || 0;
      break;
    case 'content':
      rec.content += m.text || '';
      rec.phase = 'generating';
      break;
    case 'rewrite':
      if (typeof m.content === 'string') rec.content = m.content;
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
    case 'ask':
      rec.ask = m.question || null;
      break;
    case 'asked':
      rec.ask = null;
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
  let m;
  try { m = JSON.parse(raw); } catch { m = null; }
  if (m) record(m);
  for (const [sock, st] of clients.entries()) {
    if (sock.readyState !== 1 || st.userId !== userId) continue;
    try { sock.send(raw); } catch {}
  }
}

export function stopTurn(chatId) {
  if (!turns.has(chatId)) return;
  stops.add(chatId);
  aborts.get(chatId)?.abort();
}