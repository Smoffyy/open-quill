import React from 'react';
import { useAdmin } from '../store.jsx';
import { Card, AutosaveNote, QpIconPicker } from '../widgets.jsx';
import { Plus, Trash } from '../../icons.jsx';

export default function HomeScreenSection() {
  const A = useAdmin();
  const { cfg, setCfg, settingsSave } = A;
  return (
    <>
      <Card title="Greetings" sub="One is shown at random each visit.">
        {cfg.greetings.map((g, i) => (
          <div key={i} className="greeting-row">
            <input value={g} onChange={(e) => setCfg(c => ({ ...c, greetings: c.greetings.map((x, j) => j === i ? e.target.value : x) }))} placeholder="How can I help you?" />
            <button className="btn danger" onClick={() => setCfg(c => ({ ...c, greetings: c.greetings.filter((_, j) => j !== i).length ? c.greetings.filter((_, j) => j !== i) : [''] }))}><Trash style={{ width: 14 }} /></button>
          </div>
        ))}
        <button className="btn" style={{ marginTop: 8 }} onClick={() => setCfg(c => ({ ...c, greetings: [...c.greetings, ''] }))}><Plus style={{ width: 14, verticalAlign: '-2px' }} /> Add greeting</button>
      </Card>
      <Card title="Quick prompt buttons" sub="Shown under the input on the home screen; clicking sends the prompt. Up to 8.">
        {(cfg.quickPrompts || []).map((q, i) => (
          <div key={i} className="qp-row">
            <QpIconPicker value={q.icon || 'none'} onPick={(name) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, icon: name } : x) }))} />
            <input className="qp-label" value={q.label || ''} placeholder="Button label" onChange={(e) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
            <input className="qp-prompt" value={q.prompt || ''} placeholder="Prompt sent when clicked" onChange={(e) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, prompt: e.target.value } : x) }))} />
            <button className="btn danger" onClick={() => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.filter((_, j) => j !== i) }))}><Trash style={{ width: 14 }} /></button>
          </div>
        ))}
        {(cfg.quickPrompts || []).length === 0 && <div className="muted-note" style={{ marginBottom: 6 }}>No quick prompts yet, add one below.</div>}
        {(cfg.quickPrompts || []).length < 8 && <button className="btn" style={{ marginTop: 8 }} onClick={() => setCfg(c => ({ ...c, quickPrompts: [...(c.quickPrompts || []), { icon: 'none', label: '', prompt: '' }] }))}><Plus style={{ width: 14, verticalAlign: '-2px' }} /> Add button</button>}
      </Card>
      <AutosaveNote status={settingsSave} />
    </>
  );
}
