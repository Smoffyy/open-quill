import React, { useEffect, useMemo, useState } from 'react';
import Markdown, { ReasonSegs } from '../chat/Markdown.jsx';
import ReasoningBlock from '../chat/ReasoningBlock.jsx';
import Weave, { ModelMark } from '../ui/Weave.jsx';
import { useStatusLabel } from '../../lib/status.js';
import { Chevron, Copy, Check, Retry, FileText, CodeTag, Paper } from '../ui/icons.jsx';
import { api } from '../../lib/api.js';
import { copyText } from '../../lib/clipboard.js';
import { highlight } from '../../lib/hljs.js';
import { diffLines, stableLineDiff, collapseRuns, baseName, extOf } from '../../lib/artifacts.js';
import { splitTurn, withLive, groupCounts, fileChanges, totals, stepTarget } from '../../lib/codeview.js';
import { t, tk, fmtRelative } from '../../i18n.jsx';
import { safeUrl } from '../../lib/safeurl.js';

const VERBS = {
  __proto__: null,
  bash: [tk('Running'), tk('Ran')],
  create_file: [tk('Creating'), tk('Created')],
  str_replace: [tk('Editing'), tk('Edited')],
  insert_lines: [tk('Editing'), tk('Edited')],
  view: [tk('Reading'), tk('Read')],
  list_files: [tk('Listing files'), tk('Listed files')],
  find: [tk('Finding files'), tk('Found files')],
  search: [tk('Searching'), tk('Searched')],
  delete_file: [tk('Deleting'), tk('Deleted')],
  clear_sandbox: [tk('Clearing sandbox'), tk('Cleared sandbox')],
  move_file: [tk('Moving'), tk('Moved')],
  copy_file: [tk('Copying'), tk('Copied')],
  make_dir: [tk('Creating folder'), tk('Created folder')],
  extract_zip: [tk('Extracting'), tk('Extracted')],
  bundle_zip: [tk('Bundling'), tk('Bundled')],
  web_search: [tk('Searching the web'), tk('Searched the web')],
  todo: [tk('Updating the plan'), tk('Updated the plan')],
  ask_user: [tk('Asking you'), tk('Asked you')]
};

const PHRASES = {
  __proto__: null,
  command: [tk('ran a command'), tk('ran {n} commands')],
  create: [tk('created a file'), tk('created {n} files')],
  edit: [tk('edited a file'), tk('edited {n} files')],
  read: [tk('read a file'), tk('read {n} files')],
  search: [tk('searched the workspace'), tk('searched {n} times')],
  delete: [tk('deleted a file'), tk('deleted {n} files')],
  move: [tk('moved a file'), tk('moved {n} files')],
  zip: [tk('handled an archive'), tk('handled {n} archives')],
  web: [tk('searched the web'), tk('searched the web {n} times')],
  todo: [tk('updated the plan'), tk('updated the plan {n} times')],
  ask: [tk('asked you a question'), tk('asked you {n} questions')],
  tool: [tk('used a tool'), tk('used {n} tools')]
};

const CODE_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'php', 'swift', 'sh', 'bash', 'html', 'htm', 'css', 'scss', 'json', 'yml', 'yaml', 'toml', 'sql', 'lua', 'vue', 'xml', 'svg']);
const FILE_TOOLS = new Set(['create_file', 'str_replace', 'insert_lines', 'view', 'move_file', 'copy_file']);

function verbOf(call, done) {
  const v = VERBS[call.tool];
  if (v) return t(v[done ? 1 : 0]);
  const name = String(call.tool || '').replace(/^mcp_[^_]+_/, '').replace(/_/g, ' ');
  return done ? t('Used {name}', { name }) : t('Using {name}', { name });
}

function summaryOf(items) {
  const { list, failed } = groupCounts(items);
  const text = list.map(({ kind, n }) => t(PHRASES[kind][n === 1 ? 0 : 1], { n })).join(', ');
  const head = text.charAt(0).toUpperCase() + text.slice(1);
  return failed ? head + ' ' + t('({n} failed)', { n: failed }) : head;
}

export function CodeMark({ icon, state, className }) {
  return icon ? <ModelMark src={icon} state={state} className={className} /> : <Weave state={state} className={className} />;
}

function FileIcon({ path }) {
  return CODE_EXT.has(extOf(path)) ? <CodeTag /> : <FileText />;
}

