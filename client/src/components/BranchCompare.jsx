import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Markdown from './Markdown.jsx';

export default function BranchCompare({ chatId, messageId, onSelect, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let on = true;
    api.get('/api/chats/' + chatId + '/siblings/' + messageId)
      .then(d => { if (on) setData(d); })
      .catch(() => { if (on) setErr(true); });
    return () => { on = false; };
  }, [chatId, messageId]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const sibs = data?.siblings || [];

  return (
    <div className="bc-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bc-modal">
        <div className="bc-head">
          <div>Compare versions{sibs.length ? ` · ${sibs.length}` : ''}</div>
          <button className="bc-x" onClick={onClose}>✕</button>
        </div>
        {err ? <div className="bc-empty">Could not load versions.</div>
          : !data ? <div className="bc-empty">Loading…</div>
          : sibs.length < 2 ? <div className="bc-empty">This message has only one version.</div>
          : (
            <div className="bc-cols" style={{ gridTemplateColumns: `repeat(${sibs.length}, minmax(260px, 1fr))` }}>
              {sibs.map(s => (
                <div key={s.id} className={'bc-col' + (s.id === data.activeId ? ' active' : '')}>
                  <div className="bc-col-head">
                    <span className="bc-col-n">#{s.index + 1}</span>
                    {s.modelName && <span className="bc-col-model">{s.modelName}</span>}
                    {s.id === data.activeId && <span className="bc-col-cur">current</span>}
                  </div>
                  <div className="bc-col-body"><Markdown>{s.content || '(empty)'}</Markdown></div>
                  <div className="bc-col-foot">
                    <button className="bc-use" disabled={s.id === data.activeId} onClick={() => { onSelect?.(s.id); onClose(); }}>
                      {s.id === data.activeId ? 'In use' : 'Use this version'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
