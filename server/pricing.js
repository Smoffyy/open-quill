const PRESETS = [
  { match: 'gpt-4o-mini', label: 'GPT-4o mini', in: 0.15, out: 0.6 },
  { match: 'gpt-4o', label: 'GPT-4o', in: 2.5, out: 10 },
  { match: 'gpt-4.1-mini', label: 'GPT-4.1 mini', in: 0.4, out: 1.6 },
  { match: 'gpt-4.1-nano', label: 'GPT-4.1 nano', in: 0.1, out: 0.4 },
  { match: 'gpt-4.1', label: 'GPT-4.1', in: 2, out: 8 },
  { match: 'gpt-4-turbo', label: 'GPT-4 Turbo', in: 10, out: 30 },
  { match: 'gpt-4', label: 'GPT-4', in: 30, out: 60 },
  { match: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', in: 0.5, out: 1.5 },
  { match: 'o4-mini', label: 'o4-mini', in: 1.1, out: 4.4 },
  { match: 'o3-mini', label: 'o3-mini', in: 1.1, out: 4.4 },
  { match: 'o3', label: 'o3', in: 2, out: 8 },
  { match: 'o1-mini', label: 'o1-mini', in: 1.1, out: 4.4 },
  { match: 'o1', label: 'o1', in: 15, out: 60 },
  { match: 'claude-opus-4', label: 'Claude Opus 4', in: 15, out: 75 },
  { match: 'claude-sonnet-4', label: 'Claude Sonnet 4', in: 3, out: 15 },
  { match: 'claude-haiku-4', label: 'Claude Haiku 4', in: 1, out: 5 },
  { match: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', in: 3, out: 15 },
  { match: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', in: 3, out: 15 },
  { match: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku', in: 0.8, out: 4 },
  { match: 'claude-3-opus', label: 'Claude 3 Opus', in: 15, out: 75 },
  { match: 'claude-3-sonnet', label: 'Claude 3 Sonnet', in: 3, out: 15 },
  { match: 'claude-3-haiku', label: 'Claude 3 Haiku', in: 0.25, out: 1.25 },
  { match: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', in: 1.25, out: 10 },
  { match: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', in: 0.3, out: 2.5 },
  { match: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', in: 0.1, out: 0.4 },
  { match: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', in: 1.25, out: 5 },
  { match: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', in: 0.075, out: 0.3 },
  { match: 'deepseek-reasoner', label: 'DeepSeek Reasoner', in: 0.55, out: 2.19 },
  { match: 'deepseek-chat', label: 'DeepSeek Chat', in: 0.27, out: 1.1 },
  { match: 'deepseek-r1', label: 'DeepSeek R1', in: 0.55, out: 2.19 },
  { match: 'deepseek-v3', label: 'DeepSeek V3', in: 0.27, out: 1.1 },
  { match: 'mistral-large', label: 'Mistral Large', in: 2, out: 6 },
  { match: 'mistral-small', label: 'Mistral Small', in: 0.2, out: 0.6 },
  { match: 'mistral-nemo', label: 'Mistral Nemo', in: 0.15, out: 0.15 },
  { match: 'codestral', label: 'Codestral', in: 0.3, out: 0.9 },
  { match: 'kimi-k2', label: 'Kimi K2', in: 0.6, out: 2.5 },
  { match: 'moonshot-v1-128k', label: 'Moonshot v1 128k', in: 2, out: 5 },
  { match: 'moonshot-v1-32k', label: 'Moonshot v1 32k', in: 1, out: 3 },
  { match: 'moonshot-v1-8k', label: 'Moonshot v1 8k', in: 0.2, out: 2 },
  { match: 'grok-4', label: 'Grok 4', in: 3, out: 15 },
  { match: 'grok-3-mini', label: 'Grok 3 mini', in: 0.3, out: 0.5 },
  { match: 'grok-3', label: 'Grok 3', in: 3, out: 15 },
  { match: 'llama-3.3-70b', label: 'Llama 3.3 70B', in: 0.59, out: 0.79 },
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