function Counts({ adds, dels }) {
  if (!adds && !dels) return null;
  return (
    <span className="cx-counts">
      <span className="add">+{adds || 0}</span>
      <span className="del">-{dels || 0}</span>
    </span>
  );
}

function openPathOf(call) {
  if (call.tool === 'move_file' || call.tool === 'copy_file') return call.new_path || null;
  return FILE_TOOLS.has(call.tool) ? call.path || null : null;
}

function StepTitle({ call, done, onOpenFile }) {
  const target = stepTarget(call);
  const open = done ? openPathOf(call) : null;
  return (
    <span className="cx-step-title">
      <span className="cx-verb">{verbOf(call, done)}</span>
      {target && (call.tool === 'bash'
        ? <code className="cx-target mono">{target}</code>
        : open
          ? <span className="cx-target link" role="link" tabIndex={0} data-tip={target}
              onClick={(e) => { e.stopPropagation(); onOpenFile(open); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenFile(open); } }}>{target}</span>
          : <span className="cx-target" data-tip={target}>{target}</span>)}
    </span>
  );
}

function VersionDiff({ chatId, path, v, created }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let on = true;
    const base = '/api/chats/' + chatId + '/file?path=' + encodeURIComponent(path);
    const before = !created && v > 1 ? api.get(base + '&v=' + (v - 1)) : Promise.resolve({ text: '' });
    Promise.all([api.get(base + (v ? '&v=' + v : '')), before])
      .then(([now, prev]) => {
        if (!on) return;
        if (now.text == null) { setState({ binary: true }); return; }
        const a = String(prev.text ?? '').split('\n');
        const b = String(now.text).split('\n');
        const rows = (prev.text ? diffLines(a, b) : null) || stableLineDiff(prev.text ? a : [], b);
        setState({ rows: collapseRuns(rows, 3) });
      })
      .catch(() => { if (on) setState({ error: true }); });
    return () => { on = false; };
  }, [chatId, path, v, created]);
  if (!state) return <div className="cx-out muted">{t('Loading…')}</div>;
  if (state.error) return <div className="cx-out muted">{t('This version is no longer available.')}</div>;
  if (state.binary) return <div className="cx-out muted">{t('Binary file')}</div>;
  return (
    <div className="cx-diff">
      {state.rows.map((r, i) => r.fold
        ? <div key={r.key || i} className="cx-diff-fold">{t('{n} unchanged lines', { n: r.count })}</div>
        : (
          <div key={r.key || i} className={'cx-diff-line ' + r.type}>
            <span className="cx-diff-sign">{r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' '}</span>
            <span className="cx-diff-text">{r.text || ' '}</span>
          </div>
        ))}
    </div>
  );
}

function BashBody({ call, result }) {
  const html = useMemo(() => highlight(call.cmd || '', 'bash', { auto: false }), [call.cmd]);
  const out = result ? String(result.output || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\n+$/, '') : '';
  return (
    <>
      <pre className="cx-cmd"><span className="cx-prompt">$</span> <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
      {result && (out ? <pre className="cx-out">{out}</pre> : <div className="cx-out muted">{t('No output')}</div>)}
      {result && result.exit != null && result.exit !== 0 && <div className="cx-out err">{t('exit {code}', { code: result.exit })}</div>}
    </>
  );
}

function ListBody({ result }) {
  const rows = (result.matches || result.files || []).slice(0, 60).map(m => (typeof m === 'string' ? m
    : m.path ? (m.line != null ? m.path + ':' + m.line + (m.text ? '  ' + m.text : '') : m.path) : JSON.stringify(m)));
  if (!rows.length) return <div className="cx-out muted">{t('No matches')}</div>;
  return <pre className="cx-out">{rows.join('\n')}</pre>;
}

function hasBody(call, result) {
  if (!result) return call.tool === 'bash' && !!call.cmd;
  if (result.ok === false) return true;
  if (call.tool === 'bash') return true;
  if (call.tool === 'create_file' || call.tool === 'str_replace' || call.tool === 'insert_lines') return !result.unchanged;
  if (call.tool === 'search' || call.tool === 'find' || call.tool === 'list_files') return !!(result.matches || result.files);
  if (call.tool === 'web_search') return !!(result.results && result.results.length);
  return false;
}

