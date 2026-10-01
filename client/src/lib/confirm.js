let current = null;
const subs = new Set();

const emit = () => subs.forEach(fn => { try { fn(current); } catch {} });

export function subscribe(fn) {
  subs.add(fn);
  fn(current);
  return () => subs.delete(fn);
}

export function askConfirm(spec) {
  return new Promise((resolve) => {
    if (current) current.resolve(false);
    current = { ...spec, resolve };
    emit();
  });
}

export function settleConfirm(ok) {
  if (!current) return;
  const { resolve } = current;
  current = null;
  emit();
  resolve(!!ok);
}
