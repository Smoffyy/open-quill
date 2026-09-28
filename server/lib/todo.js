import { db } from '../db.js';

export const TODO_MAX_ITEMS = 30;
export const TODO_MAX_CHARS = 200;

const STATUS = {
  __proto__: null,
  pending: 'pending', todo: 'pending', open: 'pending', not_started: 'pending',
  in_progress: 'in_progress', inprogress: 'in_progress', active: 'in_progress', doing: 'in_progress', started: 'in_progress',
  completed: 'completed', complete: 'completed', done: 'completed', finished: 'completed'
};
const MARK = { pending: '[ ]', in_progress: '[>]', completed: '[x]' };

function parseList(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
}

export function sanitizeTodos(raw) {
  const list = parseList(raw);
  if (!list) return { ok: false, error: 'items must be an array of {"content": "...", "status": "pending" | "in_progress" | "completed"}.' };
  if (list.length > TODO_MAX_ITEMS) return { ok: false, error: `The list can hold at most ${TODO_MAX_ITEMS} items. Merge or drop some.` };
  const items = [];
  for (const x of list) {
    const content = String((x && typeof x === 'object' ? x.content ?? x.text ?? x.title : x) ?? '').replace(/\s+/g, ' ').trim().slice(0, TODO_MAX_CHARS);
    if (!content) continue;
    const key = String(x && typeof x === 'object' ? x.status ?? '' : '').toLowerCase().replace(/[\s-]+/g, '_');
    items.push({ content, status: STATUS[key] || 'pending' });
  }
  return { ok: true, items };
}

export function todosOf(chatId) {
  const c = chatId ? db.chats.byId(chatId) : null;
  return Array.isArray(c?.todos) ? c.todos : [];
}

export function todoText(items) {
  return items.length ? items.map(t => `${MARK[t.status]} ${t.content}`).join('\n') : '(empty)';
}

export function runTodo(chatId, call) {
  const r = sanitizeTodos(call.items);
  if (!r.ok) return { payload: { ok: false, error: r.error }, formatted: `todo → ERROR: ${r.error}` };
  db.chats.update(chatId, { todos: r.items });
  const done = r.items.filter(t => t.status === 'completed').length;
  return {
    payload: { ok: true, items: r.items, done, total: r.items.length },
    formatted: `todo → saved ${r.items.length} item(s), ${done} completed:\n${todoText(r.items)}`
  };
}
