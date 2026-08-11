export const TOUCH_MQ = '(hover: none) and (pointer: coarse)';

export function isTouch() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia(TOUCH_MQ).matches || window.matchMedia('(max-width: 768px)').matches; } catch { return false; }
}

export function focusUnlessTouch(el) {
  if (!el || isTouch()) return false;
  el.focus();
  return true;
}
