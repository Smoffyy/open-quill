import { useState } from 'react';
import { Fields, Field, Input, Select, Seg, Switch, Btn, Badge, Empty, Note, Table } from './ui.jsx';
import { Plus, Copy, Trash, Chevron, Up, Down } from '../icons.jsx';
import { t, tk } from '../../i18n.jsx';
import {
  KWARG_TARGETS, KWARG_CONTROLS, KWARG_TYPES, KWARG_PRESETS,
  blankKwarg, newKwargId, controlOf, defaultValueOf, isBoolPair,
  kwargValuesArr, kwargValuesStr, resolveKwargValues, kwargPayload,
  isRange, rangeStep, clampToRange, allNumeric
} from '../../kwargs.js';

const CONTROL_NOTE = {
  __proto__: null,
  toggle: tk('Members get an on/off switch.'),
  slider: tk('Members get a segmented slider across every value.'),
  range: tk('Members get a slider they drag between the minimum and maximum.'),
  select: tk('Members get a dropdown of every value.')
};

const CONTROL_TAG = {
  __proto__: null,
  toggle: tk('toggle'), slider: tk('slider'), range: tk('range'), select: tk('dropdown')
};

const TARGET_NOTE = {
  __proto__: null,
  chat_template_kwargs: tk('Nested under chat_template_kwargs, which is where a chat template reads values it consumes itself, such as enable_thinking.'),
  body: tk('A plain field beside model and messages. Use this for anything the server reads directly, such as thinking_budget_tokens on llama.cpp.'),
  extra_body: tk('Nested under a literal extra_body object. Only gateways that unwrap it will see it: llama.cpp and vLLM ignore it, and the OpenAI SDKs flatten extra_body before sending, so match them with the top level instead.')
};

function legacyToKwarg(m) {
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

// Only a kwarg with discrete values can gate another: a range is a continuum, so
// "show when the budget is exactly 3072" is never what anyone means.
function gateValues(def) {
  if (!def || isRange(def)) return [];
  return kwargValuesArr(def);
}

function descendants(defs, id) {
  const out = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of defs) {
      if (!d.parentId) continue;
      if ((d.parentId === id || out.has(d.parentId)) && !out.has(d.id)) { out.add(d.id); grew = true; }
    }
  }
  return out;
}

// The whole body, not just the fragment: a nesting target looks completely
// different on the wire from one that does not, and that is the thing to check.
function Payload({ defs, label, requested }) {
  const payload = kwargPayload(defs, resolveKwargValues(defs, requested, true));
  const empty = !Object.keys(payload).length;
  const json = JSON.stringify({ model: 'm', messages: 'c', ...payload }, null, 2)
    .replace('"m"', '"…"')
    .replace('"c"', '[ … ]');
  return (
    <Field label={label}>
      <pre style={{
        margin: 0, padding: '10px 12px', borderRadius: 8, overflow: 'auto',
        border: '1px solid var(--border-soft)', background: 'var(--surface-2)',
        fontFamily: 'var(--cp-mono)', fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-muted)'
      }}>{empty ? t('nothing is added to the request') : json}</pre>
    </Field>
  );
}

function Presets({ onPick }) {
  return (
    <Table head={[{ label: t('Preset') }, { label: t('What it does') }, { label: '', fit: true }]}>
      {KWARG_PRESETS.map(p => (
        <tr key={p.key}>
          <td>{t(p.label)}</td>
          <td className="dim">{t(p.note)}</td>
          <td className="acts"><Btn size="sm" onClick={() => onPick(p)}><Plus /> {t('Add')}</Btn></td>
        </tr>
      ))}
    </Table>
  );
}

