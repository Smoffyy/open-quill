import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card, fmtMoney, SegPick } from '../widgets.jsx';
import { Plus, Trash } from '../../icons.jsx';
import { t, tk } from '../../../i18n.jsx';

const KIND_LABELS = {
  cut_off: tk('Call cut off mid-argument'),
  unknown_tool: tk('Tool name not recognised'),
  missing_arg: tk('Required argument missing'),
  no_match: tk('Edit did not match the file'),
  blocked: tk('Blocked by the workspace boundary'),
  missing_program: tk('Program not installed'),
  not_found: tk('File not found'),
  timeout: tk('Timed out'),
  too_big: tk('Too large'),
  nonzero_exit: tk('Command exited non-zero'),
  other: tk('Other')
};

function ToolReliability() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState('');

  const load = useCallback(async () => {
    try { setData(await api.get('/api/admin/tool-stats')); } catch { setData({ rows: [], totals: { calls: 0, fail: 0 } }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function reset() {
    try { await api.del('/api/admin/tool-stats'); load(); } catch {}
  }

  if (!data) return null;
  const { rows, totals } = data;
  return (
    <Card
      title={t('Tool reliability')}
      sub={t('Every tool call this workspace has run, and how often each one failed. A high failure rate usually means the model needs a clearer tool description, not that the tool is broken.')}
    >
      {!rows.length && <div className="muted-note">{t('No tool calls recorded yet.')}</div>}
      {rows.length > 0 && (
        <>
          <div className="muted-note" style={{ marginBottom: 10 }}>
            {totals.calls.toLocaleString()} {t('calls')} · {totals.fail.toLocaleString()} {t('failed')} ({Math.round((totals.fail / Math.max(1, totals.calls)) * 100)}%)
          </div>
          <table className="aq-table">
            <thead><tr>
              <th>{t('Tool')}</th><th>{t('Model')}</th>
              <th className="num">{t('Calls')}</th><th className="num">{t('Failed')}</th><th className="num">{t('Rate')}</th>
            </tr></thead>
            <tbody>{rows.slice(0, 40).map(r => {
              const id = r.modelId + '|' + r.tool;
              const isOpen = open === id;
              return (
                <React.Fragment key={id}>
                  <tr onClick={() => setOpen(isOpen ? '' : id)} style={{ cursor: r.fail ? 'pointer' : 'default' }}>
                    <td>{r.tool}</td>
                    <td className="muted-note">{r.modelName || '—'}</td>
                    <td className="num">{r.calls.toLocaleString()}</td>
                    <td className="num">{r.fail.toLocaleString()}</td>
                    <td className="num">{Math.round(r.rate * 100)}%</td>
                  </tr>
                  {isOpen && r.fail > 0 && (
                    <tr>
                      <td colSpan={5}>
                        <div className="muted-note">
                          {r.kinds.map(k => (
                            <div key={k.kind}>{k.n}× {t(KIND_LABELS[k.kind] || KIND_LABELS.other)}</div>
                          ))}
                          {r.lastError && <div style={{ marginTop: 6, opacity: 0.8 }}>{t('Last error')}: {r.lastError}</div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}</tbody>
          </table>
          <button className="btn" style={{ marginTop: 12 }} onClick={reset}>{t('Reset counts')}</button>
        </>
      )}
    </Card>
  );
}

export default function AnalyticsSection() {
  const A = useAdmin();
  const { usage, usageDays, setUsageDays, loadUsage } = A;
  const [presets, setPresets] = useState([]);
  const [form, setForm] = useState({ match: '', label: '', in: '', out: '' });
  const [err, setErr] = useState('');

  const loadPresets = useCallback(async () => {
    try { const r = await api.get('/api/admin/pricing/presets'); setPresets(r.custom || []); } catch {}
  }, []);

  useEffect(() => { loadUsage(); loadPresets(); }, []);

  async function addPreset() {
    setErr('');
    try {
      const r = await api.post('/api/admin/pricing/presets', { match: form.match, label: form.label, in: Number(form.in), out: Number(form.out) });
      setPresets(r.custom || []);
      setForm({ match: '', label: '', in: '', out: '' });
    } catch (e) { setErr(e?.message || t('Could not save preset.')); }
  }
  async function delPreset(match) {
    try { const r = await api.del('/api/admin/pricing/presets/' + encodeURIComponent(match)); setPresets(r.custom || []); } catch {}
  }

  return (
    <>
      <SegPick value={usageDays} label={t('Usage window')} style={{ marginBottom: 14 }}
        options={[['7', tk('7 days')], ['30', tk('30 days')], ['90', tk('90 days')]]}
        onChange={(v) => { setUsageDays(v); loadUsage(v); }} />
      {!usage && <div className="muted-note">{t("Loading…")}</div>}
      {usage && (
        <>
          <div className="stat-grid">
            {[[t('Total tokens'), usage.totals.total.toLocaleString()], [t('Est. cost'), '$' + usage.totals.cost.toFixed(2)], [t('Generations'), usage.totals.generations.toLocaleString()], [t('Active users'), String(usage.totals.users)]].map(([l, v]) => (
              <div key={l} className="stat-card">
                <div className="sc-v">{v}</div>
                <div className="sc-l">{l}</div>
              </div>
            ))}
          </div>
          {usage.users.length > 0 && (
            <Card title={t("By user")}>
              <table className="aq-table">
                <thead><tr><th>{t("User")}</th><th className="num">{t("Tokens")}</th><th className="num">{t("Cost")}</th></tr></thead>
                <tbody>{usage.users.slice(0, 30).map(u => (
                  <tr key={u.userId}>
                    <td>{u.name}</td>
                    <td className="num">{(u.prompt + u.completion).toLocaleString()}</td>
                    <td className="num">{u.cost ? fmtMoney(u.cost) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Card>
          )}
          {usage.models.length > 0 && (
            <Card title={t("By model")}>
              <table className="aq-table">
                <thead><tr><th>{t("Model")}</th><th className="num">{t("Tokens")}</th><th className="num">{t("Cost")}</th></tr></thead>
                <tbody>{usage.models.slice(0, 30).map(m => (
                  <tr key={m.modelId}>
                    <td>{m.name}</td>
                    <td className="num">{(m.prompt + m.completion).toLocaleString()}</td>
                    <td className="num">{m.cost ? fmtMoney(m.cost) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Card>
          )}
        </>
      )}
      <ToolReliability />
      <Card title={t("Custom price presets")} sub={'Add house models or override built-in prices. When a model\u2019s ID contains one of these fragments, its price is suggested automatically. Built-in presets (GPT, Claude, Gemini, and so on) always apply unless overridden here.'}>
        {presets.length > 0 && presets.map(p => (
          <div key={p.match} className="field row" style={{ alignItems: 'center' }}>
            <div><label>{p.label}</label><div className="muted-note">matches "{p.match}" · ${p.in} in / ${p.out} out per 1M</div></div>
            <button className="btn danger" onClick={() => delPreset(p.match)}><Trash style={{ width: 14 }} /></button>
          </div>
        ))}
        <div className="preset-form">
          <input placeholder={t("my-model")} value={form.match} onChange={(e) => setForm(f => ({ ...f, match: e.target.value }))} />
          <input placeholder={t("Label")} value={form.label} onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))} />
          <input type="number" step="any" min="0" placeholder={t("$ in")} value={form.in} onChange={(e) => setForm(f => ({ ...f, in: e.target.value }))} />
          <input type="number" step="any" min="0" placeholder={t("$ out")} value={form.out} onChange={(e) => setForm(f => ({ ...f, out: e.target.value }))} />
          <button className="btn" onClick={addPreset}><Plus style={{ width: 14, verticalAlign: '-2px' }} /> {t("Add")}</button>
        </div>
        {err && <div className="dz-err" style={{ marginTop: 8 }}>{err}</div>}
      </Card>
    </>
  );
}
