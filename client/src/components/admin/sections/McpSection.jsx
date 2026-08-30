import { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card, Rows, ToggleRow, Fields, Field, Input, Area, Seg, Btn, IconBtn, Acts, Table, Badge, Switch, Empty, Dialog, Note } from '../ui.jsx';
import { Plus, Trash, Pencil, Refresh, Plug } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

const BLANK = { name: '', transport: 'stdio', command: '', args: '', url: '', headers: '', enabled: true };

export default function McpSection() {
  const { confirm } = useAdmin();
  const [servers, setServers] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const d = await api.get('/api/admin/mcp'); if (alive) setServers(d.servers || []); }
      catch { if (alive) setServers([]); }
    })();
    return () => { alive = false; };
  }, []);

  async function save() {
    setError('');
    setBusy('save');
    try {
      if (draft.id) {
        const r = await api.patch('/api/admin/mcp/' + draft.id, draft);
        setServers(list => list.map(x => (x.id === draft.id ? r.server : x)));
      } else {
        const r = await api.post('/api/admin/mcp', draft);
        setServers(list => [...list, r.server]);
      }
      setDraft(null);
    } catch (e) { setError(e.message || t('Could not reach that server.')); }
    finally { setBusy(''); }
  }

  async function toggle(sv) {
    try {
      const r = await api.patch('/api/admin/mcp/' + sv.id, { enabled: !sv.enabled });
      setServers(list => list.map(x => (x.id === sv.id ? r.server : x)));
    } catch {}
  }

  async function refresh(id) {
    setBusy(id);
    try {
      const r = await api.post('/api/admin/mcp/' + id + '/refresh');
      setServers(list => list.map(x => (x.id === id ? r.server : x)));
    } catch {}
    finally { setBusy(''); }
  }

  function del(sv) {
    confirm({
      title: t('Remove server'),
      message: t('“{name}” and its tools stop being offered to every model on this workspace.', { name: sv.name }),
      confirm: t('Remove server'),
      onConfirm: async () => {
        try { await api.del('/api/admin/mcp/' + sv.id); setServers(list => list.filter(x => x.id !== sv.id)); } catch {}
      }
    });
  }

  const stdio = draft && draft.transport !== 'http';
  const valid = draft && draft.name.trim() && (stdio ? draft.command.trim() : draft.url.trim());
  const anyError = servers?.some(s => s.error);

  return (
    <>
      <Card title={t('Servers')} flush
        sub={t('Tools from every enabled server are exposed to any model with tool calling, prefixed with mcp_. Servers run on this machine or your network; nothing is relayed through a third party. Members can attach HTTP servers of their own under Settings.')}
        actions={<Btn kind="primary" size="sm" onClick={() => { setDraft({ ...BLANK }); setError(''); }}>
          <Plus /> {t('Add server')}
        </Btn>}
        foot={anyError
          ? <span className="cp-err">{t('One or more servers failed to connect. Reconnect to see the error, or check that the command or URL is still reachable.')}</span>
          : null}>
        {servers == null && <Empty icon={Plug} title={t('Loading')} />}
        {servers != null && servers.length === 0 && (
          <Empty icon={Plug} title={t('No servers attached')}>
            {t('An MCP server gives models capabilities this app does not ship with: filesystem access, a browser, or your own internal APIs.')}
          </Empty>
        )}
        {servers != null && servers.length > 0 && (
          <Table head={[
            { label: t('Name'), fit: true },
            { label: t('Transport'), fit: true, mono: true },
            { label: t('Target'), mono: true },
            { label: t('Tools'), num: true, fit: true },
            { label: t('State'), fit: true },
            { label: t('Enabled'), fit: true },
            { label: '', fit: true }
          ]}>
            {servers.map(sv => (
              <tr key={sv.id}>
                <td>{sv.name}</td>
                <td className="mono dim">{sv.transport === 'http' ? 'http' : 'stdio'}</td>
                <td className="mono dim wrap">{sv.transport === 'http' ? sv.url : [sv.command, sv.args].filter(Boolean).join(' ')}</td>
                <td className="num mono">{sv.tools?.length ?? sv.toolCount ?? 0}</td>
                <td className="fit">
                  {sv.error
                    ? <Badge tone="bad">{t('error')}</Badge>
                    : sv.enabled ? <Badge tone="good">{t('connected')}</Badge> : <Badge>{t('off')}</Badge>}
                </td>
                <td className="fit"><Switch on={sv.enabled} label={t('Enabled')} onToggle={() => toggle(sv)} /></td>
                <td className="acts">
                  <Acts end>
                    <IconBtn label={t('Reconnect')} disabled={busy === sv.id} onClick={() => refresh(sv.id)}><Refresh /></IconBtn>
                    <IconBtn label={t('Edit')} onClick={() => { setDraft({ ...sv }); setError(''); }}><Pencil /></IconBtn>
                    <IconBtn kind="danger" label={t('Remove')} onClick={() => del(sv)}><Trash /></IconBtn>
                  </Acts>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {draft && (
        <Dialog title={draft.id ? t('Edit server') : t('Add server')} onClose={() => setDraft(null)}
          foot={<>
            <Btn onClick={() => setDraft(null)}>{t('Cancel')}</Btn>
            <Btn kind="primary" disabled={!valid || busy === 'save'} onClick={save}>
              {busy === 'save' ? t('Connecting…') : t('Save and connect')}
            </Btn>
          </>}>
          <Fields>
            <Field label={t('Name')} hint={t('Shown to admins only. Tool names come from the server itself.')}>
              <Input value={draft.name} placeholder={t('filesystem')}
                onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))} />
            </Field>
            <Field label={t('Transport')}
              hint={t('stdio spawns a local process from this server. HTTP connects to an endpoint that is already listening.')}>
              <Seg value={stdio ? 'stdio' : 'http'} label={t('Transport')}
                onChange={(v) => setDraft(d => ({ ...d, transport: v }))}
                options={[{ value: 'stdio', label: t('stdio') }, { value: 'http', label: t('HTTP') }]} />
            </Field>
            {stdio ? (
              <>
                <Field label={t('Command')}>
                  <Input mono value={draft.command} placeholder="npx"
                    onChange={(e) => setDraft(d => ({ ...d, command: e.target.value }))} />
                </Field>
                <Field label={t('Arguments')} hint={t('Passed to the command as written, split on spaces.')}>
                  <Input mono value={draft.args} placeholder="-y @modelcontextprotocol/server-filesystem /home/me/docs"
                    onChange={(e) => setDraft(d => ({ ...d, args: e.target.value }))} />
                </Field>
              </>
            ) : (
              <>
                <Field label={t('URL')}>
                  <Input mono value={draft.url} placeholder="http://localhost:8931/mcp"
                    onChange={(e) => setDraft(d => ({ ...d, url: e.target.value }))} />
                </Field>
                <Field label={t('Headers')} optional hint={t('One Name: value pair per line.')}>
                  <Area mono rows={3} value={draft.headers} placeholder="Authorization: Bearer …"
                    onChange={(e) => setDraft(d => ({ ...d, headers: e.target.value }))} />
                </Field>
              </>
            )}
          </Fields>
          <Rows>
            <ToggleRow label={t('Expose these tools to models')} on={draft.enabled}
              onToggle={() => setDraft(d => ({ ...d, enabled: !d.enabled }))} />
          </Rows>
          {error && <Note tone="bad">{error}</Note>}
        </Dialog>
      )}
    </>
  );
}