export default function KwargsEditor({ m, set, onChange }) {
  const defs = Array.isArray(m.kwargs) ? m.kwargs : [];
  const [open, setOpen] = useState(() => new Set());
  const [text, setText] = useState({});
  const [adding, setAdding] = useState(false);

  const setDefs = (list) => set('kwargs', list);
  const patch = (id, p) => setDefs(defs.map(d => (d.id === id ? { ...d, ...p } : d)));
  const toggleOpen = (id) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function addPreset(preset) {
    setAdding(false);
    const made = preset.make();
    const used = new Set(defs.map(d => d.id));
    while (used.has(made.id)) made.id = newKwargId();
    setDefs([...defs, made]);
    setOpen(s => new Set(s).add(made.id));
  }

  function convertLegacy() {
    onChange({ ...m, kwargs: [legacyToKwarg(m)], effort_enabled: 0 });
  }

  function remove(id) {
    setDefs(defs.filter(d => d.id !== id).map(d => (d.parentId === id ? { ...d, parentId: '', rules: [] } : d)));
  }

  function duplicate(id) {
    const src = defs.find(d => d.id === id);
    if (!src) return;
    const copy = { ...src, id: newKwargId(), rules: (src.rules || []).map(r => ({ ...r })) };
    const list = defs.slice();
    list.splice(defs.findIndex(d => d.id === id) + 1, 0, copy);
    setDefs(list);
  }

  function move(id, dir) {
    const i = defs.findIndex(d => d.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= defs.length) return;
    const list = defs.slice();
    const [row] = list.splice(i, 1);
    list.splice(j, 0, row);
    setDefs(list);
  }

  function setValues(id, raw) {
    setText(v => ({ ...v, [id]: raw }));
    const arr = raw.split(',').map(x => x.trim()).filter(Boolean);
    const def = defs.find(d => d.id === id);
    patch(id, { values: arr, default: arr.includes(def?.default) ? def.default : '' });
  }

  function setRule(def, when, p) {
    const rules = Array.isArray(def.rules) ? def.rules.slice() : [];
    const i = rules.findIndex(r => r.when === when);
    if (i < 0) rules.push({ when, value: '', send: true, ...p });
    else rules[i] = { ...rules[i], ...p };
    patch(def.id, { rules });
  }

  function toRange(def) {
    const nums = kwargValuesArr(def).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const min = nums.length ? nums[0] : 0;
    const max = nums.length > 1 ? nums[nums.length - 1] : min + 100;
    const gap = nums.length > 1 ? Math.abs(nums[1] - nums[0]) : 0;
    patch(def.id, { min, max, step: gap > 0 ? gap : 1, values: [], default: '' });
    setText(v => ({ ...v, [def.id]: '' }));
  }

  function toList(def) {
    patch(def.id, { min: null, max: null, step: null, values: [], default: '' });
    setText(v => ({ ...v, [def.id]: '' }));
  }

  const highest = {};
  for (const d of defs) {
    if (d.parentId) continue;
    if (isRange(d)) { highest[d.id] = String(d.max); continue; }
    const values = kwargValuesArr(d);
    if (values.length) highest[d.id] = values[values.length - 1];
  }

  if (!defs.length) {
    return (
      <>
        {!!m.effort_enabled && (
          <div style={{ marginBottom: 16 }}>
            <Note tone="warn">
              {t('This model still uses the old thinking control. Converting it to a kwarg unlocks custom labels, extra values, and paired kwargs. Nothing changes for members: the same value goes out under the same name.')}
              <div className="cp-acts" style={{ marginTop: 10 }}>
                <Btn size="sm" kind="primary"
                  onClick={convertLegacy}>{t('Convert')}</Btn>
              </div>
            </Note>
          </div>
        )}
        <Empty title={t('No request controls')}>
          {t('A kwarg is an extra value sent with every request, such as enable_thinking or reasoning_effort. Each one can also surface as a control in the model picker.')}
        </Empty>
        <div style={{ marginTop: 14 }}><Presets onPick={addPreset} /></div>
      </>
    );
  }

  return (
    <>
      <Table head={[
        { label: '', fit: true },
        { label: t('Key'), mono: true },
        { label: t('Sent in'), mono: true, fit: true },
        { label: t('Control'), fit: true },
        { label: t('Values'), mono: true },
        { label: '', fit: true }
      ]}>
        {defs.map((def, i) => {
          const values = kwargValuesArr(def);
          const linked = !!def.parentId;
          const parent = linked ? defs.find(d => d.id === def.parentId) : null;
          const parentValues = parent ? (isRange(parent) ? ['*'] : kwargValuesArr(parent)) : [];
          const control = controlOf(def);
          const range = isRange(def);
          const shut = !open.has(def.id);
          const blocked = descendants(defs, def.id);
          const rules = Array.isArray(def.rules) ? def.rules : [];

          return (
            <tr key={def.id} style={{ verticalAlign: 'top' }}>
              <td className="fit" style={{ paddingTop: 12 }}>
                <Btn size="sm" kind="quiet" aria-label={shut ? t('Expand') : t('Collapse')}
                  title={shut ? t('Expand') : t('Collapse')} onClick={() => toggleOpen(def.id)}>
                  <Chevron style={{ transform: shut ? 'none' : 'rotate(90deg)' }} />
                </Btn>
              </td>
              <td colSpan={4} style={{ paddingTop: 12 }}>
                {shut ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="mono">{def.name || t('unnamed')}</span>
                    <span className="cp-badges">
                      {linked && <Badge tone="warn">{t('follows {name}', { name: parent?.name || parent?.id || '?' })}</Badge>}
                      {def.visible === false && <Badge>{t('hidden')}</Badge>}
                      {!linked && def.visible !== false && def.showIf?.id && (
                        <Badge tone="warn">{t('only when {name} = {value}', {
                          name: defs.find(d => d.id === def.showIf.id)?.name || def.showIf.id,
                          value: def.showIf.value
                        })}</Badge>
                      )}
                      {!linked && def.visible !== false && <Badge>{t(CONTROL_TAG[control] || CONTROL_TAG.select)}</Badge>}
                      {!!def.adminOnly && <Badge>{t('admins only')}</Badge>}
                      {def.target !== 'chat_template_kwargs' && <Badge>{def.target}</Badge>}
                      <Badge>{range ? `${def.min}…${def.max}` : (kwargValuesStr(def) || t('no values'))}</Badge>
                    </span>
                  </div>
                ) : (
                  <div style={{ paddingBottom: 8 }}>
                    <Fields cols={2}>
                      <Field label={t('Key')} hint={t('The exact name the server expects. Blank sends nothing.')}>
                        <Input mono value={def.name || ''} placeholder="enable_thinking"
                          onChange={(e) => patch(def.id, { name: e.target.value })} />
                      </Field>
                      <Field label={t('Sent in')} hint={t(TARGET_NOTE[def.target || 'chat_template_kwargs'])}>
                        <Select value={def.target || 'chat_template_kwargs'} onChange={(v) => patch(def.id, { target: v })}
                          options={KWARG_TARGETS.map(([value, label]) => ({ value, label: t(label) }))} />
                      </Field>
                    </Fields>

                    <div style={{ marginTop: 14 }}>
                      <Fields cols={2}>
                        {range ? (
                          <Field label={t('Range')}
                            hint={<>{t('Minimum, maximum, and step. Members drag between them and cannot send anything outside.')}{' '}
                              <button type="button" className="btn quiet sm" onClick={() => toList(def)}>{t('use a fixed list instead')}</button></>}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <Input mono type="number" value={def.min ?? ''} placeholder={t('min')} aria-label={t('Minimum')}
                                onChange={(e) => patch(def.id, { min: e.target.value })} />
                              <Input mono type="number" value={def.max ?? ''} placeholder={t('max')} aria-label={t('Maximum')}
                                onChange={(e) => patch(def.id, { max: e.target.value })} />
                              <Input mono type="number" min="0" step="any" value={def.step ?? ''} placeholder={t('step')} aria-label={t('Step')}
                                onChange={(e) => patch(def.id, { step: e.target.value })} />
                            </div>
                          </Field>
                        ) : (
                          <Field label={t('Values')}
                            hint={<>
                              {isBoolPair(values) ? t('Boolean pair detected, so this renders as a toggle.') : t('Comma separated, ordered lowest to highest.')}
                              {allNumeric(values) && !isBoolPair(values) && <>{' '}
                                <button type="button" className="btn quiet sm" onClick={() => toRange(def)}>{t('these are numbers, use a range')}</button>
                              </>}
                            </>}>
                            <Input mono value={text[def.id] ?? kwargValuesStr(def)} placeholder="false, true"
                              onChange={(e) => setValues(def.id, e.target.value)} />
                          </Field>
                        )}
                        <Field label={t('Wire type')} hint={t('Automatic sends true and false as booleans, numerals as numbers, everything else as text.')}>
                          <Select value={def.type || 'auto'} onChange={(v) => patch(def.id, { type: v })}
                            options={KWARG_TYPES.map(([value, label]) => ({ value, label: t(label) }))} />
                        </Field>
                      </Fields>
                    </div>

                    {!linked && (
                      <div style={{ marginTop: 14 }}>
                        <Fields cols={2}>
                          <Field label={t('Default')}
                            hint={(range ? t('Where the slider starts. Automatic uses the minimum.') : t('Automatic picks false for a toggle, or the middle value otherwise.'))
                              + ((range || values.length) ? ' ' + t('Currently {v}.', { v: defaultValueOf(def) }) : '')}>
                            {range ? (
                              <Input mono type="number" min={def.min} max={def.max} step={rangeStep(def)}
                                value={def.default ?? ''} placeholder={t('automatic')}
                                onChange={(e) => patch(def.id, { default: e.target.value })}
                                onBlur={(e) => { const c = clampToRange(def, e.target.value); patch(def.id, { default: c == null ? '' : String(c) }); }} />
                            ) : (
                              <Select value={values.includes(def.default) ? def.default : ''} onChange={(v) => patch(def.id, { default: v })}
                                options={[{ value: '', label: t('automatic') }, ...values.map(v => ({ value: v, label: v }))]} />
                            )}
                          </Field>
                          <Field label={t('Control')} hint={t(CONTROL_NOTE[control] || '')}>
                            <Select value={range ? 'range' : (def.control || 'auto')} disabled={range}
                              onChange={(v) => patch(def.id, { control: v })}
                              options={KWARG_CONTROLS.map(([value, label]) => ({ value, label: t(label) }))} />
                          </Field>
                        </Fields>
                      </div>
                    )}

                    <div style={{ marginTop: 14 }}>
                      <Fields cols={3}>
                        <Field label={t('Title')}>
                          <Input value={def.label || ''} placeholder={t('Extended thinking')}
                            onChange={(e) => patch(def.id, { label: e.target.value })} />
                        </Field>
                        <Field label={t('Picker chip')}>
                          <Input value={def.chip || ''} placeholder={t('Thinking')}
                            onChange={(e) => patch(def.id, { chip: e.target.value })} />
                        </Field>
                        <Field label={t('Description')} hint={t('Leave the title and this blank to fall back to the key.')}>
                          <Input value={def.description || ''} placeholder={t('Let the model think before answering')}
                            onChange={(e) => patch(def.id, { description: e.target.value })} />
                        </Field>
                      </Fields>
                    </div>

                    <div style={{ marginTop: 14, display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
                        <Switch on={def.visible !== false} label={t('Show in the picker')}
                          onToggle={() => patch(def.id, { visible: def.visible === false })} />
                        {t('Show in the picker')}
                      </label>
                      {!linked && (def.visible === false || def.showIf?.id) && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
                          <Switch on={def.sendWhenHidden !== false} label={t('Send while hidden')}
                            onToggle={() => patch(def.id, { sendWhenHidden: def.sendWhenHidden === false })} />
                          {t('Send while hidden')}
                        </label>
                      )}
                      {!linked && def.visible !== false && (
                        <Seg value={def.adminOnly ? 'admins' : 'everyone'} label={t('Who can change it')}
                          onChange={(v) => patch(def.id, { adminOnly: v === 'admins' })}
                          options={[{ value: 'everyone', label: t('everyone') }, { value: 'admins', label: t('admins only') }]} />
                      )}
                    </div>

                    {!linked && def.visible !== false && (
                      <div style={{ marginTop: 14 }}>
                        <Fields cols={2}>
                          <Field label={t('Only show when')}
                            hint={t('Keeps its own control but hides it until the chosen kwarg holds the value beside it, so a thinking budget can appear only once thinking is on.')}>
                            <Select value={def.showIf?.id || ''}
                              onChange={(id) => {
                                if (!id) return patch(def.id, { showIf: null });
                                const opts = gateValues(defs.find(d => d.id === id));
                                return patch(def.id, { showIf: { id, value: opts.includes(def.showIf?.value) ? def.showIf.value : (opts[opts.length - 1] || '') } });
                              }}
                              options={[{ value: '', label: t('always shown') },
                                ...defs.filter(d => d.id !== def.id && !d.parentId && gateValues(d).length)
                                  .map(d => ({ value: d.id, label: d.name || d.label || d.id }))]} />
                          </Field>
                          <Field label={t('is')} hint={def.showIf?.id
                            ? t('While hidden this way, “Send while hidden” decides whether it still goes out.')
                            : t('Choose a kwarg on the left first.')}>
                            <Select value={def.showIf?.value ?? ''} disabled={!def.showIf?.id}
                              onChange={(v) => patch(def.id, { showIf: { id: def.showIf.id, value: v } })}
                              options={gateValues(defs.find(d => d.id === def.showIf?.id)).map(v => ({ value: v, label: v }))} />
                          </Field>
                        </Fields>
                      </div>
                    )}

                    <div style={{ marginTop: 14, maxWidth: 520 }}>
                      <Field label={t('Follows')}
                        hint={t('A following kwarg has no control of its own; its value is derived from the one it follows. This is how you pair something like preserve_thinking to a thinking toggle.')}>
                        <Select value={def.parentId || ''}
                          onChange={(v) => patch(def.id, { parentId: v, rules: v ? (def.rules || []) : [] })}
                          options={[{ value: '', label: t('nothing, it stands alone') },
                            ...defs.filter(d => d.id !== def.id && !blocked.has(d.id))
                              .map(d => ({ value: d.id, label: d.name || d.label || d.id }))]} />
                      </Field>
                    </div>

                    {linked && (
                      <div style={{ marginTop: 14 }}>
                        {parentValues.length === 0
                          ? <Note>{t('The kwarg it follows has no values yet.')}</Note>
                          : (
                            <Table head={[
                              { label: t('When {name} is', { name: parent?.name || parent?.id }), mono: true, fit: true },
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
                                      <Input mono value={rule.value || ''} placeholder={t('value to send')}
                                        onChange={(e) => setRule(def, pv, { value: e.target.value, send: true })} />
                                    </td>
                                    <td className="fit">
                                      <Switch on={on} label={on ? t('Sent') : t('Omitted')}
                                        onToggle={() => setRule(def, pv, on ? { send: false } : { send: true, value: rule.value || (values[values.length - 1] || 'true') })} />
                                    </td>
                                  </tr>
                                );
                              })}
                            </Table>
                          )}
                      </div>
                    )}
                  </div>
                )}
              </td>
              <td className="acts" style={{ paddingTop: 12 }}>
                <Btn size="sm" disabled={i === 0} title={t('Move up')} aria-label={t('Move up')} onClick={() => move(def.id, -1)}><Up /></Btn>{' '}
                <Btn size="sm" disabled={i === defs.length - 1} title={t('Move down')} aria-label={t('Move down')} onClick={() => move(def.id, 1)}><Down /></Btn>{' '}
                <Btn size="sm" title={t('Duplicate')} aria-label={t('Duplicate')} onClick={() => duplicate(def.id)}><Copy /></Btn>{' '}
                <Btn size="sm" kind="danger" title={t('Delete')} aria-label={t('Delete')} onClick={() => remove(def.id)}><Trash /></Btn>
              </td>
            </tr>
          );
        })}
      </Table>

      <div className="cp-acts" style={{ marginTop: 14 }}>
        <Btn size="sm" onClick={() => setAdding(a => !a)}><Plus /> {t('Add kwarg')}</Btn>
      </div>
      {adding && <div style={{ marginTop: 12 }}><Presets onPick={addPreset} /></div>}

      <div style={{ marginTop: 20 }}>
        <Fields cols={2}>
          <Payload defs={defs} requested={{}} label={t('Request at the defaults')} />
          <Payload defs={defs} requested={highest} label={t('Request with every control at its highest')} />
        </Fields>
      </div>
    </>
  );
}
