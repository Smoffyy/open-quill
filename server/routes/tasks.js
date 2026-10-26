import { db, uid, now } from '../db.js';
import { authMiddleware } from '../auth.js';
import { normalizeSchedule, nextRun } from '../lib/tasks.js';
import { fireTask } from '../lib/taskrunner.js';

const TITLE_MAX = 160;
const PROMPT_MAX = 8000;
const TASK_LIMIT = 200;

function view(t) {
  return {
    id: t.id,
    title: t.title,
    prompt: t.prompt || '',
    modelId: t.model_id || '',
    schedule: normalizeSchedule(t.schedule),
    enabled: t.enabled !== 0,
    webSearch: !!t.web_search,
    reuseChat: !!t.reuse_chat,
    nextRun: t.next_run || 0,
    lastRun: t.last_run || 0,
    lastChatId: t.last_chat_id || '',
    created_at: t.created_at,
    updated_at: t.updated_at
  };
}

function editable(body) {
  const patch = {};
  if ('title' in body) patch.title = String(body.title ?? '').slice(0, TITLE_MAX).trim() || 'New task';
  if ('prompt' in body) patch.prompt = String(body.prompt ?? '').slice(0, PROMPT_MAX);
  if ('modelId' in body) patch.model_id = String(body.modelId ?? '').slice(0, 120);
  if ('schedule' in body) patch.schedule = normalizeSchedule(body.schedule);
  if ('enabled' in body) patch.enabled = body.enabled === false ? 0 : 1;
  if ('webSearch' in body) patch.web_search = body.webSearch === true ? 1 : 0;
  if ('reuseChat' in body) patch.reuse_chat = body.reuseChat === true ? 1 : 0;
  return patch;
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
    const fields = {
      title: 'New task', prompt: '', model_id: '', schedule: normalizeSchedule(null), enabled: 1, web_search: 0, reuse_chat: 0,
      ...editable(req.body || {})
    };
    const row = db.tasks.insert({
      id: uid(),
      user_id: req.user.id,
      ...fields,
      next_run: fields.enabled ? nextRun(fields.schedule, t) : 0,
      last_run: 0,
      last_chat_id: '',
      created_at: t,
      updated_at: t
    });
    res.json(view(row));
  });

  app.patch('/api/tasks/:id', authMiddleware, (req, res) => {
    const t = own(req, res); if (!t) return;
    const patch = { ...editable(req.body || {}), updated_at: now() };
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
    const r = fireTask(t);
    if (r.error) return res.status(400).json({ error: r.error });
    const at = now();
    const patch = { last_run: at, updated_at: at, next_run: t.enabled === 0 ? 0 : nextRun(t.schedule, at), last_chat_id: r.chatId };
    res.json({ chatId: r.chatId, task: view(db.tasks.update(t.id, patch)) });
  });
}