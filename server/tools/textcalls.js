import { matchBracket } from './partial.js';

const TEXT_CALL_NUM_KEYS = new Set(['start', 'end', 'count', 'timeout_s', 'max_results', 'limit', 'line', 'lines', 'depth', 'n']);
const TEXT_CALL_BOOL_KEYS = new Set(['replace_all', 'all', 'regex', 'recursive', 'overwrite', 'hidden', 'extended']);
const NAME_HINT_WINDOW = 240;

const PARAM_OPEN_RE = /<\s*(?:antml:)?parameter(?:\s*=\s*|\s+name\s*=\s*)["']?([A-Za-z0-9_.-]+)["']?\s*>/gi;
const PARAM_CLOSE_RE = /<\s*\/\s*(?:antml:)?parameter\s*>/i;
const FN_OPEN_RE = /<\s*(?:antml:)?(?:function|invoke|tool_call|toolcall|function_call)(?:\s*=\s*|\s+name\s*=\s*)["']?([A-Za-z0-9_.-]+)["']?\s*>/gi;
const FN_CLOSE_RE = /<\s*\/\s*(?:antml:)?(?:function|invoke|tool_call|toolcall|function_call)\s*>/i;
const TRAIL_TAG_RE = /(?:\s*(?:<\s*\/\s*(?:antml:)?(?:function|invoke|tool_call|toolcall|function_call)\s*>|\[\/?TOOL_CALLS?\]|<\|\/?tool_call\|>))+\s*$/i;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_.-]*/g;

function coerceTextArg(key, raw) {
  const v = String(raw);
  const t = v.trim();
  if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
  if (t === 'null') return null;
  if (TEXT_CALL_BOOL_KEYS.has(key) && /^(yes|no|1|0)$/i.test(t)) return /^(yes|1)$/i.test(t);
  if (TEXT_CALL_NUM_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^[[{]/.test(t)) { try { const p = JSON.parse(t); if (p && typeof p === 'object') return p; } catch {} }
  return v;
}

function trimBlockValue(v) {
  return String(v).replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
}

function paramHits(body) {
  const hits = [];
  PARAM_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = PARAM_OPEN_RE.exec(body))) hits.push({ key: m[1], at: m.index, from: m.index + m[0].length });
  return hits;
}

function parseParams(body) {
  const args = {};
  const hits = paramHits(body);
  for (let i = 0; i < hits.length; i++) {
    const stop = i + 1 < hits.length ? hits[i + 1].at : body.length;
    let raw = body.slice(hits[i].from, stop);
    const close = raw.search(PARAM_CLOSE_RE);
    if (close !== -1) raw = raw.slice(0, close);
    else raw = raw.replace(TRAIL_TAG_RE, '');
    args[hits[i].key] = coerceTextArg(hits[i].key, trimBlockValue(raw));
  }
  return { args, count: hits.length };
}

function xmlTextCalls(block) {
  const opens = [];
  FN_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = FN_OPEN_RE.exec(block))) opens.push({ name: m[1], at: m.index, from: m.index + m[0].length });
  const out = [];
  for (let i = 0; i < opens.length; i++) {
    const limit = i + 1 < opens.length ? opens[i + 1].at : block.length;
    let body = block.slice(opens[i].from, limit);
    const close = body.search(FN_CLOSE_RE);
    if (close !== -1) body = body.slice(0, close);
    const parsed = parseParams(body);
    if (parsed.count) { out.push({ name: opens[i].name, args: parsed.args }); continue; }
    const jsonArgs = firstJsonObject(body);
    out.push({ name: opens[i].name, args: jsonArgs || {} });
  }
  return out;
}

function nameFromHint(head, isAllowed) {
  if (!isAllowed) return null;
  const tail = head.length > NAME_HINT_WINDOW ? head.slice(head.length - NAME_HINT_WINDOW) : head;
  const ids = tail.match(IDENT_RE) || [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    const hit = isAllowed(id);
    if (hit) return typeof hit === 'string' ? hit : id;
    const dot = id.includes('.') ? id.split('.').pop() : null;
    if (!dot) continue;
    const dotHit = isAllowed(dot);
    if (dotHit) return typeof dotHit === 'string' ? dotHit : dot;
  }
  return null;
}

