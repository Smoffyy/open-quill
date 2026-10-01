import crypto from 'node:crypto';
import { db } from '../db.js';

export const MEMORY_MAX_ITEMS = 100;
export const MEMORY_MAX_CHARS = 500;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ID_RE = /^[a-z0-9]{4,16}$/;

export const userMemoryOn = (u) => !!u && u.prefs?.memoryEnabled === true;

export function cleanMemoryText(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_MAX_CHARS);
}

export function newMemoryId(taken) {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    let id = '';
    for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
    if (!taken.has(id)) return id;
  }
}

function sanitizeEntry(x) {
  if (!x || typeof x !== 'object' || !ID_RE.test(String(x.id || ''))) return null;
  const text = cleanMemoryText(x.text);
  if (!text) return null;
  const at = Number.isFinite(x.created_at) ? x.created_at : 0;
  return {
    id: x.id, text,
    source: x.source === 'assistant' ? 'assistant' : 'user',
    created_at: at, updated_at: Number.isFinite(x.updated_at) ? x.updated_at : at
  };
}

export function sanitizeMemories(list) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const e = sanitizeEntry(x);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length >= MEMORY_MAX_ITEMS) break;
  }
  return out;
}

export function legacyMemories(text, at = 0) {
  const taken = new Set();
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const t = cleanMemoryText(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''));
    if (!t) continue;
    const id = newMemoryId(taken);
    taken.add(id);
    out.push({ id, text: t, source: 'user', created_at: at, updated_at: at });
    if (out.length >= MEMORY_MAX_ITEMS) break;
  }
  return out;
}

export function applyMemoryOp(list, op, at = Date.now()) {
  const items = Array.isArray(list) ? list : [];
  const action = String(op?.action || '').toLowerCase();
  const id = String(op?.id ?? '').trim().replace(/^\[|\]$/g, '');
  const text = cleanMemoryText(op?.text);
  const source = op?.source === 'assistant' ? 'assistant' : 'user';
  const idx = id ? items.findIndex(m => m.id === id) : -1;
  if (action === 'add') {
    if (!text) return { ok: false, error: 'text is required to add a memory.' };
    const dup = items.find(m => m.text.toLowerCase() === text.toLowerCase());
    if (dup) return { ok: true, list: items, item: dup, duplicate: true };
    if (items.length >= MEMORY_MAX_ITEMS) return { ok: false, error: `Memory is full (${MEMORY_MAX_ITEMS} entries). Update or delete an existing entry instead.` };
    const item = { id: newMemoryId(new Set(items.map(m => m.id))), text, source, created_at: at, updated_at: at };
    return { ok: true, list: [...items, item], item };
  }
  if (action === 'update' || action === 'delete') {
    if (!id) return { ok: false, error: `id is required to ${action} a memory.` };
    if (idx === -1) return { ok: false, error: `No memory with id "${id}".` };
    if (action === 'delete') return { ok: true, list: items.filter((_, i) => i !== idx), item: items[idx] };
    if (!text) return { ok: false, error: 'text is required to update a memory.' };
    const item = { ...items[idx], text, source, updated_at: at };
    return { ok: true, list: items.map((m, i) => (i === idx ? item : m)), item };
  }
  return { ok: false, error: 'action must be "add", "update" or "delete".' };
}

export function memoriesOf(userId) {
  const u = userId ? db.users.byId(userId) : null;
  if (!u) return [];
  if (Array.isArray(u.memories)) return sanitizeMemories(u.memories);
  const list = legacyMemories(u.memory, u.memory_updated_at || 0);
  db.users.update(userId, { memories: list, memory: '' });
  return list;
}

export function setMemories(userId, list) {
  const clean = sanitizeMemories(list);
  db.users.update(userId, { memories: clean });
  return clean;
}

export function changeMemory(userId, op) {
  const r = applyMemoryOp(memoriesOf(userId), op);
  if (r.ok && !r.duplicate) setMemories(userId, r.list);
  return r;
}

export function memoriesText(u) {
  if (!userMemoryOn(u)) return '';
  return memoriesOf(u.id).map(m => `- [${m.id}] ${m.text}`).join('\n');
}

export function memoryToolResult(call, r) {
  const action = String(call.action || '').toLowerCase() || 'memory';
  if (!r.ok) {
    return { payload: { ok: false, action, error: r.error }, formatted: `memory ${action} → ERROR: ${r.error}` };
  }
  const { id, text } = r.item;
  const formatted = action === 'delete' ? `memory delete [${id}] → deleted: ${text}`
    : action === 'update' ? `memory update [${id}] → now: ${text}`
      : r.duplicate ? `memory add → already saved as [${id}]: ${text}`
        : `memory add → saved as [${id}]: ${text}`;
  return { payload: { ok: true, action, id, text, duplicate: !!r.duplicate }, formatted };
}