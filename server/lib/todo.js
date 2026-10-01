import { db } from '../db.js';
import { activePath } from './tree.js';
import { decodeOqr } from './history.js';

export const TODO_MAX_ITEMS = 30;
export const TODO_MAX_CHARS = 200;

const STATUS = {
  __proto__: null,
  pending: 'pending', todo: 'pending', open: 'pending', not_started: 'pending',
  in_progress: 'in_progress', inprogress: 'in_progress', active: 'in_progress', doing: 'in_progress', started: 'in_progress',
  completed: 'completed', complete: 'completed', done: 'completed', finished: 'completed',
  cancelled: 'cancelled', canceled: 'cancelled', cancel: 'cancelled', skipped: 'cancelled', skip: 'cancelled',
  dropped: 'cancelled', removed: 'cancelled', abandoned: 'cancelled', obsolete: 'cancelled', wont_do: 'cancelled'
};
const MARK = { pending: '[ ]', in_progress: '[>]', completed: '[x]', cancelled: '[-]' };
const OQR = /\[\[OQR:([A-Za-z0-9+/=]+)\]\]/g;

function parseList(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
}

export function sanitizeTodos(raw) {
  const list = parseList(raw);
  if (!list) return { ok: false, error: 'items must be an array of {"content": "...", "status": "pending" | "in_progress" | "completed" | "cancelled"}.' };
  if (list.length > TODO_MAX_ITEMS) return { ok: false, error: `The list can hold at most ${TODO_MAX_ITEMS} items. Merge or drop some.` };
  const items = [];
  for (const x of list) {
    const content = String((x && typeof x === 'object' ? x.content ?? x.text ?? x.title : x) ?? '').replace(/\s+/g, ' ').trim().slice(0, TODO_MAX_CHARS);
    if (!content) continue;
    const key = String(x && typeof x === 'object' ? x.status ?? '' : '').toLowerCase().replace(/[\s-]+/g, '_').replace(/'/g, '');
    items.push({ content, status: STATUS[key] || 'pending' });
  }
  return { ok: true, items };
}

export function planClosure(items) {
  if (!items.length || items.every(t => t.status === 'cancelled')) return 'cancelled';
  return items.every(t => t.status === 'completed' || t.status === 'cancelled') ? 'finished' : null;
}

const isPlanRecord = (d) => !!(d && d.call && d.call.tool === 'todo' && d.result && d.result.ok && Array.isArray(d.result.items));

export function latestTodos(messages, dismissed = null) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.content || !m.content.includes('[[OQR:')) continue;
    const recs = [...m.content.matchAll(OQR)].map(x => decodeOqr(x[1])).filter(isPlanRecord);
    if (!recs.length) continue;
    if (dismissed && dismissed.msg === m.id && dismissed.n === recs.length) return [];
    const items = recs[recs.length - 1].result.items;
    return planClosure(items) ? [] : items;
  }
  return [];
}

export function todosOf(chatId) {
  if (!chatId) return [];
  return latestTodos(activePath(chatId), db.chats.byId(chatId)?.plan_dismissed || null);
}

export function todoText(items) {
  return items.length ? items.map(t => `${MARK[t.status] || MARK.pending} ${t.content}`).join('\n') : '(empty)';
}

export function runTodo(call) {
  const r = sanitizeTodos(call.items);
  if (!r.ok) return { payload: { ok: false, error: r.error }, formatted: `todo → ERROR: ${r.error}` };
  const done = r.items.filter(t => t.status === 'completed').length;
  const total = r.items.filter(t => t.status !== 'cancelled').length;
  const closed = planClosure(r.items);
  const payload = { ok: true, items: r.items, done, total };
  if (closed) payload.closed = closed;
  const summary = closed === 'finished' ? 'every step is finished, so the plan is closed and hidden from the user'
    : closed === 'cancelled' ? 'the plan is cancelled, closed and hidden from the user'
      : `saved ${r.items.length} item(s), ${done} completed`;
  return { payload, formatted: `todo → ${summary}${r.items.length ? `:\n${todoText(r.items)}` : '.'}` };
}
