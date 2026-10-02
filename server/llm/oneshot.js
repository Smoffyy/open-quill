import { modelProvider, endpoint, authHeaders } from './provider.js';
import { ollamaOptions } from './sampling.js';
import { oneShotKwargPayload, stripNestedKwargs } from '../lib/kwargs.js';
import { oneShotAnthropic } from './anthropic.js';
import { memoFor, postWithRecovery } from './compat.js';

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

export async function oneShotFull(model, messages, { signal = null } = {}) {
  const { spec, base, key } = modelProvider(model);
  if (spec.protocol === 'anthropic') {
    try { return await oneShotAnthropic({ model, spec, base, key, messages, kwargs: oneShotKwargPayload(model), signal }); }
    catch { return { text: '', usage: null }; }
  }
  if (spec.protocol === 'ollama') {
    const res = await post(endpoint(base, '/api/chat'), {
      method: 'POST', headers: authHeaders(key),
      body: JSON.stringify({ model: model.internal_name, messages, stream: false, think: false, options: ollamaOptions(model, spec), ...stripNestedKwargs(oneShotKwargPayload(model)) })
    }, signal);
    if (!res.ok) return { text: '', usage: null };
    const json = await res.json();
    return { text: json.message?.content?.trim() || '', usage: usageOf(json.prompt_eval_count, json.eval_count) };
  }
  let res;
  try {
    res = await postWithRecovery({
      url: endpoint(base, '/chat/completions'), headers: authHeaders(key), mem: memoFor(base, model.internal_name),
      send: (url, init) => post(url, init, signal),
      body: { model: model.internal_name, stream: false, messages, ...oneShotKwargPayload(model) }
    });
  } catch { return { text: '', usage: null }; }
  const json = await res.json().catch(() => ({}));
  return { text: json.choices?.[0]?.message?.content?.trim() || '', usage: json.usage ? { ...usageOf(json.usage.prompt_tokens, json.usage.completion_tokens), cacheRead: json.usage.prompt_tokens_details?.cached_tokens || 0, cacheWrite: 0 } : null };
}

export async function oneShot(model, messages) {
  return (await oneShotFull(model, messages)).text;
}