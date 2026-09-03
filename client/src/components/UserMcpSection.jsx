import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Plus, Plug } from './icons.jsx';
import McpCard from './McpCard.jsx';
import { t } from '../i18n.jsx';

const blank = () => ({ name: '', url: '', headers: '', enabled: true });

export default function UserMcpSection() {
  const [servers, setServers] = useState([]);
  const [limit, setLimit] = useState(0);
  const [edit, setEdit] = useState(null);
  const [editError, setEditError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    (async () => {
      try { const d = await api.get('/api/mcp'); setServers(d.servers || []); setLimit(d.limit || 0); } catch {}
    })();
  }, []);

  const workspace = servers.filter(s => s.scope === 'workspace');
  const mine = servers.filter(s => s.scope === 'user');
  const atLimit = limit > 0 && mine.length >= limit;

  function startAdd() { setEditError(''); setEdit(blank()); }
  function startEdit(sv) { setEditError(''); setEdit({ id: sv.id, name: sv.name, url: sv.url, headers: '', hasHeaders: sv.hasHeaders, enabled: sv.enabled !== false }); }

  async function save() {
    setEditError('');
    setBusy('save');
    try {
      const body = { name: edit.name, url: edit.url, enabled: edit.enabled };
      // An existing header is never sent back to the browser, so an empty box means
      // "leave it alone" rather than "clear it". Clearing is its own explicit action.
      if (edit.headers.trim() || edit.clearHeaders) body.headers = edit.headers;
      if (edit.id) { const r = await api.patch('/api/mcp/' + edit.id, body); setServers(list => list.map(x => x.id === edit.id ? r.server : x)); }
      else { const r = await api.post('/api/mcp', body); setServers(list => [...list, r.server]); }
      setEdit(null);
    } catch (e) { setEditError(e.message || t('Could not save server.')); }
    setBusy('');
  }
  async function remove(id) { try { await api.del('/api/mcp/' + id); setServers(list => list.filter(x => x.id !== id)); } catch {} }
  async function toggle(sv) { try { const r = await api.patch('/api/mcp/' + sv.id, { enabled: !sv.enabled }); setServers(list => list.map(x => x.id === sv.id ? r.server : x)); } catch {} }
  async function refresh(id) {
    setBusy(id);
    try { const r = await api.post('/api/mcp/' + id + '/refresh'); setServers(list => list.map(x => x.id === id ? r.server : x)); } catch {}
    setBusy('');
  }

  return (
    <>
      <div className="sk-head">
        <h2 className="sk-title">{t("MCP")}</h2>
        <div className="sk-head-acts">
          <button className="sk-btn" disabled={atLimit || !!edit} onClick={startAdd}><Plus /> {t("Add server")}</button>
        </div>
      </div>

      <div className="mcp-body">
        <div className="muted-note mcp-intro">{t("Add MCP servers of your own. Their tools reach every model you use that has tool calling, and nobody else on this workspace can see them. Local command servers are added by an admin.")}</div>

        {edit && (
          <div className="fn-editor mcp-editor">
            <div className="field"><label>{t("Server name")}</label>
              <input value={edit.name} onChange={(e) => setEdit(x => ({ ...x, name: e.target.value }))} placeholder={t("Filesystem")} />
            </div>
            <div className="field"><label>{t("URL")}</label>
              <input value={edit.url} onChange={(e) => setEdit(x => ({ ...x, url: e.target.value }))} placeholder={t("http://localhost:8931/mcp")} />
            </div>
            <div className="field"><label>{t("Headers")}</label>
              <textarea rows={2} value={edit.headers} onChange={(e) => setEdit(x => ({ ...x, headers: e.target.value, clearHeaders: false }))}
                placeholder={edit.hasHeaders && !edit.clearHeaders ? t("A header is saved. Type here to replace it.") : 'Authorization: Bearer …'} />
              <div className="muted-note mcp-headers-note">
                <span>{t("Optional, one Name: value pair per line.")}</span>
                {edit.hasHeaders && !edit.clearHeaders && <button className="mcp-tool-more" onClick={() => setEdit(x => ({ ...x, headers: '', clearHeaders: true }))}>{t("Remove saved header")}</button>}
                {edit.clearHeaders && <span className="mcp-headers-cleared">{t("The saved header will be removed.")}</span>}
              </div>
            </div>
            {editError && <div className="mcp-form-error" role="alert">{editError}</div>}
            <div className="editor-actions">
              <button className="sk-btn" onClick={() => { setEdit(null); setEditError(''); }}>{t("Cancel")}</button>
              <button className="sk-btn primary" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? t("Connecting…") : t("Save server")}</button>
            </div>
          </div>
        )}

        {mine.length === 0 && !edit && (
          <div className="mcp-empty">
            <span className="mcp-empty-icon"><Plug style={{ width: 20 }} /></span>
            <div className="mcp-empty-title">{t("No connectors of your own")}</div>
            <div className="mcp-empty-note">{t("Point this at an MCP server you run and its tools become available to the models you chat with.")}</div>
          </div>
        )}

        {mine.length > 0 && (
          <div className="mcp-list">
            {mine.map(sv => (
              <McpCard key={sv.id} server={sv} busy={busy === sv.id}
                onRefresh={() => refresh(sv.id)}
                onToggle={() => toggle(sv)}
                onEdit={() => startEdit(sv)}
                onDelete={() => remove(sv.id)} />
            ))}
          </div>
        )}

        {atLimit && <div className="muted-note mcp-limit-note">{t("You have reached the connector limit. Remove one to add another.")}</div>}

        {workspace.length > 0 && (
          <>
            <div className="mcp-group-head">{t("From this workspace")}</div>
            <div className="muted-note mcp-group-note">{t("Added by an admin and available to everyone. You cannot change these.")}</div>
            <div className="mcp-list">
              {workspace.map(sv => <McpCard key={sv.id} server={sv} readOnly />)}
            </div>
          </>
        )}
      </div>
    </>
  );
}
