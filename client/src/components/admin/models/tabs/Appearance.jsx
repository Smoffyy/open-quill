import { useAdmin } from '../../store.jsx';
import { Card, Rows, Fields, Btn, Range } from '../../ui.jsx';
import { ImagePicker } from '../../media.jsx';
import { useEditor, useField, useChange, Revert, Slot, Line, Flag, Choice, TextField, When } from '../bind.jsx';
import { reasons } from '../../../../lib/modelcatalog.js';
import { BADGES, badgesOf } from '../../../../lib/badges.js';
import { t, tk } from '../../../../i18n.jsx';
import { BRAND_ICON, BRAND_GENERATING, BRAND_THINKING } from '../../../../lib/brand.js';

const MOTIONS = [
  ['none', tk('none')], ['spin', tk('spin')], ['pulse', tk('breathe')],
  ['bounce', tk('bounce')], ['wobble', tk('wobble')], ['fade', tk('fade')]
];
const DEFAULT_SIZE = 40;

function Icon({ k, label, fallback, motion }) {
  const { edit } = useEditor();
  const { value, mixed } = useField(k);
  const base = useField('static_icon');
  return (
    <Slot label={label} k={k}>
      <div className="mc-stack">
        <ImagePicker value={mixed ? '' : value} fallback={fallback && !base.mixed ? (base.value || '') : ''}
          onChange={(v) => edit({ [k]: v })} />
        {motion && (
          <Choice k={motion} label={t('Motion')} fallback="none"
            options={MOTIONS.map(([v, l]) => ({ value: v, label: t(l) }))} />
        )}
      </div>
    </Slot>
  );
}

function Size() {
  const { edit } = useEditor();
  const { value, mixed } = useField('icon_size');
  const size = mixed ? DEFAULT_SIZE : (Number(value) || DEFAULT_SIZE);
  return (
    <Line label={t('Size beside replies')} k="icon_size"
      note={mixed ? t('Differs across the selection.') : t('{n}px. 40 is the default, 26 matches the older layout.', { n: size })} wide>
      <Range min="14" max="64" value={size} label={t('Size beside replies')}
        onChange={(e) => edit({ icon_size: parseInt(e.target.value, 10) })} />
      <Btn size="sm" disabled={!mixed && !Number(value)} onClick={() => edit({ icon_size: 0 })}>{t('Reset')}</Btn>
    </Line>
  );
}

const BADGE_TEXT = {
  __proto__: null,
  auto: [tk('Auto'), tk('Earned by routers, which pick a model for each message.')],
  text: [tk('Text'), tk('Earned by every model, since all of them read and write text.')],
  vision: [tk('Vision'), tk('Earned once Image input is on under Tools.')],
  reasoning: [tk('Reasoning'), tk('Earned once the model reasons: a thinking kwarg, think tags or a prompt token switch.')],
  web: [tk('Web search'), tk('Earned when web search is on for the workspace and allowed for this model.')],
  code: [tk('Code'), tk('Earned while Sandbox tools are allowed.')],
  long: [tk('Long context'), tk('Earned with a context window of 100K tokens or more.')]
};

function Badges() {
  const { models, edit } = useEditor();
  const { workspace } = useAdmin();
  const ctx = { webSearch: !!workspace.settings.webSearchEnabled };
  const change = useChange('badges_off');
  const label = t('Badges');
  return (
    <div className={'cp-row mc-chip-row' + (change.changed ? ' mc-changed' : '')}>
      <div className="cp-row-main">
        <span className="cp-row-label"><span className="mc-label">{label}<Revert change={change} label={label} /></span></span>
        <div className="cp-row-note">{t('Shown beside the name in the picker. A model earns each one automatically; switch one off to hide it.')}</div>
      </div>
      <div className="mc-chips" role="group" aria-label={label}>
        {BADGES.map(({ id, supported }) => {
          const able = models.filter(m => supported(m, ctx));
          const shown = able.filter(m => badgesOf(m, ctx).includes(id));
          const all = able.length > 0 && shown.length === able.length;
          const [name, hint] = BADGE_TEXT[id];
          return (
            <button key={id} type="button" disabled={!able.length} title={t(hint)}
              aria-pressed={all ? true : shown.length ? 'mixed' : false}
              className={'mc-chip' + (shown.length && !all ? ' part' : '')}
              onClick={() => edit(m => {
                if (!supported(m, ctx)) return null;
                const off = new Set(Array.isArray(m.badges_off) ? m.badges_off : []);
                if (all) off.add(id); else off.delete(id);
                return { badges_off: BADGES.map(b => b.id).filter(b => off.has(b)) };
              })}>
              {t(name)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Appearance() {
  const { models, edit } = useEditor();
  const anyIcon = models.some(m => m.static_icon);

  return (
    <>
      <Card title={t('Logo')} sub={t('Shown in the picker and beside replies. The other states fall back to the static logo.')}
        actions={anyIcon
          ? <Btn size="sm" onClick={() => edit({ static_icon: '', generating_icon: '', thinking_icon: '' })}>{t('Clear all three')}</Btn>
          : <Btn size="sm" onClick={() => edit({ static_icon: BRAND_ICON, generating_icon: BRAND_GENERATING, thinking_icon: BRAND_THINKING })}>{t('Use the built-in mark')}</Btn>}>
        <Fields cols={3}>
          <Icon k="static_icon" label={t('Static')} />
          <Icon k="generating_icon" label={t('While generating')} fallback motion="generating_anim" />
          <When test={reasons} keep={['thinking_icon', 'thinking_anim']}>
            <Icon k="thinking_icon" label={t('While thinking')} fallback motion="thinking_anim" />
          </When>
        </Fields>
        <Rows>
          <Size />
          <Choice k="icon_position" row label={t('Position')} note={t('Where the logo sits against the reply.')} fallback="below"
            options={[{ value: 'below', label: t('Below') }, { value: 'left', label: t('Left') }, { value: 'above', label: t('Above') }]} />
          <Flag k="show_name" label={t('Name beside replies')} note={t('Prints the model name next to its logo on each reply.')} />
        </Rows>
      </Card>

      <Card title={t('In the picker')}>
        <Rows>
          <When test={m => !!m.static_icon} keep="dropdown_icon">
            <Flag k="dropdown_icon" label={t('Logo in the picker')} note={t('Shows the static logo beside the name in the model list.')} />
          </When>
          <Badges />
        </Rows>
      </Card>

      <Card title={t('Showcase backdrop')} sub={t('An optional backdrop behind the whole interface while this model is selected.')}>
        <Rows>
          <Flag k="bg_enabled" label={t('Use a backdrop')} note={t('Applies only while a member has this model chosen.')} />
        </Rows>
        <When k="bg_enabled" keep="bg_image">
          <TextField k="bg_image" mono label={t('Image URL or CSS gradient')} placeholder="linear-gradient(120deg, #f7b733, #fc4a1a)"
            hint={t('A remote URL needs the origin lock in Network turned off.')} />
        </When>
      </Card>
    </>
  );
}
