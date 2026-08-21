import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { t } from '../i18n.jsx';
import Markdown from './Markdown.jsx';

export default function DocModal({ title, name, serif, onClose }) {
  const [content, setContent] = useState(t('Loading…'));
  useEffect(() => {
    let cancelled = false;
    api.get('/api/docs/' + name)
      .then(d => { if (!cancelled) setContent(d.content || ''); })
      .catch(() => { if (!cancelled) setContent('_' + t('Could not load this document.') + '_'); });
    return () => { cancelled = true; };
  }, [name]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="modal doc-modal" style={{ position: 'relative', height: 'auto', maxHeight: '82vh' }}>
        <button className="modal-close" onClick={onClose} aria-label={t('Close')}>✕</button>
        <div className="modal-main" style={{ width: '100%' }}>
          <h2>{title}</h2>
          <div className={'doc-body' + (serif ? ' serif' : '')}><Markdown>{content}</Markdown></div>
        </div>
      </div>
    </div>
  );
}
