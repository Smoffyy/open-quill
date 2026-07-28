export function unescapePartial(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[i + 1];
    if (n === undefined) break;
    if (n === 'n') { out += '\n'; i++; }
    else if (n === 't') { out += '\t'; i++; }
    else if (n === 'r') { out += '\r'; i++; }
    else if (n === '"') { out += '"'; i++; }
    else if (n === '\\') { out += '\\'; i++; }
    else if (n === '/') { out += '/'; i++; }
    else if (n === 'b') { out += '\b'; i++; }
    else if (n === 'f') { out += '\f'; i++; }
    else if (n === 'u') {
      const hex = s.slice(i + 2, i + 6);
      if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 5; }
      else break;
    } else { out += n; i++; }
  }
  return out;
}

export function extractPartial(text) {
  const out = {};
  const keyRe = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*/g;
  let m;
  while ((m = keyRe.exec(text))) {
    const key = m[1];
    let i = keyRe.lastIndex;
    const c = text[i];
    if (c === '"') {
      i++;
      let j = i, esc = false, closed = false;
      for (; j < text.length; j++) {
        const ch = text[j];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { closed = true; break; }
      }
      out[key] = { value: unescapePartial(text.slice(i, j)), closed };
      if (closed) keyRe.lastIndex = j + 1;
      else break;
    } else if (c === '{' || c === '[') {
      const end = matchBracket(text, i);
      if (end === -1) break;
      const raw = text.slice(i, end + 1);
      try { out[key] = { value: JSON.parse(raw), closed: true }; } catch { out[key] = { value: raw, closed: true }; }
      keyRe.lastIndex = end + 1;
    } else {
      const rest = text.slice(i);
      const vm = rest.match(/^(-?\d+(?:\.\d+)?|true|false|null)/);
      if (vm) {
        const raw = vm[1];
        out[key] = { value: raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : Number(raw), closed: true };
        keyRe.lastIndex = i + raw.length;
      } else break;
    }
  }
  return out;
}

export function matchBracket(text, start) {
  const open = text[start];
  if (open !== '{' && open !== '[') return -1;
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}
