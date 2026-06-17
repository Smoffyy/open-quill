import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import CodeBlock from './CodeBlock.jsx';
import ToolCard from './ToolCard.jsx';

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

const TOOL_NAMES = ['web_search', 'bash', 'run', 'create_file', 'str_replace', 'view', 'list_files', 'delete_file', 'clear_sandbox', 'delete_all', 'rename_file', 'move_file', 'copy_file', 'make_dir', 'mkdir', 'search', 'extract_zip', 'bundle_zip'];
function normalizeCall(o) {
  if (!o || typeof o !== 'object') return o;
  let call = o;
  if (!call.tool) {
    const key = TOOL_NAMES.find(t => t in call);
    if (!key) return o;
    const v = call[key];
    call = { tool: key, ...call };
    delete call[key];
    if (typeof v === 'string') {
      if (key === 'web_search') { if (call.query == null) call.query = v; }
      else if (key === 'bash' || key === 'run') { if (call.cmd == null && call.command == null) call.cmd = v; }
      else if (call.path == null) call.path = v;
    }
  }
  if (call.tool === 'web_search' && call.query == null) call.query = call.search ?? call.q ?? call.input ?? call.text;
  if ((call.tool === 'bash' || call.tool === 'run') && call.cmd == null && call.command != null) call.cmd = call.command;
  return call;
}
function parseCall(body) {
  try { return normalizeCall(JSON.parse(body)); } catch {}
  const g = (re) => (body.match(re) || [])[1];
  let tool = g(/"tool"\s*:\s*"([^"]+)"/);
  if (!tool) { const m = body.match(/"(web_search|bash|run|create_file|str_replace|view|list_files|delete_file|clear_sandbox|delete_all|rename_file|move_file|copy_file|make_dir|mkdir|search|extract_zip|bundle_zip)"\s*:/); if (m) tool = m[1]; }
  const out = {
    tool,
    path: g(/"path"\s*:\s*"([^"]*)"/),
    cmd: g(/"(?:cmd|command)"\s*:\s*"([^"]*)"/),
    name: g(/"name"\s*:\s*"([^"]*)"/),
    query: g(/"(?:query|search|q|input)"\s*:\s*"([^"]*)"/),
    new_path: g(/"(?:new_path|to)"\s*:\s*"([^"]*)"/)
  };
  if (tool === 'web_search' && !out.query) out.query = g(/"web_search"\s*:\s*"([^"]*)"/);
  return out;
}

function findToolBlocks(text) {
  const blocks = [];
  let from = 0;
  while (true) {
    const open = text.indexOf('```tool', from);
    if (open === -1) break;
    if (text.slice(open, open + 11) === '```toolcall') { from = open + 11; continue; }
    const brace = text.indexOf('{', open + 7);
    const nextOpen = text.indexOf('```tool', open + 7);
    if (brace === -1 || (nextOpen !== -1 && nextOpen < brace)) { from = open + 7; continue; }
    let depth = 0, inStr = false, esc = false, jsonEnd = -1;
    for (let j = brace; j < text.length; j++) {
      const c = text[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { jsonEnd = j + 1; break; } }
    }
    if (jsonEnd === -1) {
      blocks.push({ start: open, end: text.length, body: text.slice(brace) });
      break;
    }
    let end = jsonEnd, k = jsonEnd;
    while (k < text.length && (text[k] === ' ' || text[k] === '\t' || text[k] === '\r' || text[k] === '\n')) k++;
    if (text.slice(k, k + 3) === '```' && text.slice(k, k + 7) !== '```tool') end = k + 3;
    blocks.push({ start: open, end, body: text.slice(brace, jsonEnd) });
    from = end;
  }
  return blocks;
}

function transformTools(text) {
  if (!text || (text.indexOf('```tool') === -1 && text.indexOf('[[OQR:') === -1)) return text;
  const results = [];
  const spans = [];
  const oqrRe = /\[\[OQR:([A-Za-z0-9+/=]+)\]\]/g;
  let m;
  while ((m = oqrRe.exec(text))) {
    let r = null;
    try { r = JSON.parse(b64decode(m[1])); } catch {}
    spans.push({ kind: 'oqr', start: m.index, end: m.index + m[0].length });
    results.push(r);
  }
  const partial = text.match(/\[\[OQR:[A-Za-z0-9+/=]*$/);
  if (partial) spans.push({ kind: 'strip', start: partial.index, end: text.length });
  for (const b of findToolBlocks(text)) spans.push({ kind: 'block', start: b.start, end: b.end, body: b.body });
  spans.sort((a, b) => a.start - b.start);
  let out = '', cursor = 0, ri = 0;
  for (const s of spans) {
    if (s.start < cursor) { if (s.kind === 'block') ri++; continue; }
    out += text.slice(cursor, s.start);
    if (s.kind === 'block') {
      const parsed = parseCall(s.body.trim());
      const r = ri < results.length ? results[ri] : null;
      ri++;
      const call = (r && r.call) ? r.call : parsed;
      if (call && call.tool) out += '```toolcall\n' + b64encode(JSON.stringify({ call, result: r ? (r.result ?? null) : null })) + '\n```';
    }
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
          if (lang === 'tool') {
            return <ToolCard call={parseCall(raw)} result={null} />;
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
