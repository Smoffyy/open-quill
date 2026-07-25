const TEXT_CALL_NUM_KEYS = new Set(['start', 'end', 'count', 'timeout_s', 'max_results', 'limit', 'line', 'lines', 'depth', 'n']);

function coerceTextArg(key, raw) {
  const v = String(raw);
  const t = v.trim();
  if (/^(true|false)$/i.test(t)) return /^true$/i.test(t);
  if (t === 'null') return null;
  if (TEXT_CALL_NUM_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^[[{]/.test(t)) { try { const p = JSON.parse(t); if (p && typeof p === 'object') return p; } catch {} }
  return v;
}

function trimBlockValue(v) {
  return String(v).replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
}

function xmlTextCalls(block) {
  const out = [];
  const fnRe = /<function(?:\s*=\s*|\s+name\s*=\s*)["']?([A-Za-z0-9_.\-]+)["']?\s*>/g;
  let m;
  while ((m = fnRe.exec(block))) {
    const rest = block.slice(m.index + m[0].length);
    const stop = rest.search(/<\/function\s*>/);
    const body = stop === -1 ? rest : rest.slice(0, stop);
    const args = {};
    const pRe = /<parameter(?:\s*=\s*|\s+name\s*=\s*)["']?([A-Za-z0-9_.\-]+)["']?\s*>([\s\S]*?)<\/parameter\s*>/g;
    let p;
    while ((p = pRe.exec(body))) args[p[1]] = coerceTextArg(p[1], trimBlockValue(p[2]));
    out.push({ name: m[1], args });
  }
  return out;
}

function jsonTextCalls(block) {
  let text = String(block).trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  const from = text.search(/[[{]/);
  if (from === -1) return [];
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(text.slice(from));
  if (!v) {
    const last = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (last > from) v = tryParse(text.slice(from, last + 1));
  }
  if (!v) return [];
  const out = [];
  for (const item of (Array.isArray(v) ? v : [v])) {
    if (!item || typeof item !== 'object') continue;
    const fn = (item.function && typeof item.function === 'object') ? item.function : item;
    const name = String(fn.name || fn.tool || fn.tool_name || '').trim();
    if (!name) continue;
    let args = fn.arguments ?? fn.parameters ?? fn.args ?? item.arguments ?? item.parameters ?? {};
    if (typeof args === 'string') args = tryParse(args) || {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    out.push({ name, args });
  }
  return out;
}

export function parseTextToolCalls(block, isAllowed) {
  const raw = String(block || '');
  if (!raw.trim()) return [];
  let calls = raw.includes('<function') ? xmlTextCalls(raw) : [];
  if (!calls.length) calls = jsonTextCalls(raw);
  const out = [];
  for (const c of calls) {
    if (!c.name) continue;
    if (isAllowed && !isAllowed(c.name)) continue;
    out.push({ name: c.name, argsText: JSON.stringify(c.args || {}) });
  }
  return out;
}

