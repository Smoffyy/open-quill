import { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { t } from '../../i18n.jsx';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';
import { Skel, SkelLines } from '../ui/Skeleton.jsx';

export default function SummaryModal({ chatId, onClose, onChanged }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(null);
  useEffect(() => {
    let on = true;
    api.get('/api/chats/' + chatId + '/summary')
      .then(r => { if (on) setText(r.summary || ''); })
      .catch(() => {})
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; clearTimeout(savedTimer.current); };
  }, [chatId]);

  async function save() {
    try {
      await api.patch('/api/chats/' + chatId + '/summary', { summary: text });
      onChanged?.(!!text.trim());
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1400);
    } catch { toast(t('Could not save these changes.'), { icon: 'info', kind: 'warn' }); }
  }
  async function clear() {
    try {
      await api.patch('/api/chats/' + chatId + '/summary', { clear: true });
      setText('');
      onChanged?.(false);
      onClose();
    } catch { toast(t('Could not save these changes.'), { icon: 'info', kind: 'warn' }); }
  }

  return (
    <Dialog className="summary-modal" labelledBy="sm-title" onClose={onClose}>
      <div className="sm-head">
        <h3 id="sm-title">{t("Conversation memory")}</h3>
        <CloseButton plain className="modal-close sm-close" onClick={onClose} />
      </div>
      <p className="muted-note sm-note">{t("Older messages were compacted into this summary, which is fed to the model as context on every turn. You can edit or clear it.")}</p>
      {loading ? <Skel when><SkelLines className="summary-skel" count={7} /></Skel> : (
        <textarea className="summary-text" value={text} onChange={e => setText(e.target.value)}
          aria-label={t("Conversation memory")} placeholder={t("No summary yet.")} />
      )}
      <div className="edit-actions sm-actions">
        <button className="btn ghost" onClick={clear} disabled={loading}>{t("Clear")}</button>
        <button className="btn primary" onClick={save} disabled={loading}>{saved ? t('Saved') : t('Save')}</button>
      </div>
    </Dialog>
  );
}
