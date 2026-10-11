import { createHash } from 'node:crypto';
import { resolveProvider, providerSpec } from './providers.js';
import { normalizeMessages, requestKwargs } from '../llm/wire.js';
import { replayFieldOf } from './kwargs.js';

const tokenCache = new Map();
const TOKEN_CACHE_MAX = 400;

const asInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

function endpointFor(model) {
  const prov = resolveProvider(model && model.provider_id);
  if (!prov || prov.type !== 'vllm') return null;
  const { base, key } = providerSpec(prov);
  return {
    root: String(base).replace(/\/+$/, '').replace(/\/v\d+$/, ''),
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    name: String(model.internal_name || '')
  };
}

async function jsonFetch(url, opts, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

export function isVllm(model) {
  const prov = resolveProvider(model && model.provider_id);
  return !!prov && prov.type === 'vllm';
}

export async function vllmPromptTokens(model, messages, tools) {
  const ep = endpointFor(model);
  if (!ep) return 0;
  const prefill = !!(messages.length && messages[messages.length - 1].prefill);
  const kwargs = requestKwargs(model).chat_template_kwargs;
  const body = {
    model: ep.name, messages: normalizeMessages('openai', messages, replayFieldOf(model)),
    add_generation_prompt: !prefill, ...(prefill ? { continue_final_message: true } : {}),
    ...(Array.isArray(tools) && tools.length ? { tools } : {}),
    ...(kwargs ? { chat_template_kwargs: kwargs } : {})
  };
  const raw = JSON.stringify(body);
  const sig = createHash('sha1').update(ep.root + '|' + raw).digest('hex');
  const cached = tokenCache.get(sig);
  if (cached) {
    tokenCache.delete(sig);
    tokenCache.set(sig, cached);
    return cached;
  }
  const r = await jsonFetch(ep.root + '/tokenize', { method: 'POST', headers: ep.headers, body: raw });
  const n = asInt(r?.count) || (Array.isArray(r?.tokens) ? r.tokens.length : 0);
  if (!n) return 0;
  tokenCache.set(sig, n);
  if (tokenCache.size > TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value);
  return n;
}

export async function vllmTextTokens(model, text) {
  const ep = endpointFor(model);
  if (!ep) return 0;
  const r = await jsonFetch(ep.root + '/tokenize', { method: 'POST', headers: ep.headers, body: JSON.stringify({ model: ep.name, prompt: String(text || ''), add_special_tokens: false }) });
  return asInt(r?.count) || (Array.isArray(r?.tokens) ? r.tokens.length : 0);
}