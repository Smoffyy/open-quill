let id = 0;
const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function toast(message, opts = {}) {
  const t = { id: ++id, message, icon: opts.icon || null, kind: opts.kind || 'info', duration: opts.duration || 2600 };
  subs.forEach(fn => fn(t));
  return t.id;
}
