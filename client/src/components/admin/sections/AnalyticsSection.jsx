import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card, fmtMoney } from '../widgets.jsx';
import { Plus, Trash } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

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
    } catch (e) { setErr(e?.message || 'Could not save preset.'); }
  }
  async function delPreset(match) {
    try { const r = await api.del('/api/admin/pricing/presets/' + encodeURIComponent(match)); setPresets(r.custom || []); } catch {}
  }

  return (
    <>
      <div className="seg" style={{ width: 'fit-content', marginBottom: 14 }}>
        {[['7', '7 days'], ['30', '30 days'], ['90', '90 days']].map(([v, l]) => (
          <button key={v} className={usageDays === v ? 'on' : ''} onClick={() => { setUsageDays(v); loadUsage(v); }}>{l}</button>
        ))}
      </div>
      {!usage && <div className="muted-note">{t("Loading…")}</div>}
      {usage && (
        <>
          <div className="stat-grid">
            {[['Total tokens', usage.totals.total.toLocaleString()], ['Est. cost', '$' + usage.totals.cost.toFixed(2)], ['Generations', usage.totals.generations.toLocaleString()], ['Active users', String(usage.totals.users)]].map(([l, v]) => (
              <div key={l} className="stat-card">
                <div className="sc-v">{v}</div>
                <div className="sc-l">{l}</div>
              </div>
            ))}
          </div>
          {usage.users.length > 0 && (
            <Card title={t("By user")}>
              <table className="aq-table">
                <thead><tr><th>User</th><th className="num">Tokens</th><th className="num">Cost</th></tr></thead>
                <tbody>{usage.users.slice(0, 30).map(u => (
                  <tr key={u.userId}>
                    <td>{u.name}</td>
                    <td className="num">{(u.prompt + u.completion).toLocaleString()}</td>
                    <td className="num">{u.cost ? fmtMoney(u.cost) : ', '}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Card>
          )}
          {usage.models.length > 0 && (
            <Card title={t("By model")}>
              <table className="aq-table">
                <thead><tr><th>Model</th><th className="num">Tokens</th><th className="num">Cost</th></tr></thead>
                <tbody>{usage.models.slice(0, 30).map(m => (
                  <tr key={m.modelId}>
                    <td>{m.name}</td>
                    <td className="num">{(m.prompt + m.completion).toLocaleString()}</td>
                    <td className="num">{m.cost ? fmtMoney(m.cost) : ', '}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Card>
          )}
        </>
      )}
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
          <button className="btn" onClick={addPreset}><Plus style={{ width: 14, verticalAlign: '-2px' }} /> Add</button>
        </div>
        {err && <div className="dz-err" style={{ marginTop: 8 }}>{err}</div>}
      </Card>
    </>
  );
}
