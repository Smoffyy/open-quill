import { useState } from 'react';
import {
  Card, Rows, Row, ToggleRow, Fields, Field, Input, Select, Seg, Switch, Btn, IconBtn, Badge, Note, Table, Acts,
  PointMenu, MenuItem, clampToViewport
} from '../../ui.jsx';
import { Plus, Copy, Trash, Chevron, Up, Down } from '../../../ui/icons.jsx';
import { KwargControl } from '../../../composer/ModelDropdown.jsx';
import { useEditor, useField, useChange, CardMark } from '../bind.jsx';
import { t, tk } from '../../../../i18n.jsx';
import {
  KWARG_PRESETS, REPLAY_FIELDS, blankKwarg, newKwargId, isBoolPair, kwargValuesArr, defaultValueOf,
  trueValueOf, falseValueOf, isRange, isOffStep, stopLabel, stepFields, clampToRange, rangeStep, rangeLabel,
  resolveKwargValues, kwargPayload, kwargVisible, replayWhenOf, replayValuesOf, replayFieldFor, pickerChips,
  isBudgetKwarg, budgetMessageOff, BUDGET_MESSAGE_TEXT, kwargPath, kwargMode, kwargKind, kindPatch, modePatch,
  fixedValuePatch, followable, followPatch, parentChoices
} from '../../../../lib/kwargs.js';

const MENU_W = 340;
const MENU_H = 460;

const TARGET_NOTE = {
  __proto__: null,
  chat_template_kwargs: tk('Nested under chat_template_kwargs, which is where a chat template reads values it consumes itself, such as enable_thinking.'),
  body: tk('A plain field beside model and messages. Use this for anything the server reads directly, such as reasoning_budget_tokens on llama.cpp.'),
  extra_body: tk('Nested under a literal extra_body object. Only gateways that unwrap it will see it: llama.cpp and vLLM ignore it, and the OpenAI SDKs flatten extra_body before sending, so match them with the top level instead.')
};

const TARGETS = [
  { value: 'chat_template_kwargs', label: 'chat_template_kwargs' },
  { value: 'body', label: tk('Top level of the request') },
  { value: 'extra_body', label: 'extra_body' }
];

const TYPES = [
  { value: 'auto', label: tk('Automatic') },
  { value: 'boolean', label: tk('Boolean') },
  { value: 'number', label: tk('Number') },
  { value: 'string', label: tk('String') }
];

const REPLAY_LABEL = { __proto__: null, reasoning_content: 'reasoning_content (llama.cpp, vLLM, LM Studio)' };

const MODES = [
  { value: 'choose', label: tk('Members choose'), note: tk('A control in the model picker.') },
  { value: 'fixed', label: tk('Always the same'), note: tk('Hidden. One value on every request.') },
  { value: 'follow', label: tk('Follows another'), note: tk('Derived from another control.') }
];

const KINDS = [
  { value: 'toggle', label: tk('On/off toggle'), note: tk('Sends true or false.') },
  { value: 'list', label: tk('A fixed list'), note: tk('One of the values you list.') },
  { value: 'steps', label: tk('Labelled steps'), note: tk('Named levels that each send a number.') },
  { value: 'range', label: tk('A number range'), note: tk('Any number between two limits.') }
];

const STYLES = {
  __proto__: null,
  toggle: [['auto', tk('Automatic')], ['toggle', tk('On/off toggle')], ['slider', tk('Slider')], ['select', tk('Dropdown')]],
  list: [['auto', tk('Automatic')], ['slider', tk('Slider')], ['select', tk('Dropdown')]]
};

const CHIP_HINT = {
  __proto__: null,
  toggle: tk('Shown beside the model name while it is on.'),
  list: tk('Shown beside the model name. {value} becomes the chosen value.'),
  steps: tk('{value} becomes the word for the current step.'),
  range: tk('Shown beside the model name. {value} becomes the current number, as in Thinking · {value} tokens.')
};

