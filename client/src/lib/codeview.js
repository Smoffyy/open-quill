import { b64decode } from './oqr.js';
import { transformTools } from './toolfences.js';

const FENCE = /```toolcall\n([A-Za-z0-9+/=]*)\n```/g;

const CANON = {
  __proto__: null,
  run: 'bash', shell: 'bash', write_file: 'create_file', edit_file: 'str_replace', read_file: 'view', cat: 'view',
  ls: 'list_files', tree: 'list_files', glob: 'find', grep: 'search', mv: 'move_file', rename_file: 'move_file',
  cp: 'copy_file', rm: 'delete_file', mkdir: 'make_dir', unzip: 'extract_zip', zip: 'bundle_zip',
  reset: 'clear_sandbox', delete_all: 'clear_sandbox'
};

export function canonTool(tool) {
  return CANON[tool] || tool;
}

const KIND = {
  __proto__: null,
  bash: 'command', create_file: 'create', make_dir: 'create', str_replace: 'edit', insert_lines: 'edit',
  view: 'read', list_files: 'search', find: 'search', search: 'search', delete_file: 'delete', clear_sandbox: 'delete',
  move_file: 'move', copy_file: 'move', extract_zip: 'zip', bundle_zip: 'zip', web_search: 'web', todo: 'todo', ask_user: 'ask'
};

export const KIND_ORDER = ['command', 'create', 'edit', 'read', 'search', 'delete', 'move', 'zip', 'web', 'todo', 'ask', 'tool'];

export function kindOf(tool) {
  return KIND[canonTool(tool)] || 'tool';
}

export function splitTurn(content) {
  const text = transformTools(String(content || ''));
  const parts = [];
  let last = 0;
  const pushText = (s) => { if (s.trim()) parts.push({ kind: 'text', text: s }); };
  for (const m of text.matchAll(FENCE)) {
    pushText(text.slice(last, m.index));
    last = m.index + m[0].length;
    let data = null;
    try { data = JSON.parse(b64decode(m[1])); } catch {}
    if (!data || !data.call || !data.call.tool) continue;
    const item = { call: { ...data.call, tool: canonTool(data.call.tool) }, result: data.result || null };
    const prev = parts[parts.length - 1];
    if (prev && prev.kind === 'tools') prev.items.push(item);
    else parts.push({ kind: 'tools', items: [item] });
  }
  pushText(text.slice(last));
  return parts;
}

export function withLive(parts, liveCalls) {
  if (!liveCalls || !liveCalls.length) return parts;
  const live = liveCalls.filter(r => r && r.call && r.call.tool)
    .map(r => ({ call: { ...r.call, tool: canonTool(r.call.tool) }, result: null, live: true }));
  if (!live.length) return parts;
  const out = parts.slice();
  const prev = out[out.length - 1];
  if (prev && prev.kind === 'tools') out[out.length - 1] = { ...prev, items: [...prev.items, ...live] };
  else out.push({ kind: 'tools', items: live });
  return out;
}

export function groupCounts(items) {
  const counts = {};
  let failed = 0;
  for (const it of items) {
    const k = kindOf(it.call.tool);
    counts[k] = (counts[k] || 0) + 1;
    if (it.result && it.result.ok === false) failed++;
  }
  return { list: KIND_ORDER.filter(k => counts[k]).map(k => ({ kind: k, n: counts[k] })), failed };
}

const WRITES = new Set(['create_file', 'str_replace', 'insert_lines']);

export function fileChanges(parts) {
  const map = new Map();
  for (const p of parts) {
    if (p.kind !== 'tools') continue;
    for (const { call, result } of p.items) {
      if (!result || result.ok === false || !call.path) continue;
      if (WRITES.has(call.tool)) {
        const cur = map.get(call.path) || { path: call.path, adds: 0, dels: 0, created: call.tool === 'create_file', v: 0 };
        cur.adds += Number(result.adds) || 0;
        cur.dels += Number(result.dels) || 0;
        if (result.v) cur.v = result.v;
        map.set(call.path, cur);
      } else if (call.tool === 'move_file' && call.new_path && map.has(call.path)) {
        const cur = map.get(call.path);
        map.delete(call.path);
        map.set(call.new_path, { ...cur, path: call.new_path });
      } else if (call.tool === 'delete_file') {
        map.delete(call.path);
      }
    }
  }
  return [...map.values()];
}

export function totals(changes) {
  let adds = 0, dels = 0;
  for (const c of changes) { adds += c.adds; dels += c.dels; }
  return { adds, dels };
}

export function stepTarget(call) {
  switch (call.tool) {
    case 'bash': return String(call.cmd || '').split('\n')[0];
    case 'move_file': case 'copy_file': return call.path && call.new_path ? call.path + ' → ' + call.new_path : call.path || call.new_path || '';
    case 'search': return call.query ? '"' + call.query + '"' : '';
    case 'find': return call.pattern || '';
    case 'web_search': return call.query ? '"' + call.query + '"' : '';
    case 'bundle_zip': return (call.name || 'bundle') + '.zip';
    case 'ask_user': return call.question || '';
    default: return call.path || call.partialPath || '';
  }
}