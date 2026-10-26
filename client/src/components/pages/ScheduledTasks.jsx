import { useState, useEffect, useCallback } from 'react';
import LibraryPage, { LibraryEmpty, LibraryListSkeleton } from './LibraryPage.jsx';
import TaskEditor, { scheduleLabel } from './TaskEditor.jsx';
import { Switch } from '../ui/controls.jsx';
import { ChevDown, Clock, Sun, Chat, Compact, Graduation, Coffee, Pencil, Trash, Send, ArrowOut, Plus } from '../ui/icons.jsx';
import { api } from '../../lib/api.js';
import { notify } from '../../lib/notify.js';
import { askConfirm } from '../../lib/confirm.js';
import { t, tk, fmtDateTime, fmtRelative } from '../../i18n.jsx';
import { useSkeleton } from '../../lib/skeleton.js';

const STARTERS = [
  {
    id: 'plan', Icon: Sun, title: tk('Morning plan'),
    desc: tk('A short plan for the day, built from what you have told it about your work.'),
    prompt: tk('Using what you know about me and my current work, write a short plan for today: three priorities, one thing I should stop putting off, and a realistic block of time for focused work. Keep it under 200 words and end by asking what I would change.'),
    schedule: { kind: 'weekdays', hour: 8, minute: 0 }
  },
  {
    id: 'learn', Icon: Graduation, title: tk('Learn something new'),
    desc: tk('One short lesson a day on a topic you care about, with a question to check yourself.'),
    prompt: tk('Teach me one idea from a subject you know I am interested in, or from science, history or language if you do not know my interests yet. Use today\'s date to pick it so the topic changes from day to day. Explain it in under 300 words with one concrete example, then ask me one question to check my understanding.'),
    schedule: { kind: 'daily', hour: 9, minute: 0 }
  },
  {
    id: 'language', Icon: Chat, title: tk('Language practice'),
    desc: tk('A five-minute drill in the language you are learning.'),
    prompt: tk('Give me a five-minute practice set in the language I am learning: five useful words or phrases with a short example sentence each, then three sentences for me to translate. Hold back the answers until I reply. If you do not know which language I am learning, ask me first.'),
    schedule: { kind: 'weekdays', hour: 12, minute: 0 }
  },
  {
    id: 'meals', Icon: Coffee, title: tk('Meal plan'),
    desc: tk('Five simple dinners for the week and one combined shopping list.'),
    prompt: tk('Plan five simple weeknight dinners, taking into account any dietary preferences you know I have. For each one give the name, how long it takes and the main ingredients. Finish with a single shopping list grouped by section of the store.'),
    schedule: { kind: 'weekly', days: [0], hour: 10, minute: 0 }
  },
  {
    id: 'review', Icon: Compact, title: tk('Weekly review'),
    desc: tk('A Friday check-in on what went well, what slipped, and what comes next.'),
    prompt: tk('Run my weekly review. Ask me what went well this week, what slipped and why, and what I want to carry into next week, using anything you know about my goals to make the questions specific. Keep it to a few short questions, then wait for my answers.'),
    schedule: { kind: 'weekly', days: [5], hour: 16, minute: 0 }
  },
  {
    id: 'journal', Icon: Pencil, title: tk('Evening journal'),
    desc: tk('Three reflection prompts to close out the day.'),
    prompt: tk('Give me three short journaling prompts to close out today: one about something that happened, one about how I felt, and one about tomorrow. Use today\'s date to vary them, and keep the whole message under 100 words.'),
    schedule: { kind: 'daily', hour: 21, minute: 0 }
  }
];

const BLANK = { title: '', prompt: '', schedule: { kind: 'daily', hour: 9, minute: 0 }, enabled: true };

