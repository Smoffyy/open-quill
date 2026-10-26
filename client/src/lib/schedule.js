export const UNITS = { minutes: 1, hours: 60, days: 1440 };
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 7 * UNITS.days;

const pad = (n) => String(n).padStart(2, '0');

export function localInput(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function unitFor(minutes) {
  if (minutes % UNITS.days === 0) return 'days';
  if (minutes % UNITS.hours === 0) return 'hours';
  return 'minutes';
}

export function scheduleForm(schedule, now = Date.now()) {
  const s = schedule || {};
  const every = s.everyMinutes || 60;
  const unit = unitFor(every);
  const soon = new Date(now);
  soon.setHours(soon.getHours() + 1, 0, 0, 0);
  return {
    kind: s.kind || 'daily',
    time: pad(s.hour ?? 9) + ':' + pad(s.minute ?? 0),
    days: s.days?.length ? s.days : [1],
    every: String(every / UNITS[unit]),
    unit,
    at: localInput(s.at || soon.getTime())
  };
}

export function formSchedule(form) {
  const [hour, minute] = form.time.split(':').map(Number);
  if (form.kind === 'once') return { kind: 'once', at: new Date(form.at).getTime() || 0 };
  if (form.kind === 'interval') return { kind: 'interval', everyMinutes: Math.round(Number(form.every) * UNITS[form.unit]) };
  if (form.kind === 'weekly') return { kind: 'weekly', hour, minute, days: [...form.days].sort((a, b) => a - b) };
  return { kind: form.kind, hour, minute };
}

export function scheduleProblem(form, now = Date.now()) {
  if (form.kind === 'once' && !(new Date(form.at).getTime() > now)) return 'past';
  if (form.kind === 'interval') {
    const minutes = Number(form.every) * UNITS[form.unit];
    if (!(minutes >= MIN_MINUTES)) return 'short';
    if (minutes > MAX_MINUTES) return 'long';
  }
  if (form.kind === 'weekly' && !form.days.length) return 'days';
  if (form.kind !== 'once' && form.kind !== 'interval' && !/^\d{2}:\d{2}$/.test(form.time)) return 'time';
  return '';
}