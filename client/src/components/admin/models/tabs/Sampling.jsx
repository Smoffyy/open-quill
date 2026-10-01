import { useAdmin } from '../../store.jsx';
import { Card, Fields } from '../../ui.jsx';
import { useEditor, NumberField, LongText, When } from '../bind.jsx';
import { t, tk } from '../../../../i18n.jsx';

const BANKS = [
  [tk('Core'), tk('Randomness and length. The ones worth touching first.'), [
    ['temperature', '0.0 – 2.0'], ['top_p', '0.0 – 1.0'], ['top_k', '40'], ['min_p', '0.0 – 1.0'],
    ['max_tokens', '2048'], ['seed', 'integer']
  ]],
  [tk('Repetition'), tk('Discourage the model from looping. DRY is llama.cpp only; its other settings appear once its multiplier is above 0.'), [
    ['repetition_penalty', '1.1'], ['presence_penalty', '-2.0 – 2.0'], ['frequency_penalty', '-2.0 – 2.0'],
    ['dry_multiplier', '0 = off'], ['dry_base', '1.75', 'dry_multiplier'], ['dry_allowed_length', '2', 'dry_multiplier'],
    ['dry_penalty_last_n', '-1 = all', 'dry_multiplier']
  ]],
  [tk('Experimental'), tk('XTC and Mirostat change how tokens are picked. Their other settings appear once each is switched on.'), [
    ['xtc_probability', '0 = off'], ['xtc_threshold', '0.1', 'xtc_probability'],
    ['mirostat', '0, 1, or 2'], ['mirostat_tau', '5.0', 'mirostat'], ['mirostat_eta', '0.1', 'mirostat']
  ]]
];

const FALLBACK = ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'];

export default function Sampling() {
  const { catalog } = useAdmin();
  const { providers, providerTypes } = catalog;
  const { models } = useEditor();

  const types = new Set();
  const allowed = new Set();
  for (const m of models) {
    const conn = providers.find(p => p.id === m.provider_id) || providers[0];
    const type = conn ? providerTypes[conn.type] : null;
    if (type) types.add(type.label);
    for (const k of (type?.samplers || FALLBACK)) allowed.add(k);
  }

  return (
    <>
      <Card title={t('Sampling')}
        sub={types.size === 1
          ? t('Blank uses the backend default. Only parameters {name} accepts are shown.', { name: [...types][0] })
          : t('Blank uses the backend default.')}>
        <LongText k="stop" mono rows={3} label={t('Stop sequences')} placeholder={'</s>\n<|im_end|>'}
          hint={t('One per line, up to 8. Generation stops as soon as one appears and the sequence itself is not shown.')} />
      </Card>
      {BANKS.map(([title, note, fields]) => {
        const shown = fields.filter(([k]) => allowed.has(k));
        if (!shown.length) return null;
        return (
          <Card key={title} title={t(title)} sub={t(note)}>
            <Fields cols={3}>
              {shown.map(([k, ph, parent]) => (parent
                ? (
                  <When key={k} test={m => Number(m[parent]) > 0} keep={k}>
                    <NumberField k={k} label={k} placeholder={ph} />
                  </When>
                )
                : <NumberField key={k} k={k} label={k} placeholder={ph} />))}
            </Fields>
          </Card>
        );
      })}
    </>
  );
}