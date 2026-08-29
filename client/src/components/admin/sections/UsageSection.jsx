import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api.js';
import { Block, Fields, Field, Input, Seg, Btn, Table, Stats, Empty, fmtInt, fmtMoney } from '../ui.jsx';
import { Plus, Trash } from '../../icons.jsx';
import { t, tk } from '../../../i18n.jsx';

const FAILURES = {
  __proto__: null,
  cut_off: tk('call truncated'),
  unknown_tool: tk('unknown tool name'),
  missing_arg: tk('missing argument'),
  no_match: tk('edit matched nothing'),
  blocked: tk('blocked by sandbox boundary'),
  missing_program: tk('program not installed'),
  not_found: tk('file not found'),
  timeout: tk('timed out'),
  too_big: tk('output too large'),
  nonzero_exit: tk('non-zero exit'),
  other: tk('other')
};

function Reliability() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState('');

  const load = useCallback(async () => {
    try { setData(await api.get('/api/admin/tool-stats')); }
    catch { setData({ rows: [], totals: { calls: 0, fail: 0 } }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return null;
  const { rows, totals } = data;
  const rate = Math.round((totals.fail / Math.max(1, totals.calls)) * 100);

  return (
    <Block title={t('Tool reliability')}
      sub={t('Every tool call this workspace has made. A high failure rate usually means the tool description is unclear to the model, not that the tool is broken.')}
      actions={rows.length ? <Btn size="sm" onClick={async () => { try { await api.del('/api/admin/tool-stats'); load(); } catch {} }}>{t('Reset counters')}</Btn> : null}>
      {!rows.length
        ? <Empty title={t('No tool calls yet')}>{t('Counts appear here once a model starts calling tools.')}</Empty>
        : (
          <>
            <Stats items={[
              { k: t('Calls'), v: fmtInt(totals.calls) },
              { k: t('Failures'), v: fmtInt(totals.fail) },
              { k: t('Failure rate'), v: rate + '%' }
            ]} />
            <div style={{ marginTop: 14 }}>
              <Table head={[
                { label: t('Tool'), mono: true },
                { label: t('Model') },
                { label: t('Calls'), num: true, fit: true },
                { label: t('Failed'), num: true, fit: true },
                { label: t('Rate'), num: true, fit: true }
              ]}>
                {rows.slice(0, 40).map(r => {
                  const id = r.modelId + '|' + r.tool;
                  const isOpen = open === id;
                  return (
                    <React.Fragment key={id}>
                      <tr onClick={() => r.fail && setOpen(isOpen ? '' : id)} style={{ cursor: r.fail ? 'pointer' : 'default' }}>
                        <td className="mono">{r.tool}</td>
                        <td className="dim">{r.modelName || '—'}</td>
                        <td className="num mono">{fmtInt(r.calls)}</td>
                        <td className="num mono">{fmtInt(r.fail)}</td>
                        <td className="num mono">{Math.round(r.rate * 100)}%</td>
                      </tr>
                      {isOpen && r.fail > 0 && (
                        <tr>
                          <td colSpan={5} className="dim">
                            {r.kinds.map(k => <div key={k.kind}>{k.n}× {t(FAILURES[k.kind] || FAILURES.other)}</div>)}
                            {r.lastError && <div style={{ marginTop: 6 }}>{t('Last error')}: <code className="cp-code">{r.lastError}</code></div>}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </Table>
            </div>
          </>
        )}
    </Block>
  );
}

function Pricing() {
  const [presets, setPresets] = useState([]);
  const [form, setForm] = useState({ match: '', label: '', in: '', out: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const r = await api.get('/api/admin/pricing/presets'); setPresets(r.custom || []); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setError('');
    try {
      const r = await api.post('/api/admin/pricing/presets', {
        match: form.match, label: form.label, in: Number(form.in), out: Number(form.out)
      });
      setPresets(r.custom || []);
      setForm({ match: '', label: '', in: '', out: '' });
    } catch (e) { setError(e?.message || t('Could not save that preset.')); }
  }

  return (
    <Block title={t('Price table')}
      sub={t('When a model id contains one of these fragments, its price is filled in automatically. Built-in fragments for the major hosted families always apply unless a rule here overrides them. Prices are per million tokens.')}>
      {presets.length > 0 && (
        <Table head={[
          { label: t('Fragment'), mono: true },
          { label: t('Label') },
          { label: t('In'), num: true, fit: true },
          { label: t('Out'), num: true, fit: true },
          { label: '', fit: true }
        ]}>
          {presets.map(p => (
            <tr key={p.match}>
              <td className="mono">{p.match}</td>
              <td>{p.label}</td>
              <td className="num mono">${p.in}</td>
              <td className="num mono">${p.out}</td>
              <td className="acts">
                <Btn kind="danger" size="sm" aria-label={t('Remove')} title={t('Remove')}
                  onClick={async () => { try { const r = await api.del('/api/admin/pricing/presets/' + encodeURIComponent(p.match)); setPresets(r.custom || []); } catch {} }}>
                  <Trash />
                </Btn>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div style={{ marginTop: presets.length ? 14 : 0 }}>
        <Fields cols={4}>
          <Field label={t('Id fragment')}>
            <Input mono value={form.match} placeholder="my-model" onChange={(e) => setForm(f => ({ ...f, match: e.target.value }))} />
          </Field>
          <Field label={t('Label')}>
            <Input value={form.label} placeholder={t('House model')} onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))} />
          </Field>
          <Field label={t('Input $/M')}>
            <Input type="number" step="any" min="0" value={form.in} onChange={(e) => setForm(f => ({ ...f, in: e.target.value }))} />
          </Field>
          <Field label={t('Output $/M')}>
            <Input type="number" step="any" min="0" value={form.out} onChange={(e) => setForm(f => ({ ...f, out: e.target.value }))} />
          </Field>
        </Fields>
        <div className="cp-acts" style={{ marginTop: 12 }}>
          <Btn onClick={add} disabled={!form.match.trim() || !form.label.trim()}><Plus /> {t('Add rule')}</Btn>
        </div>
        {error && <div className="cp-err">{error}</div>}
      </div>
    </Block>
  );
}

export default function UsageSection() {
  const [days, setDays] = useState('30');
  const [usage, setUsage] = useState(null);

  const load = useCallback(async (d) => {
    try { setUsage(await api.get('/api/admin/usage?days=' + d)); } catch { setUsage(null); }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  return (
    <>
      <Block>
        <Seg value={days} label={t('Reporting window')} onChange={setDays}
          options={[{ value: '7', label: t('7 days') }, { value: '30', label: t('30 days') }, { value: '90', label: t('90 days') }]} />
        <div style={{ marginTop: 14 }}>
          {!usage
            ? <Empty title={t('Loading')} />
            : (
              <Stats items={[
                { k: t('Tokens'), v: fmtInt(usage.totals.total) },
                { k: t('Estimated'), v: fmtMoney(usage.totals.cost), n: t('from the price table below') },
                { k: t('Generations'), v: fmtInt(usage.totals.generations) },
                { k: t('Active members'), v: fmtInt(usage.totals.users) }
              ]} />
            )}
        </div>
      </Block>

      {usage && usage.users.length > 0 && (
        <Block title={t('By member')}>
          <Table head={[{ label: t('Member') }, { label: t('Tokens'), num: true }, { label: t('Estimated'), num: true }]}>
            {usage.users.slice(0, 30).map(u => (
              <tr key={u.userId}>
                <td>{u.name}</td>
                <td className="num mono">{fmtInt(u.prompt + u.completion)}</td>
                <td className="num mono">{u.cost ? fmtMoney(u.cost) : <span className="dim">—</span>}</td>
              </tr>
            ))}
          </Table>
        </Block>
      )}

      {usage && usage.models.length > 0 && (
        <Block title={t('By model')}>
          <Table head={[{ label: t('Model') }, { label: t('Tokens'), num: true }, { label: t('Estimated'), num: true }]}>
            {usage.models.slice(0, 30).map(m => (
              <tr key={m.modelId}>
                <td>{m.name}</td>
                <td className="num mono">{fmtInt(m.prompt + m.completion)}</td>
                <td className="num mono">{m.cost ? fmtMoney(m.cost) : <span className="dim">—</span>}</td>
              </tr>
            ))}
          </Table>
        </Block>
      )}

      <Reliability />
      <Pricing />
    </>
  );
}
