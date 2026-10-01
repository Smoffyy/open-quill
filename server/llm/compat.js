const MEMO_MAX = 200;
const RETRIES = 4;

export const OPENAI_DROPPABLE = [
  'temperature', 'top_p', 'top_k', 'min_p', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'repeat_penalty',
  'seed', 'stop', 'random_seed', 'stream_options', 'timings_per_token', 'return_progress', 'reasoning_effort',
  'dry_multiplier', 'dry_base', 'dry_allowed_length', 'dry_penalty_last_n', 'xtc_probability', 'xtc_threshold',
  'mirostat', 'mirostat_tau', 'mirostat_eta'
];

const RENAME = { __proto__: null, max_tokens: 'max_completion_tokens', max_completion_tokens: 'max_tokens' };

const memo = new Map();

export function memoFor(base, id) {
  const key = String(base || '') + '|' + String(id || '');
  let m = memo.get(key);
  if (!m) {
    m = { drop: new Set(), rename: new Map(), maxTokens: 0, noThinking: false };
    memo.set(key, m);
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  }
  return m;
}

export function resetMemo() {
  memo.clear();
}

export function applyOpenAiMemo(body, mem) {
  const out = { ...body };
  for (const k of mem.drop) delete out[k];
  for (const [from, to] of mem.rename) {
    if (from in out) { out[to] = out[from]; delete out[from]; }
  }
  return out;
}

export function errorDetail(text) {
  const raw = String(text || '').trim();
  try {
    const j = JSON.parse(raw);
    const e = j?.error;
    const msg = typeof e === 'string' ? e : (e?.message || j?.message || j?.detail);
    if (msg) return { message: String(msg), param: typeof e?.param === 'string' ? e.param : '' };
  } catch {}
  return { message: raw.slice(0, 500), param: '' };
}

export function rejectedOpenAiParam(text, body) {
  const { message, param } = errorDetail(text);
  const key = param.split('.')[0];
  if (key && key in body && (RENAME[key] || OPENAI_DROPPABLE.includes(key))) return key;
  for (const k of [...Object.keys(RENAME), ...OPENAI_DROPPABLE]) {
    if (k in body && new RegExp("['\"`]" + k + "['\"`]|\\b" + k + '\\b').test(message)) return k;
  }
  return null;
}

export function fixOpenAiBody(status, text, body, mem) {
  if (status !== 400 && status !== 422) return null;
  const bad = rejectedOpenAiParam(text, body);
  if (!bad) return null;
  const next = { ...body };
  if (RENAME[bad] && !(RENAME[bad] in body)) {
    mem.rename.set(bad, RENAME[bad]);
    next[RENAME[bad]] = next[bad];
  } else {
    mem.drop.add(bad);
  }
  delete next[bad];
  return next;
}

const LEADS = {
  __proto__: null,
  401: 'The provider rejected the API key. Check the key on this connection',
  403: 'This API key is not allowed to use this model',
  404: 'The provider does not know this model or endpoint. Check the model id and the base URL',
  429: 'The provider is rate limiting this key or the account is out of credit. Try again shortly',
  500: 'The provider had an internal error',
  502: 'The provider is unavailable right now',
  503: 'The provider is unavailable right now'
};

export function upstreamMessage(status, text) {
  const { message } = errorDetail(text);
  const lead = LEADS[status];
  return `Upstream error ${status}: ${lead ? lead + '. ' : ''}${message}`.trim();
}

export async function postWithRecovery({ url, headers, body, signal, mem, send }) {
  let current = applyOpenAiMemo(body, mem);
  for (let tries = 0; ; tries++) {
    const res = await send(url, { method: 'POST', headers, signal, body: JSON.stringify(current) });
    if (res.ok && res.body) return res;
    const text = await res.text().catch(() => '');
    const next = tries < RETRIES ? fixOpenAiBody(res.status, text, current, mem) : null;
    if (!next) throw new Error(upstreamMessage(res.status, text));
    current = next;
  }
}
