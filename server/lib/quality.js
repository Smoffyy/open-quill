import { db, uid, now, getSetting, setSetting } from '../db.js';
import { judge } from './judge.js';
import { transcript } from './grader.js';
import { conversationAt } from './evals.js';
import { startJob, activeJob } from './evaljobs.js';

export const KINDS = ['policy', 'grounding', 'resolution', 'custom'];
const LIMITS = { criteria: 20, name: 80, instruction: 6000, policy: 20000, queue: 200, backfill: 1000 };
const SETTINGS_KEY = 'quality_settings';

export const TEMPLATES = {
  __proto__: null,
  policy: {
    name: 'Follows internal policy',
    instruction: 'Check whether the reply follows the internal policy below. Use "fail" when any part of the reply breaks it, and quote that part as evidence. Use "na" when the policy has nothing to say about this conversation.'
  },
  grounding: {
    name: 'Uses the supplied documents',
    instruction: 'The assistant was given the documents under supplied_documents: files the user attached and results from tools it called. Check whether the reply bases its factual claims on them. Use "fail" when it ignores them, contradicts them, or states facts they do not support. Use "pass" when its claims are backed by them.'
  },
  resolution: {
    name: 'Leaves the request unresolved',
    instruction: 'Check whether the reply resolves what the user asked in their last message. Use "fail" when it leaves the request unresolved: it refuses without a good reason, answers a different question, stops halfway, only promises to do it later, or asks for information it already had. Use "pass" when the request is resolved or the assistant asks a clarifying question it genuinely needs.'
  }
};

const text = (v, cap) => (typeof v === 'string' ? v.slice(0, cap) : '');

export function cleanCriterion(raw) {
  const kind = KINDS.includes(raw?.kind) ? raw.kind : 'custom';
  const base = TEMPLATES[kind] || { name: '', instruction: '' };
  const name = text(raw?.name, LIMITS.name).trim() || base.name;
  const instruction = text(raw?.instruction, LIMITS.instruction).trim() || base.instruction;
  if (!name || !instruction) return null;
  return {
    id: typeof raw?.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : uid(),
    kind, name, instruction,
    policy: kind === 'policy' ? text(raw?.policy, LIMITS.policy) : '',
    models: (Array.isArray(raw?.models) ? raw.models : []).filter(id => typeof id === 'string' && id.length <= 64).slice(0, 100),
    enabled: raw?.enabled !== false
  };
}

export function qualitySettings() {
  const raw = getSetting(SETTINGS_KEY, null) || {};
  return {
    enabled: !!raw.enabled,
    sampleRate: Math.min(100, Math.max(0, Number(raw.sampleRate) || 0)),
    criteria: (Array.isArray(raw.criteria) ? raw.criteria : []).map(cleanCriterion).filter(Boolean)
  };
}

export function saveQualitySettings(body) {
  const cur = qualitySettings();
  const next = {
    enabled: 'enabled' in (body || {}) ? !!body.enabled : cur.enabled,
    sampleRate: 'sampleRate' in (body || {}) ? Math.min(100, Math.max(0, Number(body.sampleRate) || 0)) : cur.sampleRate,
    criteria: Array.isArray(body?.criteria) ? body.criteria.map(cleanCriterion).filter(Boolean).slice(0, LIMITS.criteria) : cur.criteria
  };
  setSetting(SETTINGS_KEY, next);
  return next;
}

export function reviewOn() {
  const s = qualitySettings();
  return s.enabled && s.criteria.some(c => c.enabled);
}

export function sampled(id, rate) {
  let h = 0x811c9dc5;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return (h % 10000) < Math.round(rate * 100);
}

export function instructionOf(c) {
  return c.kind === 'policy' && c.policy.trim() ? `${c.instruction}\n\nPolicy:\n${c.policy.trim()}` : c.instruction;
}

export function appliesTo(c, modelId) {
  return c.enabled && (!c.models.length || c.models.includes(modelId));
}

