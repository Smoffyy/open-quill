const PRESETS = [
  { match: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', in: 5, out: 30 },
  { match: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', in: 2.5, out: 15 },
  { match: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', in: 1, out: 6 },
  { match: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', in: 30, out: 180 },
  { match: 'gpt-5.5', label: 'GPT-5.5', in: 5, out: 30 },
  { match: 'gpt-5.4-pro', label: 'GPT-5.4 Pro', in: 30, out: 180 },
  { match: 'gpt-5.4', label: 'GPT-5.4', in: 2.5, out: 15 },
  { match: 'gpt-5.4-mini', label: 'GPT-5.4 mini', in: 0.75, out: 4.5 },
  { match: 'gpt-5.4-nano', label: 'GPT-5.4 nano', in: 0.2, out: 1.25 },
  { match: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', in: 1.75, out: 14 },
  { match: 'gpt-5', label: 'GPT-5', in: 1.25, out: 10 },
  { match: 'gpt-4.1-nano', label: 'GPT-4.1 nano', in: 0.1, out: 0.4 },
  { match: 'gpt-4.1-mini', label: 'GPT-4.1 mini', in: 0.4, out: 1.6 },
  { match: 'gpt-4.1', label: 'GPT-4.1', in: 2, out: 8 },
  { match: 'gpt-4o-mini', label: 'GPT-4o mini', in: 0.15, out: 0.6 },
  { match: 'gpt-4o', label: 'GPT-4o', in: 2.5, out: 10 },
  { match: 'o4-mini', label: 'o4-mini', in: 1.1, out: 4.4 },
  { match: 'o3', label: 'o3', in: 2, out: 8 },
  { match: 'o3-mini', label: 'o3-mini', in: 1.1, out: 4.4 },

  { match: 'claude-fable-5', label: 'Claude Fable 5', in: 10, out: 50 },
  { match: 'claude-opus-5', label: 'Claude Opus 5', in: 5, out: 25 },
  { match: 'claude-opus-4-8', label: 'Claude Opus 4.8', in: 5, out: 25 },
  { match: 'claude-sonnet-5', label: 'Claude Sonnet 5', in: 2, out: 10 },
  { match: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', in: 1, out: 5 },
  { match: 'claude-opus-4', label: 'Claude Opus 4', in: 15, out: 75 },
  { match: 'claude-sonnet-4', label: 'Claude Sonnet 4', in: 3, out: 15 },
  { match: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', in: 3, out: 15 },
  { match: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku', in: 0.8, out: 4 },

  { match: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', in: 0.75, out: 3.75 },
  { match: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', in: 0.75, out: 3.75 },
  { match: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', in: 1.5, out: 9 },
  { match: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', in: 0.25, out: 1.5 },
  { match: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', in: 1.25, out: 10 },
  { match: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', in: 0.3, out: 2.5 },
  { match: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', in: 0.1, out: 0.4 },

  { match: 'grok-4.6', label: 'Grok 4.6', in: 2, out: 6 },
  { match: 'grok-build-0.1', label: 'Grok Build 0.1', in: 1, out: 2 },
  { match: 'grok-4.5', label: 'Grok 4.5', in: 2, out: 6 },
  { match: 'grok-4.3', label: 'Grok 4.3', in: 1.25, out: 2.5 },
  { match: 'grok-4.20-multi-agent', label: 'Grok 4.20 Multi-Agent', in: 1.25, out: 2.5 },
  { match: 'grok-4.20-reasoning', label: 'Grok 4.20 Reasoning', in: 1.25, out: 2.5 },
  { match: 'grok-4.20-non-reasoning', label: 'Grok 4.20 Non-Reasoning', in: 1.25, out: 2.5 },
  { match: 'grok-4-fast', label: 'Grok 4 Fast', in: 0.2, out: 0.5 },
  { match: 'grok-4.1-fast', label: 'Grok 4.1 Fast', in: 0.2, out: 0.5 },
  { match: 'grok-code-fast-1', label: 'Grok Code Fast 1', in: 0.2, out: 1.5 },
  { match: 'grok-4', label: 'Grok 4', in: 3, out: 15 },

  { match: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', in: 0.435, out: 0.87 },
  { match: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', in: 0.14, out: 0.28 },

  { match: 'mistral-large-3', label: 'Mistral Large 3', in: 0.5, out: 1.5 },
  { match: 'mistral-medium-3.5', label: 'Mistral Medium 3.5', in: 1.5, out: 7.5 },
  { match: 'mistral-small-4', label: 'Mistral Small 4', in: 0.15, out: 0.6 },
  { match: 'ministral-3-14b', label: 'Ministral 3 14B', in: 0.2, out: 0.2 },
  { match: 'ministral-3-8b', label: 'Ministral 3 8B', in: 0.15, out: 0.15 },
  { match: 'ministral-3-3b', label: 'Ministral 3 3B', in: 0.1, out: 0.1 },
  { match: 'codestral', label: 'Codestral', in: 0.3, out: 0.9 },

  { match: 'llama-4-maverick', label: 'Llama 4 Maverick', in: 0.2, out: 0.6 },
  { match: 'llama-4-scout', label: 'Llama 4 Scout', in: 0.1, out: 0.3 },
  { match: 'llama-3.3-70b', label: 'Llama 3.3 70B', in: 0.23, out: 0.4 },
  { match: 'llama-3.1-405b', label: 'Llama 3.1 405B', in: 3.5, out: 3.5 },
  { match: 'llama-3.1-70b', label: 'Llama 3.1 70B', in: 0.59, out: 0.79 },
  { match: 'llama-3.1-8b', label: 'Llama 3.1 8B', in: 0.05, out: 0.08 }
];

function normalize(name) {
  return String(name || '').toLowerCase().replace(/^.*\//, '').replace(/[:@].*$/, '').replace(/[_\s]+/g, '-');
}

let customPresets = [];
export function setCustomPresets(list) {
  customPresets = Array.isArray(list) ? list.filter(p => p && p.match && typeof p.in === 'number' && typeof p.out === 'number').map(p => ({ match: normalize(p.match), label: String(p.label || p.match), in: p.in, out: p.out })) : [];
}
export function getCustomPresets() {
  return customPresets.map(p => ({ match: p.match, label: p.label, in: p.in, out: p.out }));
}

export function matchPreset(internalName) {
  const n = normalize(internalName);
  if (!n) return null;
  let best = null;
  for (const p of [...PRESETS, ...customPresets]) {
    if (n.includes(p.match) && (!best || p.match.length >= best.match.length)) best = p;
  }
  if (!best) return null;
  return { label: best.label, in: best.in, out: best.out };
}

export function presetList() {
  return [...PRESETS, ...customPresets].map(p => ({ label: p.label, match: p.match, in: p.in, out: p.out }));
}
