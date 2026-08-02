import React, { useState } from 'react';
import { Plus, Copy, Trash, Chevron, Up, Down } from '../icons.jsx';
import { SegPick } from './widgets.jsx';
import { t, tk } from '../../i18n.jsx';
import {
  KWARG_TARGETS, KWARG_CONTROLS, KWARG_TYPES, KWARG_PRESETS,
  blankKwarg, newKwargId, controlOf, defaultValueOf, isBoolPair,
  kwargValuesArr, kwargValuesStr, resolveKwargValues, kwargPayload
} from '../../kwargs.js';

const CONTROL_NOTE = {
  toggle: tk('Users get an on/off switch.'),
  slider: tk('Users get a segmented slider through every value.'),
  select: tk('Users get a dropdown of every value.')
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

function PayloadPreview({ defs, label, requested }) {
  const payload = kwargPayload(defs, resolveKwargValues(defs, requested, true));
  const json = JSON.stringify(payload, null, 2);
  return (
    <div className="kwe-preview">
      <div className="kwe-preview-head">{label}</div>
      <pre>{json === '{}' ? t('Nothing is added to the request.') : json}</pre>
    </div>
  );
}

export default function KwargsEditor({ m, onChange }) {
  const defs = Array.isArray(m.kwargs) ? m.kwargs : [];
  const [valueText, setValueText] = useState({});
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [adding, setAdding] = useState(false);

  const setDefs = (list) => onChange({ ...m, kwargs: list });
  const patch = (id, p) => setDefs(defs.map(d => (d.id === id ? { ...d, ...p } : d)));

  function addPreset(preset) {
    setAdding(false);
    const made = preset.make();
    const used = new Set(defs.map(d => d.id));
    while (used.has(made.id)) made.id = newKwargId();
    setDefs([...defs, made]);
    setCollapsed(c => { const n = new Set(c); n.delete(made.id); return n; });
  }

  function remove(id) {
    setDefs(defs.filter(d => d.id !== id).map(d => (d.parentId === id ? { ...d, parentId: '', rules: [] } : d)));
  }

  function duplicate(id) {
    const src = defs.find(d => d.id === id);
    if (!src) return;
    const copy = { ...src, id: newKwargId(), name: src.name, rules: (src.rules || []).map(r => ({ ...r })) };
    const i = defs.findIndex(d => d.id === id);
    const list = defs.slice();
    list.splice(i + 1, 0, copy);
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

  function setValues(id, text) {
    setValueText(v => ({ ...v, [id]: text }));
    const arr = text.split(',').map(x => x.trim()).filter(Boolean);
    const def = defs.find(d => d.id === id);
    const nextDefault = arr.includes(def?.default) ? def.default : '';
    patch(id, { values: arr, default: nextDefault });
  }

  function setRule(def, when, p) {
    const rules = Array.isArray(def.rules) ? def.rules.slice() : [];
    const i = rules.findIndex(r => r.when === when);
    if (i < 0) rules.push({ when, value: '', send: true, ...p });
    else rules[i] = { ...rules[i], ...p };
    patch(def.id, { rules });
  }

  const highest = {};
  for (const d of defs) {
    if (d.parentId) continue;
    const values = kwargValuesArr(d);
    if (values.length) highest[d.id] = values[values.length - 1];
  }

  if (!defs.length) {
    return (
      <div className="kwe">
        {!!m.effort_enabled && (
          <div className="kwe-legacy">
            <div>
              <strong>{t('This model still uses the old thinking control.')}</strong>
              <div className="muted-note">{t('Convert it into a kwarg to unlock custom labels, extra values, and paired kwargs. Nothing changes for users, the same value is sent under the same name.')}</div>
            </div>
            <button type="button" className="btn primary" onClick={() => onChange({ ...m, kwargs: [legacyToKwarg(m)], effort_enabled: 0 })}>{t('Convert')}</button>
          </div>
        )}
        <div className="kwe-empty">
          <div className="kwe-empty-title">{t('No kwargs yet')}</div>
          <div className="muted-note">{t('Kwargs are extra values sent with every request, like enable_thinking or reasoning_effort. Add one and it becomes a control in the model picker, with whatever wording you choose.')}</div>
          <div className="kwe-presets">
            {KWARG_PRESETS.map(p => (
              <button key={p.key} type="button" className="kwe-preset" onClick={() => addPreset(p)}>
                <span className="kwe-preset-name">{t(p.label)}</span>
                <span className="kwe-preset-note">{t(p.note)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kwe">
      {defs.map((def, i) => {
        const values = kwargValuesArr(def);
        const linked = !!def.parentId;
        const parent = linked ? defs.find(d => d.id === def.parentId) : null;
        const parentValues = parent ? kwargValuesArr(parent) : [];
        const control = controlOf(def);
        const shut = collapsed.has(def.id);
        const blocked = descendants(defs, def.id);
        const rules = Array.isArray(def.rules) ? def.rules : [];
        return (
          <div className={'kwe-card' + (shut ? ' shut' : '')} key={def.id}>
            <div className="kwe-card-head">
              <button type="button" className="kwe-chev" title={shut ? t('Expand') : t('Collapse')}
                onClick={() => setCollapsed(c => { const n = new Set(c); if (n.has(def.id)) n.delete(def.id); else n.add(def.id); return n; })}>
                <Chevron />
              </button>
              <div className="kwe-card-id">
                <code>{def.name || t('unnamed')}</code>
                <span className="kwe-tags">
                  {linked && <em className="kwe-tag link">{t('follows')} {parent?.name || parent?.id || '?'}</em>}
                  {def.visible === false && <em className="kwe-tag">{t('hidden')}</em>}
                  {!linked && def.visible !== false && <em className="kwe-tag">{t(control === 'toggle' ? 'toggle' : control === 'slider' ? 'slider' : 'dropdown')}</em>}
                  {!!def.adminOnly && <em className="kwe-tag">{t('admins only')}</em>}
                  {def.target !== 'chat_template_kwargs' && <em className="kwe-tag">{def.target}</em>}
                </span>
              </div>
              <div className="kwe-acts">
                <button type="button" className="med-act" title={t('Move up')} disabled={i === 0} onClick={() => move(def.id, -1)}><Up style={{ width: 15 }} /></button>
                <button type="button" className="med-act" title={t('Move down')} disabled={i === defs.length - 1} onClick={() => move(def.id, 1)}><Down style={{ width: 15 }} /></button>
                <button type="button" className="med-act dup" title={t('Duplicate kwarg')} onClick={() => duplicate(def.id)}><Copy style={{ width: 15 }} /></button>
                <button type="button" className="med-act del" title={t('Delete kwarg')} onClick={() => remove(def.id)}><Trash style={{ width: 15 }} /></button>
              </div>
            </div>

            {!shut && (
              <div className="kwe-card-body">
                <div className="two-col">
                  <div className="field"><label>{t('API kwarg name')}</label>
                    <input value={def.name || ''} onChange={(e) => patch(def.id, { name: e.target.value })} placeholder="enable_thinking" />
                    <div className="muted-note">{t('The exact key the server expects. Leave blank and nothing is sent.')}</div>
                  </div>
                  <div className="field"><label>{t('Sent in')}</label>
                    <select value={def.target || 'chat_template_kwargs'} onChange={(e) => patch(def.id, { target: e.target.value })}>
                      {KWARG_TARGETS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                    </select>
                    <div className="muted-note">{t('Most chat templates read chat_template_kwargs. Use the top level for plain request fields.')}</div>
                  </div>
                </div>

                <div className="two-col">
                  <div className="field"><label>{t('Values')}</label>
                    <input value={valueText[def.id] ?? kwargValuesStr(def)} onChange={(e) => setValues(def.id, e.target.value)} placeholder="false, true" />
                    <div className="muted-note">{isBoolPair(values)
                      ? t('On/off values detected, this becomes a toggle.')
                      : t('Comma-separated, ordered lowest to highest.')}</div>
                  </div>
                  <div className="field"><label>{t('Value type')}</label>
                    <select value={def.type || 'auto'} onChange={(e) => patch(def.id, { type: e.target.value })}>
                      {KWARG_TYPES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                    </select>
                    <div className="muted-note">{t('Automatic sends true and false as booleans, numbers as numbers, everything else as text.')}</div>
                  </div>
                </div>

                {!linked && (
                  <div className="two-col">
                    <div className="field"><label>{t('Default')}</label>
                      <select value={values.includes(def.default) ? def.default : ''} onChange={(e) => patch(def.id, { default: e.target.value })}>
                        <option value="">{t('Automatic')}</option>
                        {values.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                      <div className="muted-note">{t('Automatic picks false for a toggle, or the middle value otherwise.')} {values.length ? t('Currently') + ': ' + defaultValueOf(def) : ''}</div>
                    </div>
                    <div className="field"><label>{t('Control')}</label>
                      <select value={def.control || 'auto'} onChange={(e) => patch(def.id, { control: e.target.value })}>
                        {KWARG_CONTROLS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                      </select>
                      <div className="muted-note">{t(CONTROL_NOTE[control] || '')}</div>
                    </div>
                  </div>
                )}

                <div className="kwe-sub">{t('What users see')}</div>
                <div className="two-col">
                  <div className="field"><label>{t('Title')}</label>
                    <input value={def.label || ''} onChange={(e) => patch(def.id, { label: e.target.value })} placeholder={t('Extended thinking')} />
                  </div>
                  <div className="field"><label>{t('Chip in the model picker')}</label>
                    <input value={def.chip || ''} onChange={(e) => patch(def.id, { chip: e.target.value })} placeholder={t('Thinking')} />
                  </div>
                </div>
                <div className="field"><label>{t('Description')}</label>
                  <input value={def.description || ''} onChange={(e) => patch(def.id, { description: e.target.value })} placeholder={t('Let the model think before answering')} />
                  <div className="muted-note">{t('Shown under the title in the picker. Leave both blank to fall back to the kwarg name.')}</div>
                </div>

                <div className="med-toggle-card">
                  <div className="field row">
                    <div><label>{t('Show in the model picker')}</label>
                      <div className="muted-note">{linked
                        ? t('When on, users see this kwarg as a read-only row with the value it inherits.')
                        : t('When off, users never see it and the default is sent silently.')}</div>
                    </div>
                    <div className={'switch' + (def.visible !== false ? ' on' : '')} onClick={() => patch(def.id, { visible: def.visible === false })} />
                  </div>
                  {!linked && def.visible === false && (
                    <div className="field row">
                      <div><label>{t('Send the default anyway')}</label>
                        <div className="muted-note">{t('Off means this kwarg is left out of the request entirely.')}</div>
                      </div>
                      <div className={'switch' + (def.sendWhenHidden !== false ? ' on' : '')} onClick={() => patch(def.id, { sendWhenHidden: def.sendWhenHidden === false })} />
                    </div>
                  )}
                  {!linked && def.visible !== false && (
                    <div className="field row">
                      <div><label>{t('Who can change it')}</label>
                        <div className="muted-note">{t('Admins only greys the control out for users and always sends the default.')}</div>
                      </div>
                      <SegPick value={def.adminOnly ? 'admins' : 'everyone'} options={[['admins', tk('Admins only')], ['everyone', tk('Everyone')]]}
                        onChange={(v) => patch(def.id, { adminOnly: v === 'admins' })} />
                    </div>
                  )}
                </div>

                <div className="kwe-sub">{t('Pairing')}</div>
                <div className="field"><label>{t('Follows another kwarg')}</label>
                  <select value={def.parentId || ''} onChange={(e) => patch(def.id, { parentId: e.target.value, rules: e.target.value ? (def.rules || []) : [] })}>
                    <option value="">{t('Nothing, it stands on its own')}</option>
                    {defs.filter(d => d.id !== def.id && !blocked.has(d.id)).map(d => (
                      <option key={d.id} value={d.id}>{d.name || d.label || d.id}</option>
                    ))}
                  </select>
                  <div className="muted-note">{t('A following kwarg has no control of its own. Its value comes from the kwarg it follows, which is how you pair something like preserve_thinking to a thinking toggle.')}</div>
                </div>

                {linked && (
                  <div className="kwe-rules">
                    {parentValues.length === 0 && <div className="muted-note">{t('The kwarg above has no values yet.')}</div>}
                    {parentValues.map(pv => {
                      const rule = rules.find(r => r.when === pv) || { when: pv, value: '', send: false };
                      const on = rule.send !== false && rule.value !== '';
                      return (
                        <div className="kwe-rule" key={pv}>
                          <span className="kwe-rule-when">
                            {t('When')} <code>{parent?.name || parent?.id}</code> {t('is')} <code>{pv}</code>
                          </span>
                          <div className="kwe-rule-right">
                            <input value={rule.value || ''} placeholder={t('value to send')}
                              onChange={(e) => setRule(def, pv, { value: e.target.value, send: true })} />
                            <div className={'switch' + (on ? ' on' : '')} title={on ? t('Sent') : t('Not sent')}
                              onClick={() => setRule(def, pv, on ? { send: false } : { send: true, value: rule.value || (values[values.length - 1] || 'true') })} />
                          </div>
                        </div>
                      );
                    })}
                    <div className="muted-note">{t('Turn a row off to leave the kwarg out of the request for that value.')}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="kwe-add">
        <button type="button" className="btn" onClick={() => setAdding(a => !a)}>
          <Plus style={{ width: 15, verticalAlign: '-2px' }} /> {t('Add kwarg')}
        </button>
        {adding && (
          <div className="kwe-presets">
            {KWARG_PRESETS.map(p => (
              <button key={p.key} type="button" className="kwe-preset" onClick={() => addPreset(p)}>
                <span className="kwe-preset-name">{t(p.label)}</span>
                <span className="kwe-preset-note">{t(p.note)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="kwe-sub">{t('Request preview')}</div>
      <div className="kwe-previews">
        <PayloadPreview defs={defs} requested={{}} label={t('At the default selection')} />
        <PayloadPreview defs={defs} requested={highest} label={t('With every control at its highest value')} />
      </div>
    </div>
  );
}
