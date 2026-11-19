import { db } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import * as evals from '../lib/evals.js';
import { startRegression, settleInterrupted } from '../lib/regression.js';
import { judgeSettings, setJudgeModel } from '../lib/judge.js';
import { listJobs, stopJob } from '../lib/evaljobs.js';
import { reviewableChat, reviewableMessage, reviewTranscript } from '../lib/review.js';

const RECENT_RUNS = 40;

const answer = (res, r, ok = 200) => {
  if (r?.error) return res.status(r.status || (r.error.endsWith('not found.') ? 404 : 400)).json({ error: r.error });
  return res.status(ok).json(r);
};

function detail(id) {
  const c = evals.getCollection(id);
  if (!c) return null;
  return { collection: c, versions: evals.versionsOf(id), runs: db.evalRuns.recent(200).filter(r => r.collection_id === id) };
}

export default function registerEvalRoutes(app) {
  const admin = [authMiddleware, adminOnly];

  app.get('/api/admin/evals', ...admin, (req, res) => {
    settleInterrupted();
    res.json({ collections: evals.listCollections(), runs: db.evalRuns.recent(RECENT_RUNS), jobs: listJobs(), judge: judgeSettings() });
  });

  app.put('/api/admin/evals/judge', ...admin, (req, res) => {
    const judge = setJudgeModel(req.body?.modelId);
    logAudit(req, 'eval.judge', { meta: { model: judge.modelId } });
    res.json({ judge });
  });

  app.get('/api/admin/evals/jobs', ...admin, (req, res) => res.json({ jobs: listJobs() }));

  app.post('/api/admin/evals/jobs/:jobId/stop', ...admin, (req, res) => {
    if (!stopJob(req.params.jobId)) return res.status(404).json({ error: 'That job is not running.' });
    res.json({ ok: true });
  });

  app.get('/api/admin/evals/runs/:runId', ...admin, (req, res) => {
    const run = db.evalRuns.byId(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found.' });
    res.json({ run });
  });

  app.delete('/api/admin/evals/runs/:runId', ...admin, (req, res) => {
    const run = db.evalRuns.byId(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found.' });
    if (run.status === 'running') return res.status(409).json({ error: 'Stop the run first.' });
    db.evalRuns.removeById(run.id);
    res.json({ ok: true });
  });

  app.post('/api/admin/evals', ...admin, (req, res) => {
    const r = evals.createCollection(req.body, req.user);
    if (r.collection) logAudit(req, 'eval.collection_create', { meta: { name: r.collection.name } });
    answer(res, r);
  });

  app.get('/api/admin/evals/:id', ...admin, (req, res) => {
    settleInterrupted();
    const d = detail(req.params.id);
    if (!d) return res.status(404).json({ error: 'Collection not found.' });
    res.json(d);
  });

  app.patch('/api/admin/evals/:id', ...admin, (req, res) => answer(res, evals.renameCollection(req.params.id, req.body)));

  app.delete('/api/admin/evals/:id', ...admin, (req, res) => {
    const r = evals.removeCollection(req.params.id);
    if (r.ok) logAudit(req, 'eval.collection_delete', { meta: { id: req.params.id } });
    answer(res, r);
  });

  app.post('/api/admin/evals/:id/cases', ...admin, (req, res) => answer(res, evals.addCase(req.params.id, req.body, req.user)));
  app.patch('/api/admin/evals/:id/cases/:caseId', ...admin, (req, res) => answer(res, evals.updateCase(req.params.id, req.params.caseId, req.body, req.user)));
  app.delete('/api/admin/evals/:id/cases/:caseId', ...admin, (req, res) => answer(res, evals.removeCase(req.params.id, req.params.caseId, req.user)));

  app.post('/api/admin/evals/:id/restore', ...admin, (req, res) => answer(res, evals.restoreVersion(req.params.id, req.body?.version, req.user)));

  app.post('/api/admin/evals/:id/from-message', ...admin, (req, res) => {
    const messageId = String(req.body?.messageId || '');
    if (!reviewableMessage(messageId)) return res.status(403).json({ error: 'Only replies that were rated or flagged by a check can become test cases.' });
    const kase = evals.caseFromReply(messageId, { reference: typeof req.body?.reference === 'string' ? req.body.reference : '', kind: req.body?.kind === 'quality' ? 'quality' : 'rating' });
    if (!kase) return res.status(404).json({ error: 'That reply is no longer there.' });
    const r = evals.addCase(req.params.id, kase, req.user);
    if (r.collection) logAudit(req, 'eval.case_from_chat', { type: 'chat', id: kase.source.chatId, meta: { message: messageId } });
    answer(res, r);
  });

  app.post('/api/admin/evals/:id/runs', ...admin, (req, res) => {
    const r = startRegression({ collectionId: req.params.id, version: req.body?.version, baseline: req.body?.baseline, candidate: req.body?.candidate }, req.user);
    if (r.run) logAudit(req, 'eval.run', { meta: { collection: r.run.collection_name, cases: r.job.total } });
    answer(res, r, r.run ? 202 : 200);
  });

  app.get('/api/admin/review/chats/:chatId', ...admin, (req, res) => {
    const chatId = String(req.params.chatId);
    if (!reviewableChat(chatId)) return res.status(404).json({ error: 'not found' });
    const view = reviewTranscript(chatId, String(req.query.message || ''));
    if (!view) return res.status(404).json({ error: 'not found' });
    logAudit(req, 'review.view', { type: 'chat', id: chatId, meta: { owner: view.chat.owner } });
    res.json(view);
  });
}