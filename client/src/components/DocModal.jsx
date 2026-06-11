import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import Markdown from './Markdown.jsx';

export default function DocModal({ title, name, serif, onClose }) {
  const [content, setContent] = useState('Loading…');
  useEffect(() => {
    api.get('/api/docs/' + name).then(d => setContent(d.content || '')).catch(() => setContent('_Could not load this document._'));
  }, [name]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="modal doc-modal" style={{ position: 'relative', height: 'auto', maxHeight: '82vh' }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-main" style={{ width: '100%' }}>
          <h2>{title}</h2>
          <div className={'doc-body' + (serif ? ' serif' : '')}><Markdown>{content}</Markdown></div>
        </div>
      </div>
    </div>
  );
}
