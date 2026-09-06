import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api.js';
import { Card, Fields, Field, Input, Seg, Btn, IconBtn, Acts, Table, Stats, Empty, fmtInt, fmtMoney } from '../ui.jsx';
import { Plus, Trash, Wave } from '../../icons.jsx';
import { t, tk } from '../../../i18n.jsx';

const TOP_ROWS = 30;
const TOP_TOOLS = 40;

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

function Breakdown({ head, rows }) {
  return (
    <Table head={[{ label: head }, { label: t('Tokens'), num: true }, { label: t('Estimated'), num: true }]}>
      {rows.map(r => (
        <tr key={r.key}>
          <td>{r.name}</td>
          <td className="num mono">{fmtInt(r.tokens)}</td>
          <td className="num mono">{r.cost ? fmtMoney(r.cost) : <span className="dim">—</span>}</td>
        </tr>
      ))}
    </Table>
  );
}

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
    <Card title={t('Tool reliability')} flush={!!rows.length}
      sub={t('Every tool call this workspace has made. A high failure rate usually means the tool description is unclear to the model, not that the tool is broken.')}
      actions={rows.length
        ? <Btn size="sm" onClick={async () => { try { await api.del('/api/admin/tool-stats'); load(); } catch {} }}>{t('Reset counters')}</Btn>
        : null}>
      {!rows.length
        ? <Empty icon={Wave} title={t('No tool calls yet')}>{t('Counts appear here once a model starts calling tools.')}</Empty>
        : (
          <Table head={[
            { label: t('Tool'), mono: true },
            { label: t('Model') },
            { label: t('Calls'), num: true, fit: true },
            { label: t('Failed'), num: true, fit: true },
            { label: t('Rate'), num: true, fit: true }
          ]}>
            <tr>
              <td colSpan={2} className="dim">{t('All tools')}</td>
              <td className="num mono">{fmtInt(totals.calls)}</td>
              <td className="num mono">{fmtInt(totals.fail)}</td>
              <td className="num mono">{rate}%</td>
            </tr>
            {rows.slice(0, TOP_TOOLS).map(r => {
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
                      <td colSpan={5} className="dim wrap">
                        {r.kinds.map(k => <div key={k.kind}>{k.n}× {t(FAILURES[k.kind] || FAILURES.other)}</div>)}
                        {r.lastError && <div>{t('Last error')}: <code className="cp-code">{r.lastError}</code></div>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Table>
        )}
    </Card>
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

  async function remove(match) {
    try {
      const r = await api.del('/api/admin/pricing/presets/' + encodeURIComponent(match));
      setPresets(r.custom || []);
    } catch {}
  }

  const field = (key, extra) => (
    <Input value={form[key]} {...extra}
      onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))} />
  );

  return (
    <Card title={t('Price table')}
      sub={t('When a model id contains one of these fragments, its price is filled in automatically. Built-in fragments for the major hosted families always apply unless a rule here overrides them. Prices are per million tokens.')}
      foot={<>
        {error && <span className="cp-err">{error}</span>}
        <span className="cp-toolbar-spacer" />
        <Btn kind="primary" onClick={add} disabled={!form.match.trim() || !form.label.trim()}>
          <Plus /> {t('Add rule')}
        </Btn>
      </>}>
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
                <Acts end>
                  <IconBtn kind="danger" label={t('Remove')} onClick={() => remove(p.match)}><Trash /></IconBtn>
                </Acts>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Fields cols={4}>
        <Field label={t('Id fragment')}>{field('match', { mono: true, placeholder: 'my-model' })}</Field>
        <Field label={t('Label')}>{field('label', { placeholder: t('House model') })}</Field>
        <Field label={t('Input $/M')}>{field('in', { type: 'number', step: 'any', min: '0' })}</Field>
        <Field label={t('Output $/M')}>{field('out', { type: 'number', step: 'any', min: '0' })}</Field>
      </Fields>
    </Card>
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
      <div className="cp-toolbar">
        <Seg value={days} label={t('Reporting window')} onChange={setDays}
          options={[{ value: '7', label: t('7 days') }, { value: '30', label: t('30 days') }, { value: '90', label: t('90 days') }]} />
      </div>

      {!usage
        ? <Empty icon={Wave} title={t('Loading')} />
        : (
          <Stats items={[
            { k: t('Tokens'), v: fmtInt(usage.totals.total) },
            { k: t('Estimated'), v: fmtMoney(usage.totals.cost), n: t('from the price table below') },
            { k: t('Generations'), v: fmtInt(usage.totals.generations) },
            { k: t('Active members'), v: fmtInt(usage.totals.users) }
          ]} />
        )}

      {usage && usage.users.length > 0 && (
        <Card title={t('By member')} flush>
          <Breakdown head={t('Member')} rows={usage.users.slice(0, TOP_ROWS).map(u => ({
            key: u.userId, name: u.name, tokens: u.prompt + u.completion, cost: u.cost
          }))} />
        </Card>
      )}

      {usage && usage.models.length > 0 && (
        <Card title={t('By model')} flush>
          <Breakdown head={t('Model')} rows={usage.models.slice(0, TOP_ROWS).map(m => ({
            key: m.modelId, name: m.name, tokens: m.prompt + m.completion, cost: m.cost
          }))} />
        </Card>
      )}

      <Reliability />
      <Pricing />
    </>
  );
}
