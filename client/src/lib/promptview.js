import { parsePrompt, blockText } from './promptblocks.js';

const isKnown = (id) => blockText(id) !== '';

export function promptSegments(text, { eligible = null, caret = null } = {}) {
  const src = String(text ?? '');
  const marks = [];
  for (const w of parsePrompt(src).wrappers) {
    marks.push({ start: w.start, end: w.innerStart, tone: 'dim' });
    for (const it of w.items) {
      if (!isKnown(it.id)) continue;
      const editing = caret != null && caret > it.start && caret < it.end;
      if (editing) continue;
      marks.push({ start: it.start, end: it.end, tone: eligible && !eligible.has(it.id) ? 'stale' : 'dim' });
    }
    marks.push({ start: w.innerEnd, end: w.end, tone: 'dim' });
  }
  marks.sort((a, b) => a.start - b.start);
  const out = [];
  let at = 0;
  for (const m of marks) {
    if (m.start > at) out.push({ text: src.slice(at, m.start), tone: '' });
    if (m.end > m.start) out.push({ text: src.slice(m.start, m.end), tone: m.tone });
    at = Math.max(at, m.end);
  }
  if (at < src.length) out.push({ text: src.slice(at), tone: '' });
  return out;
}
