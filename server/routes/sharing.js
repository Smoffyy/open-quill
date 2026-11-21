import { db } from '../db.js';
import { authMiddleware } from '../auth.js';
import { requireAnyPermission } from '../lib/authz/middleware.js';
import { can, isActive, roleOf } from '../lib/authz/effective.js';
import { PENDING } from '../lib/authz/roles.js';
import { memberCounts } from '../lib/authz/groups.js';
import { RESOURCES, access, atLeast, grant, revoke, accessList, sharedWith, usersReached } from '../lib/authz/acl.js';
import { broadcastToUsers } from '../lib/ws/broadcast.js';
import { logAudit } from '../lib/audit.js';

const DIRECTORY_MAX = 20;
const lower = (s) => String(s ?? '').toLowerCase();
const nameOf = (u) => u.display_name || (u.email || '').split('@')[0];

function resourceAt(req, res) {
  const type = req.params.type;
  if (!RESOURCES[type]) { res.status(404).json({ error: 'not found' }); return null; }
  const r = access(req.user, type, req.params.id);
  if (r.error) { res.status(r.status).json({ error: r.error }); return null; }
  return { ...r, type };
}

function shareView(user, { type, resource, level }) {
  const spec = RESOURCES[type];
  const manages = atLeast(level, 'manage');
  const list = accessList(type, resource);
  return {
    level,
    levels: spec.levels,
    canShare: manages && can(user, spec.share) && (!spec.shareable || spec.shareable(resource)),
    owner: list.owner,
    grants: manages ? list.grants : list.grants.filter(g => g.principalType === 'user' && g.principalId === user.id),
    people: manages ? list.people : []
  };
}

function principalFrom(b) {
  return {
    principalType: b?.principalType === 'group' ? 'group' : 'user',
    principalId: typeof b?.principalId === 'string' ? b.principalId : ''
  };
}

export default function registerSharingRoutes(app) {
  app.get('/api/directory', authMiddleware, requireAnyPermission('chats.share', 'projects.share', 'skills.share'), (req, res) => {
    const q = lower(req.query.q).trim().slice(0, 120);
    const people = q
      ? db.users.all()
        .filter(u => u.id !== req.user.id && isActive(u) && roleOf(u) !== PENDING && (lower(u.email).includes(q) || lower(u.display_name).includes(q)))
        .slice(0, DIRECTORY_MAX)
        .map(u => ({ id: u.id, name: nameOf(u), email: u.email }))
      : [];
    const counts = memberCounts();
    const groups = db.groups.all()
      .filter(g => !q || lower(g.name).includes(q))
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name))
      .slice(0, DIRECTORY_MAX)
      .map(g => ({ id: g.id, name: g.name, members: counts.get(g.id)?.user || 0 }));
    res.json({ people, groups });
  });

  app.get('/api/shares/:type/:id', authMiddleware, (req, res) => {
    const r = resourceAt(req, res); if (!r) return;
    res.json(shareView(req.user, r));
  });

  app.put('/api/shares/:type/:id', authMiddleware, (req, res) => {
    const r = resourceAt(req, res); if (!r) return;
    const { principalType, principalId } = principalFrom(req.body);
    const level = typeof req.body?.level === 'string' ? req.body.level : '';
    const g = grant(req.user, r.type, r.resource, principalType, principalId, level);
    if (g.error) return res.status(g.status).json({ error: g.error });
    logAudit(req, g.before ? 'share.update' : 'share.grant', { type: r.type, id: r.resource.id, meta: { principalType, principalId, level, before: g.before } });
    broadcastToUsers(usersReached(principalType, principalId), { type: 'shared', resource: r.type, id: r.resource.id });
    res.json(shareView(req.user, r));
  });

  app.delete('/api/shares/:type/:id', authMiddleware, (req, res) => {
    const r = resourceAt(req, res); if (!r) return;
    const { principalType, principalId } = principalFrom(req.body);
    const reached = usersReached(principalType, principalId);
    const v = revoke(req.user, r.type, r.resource, principalType, principalId);
    if (v.error) return res.status(v.status).json({ error: v.error });
    if (v.before) {
      logAudit(req, 'share.revoke', { type: r.type, id: r.resource.id, meta: { principalType, principalId, level: v.before } });
      broadcastToUsers(reached, { type: 'shared', resource: r.type, id: r.resource.id });
    }
    const still = access(req.user, r.type, r.resource.id);
    res.json(still.error ? { ok: true, left: true } : shareView(req.user, { ...still, type: r.type }));
  });

  app.get('/api/shared/chats', authMiddleware, (req, res) => {
    const chats = [];
    for (const [id, level] of sharedWith(req.user, 'chat')) {
      const c = db.chats.byId(id);
      if (!c || c.user_id === req.user.id || c.mode === 'code') continue;
      const o = db.users.byId(c.user_id);
      chats.push({ id: c.id, title: c.title || '', owner: o ? nameOf(o) : '', level, updated_at: c.updated_at || 0 });
    }
    chats.sort((a, b) => b.updated_at - a.updated_at);
    res.json({ chats });
  });
}