import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../api.js';
import { Download } from '../../icons.jsx';

export default function AuditSection() {
  const [audit, setAudit] = useState({ entries: [], total: 0, offset: 0, hasMore: false, loading: false, actions: [] });
  const [filter, setFilter] = useState({ action: '', actor: '', days: '' });
  const filterRef = useRef(filter);
  useEffect(() => { filterRef.current = filter; }, [filter]);

  const load = useCallback(async (offset = 0, filterOverride) => {
    const f = filterOverride || filterRef.current;
    setAudit(a => ({ ...a, loading: true }));
    try {
      const params = new URLSearchParams({ limit: '60', offset: String(offset) });
      if (f.action) params.set('action', f.action);
      if (f.actor) params.set('actor', f.actor);
      if (f.days) params.set('days', f.days);
      const d = await api.get('/api/admin/audit?' + params.toString());
      setAudit(a => ({ entries: offset ? [...a.entries, ...d.entries] : d.entries, total: d.total, offset, hasMore: d.hasMore, loading: false, actions: d.actions || a.actions }));
    } catch { setAudit(a => ({ ...a, loading: false })); }
  }, []);

  useEffect(() => { load(0); }, [load]);

  return (
    <>
      <div className="hint">{audit.total > 0 ? `Showing ${audit.entries.length} of ${audit.total} entries.` : ''}</div>
      <div className="audit-filters">
        <select value={filter.action} onChange={(e) => { const action = e.target.value; setFilter(f => ({ ...f, action })); load(0, { ...filter, action }); }}>
          <option value="">All actions</option>
          {(audit.actions || []).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input placeholder="Filter by actor email" value={filter.actor}
          onChange={(e) => setFilter(f => ({ ...f, actor: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') load(0); }} />
        <select value={filter.days} onChange={(e) => { const days = e.target.value; setFilter(f => ({ ...f, days })); load(0, { ...filter, days }); }}>
          <option value="">Any time</option>
          <option value="1">Last 24h</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <button className="btn ghost" onClick={() => load(0)}>Apply</button>
        <button className="btn ghost" onClick={() => { window.location.href = '/api/admin/audit/export'; }}><Download style={{ width: 14, verticalAlign: '-2px' }} /> Export CSV</button>
      </div>
      {audit.entries.length === 0 && !audit.loading && <div className="muted-note">No audit entries match.</div>}
      {audit.entries.length > 0 && (
        <div className="audit-list">
          {audit.entries.map(e => (
            <div key={e.id} className="audit-row">
              <span className="au-ts">{new Date(e.ts).toLocaleString()}</span>
              <span className="au-action">{e.action}</span>
              <span className="au-meta">
                {e.actorEmail}{e.meta ? ' · ' + (typeof e.meta === 'object' ? Object.entries(e.meta).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') : v}`).join(', ') : String(e.meta)) : ''}
              </span>
              {e.ip && <span className="au-ip">{e.ip}</span>}
            </div>
          ))}
          {audit.hasMore && <button className="btn ghost audit-more" disabled={audit.loading} onClick={() => load(audit.offset + 60)}>{audit.loading ? 'Loading…' : 'Load more'}</button>}
        </div>
      )}
    </>
  );
}
