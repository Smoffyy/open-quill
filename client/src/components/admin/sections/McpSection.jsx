import { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { SegPick, Switch } from '../widgets.jsx';
import { Plus, Plug } from '../../icons.jsx';
import McpCard from '../../McpCard.jsx';
import { t } from '../../../i18n.jsx';

export default function McpSection() {
  const [servers, setServers] = useState([]);
  const [edit, setEdit] = useState(null);
  const [editError, setEditError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    (async () => { try { const d = await api.get('/api/admin/mcp'); setServers(d.servers || []); } catch {} })();
  }, []);

  function startAdd() {
    setEditError('');
    setEdit({ name: '', transport: 'stdio', command: '', args: '', url: '', headers: '', enabled: true });
  }

  async function save(sv) {
    setEditError('');
    setBusy('save');
    try {
      if (sv.id) { const r = await api.patch('/api/admin/mcp/' + sv.id, sv); setServers(list => list.map(x => x.id === sv.id ? r.server : x)); }
      else { const r = await api.post('/api/admin/mcp', sv); setServers(list => [...list, r.server]); }
      setEdit(null);
    } catch (e) { setEditError(e.message || t('Could not save server.')); }
    setBusy('');
  }
  async function remove(id) { try { await api.del('/api/admin/mcp/' + id); setServers(list => list.filter(x => x.id !== id)); } catch {} }
  async function toggle(sv) { try { const r = await api.patch('/api/admin/mcp/' + sv.id, { enabled: !sv.enabled }); setServers(list => list.map(x => x.id === sv.id ? r.server : x)); } catch {} }
  async function refresh(id) {
    setBusy(id);
    try { const r = await api.post('/api/admin/mcp/' + id + '/refresh'); setServers(list => list.map(x => x.id === id ? r.server : x)); } catch {}
    setBusy('');
  }

  const editing = !!edit;

  return (
    <>
      <div className="admin-section-head">
        <div className="muted-note mcp-intro">{t("Tools from each server reach every model that has tool calling, named with an mcp_ prefix. Servers run on this machine or your network, nothing is relayed through a cloud. Users can add HTTP servers of their own under Settings.")}</div>
        <button className="btn primary" onClick={startAdd}><Plus style={{ width: 15 }} /> {t("Add server")}</button>
      </div>

      {editing && (
        <div className="fn-editor mcp-editor">
          <div className="field"><label>{t("Server name")}</label>
            <input value={edit.name} onChange={(e) => setEdit(x => ({ ...x, name: e.target.value }))} placeholder={t("Filesystem")} />
          </div>
          <div className="field"><label>{t("Transport")}</label>
            <SegPick value={edit.transport === 'http' ? 'http' : 'stdio'} options={[['stdio', 'stdio (local command)'], ['http', 'HTTP']]}
              onChange={(v) => setEdit(x => ({ ...x, transport: v }))} />
          </div>
          {edit.transport !== 'http' && (
            <>
              <div className="field"><label>{t("Command")}</label>
                <input value={edit.command} onChange={(e) => setEdit(x => ({ ...x, command: e.target.value }))} placeholder={t("npx")} />
              </div>
              <div className="field"><label>{t("Arguments")}</label>
                <input value={edit.args} onChange={(e) => setEdit(x => ({ ...x, args: e.target.value }))} placeholder={t("-y @modelcontextprotocol/server-filesystem /home/me/docs")} />
                <div className="muted-note">{t("The command is spawned by this server and speaks MCP over stdio.")}</div>
              </div>
            </>
          )}
          {edit.transport === 'http' && (
            <>
              <div className="field"><label>{t("URL")}</label>
                <input value={edit.url} onChange={(e) => setEdit(x => ({ ...x, url: e.target.value }))} placeholder={t("http://localhost:8931/mcp")} />
              </div>
              <div className="field"><label>{t("Headers")}</label>
                <textarea rows={2} value={edit.headers} onChange={(e) => setEdit(x => ({ ...x, headers: e.target.value }))} placeholder={'Authorization: Bearer …'} />
                <div className="muted-note">{t("Optional, one Name: value pair per line.")}</div>
              </div>
            </>
          )}
          <div className="med-toggle-card">
            <label className="inline-toggle"><span>{t("Enabled")}</span><Switch on={edit.enabled} label={t("Enabled")} onToggle={() => setEdit(x => ({ ...x, enabled: !x.enabled }))} /></label>
          </div>
          {editError && <div className="mcp-form-error" role="alert">{editError}</div>}
          <div className="editor-actions">
            <button className="btn" onClick={() => { setEdit(null); setEditError(''); }}>{t("Cancel")}</button>
            <button className="btn primary" disabled={busy === 'save'} onClick={() => save(edit)}>{busy === 'save' ? t("Connecting…") : t("Save server")}</button>
          </div>
        </div>
      )}

      {servers.length === 0 && !editing && (
        <div className="mcp-empty">
          <span className="mcp-empty-icon"><Plug style={{ width: 20 }} /></span>
          <div className="mcp-empty-title">{t("No MCP servers yet")}</div>
          <div className="mcp-empty-note">{t("Add an MCP server to give your models tools such as file access, a browser, or your own internal APIs.")}</div>
          <button className="btn primary" onClick={startAdd}><Plus style={{ width: 15 }} /> {t("Add server")}</button>
        </div>
      )}

      <div className="mcp-list">
        {servers.map(sv => (
          <McpCard key={sv.id} server={sv} busy={busy === sv.id}
            onRefresh={() => refresh(sv.id)}
            onToggle={() => toggle(sv)}
            onEdit={() => { setEditError(''); setEdit({ ...sv }); }}
            onDelete={() => remove(sv.id)} />
        ))}
      </div>
    </>
  );
}