const fmtWhen = (ms) => fmtDateTime(ms, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function runLine(task) {
  const parts = [scheduleLabel(task.schedule)];
  if (!task.enabled) parts.push(t('Paused'));
  else if (task.nextRun) parts.push(t('Next {when}', { when: fmtWhen(task.nextRun) }));
  if (task.lastRun) parts.push(t('Last ran {when}', { when: fmtRelative(task.lastRun) }));
  return parts.join(' · ');
}

export default function ScheduledTasks({ onSearch, onRunTask, onOpenChat, models = [], webSearchAvailable = false }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('next');
  const [editing, setEditing] = useState(null);
  const showSkeleton = useSkeleton(loading);

  const load = useCallback(() => {
    api.get('/api/tasks')
      .then(r => setTasks(r.tasks || []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  function saved(task) {
    setEditing(null);
    load();
    notify(task.enabled && task.nextRun ? t('Task saved. Next run {when}.', { when: fmtWhen(task.nextRun) }) : t('Task saved.'), { kind: 'success' });
  }

  async function toggle(task) {
    try { await api.patch('/api/tasks/' + task.id, { enabled: !task.enabled }); load(); }
    catch { notify(t('Could not update the task.')); }
  }

  async function remove(task) {
    const ok = await askConfirm({
      title: t('Delete this task?'),
      message: t('“{title}” will stop running. Chats it already made are kept.', { title: task.title }),
      confirm: t('Delete'), danger: true
    });
    if (!ok) return;
    try { await api.del('/api/tasks/' + task.id); setEditing(null); load(); }
    catch { notify(t('Could not delete the task.')); }
  }

  const shown = [...tasks].sort((a, b) => (sort === 'next'
    ? (a.nextRun || Infinity) - (b.nextRun || Infinity)
    : b.created_at - a.created_at));

  return (
    <LibraryPage
      title={t('Scheduled tasks')}
      subtitle={t('Run tasks on a schedule or whenever you need them.')}
      onSearch={onSearch}
      actions={<>
        <button className="lib-pill" onClick={() => setSort(s => (s === 'next' ? 'created' : 'next'))}>
          <span className="lib-pill-key">{t('Sort by')}</span>
          <span className="lib-pill-val">{sort === 'next' ? t('Next run') : t('Created')}</span>
          <ChevDown />
        </button>
        <button className="lib-primary" onClick={() => setEditing(BLANK)}><Plus />{t('New task')}</button>
      </>}>
      {loading ? (showSkeleton ? <LibraryListSkeleton /> : null) : shown.length === 0 ? (
        <LibraryEmpty icon={<Clock />} line={t('No scheduled tasks yet. Create one or start from an example below.')} />
      ) : (
        <div className="sched-list">
          {shown.map(task => (
            <div key={task.id} className={'sched-item' + (task.enabled ? '' : ' off')}>
              <button type="button" className="sched-item-main" onClick={() => setEditing(task)}>
                <span className="sched-card-ic"><Clock /></span>
                <span className="sched-card-body">
                  <span className="sched-card-title">{task.title}</span>
                  <span className="sched-card-desc">{task.prompt}</span>
                  <span className="sched-card-when"><Clock /> {runLine(task)}</span>
                  {task.lastError && (
                    <span className="sched-card-error">{t('The last scheduled run did not start: {reason}', { reason: t(task.lastError) })}</span>
                  )}
                </span>
              </button>
              <span className="sched-item-acts">
                {onOpenChat && task.lastChatId && (
                  <button className="lib-icon-btn" onClick={() => onOpenChat(task.lastChatId)}
                    aria-label={t('Open last result')} data-tip={t('Open last result')}><ArrowOut /></button>
                )}
                {onRunTask && (
                  <button className="lib-icon-btn" onClick={() => onRunTask(task)}
                    aria-label={t('Run now')} data-tip={t('Run now')}><Send /></button>
                )}
                <Switch on={task.enabled} onToggle={() => toggle(task)} label={t('Active')}
                  title={task.enabled ? t('Pause') : t('Resume')} />
                <button className="lib-icon-btn danger" onClick={() => remove(task)}
                  aria-label={t('Delete')} data-tip={t('Delete')}><Trash /></button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="sched-rule" role="presentation" />
      <div className="sched-grid">
        {STARTERS.map(s => (
          <button key={s.id} type="button" className="sched-card"
            onClick={() => setEditing({ ...BLANK, title: t(s.title), prompt: t(s.prompt), schedule: s.schedule })}>
            <span className="sched-card-ic"><s.Icon /></span>
            <span className="sched-card-body">
              <span className="sched-card-title">{t(s.title)}</span>
              <span className="sched-card-desc">{t(s.desc)}</span>
              <span className="sched-card-when"><Clock /> {scheduleLabel(s.schedule)}</span>
            </span>
          </button>
        ))}
      </div>
      {editing && (
        <TaskEditor task={editing} models={models} webSearchAvailable={webSearchAvailable}
          onClose={() => setEditing(null)} onSaved={saved} onDelete={remove} />
      )}
    </LibraryPage>
  );
}