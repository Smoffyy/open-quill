import { useState, useEffect, useCallback } from 'react';
import LibraryPage, { LibraryEmpty } from './LibraryPage.jsx';
import { ChevDown, Clock, Sun, Chat, Compact, Bulb, Telescope, Trash, Check } from './icons.jsx';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { t, tk } from '../i18n.jsx';

const STARTERS = [
  { id: 'briefing', Icon: Sun, title: tk('Daily briefing'), desc: tk('What needs your attention today across calendar, email, and messages.'), when: tk('Weekdays at 8:00 AM'), schedule: { kind: 'weekdays', hour: 8, minute: 0 } },
  { id: 'triage', Icon: Chat, title: tk('Inbox triage'), desc: tk('Categorize your inbox and draft replies to anything urgent.'), when: tk('Weekdays at 8:00 AM'), schedule: { kind: 'weekdays', hour: 8, minute: 0 } },
  { id: 'meeting', Icon: Clock, title: tk('Meeting prep'), desc: tk('A short brief before each meeting on your calendar, covering attendees, context, and agenda.'), when: tk('Weekdays at 8:00 AM'), schedule: { kind: 'weekdays', hour: 8, minute: 0 } },
  { id: 'review', Icon: Compact, title: tk('Weekly review'), desc: tk('A Friday summary of what happened this week.'), when: tk('Every Friday at 4:00 PM'), schedule: { kind: 'weekly', weekday: 5, hour: 16, minute: 0 } },
  { id: 'ideas', Icon: Bulb, title: tk('Content ideas'), desc: tk('Draft a few post ideas each week from the latest news in your industry.'), when: tk('Every Monday at 9:00 AM'), schedule: { kind: 'weekly', weekday: 1, hour: 9, minute: 0 } },
  { id: 'monitor', Icon: Telescope, title: tk('Monitor a topic'), desc: tk('Watch for news or mentions of a topic, competitor, or keyword.'), when: tk('Every day at 9:00 AM'), schedule: { kind: 'daily', hour: 9, minute: 0 } }
];

const fmtNext = (ms) => {
  if (!ms) return t('Paused');
  const d = new Date(ms);
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

export default function ScheduledTasks({ onSearch, onRunTask }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('next');

  const load = useCallback(() => {
    api.get('/api/tasks')
      .then(r => setTasks(r.tasks || []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function create(starter) {
    try {
      await api.post('/api/tasks', {
        title: t(starter.title), prompt: t(starter.desc), schedule: starter.schedule
      });
      load();
    } catch { toast(t('Could not create the task.')); }
  }

  async function toggle(task) {
    try { await api.patch('/api/tasks/' + task.id, { enabled: !task.enabled }); load(); }
    catch { toast(t('Could not update the task.')); }
  }

  async function remove(task) {
    try { await api.del('/api/tasks/' + task.id); load(); }
    catch { toast(t('Could not delete the task.')); }
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
        <button className="lib-primary" onClick={() => create(STARTERS[0])}>{t('New task')} <ChevDown /></button>
      </>}>
      {loading ? null : shown.length === 0 ? (
        <LibraryEmpty icon={<Clock />} line={t('No scheduled tasks yet.')} />
      ) : (
        <div className="sched-list">
          {shown.map(task => (
            <div key={task.id} className={'sched-item' + (task.enabled ? '' : ' off')}>
              <span className="sched-card-ic"><Clock /></span>
              <span className="sched-card-body">
                <span className="sched-card-title">{task.title}</span>
                <span className="sched-card-desc">{task.prompt}</span>
                <span className="sched-card-when">
                  <Clock /> {task.scheduleLabel}
                  {task.enabled && task.nextRun ? ' · ' + t('Next') + ' ' + fmtNext(task.nextRun) : ''}
                </span>
              </span>
              <span className="sched-item-acts">
                {onRunTask && (
                  <button className="lib-icon-btn" onClick={() => onRunTask(task)}
                    aria-label={t('Run now')} title={t('Run now')}><Check /></button>
                )}
                <button className="lib-icon-btn" onClick={() => toggle(task)}
                  aria-label={task.enabled ? t('Pause') : t('Resume')} title={task.enabled ? t('Pause') : t('Resume')}>
                  <Clock />
                </button>
                <button className="lib-icon-btn danger" onClick={() => remove(task)}
                  aria-label={t('Delete')} title={t('Delete')}><Trash /></button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="sched-rule" role="presentation" />
      <div className="sched-grid">
        {STARTERS.map(s => (
          <button key={s.id} type="button" className="sched-card" onClick={() => create(s)}>
            <span className="sched-card-ic"><s.Icon /></span>
            <span className="sched-card-body">
              <span className="sched-card-title">{t(s.title)}</span>
              <span className="sched-card-desc">{t(s.desc)}</span>
              <span className="sched-card-when"><Clock /> {t(s.when)}</span>
            </span>
          </button>
        ))}
      </div>
    </LibraryPage>
  );
}
