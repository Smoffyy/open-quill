import { useAdmin } from '../store.jsx';
import { Card, Rows, Row, ToggleRow, Fields, Field, Input, Seg } from '../ui.jsx';
import { ImagePicker } from '../media.jsx';
import { t, tk } from '../../../i18n.jsx';
import { BRAND_ICON } from '../../../lib/brand.js';

const PRESETS = [['anthropic', tk('Anthropic')], ['openai', tk('OpenAI')]];
const FONTS = [['newsreader', tk('Newsreader')], ['sourceserif', tk('Source Serif')], ['sans', tk('Open Sans')]];
const PRESET_FONT = { __proto__: null, openai: 'sans', anthropic: 'newsreader' };

export default function BrandingSection() {
  const { workspace } = useAdmin();
  const { config, setCfg, setConfig } = workspace;

  return (
    <>
      <Card title={t('Identity')}>
        <Fields cols={2}>
          <Field label={t('Name')} hint={t('Used in the browser tab, the sidebar, and the greeting.')}>
            <Input value={config.appName} placeholder="open-quill"
              onChange={(e) => setCfg('appName', e.target.value)} />
          </Field>
          <Field label={t('Icon')} hint={t('PNG, SVG, JPEG, or GIF. SVG stays vector through the crop.')}>
            <ImagePicker value={config.appIcon} fallback={BRAND_ICON} onChange={(v) => setCfg('appIcon', v)} />
          </Field>
        </Fields>
      </Card>

      <Card title={t('Interface preset')}
        sub={t('Restyles the entire client. Anthropic is the native layout; OpenAI moves the model picker to the top-left, switches to a pill composer and a pitch-black palette, and pins a logo beside every reply.')}>
        <Rows>
          <Row label={t('Preset')} note={t('Switching also sets a matching default font. Models created while a preset is active inherit its icon defaults.')}>
            <Seg value={config.uiPreset || 'anthropic'} label={t('Interface preset')}
              onChange={(v) => setConfig(c => ({ ...c, uiPreset: v, appFont: PRESET_FONT[v] || 'newsreader' }))}
              options={PRESETS.map(([value, label]) => ({ value, label: t(label) }))} />
          </Row>
          <Row label={t('Display font')}
            note={t('Used for headings, greetings, and assistant text. Newsreader is the closest open match to the Anthropic serif; Open Sans gives a uniform sans-serif interface.')}>
            <Seg value={config.appFont || 'newsreader'} label={t('Display font')}
              onChange={(v) => setCfg('appFont', v)}
              options={FONTS.map(([value, label]) => ({ value, label: t(label) }))} />
          </Row>
        </Rows>
      </Card>

      <Card title={t('Composer')}>
        <Rows>
          <ToggleRow label={t('Model reference button')} on={config.modelDocs !== false}
            onToggle={() => setCfg('modelDocs', !(config.modelDocs !== false))}
            note={t('Adds a button beside the attachment control that opens a side-by-side comparison of every visible model.')} />
        </Rows>
        <Field label={t('Footer line')}
          hint={t('Shown under the composer. Markdown links are allowed with http, https, mailto, or same-site paths. Custom text is rendered as written and is never translated.')}>
          <Input value={config.disclaimer}
            placeholder={t('Assistants can make mistakes, double-check responses.')}
            onChange={(e) => setCfg('disclaimer', e.target.value)} />
        </Field>
      </Card>
    </>
  );
}
