export const KWARG_TARGETS = ['chat_template_kwargs', 'body', 'extra_body'];
export const KWARG_CONTROLS = ['auto', 'toggle', 'slider', 'range', 'select'];
export const KWARG_TYPES = ['auto', 'string', 'boolean', 'number'];

const MAX_KWARGS = 24;
const MAX_VALUES = 24;
const RESERVED_BODY_KEYS = new Set(['model', 'messages', 'stream', 'stream_options', 'tools', 'tool_choice', 'chat_template_kwargs', 'extra_body']);

const text = (v, max) => String(v == null ? '' : v).slice(0, max);
const slug = (v, max) => text(v, max).trim();

export const isBoolPair = (values) =>
  Array.isArray(values) && values.length === 2 &&
  values.some(v => /^true$/i.test(String(v))) && values.some(v => /^false$/i.test(String(v)));

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export const isRange = (def) =>
  !!def && def.min != null && def.max != null && Number(def.max) > Number(def.min);

export function stepDecimals(step) {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : Math.min(6, s.length - dot - 1);
}

// A range value is snapped to the admin's step and clamped to their bounds, so a
// hand-edited or stale request can never send a number outside what was allowed.
export function clampToRange(def, value) {
  const min = Number(def.min), max = Number(def.max);
  const step = Number(def.step) > 0 ? Number(def.step) : 1;
  let n = Number(value);
  if (!Number.isFinite(n)) return null;
  // Both ends stay reachable even when they are off the step grid. Snapping alone
  // would make a max of 2048 with a step of 100 land on 2000, so the number under
  // the slider could never equal the maximum printed at the end of its track.
  if (n <= min) return min;
  if (n >= max) return max;
  n = min + Math.round((n - min) / step) * step;
  n = Math.min(max, Math.max(min, n));
  const d = stepDecimals(step);
  return d ? Number(n.toFixed(d)) : Math.round(n);
}

function showIfOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = slug(raw.id, 40);
  if (!id) return null;
  return { id, value: slug(raw.value, 80) };
}

// A gate hides the control without taking its value away: unlike `parentId`, which
// makes a kwarg fully derived from its parent's rules, a gated kwarg keeps its own
// slider or toggle and simply does not appear while the gate is shut. What happens
// to the value then is the same question as for an admin-hidden kwarg, so it has
// the same answer: `sendWhenHidden`.
export function gateOpen(defs, values, def) {
  if (!def || !def.showIf || !def.showIf.id) return true;
  const src = (defs || []).find(d => d.id === def.showIf.id);
  if (!src) return true;
  const v = values ? values[def.showIf.id] : null;
  if (v == null) return false;
  return String(v) === String(def.showIf.value);
}

export function kwargVisible(defs, values, def) {
  return def.visible !== false && gateOpen(defs, values, def);
}

export function normalizeKwarg(raw, index = 0) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const values = (Array.isArray(src.values) ? src.values : String(src.values ?? '').split(','))
    .map(v => slug(v, 80)).filter(v => v !== '').slice(0, MAX_VALUES);
  const rules = (Array.isArray(src.rules) ? src.rules : []).slice(0, MAX_VALUES).map(r => ({
    when: slug(r && r.when, 80),
    value: text(r && r.value, 200),
    send: !(r && r.send === false)
  })).filter(r => r.when !== '');
  const def = {
    id: slug(src.id, 40) || ('kw' + index),
    name: slug(src.name, 80),
    label: text(src.label, 120),
    description: text(src.description, 300),
    chip: text(src.chip, 40),
    values,
    default: slug(src.default, 200),
    control: KWARG_CONTROLS.includes(src.control) ? src.control : 'auto',
    target: KWARG_TARGETS.includes(src.target) ? src.target : 'chat_template_kwargs',
    type: KWARG_TYPES.includes(src.type) ? src.type : 'auto',
    visible: src.visible !== false,
    adminOnly: !!src.adminOnly,
    sendWhenHidden: src.sendWhenHidden !== false,
    parentId: slug(src.parentId, 40),
    showIf: showIfOf(src.showIf),
    min: num(src.min),
    max: num(src.max),
    step: null,
    rules
  };
  if (isRange(def)) {
    const s = num(src.step);
    def.step = s != null && s > 0 ? s : 1;
    // A range is its own source of truth for what may be sent; keeping an
    // enumerated list alongside it would leave two answers to the same question.
    def.values = [];
    const d = clampToRange(def, def.default);
    def.default = d == null ? '' : String(d);
    return def;
  }
  def.min = null;
  def.max = null;
  if (def.values.length && !def.values.includes(def.default)) def.default = '';
  return def;
}

