export const KWARG_TARGETS = [
  ['chat_template_kwargs', 'chat_template_kwargs (nested)'],
  ['body', 'Top level of the request'],
  ['extra_body', 'extra_body (nested)']
];
export const KWARG_CONTROLS = [
  ['auto', 'Automatic'],
  ['toggle', 'On/off toggle'],
  ['slider', 'Steps'],
  ['range', 'Number slider'],
  ['select', 'Dropdown']
];
export const KWARG_TYPES = [
  ['auto', 'Automatic'],
  ['boolean', 'Boolean'],
  ['number', 'Number'],
  ['string', 'String']
];

export const REPLAY_FIELDS = [
  ['reasoning_content', 'reasoning_content (llama.cpp, vLLM, LM Studio)'],
  ['reasoning', 'reasoning'],
  ['thinking', 'thinking']
];
const REPLAY_DEFAULTS = { __proto__: null, preserve_thinking: 'true', clear_thinking: 'false' };

export function replayWhenOf(def) {
  if (def?.replayWhen === undefined) return REPLAY_DEFAULTS[String(def?.name || '').trim()] || '';
  return String(def.replayWhen || '');
}

export function replayValuesOf(def) {
  if (!def || isRange(def)) return [];
  if (def.parentId) return [...new Set((Array.isArray(def.rules) ? def.rules : []).filter(r => r.send !== false && r.value).map(r => String(r.value)))];
  return kwargValuesArr(def);
}

const RESERVED_BODY_KEYS = new Set(['model', 'messages', 'stream', 'stream_options', 'tools', 'tool_choice', 'chat_template_kwargs', 'extra_body']);

export const isBoolPair = (values) =>
  Array.isArray(values) && values.length === 2 &&
  values.some(v => /^true$/i.test(String(v))) && values.some(v => /^false$/i.test(String(v)));

export const kwargValuesArr = (def) =>
  (Array.isArray(def?.values) ? def.values : String(def?.values ?? '').split(','))
    .map(v => String(v).trim()).filter(Boolean);

export const kwargValuesStr = (def) => kwargValuesArr(def).join(', ');

export const isRange = (def) =>
  !!def && def.min != null && def.max != null && def.min !== '' && def.max !== '' &&
  Number.isFinite(Number(def.min)) && Number.isFinite(Number(def.max)) && Number(def.max) > Number(def.min);

export const isSteps = (def) => !!def?.stops?.length;

export const DEFAULT_STEPS = [
  { label: 'Off', value: '0', off: true },
  { label: 'Low', value: '1024', off: false },
  { label: 'Medium', value: '2048', off: false },
  { label: 'High', value: '4096', off: false }
];

export const stepFields = (stops) => ({ stops, values: stops.map(s => String(s.value ?? '')).filter(Boolean) });

export const isOffStep = (stop) => stop.off ?? Number(stop.value) === 0;

function stopOf(def, value) {
  return (def?.stops || []).find(s => String(s.value) === String(value));
}

export function stopLabel(def, value) {
  const stop = stopOf(def, value);
  return stop ? (stop.label || String(stop.value)) : String(value ?? '');
}

export const rangeStep = (def) => (Number(def?.step) > 0 ? Number(def.step) : 1);

export function stepDecimals(step) {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : Math.min(6, s.length - dot - 1);
}

export function clampToRange(def, value) {
  const min = Number(def.min), max = Number(def.max);
  const step = rangeStep(def);
  let n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= min) return min;
  if (n >= max) return max;
  n = min + Math.round((n - min) / step) * step;
  n = Math.min(max, Math.max(min, n));
  const d = stepDecimals(step);
  return d ? Number(n.toFixed(d)) : Math.round(n);
}

const MAX_RANGE_STEPS = 400;

export function rangeSteps(def) {
  const min = Number(def.min), max = Number(def.max), step = rangeStep(def);
  const count = Math.floor((max - min) / step);
  const stride = Math.max(1, Math.ceil(count / MAX_RANGE_STEPS));
  const out = [];
  for (let i = 0; i <= count; i += stride) out.push(String(clampToRange(def, min + i * step)));
  out.push(String(max));
  return [...new Set(out)];
}

