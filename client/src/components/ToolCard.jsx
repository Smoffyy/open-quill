import React, { useMemo, useState } from 'react';
import hljs from 'highlight.js';
import { copyText } from '../clipboard.js';
import { Wrench, FileText, Trash, Folder, Download, Search, Copy, Check, Terminal, Pencil, Plus, Chevron } from './icons.jsx';

const VERBS = {
  bash: ['Running', 'Ran'],
  run: ['Running', 'Ran'],
  create_file: ['Creating', 'Created'],
  str_replace: ['Editing', 'Edited'],
  view: ['Reading', 'Read'],
  list_files: ['Listing files', 'Listed files'],
  delete_file: ['Deleting', 'Deleted'],
  clear_sandbox: ['Clearing sandbox', 'Cleared sandbox'],
  delete_all: ['Clearing sandbox', 'Cleared sandbox'],
  rename_file: ['Moving', 'Moved'],
  move_file: ['Moving', 'Moved'],
  copy_file: ['Copying', 'Copied'],
  make_dir: ['Creating folder', 'Created folder'],
  mkdir: ['Creating folder', 'Created folder'],
  search: ['Searching', 'Searched'],
  web_search: ['Searching the web', 'Searched the web'],
  extract_zip: ['Extracting', 'Extracted'],
  bundle_zip: ['Bundling', 'Bundled'],
  mb_view: ['Reading', 'Read'],
  mb_search: ['Searching memory', 'Searched memory']
};
const FILE_TOOLS = new Set(['create_file', 'str_replace', 'delete_file', 'rename_file', 'move_file', 'copy_file', 'make_dir', 'mkdir']);

