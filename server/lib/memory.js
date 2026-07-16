import { db, getSetting } from '../db.js';
import { oneShot, stripThink } from '../llm.js';
import { stripToolSyntax } from './history.js';

export const DEFAULT_MEMORY_PROMPT = 'You maintain a compact long-term memory about a user of a chat assistant. You are given the CURRENT MEMORY and excerpts of the user\u2019s RECENT MESSAGES. Produce the UPDATED MEMORY: a short plain-text list of durable, useful facts about the user \u2014 their name and role if stated, ongoing projects, preferences, tools and languages they use, and standing instructions. Merge new facts with the current memory, drop stale or one-off details, never invent anything, and never store sensitive data like passwords or keys. Output ONLY the memory text, at most 20 short lines.';
const MEMORY_THROTTLE_MS = 6 * 60 * 60 * 1000;

export async function updateUserMemory(userId, model) {
  const u = db.users.byId(userId);
  if (!u) return null;
  const chats = db.chats.byUser(userId).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, 12);
  const excerpts = [];
  let budget = 12000;
  for (const c of chats) {
    if (budget <= 0) break;
    const userMsgs = db.messages.byChat(c.id).filter(m => m.role === 'user' && (m.content || '').trim()).slice(-6);
    if (!userMsgs.length) continue;
    let block = `[Chat: ${(c.title || 'Untitled').slice(0, 60)}]\n`;
    for (const m of userMsgs) block += '- ' + stripToolSyntax(m.content).replace(/\s+/g, ' ').slice(0, 400) + '\n';
    block = block.slice(0, Math.max(0, budget));
    budget -= block.length;
    excerpts.push(block);
  }
  if (!excerpts.length) return (u.memory || '');
  const sys = getSetting('memory_prompt', DEFAULT_MEMORY_PROMPT) || DEFAULT_MEMORY_PROMPT;
  const userMsg = `CURRENT MEMORY:\n${(u.memory || '(empty)').slice(0, 6000)}\n\nRECENT MESSAGES:\n${excerpts.join('\n')}`;
  const raw = await oneShot(model, [{ role: 'system', content: sys }, { role: 'user', content: userMsg }]);
  const memory = stripThink(model, raw || '').trim().slice(0, 6000);
  if (!memory) return null;
  db.users.update(userId, { memory, memory_updated_at: Date.now() });
  return memory;
}

export function maybeUpdateMemory(userId, model) {
  try {
    if (getSetting('memory_enabled', '0') !== '1') return;
    const u = db.users.byId(userId);
    if (!u || u.prefs?.memoryEnabled === false) return;
    if (Date.now() - (u.memory_updated_at || 0) < MEMORY_THROTTLE_MS) return;
    db.users.update(userId, { memory_updated_at: Date.now() });
    updateUserMemory(userId, model).catch(() => {});
  } catch {}
}
