const KV_MAP = { command: 'cmd', to: 'new_path', newpath: 'new_path', destination: 'dest', q: 'query', search: 'query', input: 'query' };
const SECTION_FIELD = { CONTENT: 'content', OLD: 'old_str', NEW: 'new_str', CMD: 'cmd', PATHS: 'paths' };
const INT_KEYS = new Set(['start', 'end', 'count']);

export const READ_TOOLS = new Set(['view', 'list_files', 'search', 'bash', 'run', 'web_search']);
export const TOOL_NAMES = new Set(['web_search', 'bash', 'run', 'create_file', 'str_replace', 'view', 'list_files', 'delete_file', 'clear_sandbox', 'delete_all', 'rename_file', 'move_file', 'copy_file', 'make_dir', 'mkdir', 'search', 'extract_zip', 'bundle_zip']);

function isOpen(t) { return /^\|\s*tool\s*\|/i.test(t); }
function isClose(t) { return /^\|\s*\/\s*tool\s*\|/i.test(t); }
function sectionOf(t) { const m = t.match(/^\|\s*(content|old|new|cmd|paths)\s*\|\s*$/i); return m ? m[1].toUpperCase() : null; }
function isTerminator(t) { return isClose(t) || isOpen(t) || sectionOf(t) !== null; }

function applyKv(call, key, val) {
  let k = key.toLowerCase();
  k = KV_MAP[k] || k;
  let v = val.trim().replace(/^["']|["']$/g, '');
  if (INT_KEYS.has(k)) { const n = parseInt(v, 10); if (!isNaN(n)) call[k] = n; return; }
  call[k] = v;
}

function finalizeBody(call, field, lines) {
  const body = lines.map(l => l.replace(/\r$/, '')).join('\n');
  if (field === 'paths') call.paths = body.split('\n').map(s => s.trim()).filter(Boolean);
  else call[field] = body;
}

export function scanTools(text) {
  const src = String(text || '');
  const lines = src.split('\n');
  let off = 0;
  const offsets = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) { offsets[i] = off; off += lines[i].length + 1; }
  const calls = [];
  let live = null;
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!isOpen(t)) { i++; continue; }
    const start = offsets[i];
    const name = t.replace(/^\|\s*tool\s*\|/i, '').trim().toLowerCase().replace(/[^a-z_]/g, '');
    const call = { tool: name || null };
    let field = null, body = [], closed = false, endIdx = -1, j = i + 1;
    for (; j < lines.length; j++) {
      const raw = lines[j];
      const tj = raw.trim();
      if (isClose(tj)) { if (field) finalizeBody(call, field, body); closed = true; endIdx = offsets[j] + raw.length; break; }
      const sec = sectionOf(tj);
      if (sec) { if (field) finalizeBody(call, field, body); field = SECTION_FIELD[sec]; body = []; continue; }
      if (isOpen(tj)) { if (field) finalizeBody(call, field, body); break; }
      if (field) { body.push(raw); continue; }
      const kv = raw.match(/^\s*"?([a-zA-Z_]+)"?\s*[:=]\s*(.*)$/);
      if (kv) applyKv(call, kv[1], kv[2]);
    }
    if (closed) {
      calls.push({ call, start, end: endIdx });
      i = j + 1;
    } else {
      const cur = field ? body.map(l => l.replace(/\r$/, '')).join('\n') : '';
      if ((call.tool === 'create_file' || call.tool === 'str_replace') && call.path) {
        const showing = (field === 'content' || field === 'new_str') ? cur : '';
        live = { tool: call.tool, path: call.path, content: showing, oldStr: call.old_str ?? null, field, start };
      } else if (call.tool) {
        live = { tool: call.tool, path: call.path || null, content: '', oldStr: null, field, start };
      }
      break;
    }
  }
  return { calls, live };
}

export function parseToolCalls(text) { return scanTools(text).calls.map(c => c.call).filter(c => c && c.tool); }
export function parseLiveCall(text) { return scanTools(text).live; }
