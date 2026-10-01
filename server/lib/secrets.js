export const HINT_MIN = 12;

export function keyHint(value) {
  const s = String(value || '');
  return s.length >= HINT_MIN ? '…' + s.slice(-4) : '';
}

export function lineNames(text, sep) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf(sep);
    if (i > 0) out.push(s.slice(0, i).trim());
  }
  return [...new Set(out)];
}