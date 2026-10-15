import { modelProvider, endpoint, authHeaders } from './provider.js';
import { ollamaOptions } from './sampling.js';
import { oneShotKwargPayload, stripNestedKwargs } from '../lib/kwargs.js';
import { oneShotAnthropic } from './anthropic.js';
import { memoFor, postWithRecovery } from './compat.js';
import { queueKey, inLine } from './slots.js';
import { normalizeMessages } from './wire.js';
import { prefillWire } from './stream.js';

const ONESHOT_TIMEOUT = 120000;

async function post(url, init, signal) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ONESHOT_TIMEOUT);
  const stop = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', stop, { once: true }); }
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', stop); }
}

const usageOf = (prompt, completion) => ({ prompt: prompt || 0, completion: completion || 0, total: (prompt || 0) + (completion || 0) });

export function oneShotFull(model, messages, { signal = null, maxTokens = 0 } = {}) {
  const { spec, base } = modelProvider(model);
  return inLine(queueKey(model, spec, base), signal, () => oneShotDirect(maxTokens > 0 ? { ...model, max_tokens: maxTokens } : model, messages, signal, maxTokens));
}

async function oneShotDirect(model, messages, signal, maxTokens) {
  const { spec, base, key } = modelProvider(model);
  if (spec.protocol === 'anthropic') {
    try { return await oneShotAnthropic({ model, spec, base, key, messages, kwargs: oneShotKwargPayload(model), signal }); }
    catch { return { text: '', usage: null }; }
  }
  if (spec.protocol === 'ollama') {
    const res = await post(endpoint(base, '/api/chat'), {
      method: 'POST', headers: authHeaders(key),
      body: JSON.stringify({ model: model.internal_name, messages: normalizeMessages(spec.protocol, messages), stream: false, think: false, options: { ...ollamaOptions(model, spec), ...(maxTokens > 0 ? { num_predict: maxTokens } : {}) }, ...stripNestedKwargs(oneShotKwargPayload(model)) })
    }, signal);
    if (!res.ok) return { text: '', usage: null };
    const json = await res.json();
    return { text: json.message?.content?.trim() || '', usage: usageOf(json.prompt_eval_count, json.eval_count) };
  }
  const wire = normalizeMessages(spec.protocol, messages);
  const fill = prefillWire(spec, messages, wire);
  let res;
  try {
    res = await postWithRecovery({
      url: endpoint(base, '/chat/completions'), headers: authHeaders(key), mem: memoFor(base, model.internal_name),
      send: (url, init) => post(url, init, signal),
      body: { model: model.internal_name, stream: false, messages: wire, ...fill, ...oneShotKwargPayload(model), ...(maxTokens > 0 ? { max_tokens: maxTokens } : {}) }
    });
  } catch { return { text: '', usage: null }; }
  const json = await res.json().catch(() => ({}));
  return { text: json.choices?.[0]?.message?.content?.trim() || '', usage: json.usage ? { ...usageOf(json.usage.prompt_tokens, json.usage.completion_tokens), cacheRead: json.usage.prompt_tokens_details?.cached_tokens || 0, cacheWrite: 0 } : null };
}

export async function oneShot(model, messages) {
  return (await oneShotFull(model, messages)).text;
}