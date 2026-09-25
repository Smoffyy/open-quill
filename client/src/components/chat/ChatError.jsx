import { useState, useRef, useEffect } from 'react';
import { t } from '../../i18n.jsx';
import { copyText } from '../../lib/clipboard.js';
import { Check, Copy, X } from '../ui/icons.jsx';

export default function ChatError({ message, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (!await copyText(message)) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="chat-error" role="alert">
      <div className="chat-error-main">
        <span className="chat-error-title">{t('Something went wrong')}</span>
        <span className="chat-error-text">{message}</span>
      </div>
      <div className="chat-error-actions">
        <button className="chat-error-copy" title={copied ? t('Copied') : t('Copy')} aria-label={copied ? t('Copied') : t('Copy')} onClick={copy}>
          {copied ? <Check style={{ width: 15 }} /> : <Copy style={{ width: 15 }} />}
        </button>
        <button className="chat-error-x" title={t('Dismiss')} aria-label={t('Dismiss')} onClick={onDismiss}><X style={{ width: 15 }} /></button>
      </div>
    </div>
  );
}
