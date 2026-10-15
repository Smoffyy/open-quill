export const REPLAY_FIELDS = ['reasoning_content', 'reasoning', 'thinking'];
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

function isSent(defs, values, d) {
  const v = values ? values[d.id] : null;
  if (v == null || v === '' || !d.name) return false;
  return !!d.parentId || kwargVisible(defs, values, d) || d.sendWhenHidden !== false;
}

export function replayFieldFor(defs, values) {
  const def = (Array.isArray(defs) ? defs : []).find(d => {
    const when = replayWhenOf(d);
    return when && isSent(defs, values, d) && (when === '*' || String(values[d.id]) === when);
  });
  return def ? (def.replayAs || REPLAY_FIELDS[0]) : '';
}

export function pickerChips(defs, values) {
  const list = Array.isArray(defs) ? defs : [];
  const gates = gateSourceIds(list, values);
  return list.filter(d => !d.parentId && kwargVisible(list, values, d) && !gates.has(d.id))
    .map(d => kwargChip(d, values[d.id]))
    .filter(Boolean)
    .slice(0, 2);
}

export const kwargPath = (def) => {
  const target = def?.target || 'chat_template_kwargs';
  const name = def?.name || '';
  return target === 'body' ? name : target + '.' + name;
};

export function kwargMode(def) {
  if (def?.parentId) return 'follow';
  return def?.visible === false ? 'fixed' : 'choose';
}

export function kwargKind(def) {
  if (def?.min != null && def?.max != null) return 'range';
  if (isSteps(def)) return 'steps';
  return isBoolPair(kwargValuesArr(def)) ? 'toggle' : 'list';
}

const EXAMPLE_OPTIONS = ['low', 'medium', 'high'];

export function kindPatch(def, kind) {
  const clear = { min: null, max: null, step: null, unit: '', zeroOff: false, stops: [], control: 'auto' };
  if (kind === 'toggle') return { ...clear, values: ['false', 'true'], default: 'false' };
  if (kind === 'steps') return { ...clear, ...stepFields(DEFAULT_STEPS), default: '' };
  if (kind === 'range') {
    const nums = kwargValuesArr(def).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const min = nums.length ? nums[0] : 0;
    const max = nums.length > 1 ? nums[nums.length - 1] : min + 100;
    const gap = nums.length > 1 ? nums[1] - nums[0] : 0;
    return { ...clear, min, max, step: gap > 0 ? gap : 1, values: [], default: '' };
  }
  const kept = kwargKind(def) === 'steps' ? kwargValuesArr(def) : EXAMPLE_OPTIONS;
  return { ...clear, values: kept, default: kept.includes(def?.default) ? def.default : '' };
}

export function fixedValuePatch(value) {
  return { min: null, max: null, step: null, stops: [], values: value.trim() ? [value] : [], default: value };
}

export function descendantIds(defs, id) {
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

export function followable(defs, def) {
  const below = descendantIds(defs, def.id);
  return defs.filter(d => d.id !== def.id && !below.has(d.id));
}

export const parentChoices = (parent) => (!parent ? [] : isRange(parent) ? ['*'] : kwargValuesArr(parent));

function offChoice(parent, value) {
  const stop = stopOf(parent, value);
  return stop ? isOffStep(stop) : /^(false|off|none|0)$/i.test(value);
}

export function followPatch(def, parent) {
  const choices = parentChoices(parent);
  const rules = Array.isArray(def.rules) ? def.rules : [];
  if (rules.some(r => choices.includes(r.when))) return { parentId: parent.id, rules };
  const bool = isBoolPair(kwargValuesArr(def));
  const seeded = choices.filter(v => v !== '*').map(v => ({
    when: v,
    value: bool ? (offChoice(parent, v) ? falseValueOf(def) : trueValueOf(def)) : v,
    send: true
  }));
  return { parentId: parent.id, rules: seeded };
}

export function modePatch(defs, def, mode) {
  if (mode === 'choose') return { visible: true, parentId: '' };
  if (mode === 'fixed') return { visible: false, parentId: '', sendWhenHidden: true };
  const pool = followable(defs, def);
  const parent = pool.find(d => !d.parentId && kwargKind(d) === 'toggle') || pool[0];
  return parent ? followPatch(def, parent) : {};
}

export function highestValue(def) {
  if (isRange(def)) return String(def.max);
  const values = kwargValuesArr(def);
  return values[values.length - 1] ?? '';
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
    key: 'enable_thinking', title: 'Thinking switch', name: 'enable_thinking',
    note: 'An on/off switch for models such as Qwen 3.',
    make: () => ({
      ...blankKwarg(), name: 'enable_thinking', label: 'Extended thinking',
      description: 'Let the model think before answering', chip: 'Thinking',
      values: ['false', 'true'], default: 'false'
    })
  },
  {
    key: 'reasoning_effort', title: 'Reasoning effort', name: 'reasoning_effort',
    note: 'Low, medium and high, for models such as gpt-oss.',
    make: () => ({
      ...blankKwarg(), name: 'reasoning_effort', label: 'Reasoning effort',
      description: '', chip: '', values: ['low', 'medium', 'high'], default: 'medium'
    })
  },
  {
    key: 'reasoning_budget_tokens', title: 'Thinking budget slider', name: 'reasoning_budget_tokens',
    note: 'A token slider that caps thinking, as llama.cpp reads it.',
    make: () => ({
      ...blankKwarg(), name: 'reasoning_budget_tokens', label: 'Thinking budget', chip: 'Thinking · {value} tokens',
      description: 'How many tokens the model may spend thinking',
      values: [], default: '4096', min: 1024, max: 16384, step: 1024,
      unit: 'tokens', zeroOff: true, target: 'body', type: 'number'
    })
  },
  {
    key: 'reasoning_levels', title: 'Thinking budget levels', name: 'reasoning_budget_tokens',
    note: 'Off, Low, Medium and High, each sending a token count.',
    make: () => ({
      ...blankKwarg(), name: 'reasoning_budget_tokens', label: 'Thinking', chip: '{value}',
      description: 'How much the model may think before it answers',
      ...stepFields(DEFAULT_STEPS), default: '2048', target: 'body', type: 'number'
    })
  },
  {
    key: 'preserve_thinking', title: 'Keep earlier thinking', name: 'preserve_thinking',
    note: 'Hidden. Follows the thinking switch and sends past thinking back.',
    make: (defs = []) => {
      const base = {
        ...blankKwarg(), name: 'preserve_thinking', label: 'Preserve thinking',
        values: ['false', 'true'], default: 'true', visible: false, replayWhen: 'true'
      };
      const toggle = defs.find(d => !d.parentId && kwargKind(d) === 'toggle');
      return toggle ? { ...base, ...followPatch(base, toggle) } : base;
    }
  },
  {
    key: 'clear_thinking', title: 'Keep earlier thinking (GLM)', name: 'clear_thinking',
    note: 'Hidden. Sends false so past thinking is kept.',
    make: () => ({
      ...blankKwarg(), name: 'clear_thinking', label: 'Clear thinking',
      values: ['false', 'true'], default: 'false', visible: false, replayWhen: 'false'
    })
  },
  {
    key: 'blank', title: 'Custom field', name: '',
    note: 'Start empty and set everything yourself.',
    make: () => blankKwarg()
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