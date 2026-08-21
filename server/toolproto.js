const KV_MAP = { command: 'cmd', to: 'new_path', newpath: 'new_path', destination: 'dest', q: 'query', search: 'query', input: 'query' };
const SECTION_FIELD = { CONTENT: 'content', OLD: 'old_str', NEW: 'new_str', CMD: 'cmd', PATHS: 'paths' };
const INT_KEYS = new Set(['start', 'end', 'count']);


function deco(s) { return /[|<>/[\]]/.test(s); }
function isClose(t) { const s = t.trim(); return /^[<[(|\s]*\/\s*\|?\s*tool\s*[|>\])/\s]*$/i.test(s); }
function isOpen(t) { const s = t.trim(); if (isClose(s)) return false; return /^[<[(|]\s*[|]?\s*tool\b/i.test(s); }
function sectionOf(t) { const s = t.trim(); if (!deco(s)) return null; const m = s.match(/^[<[(|/\s]*?(content|old|new|cmd|paths)[|>\])/\s]*$/i); return m ? m[1].toUpperCase() : null; }

function applyKv(call, key, val) {
  let k = key.toLowerCase();
  k = KV_MAP[k] || k;
  const v = val.trim().replace(/^["']|["']$/g, '');
  if (INT_KEYS.has(k)) { const n = parseInt(v, 10); if (!isNaN(n)) call[k] = n; return; }
  call[k] = v;
}

function finalizeBody(call, field, lines) {
  const body = lines.map(l => l.replace(/\r$/, '')).join('\n');
  if (field === 'paths') { const arr = body.split('\n').map(s => s.trim()).filter(Boolean); if (arr.length || call.paths == null) call.paths = arr; }
  else if (body.length || call[field] == null) call[field] = body;
}

function enough(call) {
  if (!call || !call.tool) return false;
  switch (call.tool) {
    case 'create_file': case 'write_file': return call.path != null && call.content != null;
    case 'str_replace': case 'edit_file': return call.path != null && call.old_str != null && call.new_str != null;
    case 'insert_lines': return call.path != null && call.content != null;
    case 'bash': case 'run': case 'shell': return (call.cmd ?? call.command) != null;
    case 'view': case 'read_file': case 'cat': case 'delete_file': case 'rm': case 'make_dir': case 'mkdir': case 'extract_zip': case 'unzip': return call.path != null;
    case 'rename_file': case 'move_file': case 'mv': case 'copy_file': case 'cp': return call.path != null && (call.new_path ?? call.to) != null;
    case 'find': case 'glob': return (call.pattern ?? call.query ?? call.path) != null;
    case 'search': case 'grep': case 'web_search': return (call.query ?? call.pattern) != null;
    case 'mb_view': return call.path != null;
    case 'mb_search': return call.query != null;
    case 'bundle_zip': case 'zip': return call.name != null;
    case 'list_files': case 'ls': case 'tree': case 'clear_sandbox': case 'delete_all': case 'reset': return true;
    default: return true;
  }
}

export function scanTools(text, opts) {
  const eofCloses = !!(opts && opts.eofCloses);
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
    const name = t.replace(/^[<[(|]*\s*[|]?\s*tool\s*[|]?\s*/i, '').trim().toLowerCase().replace(/[^a-z_]/g, '');
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
      continue;
    }
    if (j < lines.length) {
      if (eofCloses && enough(call)) calls.push({ call, start, end: offsets[j] });
      i = j;
      continue;
    }
    if (field) finalizeBody(call, field, body);
    if (eofCloses && enough(call)) { calls.push({ call, start, end: src.length }); break; }
    const cur = field ? body.map(l => l.replace(/\r$/, '')).join('\n') : '';
    if ((call.tool === 'create_file' || call.tool === 'str_replace') && call.path) {
      const showing = (field === 'content' || field === 'new_str') ? cur : '';
      live = { tool: call.tool, path: call.path, content: showing, oldStr: call.old_str ?? null, field, start };
    } else if (call.tool) {
      live = { tool: call.tool, path: call.path || null, content: '', oldStr: null, field, start };
    }
    break;
  }
  return { calls, live };
}

