import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { subscribe, settleConfirm } from '../../lib/confirm.js';
import { t } from '../../i18n.jsx';

export default function ConfirmHost() {
  const [ask, setAsk] = useState(null);
  const cancelRef = useRef(null);
  const okRef = useRef(null);
  useEffect(() => subscribe(setAsk), []);
  if (!ask) return null;
  return (
    <Dialog className="confirm-dialog" overlayClassName="confirm-overlay" labelledBy="confirm-title" aria-describedby={ask.message ? 'confirm-message' : undefined}
      onClose={() => settleConfirm(false)} initialFocus={ask.danger ? cancelRef : okRef}>
      <h2 id="confirm-title" className="confirm-title">{ask.title}</h2>
      {ask.message && <p id="confirm-message" className="confirm-message">{ask.message}</p>}
      <div className="confirm-actions">
        <button ref={cancelRef} type="button" className="confirm-btn" onClick={() => settleConfirm(false)}>{ask.cancel || t('Cancel')}</button>
        <button ref={okRef} type="button" className={'confirm-btn solid' + (ask.danger ? ' danger' : '')} onClick={() => settleConfirm(true)}>
          {ask.confirm || t('Confirm')}
        </button>
      </div>
    </Dialog>
  );
}
