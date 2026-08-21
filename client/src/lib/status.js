export const STATUS_DELAY_DEFAULT = 3;
export const STATUS_DELAY_MAX = 10;

export function statusDelaySecs(v) {
  if (v === '' || v === null || v === undefined) return STATUS_DELAY_DEFAULT;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return STATUS_DELAY_DEFAULT;
  if (n < 0) return 0;
  if (n > STATUS_DELAY_MAX) return STATUS_DELAY_MAX;
  return n;
}

export function statusDelayMs(v) {
  return statusDelaySecs(v) * 1000;
}
