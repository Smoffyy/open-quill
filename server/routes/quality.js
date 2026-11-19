import { authMiddleware, adminOnly } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import { listJobs } from '../lib/evaljobs.js';
import { qualitySettings, saveQualitySettings, startBackfill, qualityReport, qualityResults, TEMPLATES, KINDS } from '../lib/quality.js';

export default function registerQualityRoutes(app) {
  const admin = [authMiddleware, adminOnly];

  app.get('/api/admin/quality', ...admin, (req, res) => {
    res.json({
      settings: qualitySettings(),
      templates: KINDS.filter(k => TEMPLATES[k]).map(k => ({ kind: k, ...TEMPLATES[k] })),
      report: qualityReport(req.query.days),
      jobs: listJobs().filter(j => j.kind === 'quality')
    });
  });

  app.put('/api/admin/quality/settings', ...admin, (req, res) => {
    const settings = saveQualitySettings(req.body);
    logAudit(req, 'quality.settings', { meta: { enabled: settings.enabled, sampleRate: settings.sampleRate, criteria: settings.criteria.length } });
    res.json({ settings });
  });

  app.get('/api/admin/quality/results', ...admin, (req, res) => {
    res.json(qualityResults({ criterion: req.query.criterion, verdict: req.query.verdict, days: req.query.days, offset: req.query.offset }));
  });

  app.post('/api/admin/quality/backfill', ...admin, (req, res) => {
    const b = req.body || {};
    const r = startBackfill({ days: b.days, limit: b.limit, criteria: Array.isArray(b.criteria) ? b.criteria : [], modelId: typeof b.modelId === 'string' ? b.modelId : '' }, req.user);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    logAudit(req, 'quality.backfill', { meta: { replies: r.job.total } });
    res.status(202).json(r);
  });
}