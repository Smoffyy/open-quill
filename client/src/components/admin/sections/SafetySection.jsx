import React, { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card, AutosaveNote, SegPick, SettingRow } from '../widgets.jsx';
import { Shield } from '../../icons.jsx';

export default function SafetySection() {
  const A = useAdmin();
  const { settings, setSettings, settingsSave, models, setAsk } = A;
  const [log, setLog] = useState(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    (async () => { try { const d = await api.get('/api/admin/safety-log'); setLog(d.entries || []); setTotal(d.total || 0); } catch {} })();
  }, []);

  function clearLog() {
    setAsk({
      message: 'Clear the entire safety log?', danger: 'Clear log',
      onConfirm: async () => { try { await api.del('/api/admin/safety-log'); setLog([]); setTotal(0); } catch {} }
    });
  }

  return (
    <>
      <Card title="Safety model" sub="Every prompt is screened by a model before it reaches the assistant. Flagged prompts are blocked and the user is asked to revise them.">
        <SettingRow last={!settings.safetyEnabled} label="Enable safety checks" note="When on, user prompts are sent to the safety model first. If it answers No, the prompt never reaches the assistant and a banner appears in the input bar."
          on={!!settings.safetyEnabled} onToggle={() => setSettings(s => ({ ...s, safetyEnabled: !s.safetyEnabled }))} />
        {settings.safetyEnabled && (
          <SettingRow label="Verbose" note={'Shows a "Safety check…" status in the input bar while the prompt is being screened. When off, the check runs silently in the background.'}
            on={!!settings.safetyVerbose} onToggle={() => setSettings(s => ({ ...s, safetyVerbose: !s.safetyVerbose }))} />
        )}
        {settings.safetyEnabled && (
          <SettingRow last label="Show a reason" note="Lets the safety model include a short explanation of why a prompt was blocked, shown in the banner instead of the generic message. The reason instruction is appended to the system prompt below, so your edits are kept."
            on={!!settings.safetyReasonEnabled} onToggle={() => setSettings(s => ({ ...s, safetyReasonEnabled: !s.safetyReasonEnabled }))} />
        )}
      </Card>
      {settings.safetyEnabled && (
        <Card title="Model" sub="Which model performs the screening.">
          <div className="field"><label>Checked by</label>
            <SegPick value={settings.safetyModelMode || 'current'} options={[['current', 'Currently loaded model'], ['specific', 'Specific model']]}
              onChange={(v) => setSettings(s => ({ ...s, safetyModelMode: v }))} />
            <div className="muted-note">Currently loaded uses whatever model the user is chatting with. Specific always routes the check through one dedicated model.</div>
          </div>
          {settings.safetyModelMode === 'specific' && (
            <div className="field"><label>Safety model</label>
              <select value={settings.safetyModelId || ''} onChange={(e) => setSettings(s => ({ ...s, safetyModelId: e.target.value }))}>
                <option value="">Select a model…</option>
                {models.map(m => <option key={m.id} value={m.id}>{m.display_name || m.internal_name}</option>)}
              </select>
              <div className="muted-note">If the selected model is removed, checks fall back to the currently loaded model.</div>
            </div>
          )}
        </Card>
      )}
      <Card title="Safety log" sub={`Prompts the safety model blocked${total ? `, ${total} total` : ''}. Use these to tune the system prompt and catch false positives.`}
        right={log && log.length ? <button className="btn ghost danger" onClick={clearLog}>Clear log</button> : null}>
        {log == null && <div className="muted-note">Loading…</div>}
        {log != null && log.length === 0 && <div className="muted-note">Nothing has been flagged yet.</div>}
        {(log || []).map(e => (
          <div key={e.id} className="fn-card fb-card" style={{ marginBottom: 8 }}>
            <div className="fb-rating down"><Shield style={{ width: 15 }} /></div>
            <div className="fn-card-main">
              <div className="fn-card-title">{e.user} <span className="muted-note" style={{ display: 'inline' }}>· {e.model} · {new Date(e.ts).toLocaleString()}</span></div>
              <div className="fn-card-desc">{e.snippet || '(empty prompt)'}</div>
              {e.reason && <div className="fn-card-desc" style={{ fontStyle: 'italic' }}>Reason: {e.reason}</div>}
            </div>
          </div>
        ))}
      </Card>
      {settings.safetyEnabled && (
        <Card title="System prompt" sub="The instructions sent to the safety model along with the user's prompt.">
          <div className="field"><label>Prompt</label>
            <textarea rows={7} value={settings.safetyPrompt ?? ''} onChange={(e) => setSettings(s => ({ ...s, safetyPrompt: e.target.value }))} />
            <div className="muted-note">The model must reply with JSON only, e.g. <code>{'{"verdict":"Yes"}'}</code> to allow or <code>{'{"verdict":"No"}'}</code> to block. Clearing the field restores the default prompt.{settings.safetyReasonEnabled ? <> With reasons on, an instruction asking for <code>{'{"verdict":"No","reason":"…"}'}</code> is appended on a new line automatically.</> : null}</div>
          </div>
        </Card>
      )}
      <AutosaveNote status={settingsSave} live />
    </>
  );
}