export async function checkReply(messageId, criteria, { source = 'sample', userId = null, signal = null } = {}) {
  const at = conversationAt(messageId);
  if (!at || !at.replyText) return { skipped: true };
  const owner = db.users.byId(at.chat.user_id);
  const question = [...at.before].reverse().find(m => m.role === 'user');
  let failed = 0;
  for (const c of criteria.filter(x => appliesTo(x, at.reply.model_id))) {
    if (signal?.aborted) break;
    if (c.kind === 'grounding' && !at.context.length) continue;
    const v = await judge({ criterion: instructionOf(c), conversation: transcript(at.before), reply: at.replyText, context: at.context }, { userId, signal });
    if (v.error) { failed++; continue; }
    const id = `${messageId}:${c.id}`;
    db.qualityChecks.removeById(id);
    db.qualityChecks.insert({
      id, ts: now(), criterion_id: c.id, criterion_name: c.name, chat_id: at.chat.id, chat_title: at.chat.title || '',
      message_id: messageId, user_email: owner?.email || '', model_id: at.reply.model_id || '', model_name: at.reply.model_name || '',
      verdict: v.verdict, score: v.score, explanation: v.explanation, evidence: v.evidence, judge: v.judge, cost: v.cost || 0, source,
      question: String(question?.content || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      excerpt: at.replyText.replace(/\s+/g, ' ').trim().slice(0, 400)
    });
  }
  return { failed };
}

const queue = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const messageId = queue.shift();
    const s = qualitySettings();
    if (!s.enabled) { queue.length = 0; break; }
    try { await checkReply(messageId, s.criteria, { source: 'sample' }); }
    catch (e) { console.warn('[quality]', e.message); }
  }
  draining = false;
}

export function afterReply(messageId) {
  const s = qualitySettings();
  if (!s.enabled || !s.sampleRate || !s.criteria.some(c => c.enabled)) return false;
  if (!sampled(messageId, s.sampleRate) || queue.length >= LIMITS.queue) return false;
  queue.push(messageId);
  drain();
  return true;
}

export function startBackfill({ days = 7, limit = 100, criteria = [], modelId = '' } = {}, user) {
  if (activeJob('quality')) return { status: 409, error: 'A review of past chats is already running.' };
  const s = qualitySettings();
  const chosen = s.criteria.filter(c => c.enabled && (!criteria.length || criteria.includes(c.id)));
  if (!chosen.length) return { status: 400, error: 'Turn on at least one check first.' };
  const to = now();
  const from = to - Math.min(365, Math.max(1, Number(days) || 7)) * 86400000;
  const cap = Math.min(LIMITS.backfill, Math.max(1, Number(limit) || 100));
  const replies = db.messages.repliesBetween(from, to, cap * 4)
    .filter(m => !modelId || m.model_id === modelId)
    .slice(0, cap);
  if (!replies.length) return { status: 400, error: 'No replies in that period.' };
  const { job } = startJob({
    kind: 'quality', label: `${replies.length} replies`, ref: 'backfill', items: replies.map(m => m.id),
    worker: async (messageId, signal) => (await checkReply(messageId, chosen, { source: 'backfill', userId: user?.id || null, signal })).failed === 0
  });
  return { job };
}

export function qualityReport(days = 30) {
  const since = now() - Math.min(365, Math.max(1, Number(days) || 30)) * 86400000;
  return { since, tally: db.qualityChecks.tally(since), daily: db.qualityChecks.daily(since), recurring: db.qualityChecks.recurring(since) };
}

export function qualityResults({ criterion = '', verdict = '', days = 30, offset = 0, limit = 50 } = {}) {
  const f = {
    since: now() - Math.min(365, Math.max(1, Number(days) || 30)) * 86400000,
    criterion: typeof criterion === 'string' ? criterion.slice(0, 64) : '',
    verdict: ['pass', 'fail', 'na'].includes(verdict) ? verdict : '',
    limit: Math.min(100, Math.max(1, Number(limit) || 50)),
    offset: Math.max(0, Number(offset) || 0)
  };
  return { results: db.qualityChecks.page(f), total: db.qualityChecks.countMatching(f) };
}

export function forgetChats(chatIds) {
  for (const id of chatIds) db.qualityChecks.removeWhere('chat_id', id);
}