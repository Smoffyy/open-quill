import { useState, useEffect, useCallback, useRef } from 'react';
import { Block, Fields, Field, Input, Select, Btn, Table, Empty } from '../ui.jsx';
import { api } from '../../../api.js';
import { Download } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

const PAGE = 60;

function meta(m) {
  if (!m) return '';
  if (typeof m !== 'object') return String(m);
  return Object.entries(m).map(([k, v]) => k + '=' + (Array.isArray(v) ? v.join(',') : v)).join('  ');
}

export default function EventsSection() {
  const [state, setState] = useState({ entries: [], total: 0, offset: 0, hasMore: false, loading: true, actions: [] });
  const [filter, setFilter] = useState({ action: '', actor: '', days: '' });
  const live = useRef(filter);
  useEffect(() => { live.current = filter; }, [filter]);

  const load = useCallback(async (offset, override) => {
    const f = override || live.current;
    setState(s => ({ ...s, loading: true }));
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (f.action) p.set('action', f.action);
      if (f.actor) p.set('actor', f.actor);
      if (f.days) p.set('days', f.days);
      const d = await api.get('/api/admin/audit?' + p.toString());
      setState(s => ({
        entries: offset ? [...s.entries, ...d.entries] : d.entries,
        total: d.total, offset, hasMore: d.hasMore, loading: false,
        actions: d.actions || s.actions
      }));
    } catch { setState(s => ({ ...s, loading: false })); }
  }, []);

  useEffect(() => { load(0); }, [load]);

  function apply(patch) {
    const next = { ...filter, ...patch };
    setFilter(next);
    load(0, next);
  }

  return (
    <Block
      sub={state.total > 0 ? t('{shown} of {total} entries', { shown: state.entries.length, total: state.total }) : null}
      actions={<Btn size="sm" onClick={() => { window.location.href = '/api/admin/audit/export'; }}><Download /> {t('Export CSV')}</Btn>}>
      <Fields cols={3}>
        <Field label={t('Action')}>
          <Select value={filter.action} onChange={(v) => apply({ action: v })}
            options={[{ value: '', label: t('Any action') }, ...(state.actions || []).map(a => ({ value: a, label: a }))]} />
        </Field>
        <Field label={t('Actor')}>
          <Input mono value={filter.actor} placeholder={t('email contains…')}
            onChange={(e) => setFilter(f => ({ ...f, actor: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') load(0); }} />
        </Field>
        <Field label={t('Window')}>
          <Select value={filter.days} onChange={(v) => apply({ days: v })}
            options={[
              { value: '', label: t('All time') },
              { value: '1', label: t('Last 24 hours') },
              { value: '7', label: t('Last 7 days') },
              { value: '30', label: t('Last 30 days') }
            ]} />
        </Field>
      </Fields>

      <div style={{ marginTop: 16 }}>
        {state.entries.length === 0 && !state.loading
          ? <Empty title={t('No matching events')}>{t('Widen the filters, or wait for the next admin action to be recorded.')}</Empty>
          : (
            <Table head={[
              { label: t('Time'), fit: true, mono: true },
              { label: t('Action'), fit: true, mono: true },
              { label: t('Actor'), mono: true },
              { label: t('Detail'), mono: true },
              { label: t('Source'), fit: true, mono: true }
            ]}>
              {state.entries.map(e => (
                <tr key={e.id}>
                  <td className="mono dim">{new Date(e.ts).toLocaleString()}</td>
                  <td className="mono">{e.action}</td>
                  <td className="mono">{e.actorEmail}</td>
                  <td className="mono dim">{meta(e.meta)}</td>
                  <td className="mono dim">{e.ip || '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        {state.hasMore && (
          <div className="cp-acts" style={{ marginTop: 14 }}>
            <Btn size="sm" disabled={state.loading} onClick={() => load(state.offset + PAGE)}>
              {state.loading ? t('Loading…') : t('Load {n} more', { n: PAGE })}
            </Btn>
          </div>
        )}
      </div>
    </Block>
  );
}