export function legacyKwarg(m) {
  const levels = (Array.isArray(m.effort_levels) && m.effort_levels.length)
    ? m.effort_levels
    : String(m.effort_levels || 'low, medium, high').split(',').map(x => x.trim()).filter(Boolean);
  const bool = isBoolPair(levels);
  return {
    ...blankKwarg(),
    id: 'effort',
    name: (m.effort_kwarg || 'reasoning_effort').trim() || 'reasoning_effort',
    label: bool ? t('Extended thinking') : t('Reasoning effort'),
    description: bool ? t('Let the model think before answering') : '',
    chip: bool ? t('Thinking') : '',
    values: levels,
    default: levels.includes(m.effort_default) ? m.effort_default : '',
    adminOnly: !!m.effort_admin_only
  };
}

const titleOf = (def) => def?.label || def?.name || t('Untitled control');

const gateValues = (def) => (!def || isRange(def) ? [] : kwargValuesArr(def));

function keepDefault(values, wanted) {
  return values.includes(wanted) ? wanted : '';
}

function choiceLabel(def, value) {
  if (value === '*') return t('any value');
  const label = stopLabel(def, value);
  return label === value ? value : `${label} (${value})`;
}

function summaryOf(def, defs) {
  const mode = kwargMode(def);
  if (mode === 'follow') return t('Follows {name}', { name: titleOf(defs.find(d => d.id === def.parentId)) });
  if (mode === 'fixed') {
    const value = defaultValueOf(def);
    return value ? t('Always sends {value}', { value }) : t('No value yet');
  }
  const kind = kwargKind(def);
  if (kind === 'toggle') return t('On/off switch for members');
  if (kind === 'range') {
    return t('Members pick {min} to {max}', { min: rangeLabel(def, def.min, t('Off')), max: rangeLabel(def, def.max, t('Off')) });
  }
  const values = kwargValuesArr(def);
  if (!values.length) return t('No values yet');
  return t('Members pick {values}', { values: values.map(v => stopLabel(def, v)).join(' · ') });
}

function Flags({ def, defs }) {
  const choose = kwargMode(def) === 'choose';
  const gate = choose && def.showIf?.id ? defs.find(d => d.id === def.showIf.id) : null;
  return (
    <span className="cp-badges">
      {!def.name && <Badge tone="bad">{t('no key')}</Badge>}
      {choose && !!def.adminOnly && <Badge>{t('admins only')}</Badge>}
      {gate && <Badge>{t('only when {name} = {value}', { name: titleOf(gate), value: def.showIf.value })}</Badge>}
      {!!replayWhenOf(def) && <Badge>{t('sends back thinking')}</Badge>}
      {isBudgetKwarg(def) && !!def.budgetMessage?.enabled && <Badge>{t('sends a budget message')}</Badge>}
    </span>
  );
}

