import { useState } from 'react';
import {
  Card, Rows, Row, Fields, Field, Input, Select, Switch, Btn, IconBtn, Badge, Empty, Note, Table,
  PointMenu, MenuItem, clampToViewport
} from '../../ui.jsx';
import { Plus, Copy, Trash, Chevron, Up, Down } from '../../../ui/icons.jsx';
import { useEditor, useField, useChange, CardMark } from '../bind.jsx';
import { t, tk } from '../../../../i18n.jsx';
import {
  KWARG_TARGETS, KWARG_CONTROLS, KWARG_TYPES, KWARG_PRESETS,
  blankKwarg, newKwargId, controlOf, defaultValueOf, isBoolPair,
  kwargValuesArr, kwargValuesStr, resolveKwargValues, kwargPayload,
  isRange, rangeStep, clampToRange, allNumeric,
  REPLAY_FIELDS, replayWhenOf, replayValuesOf
} from '../../../../lib/kwargs.js';

const MENU_W = 320;
const MENU_H = 300;

const TARGET_NOTE = {
  __proto__: null,
  chat_template_kwargs: tk('Nested under chat_template_kwargs, which is where a chat template reads values it consumes itself, such as enable_thinking.'),
  body: tk('A plain field beside model and messages. Use this for anything the server reads directly, such as reasoning_budget_tokens on llama.cpp.'),
  extra_body: tk('Nested under a literal extra_body object. Only gateways that unwrap it will see it: llama.cpp and vLLM ignore it, and the OpenAI SDKs flatten extra_body before sending, so match them with the top level instead.')
};

const CONTROL_TAG = {
  __proto__: null,
  toggle: tk('toggle'), slider: tk('slider'), range: tk('range'), select: tk('dropdown')
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

function gateValues(def) {
  return !def || isRange(def) ? [] : kwargValuesArr(def);
}

function descendants(defs, id) {
  const out = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of defs) {
      if (d.parentId && (d.parentId === id || out.has(d.parentId)) && !out.has(d.id)) { out.add(d.id); grew = true; }
    }
  }
  return out;
}

function nameOf(def) {
  return def?.name || def?.label || def?.id || '?';
}

function Summary({ def, defs }) {
  const parent = def.parentId ? defs.find(d => d.id === def.parentId) : null;
  const gate = def.showIf?.id ? defs.find(d => d.id === def.showIf.id) : null;
  return (
    <span className="cp-badges">
      {parent && <Badge tone="warn">{t('follows {name}', { name: nameOf(parent) })}</Badge>}
      {!parent && def.visible === false && <Badge>{t('hidden')}</Badge>}
      {!parent && def.visible !== false && gate && <Badge tone="warn">{t('only when {name} = {value}', { name: nameOf(gate), value: def.showIf.value })}</Badge>}
      {!parent && def.visible !== false && <Badge>{t(CONTROL_TAG[controlOf(def)] || CONTROL_TAG.select)}</Badge>}
      {!!def.adminOnly && <Badge>{t('admins only')}</Badge>}
      {!!replayWhenOf(def) && <Badge tone="warn">{t('sends back thinking')}</Badge>}
      {(def.target || 'chat_template_kwargs') !== 'chat_template_kwargs' && <Badge>{def.target}</Badge>}
      <Badge>{isRange(def) ? `${def.min}…${def.max}` : (kwargValuesStr(def) || t('no values'))}</Badge>
    </span>
  );
}

function Payload({ defs, requested, label }) {
  const payload = kwargPayload(defs, resolveKwargValues(defs, requested, true));
  const json = JSON.stringify({ model: '…', messages: '[ … ]', ...payload }, null, 2);
  return (
    <Field label={label}>
      <pre className="mc-code">{Object.keys(payload).length ? json : t('nothing is added to the request')}</pre>
    </Field>
  );
}

