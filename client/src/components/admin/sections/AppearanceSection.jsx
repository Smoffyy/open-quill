import React from 'react';
import { useAdmin } from '../store.jsx';
import { Card, IconSlot, AutosaveNote, SegPick } from '../widgets.jsx';
import { t } from '../../../i18n.jsx';

export default function AppearanceSection() {
  const A = useAdmin();
  const { cfg, setCfg, settingsSave } = A;
  return (
    <>
      <Card title={t("Identity")} sub={t("How the app introduces itself across every client.")}>
        <div className="field"><label>{t("App name")}</label>
          <input value={cfg.appName} onChange={(e) => setCfg(c => ({ ...c, appName: e.target.value }))} placeholder={t("open-quill")} /></div>
        <div className="field"><label>App icon <span className="muted-note" style={{ display: 'inline' }}>(browser tab + greeting)</span></label>
          <div className="icon-grid" style={{ gridTemplateColumns: '1fr' }}>
            <IconSlot label={t("Click to upload (png, svg, jpeg, gif)")} value={cfg.appIcon} def="/starburst.svg" anim="" onChange={(v) => setCfg(c => ({ ...c, appIcon: v }))} />
          </div>
        </div>
      </Card>
      <Card title={t("Interface preset")} sub={t("Switches the entire UI between the two looks instantly, for every connected client.")}>
        <div className="field">
          <SegPick value={cfg.uiPreset || 'anthropic'} options={[['anthropic', 'Anthropic'], ['openai', 'OpenAI']]}
            onChange={(v) => setCfg(c => ({ ...c, uiPreset: v, appFont: v === 'openai' ? 'sans' : 'serif' }))} />
          <div className="muted-note">{t("Anthropic keeps the classic open-quill layout. OpenAI restyles everything after ChatGPT: pitch-black palette, Open Sans, pill composer, the model picker in the top-left, persistent 28px model logos beside every reply, and no logo motion. New models created while OpenAI is active default to those icon settings.")}</div>
        </div>
      </Card>
      <Card title={t("Typography & footer")} sub={t("The overall voice of the interface.")}>
        <div className="field"><label>{t("Interface font")}</label>
          <SegPick value={cfg.appFont || 'serif'} options={[['serif', 'Source Serif (default)'], ['sans', 'Open Sans']]}
            onChange={(v) => setCfg(c => ({ ...c, appFont: v }))} />
          <div className="muted-note">{t("The display font used for headings, greetings, and assistant text across the entire UI. Open Sans gives a cleaner, sans-serif look everywhere.")}</div>
        </div>
        <div className="field"><label>{t("Bottom disclaimer")}</label>
          <input value={cfg.disclaimer} onChange={(e) => setCfg(c => ({ ...c, disclaimer: e.target.value }))} placeholder={t("Assistants can make mistakes, double-check responses.")} /></div>
      </Card>
      <AutosaveNote status={settingsSave} />
    </>
  );
}
