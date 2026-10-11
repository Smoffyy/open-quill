import { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { t } from '../../i18n.jsx';
import { Pencil, Plus, Trash } from '../ui/icons.jsx';
import { SetRow, SwitchRow } from '../ui/controls.jsx';
import { Skel, SkelRows } from '../ui/Skeleton.jsx';

const MEMORY_MAX_ITEMS = 100;
const MEMORY_MAX_CHARS = 500;

const dateOf = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');

function MemoryItem({ item, onSave, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function start() { setText(item.text); setEditing(true); }
  async function save() {
    const next = text.trim();
    if (!next || next === item.text) { setEditing(false); return; }
    setBusy(true);
    if (await onSave(item, next)) setEditing(false);
    setBusy(false);
  }
  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
  }

  const by = item.source === 'assistant' ? t('Saved by the assistant') : t('Added by you');
  const when = dateOf(item.updated_at || item.created_at);

  if (editing) {
    return (
      <li className="mem-item editing">
        <textarea ref={inputRef} className="mem-edit" value={text} rows={2} maxLength={MEMORY_MAX_CHARS}
          aria-label={t('Edit memory')} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        <div className="edit-actions">
          <button className="btn ghost" onClick={() => setEditing(false)}>{t('Cancel')}</button>
          <button className="btn primary" disabled={busy || !text.trim()} onClick={save}>
            {busy && <span className="btn-spin" aria-hidden="true" />} {busy ? t('Saving…') : t('Save')}
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="mem-item">
      <div className="mem-body">
        <div className="mem-text">{item.text}</div>
        <div className="mem-meta">{when ? `${by} · ${when}` : by}</div>
      </div>
      <div className="mem-acts">
        <button className="mem-btn" onClick={start} aria-label={t('Edit memory')} data-tip={t('Edit')}><Pencil /></button>
        <button className="mem-btn danger" onClick={() => onRemove(item)} aria-label={t('Delete memory')} data-tip={t('Delete')}><Trash /></button>
      </div>
    </li>
  );
}

export default function MemoryTab({ prefs, setPref }) {
  const [items, setItems] = useState(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const on = prefs.memoryEnabled === true;

  useEffect(() => {
    if (!on || items) return undefined;
    let live = true;
    api.get('/api/me/memories')
      .then(r => { if (live) setItems(r.memories || []); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [on]);

  const failed = () => toast(t('Could not save these changes.'), { icon: 'info', kind: 'warn' });

  async function add(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) { setError(t('Write something to remember first.')); return; }
    setAdding(true);
    try {
      const r = await api.post('/api/me/memories', { text });
      setItems(r.memories || []);
      setDraft('');
    } catch (err) {
      setError(err?.message || t('Could not save these changes.'));
    }
    setAdding(false);
  }
  async function save(item, text) {
    try {
      const r = await api.put('/api/me/memories/' + encodeURIComponent(item.id), { text });
      setItems(r.memories || []);
      return true;
    } catch { failed(); return false; }
  }
  async function remove(item) {
    const prev = items;
    setItems(list => list.filter(m => m.id !== item.id));
    try { await api.del('/api/me/memories/' + encodeURIComponent(item.id)); }
    catch { setItems(prev); failed(); }
  }
  async function clear() {
    try {
      await api.del('/api/me/memories');
      setItems([]);
      setConfirmClear(false);
    } catch { failed(); }
  }

  const list = items || [];
  const full = list.length >= MEMORY_MAX_ITEMS;

  return (
    <>
      <div className="hint">{t('Facts the assistant saves about you while you chat, so later conversations can use them. Stored on this server.')}</div>
      <SwitchRow label={t('Use memory in chats')} desc={t('When on, the assistant sees these memories and can save new ones. When off, it can neither read nor change them.')}
        on={on} onToggle={() => { setConfirmClear(false); setPref('memoryEnabled', !on); }} />
      {on && (
        <>
          <div className="field">
            <label htmlFor="mem-new">{t('Saved memories')}</label>
            <form className="mem-add" onSubmit={add} noValidate>
              <input id="mem-new" value={draft} maxLength={MEMORY_MAX_CHARS} disabled={full}
                placeholder={full ? t('Memory is full. Delete an entry to add another.') : t('Add something to remember, e.g. "I work in Python."')}
                aria-invalid={error ? 'true' : undefined} aria-describedby="mem-new-err"
                onChange={(e) => { setDraft(e.target.value); if (error) setError(''); }} />
              <button type="submit" className="btn ghost" disabled={adding || full}>
                {adding ? <span className="btn-spin" aria-hidden="true" /> : <Plus className="btn-ic" />} {adding ? t('Adding…') : t('Add')}
              </button>
            </form>
            <div id="mem-new-err" className="mem-err" role="alert">{error}</div>
            {items == null ? <Skel when><SkelRows count={3} /></Skel> : list.length === 0 ? (
              <div className="muted-note">{t('Nothing saved yet. The assistant adds memories as you chat, or you can add your own above.')}</div>
            ) : (
              <ul className="mem-list">
                {list.map(m => <MemoryItem key={m.id + ':' + m.updated_at} item={m} onSave={save} onRemove={remove} />)}
              </ul>
            )}
            {items != null && list.length > 0 && <div className="muted-note count-note">{list.length}/{MEMORY_MAX_ITEMS}</div>}
          </div>
          <SetRow label={t('Forget everything')} desc={confirmClear ? t("Delete every memory? This can't be undone.") : t('Deletes every saved memory. The assistant may save new ones while memory is on.')}>
            {!confirmClear ? (
              <button className="btn ghost" disabled={!list.length} onClick={() => setConfirmClear(true)}><Trash className="btn-ic" /> {t('Clear')}</button>
            ) : (
              <div className="set-actions">
                <button className="btn ghost" onClick={() => setConfirmClear(false)}>{t('Cancel')}</button>
                <button className="btn primary" onClick={clear}>{t('Clear')}</button>
              </div>
            )}
          </SetRow>
        </>
      )}
    </>
  );
}