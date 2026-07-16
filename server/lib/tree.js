import { db } from '../db.js';

export function sortedMsgs(chatId) { return db.messages.byChat(chatId); }

export function ensureChain(chatId) {
  const all = sortedMsgs(chatId);
  let prev = null;
  for (const m of all) { if (m.parent_id === undefined) db.messages.update(m.id, { parent_id: prev }); prev = m.id; }
  const chat = db.chats.byId(chatId);
  if (chat && !chat.active_leaf && all.length) db.chats.update(chatId, { active_leaf: all[all.length - 1].id });
}

export function childrenOf(chatId, parentId) { return sortedMsgs(chatId).filter(m => (m.parent_id ?? null) === (parentId ?? null)); }

export function activePath(chatId) {
  ensureChain(chatId);
  const chat = db.chats.byId(chatId);
  const all = sortedMsgs(chatId);
  const byId = new Map(all.map(m => [m.id, m]));
  let leaf = chat?.active_leaf;
  if (!leaf || !byId.has(leaf)) leaf = all.length ? all[all.length - 1].id : null;
  const path = []; const seen = new Set(); let cur = leaf;
  while (cur && byId.has(cur) && !seen.has(cur)) { seen.add(cur); path.push(byId.get(cur)); cur = byId.get(cur).parent_id; }
  return path.reverse();
}

export function leafUnder(chatId, messageId) {
  let cur = db.messages.byId(messageId);
  while (cur) { const kids = childrenOf(chatId, cur.id); if (!kids.length) break; cur = kids[kids.length - 1]; }
  return cur ? cur.id : messageId;
}
