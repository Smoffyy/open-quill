const MIN = 60 * 1000;

export const KINDS = new Set(['once', 'interval', 'daily', 'weekdays', 'weekly']);

const clampInt = (v, lo, hi, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

function weekDays(src) {
  const picked = Array.isArray(src.days) ? src.days.slice(0, 7) : [src.weekday];
  const days = [...new Set(picked.map(d => clampInt(d, 0, 6, -1)).filter(d => d >= 0))];
  return days.length ? days.sort((a, b) => a - b) : [1];
}

export function normalizeSchedule(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const kind = KINDS.has(src.kind) ? src.kind : 'daily';
  const s = { kind, hour: clampInt(src.hour, 0, 23, 9), minute: clampInt(src.minute, 0, 59, 0) };
  if (kind === 'weekly') s.days = weekDays(src);
  if (kind === 'interval') s.everyMinutes = clampInt(src.everyMinutes, 5, 60 * 24 * 7, 60);
  if (kind === 'once') s.at = clampInt(src.at, 0, Number.MAX_SAFE_INTEGER, 0);
  return s;
}

export function nextRun(schedule, from) {
  const s = normalizeSchedule(schedule);
  const now = Number.isFinite(from) ? from : Date.now();
  if (s.kind === 'once') return s.at > now ? s.at : 0;
  if (s.kind === 'interval') return now + s.everyMinutes * MIN;

  const d = new Date(now);
  d.setHours(s.hour, s.minute, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);

  for (let i = 0; s.kind !== 'daily' && i < 7; i++) {
    const day = d.getDay();
    if (s.kind === 'weekdays' ? day >= 1 && day <= 5 : s.days.includes(day)) break;
    d.setDate(d.getDate() + 1);
  }
  d.setHours(s.hour, s.minute, 0, 0);
  return d.getTime();
}

export function isDue(task, at) {
  const now = Number.isFinite(at) ? at : Date.now();
  return !!task && task.enabled !== 0 && task.next_run > 0 && task.next_run <= now;
}