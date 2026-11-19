import { useState, useRef, useId, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { Download, Upload } from '../ui/icons.jsx';
import { t, useI18n } from '../../i18n.jsx';
import { SetRow, SelectRow } from '../ui/controls.jsx';
import { reopenSettingsAfterReload } from '../../lib/prefs.js';
import { can } from '../../lib/permissions.js';

function Confirmable({ label, desc, action, ask, confirm, onConfirm, error, password = false }) {
  const [asking, setAsking] = useState(false);
  const [secret, setSecret] = useState('');
  const errorId = useId();
  if (!asking) {
    return (
      <SetRow label={label} desc={desc}>
        <button className="btn ghost" onClick={() => setAsking(true)}>{action}</button>
      </SetRow>
    );
  }
  return (
    <>
      <SetRow label={label} desc={ask}>
        <div className="set-actions">
          {password && (
            <input type="password" className="short-input" placeholder={t('Password')} aria-label={t('Password')} autoComplete="current-password"
              value={secret} onChange={(e) => setSecret(e.target.value)} aria-invalid={error ? 'true' : undefined} aria-describedby={errorId} />
          )}
          <button className="btn ghost" onClick={() => { setAsking(false); setSecret(''); }}>{t('Cancel')}</button>
          <button className="btn primary" disabled={password && !secret} onClick={async () => { if (await onConfirm(secret) !== false) { setAsking(false); setSecret(''); } }}>{confirm}</button>
        </div>
      </SetRow>
      <div className="muted-note" id={errorId} role="alert">{error}</div>
    </>
  );
}

export default function GeneralTab({ user, draft, onExportChats, onImportChats, onDeleted }) {
  const { lang, setLang, langs } = useI18n();
  const importRef = useRef(null);
  const [clearMsg, setClearMsg] = useState('');
  const [delErr, setDelErr] = useState('');
  const [models, setModels] = useState([]);
  useEffect(() => { api.get('/api/models').then(list => setModels(Array.isArray(list) ? list : [])).catch(() => {}); }, []);

  async function clearChats() {
    setClearMsg('');
    try {
      const r = await api.del('/api/me/chats');
      setClearMsg(t('Deleted {n} chat(s)', { n: r.deleted || 0 }));
      setTimeout(() => { location.href = '/'; }, 700);
    } catch {
      setClearMsg(t('Could not delete chats.'));
      return false;
    }
  }
  async function deleteAccount(password) {
    setDelErr('');
    try { await api.del('/api/me', { password }); onDeleted?.(); }
    catch (e) { setDelErr(e?.message || t('Could not delete account.')); return false; }
  }

  return (
    <>
      <div className="hint">{t("Your account basics. Colours, fonts and layout live under Interface.")}</div>
      <div className="me-section-h">{t("Profile")}</div>
      <SetRow label={t("What should we call you?")}>
        <input className="set-input" value={draft.name} aria-label={t("What should we call you?")}
          autoComplete="nickname" onChange={(e) => draft.changeName(e.target.value)} />
      </SetRow>
      <div className="me-section-h">{t("Preferences")}</div>
      <SetRow label={t("Language")} desc={t("The interface language on this device. Chats and replies are not translated.")}>
        <SelectRow label={t("Language")} value={lang} options={langs.map(l => ({ v: l.code, label: l.name }))}
          onPick={(code) => { if (code !== lang) reopenSettingsAfterReload('general'); setLang(code); }} />
      </SetRow>
      {models.length > 1 && (
        <SetRow label={t('Default model for new chats')} desc={t('Overrides the default your organization or groups picked.')}>
          <SelectRow label={t('Default model for new chats')} value={models.some(m => m.id === draft.prefs.defaultModel) ? draft.prefs.defaultModel : ''}
            options={[{ v: '', label: t('Use the organization default') }, ...models.map(m => ({ v: m.id, label: m.displayName || m.id }))]}
            onPick={(v) => draft.setPref('defaultModel', v || undefined)} />
        </SetRow>
      )}
      <div className="field">
        <label htmlFor="set-instructions">{t("Instructions for the Assistant")}</label>
        <div className="muted-note" id="set-instructions-note">{t("Added to the system prompt of every chat. Leave empty for none.")}</div>
        <textarea id="set-instructions" className="instr-area" value={draft.instructions} maxLength={8000} rows={5}
          aria-describedby="set-instructions-note"
          placeholder={t("e.g. I'm a backend developer. Keep answers concise and skip the preamble.")}
          onChange={(e) => draft.changeInstructions(e.target.value)} />
        <div className="muted-note count-note">{draft.instructions.length}/8000</div>
      </div>
      <div className="me-section-h">{t("Your data")}</div>
      <SetRow label={t("Export and import")} desc={t("Download everything (chats, styles, memory) as one JSON file, or restore from one. Imported chats are added and profile data is merged.")}>
        <div className="set-actions">
          <button className="btn ghost" onClick={onExportChats}><Download className="btn-ic" /> {t("Export")}</button>
          <button className="btn ghost" onClick={() => importRef.current?.click()}><Upload className="btn-ic" /> {t("Import")}</button>
        </div>
        <input ref={importRef} type="file" accept="application/json,.json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportChats(f); e.target.value = ''; }} />
      </SetRow>
      <div className="me-section-h">{t("Danger zone")}</div>
      <Confirmable label={t("Delete all saved chats")} desc={t("Removes every chat and its files. Your account stays.")}
        action={t("Delete all chats")} ask={t("Delete every saved chat? This can't be undone.")}
        confirm={t("Delete")} onConfirm={clearChats} />
      {clearMsg && <div className="muted-note" role="status">{clearMsg}</div>}
      <Confirmable label={t("Reset all settings")} desc={t("Back to defaults for this theme. Chats and account are untouched.")}
        action={t("Reset")} ask={t("Reset every setting to this theme's defaults?")}
        confirm={t("Reset")} onConfirm={() => draft.resetPrefs()} />
      {(user.role === 'pending' || can(user, 'account.delete')) && (
        <Confirmable label={t("Delete account")} desc={t("Permanently removes your account, all chats, and files. This cannot be undone.")}
          action={t("Delete account")} ask={t("Delete your account and everything in it? This cannot be undone.")}
          confirm={t("Delete")} onConfirm={deleteAccount} error={delErr} password />
      )}
    </>
  );
}