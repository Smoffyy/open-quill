import { db, now } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import * as skillsys from '../skillsys.js';
import * as mcp from '../mcp.js';
import { logAudit } from '../lib/audit.js';
import { purgeUserChats } from '../lib/purge.js';
import { monthStartMs } from '../lib/budget.js';
import { removeUserFromSpaces } from '../lib/spaces.js';
import * as dataroot from '../lib/dataroot.js';
import { toolStatsReport } from '../lib/toolstats.js';

export default function registerAdminRoutes(app) {
  app.get('/api/admin/skills', authMiddleware, adminOnly, (req, res) => res.json({ skills: skillsys.list() }));
  app.post('/api/admin/skills', authMiddleware, adminOnly, (req, res) => {
    const r = skillsys.create(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    logAudit(req, 'skill.create', { meta: { name: r.skill.name } });
    res.json(r);
  });
  app.patch('/api/admin/skills/:id', authMiddleware, adminOnly, (req, res) => {
    const r = skillsys.update(req.params.id, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    logAudit(req, 'skill.update', { meta: { name: r.skill.name } });
    res.json(r);
  });
  app.delete('/api/admin/skills/:id', authMiddleware, adminOnly, (req, res) => {
    skillsys.remove(req.params.id);
    logAudit(req, 'skill.delete', { meta: { id: req.params.id } });
    res.json({ ok: true });
  });

  app.get('/api/admin/mcp', authMiddleware, adminOnly, (req, res) => res.json({ servers: mcp.list() }));
  app.post('/api/admin/mcp', authMiddleware, adminOnly, async (req, res) => {
    const r = mcp.create(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    logAudit(req, 'mcp.create', { meta: { name: r.server.name } });
    const refreshed = await mcp.refreshTools(r.server.id);
    res.json({ server: refreshed.server || r.server, warning: refreshed.error || undefined });
  });
  app.patch('/api/admin/mcp/:id', authMiddleware, adminOnly, (req, res) => {
    const r = mcp.update(req.params.id, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    logAudit(req, 'mcp.update', { meta: { name: r.server.name } });
    res.json(r);
  });
  app.delete('/api/admin/mcp/:id', authMiddleware, adminOnly, (req, res) => {
    mcp.remove(req.params.id);
    logAudit(req, 'mcp.delete', { meta: { id: req.params.id } });
    res.json({ ok: true });
  });
  app.post('/api/admin/mcp/:id/refresh', authMiddleware, adminOnly, async (req, res) => {
    const r = await mcp.refreshTools(req.params.id);
    if (!r.server) return res.status(404).json({ error: 'Server not found.' });
    res.json({ server: r.server, error: r.error || undefined });
  });

  app.get('/api/admin/safety-log', authMiddleware, adminOnly, (req, res) => {
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const rows = db.feedback.filter(f => f.kind === 'safety').sort((a, b) => b.ts - a.ts).slice(offset, offset + 50);
    const users = new Map(db.users.all().map(u => [u.id, u]));
    const models = new Map(db.models.all().map(m => [m.id, m]));
    res.json({
      entries: rows.map(f => ({
        id: f.id, ts: f.ts, snippet: f.snippet || '', reason: f.comment || '',
        user: users.get(f.user_id)?.email || 'deleted user',
        model: models.get(f.model_id)?.display_name || f.model_id || '\u2014'
      })),
      total: db.feedback.count(f => f.kind === 'safety')
    });
  });
  app.delete('/api/admin/safety-log', authMiddleware, adminOnly, (req, res) => {
    db.feedback.remove(f => f.kind === 'safety');
    res.json({ ok: true });
  });

  app.get('/api/admin/feedback', authMiddleware, adminOnly, (req, res) => {
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const rows = db.feedback.filter(f => f.kind !== 'safety').sort((a, b) => b.ts - a.ts).slice(offset, offset + 50);
    const users = new Map(db.users.all().map(u => [u.id, u]));
    const models = new Map(db.models.all().map(m => [m.id, m]));
    res.json({
      feedback: rows.map(f => ({
        id: f.id, ts: f.ts, rating: f.rating, comment: f.comment || '', snippet: f.snippet || '',
        user: users.get(f.user_id)?.email || 'deleted user',
        model: models.get(f.model_id)?.display_name || f.model_id || '\u2014',
        chatId: f.chat_id
      })),
      counts: { up: db.feedback.count(f => f.kind !== 'safety' && f.rating === 1), down: db.feedback.count(f => f.kind !== 'safety' && f.rating === -1) }
    });
  });

  app.get('/api/admin/usage', authMiddleware, adminOnly, (req, res) => {
    const windows = { '7': 7, '30': 30, '90': 90 };
    const days = windows[String(req.query.days)] || 30;
    const since = now() - days * 24 * 60 * 60 * 1000;
    const nameById = new Map(db.users.all().map(u => [u.id, u.display_name || u.email]));
    const byUser = new Map(), byModel = new Map(), byDay = new Map();
    let tp = 0, tc = 0, tcost = 0, gens = 0;
    for (const r of db.usage.since(since)) {
      gens++; const p = r.prompt || 0, c = r.completion || 0, cost = r.cost || 0;
      tp += p; tc += c; tcost += cost;
      const uk = r.user_id || 'unknown';
      const ue = byUser.get(uk) || { userId: uk, name: nameById.get(uk) || 'Unknown', prompt: 0, completion: 0, cost: 0, count: 0 };
      ue.prompt += p; ue.completion += c; ue.cost += cost; ue.count++; byUser.set(uk, ue);
      const mk = r.model_id || 'unknown';
      const me = byModel.get(mk) || { modelId: mk, name: r.model_name || 'Unknown', prompt: 0, completion: 0, cost: 0, count: 0 };
      me.prompt += p; me.completion += c; me.cost += cost; me.count++; if (r.model_name) me.name = r.model_name; byModel.set(mk, me);
      const dk = new Date(r.created_at || 0).toISOString().slice(0, 10);
      const de = byDay.get(dk) || { day: dk, prompt: 0, completion: 0, cost: 0 };
      de.prompt += p; de.completion += c; de.cost += cost; byDay.set(dk, de);
    }
    res.json({
      totals: { prompt: tp, completion: tc, total: tp + tc, cost: tcost, generations: gens, users: byUser.size },
      users: [...byUser.values()].sort((a, b) => b.cost - a.cost || (b.prompt + b.completion) - (a.prompt + a.completion)),
      models: [...byModel.values()].sort((a, b) => (b.prompt + b.completion) - (a.prompt + a.completion)),
      daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-90),
      window: days
    });
  });

  app.get('/api/admin/tool-stats', authMiddleware, adminOnly, (req, res) => {
    res.json(toolStatsReport());
  });

  app.delete('/api/admin/tool-stats', authMiddleware, adminOnly, (req, res) => {
    db.toolStats.clear();
    logAudit(req, 'toolstats.clear', { type: 'toolstats', id: '' });
    res.json({ ok: true });
  });

  app.patch('/api/admin/users/:id/budget', authMiddleware, adminOnly, (req, res) => {
    const u = db.users.byId(req.params.id);
    if (!u) return res.status(404).json({ error: 'not found' });
    const v = req.body?.budget;
    const patch = (v === null || v === '' || v === undefined) ? { budget: null } : { budget: Math.max(0, Number(v) || 0) };
    db.users.update(u.id, patch);
    logAudit(req, 'user.budget', { type: 'user', id: u.id, meta: { budget: patch.budget } });
    res.json({ ok: true, budget: patch.budget });
  });

  app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
    const since = monthStartMs();
    const spend = db.usage.spendSinceByUser(since);
    res.json(db.users.all().sort((a, b) => a.created_at - b.created_at).map(u => ({
      id: u.id, email: u.email, displayName: u.display_name || (u.email || '').split('@')[0],
      isAdmin: !!u.is_admin, isOwner: !!u.is_owner, createdAt: u.created_at,
      twoFactor: !!u.totp_enabled, budget: u.budget == null ? null : Number(u.budget),
      monthSpend: spend.get(u.id) || 0
    })));
  });
  app.patch('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
    const u = db.users.byId(req.params.id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (u.is_owner) return res.status(403).json({ error: 'The top admin cannot be changed.' });
    if ('isAdmin' in req.body) db.users.update(u.id, { is_admin: req.body.isAdmin ? 1 : 0 });
    logAudit(req, 'user.role', { type: 'user', id: u.id, meta: { email: u.email, isAdmin: !!req.body.isAdmin } });
    res.json({ ok: true });
  });
  app.delete('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
    const u = db.users.byId(req.params.id);
    if (!u) return res.json({ ok: true });
    if (u.is_owner) return res.status(403).json({ error: 'The top admin cannot be removed.' });
    if (u.id === req.user.id) return res.status(403).json({ error: 'You cannot remove your own account here.' });
    purgeUserChats(u.id);
    removeUserFromSpaces(u.id);
    db.sessions.removeWhere('user_id', u.id);
    db.users.removeById(u.id);
    logAudit(req, 'user.delete', { type: 'user', id: u.id, meta: { email: u.email } });
    res.json({ ok: true });
  });

  app.get('/api/admin/audit', authMiddleware, adminOnly, (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 60));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const action = String(req.query.action || '').trim().toLowerCase();
    const actor = String(req.query.actor || '').trim().toLowerCase();
    const sinceDays = parseInt(req.query.days) || 0;
    const since = sinceDays > 0 ? now() - sinceDays * 24 * 60 * 60 * 1000 : 0;
    const match = r => (!action || (r.action || '').toLowerCase().includes(action))
      && (!actor || (r.actor_email || '').toLowerCase().includes(actor))
      && (!since || (r.ts || 0) >= since);
    const rows = db.audit.recent(100000, 0);
    const all = rows.filter(match);
    const actions = [...new Set(rows.map(r => r.action))].sort();
    const page = all.slice(offset, offset + limit).map(r => ({
      id: r.id, ts: r.ts, actorEmail: r.actor_email || 'system', action: r.action,
      targetType: r.target_type || null, targetId: r.target_id || null, meta: r.meta || null, ip: r.ip || ''
    }));
    res.json({ entries: page, total: all.length, offset, hasMore: offset + page.length < all.length, actions });
  });

  app.get('/api/admin/audit/export', authMiddleware, adminOnly, (req, res) => {
    const esc = v => { const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = ['timestamp,actor,action,target_type,target_id,ip,meta'];
    for (const r of db.audit.recent(100000, 0)) {
      lines.push([new Date(r.ts).toISOString(), r.actor_email || 'system', r.action, r.target_type || '', r.target_id || '', r.ip || '', r.meta].map(esc).join(','));
    }
    logAudit(req, 'audit.export', {});
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(lines.join('\n'));
  });

  app.get('/api/admin/databases', authMiddleware, adminOnly, (req, res) => {
    res.json({ ...dataroot.activeInfo(), databases: dataroot.listDatabases() });
  });

  app.post('/api/admin/databases', authMiddleware, adminOnly, (req, res) => {
    const r = dataroot.createDatabase((req.body || {}).name);
    if (!r.ok) return res.status(400).json({ error: r.error });
    logAudit(req, 'database.create', { meta: { name: r.database.name } });
    res.json({ ...dataroot.activeInfo(), databases: dataroot.listDatabases(), created: r.database.name });
  });

  app.post('/api/admin/databases/activate', authMiddleware, adminOnly, (req, res) => {
    const r = dataroot.setPendingDatabase((req.body || {}).name);
    if (!r.ok) return res.status(400).json({ error: r.error });
    logAudit(req, 'database.activate', { meta: { name: r.pending } });
    res.json({ ...dataroot.activeInfo(), databases: dataroot.listDatabases() });
  });

  app.delete('/api/admin/databases/:name', authMiddleware, adminOnly, (req, res) => {
    const r = dataroot.deleteDatabase(req.params.name);
    if (!r.ok) return res.status(400).json({ error: r.error });
    logAudit(req, 'database.delete', { meta: { name: req.params.name } });
    res.json({ ...dataroot.activeInfo(), databases: dataroot.listDatabases() });
  });
}
