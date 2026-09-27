import { useState, useEffect } from 'react';
import { api } from '../../../../lib/api.js';
import { useAdmin } from '../../store.jsx';
import { Card, Rows, Fields, Btn, Note } from '../../ui.jsx';
import { useEditor, When, TextField, NumberField, Flag, Choice, LongText } from '../bind.jsx';
import { t } from '../../../../i18n.jsx';

function Preset() {
  const { single, edit } = useEditor();
  const [preset, setPreset] = useState(null);
  const name = (single?.internal_name || '').trim();

  useEffect(() => {
    let alive = true;
    if (!name) { setPreset(null); return undefined; }
    api.get('/api/admin/pricing/preset?name=' + encodeURIComponent(name))
      .then(r => { if (alive) setPreset(r.preset || null); }).catch(() => {});
    return () => { alive = false; };
  }, [name]);

  if (!preset) return null;
  const same = Number(single.cost_in) === preset.in && Number(single.cost_out) === preset.out;
  return (
    <Note>
      {t('The price table matches this id to {label}: ${in} in, ${out} out.', { label: preset.label, in: preset.in, out: preset.out })}
      {!same && (
        <div className="cp-acts mc-note-acts">
          <Btn size="sm" onClick={() => edit({ cost_in: preset.in, cost_out: preset.out })}>{t('Use {label}', { label: preset.label })}</Btn>
        </div>
      )}
    </Note>
  );
}

export default function General() {
  const { catalog } = useAdmin();
  const { providers, providerTypes } = catalog;
  const { many, single, models } = useEditor();
  const answers = models.some(m => m.kind !== 'router');

  return (
    <>
      <Card title={t('Identity')}>
        <Fields cols={2}>
          <TextField k="display_name" solo label={t('Display name')} placeholder={t('Untitled')} hint={t('What members see in the picker.')} />
          <Choice k="kind" label={t('Type')} fallback="model"
            hint={t('A router never calls a backend itself. It hands each turn to the first model whose rule matches.')}
            options={[{ value: 'model', label: t('Model') }, { value: 'router', label: t('Router') }]} />
          {answers && (
            <TextField k="internal_name" solo mono label={t('Model id')} placeholder="llama-3.1-8b-instruct"
              hint={t('Sent verbatim to the backend. Must match what the provider reports.')} />
          )}
          {answers && (
            <Choice k="provider_id" label={t('Connection')} hint={t('Which backend this model runs through.')}
              fallback={providers[0]?.id}
              options={providers.map(p => ({ value: p.id, label: p.name || providerTypes[p.type]?.label || p.type }))} />
          )}
          <TextField k="description" label={t('Subtitle')} placeholder={t('For complex tasks')} hint={t('One line under the name in the picker.')} />
        </Fields>
      </Card>

      <Card title={t('Availability')}>
        <Rows>
          <Flag k="enabled" label={t('Listed in the picker')} note={t('Off, the model is invisible to members but stays configured.')} />
          <When k="enabled" keep="is_default">
            <Flag k="is_default" disabled={many} label={t('Default for new accounts')}
              note={many ? t('Only one model can be the default. Select just that one.') : t('Pre-selected on first sign-in. Only one model holds this.')} />
          </When>
          <When k="enabled" keep="unavailable">
            <Flag k="unavailable" label={t('Marked as down')} note={t('Stays in the picker but cannot be selected. Use it while a backend is offline.')} />
          </When>
        </Rows>
        <When k="unavailable" keep="unavailable_reason">
          <LongText k="unavailable_reason" rows={3} label={t('Reason shown to members')}
            placeholder={t('Back after the GPU maintenance window.')} />
        </When>
        <Fields cols={2}>
          <TextField k="sunset_at" type="date" label={t('Retire on')}
            hint={t('Blank never retires. On the date, the model follows the action beside it.')} />
          <When test={m => !!m.sunset_at} keep="sunset_action">
            <Choice k="sunset_action" label={t('On that date')} fallback="hide"
              options={[{ value: 'hide', label: t('hide from the picker') }, { value: 'unavailable', label: t('mark as down') }]} />
          </When>
        </Fields>
      </Card>

      {answers && (
        <Card title={t('Price')} sub={t('Per million tokens. Drives the usage report and every spend cap.')}>
          <Fields cols={2}>
            <NumberField k="cost_in" min="0" label={t('Input $/M')} placeholder="3.00" />
            <NumberField k="cost_out" min="0" label={t('Output $/M')} placeholder="15.00" />
          </Fields>
          {single && <Preset />}
        </Card>
      )}
    </>
  );
}
