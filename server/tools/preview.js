import { extractPartial } from './partial.js';
import { resolveToolName } from './aliases.js';

const PREVIEW_TOOLS = new Set(['create_file', 'str_replace']);

export function livePreview(name, argsText) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const tool = resolveToolName(raw, false) || raw;
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
