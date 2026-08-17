import { useAdmin } from '../store.jsx';
import { Card, IconSlot, AutosaveNote, SegPick, SettingRow } from '../widgets.jsx';
import { t, tk } from '../../../i18n.jsx';
import { BRAND_ICON } from '../../../lib/brand.js';

export default function AppearanceSection() {
  const A = useAdmin();
  const { cfg, setCfg, settingsSave } = A;
  return (
    <>
      <Card title={t("Identity")} sub={t("How the app introduces itself across every client.")}>
        <div className="field"><label>{t("App name")}</label>
          <input value={cfg.appName} onChange={(e) => setCfg(c => ({ ...c, appName: e.target.value }))} placeholder={t("open-quill")} /></div>
        <div className="field"><label>{t("App icon")} <span className="muted-note" style={{ display: 'inline' }}>{t("(browser tab + greeting)")}</span></label>
          <div className="icon-grid" style={{ gridTemplateColumns: '1fr' }}>
            <IconSlot label={t("Click to upload (png, svg, jpeg, gif)")} value={cfg.appIcon} def={BRAND_ICON} anim="" onChange={(v) => setCfg(c => ({ ...c, appIcon: v }))} />
          </div>
        </div>
      </Card>
      <Card title={t("Interface preset")} sub={t("Switches the entire UI between the two looks instantly, for every connected client.")}>
        <div className="field">
          <SegPick value={cfg.uiPreset || 'anthropic'} options={[['anthropic', tk('Anthropic')], ['openai', tk('OpenAI')]]}
            onChange={(v) => setCfg(c => ({ ...c, uiPreset: v, appFont: v === 'openai' ? 'sans' : 'serif' }))} />
          <div className="muted-note">{t("Anthropic keeps the classic open-quill layout. OpenAI restyles everything after ChatGPT: pitch-black palette, Open Sans, pill composer, the model picker in the top-left, persistent 28px model logos beside every reply, and no logo motion. New models created while OpenAI is active default to those icon settings.")}</div>
        </div>
      </Card>
      <Card title={t("Composer")} sub={t("Controls shown in the message box.")}>
        <SettingRow label={t("Model docs button")}
          note={t("Shows the book icon beside the plus button, opening a panel that compares every available model.")}
          on={cfg.modelDocs !== false}
          onToggle={() => setCfg(c => ({ ...c, modelDocs: !(c.modelDocs !== false) }))} last />
      </Card>
      <Card title={t("Typography & footer")} sub={t("The overall voice of the interface.")}>
        <div className="field"><label>{t("Interface font")}</label>
          <SegPick value={cfg.appFont || 'serif'} options={[['serif', tk('Source Serif (default)')], ['sans', tk('Open Sans')]]}
            onChange={(v) => setCfg(c => ({ ...c, appFont: v }))} />
          <div className="muted-note">{t("The display font used for headings, greetings, and assistant text across the entire UI. Open Sans gives a cleaner, sans-serif look everywhere.")}</div>
        </div>
        <div className="field"><label>{t("Bottom disclaimer")}</label>
          <input value={cfg.disclaimer} onChange={(e) => setCfg(c => ({ ...c, disclaimer: e.target.value }))} placeholder={t("Assistants can make mistakes, double-check responses.")} />
          <div className="muted-note">{t("Shown under the composer. Add links with [label](https://example.com); http, https, mailto and same-site paths are allowed. Custom text is shown as written and is not translated.")}</div></div>
      </Card>
      <AutosaveNote status={settingsSave} />
    </>
  );
}
