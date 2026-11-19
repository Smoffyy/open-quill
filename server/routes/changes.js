import { authMiddleware } from '../auth.js';
import { requirePermission } from '../lib/authz/middleware.js';
import { can } from '../lib/authz/effective.js';
import { logAudit } from '../lib/audit.js';
import { pendingChanges, publish, discard, restore, releaseList, releaseDetail } from '../lib/releases.js';

const MAX_KEYS = 5000;

function keyList(raw) {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.slice(0, MAX_KEYS).filter(k => typeof k === 'string' && k.length <= 200))];
}

const versionOf = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

function answer(res, fn) {
  try { res.json(fn()); }
  catch (e) {
    if (!e?.status) throw e;
    res.status(e.status).json({ error: e.message });
  }
}

function publisher(req, res, next) {
  if (can(req.user, 'admin.publish')) return next();
  res.status(403).json({ error: 'Publishing needs the publish permission. Ask an admin or an owner.' });
}

export default function registerChangeRoutes(app) {
  const panel = [authMiddleware, requirePermission('admin.panel')];

  app.get('/api/admin/changes', ...panel, (req, res) => res.json(pendingChanges()));

  app.post('/api/admin/changes/publish', ...panel, publisher, (req, res) => answer(res, () => {
    const b = req.body || {};
    const rel = publish(req.user, { keys: keyList(b.keys), note: b.note, base: b.base == null ? null : versionOf(b.base) });
    logAudit(req, 'config.publish', { meta: { version: rel.version, changes: rel.changes.length } });
    return { ok: true, version: rel.version, count: rel.changes.length };
  }));

  app.post('/api/admin/changes/discard', ...panel, (req, res) => answer(res, () => {
    const r = discard(req.user, { keys: keyList(req.body?.keys), onlyOwn: !can(req.user, 'admin.publish') });
    logAudit(req, 'config.discard', { meta: { changes: r.count } });
    return { ok: true, count: r.count };
  }));

  app.get('/api/admin/releases', ...panel, (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    res.json(releaseList(limit, offset));
  });

  app.get('/api/admin/releases/:version', ...panel, (req, res) =>
    answer(res, () => releaseDetail(versionOf(req.params.version))));

  app.post('/api/admin/releases/:version/restore', ...panel, publisher, (req, res) => answer(res, () => {
    const from = versionOf(req.params.version);
    const rel = restore(req.user, from, { note: req.body?.note });
    logAudit(req, 'config.restore', { meta: { version: rel.version, from } });
    return { ok: true, version: rel.version, count: rel.changes.length };
  }));
}