import { t } from '../../i18n.jsx';
import { Copy } from '../ui/icons.jsx';

export default function SharedBar({ owner, busy = false, onCopy }) {
  return (
    <div className="composer-stack has-banner">
      <div className="unavail-banner shared-banner">
        <div className="unavail-row">
          <span className="unavail-msg">
            <strong>{t('Shared by {name}', { name: owner })}</strong> {t('You can read this chat. Make a copy to continue it yourself.')}
          </span>
          {onCopy && (
            <button className="btn" disabled={busy} onClick={onCopy}>
              {busy ? <span className="btn-spin" aria-hidden="true" /> : <Copy aria-hidden="true" />} {busy ? t('Copying') : t('Make a copy')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}