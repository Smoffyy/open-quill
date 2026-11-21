import { db } from '../db.js';
import { activePath } from './tree.js';
import { pathTo } from './evals.js';
import { replyText } from './grader.js';

function savedAsCase(test) {
  return db.evalCollections.all().some(c => (c.cases || []).some(k => k.source && test(k.source)));
}

export function reviewableMessage(messageId) {
  if (typeof messageId !== 'string' || !messageId) return false;
  if (db.qualityChecks.flaggedMessage(messageId)) return true;
  if (db.feedback.byMessage(messageId).some(f => f.kind !== 'safety')) return true;
  return savedAsCase(s => s.messageId === messageId);
}

export function reviewableChat(chatId) {
  if (typeof chatId !== 'string' || !chatId) return false;
  return db.qualityChecks.flaggedChat(chatId) || db.feedback.ratedChat(chatId) || savedAsCase(s => s.chatId === chatId);
}

export function reviewTranscript(chatId, focusId = '') {
  const chat = db.chats.byId(chatId);
  if (!chat) return null;
  const active = activePath(chatId);
  const path = focusId && !active.some(m => m.id === focusId) ? pathTo(chatId, focusId) : active;
  const names = new Map(db.models.all().map(m => [m.id, m.display_name || m.internal_name || '']));
  const owner = db.users.byId(chat.user_id);
  return {
    chat: { id: chat.id, title: chat.title || '', owner: owner?.email || '', updatedAt: chat.updated_at || 0 },
    messages: path.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
      id: m.id, role: m.role, createdAt: m.created_at || 0,
      content: m.role === 'assistant' ? replyText(m.content) : String(m.content || ''),
      model: m.model_id ? names.get(m.model_id) || '' : '',
      attachments: (Array.isArray(m.attachments) ? m.attachments : []).map(a => a.name || 'attachment'),
      checks: m.role === 'assistant' ? db.qualityChecks.byMessage(m.id).map(q => ({ criterion: q.criterion_name, verdict: q.verdict, explanation: q.explanation })) : []
    }))
  };
}