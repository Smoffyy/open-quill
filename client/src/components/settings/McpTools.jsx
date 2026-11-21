import { useState, useId } from 'react';
import { SegSlide } from '../ui/controls.jsx';
import { Shield } from '../ui/icons.jsx';
import { t, tk } from '../../i18n.jsx';
import { exampleArgs, argList, parseArgs } from '../../lib/mcpconfig.js';

const TOOL_PREVIEW = 8;
const MODES = [
  { v: 'on', label: tk('On') },
  { v: 'ask', label: tk('Ask first') },
  { v: 'off', label: tk('Off') }
];

function ToolDetail({ server, tool, readOnly, onSetMode, onTry }) {
  const [text, setText] = useState(() => JSON.stringify(exampleArgs(tool.inputSchema), null, 2));
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const inputId = useId();
  const errorId = useId();
  const args = argList(tool.inputSchema);
  const hints = tool.annotations || {};

  async function run() {
    const parsed = parseArgs(text);
    if (parsed.error) {
      setError(parsed.error === 'not-json' ? t('That is not valid JSON yet.') : t('Arguments must be a JSON object.'));
      return;
    }
    setError('');
    setRunning(true);
    try { setResult(await onTry(tool.name, parsed.args)); }
    catch (e) { setResult({ ok: false, ms: 0, error: e.message || t('Could not run the tool.') }); }
    setRunning(false);
  }

  return (
    <div className="mcp-tool-detail">
      <div className="mcp-td-head">
        <code className="mcp-td-name">{hints.title || tool.name}</code>
        {hints.readOnlyHint && <span className="mcp-hint">{t('Read-only')}</span>}
        {hints.destructiveHint && <span className="mcp-hint warn">{t('Can change data')}</span>}
        {hints.openWorldHint && <span className="mcp-hint">{t('Reaches outside services')}</span>}
      </div>
      {tool.description && <p className="mcp-td-desc">{tool.description}</p>}
      {args.length > 0 && (
        <ul className="mcp-td-args" aria-label={t('Arguments')}>
          {args.map(a => (
            <li key={a.name}>
              <code>{a.name}</code>
              <span className="mcp-td-type">{a.required ? t('{type}, required', { type: a.type }) : a.type}</span>
              {a.description && <span className="mcp-td-adesc">{a.description}</span>}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && onSetMode && (
        <div className="mcp-td-mode">
          <span className="mcp-td-label">{t('When a model calls it')}</span>
          <SegSlide value={tool.mode} label={t('When a model calls it')}
            options={MODES.map(m => ({ v: m.v, label: t(m.label) }))} onPick={(v) => onSetMode(tool.name, v)} />
        </div>
      )}
      {onTry && (
        <div className="mcp-td-try">
          <label className="mcp-td-label" htmlFor={inputId}>{t('Try it with these arguments')}</label>
          <textarea id={inputId} className="mcp-td-input" rows={Math.min(8, text.split('\n').length + 1)} value={text} spellCheck={false}
            aria-invalid={error ? 'true' : undefined} aria-describedby={errorId}
            onChange={(e) => { setText(e.target.value); if (error) setError(''); }} />
          <div className="mcp-td-run">
            <button type="button" className="sk-btn primary" disabled={running} onClick={run}>
              {running ? <><span className="btn-spin" aria-hidden="true" />{t('Running…')}</> : t('Run tool')}
            </button>
            <span id={errorId} role="alert" className="mcp-td-err">{error}</span>
          </div>
          {result && (
            <div className={'mcp-td-result' + (result.ok ? '' : ' bad')}>
              <div className="mcp-td-meta">{result.ok ? t('Finished in {ms} ms', { ms: result.ms }) : t('Failed after {ms} ms', { ms: result.ms })}</div>
              <pre>{result.ok ? result.content : result.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function McpTools({ server, readOnly = false, onSetMode, onTry }) {
  const [openName, setOpenName] = useState('');
  const [showAll, setShowAll] = useState(false);
  const tools = server.tools || [];
  if (!tools.length) return null;
  const shown = showAll ? tools : tools.slice(0, TOOL_PREVIEW);
  const open = tools.find(x => x.name === openName);

  return (
    <div className="mcp-tools-wrap">
      <div className="mcp-tools">
        {shown.map(tool => (
          <button key={tool.name} type="button" aria-expanded={openName === tool.name}
            className={'mcp-tool' + (tool.mode === 'off' ? ' off' : '') + (openName === tool.name ? ' open' : '')}
            data-tip={tool.description || tool.name}
            onClick={() => setOpenName(n => (n === tool.name ? '' : tool.name))}>
            {tool.mode === 'ask' && <Shield className="mcp-tool-ic" aria-hidden="true" />}
            <span className="mcp-tool-name">{tool.name}</span>
            {tool.mode === 'ask' && <span className="sr-only">{t('Asks first')}</span>}
            {tool.mode === 'off' && <span className="sr-only">{t('Off')}</span>}
          </button>
        ))}
        {tools.length > TOOL_PREVIEW && (
          <button type="button" className="mcp-tool-more" onClick={() => setShowAll(v => !v)}>
            {showAll ? t('Show fewer') : t('+{n} more', { n: tools.length - TOOL_PREVIEW })}
          </button>
        )}
      </div>
      {open && <ToolDetail key={server.id + open.name} server={server} tool={open} readOnly={readOnly} onSetMode={onSetMode} onTry={onTry} />}
    </div>
  );
}