function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function stripAnsi(s) { return String(s || '').replace(/\u001b\[[0-9;]*m/g, ''); }
function baseName(p) { return (p || '').split('/').pop(); }

function openPathFor(call) {
  if (!call) return null;
  if (call.tool === 'create_file' || call.tool === 'str_replace' || call.tool === 'view') return call.path || null;
  if (call.tool === 'rename_file' || call.tool === 'move_file' || call.tool === 'copy_file') return call.new_path || call.path || null;
  return null;
}
function openArtifact(path) {
  if (!path) return;
  try { window.dispatchEvent(new CustomEvent('oq-open-file', { detail: { path } })); } catch {}
}

function iconFor(tool) {
  if (tool === 'bash' || tool === 'run') return Terminal;
  if (tool === 'delete_file' || tool === 'clear_sandbox' || tool === 'delete_all') return Trash;
  if (tool === 'list_files') return Folder;
  if (tool === 'make_dir' || tool === 'mkdir') return Folder;
  if (tool === 'bundle_zip' || tool === 'extract_zip') return Download;
  if (tool === 'search') return Search;
  if (tool === 'mb_search') return Search;
  if (tool === 'view') return FileText;
  if (tool === 'mb_view') return FileText;
  if (tool === 'create_file') return Plus;
  if (tool === 'copy_file') return Copy;
  if (tool === 'str_replace' || tool === 'rename_file' || tool === 'move_file') return Pencil;
  return Wrench;
}
function targetName(call) {
  if (!call) return '';
  if (call.tool === 'bundle_zip') return (call.name || 'bundle') + '.zip';
  if (call.tool === 'rename_file' || call.tool === 'move_file' || call.tool === 'copy_file') return call.path && call.new_path ? `${baseName(call.path)} → ${baseName(call.new_path)}` : baseName(call.path);
  if (call.tool === 'search' || call.tool === 'mb_search') return call.query ? `"${call.query}"` : '';
  if (call.tool === 'list_files' || call.tool === 'clear_sandbox' || call.tool === 'delete_all') return '';
  return baseName(call.path) || '';
}
function resultNote(call, res) {
  if (!res || !res.ok) return null;
  switch (call.tool) {
    case 'view': return res.lines ? `${res.lines} lines` : null;
    case 'list_files': return res.files ? `${res.files.length} file${res.files.length === 1 ? '' : 's'}` : null;
    case 'search': return res.count != null ? `${res.count} match${res.count === 1 ? '' : 'es'}` : null;
    case 'mb_search': return res.count != null ? `${res.count} match${res.count === 1 ? '' : 'es'}` : null;
    case 'mb_view': return res.total != null ? `${res.total} lines` : null;
    case 'extract_zip': return res.files ? `${res.files.length} file${res.files.length === 1 ? '' : 's'}` : null;
    case 'bundle_zip': return res.count != null ? `${res.count} file${res.count === 1 ? '' : 's'}` : null;
    case 'clear_sandbox': case 'delete_all': return res.cleared != null ? `${res.cleared} removed` : null;
    default: return null;
  }
}

function BashCard({ call, result }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const cmd = call?.cmd || '';
  const html = useMemo(() => {
    try { return hljs.highlight(cmd, { language: 'bash', ignoreIllegals: true }).value; }
    catch { return escapeHtml(cmd); }
  }, [cmd]);
  const out = result ? stripAnsi(result.output) : '';
  const failed = result && !result.ok;
  const oneLine = cmd.split('\n')[0];
  async function copy(e) { e.stopPropagation(); if (await copyText(cmd)) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }
  return (
    <div className={'tool-bash' + (failed ? ' err' : '') + (open ? ' open' : '')}>
      <button className="tb-head" onClick={() => setOpen(o => !o)}>
        <Terminal style={{ width: 14 }} />
        <span className="tb-label">{result ? 'Terminal' : 'Running'}</span>
        <code className="tb-peek">{oneLine}</code>
        {failed && <span className="tb-badge err">{result.exit != null ? `exit ${result.exit}` : 'error'}</span>}
        {!result && <span className="tc-dots"><i /><i /><i /></span>}
        <Chevron className="tb-chev" />
      </button>
      <div className={'tb-collapse' + (open ? ' open' : '')}>
        <div className="tb-inner">
          <div className="tb-cmdrow">
            <pre className="tb-cmd"><span className="tb-prompt">$</span> <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
            <button className="tb-copy" onClick={copy}>{copied ? <Check style={{ width: 13 }} /> : <Copy style={{ width: 13 }} />}</button>
          </div>
          {result && (
            <div className="tb-out">
              <div className="tb-out-head">{failed ? (result.error || 'Error') : 'Output'}{result.exit != null && result.exit !== 0 ? ` · exit ${result.exit}` : ''}</div>
              {out ? <pre className="tb-out-body">{out}</pre> : <div className="tb-out-empty">No output</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FileCard({ call, result }) {
  const v = VERBS[call.tool] || [call.tool, call.tool];
  const pending = !result;
  const verb = v[pending ? 0 : 1];
  const Icon = iconFor(call.tool);
  const name = targetName(call);
  const failed = result && !result.ok;
  const adds = result?.adds, dels = result?.dels;
  const showDiff = result && result.ok && (adds || dels) && (call.tool === 'create_file' || call.tool === 'str_replace');
  const openPath = (!failed && call.tool !== 'delete_file') ? openPathFor(call) : null;
  return (
    <span className={'tool-line' + (pending ? ' pending' : '') + (failed ? ' err' : '') + (openPath ? ' clickable' : '')}
      onClick={openPath ? () => openArtifact(openPath) : undefined}
      title={openPath ? 'Open ' + name + ' in artifacts' : undefined}>
      <Icon style={{ width: 14 }} className="tl-icon" />
      <span className="tl-verb">{verb}</span>
      {name && <span className="tl-name">{name}</span>}
      {showDiff && (
        <span className="tl-diff">
          {adds ? <span className="add">+{adds}</span> : null}
          {dels ? <span className="del">−{dels}</span> : null}
        </span>
      )}
      {failed && <span className="tl-err">{result.error}</span>}
      {pending && <span className="tc-dots"><i /><i /><i /></span>}
    </span>
  );
}

function ChipCard({ call, result }) {
  const v = VERBS[call.tool] || [call.tool || 'Working', call.tool || 'Done'];
  const pending = !result;
  const verb = v[pending ? 0 : 1];
  const Icon = iconFor(call.tool);
  const name = targetName(call);
  const failed = result && !result.ok;
  const note = resultNote(call, result);
  const openPath = !failed && call.tool === 'view' ? openPathFor(call) : null;
  return (
    <span className={'tool-line' + (pending ? ' pending' : '') + (failed ? ' err' : '') + (openPath ? ' clickable' : '')}
      onClick={openPath ? () => openArtifact(openPath) : undefined}
      title={openPath ? 'Open ' + name + ' in artifacts' : undefined}>
      <Icon style={{ width: 14 }} className="tl-icon" /><span className="tl-verb">{verb}</span>{name && <span className="tl-name">{name}</span>}
      {note && <span className="tl-note">{note}</span>}
      {failed && <span className="tl-err">{result.error}</span>}
      {pending && <span className="tc-dots"><i /><i /><i /></span>}
    </span>
  );
}

function WebSearchCard({ call, result }) {
  const [open, setOpen] = useState(false);
  const pending = !result;
  const failed = result && !result.ok;
  const results = (result && result.results) || [];
  return (
    <div className={'tool-bash' + (failed ? ' err' : '') + (open ? ' open' : '')}>
      <button className="tb-head" onClick={() => setOpen(o => !o)}>
        <Search style={{ width: 14 }} />
        <span className="tb-label">{pending ? 'Searching the web' : 'Web search'}</span>
        <code className="tb-peek">{call.query ? `"${call.query}"` : ''}</code>
        {!failed && result && <span className="tl-note">{result.count} result{result.count === 1 ? '' : 's'}</span>}
        {failed && <span className="tb-badge err">error</span>}
        {pending && <span className="tc-dots"><i /><i /><i /></span>}
        <Chevron className="tb-chev" />
      </button>
      <div className={'tb-collapse' + (open ? ' open' : '')}>
        <div className="tb-inner">
          {failed
            ? <div className="tb-out"><div className="tb-out-head">Error</div><div className="tb-out-empty">{result.error}</div></div>
            : results.length
              ? <div className="ws-results">{results.map((r, i) => (
                  <a key={i} className="ws-result" href={r.url} target="_blank" rel="noopener noreferrer">
                    <span className="ws-title">{r.title || r.url}</span>
                    <span className="ws-url">{r.url}</span>
                    {r.chars != null && <span className="ws-chars">{r.chars.toLocaleString()} chars read</span>}
                  </a>
                ))}</div>
              : <div className="tb-out-empty" style={{ padding: '8px 12px' }}>No results.</div>}
        </div>
      </div>
    </div>
  );
}

function ToolCard({ call, result }) {
  if (!call || !call.tool) return null;
  if (call.tool === 'web_search') return <WebSearchCard call={call} result={result} />;
  if (call.tool === 'bash' || call.tool === 'run') return <BashCard call={call} result={result} />;
  if (FILE_TOOLS.has(call.tool)) return <FileCard call={call} result={result} />;
  return <ChipCard call={call} result={result} />;
}
export default React.memo(ToolCard, (a, b) =>
  JSON.stringify(a.call) === JSON.stringify(b.call) && JSON.stringify(a.result) === JSON.stringify(b.result));
