import React, { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { SegPick } from '../widgets.jsx';
import { Plus, Trash, Pencil, Plug, Refresh } from '../../icons.jsx';

export default function McpSection() {
  const [servers, setServers] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    (async () => { try { const d = await api.get('/api/admin/mcp'); setServers(d.servers || []); } catch {} })();
  }, []);

  async function save(sv) {
    try {
      if (sv.id) { const r = await api.patch('/api/admin/mcp/' + sv.id, sv); setServers(list => list.map(x => x.id === sv.id ? r.server : x)); }
      else { const r = await api.post('/api/admin/mcp', sv); setServers(list => [...list, r.server]); if (r.warning) alert('Server saved, but connecting failed: ' + r.warning); }
      setEdit(null);
    } catch (e) { alert(e.message || 'Could not save server.'); }
  }
  async function remove(id) { try { await api.del('/api/admin/mcp/' + id); setServers(list => list.filter(x => x.id !== id)); } catch {} }
  async function toggle(sv) { try { const r = await api.patch('/api/admin/mcp/' + sv.id, { enabled: !sv.enabled }); setServers(list => list.map(x => x.id === sv.id ? r.server : x)); } catch {} }
  async function refresh(id) {
    setBusy(id);
    try { const r = await api.post('/api/admin/mcp/' + id + '/refresh'); setServers(list => list.map(x => x.id === id ? r.server : x)); } catch {}
    setBusy('');
  }

  return (
    <>
      <div className="admin-section-head">
        <div><div className="muted-note">Connect MCP (Model Context Protocol) servers running on this machine or your network. Their tools are exposed to every model with tool calling, prefixed <code>mcp_</code>. Everything stays local, no cloud relay is involved.</div></div>
        <button className="btn primary" onClick={() => setEdit({ name: '', transport: 'stdio', command: '', args: '', url: '', headers: '', enabled: true })}><Plus style={{ width: 15 }} /> Add server</button>
      </div>
      {edit && (
        <div className="fn-editor">
          <div className="field"><label>Server name</label>
            <input value={edit.name} onChange={(e) => setEdit(x => ({ ...x, name: e.target.value }))} placeholder="Filesystem" />
          </div>
          <div className="field"><label>Transport</label>
            <SegPick value={edit.transport === 'http' ? 'http' : 'stdio'} options={[['stdio', 'stdio (local command)'], ['http', 'HTTP']]}
              onChange={(v) => setEdit(x => ({ ...x, transport: v }))} />
          </div>
          {edit.transport !== 'http' && (
            <>
              <div className="field"><label>Command</label>
                <input value={edit.command} onChange={(e) => setEdit(x => ({ ...x, command: e.target.value }))} placeholder="npx" />
              </div>
              <div className="field"><label>Arguments</label>
                <input value={edit.args} onChange={(e) => setEdit(x => ({ ...x, args: e.target.value }))} placeholder="-y @modelcontextprotocol/server-filesystem /home/me/docs" />
                <div className="muted-note">The command is spawned by this server and speaks MCP over stdio.</div>
              </div>
            </>
          )}
          {edit.transport === 'http' && (
            <>
              <div className="field"><label>URL</label>
                <input value={edit.url} onChange={(e) => setEdit(x => ({ ...x, url: e.target.value }))} placeholder="http://localhost:8931/mcp" />
              </div>
              <div className="field"><label>Headers</label>
                <textarea rows={2} value={edit.headers} onChange={(e) => setEdit(x => ({ ...x, headers: e.target.value }))} placeholder={'Authorization: Bearer …'} />
                <div className="muted-note">Optional, one <code>Name: value</code> per line.</div>
              </div>
            </>
          )}
          <div className="med-toggle-card">
            <label className="inline-toggle"><span>Enabled</span><div className={'switch' + (edit.enabled ? ' on' : '')} onClick={() => setEdit(x => ({ ...x, enabled: !x.enabled }))} /></label>
          </div>
          <div className="editor-actions">
            <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn primary" onClick={() => save(edit)}>Save server</button>
          </div>
        </div>
      )}
      <div className="fn-list">
        {servers.length === 0 && !edit && <div className="muted-note">No MCP servers yet.</div>}
        {servers.map(sv => (
          <div key={sv.id} className="fn-card">
            <div className="fn-card-main">
              <div className="fn-card-title">
                <Plug style={{ width: 15 }} /> {sv.name}
                <span className={'mcp-status ' + (sv.status || 'new')}>{sv.status === 'connected' ? `${(sv.tools || []).length} tool${(sv.tools || []).length === 1 ? '' : 's'}` : sv.status === 'error' ? 'error' : 'not connected'}</span>
              </div>
              <div className="fn-card-desc">
                {sv.transport === 'http' ? sv.url : `${sv.command} ${sv.args || ''}`.trim()}
                {sv.status === 'error' && sv.error ? `, ${sv.error}` : ''}
                {sv.status === 'connected' && (sv.tools || []).length ? `, ${(sv.tools || []).map(t => t.name).slice(0, 6).join(', ')}${(sv.tools || []).length > 6 ? '…' : ''}` : ''}
              </div>
            </div>
            <div className="fn-card-actions">
              <button className="icon-btn" title="Reconnect and refresh tools" disabled={busy === sv.id} onClick={() => refresh(sv.id)}><Refresh style={{ width: 15, opacity: busy === sv.id ? .4 : 1 }} /></button>
              <div className={'switch' + (sv.enabled ? ' on' : '')} title="Enabled" onClick={() => toggle(sv)} />
              <button className="icon-btn" onClick={() => setEdit({ ...sv })}><Pencil style={{ width: 15 }} /></button>
              <button className="icon-btn" onClick={() => remove(sv.id)}><Trash style={{ width: 15 }} /></button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
