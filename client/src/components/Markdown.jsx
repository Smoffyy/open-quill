import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import CodeBlock from './CodeBlock.jsx';
import ToolCard from './ToolCard.jsx';
import { scanTools } from '../toolproto.js';

function b64encode(str) {
  try {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  } catch { return ''; }
}
function b64decode(b64) {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
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

function transformTools(text) {
  const hasNew = text.indexOf('|TOOL|') !== -1 || /\|\s*tool\s*\|/i.test(text);
  const hasOqr = text.indexOf('[[OQR:') !== -1;
  const hasLegacy = text.indexOf('```tool') !== -1;
  if (!hasNew && !hasOqr && !hasLegacy) return text;

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
  const partial = text.match(/\[\[OQR:[A-Za-z0-9+/=]*$/);
  if (partial) spans.push({ kind: 'strip', start: partial.index, end: text.length });

  if (hasNew) {
    const { calls, live } = scanTools(text);
    for (const c of calls) spans.push({ kind: 'block', start: c.start, end: c.end, call: slim(c.call) });
    if (live && live.tool && live.start != null) spans.push({ kind: 'live', start: live.start, end: text.length, call: slim(live) });
  } else if (hasLegacy) {
    for (const b of legacyBlocks(text)) spans.push(b);
  }

  spans.sort((a, b) => a.start - b.start);
  let out = '', cursor = 0, ri = 0;
  const emit = (call, result) => { if (call && call.tool) out += '```toolcall\n' + b64encode(JSON.stringify({ call, result: result ?? null })) + '\n```'; };
  for (const s of spans) {
    if (s.start < cursor) continue;
    out += text.slice(cursor, s.start);
    if (s.kind === 'block') { const r = results[ri]; emit((r && r.call) || s.call, r && r.result); ri++; }
    else if (s.kind === 'live') { emit(s.call, null); }
    else if (s.kind === 'oqr') { if (s.ri >= ri) { const r = results[s.ri]; emit(r && r.call, r && r.result); ri = s.ri + 1; } }
    cursor = s.end;
  }
  out += text.slice(cursor);
  return out;
}

function Markdown({ children, streaming }) {
  const text = typeof children === 'string' ? transformTools(children) : children;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      components={{
        pre({ children }) {
          const el = Array.isArray(children) ? children[0] : children;
          const props = el?.props || {};
          const m = /language-(\w+)/.exec(props.className || '');
          const raw = String(props.children || '').replace(/\n$/, '');
          const lang = m ? m[1].toLowerCase() : '';
          if (lang === 'toolcall') {
            const data = (() => { try { return JSON.parse(b64decode(raw)); } catch { return null; } })();
            if (data && data.call) return <ToolCard call={data.call} result={data.result} />;
            return null;
          }
          return <CodeBlock lang={m ? m[1] : ''} code={raw} />;
        },
        code({ className, children }) {
          return <code className={className}>{children}</code>;
        }
      }}
    >{text}</ReactMarkdown>
  );
}

export default React.memo(Markdown);
