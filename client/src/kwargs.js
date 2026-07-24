export const KWARG_TARGETS = [
  ['chat_template_kwargs', 'chat_template_kwargs'],
  ['body', 'Top level of the request'],
  ['extra_body', 'extra_body']
];
export const KWARG_CONTROLS = [
  ['auto', 'Automatic'],
  ['toggle', 'On/off toggle'],
  ['slider', 'Slider'],
  ['select', 'Dropdown']
];
export const KWARG_TYPES = [
  ['auto', 'Automatic'],
  ['boolean', 'Boolean'],
  ['number', 'Number'],
  ['string', 'String']
];

const RESERVED_BODY_KEYS = new Set(['model', 'messages', 'stream', 'stream_options', 'tools', 'tool_choice', 'chat_template_kwargs', 'extra_body']);

export const isBoolPair = (values) =>
  Array.isArray(values) && values.length === 2 &&
  values.some(v => /^true$/i.test(String(v))) && values.some(v => /^false$/i.test(String(v)));

export const kwargValuesArr = (def) =>
  (Array.isArray(def?.values) ? def.values : String(def?.values ?? '').split(','))
    .map(v => String(v).trim()).filter(Boolean);

export const kwargValuesStr = (def) => kwargValuesArr(def).join(', ');

export function controlOf(def) {
  const values = kwargValuesArr(def);
  if (def?.control && def.control !== 'auto') return def.control;
  if (isBoolPair(values)) return 'toggle';
  if (values.length > 5) return 'select';
  return values.length > 1 ? 'slider' : 'select';
}

export function defaultValueOf(def) {
  const values = kwargValuesArr(def);
  if (values.includes(def?.default)) return def.default;
  if (isBoolPair(values)) return values.find(v => /^false$/i.test(v));
  return values[Math.floor(values.length / 2)] ?? values[0] ?? '';
}

export function trueValueOf(def) {
  const values = kwargValuesArr(def);
  return values.find(v => /^true$/i.test(v)) ?? values[values.length - 1] ?? '';
}

export function falseValueOf(def) {
  const values = kwargValuesArr(def);
  return values.find(v => /^false$/i.test(v)) ?? values[0] ?? '';
}

export function resolveKwargValues(defs, requested, isAdmin = false) {
  const list = Array.isArray(defs) ? defs : [];
  const req = requested && typeof requested === 'object' ? requested : {};
  const out = {};
  for (const d of list) {
    if (d.parentId) continue;
    const values = kwargValuesArr(d);
    let v = defaultValueOf(d);
    if (d.visible !== false && (isAdmin || !d.adminOnly)) {
      const asked = req[d.id];
      if (asked != null && values.includes(String(asked))) v = String(asked);
    }
    out[d.id] = v === '' ? null : v;
  }
  const kids = list.filter(d => d.parentId);
  for (let pass = 0; pass <= kids.length; pass++) {
    let progressed = false;
    for (const d of kids) {
      if (d.id in out) continue;
      if (!(d.parentId in out)) continue;
      const pv = out[d.parentId];
      const rules = Array.isArray(d.rules) ? d.rules : [];
      const rule = pv == null ? null : (rules.find(r => r.when === String(pv)) || rules.find(r => r.when === '*'));
      out[d.id] = (rule && rule.send !== false && rule.value !== '') ? rule.value : null;
      progressed = true;
    }
    if (!progressed) break;
  }
  for (const d of kids) if (!(d.id in out)) out[d.id] = null;
  return out;
}

export function coerceKwargValue(value, type) {
  const s = String(value);
  if (type === 'string') return s;
  if (type === 'boolean') return /^(true|1|yes|on)$/i.test(s);
  if (type === 'number') { const n = Number(s); return Number.isFinite(n) ? n : s; }
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  if (s.trim() !== '' && Number.isFinite(Number(s))) return Number(s);
  return s;
}

export function kwargPayload(defs, values) {
  const out = {};
  for (const d of (Array.isArray(defs) ? defs : [])) {
    const v = values ? values[d.id] : null;
    if (v == null || v === '' || !d.name) continue;
    if (!d.parentId && d.visible === false && d.sendWhenHidden === false) continue;
    const val = coerceKwargValue(v, d.type);
    const target = d.target || 'chat_template_kwargs';
    if (target === 'body') {
      if (RESERVED_BODY_KEYS.has(d.name)) continue;
      out[d.name] = val;
    } else {
      if (!out[target] || typeof out[target] !== 'object') out[target] = {};
      out[target][d.name] = val;
    }
  }
  return out;
}

export function newKwargId() {
  return 'kw' + Math.random().toString(36).slice(2, 8);
}

export function blankKwarg() {
  return {
    id: newKwargId(), name: '', label: '', description: '', chip: '',
    values: ['false', 'true'], default: 'false', control: 'auto',
    target: 'chat_template_kwargs', type: 'auto',
    visible: true, adminOnly: false, sendWhenHidden: true, parentId: '', rules: []
  };
}

export const KWARG_PRESETS = [
  {
    key: 'blank', label: 'Blank kwarg',
    note: 'An empty kwarg you fill in yourself.',
    make: () => blankKwarg()
  },
  {
    key: 'enable_thinking', label: 'enable_thinking (Qwen)',
    note: 'On/off thinking toggle with false and true.',
    make: () => ({
      ...blankKwarg(), name: 'enable_thinking', label: 'Extended thinking',
      description: 'Let the model think before answering', chip: 'Thinking',
      values: ['false', 'true'], default: 'false'
    })
  },
  {
    key: 'reasoning_effort', label: 'reasoning_effort (gpt-oss)',
    note: 'A slider through low, medium, and high.',
    make: () => ({
      ...blankKwarg(), name: 'reasoning_effort', label: 'Reasoning effort',
      description: '', chip: '', values: ['low', 'medium', 'high'], default: 'medium'
    })
  },
  {
    key: 'preserve_thinking', label: 'preserve_thinking (paired)',
    note: 'Hidden kwarg meant to follow a thinking toggle.',
    make: () => ({
      ...blankKwarg(), name: 'preserve_thinking', label: 'Preserve thinking',
      description: '', values: ['false', 'true'], default: 'false', visible: false
    })
  }
];

export function kwargChip(def, value) {
  if (value == null || value === '') return '';
  const control = controlOf(def);
  if (control === 'toggle') return /^true$/i.test(String(value)) ? (def.chip || def.label || 'On') : '';
  if (def.chip) return def.chip;
  const s = String(value);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
