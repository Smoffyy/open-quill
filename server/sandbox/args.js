import { normalizeRel } from '../lib/sandboxguard.js';

const PATH_KEYS = ['path', 'file', 'filename', 'file_path', 'filepath'];
const DEST_KEYS = ['new_path', 'to', 'destination', 'dest', 'target'];

function first(call, keys) {
  for (const k of keys) {
    const v = call[k];
    if (v != null && v !== '') return v;
  }
  return undefined;
}

function toText(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : String(x))).join('\n');
  if (typeof v === 'object') { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
  return String(v);
}

export function argText(call, ...keys) {
  const v = first(call, keys);
  return v == null ? null : toText(v);
}

export function argBody(call, keys, salvageExcept = null) {
  for (const k of keys) {
    const v = call[k];
    if (v === undefined || v === null) continue;
    return { text: toText(v), key: k };
  }
  if (salvageExcept) {
    let bestKey = null, bestVal = null;
    for (const [k, v] of Object.entries(call)) {
      if (salvageExcept.has(k) || typeof v !== 'string') continue;
      if (!v.includes('\n') && v.length < 80) continue;
      if (bestVal == null || v.length > bestVal.length) { bestKey = k; bestVal = v; }
    }
    if (bestKey) return { text: bestVal, key: bestKey, salvaged: true };
  }
  return { text: null, key: null };
}

export function argRaw(call, ...keys) {
  const v = first(call, keys);
  return v == null ? null : v;
}

export function argBool(call, ...keys) {
  const v = first(call, keys);
  return v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';
}

export function argInt(call, ...keys) {
  const n = parseInt(first(call, keys));
  return Number.isFinite(n) ? n : undefined;
}

export function argList(call, ...keys) {
  const v = first(call, keys);
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) return v.split(/\s*,\s*/);
  return null;
}

// A relative path is normalized once, here, so the version metadata key, the path
// echoed back to the model, and the file on disk can never disagree.
export function argPath(call, keys = PATH_KEYS, label = 'path') {
  const raw = first(call, keys);
  if (raw == null) return { ok: true, rel: '', missing: true };
  const norm = normalizeRel(raw, { allowEmpty: true, label });
  if (!norm.ok) return { ok: false, error: norm.error };
  return { ok: true, rel: norm.rel, missing: norm.rel === '' };
}

export function argDest(call) {
  return argPath(call, DEST_KEYS, 'new_path');
}

export function missingArg(tool, arg, how, example) {
  const ex = example ? ` Example: ${tool}(${example})` : '';
  return { ok: false, error: `${tool} needs "${arg}". ${how} Send the call again with that argument included.${ex}` };
}
