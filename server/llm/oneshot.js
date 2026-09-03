import { modelProvider, endpoint, authHeaders } from './provider.js';
import { ollamaOptions } from './sampling.js';
import { oneShotKwargPayload, stripNestedKwargs } from '../lib/kwargs.js';

const ONESHOT_TIMEOUT = 120000;

async function post(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ONESHOT_TIMEOUT);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  finally { clearTimeout(timer); }
}

export async function oneShot(model, messages) {
  const { spec, base, key } = modelProvider(model);
  if (spec.protocol === 'ollama') {
    const res = await post(endpoint(base, '/api/chat'), {
      method: 'POST', headers: authHeaders(key),
      body: JSON.stringify({ model: model.internal_name, messages, stream: false, think: false, options: ollamaOptions(model, spec), ...stripNestedKwargs(oneShotKwargPayload(model)) })
    });
    if (!res.ok) return '';
    const json = await res.json();
    return json.message?.content?.trim() || '';
  }
  const res = await post(endpoint(base, '/chat/completions'), {
    method: 'POST', headers: authHeaders(key),
    body: JSON.stringify({ model: model.internal_name, stream: false, messages, ...oneShotKwargPayload(model) })
  });
  if (!res.ok) return '';
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || '';
}

