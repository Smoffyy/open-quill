import { b64decode } from './oqr.js';
import { scanTools } from './toolproto.js';

export function b64encode(str) {
  try {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  } catch { return ''; }
}

function slim(call) {
  if (!call) return call;
  const { content, old_str, new_str, paths, ...rest } = call;
  return rest;
}

function legacyBlocks(text) {
  const blocks = [];
  let from = 0;
  while (true) {
    const open = text.indexOf('```tool', from);
    if (open === -1) break;
    const brace = text.indexOf('{', open + 7);
    if (brace === -1) break;
    let depth = 0, inStr = false, esc = false, jsonEnd = -1;
    for (let j = brace; j < text.length; j++) {
      const c = text[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { jsonEnd = j + 1; break; } }
    }
    if (jsonEnd === -1) break;
    let end = jsonEnd, k = jsonEnd;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (text.slice(k, k + 3) === '```') end = k + 3;
    let call = null;
    try { call = JSON.parse(text.slice(brace, jsonEnd)); } catch {}
    if (call && !call.tool) { const key = Object.keys(call).find(x => /^(web_search|bash|run|create_file|str_replace|view|list_files|delete_file|clear_sandbox|delete_all|rename_file|move_file|copy_file|make_dir|mkdir|search|extract_zip|bundle_zip)$/.test(x)); if (key) call = { tool: key, ...call }; }
    if (call && call.tool) blocks.push({ kind: 'block', start: open, end, call: slim(call) });
    from = end;
  }
  return blocks;
}

export function transformTools(text) {
  const hasNew = /[|<]\s*\/?\s*\|?\s*tool/i.test(text);
  const hasOqr = text.indexOf('[[OQR:') !== -1;
  const hasOqt = text.indexOf('[[OQT:') !== -1;
  const hasLegacy = text.indexOf('```tool') !== -1;
  if (!hasNew && !hasOqr && !hasOqt && !hasLegacy) return text;

  const spans = [];
  const results = [];
  const oqrRe = /\[\[OQR:([A-Za-z0-9+/=]+)\]\]/g;
  let m;
  while ((m = oqrRe.exec(text))) {
    let r = null;
    try { r = JSON.parse(b64decode(m[1])); } catch {}
    spans.push({ kind: 'oqr', start: m.index, end: m.index + m[0].length, ri: results.length });
    results.push(r);
  }
  const oqtRe = /\[\[OQT:(\d+)\]\]/g;
  while ((m = oqtRe.exec(text))) spans.push({ kind: 'oqt', start: m.index, end: m.index + m[0].length, seg: Number(m[1]) });
  const partial = text.match(/\[\[OQ[RT]?:?[A-Za-z0-9+/=]*$/);
  if (partial) spans.push({ kind: 'strip', start: partial.index, end: text.length });

  if (hasNew) {
    const { calls, live } = scanTools(text);
    for (const c of calls) spans.push({ kind: 'block', start: c.start, end: c.end, call: slim(c.call) });
    if (live && live.tool && live.start != null) {
      const oi = text.indexOf('[[OQR:', live.start);
      if (oi === -1) spans.push({ kind: 'live', start: live.start, end: text.length, call: slim(live) });
      else spans.push({ kind: 'strip', start: live.start, end: oi });
    }
  } else if (hasLegacy) {
    for (const b of legacyBlocks(text)) spans.push(b);
  }

  spans.sort((a, b) => a.start - b.start);
  let out = '', cursor = 0, ri = 0;
  const emit = (call, result, hidden) => { if (!hidden && call && call.tool) out += '```toolcall\n' + b64encode(JSON.stringify({ call, result: result ?? null })) + '\n```'; };
  for (const s of spans) {
    if (s.start < cursor) continue;
    out += text.slice(cursor, s.start);
    if (s.kind === 'block') { const r = results[ri]; emit((r && r.call) || s.call, r && r.result, r && r.hidden); ri++; }
    else if (s.kind === 'live') { emit(s.call, null); }
    else if (s.kind === 'oqr') { if (s.ri >= ri) { const r = results[s.ri]; emit(r && r.call, r && r.result, r && r.hidden); ri = s.ri + 1; } }
    else if (s.kind === 'oqt') { out += '```reasonseg\n' + s.seg + '\n```'; }
    cursor = s.end;
  }
  out += text.slice(cursor);
  return out;
}