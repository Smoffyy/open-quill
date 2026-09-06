import { useState } from 'react';
import { Trash, Pencil, Refresh, Terminal, Globe, Info } from './icons.jsx';
import { Switch } from './settingsui.jsx';
import { t } from '../i18n.jsx';

const TOOL_PREVIEW = 8;

export function endpointOf(sv) {
  return sv.transport === 'http' ? (sv.url || '') : `${sv.command || ''} ${sv.args || ''}`.trim();
}

export function statusOf(sv) {
  if (sv.status === 'error') return { key: 'error', label: t('Error') };
  if (sv.status === 'connected') {
    const n = (sv.tools || []).length;
    if (!n) return { key: 'new', label: t('No tools') };
    return { key: 'connected', label: n === 1 ? t('1 tool') : `${n} ${t('tools')}` };
  }
  return { key: 'new', label: t('Not connected') };
}

// One server row, shared by the admin panel and a user's own connector list. `readOnly`
// is what a user sees for a workspace server: the same card, without the controls only
// an admin may use.
export default function McpCard({ server: sv, busy, readOnly, onRefresh, onToggle, onEdit, onDelete }) {
  const [showAll, setShowAll] = useState(false);
  const status = statusOf(sv);
  const tools = sv.tools || [];
  const shown = showAll ? tools : tools.slice(0, TOOL_PREVIEW);
  const endpoint = endpointOf(sv);

  return (
    <div className={'mcp-card' + (sv.enabled === false ? ' is-off' : '')}>
      <div className="mcp-card-head">
        <span className="mcp-card-icon" aria-hidden="true">{sv.transport === 'http' ? <Globe style={{ width: 15 }} /> : <Terminal style={{ width: 15 }} />}</span>
        <div className="mcp-card-id">
          <div className="mcp-card-name">
            {sv.name}
            <span className={'mcp-status ' + status.key}>{status.label}</span>
            {sv.enabled === false && <span className="mcp-status off">{t("Disabled")}</span>}
            {readOnly && <span className="mcp-status off">{t("Workspace")}</span>}
          </div>
          <div className="mcp-endpoint" title={endpoint}>
            <span className="mcp-transport">{sv.transport === 'http' ? 'HTTP' : 'stdio'}</span>
            <code>{endpoint || t("Not configured")}</code>
          </div>
        </div>
        {!readOnly && (
          <div className="mcp-card-actions">
            <button className="icon-btn" title={t("Reconnect and refresh tools")} aria-label={t("Reconnect and refresh tools")} disabled={busy} onClick={onRefresh}>
              <Refresh className={busy ? 'mcp-spin' : ''} style={{ width: 15 }} />
            </button>
            <Switch on={sv.enabled !== false} label={t("Enabled")} title={t("Enabled")} onToggle={onToggle} />
            <button className="icon-btn" title={t("Edit")} aria-label={t("Edit")} onClick={onEdit}><Pencil style={{ width: 15 }} /></button>
            <button className="icon-btn" title={t("Delete")} aria-label={t("Delete")} onClick={onDelete}><Trash style={{ width: 15 }} /></button>
          </div>
        )}
      </div>

      {sv.status === 'error' && sv.error && (
        <div className="mcp-card-error"><Info style={{ width: 14, flexShrink: 0 }} /><span>{sv.error}</span></div>
      )}

      {shown.length > 0 && (
        <div className="mcp-tools">
          {shown.map(tool => <span key={tool.name} className="mcp-tool" title={`mcp_${sv.slug}_${tool.name}${tool.description ? '\n\n' + tool.description : ''}`}>{tool.name}</span>)}
          {tools.length > TOOL_PREVIEW && (
            <button className="mcp-tool-more" onClick={() => setShowAll(v => !v)}>
              {showAll ? t("Show fewer") : `+${tools.length - TOOL_PREVIEW} ${t("more")}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
