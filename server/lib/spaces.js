import { db, uid, now } from '../db.js';
import { oneShot, stripThink } from '../llm/index.js';
import { clients } from './ws/index.js';

export function broadcastSpace(spaceId, payload, excludeUserId) {
  const space = db.spaces.byId(spaceId);
  if (!space) return;
  const ids = new Set((space.members || []).filter(m => m.status === 'accepted').map(m => m.userId));
  const msg = JSON.stringify(payload);
  for (const [sock, st] of clients.entries()) if (sock.readyState === 1 && ids.has(st.userId) && st.userId !== excludeUserId) sock.send(msg);
}

export function isMember(space, userId) { return (space.members || []).some(m => m.userId === userId); }
export function isAccepted(space, userId) { return (space.members || []).some(m => m.userId === userId && m.status === 'accepted'); }
export function memberOf(space, userId) { return (space.members || []).find(m => m.userId === userId) || null; }
export function canPost(space, userId) { const m = memberOf(space, userId); return !!m && m.status === 'accepted' && m.role !== 'viewer'; }

export function removeUserFromSpaces(userId) {
  for (const s of db.spaces.filter(s => isMember(s, userId))) {
    let members = (s.members || []).filter(m => m.userId !== userId);
    let ownerId = s.owner_id;
    if (ownerId === userId) {
      const next = members.find(m => m.status === 'accepted');
      ownerId = next ? next.userId : null;
      if (next) members = members.map(m => m.userId === ownerId ? { ...m, role: 'owner' } : m);
    }
    if (!members.length || !ownerId) { db.spaceMessages.remove(m => m.space_id === s.id); db.spaces.remove(x => x.id === s.id); }
    else db.spaces.update(s.id, { members, owner_id: ownerId, updated_at: now() });
  }
}

export function shapeSpace(s, userId) {
  const members = (s.members || []);
  const me = userId ? members.find(m => m.userId === userId) : null;
  return {
    id: s.id, name: s.name, ownerId: s.owner_id, modelId: s.model_id || null, systemPrompt: s.system_prompt || '',
    members: members.map(m => ({ userId: m.userId, displayName: m.displayName, email: m.email, role: m.role, status: m.status, invitedAt: m.invitedAt, respondedAt: m.respondedAt || null })),
    myStatus: me ? me.status : null, myRole: me ? me.role : null, updatedAt: s.updated_at, createdAt: s.created_at
  };
}

export function shapeSpaceMsg(m) { return { id: m.id, spaceId: m.space_id, userId: m.user_id, authorName: m.author_name, role: m.role, content: m.content, createdAt: m.created_at }; }

const spaceCooldown = new Map();
export async function spaceAssistantRespond(spaceId) {
  const space = db.spaces.byId(spaceId);
  if (!space) return;
  const last = spaceCooldown.get(spaceId) || 0;
  if (Date.now() - last < 1200) return;
  if (spaceCooldown.size > 1000) spaceCooldown.clear();
  spaceCooldown.set(spaceId, Date.now());
  const model = db.models.byId(space.model_id) || db.models.find(m => m.is_default) || db.models.all()[0];
  if (!model) return;
  broadcastSpace(spaceId, { type: 'space_typing', spaceId, typing: true });
  try {
    const history = db.spaceMessages.bySpace(spaceId).slice(-40);
    const aiName = (model.display_name || 'Assistant').toLowerCase();
    const lastMsg = history[history.length - 1];
    const lastText = (lastMsg?.content || '');
    const esc = aiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentioned = new RegExp(`@${esc}\\b`, 'i').test(lastText) || /@(assistant|ai|bot)\b/i.test(lastText);
    const addressed = lastMsg && lastMsg.role !== 'assistant'
      && (mentioned || new RegExp(`(^|\\b)${esc}\\b`, 'i').test(lastText) || /\?\s*$/.test(lastText.trim()));
    const sys = `You are the AI assistant taking part in a shared group chat space named "${space.name}" alongside multiple human users. Each human message below is prefixed with its sender's name so you can tell people apart; your own earlier replies are not prefixed. Speak naturally in first person, and only reply when you are directly addressed, asked something, or can clearly add value to the discussion. If the latest message is just people talking among themselves and doesn't call for your input, reply with exactly [[SPACE_SILENT]] and nothing else: no punctuation, no explanation, nothing before or after it.`
      + (addressed ? ' The latest message appears to address you directly, so a reply is expected unless it truly makes no sense.' : '')
      + (space.system_prompt && space.system_prompt.trim() ? `\n\nAdditional instructions from the space owner:\n${space.system_prompt.trim()}` : '');
    const convo = [{ role: 'system', content: sys }, ...history.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.role === 'assistant' ? m.content : `${m.author_name}: ${m.content}`
    }))];
    let raw = await oneShot(model, convo);
    raw = stripThink(model, raw || '').trim();
    if (!raw || /^\[\[SPACE_SILENT\]\]$/i.test(raw)) return;
    const t = now();
    const row = db.spaceMessages.insert({ id: uid(), space_id: spaceId, user_id: null, role: 'assistant', author_name: model.display_name || 'Assistant', content: raw, created_at: t });
    db.spaces.update(spaceId, { updated_at: t });
    broadcastSpace(spaceId, { type: 'space_message', spaceId, message: shapeSpaceMsg(row) });
  } catch {}
  finally { broadcastSpace(spaceId, { type: 'space_typing', spaceId, typing: false }); }
}
