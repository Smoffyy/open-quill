import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api.js';
import { ThumbUp, ThumbDown } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

export default function FeedbackSection() {
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({ up: 0, down: 0 });
  const [offset, setOffset] = useState(0);

  const load = useCallback(async (off = 0) => {
    try {
      const d = await api.get('/api/admin/feedback?offset=' + off);
      setRows(d.feedback || []);
      setCounts(d.counts || { up: 0, down: 0 });
      setOffset(off);
    } catch {}
  }, []);

  useEffect(() => { load(0); }, [load]);

  return (
    <>
      <div className="admin-section-head">
        <div><div className="muted-note">{t("Ratings users left on assistant responses. Use them to spot weak prompts, tune the safety model, or compare models.")}</div></div>
        <div className="fb-totals">
          <span className="fb-total up"><ThumbUp style={{ width: 14 }} /> {counts.up}</span>
          <span className="fb-total down"><ThumbDown style={{ width: 14 }} /> {counts.down}</span>
        </div>
      </div>
      <div className="fn-list">
        {rows == null && <div className="muted-note">{t("Loading…")}</div>}
        {rows != null && rows.length === 0 && <div className="muted-note">{t("No feedback yet.")}</div>}
        {(rows || []).map(f => (
          <div key={f.id} className="fn-card fb-card">
            <div className={'fb-rating ' + (f.rating === 1 ? 'up' : 'down')}>{f.rating === 1 ? <ThumbUp style={{ width: 15 }} /> : <ThumbDown style={{ width: 15 }} />}</div>
            <div className="fn-card-main">
              <div className="fn-card-title">{f.user} <span className="muted-note" style={{ display: 'inline' }}>· {f.model} · {new Date(f.ts).toLocaleString()}</span></div>
              <div className="fn-card-desc">{f.snippet || '(empty response)'}</div>
              {f.comment && <div className="fn-card-desc" style={{ fontStyle: 'italic' }}>“{f.comment}”</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="editor-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn" disabled={offset === 0} onClick={() => load(Math.max(0, offset - 50))}>{t("Newer")}</button>
        <button className="btn" disabled={(rows || []).length < 50} onClick={() => load(offset + 50)}>{t("Older")}</button>
      </div>
    </>
  );
}
