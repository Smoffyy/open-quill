import { db } from '../db.js';

const CACHE_MAX = 24;
const cache = new Map();

function buildGraph(chatId) {
  const msgs = db.messages.byChat(chatId);
  const byId = new Map();
  const kids = new Map();
  for (const m of msgs) {
    byId.set(m.id, m);
    const p = m.parent_id ?? null;
    let arr = kids.get(p);
    if (!arr) { arr = []; kids.set(p, arr); }
    arr.push(m);
  }
  return { msgs, byId, kids, chained: false };
}

export function graphOf(chatId) {
  const version = db.messages.version();
  const hit = cache.get(chatId);
  if (hit && hit.version === version) {
    cache.delete(chatId);
    cache.set(chatId, hit);
    return hit.graph;
  }
  const graph = buildGraph(chatId);
  cache.set(chatId, { version, graph });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return graph;
}

export function sortedMsgs(chatId) { return graphOf(chatId).msgs; }

export function ensureChain(chatId) {
  let g = graphOf(chatId);
  let chat = db.chats.byId(chatId);
  if (g.chained) return chat;
  let prev = null;
  let wrote = false;
  for (const m of g.msgs) {
    if (m.parent_id === undefined) { db.messages.update(m.id, { parent_id: prev }); wrote = true; }
    prev = m.id;
  }
  if (chat && !chat.active_leaf && g.msgs.length) chat = db.chats.update(chatId, { active_leaf: g.msgs[g.msgs.length - 1].id }) || chat;
  if (wrote) g = graphOf(chatId);
  g.chained = true;
  return chat;
}

export function childrenOf(chatId, parentId) {
  return graphOf(chatId).kids.get(parentId ?? null) || [];
}

export function activePath(chatId) {
  const chat = ensureChain(chatId);
  const g = graphOf(chatId);
  let leaf = chat?.active_leaf;
  if (!leaf || !g.byId.has(leaf)) leaf = g.msgs.length ? g.msgs[g.msgs.length - 1].id : null;
  const path = [];
  const seen = new Set();
  let cur = leaf;
  while (cur && g.byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const m = g.byId.get(cur);
    path.push(m);
    cur = m.parent_id;
  }
  return path.reverse();
}

export function preferredChild(kids, onPath) {
  if (!kids || !kids.length) return null;
  if (onPath && onPath.size) for (const k of kids) if (onPath.has(k.id)) return k;
  return kids[kids.length - 1];
}

export function leafUnder(chatId, messageId) {
  const g = graphOf(chatId);
  const onPath = new Set(activePath(chatId).map(m => m.id));
  let cur = g.byId.get(messageId) || db.messages.byId(messageId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const next = preferredChild(g.kids.get(cur.id), onPath);
    if (!next) break;
    cur = next;
  }
  return cur ? cur.id : messageId;
}
