import { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card, Rows, Row, ToggleRow, Fields, Field, Input, Seg, Btn, Note, Badge, Acts } from '../ui.jsx';
import { ImagePicker } from '../media.jsx';
import { t, tk } from '../../../i18n.jsx';
import { BRAND_ICON } from '../../../lib/brand.js';
import { Palette, Sparkles, Eye } from '../../icons.jsx';
import { toast } from '../../../toast.js';

const PRESETS = [['anthropic', tk('Anthropic')], ['openai', tk('OpenAI')]];
const FONTS = [['literata', tk('Literata')], ['newsreader', tk('Newsreader')], ['sourceserif', tk('Source Serif')], ['sans', tk('Open Sans')]];
const PRESET_FONT = { __proto__: null, openai: 'sans', anthropic: 'literata' };
const BUILD_KEY = 'oq-build-mode';

/* The admin-facing half of the interface story: pick which theme is live, look
   after the theme library, and drop into build mode. The member-facing half
   lives in Settings → Interface, and neither can reach into the other. */

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function InterfaceSection() {
  const { workspace, onClose } = useAdmin();
  const { config, setCfg, setConfig } = workspace;
  const [themes, setThemes] = useState({ themes: [], activeId: '', publishedActiveId: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setThemes(await api.get('/api/admin/themes')); } catch {}
  };
  useEffect(() => { load(); }, []);

  const active = themes.themes.find(x => x.id === themes.activeId);
  const dirty = !!active?.dirty || (themes.activeId && themes.activeId !== themes.publishedActiveId);

  const enterBuild = () => {
    try { localStorage.setItem(BUILD_KEY, '1'); } catch {}
    // Build mode edits the real interface, so the panel that opened it steps out
    // of the way rather than sitting on top of the thing being designed.
    onClose();
    setTimeout(() => window.location.reload(), 60);
  };

  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); await load(); if (msg) toast(msg); }
    catch (e) { toast(e?.message || t('That did not work.')); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Card title={t('Theme builder')}
        sub={t('Design the interface visually: select any part of the app, restyle it, rearrange it, rename its text, and publish when you are happy. Your changes stay private until you publish.')}
        actions={<Btn kind="primary" onClick={enterBuild}><Palette /> {t('Enter build mode')}</Btn>}>
        <Rows>
          <Row label={t('Active theme')} note={t('The layout everyone on this workspace renders once it is published.')}>
            <div className="cp-inline">
              <b>{active?.name || t('None')}</b>
              {dirty ? <Badge tone="warn">{t('Unpublished changes')}</Badge> : <Badge tone="good">{t('Published')}</Badge>}
            </div>
          </Row>
          <Row label={t('Last edited')} note={active ? t('Based on the {preset} layout.', { preset: active.basePreset === 'openai' ? 'OpenAI' : 'Anthropic' }) : ''}>
            <span className="dim">{fmt(active?.updatedAt)}</span>
          </Row>
        </Rows>
        {dirty && (
          <Note tone="warn" icon={<Eye />}>
            {t('Members are still seeing the previously published interface. Open build mode to preview and publish your draft.')}
          </Note>
        )}
      </Card>

      <Card title={t('Themes')} sub={t('Anthropic and OpenAI ship as editable presets. Duplicate one to start your own; every theme uses the same builder.')}>
        <div className="cp-theme-rows">
          {themes.themes.map(th => (
            <div key={th.id} className={'cp-theme-row' + (th.id === themes.activeId ? ' on' : '')}>
              <div className="cp-theme-info">
                <b>{th.name}</b>
                <span>
                  {th.note ? t(th.note) : t('{preset} base', { preset: th.basePreset === 'openai' ? 'OpenAI' : 'Anthropic' })}
                  {' · '}{t('{n} customisations', { n: th.edits })}
                  {th.builtin ? ' · ' + t('Preset') : ''}
                </span>
              </div>
              <Acts end>
                {th.id === themes.activeId
                  ? <Badge tone="good">{t('Active')}</Badge>
                  : <Btn size="sm" disabled={busy} onClick={() => run(() => api.post(`/api/admin/themes/${th.id}/activate`, {}), t('Now editing “{name}”.', { name: th.name }))}>{t('Use this')}</Btn>}
                <Btn size="sm" disabled={busy}
                  onClick={() => run(() => api.post('/api/admin/themes', { from: th.id, name: th.name + ' copy' }), t('Duplicated.'))}>
                  {t('Duplicate')}
                </Btn>
              </Acts>
            </div>
          ))}
        </div>
        <Note icon={<Sparkles />}>
          {t('Renaming, deleting, importing, exporting and version history all live inside build mode, next to the design you are working on.')}
        </Note>
      </Card>

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

      <Card title={t('Base layout')}
        sub={t('The starting point a theme paints over. Anthropic is the native layout; OpenAI moves the model picker to the top-left, switches to a pill composer and a pitch-black palette, and pins a logo beside every reply.')}>
        <Rows>
          <Row label={t('Preset')} note={t('Switching also sets a matching default font. Models created while a preset is active inherit its icon defaults.')}>
            <Seg value={config.uiPreset || 'anthropic'} label={t('Base layout')}
              onChange={(v) => setConfig(c => ({ ...c, uiPreset: v, appFont: PRESET_FONT[v] || 'literata' }))}
              options={PRESETS.map(([value, label]) => ({ value, label: t(label) }))} />
          </Row>
          <Row label={t('Display font')}
            note={t('Used for headings, greetings, and assistant text. A theme can override this per element.')}>
            <Seg value={config.appFont || 'literata'} label={t('Display font')}
              onChange={(v) => setCfg('appFont', v)}
              options={FONTS.map(([value, label]) => ({ value, label: t(label) }))} />
          </Row>
        </Rows>
      </Card>
    </>
  );
}
