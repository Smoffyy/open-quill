export function samplingParams(model, spec) {
  const allowed = spec?.samplers || [];
  const remap = spec?.remap || {};
  const fl = (v) => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
  const it = (v) => (v === '' || v == null || isNaN(parseInt(v))) ? null : parseInt(v);
  const map = { temperature: fl, top_p: fl, presence_penalty: fl, frequency_penalty: fl, repetition_penalty: fl, min_p: fl, top_k: it, seed: it, max_tokens: it };
  const out = {};
  for (const k of allowed) {
    const conv = map[k]; if (!conv) continue;
    const v = conv(model[k]); if (v == null) continue;
    out[remap[k] || k] = v;
  }
  return out;
}

export function ollamaOptions(model, spec) {
  const params = samplingParams(model, spec);
  const ctx = parseInt(model.num_ctx); if (Number.isFinite(ctx) && ctx > 0) params.num_ctx = ctx;
  return params;
}

