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
  const hasNew = /[|<]\s*\/?\s*\|?\s*tool/i.test(text);
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

function isFenceLine(line) {
  return /^\s*(`{3,}|~{3,})/.test(line);
}

function blockify(text) {
  const lines = text.split('\n');
  const blocks = [];
  let buf = [];
  let inFence = false;
  for (const line of lines) {
    buf.push(line);
    if (isFenceLine(line)) {
      if (inFence) { inFence = false; blocks.push(buf.join('\n')); buf = []; }
      else inFence = true;
      continue;
    }
    if (!inFence && line.trim() === '' && buf.some(l => l.trim() !== '')) {
      blocks.push(buf.join('\n'));
      buf = [];
    }
  }
  if (buf.length) blocks.push(buf.join('\n'));
  return blocks;
}

const mdComponents = {
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
};

const MarkdownBlock = React.memo(function MarkdownBlock({ text }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      components={mdComponents}
    >{text}</ReactMarkdown>
  );
});

function normalizeMathDelims(text) {
  if (!text || (text.indexOf('\\[') === -1 && text.indexOf('\\(') === -1)) return text;
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p.startsWith('`')) continue;
    parts[i] = p
      .replace(/\\\[/g, () => '$$')
      .replace(/\\\]/g, () => '$$')
      .replace(/\\\(/g, () => '$')
      .replace(/\\\)/g, () => '$');
  }
  return parts.join('');
}

function autoCloseMath(text) {
  let inFence = false, inCode = false, mode = 0, openIdx = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inFence) { if (c === '`' && text.slice(i, i + 3) === '```') { inFence = false; i += 2; } continue; }
    if (inCode) { if (c === '`') inCode = false; continue; }
    if (c === '`') { if (text.slice(i, i + 3) === '```') { inFence = true; i += 2; } else inCode = true; continue; }
    if (c === '\\') { i++; continue; }
    if (c !== '$') continue;
    if (text[i + 1] === '$') { if (mode === 2) mode = 0; else if (mode === 0) { mode = 2; openIdx = i + 2; } i++; continue; }
    if (mode === 1) mode = 0; else if (mode === 0) { mode = 1; openIdx = i + 1; }
  }
  if (!mode || inFence || inCode) return text;
  let out = text.replace(/\\[a-zA-Z]+$/, '');
  const seg = out.slice(openIdx);
  let braces = 0, lefts = 0;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '\\') {
      if (seg.slice(i, i + 5) === '\\left') { lefts++; i += 4; }
      else if (seg.slice(i, i + 6) === '\\right') { lefts = Math.max(0, lefts - 1); i += 5; }
      else i++;
      continue;
    }
    if (c === '{') braces++;
    else if (c === '}') braces = Math.max(0, braces - 1);
  }
  out = out.replace(/[_^]$/, '');
  out += '}'.repeat(braces) + '\\right.'.repeat(lefts) + (mode === 2 ? '$$' : '$');
  return out;
}

function Markdown({ children, streaming }) {
  const held = React.useRef({ src: '', out: '', at: 0 });
  if (typeof children !== 'string') {
    return <MarkdownBlock text={children} />;
  }
  let text = normalizeMathDelims(transformTools(children));
  if (streaming) {
    const closed = autoCloseMath(text);
    if (closed === text) {
      held.current = { src: '', out: '', at: 0 };
    } else {
      const now = performance.now();
      const h = held.current;
      if (h.out && text.startsWith(h.src) && now - h.at < 120) {
        text = h.out;
      } else {
        held.current = { src: text, out: closed, at: now };
        text = closed;
      }
    }
  }
  const blocks = blockify(text);
  return blocks.map((b, i) => <MarkdownBlock key={i} text={b} />);
}

export default React.memo(Markdown);
