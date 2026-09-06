import { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../store.jsx';
import { Card, Fields, Field, Input, Select, Btn, IconBtn, Acts, Badge, KV, Empty, Dialog, Table, fmtInt } from '../ui.jsx';
import { Cube, Plus, Trash, Sliders } from '../../icons.jsx';
import { api } from '../../../api.js';
import { t } from '../../../i18n.jsx';

function Engine({ e }) {
  const rows = [];
  if (e.ctx > 0) rows.push([t('Context per slot'), fmtInt(e.ctx) + ' ' + t('tokens'), true]);
  if (e.slots > 0) rows.push([t('Slots'), e.slotsBusy == null ? String(e.slots) : t('{busy} busy of {total}', { busy: e.slotsBusy, total: e.slots }), true]);
  rows.push([t('Image input'), e.vision ? t('yes') : t('no')]);
  if (e.models?.length) rows.push([t('Loaded'), e.models.map(m => m.id).join(', '), true]);
  return (
    <>
      <KV items={rows} />
      {e.slotsHidden && <div className="cp-hint">{t('This server was started with slot reporting off, so occupancy cannot be read.')}</div>}
    </>
  );
}

function Discover({ providerId, onClose, onAdded }) {
  const [state, setState] = useState({ loading: true, error: '', list: [] });

  const load = useCallback(async () => {
    setState({ loading: true, error: '', list: [] });
    try {
      const r = await api.get('/api/admin/discover-models?provider=' + encodeURIComponent(providerId));
      setState({ loading: false, error: '', list: r.models || [] });
    } catch (e) {
      setState({ loading: false, error: e?.message || t('The backend did not answer.'), list: [] });
    }
  }, [providerId]);

  useEffect(() => { load(); }, [load]);

  async function add(id) {
    setState(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, busy: true } : x)) }));
    try {
      await api.post('/api/admin/models', { display_name: id, internal_name: id, provider_id: providerId });
      setState(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, added: true, busy: false } : x)) }));
      onAdded();
    } catch {
      setState(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, busy: false } : x)) }));
    }
  }

  return (
    <Dialog title={t('Models this backend reports')} onClose={onClose}
      foot={<>
        <Btn onClick={load} disabled={state.loading}>{t('Refresh')}</Btn>
        <div className="cp-spacer" />
        <Btn kind="primary" onClick={onClose}>{t('Done')}</Btn>
      </>}>
      <p className="cp-hint" style={{ marginTop: 0 }}>
        {t('Adding one creates a catalog entry bound to this provider. It behaves like any other entry afterwards, so you can rename, hide, or delete it.')}
      </p>
      {state.loading && <Empty icon={Cube} title={t('Asking the backend')} />}
      {state.error && <div className="cp-err">{state.error}</div>}
      {!state.loading && !state.error && state.list.length === 0 && (
        <Empty icon={Cube} title={t('Nothing reported')}>{t('The backend answered but listed no models.')}</Empty>
      )}
      {state.list.length > 0 && (
        <Table head={[{ label: t('Model id'), mono: true }, { label: '', fit: true }]}>
          {state.list.map(x => (
            <tr key={x.id}>
              <td className="mono">{x.id}</td>
              <td className="acts">
                {x.added
                  ? <Badge tone="good">{t('added')}</Badge>
                  : <Btn size="sm" disabled={x.busy} onClick={() => add(x.id)}>{x.busy ? t('Adding…') : t('Add')}</Btn>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Dialog>
  );
}

export default function ProvidersSection() {
  const { catalog, confirm } = useAdmin();
  const { providers, providerTypes, models, patchProvider, addProvider, removeProvider, probeProvider, probe, reload } = catalog;
  const [discover, setDiscover] = useState(null);

  function del(p) {
    confirm({
      title: t('Delete connection'),
      message: t('Models bound to this connection will have no backend to run through until you point them somewhere else.'),
      confirm: t('Delete connection'),
      onConfirm: () => removeProvider(p.id)
    });
  }

  if (providers.length === 0) {
    return (
      <Empty icon={Sliders} title={t('No connections')}
        actions={<Btn kind="primary" onClick={addProvider}><Plus /> {t('Add connection')}</Btn>}>
        {t('A connection is one base URL the server talks to. Every model in the catalog runs through one.')}
      </Empty>
    );
  }

  return (
    <>
      {providers.map((p, i) => {
        const type = providerTypes[p.type] || {};
        const state = probe[p.id];
        const attached = models.filter(m => (m.provider_id || providers[0]?.id) === p.id).length;
        return (
          <Card key={p.id}
            title={p.name || t('Connection {n}', { n: i + 1 })}
            sub={t('{type} · {n} models bound', { type: type.label || p.type, n: attached })}
            actions={<>
              {state && !state.busy && (state.ok
                ? <Badge tone="good">{t('reachable · {n} models', { n: state.count })}</Badge>
                : <Badge tone="bad">{state.error}</Badge>)}
              <Btn size="sm" disabled={state?.busy} onClick={() => probeProvider(p.id)}>
                {state?.busy ? t('Testing…') : t('Test')}
              </Btn>
              <Btn size="sm" onClick={() => setDiscover(p.id)}><Cube /> {t('Discover')}</Btn>
              <IconBtn kind="danger" label={t('Delete connection')} disabled={providers.length <= 1}
                onClick={() => del(p)}><Trash /></IconBtn>
            </>}>
            <Fields cols={2}>
              <Field label={t('Name')}>
                <Input value={p.name || ''} placeholder={t('local')}
                  onChange={(e) => patchProvider(p.id, { name: e.target.value })} />
              </Field>
              <Field label={t('Type')} hint={t('Decides which request shape and endpoints the server uses.')}>
                <Select value={p.type} onChange={(v) => patchProvider(p.id, { type: v })} label={t('Type')}
                  options={Object.entries(providerTypes).map(([k, v]) => ({ value: k, label: v.label }))} />
              </Field>
              <Field label={t('Base URL')} hint={t('No trailing slash. The server appends the endpoint path itself.')}>
                <Input mono value={p.base_url || ''} placeholder={type.defaultBaseUrl || ''}
                  onChange={(e) => patchProvider(p.id, { base_url: e.target.value })} />
              </Field>
              <Field label={t('API key')} optional={!!type.keyOptional}
                hint={t('Held server-side and never sent to the browser.')}>
                <Input mono type="password" value={p.api_key || ''} autoComplete="off"
                  placeholder={type.keyOptional ? t('not needed locally') : t('required')}
                  onChange={(e) => patchProvider(p.id, { api_key: e.target.value })} />
              </Field>
            </Fields>
            {state?.engine?.ok && <Engine e={state.engine} />}
          </Card>
        );
      })}

      <Acts>
        <Btn onClick={addProvider}><Plus /> {t('Add connection')}</Btn>
      </Acts>

      {discover && <Discover providerId={discover} onClose={() => setDiscover(null)} onAdded={reload} />}
    </>
  );
}
