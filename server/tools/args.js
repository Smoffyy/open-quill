import { extractPartial, matchBracket } from './partial.js';

export const CUT_OFF = Symbol('oq.cutOff');

const ARG_WRAPPERS = ['arguments', 'parameters', 'args', 'input', 'kwargs', 'parameter'];

function unwrapArgs(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const keys = Object.keys(v);
  if (keys.length > 2) return v;
  for (const w of ARG_WRAPPERS) {
    if (!Object.prototype.hasOwnProperty.call(v, w)) continue;
    const rest = keys.filter(k => k !== w);
    if (rest.length && !['name', 'tool', 'tool_name', 'function', 'type', 'id', 'index'].includes(rest[0])) return v;
    let inner = v[w];
    if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch { return v; } }
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner;
  }
  return v;
}

function tryJson(text) {
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {}
  return null;
}

export function parseArgs(argsText) {
  if (argsText == null || argsText === '') return {};
  if (typeof argsText === 'object') return Array.isArray(argsText) ? {} : unwrapArgs(argsText);
  let text = String(argsText).trim();
  const fence = text.match(/^```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();

  let v = tryJson(text);
  if (!v) v = tryJson(text.replace(/,\s*([}\]])/g, '$1'));
  if (!v) {
    const from = text.indexOf('{');
    if (from !== -1) {
      const end = matchBracket(text, from);
      if (end !== -1) v = tryJson(text.slice(from, end + 1)) || tryJson(text.slice(from, end + 1).replace(/,\s*([}\]])/g, '$1'));
      if (!v) {
        const last = text.lastIndexOf('}');
        if (last > from) v = tryJson(text.slice(from, last + 1));
      }
    }
  }
  if (v) return unwrapArgs(v);

  const partial = extractPartial(text);
  const out = {};
  let cut = null;
  for (const k of Object.keys(partial)) {
    if (partial[k].closed) out[k] = partial[k].value;
    else cut = { key: k, chars: String(partial[k].value ?? '').length };
  }
  const res = unwrapArgs(out);
  if (cut && res && typeof res === 'object') res[CUT_OFF] = cut;
  return res;
}

export function toCall(name, argsText) {
  let args;
  try { args = parseArgs(argsText); } catch { args = {}; }
  return { ...args, tool: String(name || '').trim() };
}

export function cutOffOf(call) {
  return call && call[CUT_OFF] ? call[CUT_OFF] : null;
}
