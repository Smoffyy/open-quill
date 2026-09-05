import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { t } from '../i18n.jsx';

export default function ContextInspector({ chatId, modelId, onClose }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let on = true;
    const q = modelId ? '?modelId=' + encodeURIComponent(modelId) : '';
    api.get('/api/chats/' + chatId + '/inspect' + q)
      .then(d => { if (on) setData(d); })
      .catch(() => { if (on) setData({ error: true }); });
    return () => { on = false; };
  }, [chatId, modelId]);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="ctx-inspect-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ctx-inspect">
        <div className="ctx-inspect-head">
          <div>{t("Context inspector")}</div>
          <button className="ctx-x" onClick={onClose} aria-label={t('Close')}>✕</button>
        </div>
        {!data ? <div className="cmp-note" style={{ padding: 16 }}>{t("Building…")}</div>
          : data.error ? <div className="cmp-note" style={{ padding: 16 }}>{t("Could not load context.")}</div> : (
          <div className="ctx-inspect-body">
            <div className="ctx-summary">
              <span><b>{data.totalTokens.toLocaleString()}</b> tokens{data.limit ? ` / ${data.limit.toLocaleString()} (${data.pct}%)` : ''}</span>
            </div>
            <div className="ctx-flags">
              {data.flags.memoryBank && <span className="ctx-flag">{t("Memory bank on")}</span>}
              {data.flags.webSearch && <span className="ctx-flag">{t("Web search available")}</span>}
              {data.flags.summary && <span className="ctx-flag">{t("Older turns compacted")}</span>}
            </div>
            <div className="ctx-segs">
              {data.segments.map(s => (
                <div key={s.index} className={'ctx-seg role-' + s.role}>
                  <div className="ctx-seg-head"><span className="ctx-role">{s.role}</span><span className="ctx-seg-meta">{s.tokens.toLocaleString()} tok · {s.chars.toLocaleString()} ch{s.hasImages ? ' · img' : ''}</span></div>
                  <div className="ctx-seg-prev">{s.preview || t('(empty)')}{s.chars > 600 ? '…' : ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
