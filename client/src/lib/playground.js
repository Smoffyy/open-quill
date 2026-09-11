// Pure helpers for the admin playground. The component keeps the wiring; the
// arithmetic an admin reads off the screen while judging a model release lives
// here so it can be tested without a DOM.

export const SAMPLER_KEYS = [
  'temperature', 'top_p', 'top_k', 'min_p',
  'repetition_penalty', 'presence_penalty', 'frequency_penalty'
];

export const SAMPLING_PRESETS = [
  { id: 'precise', label: 'Precise', hint: 'Near-deterministic, for regression checks', values: { temperature: 0.1, top_p: 0.9 } },
  { id: 'balanced', label: 'Balanced', hint: 'What most chats run with', values: { temperature: 0.7, top_p: 1 } },
  { id: 'creative', label: 'Creative', hint: 'Loosest sampling the model is likely to ship with', values: { temperature: 1.1, top_p: 0.95 } }
];

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;

// A preset is "on" when every value it names matches and no other sampler is set,
// so switching between two presets never leaves a stray field behind unnoticed.
export function activePreset(values, presets = SAMPLING_PRESETS) {
  for (const p of presets) {
    const keys = Object.keys(p.values);
    if (!keys.every(k => values?.[k] !== '' && values?.[k] != null && near(values[k], p.values[k]))) continue;
    if (SAMPLER_KEYS.some(k => !keys.includes(k) && values?.[k] !== '' && values?.[k] != null)) continue;
    return p.id;
  }
  return null;
}

export function applyPreset(values, preset) {
  const out = { ...values };
  for (const k of SAMPLER_KEYS) out[k] = '';
  for (const [k, v] of Object.entries(preset?.values || {})) out[k] = v;
  return out;
}

export function clearSamplers(values) {
  const out = { ...values };
  for (const k of SAMPLER_KEYS) out[k] = '';
  return out;
}

// Time to first token is measured separately from throughput: a model that
// thinks for six seconds and then writes fast is a different problem from one
// that answers instantly and trickles, and a single "tok/s" hides both.
export function runStats({ startedAt = 0, firstAt = 0, endedAt = 0, usage = null } = {}) {
  const end = endedAt || firstAt || startedAt;
  const total = Math.max(0, end - startedAt);
  const ttft = firstAt ? Math.max(0, firstAt - startedAt) : null;
  const genMs = firstAt ? Math.max(0, end - firstAt) : 0;
  const out = Number.isFinite(usage?.completion) ? usage.completion : null;
  const prompt = Number.isFinite(usage?.prompt) ? usage.prompt : null;
  const tps = out != null && genMs > 0 ? out / (genMs / 1000) : null;
  return { total, ttft, genMs, out, prompt, tps };
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(2) + 's';
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return m + 'm ' + String(s).padStart(2, '0') + 's';
}

export function fmtCount(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

export function fmtRate(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return (n >= 100 ? Math.round(n) : n.toFixed(1)) + ' tok/s';
}

// The tiles under a reply, in the order an admin scans them: how long before
// anything appeared, how much came out, how fast, how long in total.
export function statTiles(stats) {
  if (!stats) return [];
  return [
    { id: 'ttft', label: 'First token', value: stats.ttft == null ? '—' : fmtDuration(stats.ttft) },
    { id: 'out', label: 'Output', value: stats.out == null ? '—' : fmtCount(stats.out) },
    { id: 'tps', label: 'Throughput', value: fmtRate(stats.tps) },
    { id: 'prompt', label: 'Prompt', value: stats.prompt == null ? '—' : fmtCount(stats.prompt) },
    { id: 'total', label: 'Total', value: fmtDuration(stats.total) }
  ];
}

// An assistant turn may hold several replies while two models are being compared.
// Everything downstream reads the picked one, so the rest of the app never has to
// know compare mode exists.
export function pickedText(msg) {
  if (!msg) return '';
  if (Array.isArray(msg.variants) && msg.variants.length) {
    const at = Math.min(Math.max(0, msg.pick || 0), msg.variants.length - 1);
    return msg.variants[at]?.content || '';
  }
  return msg.content || '';
}

export function historyFor(messages) {
  return (messages || []).map(m => ({ role: m.role, content: pickedText(m) }));
}

export function transcriptJson(messages, meta = {}) {
  return JSON.stringify({
    ...meta,
    messages: (messages || []).map(m => {
      const row = { role: m.role, content: pickedText(m) };
      if (m.reasoning) row.reasoning = m.reasoning;
      if (Array.isArray(m.variants) && m.variants.length > 1) {
        row.variants = m.variants.map(v => ({ model: v.name || v.modelId, content: v.content }));
      }
      return row;
    })
  }, null, 2);
}

// Blank means "leave it out of the request", which is the whole point of the
// column: a field the admin has not touched must not silently ship a default.
export function isUnset(v) {
  return v === '' || v == null;
}

export function clampField(raw, field) {
  if (isUnset(raw)) return '';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  if (Number.isFinite(field?.min) && n < field.min) return field.min;
  if (Number.isFinite(field?.max) && n > field.max) return field.max;
  return n;
}

export function seedFrom(rand = Math.random) {
  return Math.floor(rand() * 2 ** 31);
}

// Models are grouped by provider in the picker so a release candidate sitting
// next to its predecessor on the same backend is obvious.
export function groupModels(models, providers) {
  const name = new Map((providers || []).map(p => [p.id, p.name || p.id]));
  const groups = [];
  const seen = new Map();
  for (const m of models || []) {
    const key = m.provider_id || '';
    const label = name.get(key) || 'Other';
    if (!seen.has(label)) { seen.set(label, { label, items: [] }); groups.push(seen.get(label)); }
    seen.get(label).items.push(m);
  }
  return groups;
}

export function capsOf(model) {
  if (!model) return [];
  const out = [];
  if (model.kind === 'router') out.push('Router');
  if (model.has_reasoning) out.push('Reasoning');
  if (model.has_vision) out.push('Vision');
  if (model.unavailable) out.push('Unavailable');
  return out;
}
