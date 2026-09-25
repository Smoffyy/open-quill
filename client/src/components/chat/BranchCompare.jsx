import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import Markdown from './Markdown.jsx';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';
import { t } from '../../i18n.jsx';
import { Skel, SkelLines } from '../ui/Skeleton.jsx';

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

  const sibs = data?.siblings || [];

  return (
    <Dialog className="bc-modal" overlayClassName="bc-overlay" labelledBy="bc-title" onClose={onClose}>
      <div className="bc-head">
        <div id="bc-title">{t("Compare versions")}{sibs.length ? ` · ${sibs.length}` : ''}</div>
        <CloseButton plain className="bc-x" onClick={onClose} />
      </div>
      {err ? <div className="bc-empty">{t("Could not load versions.")}</div>
        : !data ? <Skel when><SkelLines className="bc-skel" count={6} /></Skel>
        : sibs.length < 2 ? <div className="bc-empty">{t("This message has only one version.")}</div>
        : (
          <div className="bc-cols" style={{ gridTemplateColumns: `repeat(${sibs.length}, minmax(260px, 1fr))` }}>
            {sibs.map(s => (
              <div key={s.id} className={'bc-col' + (s.id === data.activeId ? ' active' : '')}>
                <div className="bc-col-head">
                  <span className="bc-col-n">#{s.index + 1}</span>
                  {s.modelName && <span className="bc-col-model">{s.modelName}</span>}
                  {s.id === data.activeId && <span className="bc-col-cur">{t("current")}</span>}
                </div>
                <div className="bc-col-body"><Markdown>{s.content || t('(empty)')}</Markdown></div>
                <div className="bc-col-foot">
                  <button className="bc-use" disabled={s.id === data.activeId} onClick={() => { onSelect?.(s.id); onClose(); }}>
                    {s.id === data.activeId ? t('In use') : t('Use this version')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
    </Dialog>
  );
}