function StepBody({ call, result, chatId }) {
  if (call.tool === 'bash') return <BashBody call={call} result={result} />;
  if (result && result.ok === false) return <div className="cx-out err">{result.error || t('Error')}</div>;
  if (call.tool === 'create_file' || call.tool === 'str_replace' || call.tool === 'insert_lines') {
    return <VersionDiff chatId={chatId} path={call.path} v={result.v || 0} created={call.tool === 'create_file' && result.v === 1} />;
  }
  if (call.tool === 'web_search') {
    return (
      <div className="cx-links">
        {result.results.map((r, i) => <a key={i} href={safeUrl(r.url) || undefined} target="_blank" rel="noopener noreferrer">{r.title || r.url}</a>)}
      </div>
    );
  }
  return <ListBody result={result} />;
}

function Step({ item, chatId, onOpenFile }) {
  const { call, result } = item;
  const [open, setOpen] = useState(false);
  const done = !!result;
  const failed = done && result.ok === false;
  const body = hasBody(call, result);
  const counts = done && !failed && (result.adds || result.dels) ? <Counts adds={result.adds} dels={result.dels} /> : null;
  return (
    <div className={'cx-step' + (open ? ' open' : '') + (failed ? ' err' : '') + (done ? '' : ' live')}>
      <div className={'cx-step-head' + (body ? ' toggles' : '')} role={body ? 'button' : undefined} tabIndex={body ? 0 : undefined}
        aria-expanded={body ? open : undefined}
        onClick={body ? () => setOpen(o => !o) : undefined}
        onKeyDown={body ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } } : undefined}>
        <StepTitle call={call} done={done} onOpenFile={onOpenFile} />
        {failed && <span className="cx-fail">{t('Failed')}</span>}
        {body && <Chevron className="cx-chev" />}
        {counts}
        {!done && <span className="cx-spin" aria-hidden="true" />}
      </div>
      {open && body && <div className="cx-step-body"><StepBody call={call} result={result} chatId={chatId} /></div>}
    </div>
  );
}

function ToolGroup({ items, chatId, live, onOpenFile }) {
  const [open, setOpen] = useState(false);
  const pending = live ? items.find(it => !it.result) : null;
  const single = items.length === 1 ? items[0] : null;
  return (
    <div className={'cx-group' + (open ? ' open' : '')}>
      <button type="button" className="cx-group-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className={'cx-group-label' + (pending ? ' shimmer' : '')}>
          {pending ? verbOf(pending.call, false) + (stepTarget(pending.call) ? ' ' + stepTarget(pending.call) : '')
            : single ? verbOf(single.call, true) + (stepTarget(single.call) ? ' ' + stepTarget(single.call) : '')
            : summaryOf(items)}
        </span>
        <Chevron className="cx-chev" />
      </button>
      {open && (
        <div className="cx-steps">
          {items.map((it, i) => <Step key={i} item={it} chatId={chatId} onOpenFile={onOpenFile} />)}
        </div>
      )}
    </div>
  );
}