function cycles(byId, def) {
  const seen = new Set([def.id]);
  let cur = def;
  while (cur && cur.parentId) {
    if (seen.has(cur.parentId)) return true;
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return false;
}

export function sanitizeKwargs(list) {
  if (!Array.isArray(list)) return [];
  const used = new Set();
  const out = [];
  list.slice(0, MAX_KWARGS).forEach((raw, i) => {
    const def = normalizeKwarg(raw, i);
    let id = def.id;
    let n = 2;
    while (used.has(id)) id = def.id + '-' + n++;
    def.id = id;
    used.add(id);
    out.push(def);
  });
  const byId = new Map(out.map(d => [d.id, d]));
  for (const d of out) if (d.parentId && (d.parentId === d.id || !byId.has(d.parentId))) d.parentId = '';
  for (const d of out) if (d.parentId && cycles(byId, d)) d.parentId = '';
  for (const d of out) if (d.showIf && (d.showIf.id === d.id || !byId.has(d.showIf.id))) d.showIf = null;
  return out;
}

export function legacyEffortKwarg(model) {
  const levels = (Array.isArray(model.effort_levels) && model.effort_levels.length) ? model.effort_levels : ['low', 'medium', 'high'];
  const bool = isBoolPair(levels);
  return normalizeKwarg({
    id: 'effort',
    name: model.effort_kwarg || 'reasoning_effort',
    label: bool ? 'Extended thinking' : 'Reasoning effort',
    description: bool ? 'Let the model think before answering' : '',
    chip: bool ? 'Thinking' : '',
    values: levels,
    default: model.effort_default || '',
    control: 'auto',
    target: 'chat_template_kwargs',
    type: 'auto',
    visible: true,
    adminOnly: !!model.effort_admin_only
  }, 0);
}

export function kwargDefs(model) {
  if (!model) return [];
  const list = sanitizeKwargs(model.kwargs);
  if (list.length) return list;
  if (model.effort_enabled) return [legacyEffortKwarg(model)];
  return [];
}

export function controlOf(def) {
  if (isRange(def)) return 'range';
  if (def.control && def.control !== 'auto') return def.control;
  if (isBoolPair(def.values)) return 'toggle';
  if (def.values.length > 5) return 'select';
  return def.values.length > 1 ? 'slider' : 'select';
}

export function defaultValueOf(def) {
  if (isRange(def)) {
    const d = clampToRange(def, def.default);
    return String(d == null ? clampToRange(def, def.min) : d);
  }
  if (def.values.includes(def.default)) return def.default;
  if (isBoolPair(def.values)) return def.values.find(v => /^false$/i.test(String(v)));
  return def.values[Math.floor(def.values.length / 2)] ?? def.values[0] ?? '';
}

export function resolveKwargValues(defs, requested, isAdmin = false, useFirstValue = false) {
  const req = requested && typeof requested === 'object' ? requested : {};
  const out = {};
  for (const d of defs) {
    if (d.parentId) continue;
    const range = isRange(d);
    let v = useFirstValue ? (range ? String(clampToRange(d, d.min)) : (d.values[0] ?? defaultValueOf(d))) : defaultValueOf(d);
    if (!useFirstValue && d.visible && (isAdmin || !d.adminOnly)) {
      const asked = req[d.id];
      if (asked != null) {
        if (range) { const c = clampToRange(d, asked); if (c != null) v = String(c); }
        else if (d.values.includes(String(asked))) v = String(asked);
      }
    }
    out[d.id] = v === '' ? null : v;
  }
  const kids = defs.filter(d => d.parentId);
  for (let pass = 0; pass <= kids.length; pass++) {
    let progressed = false;
    for (const d of kids) {
      if (d.id in out) continue;
      if (!(d.parentId in out)) continue;
      const pv = out[d.parentId];
      const rule = pv == null ? null : (d.rules.find(r => r.when === String(pv)) || d.rules.find(r => r.when === '*'));
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
  for (const d of defs) {
    const v = values ? values[d.id] : null;
    if (v == null || v === '' || !d.name) continue;
    if (!d.parentId && !kwargVisible(defs, values, d) && !d.sendWhenHidden) continue;
    const val = coerceKwargValue(v, d.type);
    if (d.target === 'body') {
      if (RESERVED_BODY_KEYS.has(d.name)) continue;
      out[d.name] = val;
    } else {
      if (!out[d.target] || typeof out[d.target] !== 'object') out[d.target] = {};
      out[d.target][d.name] = val;
    }
  }
  return out;
}

export function primaryKwarg(defs) {
  return defs.find(d => !d.parentId && d.visible) || defs.find(d => !d.parentId) || defs[0] || null;
}

export function applyKwargs(model, requested, isAdmin = false) {
  if (!model) return model;
  const defs = kwargDefs(model);
  if (!defs.length) return { ...model, resolved_kwargs: {}, kwarg_values: {} };
  const values = resolveKwargValues(defs, requested, isAdmin);
  const primary = primaryKwarg(defs);
  return {
    ...model,
    resolved_kwargs: kwargPayload(defs, values),
    kwarg_values: values,
    reasoning_effort_level: primary ? (values[primary.id] ?? null) : null,
    reasoning_effort_kwarg: primary ? primary.name : ''
  };
}

export function defaultKwargPayload(model) {
  const defs = kwargDefs(model);
  if (!defs.length) return {};
  return kwargPayload(defs, resolveKwargValues(defs, {}, true));
}

export function oneShotKwargPayload(model) {
  const defs = kwargDefs(model);
  if (!defs.length) return {};
  return kwargPayload(defs, resolveKwargValues(defs, {}, true, true));
}

export function stripNestedKwargs(payload) {
  const out = {};
  for (const k of Object.keys(payload || {})) {
    if (k === 'chat_template_kwargs' || k === 'extra_body') continue;
    out[k] = payload[k];
  }
  return out;
}

export function publicKwargDefs(model) {
  return kwargDefs(model).map(d => ({
    id: d.id, name: d.name, label: d.label, description: d.description, chip: d.chip,
    values: d.values, default: d.default, control: d.control, type: d.type, target: d.target,
    visible: d.visible, adminOnly: d.adminOnly, sendWhenHidden: d.sendWhenHidden,
    parentId: d.parentId, showIf: d.showIf, min: d.min, max: d.max, step: d.step, rules: d.rules
  }));
}
