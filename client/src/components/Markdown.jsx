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

function remarkBreaks() {
  return (tree) => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      const out = [];
      for (const child of node.children) {
        if (child.type === 'html' && typeof child.value === 'string' && /^(?:\s*<br\s*\/?>\s*)+$/i.test(child.value)) {
          const count = (child.value.match(/<br\s*\/?>/gi) || []).length || 1;
          for (let i = 0; i < count; i++) out.push({ type: 'break' });
        } else {
          walk(child);
          out.push(child);
        }
      }
      node.children = out;
    };
    walk(tree);
    return tree;
  };
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
  const prepared = React.useMemo(() => guardBlock(text), [text]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
      rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, macros: { '\\mdollar': '\\$' } }]]}
      components={mdComponents}
    >{prepared}</ReactMarkdown>
  );
});

const SENT = '\u0000';

function guardDollars(s) {
  if (s.indexOf('$') === -1) return s;
  const singles = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c !== '$') continue;
    if (s[i + 1] === '$') { i++; continue; }
    if (s[i - 1] === SENT || s[i + 1] === SENT) continue;
    singles.push(i);
  }
  if (!singles.length) return s;
  const esc = new Set();
  for (const i of singles) {
    const m = /^\d[\d,]*(?:\.\d+)?/.exec(s.slice(i + 1, i + 24));
    if (!m) continue;
    const after = s[i + 1 + m[0].length] || '';
    if (after && '^_{\\'.includes(after)) continue;
    let mathish = false;
    for (let j = i + 1 + m[0].length; j < Math.min(s.length, i + 260); j++) {
      const ch = s[j];
      if (ch === '\\' || ch === '^' || ch === '_') { mathish = true; break; }
      if (ch === '$' || ch === '\n') break;
    }
    if (!mathish) esc.add(i);
  }
  const rest = singles.filter(i => !esc.has(i));
  const pairs = [];
  for (let k = 0; k + 1 < rest.length; k += 2) {
    const a = rest[k], b = rest[k + 1];
    const inner = s.slice(a + 1, b);
    if (!inner || /^\s/.test(inner) || /\s$/.test(inner) || inner.includes('**') || inner.includes('\n\n') || inner.length > 300) {
      esc.add(a);
      esc.add(b);
    } else {
      pairs.push([a, b]);
    }
  }
  if (!esc.size && !pairs.some(([a, b]) => s.slice(a + 1, b).includes('\\$'))) return s;
  let out = '';
  let idx = 0;
  let pi = 0;
  while (idx < s.length) {
    if (pi < pairs.length && idx === pairs[pi][0]) {
      const [a, b] = pairs[pi++];
      let inner = '';
      for (let j = a + 1; j < b; j++) inner += esc.has(j) ? '\\$' : s[j];
      out += '$' + inner.split('\\$').join('\\mdollar ') + '$';
      idx = b + 1;
      continue;
    }
    out += esc.has(idx) ? '\\$' : s[idx];
    idx++;
  }
  return out;
}

function guardBlock(text) {
  if (text.indexOf(SENT) !== -1) {
    text = text.replace(/\u0000(\${1,2})([\s\S]*?)\1\u0000/g, (full, d, inner) => SENT + d + inner.split('\\$').join('\\mdollar ') + d + SENT);
  }
  if (text.indexOf('$') === -1) return text.indexOf(SENT) === -1 ? text : text.split(SENT).join('');
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p.startsWith('`')) continue;
    parts[i] = guardDollars(p);
  }
  return parts.join('').split(SENT).join('');
}

function neutralizeOpenMath(text) {
  let i = 0;
  let open = -1;
  let openLen = 0;
  let inFence = false;
  let inCode = false;
  while (i < text.length) {
    const ch = text[i];
    if (inFence) {
      if (ch === '`' && text.startsWith('```', i)) { inFence = false; i += 3; continue; }
      i++;
      continue;
    }
    if (inCode) {
      if (ch === '`' || ch === '\n') inCode = false;
      i++;
      continue;
    }
    if (ch === '`') {
      if (text.startsWith('```', i)) { inFence = true; i += 3; } else { inCode = true; i++; }
      continue;
    }
    if (ch === '\\') { i += 2; continue; }
    if (ch === '$') {
      const len = text[i + 1] === '$' ? 2 : 1;
      if (open === -1) {
        open = i;
        openLen = len;
        i += len;
        continue;
      }
      if (openLen === len) {
        open = -1;
        i += len;
        continue;
      }
      if (openLen === 2 && len === 1) { i += 1; continue; }
      open = -1;
      i += 1;
      continue;
    }
    i++;
  }
  if (open === -1) return text;
  let out = text.slice(0, open) + '\\$';
  if (openLen === 2) out += '\\$';
  return out + text.slice(open + openLen);
}

function normalizeMathDelims(text) {
  if (!text || (text.indexOf('\\[') === -1 && text.indexOf('\\(') === -1)) return text;
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p.startsWith('`')) continue;
    parts[i] = p
      .replace(/\\\[/g, () => SENT + '$$')
      .replace(/\\\]/g, () => '$$' + SENT)
      .replace(/\\\(/g, () => SENT + '$')
      .replace(/\\\)/g, () => '$' + SENT);
  }
  return parts.join('');
}

function Markdown({ children, streaming }) {
  if (typeof children !== 'string') {
    return <MarkdownBlock text={children} />;
  }
  let text = normalizeMathDelims(transformTools(children));
  if (streaming) text = neutralizeOpenMath(text);
  const blocks = blockify(text);
  return blocks.map((b, i) => <MarkdownBlock key={i} text={b} />);
}

export default React.memo(Markdown);
