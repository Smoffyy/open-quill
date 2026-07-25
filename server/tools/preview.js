function unescapePartial(s) {
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

function extractPartial(text) {
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
      break;
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

const PREVIEW_TOOLS = new Set(['create_file', 'str_replace']);

export function livePreview(name, argsText) {
  const tool = String(name || '').trim();
  if (!tool) return null;
  const p = extractPartial(String(argsText || ''));
  const get = (k) => (p[k] ? p[k].value : undefined);
  if (!PREVIEW_TOOLS.has(tool)) {
    const live = { tool };
    const path = get('path'); if (p.path && p.path.closed && path) live.path = String(path).slice(0, 300);
    const query = get('query'); if (p.query && p.query.closed && query) live.query = String(query).slice(0, 300);
    const cmd = get('cmd'); if (cmd != null) live.cmd = String(cmd).slice(0, 300);
    const nm = get('name'); if (p.name && p.name.closed && nm) live.name = String(nm).slice(0, 120);
    return live;
  }
  const path = get('path');
  if (!p.path || !p.path.closed || !path) return { tool };
  if (tool === 'create_file') return { tool, path: String(path), content: String(get('content') ?? ''), oldStr: null };
  return { tool, path: String(path), content: String(get('new_str') ?? ''), oldStr: p.old_str && p.old_str.closed ? String(get('old_str')) : null };
}
