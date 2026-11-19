import { db, tx, now, setSetting } from '../db.js';
import { authMiddleware } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import { purgeUser } from '../lib/purge.js';
import { monthStartMs } from '../lib/budget.js';
import { requirePermission, requireAnyPermission } from '../lib/authz/middleware.js';
import { roleOf, isOwner, ACTIVE, DISABLED } from '../lib/authz/effective.js';
import { canActOn, canAssign, isLastOwner } from '../lib/authz/rules.js';
import { roleList, roleExists, PENDING, OWNER } from '../lib/authz/roles.js';
import { PERMISSIONS, MEMBER, cleanPermissions } from '../lib/authz/permissions.js';
import { setStatus, endActivity, accountChanged } from '../lib/authz/accounts.js';
import { broadcastAll } from '../lib/ws/index.js';

const OUTRANKED = 'You can only manage accounts below your own role.';
const LAST_OWNER = 'The organization needs at least one active owner.';
const PAGE_MAX = 200;

const lower = (v) => String(v || '').toLowerCase();

function userRow(actor, u, spend, seen, roles) {
  const manage = canActOn(actor, u);
  return {
    id: u.id, email: u.email, displayName: u.display_name || (u.email || '').split('@')[0],
    role: roleOf(u), status: u.status === DISABLED ? DISABLED : ACTIVE, owner: isOwner(u), source: u.source || 'local',
    createdAt: u.created_at || 0, lastSeen: seen.get(u.id) || 0, twoFactor: !!u.totp_enabled,
    budget: u.budget == null ? null : Number(u.budget), monthSpend: spend.get(u.id) || 0,
    manage, assignable: manage ? roles.filter(r => r !== roleOf(u) && canAssign(actor, u, r)) : []
  };
}

function matches(u, f) {
  if (f.q && !lower(u.email).includes(f.q) && !lower(u.display_name).includes(f.q)) return false;
  if (f.status && (u.status === DISABLED ? DISABLED : ACTIVE) !== f.status) return false;
  if (f.role && roleOf(u) !== f.role) return false;
  return true;
}

function loadTarget(req, res) {
  const u = db.users.byId(req.params.id);
  if (!u) { res.status(404).json({ error: 'not found' }); return null; }
  if (!canActOn(req.user, u)) { res.status(403).json({ error: OUTRANKED }); return null; }
  return u;
}

export default function registerPeopleRoutes(app) {
  const users = [authMiddleware, requirePermission('admin.users')];

  app.get('/api/admin/users', ...users, (req, res) => {
    const f = {
      q: lower(req.query.q).trim().slice(0, 120),
      status: req.query.status === DISABLED || req.query.status === ACTIVE ? req.query.status : '',
      role: typeof req.query.role === 'string' && roleExists(req.query.role) ? req.query.role : ''
    };
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(req.query.limit) || 50));
    const all = db.users.all();
    const hits = all.filter(u => matches(u, f))
      .sort((a, b) => (roleOf(b) === PENDING) - (roleOf(a) === PENDING) || (a.created_at || 0) - (b.created_at || 0));
    const spend = db.usage.spendSinceByUser(monthStartMs());
    const seen = db.sessions.lastSeenByUser();
    const roles = roleList().map(r => r.id);
    res.json({
      users: hits.slice(offset, offset + limit).map(u => userRow(req.user, u, spend, seen, roles)),
      total: hits.length, offset,
      counts: {
        all: all.length,
        pending: all.filter(u => roleOf(u) === PENDING).length,
        disabled: all.filter(u => u.status === DISABLED).length
      }
    });
  });

  app.patch('/api/admin/users/:id', ...users, (req, res) => {
    const u = loadTarget(req, res);
    if (!u) return;
    const b = req.body || {};
    const role = typeof b.role === 'string' ? b.role : null;
    const status = b.status === DISABLED || b.status === ACTIVE ? b.status : null;
    if (!role && !status) return res.status(400).json({ error: 'Nothing to change.' });
    if (role && !canAssign(req.user, u, role)) return res.status(403).json({ error: 'You can only grant roles below your own.' });
    const losesOwner = (role && role !== OWNER) || status === DISABLED;
    const result = tx(() => {
      const cur = db.users.byId(u.id);
      if (losesOwner && isLastOwner(cur)) return { error: LAST_OWNER };
      if (role && role !== roleOf(cur)) db.users.update(u.id, { role, ...(roleOf(cur) === PENDING ? { approved_by: req.user.id, approved_at: now() } : {}) });
      return { from: roleOf(cur), was: cur.status === DISABLED ? DISABLED : ACTIVE };
    });
    if (result.error) return res.status(409).json({ error: result.error });
    if (role && role !== result.from) logAudit(req, result.from === PENDING ? 'user.approve' : 'user.role', { type: 'user', id: u.id, meta: { email: u.email, from: result.from, to: role } });
    if (status && status !== result.was) {
      setStatus(db.users.byId(u.id), status);
      logAudit(req, status === DISABLED ? 'user.disable' : 'user.enable', { type: 'user', id: u.id, meta: { email: u.email } });
    }
    accountChanged(u.id);
    res.json({ ok: true });
  });

  app.delete('/api/admin/users/:id/sessions', ...users, (req, res) => {
    const u = loadTarget(req, res);
    if (!u) return;
    endActivity(u.id);
    logAudit(req, 'user.sessions_revoke', { type: 'user', id: u.id, meta: { email: u.email } });
    res.json({ ok: true });
  });

  app.patch('/api/admin/users/:id/budget', ...users, (req, res) => {
    const u = db.users.byId(req.params.id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (u.id !== req.user.id && !canActOn(req.user, u)) return res.status(403).json({ error: OUTRANKED });
    const v = req.body?.budget;
    const patch = (v === null || v === '' || v === undefined) ? { budget: null } : { budget: Math.max(0, Number(v) || 0) };
    db.users.update(u.id, patch);
    logAudit(req, 'user.budget', { type: 'user', id: u.id, meta: { budget: patch.budget } });
    res.json({ ok: true, budget: patch.budget });
  });

  app.delete('/api/admin/users/:id', ...users, (req, res) => {
    const u = db.users.byId(req.params.id);
    if (!u) return res.json({ ok: true });
    if (u.id === req.user.id) return res.status(403).json({ error: 'You cannot remove your own account here.' });
    if (!canActOn(req.user, u)) return res.status(403).json({ error: OUTRANKED });
    if (isLastOwner(u)) return res.status(409).json({ error: LAST_OWNER });
    endActivity(u.id);
    purgeUser(u.id);
    logAudit(req, 'user.delete', { type: 'user', id: u.id, meta: { email: u.email } });
    res.json({ ok: true });
  });

  app.get('/api/admin/roles', authMiddleware, requireAnyPermission('admin.users', 'admin.groups'), (req, res) => {
    res.json({ roles: roleList(), permissions: PERMISSIONS.map(p => ({ id: p.id, tier: p.tier, category: p.category })) });
  });

  app.put('/api/admin/roles/user-baseline', authMiddleware, requirePermission('admin.groups'), (req, res) => {
    const list = cleanPermissions(req.body?.permissions, MEMBER);
    setSetting('auth_user_baseline', list);
    logAudit(req, 'role.baseline', { type: 'role', id: 'user', meta: { permissions: list.length } });
    broadcastAll({ type: 'account' });
    res.json({ roles: roleList() });
  });
}