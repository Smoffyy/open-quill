import { useState, useEffect } from 'react';
import { t } from '../../i18n.jsx';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';

const EMPTY = { id: '', name: '', modelId: null, instructions: '' };

export default function PersonasModal({ personas = [], models = [], currentId, onApply, onSave, onClose }) {
  const [list, setList] = useState(personas);
  const [edit, setEdit] = useState(null);

  useEffect(() => { setList(personas); }, [personas]);

  function persist(next) { setList(next); onSave?.(next); }
  function startNew() { setEdit({ ...EMPTY, id: 'persona_' + Date.now(), modelId: currentId || (models[0]?.id || null) }); }
  function saveEdit(e) {
    e?.preventDefault();
    if (!edit.name.trim()) return;
    const exists = list.some(p => p.id === edit.id);
    persist(exists ? list.map(p => p.id === edit.id ? edit : p) : [...list, edit]);
    setEdit(null);
  }
  function remove(id) { persist(list.filter(p => p.id !== id)); }

  return (
    <Dialog className="persona-modal" overlayClassName="persona-overlay" labelledBy="persona-title" onClose={onClose}
      onEscape={edit ? () => setEdit(null) : onClose}>
      <div className="persona-head">
        <div id="persona-title">{t("Personas")}</div>
        <CloseButton plain className="persona-x" onClick={onClose} />
      </div>
      {!edit ? (
        <div className="persona-body">
          <div className="persona-note">{t("A persona bundles a model and chat instructions. Apply one to set them both for the current chat in one click.")}</div>
          <div className="persona-list">
            {list.length === 0 && <div className="persona-empty">{t("No personas yet.")}</div>}
            {list.map(p => {
              const m = models.find(x => x.id === p.modelId);
              return (
                <div key={p.id} className="persona-item">
                  <div className="persona-item-main">
                    <div className="persona-item-name">{p.name}</div>
                    <div className="persona-item-meta">{[m ? m.displayName : t('Any model'), p.instructions ? t('Chat instructions') : ''].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="persona-item-actions">
                    <button className="persona-btn" onClick={() => { onApply?.(p); onClose(); }}>{t("Apply")}</button>
                    <button className="persona-btn ghost" onClick={() => setEdit({ ...EMPTY, ...p })}>{t("Edit")}</button>
                    <button className="persona-btn ghost danger" onClick={() => remove(p.id)}>{t("Delete")}</button>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="persona-new" onClick={startNew}>{t("+ New persona")}</button>
        </div>
      ) : (
        <form className="persona-body" onSubmit={saveEdit}>
          <label className="persona-label" htmlFor="persona-name">{t("Name")}</label>
          <input id="persona-name" className="persona-input" value={edit.name} autoFocus placeholder={t("e.g. Senior code reviewer")} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <label className="persona-label" htmlFor="persona-model">{t("Model")}</label>
          <select id="persona-model" className="persona-input" value={edit.modelId || ''} onChange={(e) => setEdit({ ...edit, modelId: e.target.value || null })}>
            <option value="">{t("Any (keep current)")}</option>
            {models.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
          </select>
          <label className="persona-label" htmlFor="persona-instructions">{t("Chat instructions")}</label>
          <textarea id="persona-instructions" className="persona-input" rows={5} maxLength={8000} value={edit.instructions} placeholder={t("Added to the system prompt when this persona is applied.")} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} />
          <div className="persona-edit-actions">
            <button type="button" className="persona-btn ghost" onClick={() => setEdit(null)}>{t("Cancel")}</button>
            <button type="submit" className="persona-btn" disabled={!edit.name.trim()}>{t("Save")}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
