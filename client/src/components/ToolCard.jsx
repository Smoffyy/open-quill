import React, { useMemo, useState } from 'react';
import { highlight } from '../lib/hljs.js';
import { copyText } from '../clipboard.js';
import { Wrench, FileText, Trash, Folder, Download, Search, Copy, Check, Terminal, Pencil, Plus, Chevron } from './icons.jsx';
import { baseName, dirOf } from '../lib/files.js';
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
function countLines(s) { return s ? s.split('\n').length : 0; }
function plural(n, one, many) { return t(n === 1 ? one : many, { n }); }

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

// A path is shown whole, with the directory dimmed and the name at full weight.
// Two files called __init__.py are otherwise the same line twice, and the folder
// a step touched is exactly the context that made these lines hard to trust.
function PathBits({ path }) {
  const dir = dirOf(path), base = baseName(path);
  return (
    <span className="tl-path">
      {dir && <span className="tl-dir">{dir}/</span>}
      <span className="tl-base">{base}</span>
    </span>
  );
}

// What this step is acting on, as a shape the row can render rather than a
// pre-joined string, so paths keep their dim/strong split wherever they appear.
function targetOf(call) {
  if (!call) return null;
  const q = (s) => (s ? { kind: 'text', text: `"${s}"` } : null);
  switch (call.tool) {
    case 'bundle_zip': return { kind: 'text', text: (call.name || 'bundle') + '.zip' };
    case 'rename_file': case 'move_file': case 'copy_file':
      return call.path && call.new_path
        ? { kind: 'move', from: call.path, to: call.new_path }
        : (call.path || call.new_path ? { kind: 'path', path: call.path || call.new_path } : null);
    case 'search': case 'mb_search': case 'chat_search': return q(call.query);
    case 'find': return q(call.pattern || call.query);
    case 'skill_view': return call.name ? { kind: 'text', text: call.name } : null;
    case 'list_files': return call.path ? { kind: 'path', path: call.path } : { kind: 'text', text: t('the workspace') };
    case 'clear_sandbox': case 'delete_all': return null;
    default:
      if (call.path) return { kind: 'path', path: call.path };
      // Still streaming: show the characters that have arrived rather than nothing.
      return call.partialPath ? { kind: 'path', path: call.partialPath } : null;
  }
}

function Target({ target }) {
  if (!target) return null;
  if (target.kind === 'move') {
    return (
      <span className="tl-name">
        <PathBits path={target.from} />
        <span className="tl-arrow">→</span>
        <PathBits path={target.to} />
      </span>
    );
  }
  if (target.kind === 'path') return <span className="tl-name"><PathBits path={target.path} /></span>;
  return <span className="tl-name">{target.text}</span>;
}

function resultNote(call, res) {
  if (!res || !res.ok) return null;
  switch (call.tool) {
    case 'view': return res.lines ? plural(res.lines, '{n} line', '{n} lines') : null;
    case 'list_files': return res.files ? plural(res.files.length, '{n} file', '{n} files') : null;
    case 'find': return res.count != null ? plural(res.count, '{n} file', '{n} files') : null;
    case 'search': return res.count != null ? plural(res.count, '{n} match', '{n} matches') : null;
    case 'mb_search': return res.count != null ? plural(res.count, '{n} match', '{n} matches') : null;
    case 'mb_view': return res.total != null ? plural(res.total, '{n} line', '{n} lines') : null;
    case 'chat_search': return res.count != null ? plural(res.count, '{n} match', '{n} matches') : null;
    case 'chat_view': return res.title ? `"${res.title}"` : null;
    case 'skill_view': return res.name ? res.name : null;
    case 'extract_zip': return res.files ? plural(res.files.length, '{n} file', '{n} files') : null;
    case 'bundle_zip': return res.count != null ? plural(res.count, '{n} file', '{n} files') : null;
    case 'clear_sandbox': case 'delete_all': return res.cleared != null ? t('{n} removed', { n: res.cleared }) : null;
    default: return null;
  }
}

