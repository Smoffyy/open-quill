import { db, uid, now } from '../db.js';
import { authMiddleware } from '../auth.js';
import { broadcastToUser } from '../lib/ws.js';
import { broadcastSpace, isMember, isAccepted, memberOf, canPost, removeUserFromSpaces, shapeSpace, shapeSpaceMsg, spaceAssistantRespond } from '../lib/spaces.js';

function ownSpace(req, res, { requireOwner = false } = {}) {
  const s = db.spaces.byId(req.params.id);
  if (!s || !isMember(s, req.user.id)) { res.status(404).json({ error: 'not found' }); return null; }
  if (requireOwner && s.owner_id !== req.user.id && !req.user.is_admin) { res.status(403).json({ error: 'Only the space owner can do that.' }); return null; }
  return s;
}

export default function registerSpaceRoutes(app) {
  app.get('/api/spaces', authMiddleware, (req, res) => {
    const mine = db.spaces.filter(s => isMember(s, req.user.id)).sort((a, b) => b.updated_at - a.updated_at);
    res.json(mine.map(s => shapeSpace(s, req.user.id)));
  });

  app.post('/api/spaces', authMiddleware, (req, res) => {
    const name = String(req.body?.name || 'New space').slice(0, 80).trim() || 'New space';
    const t = now();
    const me = { userId: req.user.id, displayName: req.user.display_name || req.user.email.split('@')[0], email: req.user.email, role: 'owner', status: 'accepted', invitedAt: t, respondedAt: t };
    const defaultModel = db.models.find(m => m.is_default) || db.models.all()[0];
    const s = db.spaces.insert({ id: uid(), owner_id: req.user.id, name, system_prompt: '', model_id: (db.models.byId(req.body?.modelId) || defaultModel)?.id || null, members: [me], created_at: t, updated_at: t });
    res.json(shapeSpace(s, req.user.id));
  });

  app.get('/api/spaces/:id', authMiddleware, (req, res) => {
    const s = ownSpace(req, res); if (!s) return;
    res.json(shapeSpace(s, req.user.id));
  });

  app.patch('/api/spaces/:id', authMiddleware, (req, res) => {
    const s = ownSpace(req, res, { requireOwner: true }); if (!s) return;
    const patch = { updated_at: now() };
    if ('name' in req.body) patch.name = String(req.body.name || 'New space').slice(0, 80).trim() || 'New space';
    if ('systemPrompt' in req.body) patch.system_prompt = String(req.body.systemPrompt || '').slice(0, 4000);
    if ('modelId' in req.body) { const m = db.models.byId(req.body.modelId); if (m) patch.model_id = m.id; }
    const updated = db.spaces.update(s.id, patch);
    broadcastSpace(s.id, { type: 'space_updated', spaceId: s.id, space: shapeSpace(updated, null) });
    res.json(shapeSpace(updated, req.user.id));
  });

  app.delete('/api/spaces/:id', authMiddleware, (req, res) => {
    const s = ownSpace(req, res, { requireOwner: true }); if (!s) return;
    db.spaceMessages.remove(m => m.space_id === s.id);
    db.spaces.remove(x => x.id === s.id);
    broadcastSpace(s.id, { type: 'space_deleted', spaceId: s.id });
    res.json({ ok: true });
  });

  app.post('/api/spaces/:id/invite', authMiddleware, (req, res) => {
    const s = ownSpace(req, res, { requireOwner: true }); if (!s) return;
    const target = db.users.byId(req.body?.userId);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You are already in this space.' });
    const members = [...(s.members || [])];
    const existing = members.find(m => m.userId === target.id);
    const t = now();
    if (existing) {
      if (existing.status === 'declined') {
        existing.status = 'invited'; existing.invitedAt = t; existing.respondedAt = null;
      } else {
        return res.status(400).json({ error: 'That user is already invited or a member.' });
      }
    } else {
      if (members.length >= 25) return res.status(400).json({ error: 'A space can have at most 25 members.' });
      members.push({ userId: target.id, displayName: target.display_name || target.email.split('@')[0], email: target.email, role: 'member', status: 'invited', invitedAt: t, respondedAt: null });
    }
    const updated = db.spaces.update(s.id, { members, updated_at: t });
    broadcastToUser(target.id, { type: 'space_invite', space: shapeSpace(updated, target.id) });
    res.json(shapeSpace(updated, req.user.id));
  });

  app.post('/api/spaces/:id/respond', authMiddleware, (req, res) => {
    const s = db.spaces.byId(req.params.id);
    if (!s || !isMember(s, req.user.id)) return res.status(404).json({ error: 'not found' });
    const accept = !!req.body?.accept;
    const t = now();
    const members = (s.members || []).map(m => m.userId === req.user.id ? { ...m, status: accept ? 'accepted' : 'declined', respondedAt: t } : m);
    const updated = db.spaces.update(s.id, { members, updated_at: t });
    broadcastSpace(s.id, { type: 'space_updated', spaceId: s.id, space: shapeSpace(updated, null) });
    res.json(shapeSpace(updated, req.user.id));
  });

  app.post('/api/spaces/:id/leave', authMiddleware, (req, res) => {
    const s = db.spaces.byId(req.params.id);
    if (!s || !isMember(s, req.user.id)) return res.status(404).json({ error: 'not found' });
    removeUserFromSpaces(req.user.id);
    res.json({ ok: true });
  });

  app.delete('/api/spaces/:id/members/:userId', authMiddleware, (req, res) => {
    const s = ownSpace(req, res, { requireOwner: true }); if (!s) return;
    if (req.params.userId === s.owner_id) return res.status(400).json({ error: 'The owner cannot be removed, transfer or delete the space instead.' });
    const members = (s.members || []).filter(m => m.userId !== req.params.userId);
    const updated = db.spaces.update(s.id, { members, updated_at: now() });
    broadcastSpace(s.id, { type: 'space_updated', spaceId: s.id, space: shapeSpace(updated, null) });
    broadcastToUser(req.params.userId, { type: 'space_removed', spaceId: s.id });
    res.json(shapeSpace(updated, req.user.id));
  });

  app.patch('/api/spaces/:id/members/:userId', authMiddleware, (req, res) => {
    const s = ownSpace(req, res, { requireOwner: true }); if (!s) return;
    if (req.params.userId === s.owner_id) return res.status(400).json({ error: 'The owner role cannot be changed here.' });
    const role = ['editor', 'viewer'].includes(req.body?.role) ? req.body.role : null;
    if (!role) return res.status(400).json({ error: 'Role must be editor or viewer.' });
    const members = (s.members || []).map(m => m.userId === req.params.userId ? { ...m, role } : m);
    if (!members.some(m => m.userId === req.params.userId)) return res.status(404).json({ error: 'Member not found.' });
    const updated = db.spaces.update(s.id, { members, updated_at: now() });
    broadcastSpace(s.id, { type: 'space_updated', spaceId: s.id, space: shapeSpace(updated, null) });
    res.json(shapeSpace(updated, req.user.id));
  });

  app.post('/api/spaces/:id/typing', authMiddleware, (req, res) => {
    const s = db.spaces.byId(req.params.id);
    if (!s || !isAccepted(s, req.user.id)) return res.status(404).json({ error: 'not found' });
    const me = memberOf(s, req.user.id);
    broadcastSpace(s.id, { type: 'space_user_typing', spaceId: s.id, userId: req.user.id, name: me?.displayName || req.user.email.split('@')[0], typing: !!req.body?.typing }, req.user.id);
    res.json({ ok: true });
  });

  app.get('/api/spaces/:id/messages', authMiddleware, (req, res) => {
    const s = db.spaces.byId(req.params.id);
    if (!s || !isAccepted(s, req.user.id)) return res.status(404).json({ error: 'not found' });
    res.json(db.spaceMessages.bySpace(s.id).map(shapeSpaceMsg));
  });

  app.post('/api/spaces/:id/messages', authMiddleware, (req, res) => {
    const s = db.spaces.byId(req.params.id);
    if (!s || !isAccepted(s, req.user.id)) return res.status(404).json({ error: 'not found' });
    if (!canPost(s, req.user.id)) return res.status(403).json({ error: 'You have view-only access to this space.' });
    const content = String(req.body?.content || '').slice(0, 8000).trim();
    if (!content) return res.status(400).json({ error: 'Empty message.' });
    const me = (s.members || []).find(m => m.userId === req.user.id);
    const t = now();
    const row = db.spaceMessages.insert({ id: uid(), space_id: s.id, user_id: req.user.id, role: 'user', author_name: me?.displayName || req.user.email, content, created_at: t });
    db.spaces.update(s.id, { updated_at: t });
    broadcastSpace(s.id, { type: 'space_message', spaceId: s.id, message: shapeSpaceMsg(row) });
    res.json(shapeSpaceMsg(row));
    spaceAssistantRespond(s.id).catch(() => {});
  });
}
