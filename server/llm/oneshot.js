import { modelProvider, endpoint, authHeaders } from './provider.js';
import { ollamaOptions } from './sampling.js';
import { normalizeMessages } from './wire.js';
import { oneShotKwargPayload, stripNestedKwargs } from '../lib/kwargs.js';

export async function oneShot(model, messages) {
  const { spec, base, key } = modelProvider(model);
  if (spec.protocol === 'ollama') {
    const res = await fetch(endpoint(base, '/api/chat'), {
      method: 'POST', headers: authHeaders(key),
      body: JSON.stringify({ model: model.internal_name, messages, stream: false, think: false, options: ollamaOptions(model, spec), ...stripNestedKwargs(oneShotKwargPayload(model)) })
    });
    if (!res.ok) return '';
    const json = await res.json();
    return json.message?.content?.trim() || '';
  }
  const res = await fetch(endpoint(base, '/chat/completions'), {
    method: 'POST', headers: authHeaders(key),
    body: JSON.stringify({ model: model.internal_name, stream: false, messages, ...oneShotKwargPayload(model) })
  });
  if (!res.ok) return '';
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || '';
}

