import { useState, useRef } from 'react';
import { api } from '../../lib/api.js';
import { Download, Upload } from '../ui/icons.jsx';
import { t, useI18n } from '../../i18n.jsx';
import { SetRow, SelectRow } from '../ui/controls.jsx';
import { reopenSettingsAfterReload } from '../../lib/prefs.js';

function Confirmable({ label, desc, action, ask, confirm, danger = true, onConfirm, error }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <div className="field row">
        <div><label>{label}</label><div className="muted-note">{desc}</div></div>
        <button className={'btn' + (danger ? ' danger' : ' ghost')} onClick={() => setAsking(true)}>{action}</button>
      </div>
    );
  }
  return (
    <div className="dz-confirm" role="group" aria-label={label}>
      <div className="muted-note">{ask}</div>
      {error && <div className="dz-err" role="alert">{error}</div>}
      <div className="edit-actions">
        <button className="btn ghost" onClick={() => setAsking(false)}>{t('Cancel')}</button>
        <button className={'btn' + (danger ? ' danger' : '')} onClick={async () => { if (await onConfirm() !== false) setAsking(false); }}>{confirm}</button>
      </div>
    </div>
  );
}

export default function GeneralTab({ user, draft, onExportChats, onImportChats, onDeleted }) {
  const { lang, setLang, langs } = useI18n();
  const importRef = useRef(null);
  const [clearMsg, setClearMsg] = useState('');
  const [delErr, setDelErr] = useState('');

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
  async function deleteAccount() {
    setDelErr('');
    try { await api.del('/api/me'); onDeleted?.(); }
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
      <SetRow label={t("Export everything")} desc={t("Download everything (chats, styles, personas, prompts, memory) as one JSON file.")}>
        <button className="btn ghost" onClick={onExportChats}><Download className="btn-ic" /> {t("Export")}</button>
      </SetRow>
      <SetRow label={t("Import")} desc={t("Restore from an exported file. Chats are added and profile data is merged.")}>
        <button className="btn ghost" onClick={() => importRef.current?.click()}><Upload className="btn-ic" /> {t("Import")}</button>
        <input ref={importRef} type="file" accept="application/json,.json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportChats(f); e.target.value = ''; }} />
      </SetRow>
      <div className="danger-zone">
        <div className="dz-title">{t("Danger zone")}</div>
        <Confirmable label={t("Delete all saved chats")} desc={t("Removes every chat and its files. Your account stays.")}
          action={t("Delete all chats")} ask={t("Delete every saved chat? This can't be undone.")}
          confirm={t("Yes, delete all chats")} onConfirm={clearChats} />
        {clearMsg && <div className="muted-note" role="status">{clearMsg}</div>}
        <Confirmable label={t("Reset all settings")} desc={t("Back to defaults for this theme. Chats and account are untouched.")}
          action={t("Reset all settings")} ask={t("Reset every setting to this theme's defaults?")}
          confirm={t("Yes, reset settings")} danger={false} onConfirm={() => draft.resetPrefs()} />
        {!user.isOwner && (
          <Confirmable label={t("Delete account")} desc={t("Permanently removes your account, all chats, and files. This cannot be undone.")}
            action={t("Delete account")} ask={t("Are you absolutely sure? This permanently deletes your account and everything in it.")}
            confirm={t("Yes, delete my account")} onConfirm={deleteAccount} error={delErr} />
        )}
      </div>
    </>
  );
}
