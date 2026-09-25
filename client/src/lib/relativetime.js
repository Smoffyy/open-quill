const STEPS = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [7, 'day'],
  [4.345, 'week'],
  [12, 'month'],
  [Infinity, 'year']
];

export function relativeParts(value, now = Date.now()) {
  const at = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(at) || at <= 0) return null;
  let delta = (at - now) / 1000;
  if (Math.abs(delta) < 60) return { value: 0, unit: 'second' };
  for (const [size, unit] of STEPS) {
    const n = Math.round(delta);
    if (Math.abs(n) < size) return { value: n, unit };
    delta /= size;
  }
  return null;
}
