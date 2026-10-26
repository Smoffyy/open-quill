import { useState, useRef, useEffect } from 'react';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';
import { SetRow, SwitchRow, SelectRow } from '../ui/controls.jsx';
import { api } from '../../lib/api.js';
import { notify } from '../../lib/notify.js';
import { focusUnlessTouch } from '../../lib/touch.js';
import { scheduleForm, formSchedule, scheduleProblem, unitFor, UNITS, MAX_MINUTES } from '../../lib/schedule.js';
import { t, tk, fmtDate, fmtDateTime } from '../../i18n.jsx';

const KINDS = [
  { v: 'daily', label: tk('Every day') },
  { v: 'weekdays', label: tk('Weekdays') },
  { v: 'weekly', label: tk('On chosen days') },
  { v: 'interval', label: tk('Every few minutes or hours') },
  { v: 'once', label: tk('Once') }
];

const UNIT_OPTIONS = [
  { v: 'minutes', label: tk('Minutes') },
  { v: 'hours', label: tk('Hours') },
  { v: 'days', label: tk('Days') }
];

const PROBLEMS = {
  prompt: tk('Write what the task should do each time it runs.'),
  past: tk('Pick a date and time in the future.'),
  short: tk('The shortest interval is 5 minutes.'),
  long: tk('The longest interval is 7 days.'),
  days: tk('Pick at least one day.'),
  time: tk('Pick a time of day.')
};

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const AT_TIME = new Set(['daily', 'weekdays', 'weekly']);

const dayName = (day, weekday = 'short') => fmtDate(new Date(2024, 0, 7 + day), { weekday });
const timeOf = (hour, minute) => fmtDateTime(new Date(2000, 0, 1, hour, minute), { hour: 'numeric', minute: '2-digit' });

function intervalLabel(minutes) {
  const unit = unitFor(minutes);
  const n = minutes / UNITS[unit];
  if (unit === 'days') return n === 1 ? t('Every 24 hours') : t('Every {n} days', { n });
  if (unit === 'hours') return n === 1 ? t('Every hour') : t('Every {n} hours', { n });
  return t('Every {n} minutes', { n });
}

export function scheduleLabel(s) {
  const time = timeOf(s.hour, s.minute);
  if (s.kind === 'once') {
    if (!s.at) return t('Once');
    return t('Once on {when}', { when: fmtDateTime(s.at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) });
  }
  if (s.kind === 'interval') return intervalLabel(s.everyMinutes);
  if (s.kind === 'weekdays') return t('Weekdays at {time}', { time });
  if (s.kind === 'weekly' && s.days.length < 7) {
    return t('{days} at {time}', { days: WEEK.filter(d => s.days.includes(d)).map(d => dayName(d)).join(', '), time });
  }
  return t('Every day at {time}', { time });
}

