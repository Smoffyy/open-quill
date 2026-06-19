import { getSetting } from './db.js';

export const PROVIDER_TYPES = {
  lmstudio: {
    label: 'LM Studio', defaultBaseUrl: 'http://localhost:1234/v1', protocol: 'openai', keyOptional: true,
    samplers: ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'],
    remap: { repetition_penalty: 'repeat_penalty' }
  },
  llamacpp: {
    label: 'llama.cpp server', defaultBaseUrl: 'http://localhost:8080/v1', protocol: 'openai', keyOptional: true,
    samplers: ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'],
    remap: { repetition_penalty: 'repeat_penalty' }
  },
  vllm: {
    label: 'vLLM', defaultBaseUrl: 'http://localhost:8000/v1', protocol: 'openai', keyOptional: true,
    samplers: ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'],
    remap: {}
  },
  ollama: {
    label: 'Ollama', defaultBaseUrl: 'http://localhost:11434', protocol: 'ollama', keyOptional: true,
    samplers: ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'seed', 'max_tokens'],
    remap: { repetition_penalty: 'repeat_penalty', max_tokens: 'num_predict' }
  },
  openai: {
    label: 'OpenAI API', defaultBaseUrl: 'https://api.openai.com/v1', protocol: 'openai', keyOptional: false,
    samplers: ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'],
    remap: {}
  },
  openrouter: {
    label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai', keyOptional: false,
    samplers: ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'],
    remap: {}
  },
  moonshot: {
    label: 'Moonshot AI (Kimi)', defaultBaseUrl: 'https://api.moonshot.ai/v1', protocol: 'openai', keyOptional: false,
    samplers: ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'max_tokens'],
    remap: {}
  },
  mistral: {
    label: 'Mistral', defaultBaseUrl: 'https://api.mistral.ai/v1', protocol: 'openai', keyOptional: false,
    samplers: ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'],
    remap: { seed: 'random_seed' }
  },
  meta: {
    label: 'Meta (Llama API)', defaultBaseUrl: 'https://api.llama.com/compat/v1', protocol: 'openai', keyOptional: false,
    samplers: ['temperature', 'top_p', 'repetition_penalty', 'frequency_penalty', 'presence_penalty', 'max_tokens'],
    remap: {}
  }
};

export function typesForClient() {
  const out = {};
  for (const [k, v] of Object.entries(PROVIDER_TYPES)) out[k] = { label: v.label, defaultBaseUrl: v.defaultBaseUrl, keyOptional: v.keyOptional, samplers: v.samplers };
  return out;
}

export function getProviders() {
  const list = getSetting('providers', null);
  if (Array.isArray(list) && list.length) return list;
  const base = getSetting('api_base_url') || 'http://localhost:1234/v1';
  const key = getSetting('api_key') || '';
  return [{ id: 'legacy', name: 'Default', type: 'lmstudio', base_url: base, api_key: key }];
}

export function resolveProvider(providerId) {
  const list = getProviders();
  return list.find(p => p.id === providerId) || list[0];
}

export function providerSpec(provider) {
  const spec = PROVIDER_TYPES[provider?.type] || PROVIDER_TYPES.lmstudio;
  const base = (provider?.base_url || spec.defaultBaseUrl).replace(/\/$/, '');
  return { spec, base, key: provider?.api_key || '' };
}
