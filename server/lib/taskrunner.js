import { db, uid, now, getSetting } from '../db.js';
import { resolveModel, resolveModelOrDefault } from './models.js';
import { applyKwargs } from './kwargs.js';
import { budgetStatus } from './budget.js';
import { runQueued } from './queue.js';
import { ensureChain } from './tree.js';
import { maybeUpdateMemory } from './memory.js';
import { isRouter, resolveRouted } from './router.js';
import { isDue, nextRun } from './tasks.js';
import { runCompletion } from './ws/turn.js';
import * as live from './ws/live.js';

const POLL_MS = 30000;

export function fireTask(task) {
  const user = db.users.byId(task.user_id);
  if (!user) return { error: 'The task owner no longer exists.' };

  let baseModel = resolveModelOrDefault(task.model_id, !!user.is_admin);
  if (!baseModel) return { error: 'No model is available to run this task.' };
  if (isRouter(baseModel)) {
    const probe = [{ role: 'user', content: task.prompt || '' }];
    const r = resolveRouted(baseModel, probe, [], (id) => resolveModel(id, !!user.is_admin));
    if (!r.model) return { error: (r.routed && r.routed.error) || 'This router could not pick a model.' };
    baseModel = r.model;
  }
  if (baseModel.unavailable && !user.is_admin) return { error: baseModel.unavailable_reason || 'This model is currently unavailable.' };
  const bs = budgetStatus(user);
  if (bs.enforce && bs.state === 'over') return { error: 'The monthly usage budget has been reached.' };

  const model = applyKwargs(baseModel, {}, !!user.is_admin);
  const at = now();
  const chat = db.chats.insert({
    id: uid(), user_id: user.id, project_id: null, title: (task.title || 'Scheduled task').slice(0, 120),
    starred: 0, sandbox: 0, created_at: at, updated_at: at
  });
  const umid = uid();
  db.messages.insert({ id: umid, chat_id: chat.id, role: 'user', content: task.prompt || '', reasoning: '', model_id: null, attachments: [], parent_id: null, created_at: at });
  db.chats.update(chat.id, { active_leaf: umid });
  ensureChain(chat.id);

  const send = (s) => live.sendLive(user.id, s);
  const ws = { readyState: 1, send };
  const state = { aborts: live.aborts, steers: live.steers, stops: live.stops };
  send(JSON.stringify({ type: 'task_started', chatId: chat.id, taskId: task.id, title: chat.title }));

  live.beginTurn(user.id, chat.id, model.id);
  const queueOn = getSetting('model_queue', '0') === '1';
  runQueued(queueOn, model.id, () => {}, () => runCompletion(ws, state, send, chat, model, false, false, 0, false, false, ''))
    .catch(err => console.error('[tasks] run failed for', task.id, err))
    .finally(() => live.endTurn(chat.id))
    .then(() => { try { maybeUpdateMemory(user.id, model); } catch {} });

  return { chatId: chat.id };
}

export function dueTasks(at = Date.now()) {
  return db.tasks.filter(t => isDue(t, at));
}

export function runDueTasks() {
  const at = now();
  for (const task of dueTasks(at)) {
    const r = fireTask(task);
    if (r.error) console.warn('[tasks] could not run', task.id, '-', r.error);
    const patch = { last_run: at, updated_at: at, next_run: nextRun(task.schedule, at) };
    if (r.chatId) patch.last_chat_id = r.chatId;
    db.tasks.update(task.id, patch);
  }
}

let timer = null;
export function startTaskScheduler(intervalMs = POLL_MS) {
  if (timer) return;
  runDueTasks();
  timer = setInterval(runDueTasks, intervalMs);
  if (timer.unref) timer.unref();
}

export function stopTaskScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
