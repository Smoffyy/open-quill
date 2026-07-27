export function baseName(name) {
  const s = String(name == null ? '' : name);
  const cut = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return cut === -1 ? s : s.slice(cut + 1);
}

export function extOf(name) {
  const b = baseName(name);
  const i = b.lastIndexOf('.');
  const ext = i > 0 ? b.slice(i + 1) : '';
  return /^[a-z0-9]{1,6}$/i.test(ext) ? ext.toLowerCase() : '';
}

export function extLabel(name, fallback = 'file') {
  return (extOf(name) || fallback).toUpperCase();
}
