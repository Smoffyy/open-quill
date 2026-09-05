export const FIT_MIN = 0.6;
export const FIT_PASSES = 3;

export function nextFitSize(size, available, natural, floor) {
  const s = Number(size), a = Number(available), n = Number(natural);
  if (!(s > 0) || !(a > 0) || !(n > a)) return null;
  const f = Number(floor) > 0 ? Number(floor) : 0;
  const next = Math.max(f, s * (a / n));
  return next < s ? Math.round(next * 100) / 100 : null;
}
