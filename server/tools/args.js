export function parseArgs(argsText) {
  if (argsText == null || argsText === '') return {};
  if (typeof argsText === 'object') return Array.isArray(argsText) ? {} : argsText;
  let text = String(argsText).trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {}
  try {
    const v = JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {}
  const partial = extractPartial(text);
  const out = {};
  for (const k of Object.keys(partial)) if (partial[k].closed) out[k] = partial[k].value;
  return out;
}

export function toCall(name, argsText) {
  return { tool: String(name || '').trim(), ...parseArgs(argsText) };
}

