import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { t } from '../i18n.jsx';

export default function SummaryModal({ chatId, onClose, onChanged }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let on = true;
    api.get('/api/chats/' + chatId + '/summary').then(r => { if (on) { setText(r.summary || ''); setLoading(false); } }).catch(() => setLoading(false));
    return () => { on = false; };
  }, [chatId]);
  async function save() { await api.patch('/api/chats/' + chatId + '/summary', { summary: text }); onChanged?.(!!text.trim()); setSaved(true); setTimeout(() => setSaved(false), 1400); }
  async function clear() { await api.patch('/api/chats/' + chatId + '/summary', { clear: true }); setText(''); onChanged?.(false); onClose(); }
  return (
    <div className="overlay" onMouseDown={e => e.target.classList.contains('overlay') && onClose()}>
      <div className="summary-modal">
        <div className="sm-head"><h3>Conversation memory</h3><button className="modal-close" style={{ position: 'static' }} onClick={onClose}>✕</button></div>
        <p className="muted-note" style={{ margin: '0 0 10px' }}>Older messages were compacted into this summary, which is fed to the model as context on every turn. You can edit or clear it.</p>
        {loading ? <div className="art-empty">Loading…</div> : (
          <textarea className="summary-text" value={text} onChange={e => setText(e.target.value)} placeholder="No summary yet." />
        )}
        <div className="edit-actions" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={clear}>Clear</button>
          <button className="btn primary" onClick={save}>{saved ? 'Saved' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
