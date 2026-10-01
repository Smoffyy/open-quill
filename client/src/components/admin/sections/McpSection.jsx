import { useState, useEffect, useMemo } from 'react';
import { api } from '../../../lib/api.js';
import { useAdmin } from '../store.jsx';
import { Card, Rows, ToggleRow, Fields, Field, Input, Area, Seg, Btn, IconBtn, Acts, Table, Badge, Switch, Empty, Dialog, Note } from '../ui.jsx';
import { Plus, Trash, Pencil, Refresh, Plug } from '../../ui/icons.jsx';
import { t } from '../../../i18n.jsx';
import { Skel, SkelRows } from '../../ui/Skeleton.jsx';
import { parseMcpConfig } from '../../../lib/mcpconfig.js';
import { statusOf } from '../../settings/McpCard.jsx';

const BLANK = { name: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '', enabled: true };
const TONE = { __proto__: null, connected: 'good', error: 'bad', new: undefined };

const savedNote = (names, touched) => (names?.length && !touched ? t('Saved: {names}. Values stay on the server.', { names: names.join(', ') }) : '');

export default function McpSection() {
  const { confirm } = useAdmin();
  const [servers, setServers] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [paste, setPaste] = useState('');
  const imported = useMemo(() => parseMcpConfig(paste), [paste]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const d = await api.get('/api/admin/mcp'); if (alive) setServers(d.servers || []); }
      catch { if (alive) setServers([]); }
    })();
    return () => { alive = false; };
  }, []);

  function open(next) {
    setDraft(next);
    setError('');
    setPaste('');
  }

  async function save() {
    setError('');
    setBusy('save');
    try {
      const { headersTouched, envTouched, headerNames, envNames, tools, ...body } = draft;
      if (draft.id && !headersTouched) delete body.headers;
      if (draft.id && !envTouched) delete body.env;
      const r = draft.id ? await api.patch('/api/admin/mcp/' + draft.id, body) : await api.post('/api/admin/mcp', body);
      setServers(list => (list.some(x => x.id === r.server.id) ? list.map(x => (x.id === r.server.id ? r.server : x)) : [...list, r.server]));
      if (r.warning) {
        setDraft({ ...BLANK, ...r.server });
        setError(t('Saved, but the server did not connect: {error}', { error: r.warning }));
      } else setDraft(null);
    } catch (e) { setError(e.message || t('Could not reach that server.')); }
    finally { setBusy(''); }
  }

  async function addAll(list) {
    setError('');
    setBusy('save');
    const failed = [];
    for (const sv of list) {
      try {
        const r = await api.post('/api/admin/mcp', sv);
        setServers(cur => [...cur, r.server]);
        if (r.warning) failed.push(sv.name);
      } catch { failed.push(sv.name); }
    }
    setBusy('');
    if (failed.length) setError(t('Added, but these did not connect: {names}. Each row shows why.', { names: failed.join(', ') }));
    else setDraft(null);
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
        actions={<Btn kind="primary" size="sm" onClick={() => open({ ...BLANK })}>
          <Plus /> {t('Add server')}
        </Btn>}
        foot={anyError
          ? <span className="cp-err">{t('One or more servers failed to connect. Reconnect to see the error, or check that the command or URL is still reachable.')}</span>
          : null}>
        <Skel when={servers == null}><SkelRows count={3} /></Skel>
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
                <td>
                  {sv.name}
                  {sv.status === 'error' && sv.error && <div className="mcp-row-error">{sv.error}</div>}
                </td>
                <td className="mono dim">{sv.transport === 'http' ? 'http' : 'stdio'}</td>
                <td className="mono dim wrap">{sv.transport === 'http' ? sv.url : [sv.command, sv.args].filter(Boolean).join(' ')}</td>
                <td className="num mono">{sv.tools?.length ?? sv.toolCount ?? 0}</td>
                <td className="fit">
                  {sv.enabled === false ? <Badge>{t('off')}</Badge> : <Badge tone={TONE[statusOf(sv).key]}>{statusOf(sv).label}</Badge>}
                </td>
                <td className="fit"><Switch on={sv.enabled} label={t('Enabled')} onToggle={() => toggle(sv)} /></td>
                <td className="acts">
                  <Acts end>
                    <IconBtn label={t('Reconnect')} disabled={busy === sv.id} onClick={() => refresh(sv.id)}><Refresh /></IconBtn>
                    <IconBtn label={t('Edit')} onClick={() => open({ ...BLANK, ...sv })}><Pencil /></IconBtn>
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
            {!draft.id && (
              <Field label={t('Import a config')} optional
                hint={imported.error === 'not-json' ? t('That is not valid JSON yet.') : imported.error ? t('No MCP servers found in that JSON.') : t('Paste the JSON block from a server README, such as an "mcpServers" entry. It fills in the fields below.')}>
                <Area mono rows={3} value={paste} placeholder={'{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "..."] } } }'}
                  onChange={(e) => setPaste(e.target.value)} />
                {imported.servers.length === 1 && (
                  <Acts><Btn size="sm" onClick={() => { setDraft({ ...BLANK, ...imported.servers[0] }); setPaste(''); }}>{t('Fill in from this config')}</Btn></Acts>
                )}
                {imported.servers.length > 1 && (
                  <Acts>
                    <Btn size="sm" kind="primary" disabled={busy === 'save'} onClick={() => addAll(imported.servers)}>
                      {t('Add all {n} servers', { n: imported.servers.length })}
                    </Btn>
                    <span className="cp-note-line">{imported.servers.map(s => s.name).join(', ')}</span>
                  </Acts>
                )}
              </Field>
            )}
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
                <Field label={t('Arguments')} hint={t('Split on spaces. Wrap an argument in double quotes to keep its spaces.')}>
                  <Input mono value={draft.args} placeholder="-y @modelcontextprotocol/server-filesystem /home/me/docs"
                    onChange={(e) => setDraft(d => ({ ...d, args: e.target.value }))} />
                </Field>
                <Field label={t('Environment variables')} optional
                  hint={savedNote(draft.envNames, draft.envTouched) || t('One NAME=value per line, such as an API key the server needs.')}>
                  <Area mono rows={3} value={draft.env || ''}
                    placeholder={draft.envNames?.length && !draft.envTouched ? t('Values are hidden. Type to replace all of them.') : 'GITHUB_PERSONAL_ACCESS_TOKEN=...'}
                    onChange={(e) => setDraft(d => ({ ...d, env: e.target.value, envTouched: true }))} />
                  {draft.envNames?.length > 0 && !draft.envTouched && (
                    <Acts><Btn size="sm" kind="quiet" onClick={() => setDraft(d => ({ ...d, env: '', envTouched: true }))}>{t('Remove saved variables')}</Btn></Acts>
                  )}
                </Field>
              </>
            ) : (
              <>
                <Field label={t('URL')} hint={t('Streamable HTTP and the older SSE transport both work. A bare address is tried at /mcp and /sse.')}>
                  <Input mono value={draft.url} placeholder="http://localhost:8931/mcp"
                    onChange={(e) => setDraft(d => ({ ...d, url: e.target.value }))} />
                </Field>
                <Field label={t('Headers')} optional hint={savedNote(draft.headerNames, draft.headersTouched) || t('One Name: value pair per line.')}>
                  <Area mono rows={3} value={draft.headers || ''}
                    placeholder={draft.headerNames?.length && !draft.headersTouched ? t('Values are hidden. Type to replace all of them.') : 'Authorization: Bearer ...'}
                    onChange={(e) => setDraft(d => ({ ...d, headers: e.target.value, headersTouched: true }))} />
                  {draft.headerNames?.length > 0 && !draft.headersTouched && (
                    <Acts><Btn size="sm" kind="quiet" onClick={() => setDraft(d => ({ ...d, headers: '', headersTouched: true }))}>{t('Remove saved headers')}</Btn></Acts>
                  )}
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
