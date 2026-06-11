import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import CodeBlock from './CodeBlock.jsx';
import { Wrench, FileText, Trash, Folder, Download, Check, Search } from './icons.jsx';

const VERBS = {
  create_file: ['Creating', 'Created'],
  str_replace: ['Editing', 'Edited'],
  view: ['Reading', 'Read'],
  list_files: ['Listing files', 'Listed files'],
  delete_file: ['Deleting', 'Deleted'],
  rename_file: ['Moving', 'Moved'],
  search: ['Searching', 'Searched'],
  extract_zip: ['Extracting', 'Extracted'],
  bundle_zip: ['Bundling', 'Bundled']
};
function toolName(c) {
  if (c.tool === 'bundle_zip') return (c.name || 'bundle') + '.zip';
  if (c.tool === 'rename_file') return c.path && (c.new_path || c.to) ? `${c.path} → ${c.new_path || c.to}` : (c.path || '');
  if (c.tool === 'search') return c.query ? `"${c.query}"` : '';
  return c.path || '';
}
function ToolChip({ call, pending }) {
  const v = VERBS[call.tool];
  const verb = v ? v[pending ? 0 : 1] : (call.tool || 'Working');
  const name = toolName(call);
  const Icon = call.tool === 'delete_file' ? Trash : call.tool === 'list_files' ? Folder : (call.tool === 'bundle_zip' || call.tool === 'extract_zip') ? Download : call.tool === 'search' ? Search : call.tool === 'view' ? FileText : Wrench;
  return (
    <span className={'tool-chip' + (pending ? ' pending' : '')}>
      <Icon style={{ width: 14 }} /><span className="tc-verb">{verb}</span>{name && <span className="tc-name">{name}</span>}
      {pending && <span className="tc-dots"><i /><i /><i /></span>}
    </span>
  );
}

function Markdown({ children, streaming }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      components={{
        pre({ children }) {
          const el = Array.isArray(children) ? children[0] : children;
          const props = el?.props || {};
          const m = /language-(\w+)/.exec(props.className || '');
          const text = String(props.children || '').replace(/\n$/, '');
          if (m && m[1].toLowerCase() === 'tool') {
            try { return <ToolChip call={JSON.parse(text)} />; }
            catch {
              const tool = (text.match(/"tool"\s*:\s*"([^"]+)"/) || [])[1];
              const path = (text.match(/"path"\s*:\s*"([^"]*)"/) || [])[1];
              const name = (text.match(/"name"\s*:\s*"([^"]*)"/) || [])[1];
              const query = (text.match(/"query"\s*:\s*"([^"]*)"/) || [])[1];
              const new_path = (text.match(/"new_path"\s*:\s*"([^"]*)"/) || [])[1];
              return <ToolChip pending={!!streaming} call={{ tool, path, name, query, new_path }} />;
            }
          }
          return <CodeBlock lang={m ? m[1] : ''} code={text} />;
        },
        code({ className, children }) {
          return <code className={className}>{children}</code>;
        }
      }}
    >{children}</ReactMarkdown>
  );
}

export default React.memo(Markdown);
