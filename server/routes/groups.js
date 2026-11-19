import { db } from '../db.js';
import { authMiddleware } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import { requirePermission } from '../lib/authz/middleware.js';
import { createGroup, updateGroup, deleteGroup, setMembers, nestGroup, unnestGroup, reorderGroups, groupView, memberCounts, graph } from '../lib/authz/groups.js';
import { broadcastAll } from '../lib/ws/index.js';

const answer = (res, r, ok) => (r.error ? res.status(r.status || 400).json({ error: r.error }) : res.json(ok ? ok(r) : r));

function personView(u) {
  return { id: u.id, email: u.email, displayName: u.display_name || (u.email || '').split('@')[0], role: u.role || 'pending', status: u.status === 'disabled' ? 'disabled' : 'active' };
}

function detail(id) {
  const { groups, parents, children } = graph();
  const g = groups.get(id);
  if (!g) return null;
  const counts = memberCounts();
  const brief = (gid) => ({ id: gid, name: groups.get(gid)?.name || '', source: groups.get(gid)?.source || 'local' });
  return {
    ...groupView(g, counts),
    users: db.groupMembers.usersOf(id).map(uid => db.users.byId(uid)).filter(Boolean).map(personView)
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    childGroups: [...(children.get(id) || [])].map(brief),
    parentGroups: [...(parents.get(id) || [])].map(brief)
  };
}

export default function registerGroupRoutes(app) {
  const read = [authMiddleware, requirePermission('admin.panel')];
  const write = [authMiddleware, requirePermission('admin.groups')];
  const changed = () => broadcastAll({ type: 'account' });

  app.get('/api/admin/groups', ...read, (req, res) => {
    const counts = memberCounts();
    const { parents } = graph();
    res.json({
      groups: db.groups.all()
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || String(a.name).localeCompare(String(b.name)))
        .map(g => ({ ...groupView(g, counts), parents: [...(parents.get(g.id) || [])] }))
    });
  });

  app.get('/api/admin/groups/:id', ...read, (req, res) => {
    const d = detail(req.params.id);
    if (!d) return res.status(404).json({ error: 'not found' });
    res.json({ group: d });
  });

  app.post('/api/admin/groups', ...write, (req, res) => {
    const r = createGroup(req.body || {}, req.user.id);
    if (r.group) logAudit(req, 'group.create', { type: 'group', id: r.group.id, meta: { name: r.group.name } });
    answer(res, r, ({ group }) => ({ group: detail(group.id) }));
  });

  app.patch('/api/admin/groups/:id', ...write, (req, res) => {
    const r = updateGroup(req.params.id, req.body || {});
    if (r.group) {
      logAudit(req, 'group.update', { type: 'group', id: r.group.id, meta: { name: r.group.name, fields: Object.keys(req.body || {}) } });
      changed();
    }
    answer(res, r, ({ group }) => ({ group: detail(group.id) }));
  });

  app.delete('/api/admin/groups/:id', ...write, (req, res) => {
    const g = db.groups.byId(req.params.id);
    const r = deleteGroup(req.params.id);
    if (r.ok) {
      logAudit(req, 'group.delete', { type: 'group', id: req.params.id, meta: { name: g?.name } });
      changed();
    }
    answer(res, r);
  });

  app.put('/api/admin/groups/order', ...write, (req, res) => {
    reorderGroups(req.body?.ids);
    logAudit(req, 'group.order', {});
    changed();
    res.json({ ok: true });
  });

  app.put('/api/admin/groups/:id/members', ...write, (req, res) => {
    const b = req.body || {};
    const r = setMembers(req.params.id, { add: b.add, remove: b.remove }, req.user.id);
    if (r.ok) {
      logAudit(req, 'group.members', { type: 'group', id: req.params.id, meta: { added: (b.add || []).length, removed: (b.remove || []).length } });
      changed();
    }
    answer(res, r, () => ({ group: detail(req.params.id) }));
  });

  app.put('/api/admin/groups/:id/groups/:childId', ...write, (req, res) => {
    const r = nestGroup(req.params.id, req.params.childId, req.user.id);
    if (r.ok) {
      logAudit(req, 'group.nest', { type: 'group', id: req.params.id, meta: { child: req.params.childId } });
      changed();
    }
    answer(res, r, () => ({ group: detail(req.params.id) }));
  });

  app.delete('/api/admin/groups/:id/groups/:childId', ...write, (req, res) => {
    unnestGroup(req.params.id, req.params.childId);
    logAudit(req, 'group.unnest', { type: 'group', id: req.params.id, meta: { child: req.params.childId } });
    changed();
    const d = detail(req.params.id);
    if (!d) return res.status(404).json({ error: 'not found' });
    res.json({ group: d });
  });
}