function DefEditor({ def, defs, patch }) {
  const [text, setText] = useState(null);
  const values = kwargValuesArr(def);
  const range = isRange(def);
  const linked = !!def.parentId;
  const parent = linked ? defs.find(d => d.id === def.parentId) : null;
  const parentValues = parent ? (isRange(parent) ? ['*'] : kwargValuesArr(parent)) : [];
  const rules = Array.isArray(def.rules) ? def.rules : [];
  const blocked = descendants(defs, def.id);
  const replayWhen = replayWhenOf(def);
  const replayValues = replayValuesOf(def);
  if (replayWhen && replayWhen !== '*' && !replayValues.includes(replayWhen)) replayValues.push(replayWhen);

  function setValues(raw) {
    setText(raw);
    const arr = raw.split(',').map(x => x.trim()).filter(Boolean);
    patch({ values: arr, default: arr.includes(def.default) ? def.default : '' });
  }

  function setShape(shape) {
    setText(null);
    if (shape === 'range') {
      const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      const min = nums.length ? nums[0] : 0;
      const max = nums.length > 1 ? nums[nums.length - 1] : min + 100;
      const gap = nums.length > 1 ? Math.abs(nums[1] - nums[0]) : 0;
      patch({ min, max, step: gap > 0 ? gap : 1, values: [], default: '' });
    } else {
      patch({ min: null, max: null, step: null, values: [], default: '' });
    }
  }

  function setRule(when, p) {
    const next = rules.slice();
    const i = next.findIndex(r => r.when === when);
    if (i < 0) next.push({ when, value: '', send: true, ...p });
    else next[i] = { ...next[i], ...p };
    patch({ rules: next });
  }

  return (
    <div className="mc-kw-body">
      <Fields cols={3}>
        <Field label={t('Key')} hint={t('The exact name the server expects. Blank sends nothing.')}>
          <Input mono value={def.name || ''} placeholder="enable_thinking" aria-label={t('Key')}
            onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label={t('Sent in')} hint={t(TARGET_NOTE[def.target || 'chat_template_kwargs'])}>
          <Select value={def.target || 'chat_template_kwargs'} label={t('Sent in')} onChange={(v) => patch({ target: v })}
            options={KWARG_TARGETS.map(([v, l]) => ({ value: v, label: t(l) }))} />
        </Field>
        <Field label={t('Wire type')} hint={t('Automatic sends true and false as booleans, numerals as numbers, everything else as text.')}>
          <Select value={def.type || 'auto'} label={t('Wire type')} onChange={(v) => patch({ type: v })}
            options={KWARG_TYPES.map(([v, l]) => ({ value: v, label: t(l) }))} />
        </Field>
      </Fields>

      <Fields cols={3}>
        <Field label={t('Values')}>
          <Select value={range ? 'range' : 'list'} label={t('Values')} onChange={setShape}
            options={[{ value: 'list', label: t('A fixed list') }, { value: 'range', label: t('A number range') }]} />
        </Field>
        {range ? (
          <Field label={t('Range')} hint={t('Minimum, maximum, and step. Members drag between them and cannot send anything outside.')}>
            <div className="mc-trio">
              <Input mono type="number" value={def.min ?? ''} placeholder={t('min')} aria-label={t('Minimum')} onChange={(e) => patch({ min: e.target.value })} />
              <Input mono type="number" value={def.max ?? ''} placeholder={t('max')} aria-label={t('Maximum')} onChange={(e) => patch({ max: e.target.value })} />
              <Input mono type="number" min="0" step="any" value={def.step ?? ''} placeholder={t('step')} aria-label={t('Step')} onChange={(e) => patch({ step: e.target.value })} />
            </div>
          </Field>
        ) : (
          <Field label={t('List')}
            hint={isBoolPair(values) ? t('Boolean pair detected, so this renders as a toggle.')
              : allNumeric(values) ? t('These are all numbers. A number range may suit them better.')
                : t('Comma separated, ordered lowest to highest.')}>
            <Input mono value={text ?? kwargValuesStr(def)} placeholder="false, true" aria-label={t('List')}
              onChange={(e) => setValues(e.target.value)} onBlur={() => setText(null)} />
          </Field>
        )}
        {!linked && (
          <Field label={t('Default')}
            hint={(range || values.length) ? t('Currently {v}.', { v: defaultValueOf(def) }) : undefined}>
            {range ? (
              <Input mono type="number" min={def.min} max={def.max} step={rangeStep(def)} aria-label={t('Default')}
                value={def.default ?? ''} placeholder={t('automatic')}
                onChange={(e) => patch({ default: e.target.value })}
                onBlur={(e) => { const c = clampToRange(def, e.target.value); patch({ default: c == null ? '' : String(c) }); }} />
            ) : (
              <Select value={values.includes(def.default) ? def.default : ''} label={t('Default')} onChange={(v) => patch({ default: v })}
                options={[{ value: '', label: t('automatic') }, ...values.map(v => ({ value: v, label: v }))]} />
            )}
          </Field>
        )}
      </Fields>

      {range && (
        <Fields cols={3}>
          <Field label={t('Unit')} hint={t('Shown after the number in the picker, such as tokens.')}>
            <Input value={def.unit || ''} placeholder={t('tokens')} aria-label={t('Unit')} onChange={(e) => patch({ unit: e.target.value })} />
          </Field>
          <Field label={t('0 means off')} hint={t('At 0 the picker says Off and the model name shows no chip.')}>
            <Switch on={!!def.zeroOff} label={t('0 means off')} onToggle={() => patch({ zeroOff: !def.zeroOff })} />
          </Field>
        </Fields>
      )}

      <Field label={t('Follows')}
        hint={t('A following kwarg has no control of its own; its value is derived from the one it follows. This is how you pair something like preserve_thinking to a thinking toggle.')}>
        <Select value={def.parentId || ''} label={t('Follows')}
          onChange={(v) => patch({ parentId: v, rules: v ? rules : [] })}
          options={[{ value: '', label: t('nothing, it stands alone') },
            ...defs.filter(d => d.id !== def.id && !blocked.has(d.id)).map(d => ({ value: d.id, label: nameOf(d) }))]} />
      </Field>

      {linked ? (
        parentValues.length === 0
          ? <Note>{t('The kwarg it follows has no values yet.')}</Note>
          : (
            <Table head={[
              { label: t('When {name} is', { name: nameOf(parent) }), mono: true, fit: true },
              { label: t('Send') },
              { label: t('Included'), fit: true }
            ]}>
              {parentValues.map(pv => {
                const rule = rules.find(r => r.when === pv) || { when: pv, value: '', send: false };
                const on = rule.send !== false && rule.value !== '';
                return (
                  <tr key={pv}>
                    <td className="mono">{pv}</td>
                    <td>
                      <Input mono value={rule.value || ''} placeholder={t('value to send')} aria-label={t('Send')}
                        onChange={(e) => setRule(pv, { value: e.target.value, send: true })} />
                    </td>
                    <td className="fit">
                      <Switch on={on} label={on ? t('Sent') : t('Omitted')}
                        onToggle={() => setRule(pv, on ? { send: false } : { send: true, value: rule.value || (values[values.length - 1] || 'true') })} />
                    </td>
                  </tr>
                );
              })}
            </Table>
          )
      ) : (
        <>
          <Fields cols={3}>
            <Field label={t('Title')}>
              <Input value={def.label || ''} placeholder={t('Extended thinking')} aria-label={t('Title')} onChange={(e) => patch({ label: e.target.value })} />
            </Field>
            <Field label={t('Picker chip')} hint={range ? t('Shown beside the model name. {value} becomes the current number, as in Thinking · {value} tokens.') : undefined}>
              <Input value={def.chip || ''} placeholder={range ? t('Thinking · {value} tokens') : t('Thinking')} aria-label={t('Picker chip')} onChange={(e) => patch({ chip: e.target.value })} />
            </Field>
            <Field label={t('Description')} hint={t('Leave the title and this blank to fall back to the key.')}>
              <Input value={def.description || ''} placeholder={t('Let the model think before answering')} aria-label={t('Description')}
                onChange={(e) => patch({ description: e.target.value })} />
            </Field>
          </Fields>
          <Rows>
            <Row label={t('Show in the picker')} note={t('Off, members never see it and it keeps its default.')}>
              <Switch on={def.visible !== false} label={t('Show in the picker')} onToggle={() => patch({ visible: def.visible === false })} />
            </Row>
            {def.visible !== false && (
              <Row label={t('Control')} note={range ? t('A range always renders as a number slider.') : undefined} wide>
                <Select value={range ? 'range' : (def.control || 'auto')} disabled={range} label={t('Control')}
                  onChange={(v) => patch({ control: v })}
                  options={KWARG_CONTROLS.map(([v, l]) => ({ value: v, label: t(l) }))} />
              </Row>
            )}
            {def.visible !== false && (
              <Row label={t('Who can change it')} wide>
                <Select value={def.adminOnly ? 'admins' : 'everyone'} label={t('Who can change it')}
                  onChange={(v) => patch({ adminOnly: v === 'admins' })}
                  options={[{ value: 'everyone', label: t('everyone') }, { value: 'admins', label: t('admins only') }]} />
              </Row>
            )}
            {def.visible !== false && (
              <Row label={t('Only show when')}
                note={t('Keeps its own control but hides it until the chosen kwarg holds the value beside it, so a thinking budget can appear only once thinking is on.')} wide>
                <div className="mc-pair">
                  <Select value={def.showIf?.id || ''} label={t('Only show when')}
                    onChange={(id) => {
                      if (!id) return patch({ showIf: null });
                      const opts = gateValues(defs.find(d => d.id === id));
                      return patch({ showIf: { id, value: opts.includes(def.showIf?.value) ? def.showIf.value : (opts[opts.length - 1] || '') } });
                    }}
                    options={[{ value: '', label: t('always shown') },
                      ...defs.filter(d => d.id !== def.id && !d.parentId && gateValues(d).length).map(d => ({ value: d.id, label: nameOf(d) }))]} />
                  {!!def.showIf?.id && (
                    <Select value={def.showIf.value ?? ''} label={t('is')}
                      onChange={(v) => patch({ showIf: { id: def.showIf.id, value: v } })}
                      options={gateValues(defs.find(d => d.id === def.showIf.id)).map(v => ({ value: v, label: v }))} />
                  )}
                </div>
              </Row>
            )}
            {(def.visible === false || def.showIf?.id) && (
              <Row label={t('Send while hidden')} note={t('Whether its value still goes out while members cannot see it.')}>
                <Switch on={def.sendWhenHidden !== false} label={t('Send while hidden')}
                  onToggle={() => patch({ sendWhenHidden: def.sendWhenHidden === false })} />
              </Row>
            )}
          </Rows>
        </>
      )}

      {(linked || def.visible === false || !!replayWhen) && (
        <Rows>
          <Row label={t('Send back past thinking')}
            note={t('For a kwarg like preserve_thinking that tells the model to keep its earlier thinking. While it is sent with the value picked here, earlier replies go back to the model together with the thinking behind them, so it remembers what it thought. The second box is the field the server reads that thinking from.')} wide>
            <div className="mc-pair">
              <Select value={replayWhen} label={t('Send back past thinking')}
                onChange={(v) => patch({ replayWhen: v })}
                options={[{ value: '', label: t('never') }, { value: '*', label: t('whenever it is sent') },
                  ...replayValues.map(v => ({ value: v, label: t('when it is {value}', { value: v }) }))]} />
              {!!replayWhen && (
                <Select value={def.replayAs || 'reasoning_content'} label={t('Sent as')}
                  onChange={(v) => patch({ replayAs: v })}
                  options={REPLAY_FIELDS.map(([v, l]) => ({ value: v, label: l }))} />
              )}
            </div>
          </Row>
        </Rows>
      )}
    </div>
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
    const made = preset.make();
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

  const highest = {};
  for (const d of defs) {
    if (d.parentId) continue;
    if (isRange(d)) { highest[d.id] = String(d.max); continue; }
    const vals = kwargValuesArr(d);
    if (vals.length) highest[d.id] = vals[vals.length - 1];
  }

  const legacy = single && !!single.effort_enabled && !defs.length;

  return (
    <>
      <Card title={<CardMark label={t('Request controls')} k="kwargs" />} className={change.changed ? 'mc-changed' : undefined}
        sub={t('Extra fields merged into each request body, and the controls members get for them.')}
        actions={!mixed && (
          <Btn size="sm" aria-haspopup="menu" aria-expanded={!!menu}
            onClick={(e) => {
              if (menu) { setMenu(null); return; }
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ at: clampToViewport(r.right - MENU_W, r.bottom + 4, MENU_W, MENU_H), el: e.currentTarget });
            }}>
            <Plus /> {t('Add kwarg')}
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
            {defs.length === 0 ? (
              <Empty title={t('No request controls')}>
                {t('A kwarg is an extra value sent with every request, such as enable_thinking or reasoning_effort. Each one can also surface as a control in the model picker.')}
              </Empty>
            ) : (
              <ul className="mc-kws">
                {defs.map((def, i) => {
                  const shown = open === def.id;
                  return (
                    <li key={def.id} className={'mc-kw' + (shown ? ' open' : '')}>
                      <div className="mc-kw-head">
                        <button type="button" className="mc-kw-toggle" aria-expanded={shown}
                          onClick={() => setOpen(shown ? null : def.id)}>
                          <Chevron />
                          <span className="mono">{def.name || t('unnamed')}</span>
                        </button>
                        <Summary def={def} defs={defs} />
                        <span className="cp-acts mc-kw-acts">
                          <IconBtn kind="quiet" label={t('Move up')} disabled={i === 0} onClick={() => shift(i, -1)}><Up /></IconBtn>
                          <IconBtn kind="quiet" label={t('Move down')} disabled={i === defs.length - 1} onClick={() => shift(i, 1)}><Down /></IconBtn>
                          <IconBtn kind="quiet" label={t('Duplicate')} onClick={() => duplicate(def)}><Copy /></IconBtn>
                          <IconBtn kind="danger" label={t('Delete')} onClick={() => remove(def)}><Trash /></IconBtn>
                        </span>
                      </div>
                      {shown && <DefEditor def={def} defs={defs} patch={(p) => patch(def.id, p)} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Card>

      {!mixed && defs.length > 0 && (
        <Card title={t('Request preview')} sub={t('The body a request carries, so a nesting target can be checked before members see it.')}>
          <Fields cols={2}>
            <Payload defs={defs} requested={{}} label={t('Request at the defaults')} />
            <Payload defs={defs} requested={highest} label={t('Request with every control at its highest')} />
          </Fields>
        </Card>
      )}

      {menu && (
        <PointMenu at={menu.at} width={MENU_W} anchorEl={menu.el} onClose={() => setMenu(null)}>
          {KWARG_PRESETS.map(p => (
            <MenuItem key={p.key} onClick={() => add(p)}>
              <span>{t(p.label)}</span>
            </MenuItem>
          ))}
        </PointMenu>
      )}
    </>
  );
}