function BashCard({ call, result }) {
  // Tri-state: null means "the user has not decided", which lets a failure open
  // itself without also overriding a later manual collapse.
  const [open, setOpen] = useState(null);
  const [copied, setCopied] = useState(false);
  const cmd = call?.cmd || '';
  const html = useMemo(() => highlight(cmd, 'bash', { auto: false }), [cmd]);
  const out = result ? stripAnsi(result.output) : '';
  const failed = result && !result.ok;
  const isOpen = open == null ? !!failed : open;
  const oneLine = cmd.split('\n')[0];
  const lines = countLines(out.replace(/\n$/, ''));
  // The shell's directory persists between calls, so it is worth showing — but
  // only once it has actually moved. "cwd: ." on every row is noise.
  const rawCwd = result && result.cwd ? String(result.cwd) : '';
  const cwd = rawCwd && rawCwd !== '.' ? rawCwd : null;
  async function copy(e) { e.stopPropagation(); if (await copyText(cmd)) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }
  return (
    <div className={'tool-bash' + (result ? '' : ' pending') + (failed ? ' err' : '') + (isOpen ? ' open' : '')}>
      <button className="tb-head" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
        <Terminal style={{ width: 14 }} />
        <span className="tb-label">{result ? t('Terminal') : t('Running')}</span>
        <code className="tb-peek">{oneLine}</code>
        {cwd && cwd !== '.' && <span className="tb-cwd" title={t('Working directory')}>{cwd}</span>}
        {result && !failed && lines > 0 && <span className="tl-note">{plural(lines, '{n} line', '{n} lines')}</span>}
        {result && !failed && lines === 0 && <span className="tl-note">{t('no output')}</span>}
        {failed && <span className="tb-badge err">{result.exit != null ? t('exit {code}', { code: result.exit }) : t('error')}</span>}
        {!result && <span className="tc-dots"><i /><i /><i /></span>}
        <Chevron className="tb-chev" />
      </button>
      <div className={'tb-collapse' + (isOpen ? ' open' : '')}>
        <div className="tb-inner">
          <div className="tb-cmdrow">
            <pre className="tb-cmd"><span className="tb-prompt">$</span> <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
            <button className="tb-copy" onClick={copy} title={copied ? t('Copied') : t('Copy')}>{copied ? <Check style={{ width: 13 }} /> : <Copy style={{ width: 13 }} />}</button>
          </div>
          {result && (
            <div className="tb-out">
              <div className="tb-out-head">
                <span>{failed ? (result.error || t('Error')) : t('Output')}</span>
                {result.exit != null && <span className={'tb-exit' + (result.exit ? ' err' : '')}>{t('exit {code}', { code: result.exit })}</span>}
                {cwd && <span className="tb-exit">{t('cwd')}: {cwd || '.'}</span>}
              </div>
              {out ? <pre className="tb-out-body">{out}</pre> : <div className="tb-out-empty">{t("No output")}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Streaming arguments arrive a character at a time, so for a moment there is a
// verb and nothing else. A placeholder bar holds the space the name will take
// instead of rendering a bare "Creating", which read as a bug rather than as a
// step still being spelled out.
function NamePending() { return <span className="tl-skel" aria-label={t('reading arguments')} />; }

function ToolLine({ call, result, note, diff }) {
  const v = verbsFor(call.tool) || [call.tool, call.tool];
  const pending = !result;
  const verb = v[pending ? 0 : 1];
  const Icon = iconFor(call.tool);
  const target = targetOf(call);
  const failed = result && !result.ok;
  const openPath = (!failed && call.tool !== 'delete_file') ? openPathFor(call) : null;
  const full = target && target.kind === 'path' ? target.path : target && target.kind === 'move' ? target.to : null;
  return (
    <span className={'tool-line' + (pending ? ' pending' : '') + (failed ? ' err' : '') + (openPath ? ' clickable' : '')}
      onClick={openPath ? () => openArtifact(openPath) : undefined}
      role={openPath ? 'button' : undefined}
      tabIndex={openPath ? 0 : undefined}
      onKeyDown={openPath ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openArtifact(openPath); } } : undefined}
      title={full || (target && target.text) || undefined}>
      <Icon style={{ width: 20 }} className="tl-icon" />
      <span className="tl-verb">{verb}</span>
      {target ? <Target target={target} /> : pending ? <NamePending /> : null}
      {diff}
      {note && <span className="tl-note">{note}</span>}
      {failed && <span className="tl-err">{result.error}</span>}
    </span>
  );
}

function FileCard({ call, result }) {
  const adds = result?.adds, dels = result?.dels;
  const unchanged = result && result.ok && result.unchanged;
  const showDiff = result && result.ok && (adds || dels) && (call.tool === 'create_file' || call.tool === 'str_replace');
  const diff = showDiff ? (
    <span className="tl-diff">
      {adds ? <span className="add">+{adds}</span> : null}
      {dels ? <span className="del">−{dels}</span> : null}
    </span>
  ) : null;
  return <ToolLine call={call} result={result} diff={diff} note={unchanged ? t('unchanged') : null} />;
}

function ChipCard({ call, result }) {
  return <ToolLine call={call} result={result} note={resultNote(call, result)} />;
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
    <div className={'tool-bash ws' + (pending ? ' pending' : '') + (failed ? ' err' : '') + (open ? ' open' : '')}>
      <button className="tb-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Search style={{ width: 14 }} />
        <span className="tb-label">{pending ? t('Searching the web') : t('Web search')}</span>
        <code className="tb-peek">{call.query ? `"${call.query}"` : ''}</code>
        {!failed && result && <span className="tl-note">{plural(result.count, '{n} result', '{n} results')}</span>}
        {failed && <span className="tb-badge err">{t('error')}</span>}
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
                          {r.chars != null && <span className="ws-chars">{t('{n} chars read', { n: r.chars.toLocaleString() })}</span>}
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
