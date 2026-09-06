import { useEffect, useRef } from 'react';

// "Close when the pointer goes down outside me, or Escape is pressed" was written
// out by hand in a dozen components. They only ever differed in which elements
// count as inside, so that is the parameter; the rest (which events, the pairing
// of add and remove, the null-ref guard) is fixed here.

// Exported for the tests: elements are only touched through `contains`/`closest`,
// so this is testable without a DOM.
export function isInside(target, refs, selector) {
  if (!target) return false;
  if (selector && typeof target.closest === 'function' && target.closest(selector)) return true;
  for (const r of refs) {
    const el = r && r.current;
    if (el && typeof el.contains === 'function' && el.contains(target)) return true;
  }
  return false;
}

// A menu whose ref has not attached yet has nothing to compare a click against.
// Every hand-written copy guarded on `ref.current &&` for that reason: without it
// the first mousedown after opening closes the menu again.
export function anyMounted(refs) {
  for (const r of refs) if (r && r.current) return true;
  return false;
}

export function asRefList(refs) {
  return Array.isArray(refs) ? refs : [refs];
}

/**
 * @param enabled    whether the surface is open; nothing is bound while false
 * @param onDismiss  called on an outside pointer-down or Escape
 * @param refs       one ref, or an array of refs, that count as "inside"
 * @param opts.escape  bind Escape as well (default true)
 * @param opts.inside  extra CSS selector whose matches count as inside, for a
 *                     panel that portals out of the ref tree
 */
export function useDismiss(enabled, onDismiss, refs, opts = {}) {
  const escape = opts.escape !== false;
  const selector = opts.inside || '';
  // Call sites pass an inline arrow, so the callback and the ref list are read
  // through refs: the listeners bind once per open instead of on every render.
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  const list = useRef(refs);
  list.current = refs;

  useEffect(() => {
    if (!enabled) return undefined;
    const away = (e) => {
      const all = asRefList(list.current);
      if (!anyMounted(all)) return;
      if (!isInside(e.target, all, selector)) cb.current();
    };
    const esc = (e) => { if (e.key === 'Escape') cb.current(); };
    document.addEventListener('mousedown', away);
    if (escape) document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      if (escape) document.removeEventListener('keydown', esc);
    };
  }, [enabled, escape, selector]);
}
