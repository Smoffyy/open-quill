import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { t } from '../../i18n.jsx';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';
import { Skel, SkelRows } from '../ui/Skeleton.jsx';

const num = (n) => Number(n || 0).toLocaleString();

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

  return (
    <Dialog className="ctx-inspect" overlayClassName="ctx-inspect-overlay" labelledBy="ctx-title" onClose={onClose}>
      <div className="ctx-inspect-head">
        <div id="ctx-title">{t("Context inspector")}</div>
        <CloseButton plain className="ctx-x" onClick={onClose} />
      </div>
      {!data ? <Skel when><SkelRows className="ctx-skel" count={6} /></Skel>
        : data.error ? <div className="cmp-note ctx-error" role="alert">{t("Could not load context.")}</div> : (
        <div className="ctx-inspect-body">
          <div className="ctx-summary">
            <span><b>{t('{n} tokens', { n: num(data.totalTokens) })}</b>{data.limit ? ` / ${num(data.limit)} (${data.pct}%)` : ''}</span>
          </div>
          <div className="ctx-flags">
            {data.flags.memoryBank && <span className="ctx-flag">{t("Memory bank on")}</span>}
            {data.flags.webSearch && <span className="ctx-flag">{t("Web search available")}</span>}
            {data.flags.summary && <span className="ctx-flag">{t("Older turns compacted")}</span>}
          </div>
          <div className="ctx-segs">
            {data.segments.map(s => (
              <div key={s.index} className={'ctx-seg role-' + s.role}>
                <div className="ctx-seg-head">
                  <span className="ctx-role">{s.role}</span>
                  <span className="ctx-seg-meta">
                    {[t('{n} tokens', { n: num(s.tokens) }), t('{n} characters', { n: num(s.chars) }), s.hasImages ? t('Image') : ''].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="ctx-seg-prev">{s.preview || t('(empty)')}{s.chars > 600 ? '…' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
