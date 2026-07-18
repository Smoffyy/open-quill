import React from 'react';
import { useAdmin } from '../store.jsx';
import { Card } from '../widgets.jsx';
import { Cube, Plus, Trash } from '../../icons.jsx';

export default function ProvidersSection() {
  const A = useAdmin();
  const { providers, providerTypes, provTest, models } = A;
  return (
    <div className="provider-list">
      {providers.map((p, idx) => {
        const t = providerTypes[p.type] || {};
        const test = provTest[p.id];
        const count = models.filter(m => (m.provider_id || providers[0]?.id) === p.id).length;
        return (
          <Card key={p.id} className="provider-card2"
            title={p.name || 'Provider ' + (idx + 1)}
            sub={`${t.label || p.type}${count ? ` · ${count} model${count === 1 ? '' : 's'} attached` : ''}`}
            right={test && !test.busy && (
              test.ok
                ? <span className="pv-status ok">Reachable · {test.count} model{test.count === 1 ? '' : 's'}</span>
                : <span className="pv-status err">{test.err}</span>
            )}>
            <div className="two-col">
              <div className="field"><label>Name</label>
                <input value={p.name || ''} onChange={(e) => A.patchProvider(p.id, { name: e.target.value })} placeholder="My provider" /></div>
              <div className="field"><label>Provider type</label>
                <select value={p.type} onChange={(e) => A.patchProvider(p.id, { type: e.target.value })}>
                  {Object.entries(providerTypes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select></div>
            </div>
            <div className="field"><label>API base URL</label>
              <input value={p.base_url || ''} onChange={(e) => A.patchProvider(p.id, { base_url: e.target.value })} placeholder={t.defaultBaseUrl || ''} /></div>
            <div className="field"><label>API key {t.keyOptional && <span className="muted-note" style={{ display: 'inline' }}>(optional)</span>}</label>
              <input value={p.api_key || ''} onChange={(e) => A.patchProvider(p.id, { api_key: e.target.value })} placeholder={t.keyOptional ? 'Not required for local servers' : 'Required'} /></div>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => A.testProvider(p.id)} disabled={test?.busy}>{test?.busy ? 'Testing…' : 'Test connection'}</button>
              <button className="btn ghost" onClick={() => A.openDiscover(p.id)}><Cube style={{ width: 13, verticalAlign: '-2px' }} /> Discover models</button>
              <button className="btn danger" disabled={providers.length <= 1} onClick={() => A.deleteProvider(p.id)}><Trash style={{ width: 13 }} /></button>
            </div>
          </Card>
        );
      })}
      <button className="btn add-model" onClick={A.addProvider}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> Add provider</button>
    </div>
  );
}