function ChangesCard({ changes, onOpenFile }) {
  const [open, setOpen] = useState(true);
  const sum = totals(changes);
  return (
    <ul className="cx-changes">
      <li>
        <button type="button" className="cx-ch-row head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <span className="cx-ch-ic"><Paper /></span>
          <span className="cx-ch-name">{changes.length === 1 ? t('Edited a file') : t('Edited {n} files', { n: changes.length })}</span>
          <Counts adds={sum.adds} dels={sum.dels} />
          <Chevron className={'cx-chev' + (open ? ' down' : '')} />
        </button>
      </li>
      {open && changes.map(c => (
        <li key={c.path}>
          <button type="button" className="cx-ch-row" onClick={() => onOpenFile(c.path)} data-tip={c.path}>
            <span className="cx-ch-ic"><FileIcon path={c.path} /></span>
            <span className="cx-ch-name">{baseName(c.path)}</span>
            {c.path.includes('/') && <span className="cx-ch-dir">{c.path.slice(0, c.path.lastIndexOf('/'))}</span>}
            <Counts adds={c.adds} dels={c.dels} />
            <Chevron className="cx-chev" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function TurnActions({ msg, onRetry, onContinue }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const clean = (msg.content || '').replace(/\[\[OQ(?:R:[A-Za-z0-9+/=]+|T:\d+)\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (await copyText(clean)) { setCopied(true); setTimeout(() => setCopied(false), 1400); }
  };
  return (
    <div className="cx-actions">
      <button type="button" className="cx-act" onClick={copy} aria-label={copied ? t('Copied') : t('Copy')} data-tip={copied ? t('Copied') : t('Copy')}>{copied ? <Check /> : <Copy />}</button>
      {onRetry && <button type="button" className="cx-act" onClick={() => onRetry(msg.id)} aria-label={t('Retry')} data-tip={t('Retry')}><Retry /></button>}
      {onContinue && (
        <button type="button" className="cx-act wide" onClick={() => onContinue(msg.id)} data-tip={t('Pick up where this reply stopped')}>
          <Retry />{t('Continue')}
        </button>
      )}
      {msg.created_at && <span className="cx-time" data-tip={new Date(msg.created_at).toLocaleString()}>{fmtRelative(msg.created_at)}</span>}
    </div>
  );
}

const AssistantTurn = React.memo(function AssistantTurn({ msg, streaming, liveCalls, phase, status, statusDelay, modelIcon, chatId, onOpenFile, onRetry, onContinue }) {
  const statusInfo = useStatusLabel(streaming ? status : null, statusDelay);
  const parts = useMemo(() => withLive(splitTurn(msg.content), streaming ? liveCalls : null), [msg.content, streaming, liveCalls]);
  const changes = useMemo(() => (streaming ? [] : fileChanges(parts)), [parts, streaming]);
  const segs = Array.isArray(msg.reasoningSegs) ? msg.reasoningSegs : null;
  const tailIsMarker = !!segs && /\[\[OQT:\d+\]\]\s*$/.test(msg.content || '');
  const segCtx = useMemo(() => (segs ? { segs, segMs: msg.reasoningSegMs || null, live: !!(streaming && tailIsMarker), collapsible: true } : null),
    [segs, msg.reasoningSegMs, streaming, tailIsMarker]);
  return (
    <div className={'cx-turn' + (streaming ? ' live' : '')} data-mid={msg.id} role="article" aria-label={t('Assistant message')}>
      {msg.reasoning && <ReasoningBlock text={msg.reasoning} live={streaming && phase === 'thinking' && !(segs && segs.length)}  durationMs={msg.reasoningMs || 0} collapsible />}
      <ReasonSegs.Provider value={segCtx}>
        {parts.map((p, i) => (p.kind === 'text'
          ? <div className="cx-prose" key={'t' + i}><Markdown streaming={streaming && i === parts.length - 1}>{p.text}</Markdown></div>
          : <ToolGroup key={'g' + i} items={p.items} chatId={chatId} live={streaming && i === parts.length - 1} onOpenFile={onOpenFile} />))}
      </ReasonSegs.Provider>
      {streaming && (
        <div className="cx-working">
          <CodeMark icon={modelIcon} className="cx-working-mark" state={phase === 'thinking' ? 'thinking' : 'generating'} />
          <span className="shimmer" data-tip={statusInfo.show ? statusInfo.detail || undefined : undefined}>
            {statusInfo.show ? statusInfo.label : phase === 'thinking' ? t('Thinking…') : t('Working…')}
          </span>
        </div>
      )}
      {changes.length > 0 && <ChangesCard changes={changes} onOpenFile={onOpenFile} />}
      {!streaming && msg.content && <TurnActions msg={msg} onRetry={onRetry} onContinue={onContinue} />}    </div>
  );
});

function UserTurn({ msg }) {
  const atts = msg.attachments || [];
  return (
    <div className={'msg user cx-user' + (msg._enter ? ' enter' : '')} data-mid={msg.id} role="article" aria-label={t('Your message')}>
      <div className="cx-user-col">
        {atts.length > 0 && (
          <div className="cx-user-atts">
            {atts.map((a, i) => <span key={i} className="cx-att"><FileText />{a.name}</span>)}
          </div>
        )}
        {msg.content && <div className="cx-bubble">{msg.content}</div>}
      </div>
    </div>
  );
}

export default function CodeTranscript({ messages, live, liveCalls, phase, status, statusDelay, modelIcon, chatId, onOpenFile, onRetry, onContinue }) {
  const list = live ? [...messages.filter(m => m.id !== live.id), live] : messages;
  const last = list[list.length - 1];
  return list.map(m => (m.role === 'user'
    ? <UserTurn key={m._k || m.id} msg={m} />
    : <AssistantTurn key={m._k || m.id} msg={m} streaming={!!m._streaming} liveCalls={m._streaming ? liveCalls : null}
        phase={m._streaming ? phase : 'static'} status={m._streaming ? status : null} statusDelay={statusDelay} modelIcon={modelIcon}
        chatId={chatId} onOpenFile={onOpenFile} onRetry={m._streaming ? null : onRetry}
        onContinue={!live && m === last && m.truncated ? onContinue : null} />));
}