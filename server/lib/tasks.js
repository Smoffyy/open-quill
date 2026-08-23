const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const KINDS = new Set(['once', 'interval', 'daily', 'weekdays', 'weekly']);

const clampInt = (v, lo, hi, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

export function normalizeSchedule(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const kind = KINDS.has(src.kind) ? src.kind : 'daily';
  const s = { kind, hour: clampInt(src.hour, 0, 23, 9), minute: clampInt(src.minute, 0, 59, 0) };
  if (kind === 'weekly') s.weekday = clampInt(src.weekday, 0, 6, 1);
  if (kind === 'interval') s.everyMinutes = clampInt(src.everyMinutes, 5, 60 * 24 * 7, 60);
  if (kind === 'once') s.at = clampInt(src.at, 0, Number.MAX_SAFE_INTEGER, 0);
  return s;
}

function atLocal(base, hour, minute) {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

export function nextRun(schedule, from) {
  const s = normalizeSchedule(schedule);
  const now = Number.isFinite(from) ? from : Date.now();
  if (s.kind === 'once') return s.at > now ? s.at : 0;
  if (s.kind === 'interval') return now + s.everyMinutes * MIN;

  let t = atLocal(now, s.hour, s.minute);
  if (t <= now) t += DAY;
  if (s.kind === 'daily') return t;

  for (let i = 0; i < 14; i++) {
    const day = new Date(t).getDay();
    const ok = s.kind === 'weekdays' ? day >= 1 && day <= 5 : day === s.weekday;
    if (ok) return t;
    t += DAY;
  }
  return t;
}

export function describe(schedule, fmt) {
  const s = normalizeSchedule(schedule);
  const time = fmt ? fmt(s.hour, s.minute) : String(s.hour).padStart(2, '0') + ':' + String(s.minute).padStart(2, '0');
  if (s.kind === 'once') return s.at ? 'Once' : 'Not scheduled';
  if (s.kind === 'interval') {
    const h = s.everyMinutes / 60;
    return h >= 1 && Number.isInteger(h) ? 'Every ' + h + 'h' : 'Every ' + s.everyMinutes + 'm';
  }
  if (s.kind === 'daily') return 'Every day at ' + time;
  if (s.kind === 'weekdays') return 'Weekdays at ' + time;
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return 'Every ' + names[s.weekday] + ' at ' + time;
}

export function isDue(task, at) {
  const now = Number.isFinite(at) ? at : Date.now();
  return !!task && task.enabled !== 0 && task.next_run > 0 && task.next_run <= now;
}
