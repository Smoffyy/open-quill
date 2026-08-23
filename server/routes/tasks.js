import { db, uid, now } from '../db.js';
import { authMiddleware } from '../auth.js';
import { normalizeSchedule, nextRun, describe } from '../lib/tasks.js';

const TITLE_MAX = 160;
const PROMPT_MAX = 8000;
const TASK_LIMIT = 200;

function view(t) {
  return {
    id: t.id,
    title: t.title,
    prompt: t.prompt || '',
    modelId: t.model_id || '',
    schedule: t.schedule,
    scheduleLabel: describe(t.schedule),
    enabled: t.enabled !== 0,
    nextRun: t.next_run || 0,
    lastRun: t.last_run || 0,
    lastChatId: t.last_chat_id || '',
    created_at: t.created_at,
    updated_at: t.updated_at
  };
}

function own(req, res) {
  const t = db.tasks.byId(req.params.id);
  if (!t || t.user_id !== req.user.id) { res.status(404).json({ error: 'not found' }); return null; }
  return t;
}

export default function registerTaskRoutes(app) {
  app.get('/api/tasks', authMiddleware, (req, res) => {
    res.json({ tasks: db.tasks.byUser(req.user.id).map(view) });
  });

  app.post('/api/tasks', authMiddleware, (req, res) => {
    if (db.tasks.byUser(req.user.id).length >= TASK_LIMIT) {
      return res.status(400).json({ error: 'too many tasks' });
    }
    const t = now();
    const schedule = normalizeSchedule(req.body?.schedule);
    const enabled = req.body?.enabled === false ? 0 : 1;
    const row = db.tasks.insert({
      id: uid(),
      user_id: req.user.id,
      title: String(req.body?.title ?? '').slice(0, TITLE_MAX).trim() || 'New task',
      prompt: String(req.body?.prompt ?? '').slice(0, PROMPT_MAX),
      model_id: String(req.body?.modelId ?? '').slice(0, 120),
      schedule,
      enabled,
      next_run: enabled ? nextRun(schedule, t) : 0,
      last_run: 0,
      last_chat_id: '',
      created_at: t,
      updated_at: t
    });
    res.json(view(row));
  });

  app.patch('/api/tasks/:id', authMiddleware, (req, res) => {
    const t = own(req, res); if (!t) return;
    const patch = { updated_at: now() };
    if ('title' in req.body) patch.title = String(req.body.title ?? '').slice(0, TITLE_MAX).trim() || 'New task';
    if ('prompt' in req.body) patch.prompt = String(req.body.prompt ?? '').slice(0, PROMPT_MAX);
    if ('modelId' in req.body) patch.model_id = String(req.body.modelId ?? '').slice(0, 120);
    if ('schedule' in req.body) patch.schedule = normalizeSchedule(req.body.schedule);
    if ('enabled' in req.body) patch.enabled = req.body.enabled === false ? 0 : 1;
    const schedule = patch.schedule || t.schedule;
    const enabled = 'enabled' in patch ? patch.enabled : t.enabled;
    patch.next_run = enabled ? nextRun(schedule, patch.updated_at) : 0;
    res.json(view(db.tasks.update(t.id, patch)));
  });

  app.delete('/api/tasks/:id', authMiddleware, (req, res) => {
    const t = own(req, res); if (!t) return;
    db.tasks.removeById(t.id);
    res.json({ ok: true });
  });

  app.post('/api/tasks/:id/run', authMiddleware, (req, res) => {
    const t = own(req, res); if (!t) return;
    const at = now();
    const patch = { last_run: at, updated_at: at, next_run: t.enabled === 0 ? 0 : nextRun(t.schedule, at) };
    if (typeof req.body?.chatId === 'string') patch.last_chat_id = req.body.chatId.slice(0, 64);
    res.json({ task: view(db.tasks.update(t.id, patch)), prompt: t.prompt || '', modelId: t.model_id || '' });
  });
}
