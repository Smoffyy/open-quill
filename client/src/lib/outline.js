const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

function stripInline(s) {
  return s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]{1,3}(?=\S)([\s\S]*?\S)[*_~]{1,3}/g, '$1')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

export function extractHeadings(md) {
  if (typeof md !== 'string' || md.indexOf('#') === -1) return [];
  const out = [];
  let fence = null;
  let li = 0;
  for (const line of md.split('\n')) {
    const f = FENCE.exec(line);
    if (f) {
      const mark = f[1][0];
      if (!fence) fence = mark;
      else if (line.trim()[0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const h = HEADING.exec(line);
    if (!h) continue;
    const text = stripInline(h[2]);
    if (text) out.push({ level: h[1].length, text, li: li++ });
  }
  return out;
}

export function buildOutline(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages) {
    if (!m || m.role !== 'assistant' || typeof m.content !== 'string') continue;
    for (const h of extractHeadings(m.content)) out.push({ mid: m.id, li: h.li, level: h.level, text: h.text });
  }
  return out;
}
