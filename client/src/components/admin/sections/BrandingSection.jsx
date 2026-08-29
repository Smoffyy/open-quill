import { useAdmin } from '../store.jsx';
import { Block, Row, Fields, Field, Input, Seg, Switch, Note } from '../ui.jsx';
import { ImagePicker } from '../media.jsx';
import { t, tk } from '../../../i18n.jsx';
import { BRAND_ICON } from '../../../lib/brand.js';

const PRESETS = [['anthropic', tk('Anthropic')], ['openai', tk('OpenAI')]];
const FONTS = [['newsreader', tk('Newsreader')], ['sourceserif', tk('Source Serif')], ['sans', tk('Open Sans')]];

export default function BrandingSection() {
  const { workspace } = useAdmin();
  const { config, setCfg, setConfig } = workspace;

  return (
    <>
      <Block title={t('Identity')} sub={t('Reaches every connected client the moment it changes.')}>
        <Fields cols={2}>
          <Field label={t('Name')} hint={t('Used in the browser tab, the sidebar, and the greeting.')}>
            <Input value={config.appName} placeholder="open-quill"
              onChange={(e) => setCfg('appName', e.target.value)} />
          </Field>
          <Field label={t('Icon')} hint={t('PNG, SVG, JPEG, or GIF. SVG stays vector through the crop.')}>
            <ImagePicker value={config.appIcon} fallback={BRAND_ICON} onChange={(v) => setCfg('appIcon', v)} />
          </Field>
        </Fields>
      </Block>

      <Block title={t('Interface preset')}
        sub={t('Restyles the entire client. Anthropic is the native layout; OpenAI moves the model picker to the top-left, switches to a pill composer and a pitch-black palette, and pins a logo beside every reply.')}>
        <Seg value={config.uiPreset || 'anthropic'} label={t('Interface preset')}
          onChange={(v) => setConfig(c => ({ ...c, uiPreset: v, appFont: v === 'openai' ? 'sans' : 'newsreader' }))}
          options={PRESETS.map(([value, label]) => ({ value, label: t(label) }))} />
        <div style={{ marginTop: 12 }}>
          <Note>{t('Switching also sets a matching default font. Models created while a preset is active inherit its icon defaults.')}</Note>
        </div>
      </Block>

      <Block title={t('Typography')}>
        <Fields>
          <Field label={t('Display font')}
            hint={t('Used for headings, greetings, and assistant text. Newsreader is the closest open match to the Anthropic serif; Open Sans gives a uniform sans-serif interface.')}>
            <Seg value={config.appFont || 'newsreader'} label={t('Display font')}
              onChange={(v) => setCfg('appFont', v)}
              options={FONTS.map(([value, label]) => ({ value, label: t(label) }))} />
          </Field>
        </Fields>
      </Block>

      <Block title={t('Composer')}>
        <Row label={t('Model reference button')}
          note={t('Adds a button beside the attachment control that opens a side-by-side comparison of every visible model.')}>
          <Switch on={config.modelDocs !== false} label={t('Model reference button')}
            onToggle={() => setCfg('modelDocs', !(config.modelDocs !== false))} />
        </Row>
        <div style={{ paddingTop: 14 }}>
          <Field label={t('Footer line')}
            hint={t('Shown under the composer. Markdown links are allowed with http, https, mailto, or same-site paths. Custom text is rendered as written and is never translated.')}>
            <Input value={config.disclaimer}
              placeholder={t('Assistants can make mistakes, double-check responses.')}
              onChange={(e) => setCfg('disclaimer', e.target.value)} />
          </Field>
        </div>
      </Block>
    </>
  );
}