export function nearestStep(steps, value) {
  const n = Number(value);
  let best = 0;
  steps.forEach((s, i) => { if (Math.abs(Number(s) - n) < Math.abs(Number(steps[best]) - n)) best = i; });
  return best;
}

// "300" reads as a number; "low" does not. Used by the editor to decide whether a
// range slider is even offered for what the admin has typed.
export const allNumeric = (values) =>
  values.length > 0 && values.every(v => v !== '' && Number.isFinite(Number(v)));

export function controlOf(def) {
  if (isRange(def)) return 'range';
  if (isSteps(def)) return 'slider';
  const values = kwargValuesArr(def);
  if (def?.control && def.control !== 'auto') return def.control;
  if (isBoolPair(values)) return 'toggle';
  if (values.length > 5) return 'select';
  return values.length > 1 ? 'slider' : 'select';
}

export function defaultValueOf(def) {
  if (isRange(def)) {
    const d = clampToRange(def, def.default);
    return String(d == null ? clampToRange(def, def.min) : d);
  }
  const values = kwargValuesArr(def);
  if (values.includes(def?.default)) return def.default;
  if (isBoolPair(values)) return values.find(v => /^false$/i.test(v));
  return values[Math.floor(values.length / 2)] ?? values[0] ?? '';
}

export function kwargAccepts(def, value) {
  if (value == null) return false;
  if (isRange(def)) return String(clampToRange(def, value)) === String(value);
  return kwargValuesArr(def).includes(value);
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
    const range = isRange(d);
    let v = defaultValueOf(d);
    if (d.visible !== false && (isAdmin || !d.adminOnly)) {
      const asked = req[d.id];
      if (asked != null) {
        if (range) { const c = clampToRange(d, asked); if (c != null) v = String(c); }
        else if (values.includes(String(asked))) v = String(asked);
      }
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

// A gate hides the control without taking its value away: unlike parentId, which
// makes a kwarg fully derived, a gated kwarg keeps its own control and simply does
// not appear while the gate is shut. Whether it is still sent is `sendWhenHidden`,
// exactly as for an admin-hidden one.
export function gateOpen(defs, values, def) {
  if (!def || !def.showIf || !def.showIf.id) return true;
  const src = (Array.isArray(defs) ? defs : []).find(d => d.id === def.showIf.id);
  if (!src) return true;
  const v = values ? values[def.showIf.id] : null;
  if (v == null) return false;
  return String(v) === String(def.showIf.value);
}

export function kwargVisible(defs, values, def) {
  return def.visible !== false && gateOpen(defs, values, def);
}

export function gateSourceIds(defs, values) {
  const list = Array.isArray(defs) ? defs : [];
  const out = new Set();
  for (const d of list) {
    if (!d.showIf || !d.showIf.id) continue;
    if (!kwargVisible(list, values, d)) continue;
    out.add(d.showIf.id);
  }
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

function placeKwarg(out, target, name, val) {
  if (target === 'body') {
    if (!RESERVED_BODY_KEYS.has(name)) out[name] = val;
    return;
  }
  if (!out[target] || typeof out[target] !== 'object') out[target] = {};
  out[target][name] = val;
}

export function kwargPayload(defs, values) {
  const out = {};
  for (const d of (Array.isArray(defs) ? defs : [])) {
    const v = values ? values[d.id] : null;
    if (v == null || v === '' || !d.name) continue;
    if (!d.parentId && !kwargVisible(defs, values, d) && d.sendWhenHidden === false) continue;
    placeKwarg(out, d.target || 'chat_template_kwargs', d.name, coerceKwargValue(v, d.type));
    const message = d.budgetMessage;
    if (isBudgetKwarg(d) && message?.enabled && message.name && message.text && Number(v) > 0) {
      placeKwarg(out, message.target, message.name, coerceKwargValue(message.text, message.type));
    }
  }
  return out;
}

export function newKwargId() {
  return 'kw' + Math.random().toString(36).slice(2, 8);
}

export const BUDGET_KWARG = 'reasoning_budget_tokens';
export const BUDGET_MESSAGE_TEXT = 'Thinking budget reached. Stop thinking and write the answer now.';

export const isBudgetKwarg = (def) => def?.name === BUDGET_KWARG;

export function budgetMessageOff() {
  return { enabled: false, name: 'reasoning_budget_message', target: 'body', type: 'string', text: '' };
}

export function blankKwarg() {
  return {
    id: newKwargId(), name: '', label: '', description: '', chip: '',
    values: ['false', 'true'], default: 'false', control: 'auto',
    target: 'chat_template_kwargs', type: 'auto',
    visible: true, adminOnly: false, sendWhenHidden: true, parentId: '', showIf: null,
    min: null, max: null, step: null, unit: '', zeroOff: false, stops: [], rules: [],
    replayWhen: '', replayAs: 'reasoning_content', budgetMessage: budgetMessageOff()
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
    key: 'reasoning_budget_tokens', label: 'reasoning_budget_tokens (number slider)',
    note: 'Caps how many tokens the model may spend thinking. Sent at the top level of the request, where llama.cpp reads it.',
    make: () => ({
      ...blankKwarg(), name: 'reasoning_budget_tokens', label: 'Thinking budget', chip: 'Thinking · {value} tokens',
      description: 'How many tokens the model may spend thinking',
      values: [], default: '4096', min: 1024, max: 16384, step: 1024,
      unit: 'tokens', zeroOff: true, target: 'body', type: 'number'
    })
  },
  {
    key: 'reasoning_levels', label: 'reasoning_budget_tokens (named levels)',
    note: 'The thinking budget as words, such as Off, Low, Medium and High. Each word sends its number at the top level of the request.',
    make: () => ({
      ...blankKwarg(), name: 'reasoning_budget_tokens', label: 'Thinking', chip: '{value}',
      description: 'How much the model may think before it answers',
      ...stepFields(DEFAULT_STEPS), default: '2048', target: 'body', type: 'number'
    })
  },
  {
    key: 'preserve_thinking', label: 'preserve_thinking (paired)',
    note: 'Hidden kwarg meant to follow a thinking toggle. Sends past thinking back when true.',
    make: () => ({
      ...blankKwarg(), name: 'preserve_thinking', label: 'Preserve thinking',
      description: '', values: ['false', 'true'], default: 'false', visible: false, replayWhen: 'true'
    })
  },
  {
    key: 'clear_thinking', label: 'clear_thinking (GLM)',
    note: 'Hidden kwarg that keeps past thinking when false.',
    make: () => ({
      ...blankKwarg(), name: 'clear_thinking', label: 'Clear thinking',
      description: '', values: ['false', 'true'], default: 'false', visible: false, replayWhen: 'false'
    })
  }
];

export function chipNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (Math.abs(n) >= 1024 && n % 512 === 0) return n / 1024 + 'K';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function rangeLabel(def, value, offText) {
  const n = Number(value);
  if (def.zeroOff && n === 0) return offText;
  const shown = Number.isFinite(n) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(n) : String(value);
  return def.unit ? shown + ' ' + def.unit : shown;
}

export function kwargChip(def, value) {
  if (value == null || value === '') return '';
  const control = controlOf(def);
  if (control === 'toggle') return /^true$/i.test(String(value)) ? (def.chip || def.label || 'On') : '';
  if (isSteps(def)) {
    const stop = stopOf(def, value);
    if (stop && isOffStep(stop)) return '';
    const name = stopLabel(def, value);
    return def.chip ? def.chip.split('{value}').join(name) : name;
  }
  if (control === 'range') {
    if (def.zeroOff && Number(value) === 0) return '';
    const short = chipNumber(value);
    if (def.chip) return def.chip.split('{value}').join(short);
    return def.unit ? short + ' ' + def.unit : short;
  }
  const s = String(value);
  const shown = s.charAt(0).toUpperCase() + s.slice(1);
  return def.chip ? def.chip.split('{value}').join(shown) : shown;
}