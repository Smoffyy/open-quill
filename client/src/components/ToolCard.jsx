import React, { useMemo, useState } from 'react';
import { highlight } from '../lib/hljs.js';
import { copyText } from '../clipboard.js';
import { Wrench, FileText, Trash, Folder, Download, Search, Copy, Check, Terminal, Pencil, Plus, Chevron } from './icons.jsx';
import { t, tk } from '../i18n.jsx';

const VERBS = {
  bash: [tk('Running'), tk('Ran')],
  run: [tk('Running'), tk('Ran')],
  create_file: [tk('Creating'), tk('Created')],
  str_replace: [tk('Editing'), tk('Edited')],
  view: [tk('Reading'), tk('Read')],
  list_files: [tk('Listing files'), tk('Listed files')],
  delete_file: [tk('Deleting'), tk('Deleted')],
  clear_sandbox: [tk('Clearing sandbox'), tk('Cleared sandbox')],
  delete_all: [tk('Clearing sandbox'), tk('Cleared sandbox')],
  rename_file: [tk('Moving'), tk('Moved')],
  move_file: [tk('Moving'), tk('Moved')],
  copy_file: [tk('Copying'), tk('Copied')],
  make_dir: [tk('Creating folder'), tk('Created folder')],
  mkdir: [tk('Creating folder'), tk('Created folder')],
  search: [tk('Searching'), tk('Searched')],
  find: [tk('Finding files'), tk('Found files')],
  web_search: [tk('Searching the web'), tk('Searched the web')],
  extract_zip: [tk('Extracting'), tk('Extracted')],
  bundle_zip: [tk('Bundling'), tk('Bundled')],
  mb_view: [tk('Reading'), tk('Read')],
  mb_search: [tk('Searching memory'), tk('Searched memory')],
  chat_search: [tk('Searching past chats'), tk('Searched past chats')],
  chat_view: [tk('Reading a past chat'), tk('Read a past chat')],
  skill_view: [tk('Loading skill'), tk('Loaded skill')],
  end_conversation: [tk('Ending the conversation'), tk('Ended the conversation')]
};
function verbsFor(tool) {
  if (VERBS[tool]) return VERBS[tool].map(v => t(v));
  if (String(tool || '').startsWith('mcp_')) {
    const short = String(tool).split('_').slice(2).join(' ') || t('connector');
    return [t('Using {name}', { name: short }), t('Used {name}', { name: short })];
  }
  return null;
}
const FILE_TOOLS = new Set(['create_file', 'str_replace', 'delete_file', 'rename_file', 'move_file', 'copy_file', 'make_dir', 'mkdir']);

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
  if (tool === 'find') return Search;
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
  if (call.tool === 'search' || call.tool === 'mb_search' || call.tool === 'chat_search') return call.query ? `"${call.query}"` : '';
  if (call.tool === 'find') return call.pattern ? `"${call.pattern}"` : (call.query ? `"${call.query}"` : '');
  if (call.tool === 'skill_view') return call.name || '';
  if (call.tool === 'list_files' || call.tool === 'clear_sandbox' || call.tool === 'delete_all') return '';
  return baseName(call.path) || '';
}
function resultNote(call, res) {
  if (!res || !res.ok) return null;
  switch (call.tool) {
    case 'view': return res.lines ? `${res.lines} lines` : null;
    case 'list_files': return res.files ? `${res.files.length} file${res.files.length === 1 ? '' : 's'}` : null;
    case 'find': return res.count != null ? `${res.count} file${res.count === 1 ? '' : 's'}` : null;
    case 'search': return res.count != null ? `${res.count} match${res.count === 1 ? '' : 'es'}` : null;
    case 'mb_search': return res.count != null ? `${res.count} match${res.count === 1 ? '' : 'es'}` : null;
    case 'mb_view': return res.total != null ? `${res.total} lines` : null;
    case 'chat_search': return res.count != null ? `${res.count} match${res.count === 1 ? '' : 'es'}` : null;
    case 'chat_view': return res.title ? `"${res.title}"` : null;
    case 'skill_view': return res.name ? res.name : null;
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
  const html = useMemo(() => highlight(cmd, 'bash', { auto: false }), [cmd]);
  const out = result ? stripAnsi(result.output) : '';
  const failed = result && !result.ok;
  const oneLine = cmd.split('\n')[0];
  async function copy(e) { e.stopPropagation(); if (await copyText(cmd)) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }
  return (
    <div className={'tool-bash' + (failed ? ' err' : '') + (open ? ' open' : '')}>
      <button className="tb-head" onClick={() => setOpen(o => !o)}>
        <Terminal style={{ width: 14 }} />
        <span className="tb-label">{result ? t('Terminal') : t('Running')}</span>
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
              {out ? <pre className="tb-out-body">{out}</pre> : <div className="tb-out-empty">{t("No output")}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function chatIdFromUrl() {
  const m = window.location.pathname.match(/\/chat\/([a-zA-Z0-9-]+)/);
  return m ? m[1] : null;
}

function FileCard({ call, result }) {
  const v = verbsFor(call.tool) || [call.tool, call.tool];
  const pending = !result;
  const verb = v[pending ? 0 : 1];
  const Icon = iconFor(call.tool);
  const name = targetName(call);
  const failed = result && !result.ok;
  const adds = result?.adds, dels = result?.dels;
  const unchanged = result && result.ok && result.unchanged;
  const showDiff = result && result.ok && (adds || dels) && (call.tool === 'create_file' || call.tool === 'str_replace');
  const openPath = (!failed && call.tool !== 'delete_file') ? openPathFor(call) : null;
  const [preview, setPreview] = React.useState(null);
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const canPeek = !!openPath && result && result.ok && (call.tool === 'create_file' || call.tool === 'str_replace' || call.tool === 'view') && chatIdFromUrl();
  async function togglePeek(e) {
    e.stopPropagation();
    if (preview != null) { setPreview(null); return; }
    if (previewBusy) return;
    setPreviewBusy(true);
    try {
      const cid = chatIdFromUrl();
      const r = await fetch(`/api/chats/${cid}/file?path=${encodeURIComponent(openPath)}`, { credentials: 'include' });
      const d = await r.json();
      if (d && typeof d.text === 'string') {
        const t = d.text.length > 6000 ? d.text.slice(0, 6000) + '\n\u2026 (truncated \u2014 open in artifacts for the full file)' : d.text;
        setPreview(t || '(empty file)');
      } else setPreview(d && d.binary ? '(binary file \u2014 open in artifacts to download)' : '(could not load preview)');
    } catch { setPreview('(could not load preview)'); }
    setPreviewBusy(false);
  }
  return (
    <>
    <span className={'tool-line' + (pending ? ' pending' : '') + (failed ? ' err' : '') + (openPath ? ' clickable' : '')}
      onClick={openPath ? () => openArtifact(openPath) : undefined}
      title={openPath ? 'Open ' + name + ' in artifacts' : undefined}>
      <Icon style={{ width: 20 }} className="tl-icon" />
      <span className="tl-verb">{verb}</span>
      {name && <span className="tl-name">{name}</span>}
      {showDiff && (
        <span className="tl-diff">
          {adds ? <span className="add">+{adds}</span> : null}
          {dels ? <span className="del">−{dels}</span> : null}
        </span>
      )}
      {unchanged && <span className="tl-note">unchanged</span>}
      {failed && <span className="tl-err">{result.error}</span>}
      {canPeek && <button className="tc-preview-btn" onClick={togglePeek}>{previewBusy ? '\u2026' : preview != null ? t('Hide') : t('Peek')}</button>}
    </span>
    {preview != null && <div className="tc-preview">{preview}</div>}
    </>
  );
}

function ChipCard({ call, result }) {
  const v = verbsFor(call.tool) || [call.tool || 'Working', call.tool || 'Done'];
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
      <Icon style={{ width: 20 }} className="tl-icon" /><span className="tl-verb">{verb}</span>{name && <span className="tl-name">{name}</span>}
      {note && <span className="tl-note">{note}</span>}
      {failed && <span className="tl-err">{result.error}</span>}
    </span>
  );
}

function hostOf(url) {
  const raw = String(url || '');
  try { return new URL(raw).hostname.replace(/^www\./, ''); }
  catch { return raw.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0]; }
}

function WebSearchCard({ call, result }) {
  const [open, setOpen] = useState(false);
  const pending = !result;
  const failed = result && !result.ok;
  const results = (result && result.results) || [];
  return (
    <div className={'tool-bash ws' + (failed ? ' err' : '') + (open ? ' open' : '')}>
      <button className="tb-head" onClick={() => setOpen(o => !o)}>
        <Search style={{ width: 14 }} />
        <span className="tb-label">{pending ? t('Searching the web') : t('Web search')}</span>
        <code className="tb-peek">{call.query ? `"${call.query}"` : ''}</code>
        {!failed && result && <span className="tl-note">{result.count} result{result.count === 1 ? '' : 's'}</span>}
        {failed && <span className="tb-badge err">error</span>}
        {pending && <span className="tc-dots"><i /><i /><i /></span>}
        <Chevron className="tb-chev" />
      </button>
      <div className={'tb-collapse' + (open ? ' open' : '')}>
        <div className="tb-inner">
          {failed
            ? <div className="tb-out"><div className="tb-out-head">{t("Error")}</div><div className="tb-out-empty">{result.error}</div></div>
            : results.length
              ? <div className="ws-results">{results.map((r, i) => {
                  const host = hostOf(r.url);
                  return (
                    <a key={i} className="ws-result" href={r.url} target="_blank" rel="noopener noreferrer" title={[r.title, r.url].filter(Boolean).join('\n')}>
                      <span className="ws-num">{i + 1}</span>
                      <span className="ws-body">
                        <span className="ws-title">{r.title || host || r.url}</span>
                        <span className="ws-meta">
                          <span className="ws-host">{host}</span>
                          {r.chars != null && <span className="ws-chars">{r.chars.toLocaleString()} chars read</span>}
                        </span>
                      </span>
                    </a>
                  );
                })}</div>
              : <div className="tb-out-empty" style={{ padding: '8px 12px' }}>{t("No results.")}</div>}
        </div>
      </div>
    </div>
  );
}

const TOOL_ALIAS = { run: 'bash', shell: 'bash', write_file: 'create_file', edit_file: 'str_replace', insert_lines: 'str_replace', read_file: 'view', cat: 'view', ls: 'list_files', tree: 'list_files', glob: 'find', grep: 'search', mv: 'move_file', cp: 'copy_file', rm: 'delete_file', mkdir: 'make_dir', unzip: 'extract_zip', zip: 'bundle_zip', reset: 'clear_sandbox' };

function ToolCard({ call, result }) {
  if (!call || !call.tool) return null;
  const c = TOOL_ALIAS[call.tool] ? { ...call, tool: TOOL_ALIAS[call.tool] } : call;
  if (c.tool === 'web_search') return <WebSearchCard call={c} result={result} />;
  if (c.tool === 'bash') return <BashCard call={c} result={result} />;
  if (FILE_TOOLS.has(c.tool)) return <FileCard call={c} result={result} />;
  return <ChipCard call={c} result={result} />;
}
export default React.memo(ToolCard, (a, b) =>
  JSON.stringify(a.call) === JSON.stringify(b.call) && JSON.stringify(a.result) === JSON.stringify(b.result));
