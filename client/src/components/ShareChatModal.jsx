import { useState } from 'react';
import { X, Check, Globe, Shield, Copy } from './icons.jsx';
import { toast } from '../toast.js';
import { t } from '../i18n.jsx';

const MODES = [
  { id: 'private', Icon: Shield, title: 'Keep private', desc: 'Only you have access' },
  { id: 'public', Icon: Globe, title: 'Create public link', desc: 'Anyone with the link can view' }
];

export default function ShareChatModal({ onClose, onCreateLink }) {
  const [mode, setMode] = useState('private');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (mode === 'private') { onClose(); return; }
    setBusy(true);
    try {
      const url = onCreateLink ? await onCreateLink() : '';
      if (url) setLink(url);
      else toast(t('Sharing is not available yet.'));
    } catch {
      toast(t('Sharing is not available yet.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title"
        onClick={(e) => e.stopPropagation()}>
        <button className="share-x" onClick={onClose} aria-label={t('Close')}><X /></button>
        <h2 className="share-title" id="share-title">{t('Share chat')}</h2>
        <p className="share-sub">{t('Only messages up to this point will be shared.')}</p>

        <div className="share-opts" role="radiogroup" aria-label={t('Share chat')}>
          {MODES.map(({ id, Icon, title, desc }) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id}
              className={'share-opt' + (mode === id ? ' on' : '')} onClick={() => setMode(id)}>
              <span className="share-opt-ic"><Icon /></span>
              <span className="share-opt-body">
                <span className="share-opt-title">{t(title)}</span>
                <span className="share-opt-desc">{t(desc)}</span>
              </span>
              {mode === id && <Check className="share-opt-check" />}
            </button>
          ))}
        </div>

        {link ? (
          <div className="share-link">
            <input className="share-link-url" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button className="lib-primary" onClick={() => { navigator.clipboard?.writeText(link); toast(t('Copied')); }}>
              <Copy /> {t('Copy link')}
            </button>
          </div>
        ) : (
          <>
            <p className="share-fine">{t("Don't share personal information or third-party content without permission.")}</p>
            <div className="share-actions">
                            <button className="lib-primary" onClick={create} disabled={busy}>{t('Create share link')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