export default function TaskEditor({ task, models, webSearchAvailable, onClose, onSaved, onDelete }) {
  const editing = !!task.id;
  const [title, setTitle] = useState(task.title || '');
  const [prompt, setPrompt] = useState(task.prompt || '');
  const [form, setForm] = useState(() => scheduleForm(task.schedule));
  const [modelId, setModelId] = useState(task.modelId || '');
  const [webSearch, setWebSearch] = useState(!!task.webSearch);
  const [reuseChat, setReuseChat] = useState(!!task.reuseChat);
  const [enabled, setEnabled] = useState(task.enabled !== false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);
  useEffect(() => { focusUnlessTouch(nameRef.current); }, []);

  const edit = (patch) => { setForm(f => ({ ...f, ...patch })); setProblem(''); };
  const toggleDay = (day) => edit({ days: form.days.includes(day) ? form.days.filter(d => d !== day) : [...form.days, day] });

  const fallback = models.find(m => m.isDefault) || models[0];
  const chosen = models.find(m => m.id === modelId) || fallback;
  const canSearch = webSearchAvailable && chosen?.webSearchAllowed !== false;
  const modelOptions = [
    { v: '', label: fallback ? t('Default ({name})', { name: fallback.displayName }) : t('Default model') },
    ...models.map(m => ({ v: m.id, label: m.displayName }))
  ];
  const invalid = (...keys) => (keys.includes(problem) ? { 'aria-invalid': true, 'aria-describedby': 'task-ed-error' } : {});

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const found = prompt.trim() ? scheduleProblem(form) : 'prompt';
    if (found) { setProblem(found); return; }
    setBusy(true);
    const body = { title: title.trim() || t('New task'), prompt: prompt.trim(), modelId, schedule: formSchedule(form), webSearch, reuseChat, enabled };
    try {
      onSaved(editing ? await api.patch('/api/tasks/' + task.id, body) : await api.post('/api/tasks', body));
    } catch (err) {
      setBusy(false);
      notify(err?.message || t('Could not save the task.'), { kind: 'warn' });
    }
  }

  return (
    <Dialog className="pj-create task-ed" labelledBy="task-ed-title" onClose={onClose} initialFocus={nameRef}>
      <form onSubmit={submit}>
        <div className="pj-create-head">
          <h2 id="task-ed-title">{editing ? t('Edit task') : t('New task')}</h2>
          <CloseButton plain className="pj-x" onClick={onClose} />
        </div>

        <label className="pj-field">
          <span>{t('Name')}</span>
          <input ref={nameRef} value={title} maxLength={160} placeholder={t('Morning plan')}
            onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="pj-field">
          <span>{t('Instructions')}</span>
          <textarea value={prompt} rows={5} maxLength={8000} {...invalid('prompt')}
            placeholder={t('What should the assistant do each time this runs? It is sent as your message, so write it the way you would ask in a chat.')}
            onChange={(e) => { setPrompt(e.target.value); setProblem(''); }} />
        </label>

        <h3 className="task-ed-sec">{t('Schedule')}</h3>
        <SetRow label={t('Repeat')}>
          <SelectRow value={form.kind} label={t('Repeat')} onPick={(kind) => edit({ kind })}
            options={KINDS.map(k => ({ v: k.v, label: t(k.label) }))} />
        </SetRow>
        {form.kind === 'weekly' && (
          <div className="task-ed-days" role="group" aria-label={t('Days')} {...invalid('days')}>
            {WEEK.map(day => (
              <button key={day} type="button" className={'task-ed-day' + (form.days.includes(day) ? ' on' : '')}
                aria-pressed={form.days.includes(day)} aria-label={dayName(day, 'long')} onClick={() => toggleDay(day)}>
                {dayName(day)}
              </button>
            ))}
          </div>
        )}
        {AT_TIME.has(form.kind) && (
          <SetRow label={t('Time')}>
            <input type="time" className="task-ed-input" value={form.time} aria-label={t('Time')} {...invalid('time')}
              onChange={(e) => edit({ time: e.target.value })} />
          </SetRow>
        )}
        {form.kind === 'interval' && (
          <SetRow label={t('Every')} desc={t('Counted from the last run.')}>
            <span className="task-ed-every">
              <input type="number" className="task-ed-input num" inputMode="numeric" value={form.every} aria-label={t('Every')}
                min={1} max={Math.floor(MAX_MINUTES / UNITS[form.unit])} step={1} {...invalid('short', 'long')}
                onChange={(e) => edit({ every: e.target.value })} />
              <SelectRow value={form.unit} label={t('Unit')} onPick={(unit) => edit({ unit })}
                options={UNIT_OPTIONS.map(u => ({ v: u.v, label: t(u.label) }))} />
            </span>
          </SetRow>
        )}
        {form.kind === 'once' && (
          <SetRow label={t('Date and time')}>
            <input type="datetime-local" className="task-ed-input" value={form.at} aria-label={t('Date and time')} {...invalid('past')}
              onChange={(e) => edit({ at: e.target.value })} />
          </SetRow>
        )}

        <h3 className="task-ed-sec">{t('How it runs')}</h3>
        <SetRow label={t('Model')}>
          <SelectRow value={modelId} label={t('Model')} onPick={setModelId} options={modelOptions} />
        </SetRow>
        {canSearch && (
          <SwitchRow label={t('Search the web')} on={webSearch} onToggle={() => setWebSearch(v => !v)}
            desc={t('Lets each run look things up online. Off, the task only uses what is on this server.')} />
        )}
        <SwitchRow label={t('Keep runs in one chat')} on={reuseChat} onToggle={() => setReuseChat(v => !v)}
          desc={t('Each run continues the same chat, so the assistant can see what it said last time. Off, every run starts a new chat.')} />
        <SwitchRow label={t('Active')} on={enabled} onToggle={() => setEnabled(v => !v)}
          desc={t('A paused task keeps its settings and only runs when you choose Run now.')} />

        <p id="task-ed-error" className="task-ed-error" role="alert">{problem ? t(PROBLEMS[problem]) : ''}</p>
        <div className="pj-create-actions">
          {editing && (
            <button type="button" className="pj-btn ghost task-ed-delete" onClick={() => onDelete(task)}>{t('Delete')}</button>
          )}
          <button type="button" className="pj-btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="pj-btn solid" disabled={busy}>
            {busy && <span className="btn-spin" aria-hidden="true" />}{editing ? t('Save') : t('Create task')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}