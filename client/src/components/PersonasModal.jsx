import React, { useState, useEffect } from 'react';

const EMPTY = { id: '', name: '', modelId: null, instructions: '' };

export default function PersonasModal({ personas = [], models = [], currentId, onApply, onSave, onClose }) {
  const [list, setList] = useState(personas);
  const [edit, setEdit] = useState(null);

  useEffect(() => { setList(personas); }, [personas]);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { if (edit) setEdit(null); else onClose(); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [edit, onClose]);

  function persist(next) { setList(next); onSave?.(next); }
  function startNew() { setEdit({ ...EMPTY, id: 'persona_' + Date.now(), modelId: currentId || (models[0]?.id || null) }); }
  function saveEdit() {
    if (!edit.name.trim()) return;
    const exists = list.some(p => p.id === edit.id);
    persist(exists ? list.map(p => p.id === edit.id ? edit : p) : [...list, edit]);
    setEdit(null);
  }
  function remove(id) { persist(list.filter(p => p.id !== id)); }

  return (
    <div className="pm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pm-modal">
        <div className="pm-head">
          <div>Personas</div>
          <button className="pm-x" onClick={onClose}>✕</button>
        </div>
        {!edit ? (
          <div className="pm-body">
            <div className="pm-note">A persona bundles a model and chat instructions. Apply one to set them both for the current chat in one click.</div>
            <div className="pm-list">
              {list.length === 0 && <div className="pm-empty">No personas yet.</div>}
              {list.map(p => {
                const m = models.find(x => x.id === p.modelId);
                return (
                  <div key={p.id} className="pm-item">
                    <div className="pm-item-main">
                      <div className="pm-item-name">{p.name}</div>
                      <div className="pm-item-meta">{m ? m.displayName : 'Any model'}{p.instructions ? ' · custom instructions' : ''}</div>
                    </div>
                    <div className="pm-item-actions">
                      <button className="pm-btn" onClick={() => { onApply?.(p); onClose(); }}>Apply</button>
                      <button className="pm-btn ghost" onClick={() => setEdit({ ...EMPTY, ...p })}>Edit</button>
                      <button className="pm-btn ghost danger" onClick={() => remove(p.id)}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="pm-new" onClick={startNew}>+ New persona</button>
          </div>
        ) : (
          <div className="pm-body">
            <label className="pm-label">Name</label>
            <input className="pm-input" value={edit.name} autoFocus placeholder="e.g. Senior code reviewer" onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <label className="pm-label">Model</label>
            <select className="pm-input" value={edit.modelId || ''} onChange={(e) => setEdit({ ...edit, modelId: e.target.value || null })}>
              <option value="">Any (keep current)</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </select>
            <label className="pm-label">Chat instructions</label>
            <textarea className="pm-input" rows={5} maxLength={8000} value={edit.instructions} placeholder="Added to the system prompt when this persona is applied." onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} />
            <div className="pm-edit-actions">
              <button className="pm-btn ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button className="pm-btn" disabled={!edit.name.trim()} onClick={saveEdit}>Save</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
