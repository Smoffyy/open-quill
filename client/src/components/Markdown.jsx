import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import CodeBlock from './CodeBlock.jsx';
import ToolCard from './ToolCard.jsx';

function b64encode(str) { try { return btoa(unescape(encodeURIComponent(str))); } catch { return ''; } }
function b64decode(b64) { try { return decodeURIComponent(escape(atob(b64))); } catch { return ''; } }

function parseCall(body) {
  try { return JSON.parse(body); } catch {}
  const g = (re) => (body.match(re) || [])[1];
  return {
    tool: g(/"tool"\s*:\s*"([^"]+)"/),
    path: g(/"path"\s*:\s*"([^"]*)"/),
    cmd: g(/"(?:cmd|command)"\s*:\s*"([^"]*)"/),
    name: g(/"name"\s*:\s*"([^"]*)"/),
    query: g(/"query"\s*:\s*"([^"]*)"/),
    new_path: g(/"new_path"\s*:\s*"([^"]*)"/)
  };
}

function targetKey(call) {
  if (!call || !call.tool) return '';
  return call.tool + '|' + (call.path || call.cmd || call.name || call.query || call.new_path || '');
}

function transformTools(text) {
  if (!text || (text.indexOf('```tool') === -1 && text.indexOf('[[OQR:') === -1)) return text;
  const results = [];
  text = text.replace(/\[\[OQR:([A-Za-z0-9+/=]+)\]\]/g, (_, b64) => {
    try { const r = JSON.parse(b64decode(b64)); if (r) results.push(r); } catch {}
    return '';
  });
  text = text.replace(/\[\[OQR:[A-Za-z0-9+/=]*$/, '');
  const used = new Array(results.length).fill(false);
  const take = (call) => {
    const key = targetKey(call);
    let i = key ? results.findIndex((r, k) => !used[k] && targetKey(r.call) === key) : -1;
    if (i < 0 && call && call.tool) i = results.findIndex((r, k) => !used[k] && r.call && r.call.tool === call.tool);
    if (i < 0) i = results.findIndex((_, k) => !used[k]);
    if (i < 0) return null;
    used[i] = true; return results[i];
  };
  // closed tool blocks → paired toolcall cards
  text = text.replace(/```tool[ \t]*\r?\n([\s\S]*?)```/g, (_full, body) => {
    const parsed = parseCall(body.trim());
    const r = take(parsed);
    const call = (r && r.call) || parsed;
    const payload = { call, result: r ? (r.result ?? null) : null };
    return '```toolcall\n' + b64encode(JSON.stringify(payload)) + '\n```';
  });
  // a still-open tool block at the very end (model mid-write) → show it as pending now
  text = text.replace(/```tool[ \t]*\r?\n([\s\S]*)$/, (full, body) => {
    if (body.indexOf('```') !== -1) return full;
    const call = parseCall(body.trim());
    if (!call || !call.tool) return full;
    return '```toolcall\n' + b64encode(JSON.stringify({ call, result: null })) + '\n```';
  });
  return text;
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
