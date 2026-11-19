const DAY = 86400000;

export function dailyRates(rows, since, days, now = Date.now()) {
  const first = Math.floor(Math.max(since, now - days * DAY) / DAY);
  const last = Math.floor(now / DAY);
  const byDay = new Map();
  for (let d = first; d <= last; d++) byDay.set(d, { day: d, pass: 0, fail: 0 });
  for (const r of rows || []) {
    const slot = byDay.get(r.day);
    if (slot && (r.verdict === 'pass' || r.verdict === 'fail')) slot[r.verdict] += r.n;
  }
  return [...byDay.values()];
}

export function criterionRates(tally, criteria) {
  const out = new Map(criteria.map(c => [c.id, { id: c.id, name: c.name, pass: 0, fail: 0, na: 0 }]));
  for (const r of tally || []) {
    const slot = out.get(r.criterion);
    if (slot && r.verdict in slot) slot[r.verdict] += r.n;
  }
  return [...out.values()];
}