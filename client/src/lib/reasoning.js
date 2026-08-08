export const SENTENCE_RE = /(?:[^.!?]|[.!?](?!\s|$))+[.!?]+(?=\s|$)/g;
export const LINE_MAX = 150;
export const LINE_HOLD_MS = 3000;

export function parseSteps(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];
  return raw.split(/\n{2,}/)
    .map(block => block.split('\n').map(l => l.trim()).filter(Boolean))
    .filter(lines => lines.length);
}

export function lastSentence(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const found = raw.match(SENTENCE_RE);
  if (!found) return '';
  for (let i = found.length - 1; i >= 0; i--) {
    const s = found[i].trim();
    if (s.length > 3) return s.length > LINE_MAX ? s.slice(0, LINE_MAX).trimEnd() + '…' : s;
  }
  return '';
}

export function thoughtSeconds(ms) {
  if (!(ms > 0)) return 0;
  return Math.max(1, Math.round(ms / 1000));
}
