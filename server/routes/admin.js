import { db, now } from '../db.js';
import { authMiddleware } from '../auth.js';
import { requirePermission } from '../lib/authz/middleware.js';
import * as workspaceSkills from '../lib/workspaceskills.js';
import * as mcp from '../lib/mcp.js';
import { memberPolicy, setMemberPolicy } from '../lib/mcpnet.js';
import { logAudit } from '../lib/audit.js';
import { plainSnippet } from '../lib/history.js';
import * as dataroot from '../lib/dataroot.js';
import { toolStatsReport } from '../lib/toolstats.js';
import { USAGE_WINDOWS } from './auth.js';

export default function registerAdminRoutes(app) {
  app.get('/api/admin/skills', authMiddleware, requirePermission('admin.tools'), (req, res) => res.json({ skills: workspaceSkills.list() }));
  app.post('/api/admin/skills', authMiddleware, requirePermission('admin.tools'), (req, res) => {
    const r = workspaceSkills.create(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    logAudit(req, 'skill.create', { meta: { name: r.skill.name } });
    res.json(r);
  });
  app.patch('/api/admin/skills/:id', authMiddleware, requirePermission('admin.tools'), (req, res) => {
    const r = workspaceSkills.update(req.params.id, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    logAudit(req, 'skill.update', { meta: { name: r.skill.name } });
    res.json(r);
  });
  app.delete('/api/admin/skills/:id', authMiddleware, requirePermission('admin.tools'), (req, res) => {
    workspaceSkills.remove(req.params.id);
    logAudit(req, 'skill.delete', { meta: { id: req.params.id } });
    res.json({ ok: true });
  });

  app.get('/api/admin/mcp', authMiddleware, requirePermission('admin.tools'), (req, res) => res.json({ servers: mcp.list().map(mcp.publicServer), policy: memberPolicy() }));
  app.put('/api/admin/mcp/policy', authMiddleware, requirePermission('admin.tools'), (req, res) => {
    const policy = setMemberPolicy({ allowed: req.body?.allowed, hosts: req.body?.hosts });
    logAudit(req, 'mcp.policy', { meta: { allowed: policy.allowed, hosts: policy.hosts.length } });
    res.json({ policy });
  });
  app.post('/api/admin/mcp', authMiddleware, requirePermission('admin.tools'), async (req, res) => {
    const r = mcp.create(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    logAudit(req, 'mcp.create', { meta: { name: r.server.name } });
    const refreshed = await mcp.refreshTools(r.server.id);
    res.json({ server: mcp.publicServer(refreshed.server || r.server), warning: refreshed.error || undefined });
  });
  app.patch('/api/admin/mcp/:id', authMiddleware, requirePermission('admin.tools'), async (req, res) => {
    const r = mcp.update(req.params.id, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    logAudit(req, 'mcp.update', { meta: { name: r.server.name } });
    if (!r.server.enabled) return res.json({ server: mcp.publicServer(r.server) });
    const refreshed = await mcp.refreshTools(r.server.id);
    res.json({ server: mcp.publicServer(refreshed.server || r.server), warning: refreshed.error || undefined });
  });
  app.delete('/api/admin/mcp/:id', authMiddleware, requirePermission('admin.tools'), (req, res) => {
    mcp.remove(req.params.id);
    logAudit(req, 'mcp.delete', { meta: { id: req.params.id } });
    res.json({ ok: true });
  });
  app.put('/api/admin/mcp/:id/tools', authMiddleware, requirePermission('admin.tools'), (req, res) => {
    const r = mcp.setToolModes(req.params.id, req.body?.modes);
    if (r.error) return res.status(404).json({ error: r.error });
    logAudit(req, 'mcp.tools', { meta: { name: r.server.name } });
    res.json({ server: mcp.publicServer(r.server) });
  });
  app.post('/api/admin/mcp/:id/try', authMiddleware, requirePermission('admin.tools'), async (req, res) => {
    const r = await mcp.tryTool(req.params.id, String(req.body?.tool || ''), req.body?.args);
    if (r.error && r.ok === undefined) return res.status(404).json({ error: r.error });
    logAudit(req, 'mcp.try', { meta: { tool: String(req.body?.tool || '').slice(0, 80) } });
    res.json({ result: { ok: r.ok, ms: r.ms, content: r.content || '', error: r.error || '', images: (r.images || []).length } });
  });
  app.post('/api/admin/mcp/:id/refresh', authMiddleware, requirePermission('admin.tools'), async (req, res) => {
    const r = await mcp.refreshTools(req.params.id);
    if (!r.server) return res.status(404).json({ error: 'Server not found.' });
    res.json({ server: mcp.publicServer(r.server), error: r.error || undefined });
  });

  const FEEDBACK_PAGE = 50;
  const labelMaps = () => ({
    users: new Map(db.users.all().map(u => [u.id, u.email])),
    models: new Map(db.models.all().map(m => [m.id, m.display_name]))
  });

  app.get('/api/admin/safety-log', authMiddleware, requirePermission('admin.policy'), (req, res) => {
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const rows = db.feedback.pageByKind(true, FEEDBACK_PAGE, offset);
    const { users, models } = labelMaps();
    res.json({
      entries: rows.map(f => ({
        id: f.id, ts: f.ts, snippet: f.snippet || '', reason: f.comment || '',
        user: users.get(f.user_id) || 'deleted user',
        model: models.get(f.model_id) || f.model_id || '\u2014'
      })),
      total: db.feedback.countByKind(true)
    });
  });
  app.delete('/api/admin/safety-log', authMiddleware, requirePermission('admin.policy'), (req, res) => {
    db.feedback.clearSafety();
    logAudit(req, 'safety.log_clear', {});
    res.json({ ok: true });
  });

  app.get('/api/admin/feedback', authMiddleware, requirePermission('admin.quality'), (req, res) => {
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const rows = db.feedback.pageByKind(false, FEEDBACK_PAGE, offset);
    const { users, models } = labelMaps();
    res.json({
      feedback: rows.map(f => ({
        id: f.id, ts: f.ts, rating: f.rating, comment: f.comment || '', snippet: plainSnippet(f.snippet),
        user: users.get(f.user_id) || 'deleted user',
        model: models.get(f.model_id) || f.model_id || '\u2014',
        chatId: f.chat_id, messageId: f.message_id || ''
      })),
      counts: db.feedback.ratingCounts()
    });
  });

  app.get('/api/admin/usage', authMiddleware, requirePermission('admin.usage'), (req, res) => {
    const days = USAGE_WINDOWS.has(Number(req.query.days)) ? Number(req.query.days) : 30;
    const since = now() - days * 24 * 60 * 60 * 1000;
    const nameById = new Map(db.users.all().map(u => [u.id, u.display_name || u.email]));
    const { totals, byUser, byModel, byDay } = db.usage.report(since);
    res.json({
      totals: {
        prompt: totals.prompt, completion: totals.completion, total: totals.prompt + totals.completion, cached: totals.cached,
        cost: totals.cost, generations: totals.count, users: totals.users
      },
      users: byUser
        .map(r => ({ ...r, name: nameById.get(r.userId) || 'Unknown' }))
        .sort((a, b) => b.cost - a.cost || (b.prompt + b.completion) - (a.prompt + a.completion)),
      models: byModel
        .map(r => ({ ...r, name: r.name || 'Unknown' }))
        .sort((a, b) => (b.prompt + b.completion) - (a.prompt + a.completion)),
      daily: byDay.slice(-90),
      window: days
    });
  });

  app.get('/api/admin/tool-stats', authMiddleware, requirePermission('admin.usage'), (req, res) => {
    res.json(toolStatsReport());
  });

  app.delete('/api/admin/tool-stats', authMiddleware, requirePermission('admin.usage'), (req, res) => {
    db.toolStats.clear();
    logAudit(req, 'toolstats.clear', { type: 'toolstats', id: '' });
    res.json({ ok: true });
  });


  app.get('/api/admin/audit', authMiddleware, requirePermission('admin.audit'), (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 60));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const action = String(req.query.action || '').trim().toLowerCase();
    const actor = String(req.query.actor || '').trim().toLowerCase();
    const sinceDays = parseInt(req.query.days) || 0;
    const since = sinceDays > 0 ? now() - sinceDays * 24 * 60 * 60 * 1000 : 0;
    const filter = { action, actor, since, limit, offset };
    const total = db.audit.countMatching(filter);
    const page = db.audit.query(filter).map(r => ({
      id: r.id, ts: r.ts, actorEmail: r.actor_email || 'system', action: r.action,
      targetType: r.target_type || null, targetId: r.target_id || null, meta: r.meta || null, ip: r.ip || ''
    }));
    res.json({ entries: page, total, offset, hasMore: offset + page.length < total, actions: db.audit.actions() });
  });

  app.get('/api/admin/audit/export', authMiddleware, requirePermission('admin.audit'), (req, res) => {
    const esc = v => { const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    logAudit(req, 'audit.export', {});
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    // Streamed a row at a time, paused when the socket is full: the whole log never has
    // to exist in memory, in Node's write buffer, or as one joined string.
    const rows = db.audit.stream();
    const pump = () => {
      for (;;) {
        const { value: r, done } = rows.next();
        if (done) return res.end();
        const line = [new Date(r.ts).toISOString(), r.actor_email || 'system', r.action, r.target_type || '', r.target_id || '', r.ip || '', r.meta].map(esc).join(',') + '\n';
        if (!res.write(line)) return res.once('drain', pump);
      }
    };
    res.on('close', () => { try { rows.return(); } catch {} });
    res.write('timestamp,actor,action,target_type,target_id,ip,meta\n');
    pump();
  });

  app.get('/api/admin/databases', authMiddleware, requirePermission('admin.storage'), (req, res) => {
    res.json({ ...dataroot.activeInfo(), databases: dataroot.listDatabases() });
  });

  app.post('/api/admin/databases', authMiddleware, requirePermission('admin.storage'), (req, res) => {
    const r = dataroot.createDatabase((req.body || {}).name);
    if (!r.ok) return res.status(400).json({ error: r.error });
    logAudit(req, 'database.create', { meta: { name: r.database.name } });
    res.json({ ...dataroot.activeInfo(), databases: dataroot.listDatabases(), created: r.database.name });
  });

  app.post('/api/admin/databases/activate', authMiddleware, requirePermission('admin.storage'), (req, res) => {
    const r = dataroot.setPendingDatabase((req.body || {}).name);
    if (!r.ok) return res.status(400).json({ error: r.error });
    logAudit(req, 'database.activate', { meta: { name: r.pending } });
    res.json({ ...dataroot.activeInfo(), databases: dataroot.listDatabases() });
  });

  app.delete('/api/admin/databases/:name', authMiddleware, requirePermission('admin.storage'), (req, res) => {
    const r = dataroot.deleteDatabase(req.params.name);
    if (!r.ok) return res.status(400).json({ error: r.error });
    logAudit(req, 'database.delete', { meta: { name: req.params.name } });
    res.json({ ...dataroot.activeInfo(), databases: dataroot.listDatabases() });
  });
}