function bareParamCalls(block, isAllowed, hint) {
  const hits = paramHits(block);
  if (!hits.length) return [];
  const name = nameFromHint(hint + '\n' + block.slice(0, hits[0].at), isAllowed);
  if (!name) return [];
  const parsed = parseParams(block.slice(hits[0].at));
  return parsed.count ? [{ name, args: parsed.args }] : [];
}

function firstJsonObject(text) {
  const from = text.indexOf('{');
  if (from === -1) return null;
  const end = matchBracket(text, from);
  if (end === -1) return null;
  try {
    const v = JSON.parse(text.slice(from, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function jsonChunks(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const end = matchBracket(text, i);
    if (end === -1) break;
    let v = null;
    try { v = JSON.parse(text.slice(i, end + 1)); } catch {}
    if (v == null) { try { v = JSON.parse(text.slice(i, end + 1).replace(/,\s*([}\]])/g, '$1')); } catch {} }
    if (v != null) out.push({ value: v, at: i, end });
    i = end;
  }
  return out;
}

function flattenJsonCalls(v, out) {
  if (Array.isArray(v)) { for (const item of v) flattenJsonCalls(item, out); return; }
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v.tool_calls)) { flattenJsonCalls(v.tool_calls, out); return; }
  if (Array.isArray(v.calls)) { flattenJsonCalls(v.calls, out); return; }
  const fn = (v.function && typeof v.function === 'object') ? v.function : v;
  const name = String(fn.name || fn.tool || fn.tool_name || fn.recipient_name || '').trim().replace(/^functions\./, '');
  if (!name) return;
  let args = fn.arguments ?? fn.parameters ?? fn.args ?? fn.input ?? v.arguments ?? v.parameters ?? v.input ?? {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  out.push({ name, args });
}

function jsonTextCalls(block) {
  let text = String(block).trim();
  const fence = text.match(/^```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  const out = [];
  for (const chunk of jsonChunks(text)) flattenJsonCalls(chunk.value, out);
  if (out.length) return out;
  const from = text.search(/[[{]/);
  if (from === -1) return [];
  const last = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (last <= from) return [];
  try { flattenJsonCalls(JSON.parse(text.slice(from, last + 1)), out); } catch {}
  return out;
}

function namedJsonCalls(block, isAllowed, hint) {
  let text = String(block).trim();
  const fence = text.match(/^```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  const out = [];
  for (const chunk of jsonChunks(text)) {
    if (!chunk.value || typeof chunk.value !== 'object' || Array.isArray(chunk.value)) continue;
    const name = nameFromHint(hint + '\n' + text.slice(0, chunk.at), isAllowed);
    if (!name) continue;
    out.push({ name, args: chunk.value });
  }
  return out;
}

export function parseTextToolCalls(block, isAllowed, hint = '') {
  const raw = String(block || '');
  if (!raw.trim()) return [];
  const lead = String(hint || '').slice(-NAME_HINT_WINDOW);
  let calls = [];
  if (/<\s*(?:antml:)?(?:function|invoke|tool_call|toolcall|function_call)(?:\s*=|\s+name\s*=)/i.test(raw)) calls = xmlTextCalls(raw);
  if (!calls.length) calls = bareParamCalls(raw, isAllowed, lead);
  if (!calls.length) calls = jsonTextCalls(raw);
  if (!calls.length) calls = namedJsonCalls(raw, isAllowed, lead);
  const out = [];
  for (const c of calls) {
    const name = String(c.name || '').trim().replace(/^functions\./, '');
    if (!name) continue;
    let final = name;
    if (isAllowed) {
      const hit = isAllowed(name);
      if (!hit) continue;
      if (typeof hit === 'string') final = hit;
    }
    out.push({ name: final, argsText: JSON.stringify(c.args || {}) });
  }
  return out;
}
