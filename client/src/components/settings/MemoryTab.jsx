import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { t } from '../../i18n.jsx';
import { Refresh, Trash } from '../ui/icons.jsx';
import { SetRow, SwitchRow } from '../ui/controls.jsx';

const MEMORY_SAVE_MS = 700;
const MEMORY_MAX = 6000;

export default function MemoryTab({ user, prefs, setPref, modelId, onUpdated }) {
  const [memory, setMemory] = useState(user.memory || '');
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const timer = useRef(null);
  const pending = useRef(null);
  const userRef = useRef(user);
  userRef.current = user;
  const updatedRef = useRef(onUpdated);
  updatedRef.current = onUpdated;

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const v = pending.current;
    if (v == null) return;
    pending.current = null;
    try {
      await api.put('/api/me/memory', { memory: v });
      updatedRef.current?.({ ...userRef.current, memory: v });
    } catch {
      toast(t('Could not save these changes.'), { icon: 'info', kind: 'warn' });
    }
  }, []);
  useEffect(() => () => { flush(); }, [flush]);

  function change(v) {
    setMemory(v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, MEMORY_SAVE_MS);
  }
  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.post('/api/me/memory/refresh', { modelId: modelId || '' });
      setMemory(r.memory || '');
      updatedRef.current?.({ ...userRef.current, memory: r.memory || '' });
    } catch (e) {
      toast(e?.message || t('Could not update memory.'), { icon: 'info', kind: 'warn' });
    }
    setBusy(false);
  }
  async function clear() {
    try {
      await api.del('/api/me/memory');
      pending.current = null;
      setMemory('');
      setConfirmClear(false);
      updatedRef.current?.({ ...userRef.current, memory: '' });
    } catch {
      toast(t('Could not save these changes.'), { icon: 'info', kind: 'warn' });
    }
  }

  return (
    <>
      <div className="hint">{t("A short, editable memory built from your recent chats. Stored locally.")}</div>
      <SwitchRow label={t("Use memory in chats")} desc={t("Adds the memory below to every conversation, refreshed in the background.")}
        on={prefs.memoryEnabled !== false} onToggle={() => setPref('memoryEnabled', prefs.memoryEnabled === false)} />
      <div className="field">
        <label htmlFor="set-memory">{t("What the assistant remembers")}</label>
        <textarea id="set-memory" className="instr-area" value={memory} maxLength={MEMORY_MAX} rows={9}
          placeholder={t("Nothing yet. Chat a bit, then press Update now, or write anything you want remembered.")}
          onChange={(e) => change(e.target.value)} />
        <div className="muted-note count-note">{memory.length}/{MEMORY_MAX}</div>
      </div>
      <SetRow label={t("Update from recent chats")} desc={t("Asks the current model to refresh this memory from your latest conversations.")}>
        <button className="btn ghost" disabled={busy} onClick={refresh}>
          {busy ? <span className="btn-spin" aria-hidden="true" /> : <Refresh className="btn-ic" />} {busy ? t('Updating…') : t('Update now')}
        </button>
      </SetRow>
      {!confirmClear ? (
        <SetRow label={t("Forget everything")} desc={t("Clears the memory. It may be rebuilt from future chats while memory is on.")}>
          <button className="btn ghost danger" disabled={!memory} onClick={() => setConfirmClear(true)}><Trash className="btn-ic" /> {t("Clear")}</button>
        </SetRow>
      ) : (
        <div className="dz-confirm" role="group" aria-label={t("Forget everything")}>
          <div className="muted-note">{t("Clear the memory? This can't be undone.")}</div>
          <div className="edit-actions">
            <button className="btn ghost" onClick={() => setConfirmClear(false)}>{t("Cancel")}</button>
            <button className="btn danger" onClick={clear}>{t("Yes, clear memory")}</button>
          </div>
        </div>
      )}
    </>
  );
}
