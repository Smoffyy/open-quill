import vm from 'vm';
import { getSetting, setSetting, uid } from './db.js';

const RESERVED = new Set(['web_search', 'bash', 'run', 'create_file', 'str_replace', 'view', 'list_files', 'delete_file', 'clear_sandbox', 'delete_all', 'rename_file', 'move_file', 'copy_file', 'make_dir', 'mkdir', 'search', 'extract_zip', 'bundle_zip', 'mb_view', 'mb_search']);
const NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
const DEFAULT_TIMEOUT = 15000;

export function normalizeName(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9_]/g, '_').replace(/^_+/, '').slice(0, 40); }

export function list() {
  const raw = getSetting('custom_tools', []);
  return Array.isArray(raw) ? raw : [];
}
function save(arr) { setSetting('custom_tools', arr); }

export function getEnabled() { return list().filter(t => t.enabled); }
export function nameSet() { return new Set(getEnabled().map(t => t.name)); }
export function isCustom(name) { return nameSet().has(name); }
export function byName(name) { return getEnabled().find(t => t.name === name) || null; }

function sanitizeParams(params) {
  if (!Array.isArray(params)) return [];
  return params.map(p => ({
    name: normalizeName(p.name),
    desc: String(p.desc || '').slice(0, 240),
    required: !!p.required
  })).filter(p => p.name).slice(0, 12);
}

function validate(b, existingId) {
  const name = normalizeName(b.name);
  if (!NAME_RE.test(name)) return { error: 'Tool name must be 2-40 chars: lowercase letters, digits, underscores, starting with a letter.' };
  if (RESERVED.has(name)) return { error: `"${name}" is a built-in tool name. Choose another.` };
  if (list().some(t => t.name === name && t.id !== existingId)) return { error: `A tool named "${name}" already exists.` };
  if (!String(b.code || '').trim()) return { error: 'Tool code is required.' };
  return {
    name,
    description: String(b.description || '').slice(0, 600),
    params: sanitizeParams(b.params),
    code: String(b.code).slice(0, 20000),
    timeout_ms: Math.max(1000, Math.min(60000, parseInt(b.timeout_ms) || DEFAULT_TIMEOUT)),
    enabled: b.enabled !== false,
    auto: !!b.auto
  };
}

export function create(b) {
  const v = validate(b);
  if (v.error) return v;
  const tool = { id: uid(), ...v, created_at: Date.now() };
  save([...list(), tool]);
  return { ok: true, tool };
}
export function update(id, b) {
  const arr = list();
  const i = arr.findIndex(t => t.id === id);
  if (i === -1) return { error: 'Tool not found.' };
  if ('enabled' in b && Object.keys(b).length === 1) { arr[i] = { ...arr[i], enabled: !!b.enabled }; save(arr); return { ok: true, tool: arr[i] }; }
  const v = validate({ ...arr[i], ...b }, id);
  if (v.error) return v;
  arr[i] = { ...arr[i], ...v };
  save(arr);
  return { ok: true, tool: arr[i] };
}
export function remove(id) { save(list().filter(t => t.id !== id)); return { ok: true }; }

export function promptFor(tools) {
  const enabled = (tools && tools.length) ? tools : getEnabled();
  if (!enabled.length) return '';
  let p = '## Live data tools\nYou can call these admin-provided tools to fetch real-world, real-time information. Call them with the same `|TOOL|` line protocol used for other tools: a line `|TOOL| <name>`, then `key: value` argument lines, then `|/TOOL|`. After a call, stop and wait for the tool result before continuing.\n';
  for (const t of enabled) {
    p += `\n### ${t.name}\n${t.description || '(no description)'}\n`;
    if (t.params.length) {
      p += 'Arguments:\n';
      for (const a of t.params) p += `- ${a.name}${a.required ? ' (required)' : ''}: ${a.desc || ''}\n`;
      p += `\nExample:\n|TOOL| ${t.name}\n${t.params.map(a => `${a.name}: ...`).join('\n')}\n|/TOOL|\n`;
    } else {
      p += `\nExample:\n|TOOL| ${t.name}\n|/TOOL|\n`;
    }
  }
  return p.trim();
}

function argsFromCall(tool, call) {
  const args = {};
  for (const a of tool.params) if (call[a.name] !== undefined) args[a.name] = call[a.name];
  return args;
}

const SAFE_GLOBALS = {
  fetch, URL, URLSearchParams, TextDecoder, TextEncoder, JSON, Math, Date,
  Number, String, Array, Object, Boolean, parseInt, parseFloat, isNaN, isFinite,
  Promise, encodeURIComponent, decodeURIComponent, btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'), atob: (s) => Buffer.from(String(s), 'base64').toString('binary')
};

export async function execTool(call) {
  const tool = byName(call.tool);
  if (!tool) return { ok: false, error: `Unknown tool: ${call.tool}` };
  const args = argsFromCall(tool, call);
  for (const a of tool.params) if (a.required && (args[a.name] == null || args[a.name] === '')) return { ok: false, error: `Missing required argument: ${a.name}` };
  const logs = [];
  const sandboxCtx = {
    ...SAFE_GLOBALS,
    args,
    console: { log: (...x) => logs.push(x.map(String).join(' ')), error: (...x) => logs.push(x.map(String).join(' ')), warn: (...x) => logs.push(x.map(String).join(' ')) }
  };
  let fn;
  try {
    const src = `(async function(args){\n${tool.code}\n})`;
    fn = vm.runInNewContext(src, vm.createContext(sandboxCtx), { timeout: 3000, filename: `tool:${tool.name}.js` });
  } catch (e) { return { ok: false, error: 'Tool failed to compile: ' + String(e.message || e) }; }
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`Tool timed out after ${Math.round(tool.timeout_ms / 1000)}s`)), tool.timeout_ms); });
  try {
    const result = await Promise.race([Promise.resolve().then(() => fn(args)), timeout]);
    return { ok: true, result: result === undefined ? null : result, logs };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 500), logs };
  } finally { clearTimeout(timer); }
}

function stringify(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

export function resultPayload(call, r) {
  if (!r || !r.ok) return { ok: false, error: r?.error || 'Tool failed' };
  const text = stringify(r.result);
  return { ok: true, preview: text.slice(0, 600) };
}

export function formatResult(call, r) {
  const head = `${call.tool}`;
  if (!r || !r.ok) return `${head} → ERROR: ${r?.error || 'failed'}`;
  let out = `${head} →\n${stringify(r.result)}`;
  if (out.length > 12000) out = out.slice(0, 12000) + '\n… [tool output truncated]';
  return out;
}
