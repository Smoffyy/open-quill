import React from 'react';
import { useAdmin } from '../store.jsx';
import { Card, AutosaveNote, SettingRow } from '../widgets.jsx';
import { t } from '../../../i18n.jsx';

export default function LimitsSection() {
  const A = useAdmin();
  const { settings, setSettings, settingsSave } = A;
  return (
    <>
      <Card title={t("Attachments & storage")} sub={t("Per-role ceilings for what people can upload and keep. 0 = unlimited.")}>
        <div className="field"><label>{t("Upload size limit (MB)")}</label>
          <div className="muted-note">{t("Max size for files attached to messages, per role.")}</div>
          <div className="two-col">
            <div className="field"><label className="sub">{t("Admins")}</label>
              <input type="number" min="0" step="1" value={settings.uploadLimitAdminMb ?? 8} onChange={(e) => setSettings(s => ({ ...s, uploadLimitAdminMb: e.target.value }))} placeholder="8" /></div>
            <div className="field"><label className="sub">{t("Users")}</label>
              <input type="number" min="0" step="1" value={settings.uploadLimitUserMb ?? 8} onChange={(e) => setSettings(s => ({ ...s, uploadLimitUserMb: e.target.value }))} placeholder="8" /></div>
          </div></div>
        <div className="field" style={{ marginBottom: 0 }}><label>{t("Sandbox storage limit (MB)")}</label>
          <div className="muted-note">{t("Max total size of a chat's sandbox files, per role. Writes beyond it are rejected.")}</div>
          <div className="two-col">
            <div className="field"><label className="sub">{t("Admins")}</label>
              <input type="number" min="0" step="1" value={settings.sandboxLimitAdminMb ?? 1024} onChange={(e) => setSettings(s => ({ ...s, sandboxLimitAdminMb: e.target.value }))} placeholder="1024" /></div>
            <div className="field"><label className="sub">{t("Users")}</label>
              <input type="number" min="0" step="1" value={settings.sandboxLimitUserMb ?? 256} onChange={(e) => setSettings(s => ({ ...s, sandboxLimitUserMb: e.target.value }))} placeholder="256" /></div>
          </div></div>
      </Card>
      <Card title={t("Request queue")} sub={t("Keep small local servers from thrashing between models.")}>
        <SettingRow last label={t("Model queue")} note={t("Only one model runs at a time. Requests for the same model run together; a request for a different model waits until the current one finishes, instead of swapping it out mid-response.")}
          on={!!settings.modelQueue} onToggle={() => setSettings(s => ({ ...s, modelQueue: !s.modelQueue }))} />
      </Card>
      <Card title={t("Usage budgets")} sub={t("Monthly spend caps based on per-model pricing. Per-member overrides live in the Members section. Set 0 for no limit.")}>
        <div className="two-col">
          <div className="field"><label className="sub">{t("Default user budget ($ / month)")}</label>
            <input type="number" min="0" step="any" value={settings.budgetUser ?? 0} onChange={(e) => setSettings(s => ({ ...s, budgetUser: e.target.value }))} placeholder="0" /></div>
          <div className="field"><label className="sub">{t("Default admin budget ($ / month)")}</label>
            <input type="number" min="0" step="any" value={settings.budgetAdmin ?? 0} onChange={(e) => setSettings(s => ({ ...s, budgetAdmin: e.target.value }))} placeholder="0" /></div>
        </div>
        <div className="field"><label className="sub">{t("Warn at")}</label>
          <div className="muted-note">{t("Show the warning banner once this fraction of the budget is used.")}</div>
          <input type="number" min="0.1" max="0.99" step="0.05" value={settings.budgetWarnFraction ?? 0.8} onChange={(e) => setSettings(s => ({ ...s, budgetWarnFraction: e.target.value }))} placeholder="0.8" /></div>
        <SettingRow last label={t("Enforce budget")} note={t("When on, users at or over their cap cannot send new messages until next month. When off, the banner is informational only. Admins are never blocked.")}
          on={!!settings.budgetEnforce} onToggle={() => setSettings(s => ({ ...s, budgetEnforce: !s.budgetEnforce }))} />
      </Card>
      <Card title={t("Sessions")} sub={t("How long sign-ins live and how many each person may hold.")}>
        <div className="two-col">
          <div className="field"><label className="sub">{t("Session lifetime (days)")}</label>
            <div className="muted-note">{t("Sessions expire after this many days of inactivity. Activity resets the timer.")}</div>
            <input type="number" min="1" max="365" step="1" value={settings.sessionTtlDays ?? 30} onChange={(e) => setSettings(s => ({ ...s, sessionTtlDays: e.target.value }))} placeholder="30" /></div>
          <div className="field"><label className="sub">{t("Max sessions per user")}</label>
            <div className="muted-note">{t("Oldest sessions are signed out beyond this. 0 = unlimited.")}</div>
            <input type="number" min="0" max="50" step="1" value={settings.maxSessions ?? 0} onChange={(e) => setSettings(s => ({ ...s, maxSessions: e.target.value }))} placeholder="0" /></div>
        </div>
      </Card>
      <AutosaveNote status={settingsSave} live />
    </>
  );
}
