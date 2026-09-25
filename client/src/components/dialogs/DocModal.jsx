import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { t } from '../../i18n.jsx';
import Markdown from '../chat/Markdown.jsx';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';
import { Skel, SkelLines } from '../ui/Skeleton.jsx';

export default function DocModal({ title, name, serif, onClose }) {
  const [content, setContent] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get('/api/docs/' + name)
      .then(d => { if (!cancelled) setContent(d.content || ''); })
      .catch(() => { if (!cancelled) setContent('_' + t('Could not load this document.') + '_'); });
    return () => { cancelled = true; };
  }, [name]);
  return (
    <Dialog className="modal doc-modal" label={title} onClose={onClose} focusSelf>
      <div className="modal-main">
        <div className="modal-head"><h2 className="modal-title">{title}</h2></div>
        <div className="modal-body">
          <div className={'doc-body' + (serif ? ' serif' : '')} aria-busy={content == null || undefined}>
            {content == null
              ? <Skel when><SkelLines count={12} /></Skel>
              : <Markdown>{content}</Markdown>}
          </div>
        </div>
      </div>
      <CloseButton onClick={onClose} />
    </Dialog>
  );
}