function Section({ title, note, children }) {
  return (
    <section className="mc-kw-sec">
      <div className="mc-kw-sec-head">
        <h4>{title}</h4>
        {note && <p>{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Choice({ value, options, onPick, label }) {
  return (
    <div className="mc-choice" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" className="mc-choice-opt" aria-pressed={o.value === value}
          disabled={o.disabled} data-tip={o.tip} onClick={() => onPick(o.value)}>
          <b>{t(o.label)}</b>
          <span>{t(o.note)}</span>
        </button>
      ))}
    </div>
  );
}

function RequestField({ def, patch }) {
  const target = def.target || 'chat_template_kwargs';
  return (
    <Section title={t('Request field')} note={t('The name the server reads and where it sits in the request.')}>
      <Fields cols={2}>
        <Field label={t('Key')} hint={t('The exact name the server expects. Blank sends nothing.')}>
          <Input mono value={def.name || ''} placeholder="enable_thinking" aria-label={t('Key')}
            onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label={t('Sent in')} hint={t(TARGET_NOTE[target])}>
          <Select value={target} label={t('Sent in')} onChange={(v) => patch({ target: v })}
            options={TARGETS.map(o => ({ value: o.value, label: t(o.label) }))} />
        </Field>
      </Fields>
    </Section>
  );
}

function ToggleDefault({ def, patch }) {
  const on = /^true$/i.test(defaultValueOf(def));
  return (
    <Field label={t('Default')} hint={t('Off sends false and on sends true.')}>
      <Seg value={on ? 'on' : 'off'} label={t('Default')}
        options={[{ value: 'off', label: t('Off') }, { value: 'on', label: t('On') }]}
        onChange={(v) => patch({ default: v === 'on' ? trueValueOf(def) : falseValueOf(def) })} />
    </Field>
  );
}

function DefaultSelect({ def, patch, label = (v) => v }) {
  const values = kwargValuesArr(def);
  return (
    <Fields cols={2}>
      <Field label={t('Default')} hint={values.length ? t('Currently {v}.', { v: label(defaultValueOf(def)) }) : undefined}>
        <Select value={keepDefault(values, def.default)} label={t('Default')} onChange={(v) => patch({ default: v })}
          options={[{ value: '', label: t('automatic') }, ...values.map(v => ({ value: v, label: label(v) }))]} />
      </Field>
    </Fields>
  );
}

function ListEditor({ def, patch }) {
  const list = Array.isArray(def.values) ? def.values : kwargValuesArr(def);

  function save(next, wanted = def.default) {
    patch({ values: next, default: keepDefault(next.map(v => String(v).trim()), wanted) });
  }

  function rename(i, value) {
    save(list.map((v, j) => (j === i ? value : v)), list[i] === def.default ? value.trim() : def.default);
  }

  return (
    <>
      <Field label={t('Values')} hint={t('In order, lowest first. A slider moves through them from left to right.')}>
        <div className="mc-kw-values">
          {list.map((v, i) => (
            <div key={i} className="cp-inline">
              <Input mono value={v} placeholder="medium" aria-label={t('Value {n}', { n: i + 1 })}
                onChange={(e) => rename(i, e.target.value)} />
              <IconBtn kind="quiet" label={t('Remove value')} disabled={list.length <= 1}
                onClick={() => save(list.filter((_, j) => j !== i))}><Trash /></IconBtn>
            </div>
          ))}
        </div>
        <Acts><Btn size="sm" onClick={() => save([...list, ''])}><Plus /> {t('Add value')}</Btn></Acts>
      </Field>
      <DefaultSelect def={def} patch={patch} />
    </>
  );
}

function StepsEditor({ def, patch }) {
  const stops = def.stops || [];

  function save(list, wanted = def.default) {
    const next = stepFields(list);
    patch({ ...next, default: keepDefault(next.values, wanted) });
  }

  function setStop(i, p) {
    const moved = 'value' in p && String(stops[i].value) === def.default;
    save(stops.map((s, j) => (j === i ? { ...s, ...p } : s)), moved ? String(p.value).trim() : def.default);
  }

  return (
    <>
      <Field label={t('Steps')} hint={t('Members see the label and the number is what gets sent. Turn off In model name for a step such as Off that should add nothing beside the model name.')}>
        <Table head={[
          { label: t('Label') },
          { label: t('Sends'), mono: true },
          { label: t('In model name'), fit: true },
          { label: '', fit: true }
        ]}>
          {stops.map((s, i) => (
            <tr key={i}>
              <td>
                <Input value={s.label || ''} placeholder={t('Off')} aria-label={t('Label')} onChange={(e) => setStop(i, { label: e.target.value })} />
              </td>
              <td>
                <Input mono type="number" step="any" value={s.value ?? ''} placeholder="1024" aria-label={t('Sends')} onChange={(e) => setStop(i, { value: e.target.value })} />
              </td>
              <td className="fit">
                <Switch on={!isOffStep(s)} label={t('In model name')} onToggle={() => setStop(i, { off: !isOffStep(s) })} />
              </td>
              <td className="fit">
                <IconBtn kind="quiet" label={t('Remove step')} disabled={stops.length <= 1} onClick={() => save(stops.filter((_, j) => j !== i))}><Trash /></IconBtn>
              </td>
            </tr>
          ))}
        </Table>
        <Acts><Btn size="sm" onClick={() => save([...stops, { label: '', value: '', off: false }])}><Plus /> {t('Add step')}</Btn></Acts>
      </Field>
      <DefaultSelect def={def} patch={patch} label={(v) => stopLabel(def, v)} />
    </>
  );
}

function RangeEditor({ def, patch }) {
  const valid = isRange(def);
  return (
    <>
      <Fields cols={4}>
        <Field label={t('Minimum')}>
          <Input mono type="number" value={def.min ?? ''} aria-label={t('Minimum')} onChange={(e) => patch({ min: e.target.value })} />
        </Field>
        <Field label={t('Maximum')}>
          <Input mono type="number" value={def.max ?? ''} aria-label={t('Maximum')} onChange={(e) => patch({ max: e.target.value })} />
        </Field>
        <Field label={t('Step')}>
          <Input mono type="number" min="0" step="any" value={def.step ?? ''} placeholder="1" aria-label={t('Step')} onChange={(e) => patch({ step: e.target.value })} />
        </Field>
        <Field label={t('Unit')} optional>
          <Input value={def.unit || ''} placeholder={t('tokens')} aria-label={t('Unit')} onChange={(e) => patch({ unit: e.target.value })} />
        </Field>
      </Fields>
      {!valid && <Note tone="warn">{t('The maximum must be above the minimum.')}</Note>}
      <Fields cols={2}>
        <Field label={t('Default')} hint={valid ? t('Currently {v}.', { v: rangeLabel(def, defaultValueOf(def), t('Off')) }) : undefined}>
          <Input mono type="number" min={def.min} max={def.max} step={rangeStep(def)} aria-label={t('Default')}
            value={def.default ?? ''} placeholder={t('automatic')}
            onChange={(e) => patch({ default: e.target.value })}
            onBlur={(e) => { if (!valid) return; const c = clampToRange(def, e.target.value); patch({ default: c == null ? '' : String(c) }); }} />
        </Field>
      </Fields>
      <Rows>
        <ToggleRow label={t('0 means off')} note={t('At 0 the picker says Off and the model name shows no chip.')}
          on={!!def.zeroOff} onToggle={() => patch({ zeroOff: !def.zeroOff })} />
      </Rows>
    </>
  );
}

function Choices({ def, patch }) {
  const kind = kwargKind(def);
  return (
    <Section title={t('Choices')} note={t('What members can pick from.')}>
      <Choice value={kind} label={t('Choices')} options={KINDS} onPick={(k) => { if (k !== kind) patch(kindPatch(def, k)); }} />
      {kind === 'toggle' && <ToggleDefault def={def} patch={patch} />}
      {kind === 'list' && <ListEditor def={def} patch={patch} />}
      {kind === 'steps' && <StepsEditor def={def} patch={patch} />}
      {kind === 'range' && <RangeEditor def={def} patch={patch} />}
    </Section>
  );
}

function FixedValue({ def, patch }) {
  const [text, setText] = useState(null);
  return (
    <Section title={t('Value')} note={t('Sent with every request. Members never see it.')}>
      <Fields cols={2}>
        <Field label={t('Value sent')}>
          <Input mono value={text ?? defaultValueOf(def)} placeholder="true" aria-label={t('Value sent')}
            onChange={(e) => { setText(e.target.value); patch(fixedValuePatch(e.target.value)); }}
            onBlur={() => setText(null)} />
        </Field>
      </Fields>
    </Section>
  );
}

function Follow({ def, defs, patch }) {
  const parent = defs.find(d => d.id === def.parentId);
  const choices = parentChoices(parent);
  const rules = Array.isArray(def.rules) ? def.rules : [];

  function setRule(when, p) {
    const next = rules.slice();
    const i = next.findIndex(r => r.when === when);
    if (i < 0) next.push({ when, value: '', send: true, ...p });
    else next[i] = { ...next[i], ...p };
    patch({ rules: next });
  }

  return (
    <Section title={t('Follows')} note={t('Pick the control to follow, then what to send for each of its values.')}>
      <Fields cols={2}>
        <Field label={t('Follows')}>
          <Select value={def.parentId} label={t('Follows')}
            onChange={(id) => patch(followPatch(def, defs.find(d => d.id === id)))}
            options={followable(defs, def).map(d => ({ value: d.id, label: titleOf(d) }))} />
        </Field>
      </Fields>
      {choices.length === 0 ? (
        <Note>{t('The kwarg it follows has no values yet.')}</Note>
      ) : (
        <Table head={[
          { label: t('When {name} is', { name: titleOf(parent) }), fit: true },
          { label: t('Send'), fit: true },
          { label: t('Value') }
        ]}>
          {choices.map(pv => {
            const rule = rules.find(r => r.when === pv);
            const on = !!rule && rule.send !== false;
            return (
              <tr key={pv}>
                <td className="mono">{choiceLabel(parent, pv)}</td>
                <td className="fit">
                  <Switch on={on} label={on ? t('Sent') : t('Omitted')}
                    onToggle={() => setRule(pv, on ? { send: false } : { send: true, value: rule?.value || (pv === '*' ? 'true' : pv) })} />
                </td>
                <td>
                  {on ? (
                    <Input mono value={rule.value || ''} placeholder={t('value to send')} aria-label={t('Value')}
                      onChange={(e) => setRule(pv, { value: e.target.value })} />
                  ) : <span className="dim">{t('nothing is sent')}</span>}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );
}

function Picker({ def, defs, patch }) {
  const kind = kwargKind(def);
  const styles = STYLES[kind];
  const gates = defs.filter(d => d.id !== def.id && !d.parentId && gateValues(d).length);
  const gate = def.showIf?.id ? defs.find(d => d.id === def.showIf.id) : null;

  function setGate(id) {
    if (!id) return patch({ showIf: null });
    const opts = gateValues(defs.find(d => d.id === id));
    return patch({ showIf: { id, value: opts.includes(def.showIf?.value) ? def.showIf.value : (opts[opts.length - 1] || '') } });
  }

  return (
    <Section title={t('In the model picker')} note={t('How the control looks to members and who may change it.')}>
      <Fields cols={2}>
        <Field label={t('Title')}>
          <Input value={def.label || ''} placeholder={def.name || t('Extended thinking')} aria-label={t('Title')}
            onChange={(e) => patch({ label: e.target.value })} />
        </Field>
        <Field label={t('Description')} optional>
          <Input value={def.description || ''} placeholder={t('Let the model think before answering')} aria-label={t('Description')}
            onChange={(e) => patch({ description: e.target.value })} />
        </Field>
        <Field label={t('Picker chip')} hint={t(CHIP_HINT[kind])} optional>
          <Input value={def.chip || ''} placeholder={kind === 'range' ? t('Thinking · {value} tokens') : kind === 'steps' ? '{value}' : t('Thinking')}
            aria-label={t('Picker chip')} onChange={(e) => patch({ chip: e.target.value })} />
        </Field>
        {styles && (
          <Field label={t('Control')}>
            <Select value={def.control || 'auto'} label={t('Control')} onChange={(v) => patch({ control: v })}
              options={styles.map(([v, l]) => ({ value: v, label: t(l) }))} />
          </Field>
        )}
      </Fields>
      <Rows>
        <Row label={t('Who can change it')} note={def.adminOnly ? t('Members see it but cannot change it.') : undefined} wide>
          <Seg value={def.adminOnly ? 'admins' : 'everyone'} label={t('Who can change it')}
            options={[{ value: 'everyone', label: t('Everyone') }, { value: 'admins', label: t('Admins only') }]}
            onChange={(v) => patch({ adminOnly: v === 'admins' })} />
        </Row>
      </Rows>
      <Fields cols={2}>
        <Field label={t('Only show when')} hint={gate ? undefined : t('Keeps its own control but hides it until the chosen kwarg holds the value beside it, so a thinking budget can appear only once thinking is on.')}>
          <Select value={gate ? def.showIf.id : ''} label={t('Only show when')} onChange={setGate}
            options={[{ value: '', label: t('always shown') }, ...gates.map(d => ({ value: d.id, label: titleOf(d) }))]} />
        </Field>
        {gate && (
          <Field label={t('Has the value')}>
            <Select value={def.showIf.value ?? ''} label={t('Has the value')}
              onChange={(v) => patch({ showIf: { id: def.showIf.id, value: v } })}
              options={gateValues(gate).map(v => ({ value: v, label: choiceLabel(gate, v) }))} />
          </Field>
        )}
      </Fields>
      {gate && (
        <Rows>
          <ToggleRow label={t('Send while hidden')} note={t('Whether its value still goes out while members cannot see it.')}
            on={def.sendWhenHidden !== false} onToggle={() => patch({ sendWhenHidden: def.sendWhenHidden === false })} />
        </Rows>
      )}
    </Section>
  );
}

function BudgetMessage({ def, patch }) {
  const message = { ...budgetMessageOff(), ...def.budgetMessage };
  const set = (p) => patch({ budgetMessage: { ...message, ...p } });
  return (
    <Section title={t('When the budget runs out')}>
      <Rows>
        <ToggleRow label={t('Send a message when the budget runs out')}
          note={t('Injected before the end-of-thinking tag once thinking uses its whole budget. Only sent while the budget is above 0.')}
          on={message.enabled} onToggle={() => set({ enabled: !message.enabled, text: message.text || BUDGET_MESSAGE_TEXT })} />
      </Rows>
      {message.enabled && (
        <>
          <Field label={t('Message')} hint={t('Sent as the value of that key. Blank sends nothing.')}>
            <Input value={message.text} placeholder={BUDGET_MESSAGE_TEXT} aria-label={t('Message')}
              onChange={(e) => set({ text: e.target.value })} />
          </Field>
          <Fields cols={3}>
            <Field label={t('Key')}>
              <Input mono value={message.name} placeholder="reasoning_budget_message" aria-label={t('Key')}
                onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label={t('Sent in')}>
              <Select value={message.target} label={t('Sent in')} onChange={(v) => set({ target: v })}
                options={TARGETS.map(o => ({ value: o.value, label: t(o.label) }))} />
            </Field>
            <Field label={t('Wire type')}>
              <Select value={message.type} label={t('Wire type')} onChange={(v) => set({ type: v })}
                options={TYPES.map(o => ({ value: o.value, label: t(o.label) }))} />
            </Field>
          </Fields>
        </>
      )}
    </Section>
  );
}

function Advanced({ def, patch }) {
  const replayWhen = replayWhenOf(def);
  const replayValues = replayValuesOf(def);
  if (replayWhen && replayWhen !== '*' && !replayValues.includes(replayWhen)) replayValues.push(replayWhen);
  return (
    <div className="mc-kw-adv">
      <Fields cols={2}>
        <Field label={t('Wire type')} hint={t('Automatic sends true and false as booleans, numerals as numbers, everything else as text.')}>
          <Select value={def.type || 'auto'} label={t('Wire type')} onChange={(v) => patch({ type: v })}
            options={TYPES.map(o => ({ value: o.value, label: t(o.label) }))} />
        </Field>
      </Fields>
      <Fields cols={2}>
        <Field label={t('Send back past thinking')}>
          <Select value={replayWhen} label={t('Send back past thinking')} onChange={(v) => patch({ replayWhen: v })}
            options={[{ value: '', label: t('never') }, { value: '*', label: t('whenever it is sent') },
              ...replayValues.map(v => ({ value: v, label: t('when it is {value}', { value: v }) }))]} />
        </Field>
        {!!replayWhen && (
          <Field label={t('Sent as')}>
            <Select value={def.replayAs || REPLAY_FIELDS[0]} label={t('Sent as')} onChange={(v) => patch({ replayAs: v })}
              options={REPLAY_FIELDS.map(v => ({ value: v, label: REPLAY_LABEL[v] || v }))} />
          </Field>
        )}
      </Fields>
      <p className="cp-note-line">
        {t('For a kwarg like preserve_thinking that tells the model to keep its earlier thinking. While it is sent with the value picked here, earlier replies go back to the model together with the thinking behind them, so it remembers what it thought. The second box is the field the server reads that thinking from.')}
      </p>
    </div>
  );
}

function Editor({ def, defs, patch }) {
  const mode = kwargMode(def);
  const [more, setMore] = useState(() => (def.type || 'auto') !== 'auto' || !!replayWhenOf(def));
  const canFollow = followable(defs, def).length > 0;
  const modes = MODES.map(o => (o.value === 'follow' && !canFollow ? { ...o, disabled: true, tip: t('Add another control to follow first.') } : o));

  return (
    <div className="mc-kw-body">
      <RequestField def={def} patch={patch} />
      <Section title={t('Who sets the value')}>
        <Choice value={mode} label={t('Who sets the value')} options={modes}
          onPick={(m) => { if (m !== mode) patch(modePatch(defs, def, m)); }} />
      </Section>
      {mode === 'choose' && <Choices def={def} patch={patch} />}
      {mode === 'fixed' && <FixedValue def={def} patch={patch} />}
      {mode === 'follow' && <Follow def={def} defs={defs} patch={patch} />}
      {mode === 'choose' && <Picker def={def} defs={defs} patch={patch} />}
      {isBudgetKwarg(def) && <BudgetMessage def={def} patch={patch} />}
      <div className={'mc-kw-more' + (more ? ' open' : '')}>
        <button type="button" className="mc-kw-more-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
          <Chevron />
          <span>{t('Advanced')}</span>
          <small>{t('Wire type and earlier thinking')}</small>
        </button>
        {more && <Advanced def={def} patch={patch} />}
      </div>
    </div>
  );
}

function Presets({ onPick }) {
  return (
    <div className="mc-kw-start">
      <p className="cp-note-line">
        {t('A request control adds a field such as enable_thinking to every request, and can give members a switch or slider for it in the model picker. Start from a common one:')}
      </p>
      <div className="mc-kw-presets">
        {KWARG_PRESETS.map(p => (
          <button key={p.key} type="button" className="mc-kw-preset" onClick={() => onPick(p)}>
            <b>{t(p.title)}</b>
            {p.name && <code>{p.name}</code>}
            <span>{t(p.note)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TryIt({ defs, name }) {
  const [picked, setPicked] = useState({});
  const [asAdmin, setAsAdmin] = useState(false);
  const values = resolveKwargValues(defs, picked, asAdmin);
  const shown = defs.filter(d => kwargVisible(defs, values, d));
  const shownIds = new Set(shown.map(d => d.id));
  const chips = pickerChips(defs, values);
  const payload = kwargPayload(defs, values);
  const replay = replayFieldFor(defs, values);
  const json = JSON.stringify({ model: '…', messages: '[ … ]', ...payload }, null, 2);

  return (
    <Card title={t('Try it')} sub={t('Use the controls the way a member would and see exactly what each request carries.')}
      actions={(
        <Seg value={asAdmin ? 'admin' : 'member'} label={t('Preview as')}
          options={[{ value: 'member', label: t('Member') }, { value: 'admin', label: t('Admin') }]}
          onChange={(v) => setAsAdmin(v === 'admin')} />
      )}>
      <div className="mc-try">
        <div className="mc-try-side">
          <span className="mc-try-label">{t('Model picker')}</span>
          <div className="mc-try-trigger">
            <b>{name || t('Model')}</b>
            {chips.map((c, i) => <span key={c + i}>{t(c)}</span>)}
          </div>
          <div className="mc-try-menu">
            {shown.length ? shown.map(d => (
              <KwargControl key={d.id} def={d} value={values[d.id]} isAdmin={asAdmin}
                onSet={(id, v) => setPicked(p => ({ ...p, [id]: v }))}
                gated={!!(d.showIf && d.showIf.id && shownIds.has(d.showIf.id))} />
            )) : <p className="mc-try-none">{t('Members get no controls for this model.')}</p>}
          </div>
        </div>
        <div className="mc-try-side">
          <span className="mc-try-label">{t('Request body')}</span>
          <pre className="mc-code">{json}</pre>
          {replay && <p className="cp-note-line">{t('Earlier replies go back with their thinking in {field}.', { field: replay })}</p>}
        </div>
      </div>
    </Card>
  );
}

export default function Controls() {
  const { single, edit } = useEditor();
  const { value, mixed } = useField('kwargs');
  const change = useChange('kwargs');
  const [open, setOpen] = useState(null);
  const [menu, setMenu] = useState(null);
  const defs = Array.isArray(value) ? value : [];

  const put = (list) => edit({ kwargs: list });
  const patch = (id, p) => put(defs.map(d => (d.id === id ? { ...d, ...p } : d)));

  function add(preset) {
    setMenu(null);
    const made = preset.make(defs);
    const used = new Set(defs.map(d => d.id));
    while (used.has(made.id)) made.id = newKwargId();
    put([...defs, made]);
    setOpen(made.id);
  }

  function duplicate(def) {
    const copy = { ...def, id: newKwargId(), rules: (def.rules || []).map(r => ({ ...r })) };
    const list = defs.slice();
    list.splice(defs.indexOf(def) + 1, 0, copy);
    put(list);
    setOpen(copy.id);
  }

  function remove(def) {
    put(defs.filter(d => d.id !== def.id).map(d => (d.parentId === def.id ? { ...d, parentId: '', rules: [] } : d)));
  }

  function shift(i, dir) {
    const list = defs.slice();
    const [row] = list.splice(i, 1);
    list.splice(i + dir, 0, row);
    put(list);
  }

  const legacy = single && !!single.effort_enabled && !defs.length;

  return (
    <>
      <Card title={<CardMark label={t('Request controls')} k="kwargs" />} className={change.changed ? 'mc-changed' : undefined}
        sub={t('Extra fields sent with every request to this model, and the controls members get for them in the model picker.')}
        actions={!mixed && defs.length > 0 && (
          <Btn size="sm" aria-haspopup="menu" aria-expanded={!!menu}
            onClick={(e) => {
              if (menu) { setMenu(null); return; }
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ at: clampToViewport(r.right - MENU_W, r.bottom + 4, MENU_W, MENU_H), el: e.currentTarget });
            }}>
            <Plus /> {t('Add control')}
          </Btn>
        )}>
        {mixed ? (
          <Note>{t('The selected models send different request controls. Pick one set from Mixed to give all of them the same controls.')}</Note>
        ) : (
          <>
            {legacy && (
              <Note tone="warn">
                {t('This model still uses the old thinking control. Converting it to a kwarg unlocks custom labels, extra values, and paired kwargs. Nothing changes for members: the same value goes out under the same name.')}
                <div className="cp-acts mc-note-acts">
                  <Btn size="sm" kind="primary" onClick={() => edit({ kwargs: [legacyKwarg(single)], effort_enabled: 0 })}>{t('Convert')}</Btn>
                </div>
              </Note>
            )}
            {defs.length === 0 ? <Presets onPick={add} /> : (
              <ul className="mc-kws">
                {defs.map((def, i) => {
                  const shown = open === def.id;
                  return (
                    <li key={def.id} className={'mc-kw' + (shown ? ' open' : '')}>
                      <div className="mc-kw-head">
                        <button type="button" className="mc-kw-toggle" aria-expanded={shown}
                          onClick={() => setOpen(shown ? null : def.id)}>
                          <Chevron />
                          <span className="mc-kw-text">
                            <b>{titleOf(def)}</b>
                            <span>
                              {!!def.name && <><code>{kwargPath(def)}</code> · </>}
                              {summaryOf(def, defs)}
                            </span>
                          </span>
                        </button>
                        <Flags def={def} defs={defs} />
                        <span className="cp-acts mc-kw-acts">
                          <IconBtn kind="quiet" label={t('Move up')} disabled={i === 0} onClick={() => shift(i, -1)}><Up /></IconBtn>
                          <IconBtn kind="quiet" label={t('Move down')} disabled={i === defs.length - 1} onClick={() => shift(i, 1)}><Down /></IconBtn>
                          <IconBtn kind="quiet" label={t('Duplicate')} onClick={() => duplicate(def)}><Copy /></IconBtn>
                          <IconBtn kind="danger" label={t('Delete')} onClick={() => remove(def)}><Trash /></IconBtn>
                        </span>
                      </div>
                      {shown && <Editor key={def.id} def={def} defs={defs} patch={(p) => patch(def.id, p)} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Card>

      {!mixed && defs.length > 0 && <TryIt defs={defs} name={single?.display_name} />}

      {menu && (
        <PointMenu at={menu.at} width={MENU_W} anchorEl={menu.el} onClose={() => setMenu(null)}>
          {KWARG_PRESETS.map(p => (
            <MenuItem key={p.key} onClick={() => add(p)}>
              <span className="mc-menu-two">
                <b>{t(p.title)}{p.name && <code className="mc-menu-key">{p.name}</code>}</b>
                <small>{t(p.note)}</small>
              </span>
            </MenuItem>
          ))}
        </PointMenu>
      )}
    </>
  );
}