import { resolveProvider, providerSpec } from '../providers.js';

const CACHE_MS = 5 * 60 * 1000;
const propsCache = new Map();
const tokenCache = new Map();
const TOKEN_CACHE_MAX = 400;

const asInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

function rootOf(base) { return String(base || '').replace(/\/+$/, '').replace(/\/v\d+$/, ''); }

function headersFor(key) {
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

export function isLlamaCpp(model) {
  const prov = resolveProvider(model && model.provider_id);
  return !!prov && prov.type === 'llamacpp';
}

async function jsonFetch(url, opts, ms = 4000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function llamaProps(model) {
  const prov = resolveProvider(model && model.provider_id);
  if (!prov || prov.type !== 'llamacpp') return null;
  const { base, key } = providerSpec(prov);
  const root = rootOf(base);
  const hit = propsCache.get(root);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.props;
  const props = await jsonFetch(root + '/props', { headers: headersFor(key) });
  let ctx = 0;
  let slots = 0;
  let vision = false;
  if (props) {
    ctx = asInt(props?.default_generation_settings?.n_ctx) || asInt(props?.n_ctx);
    slots = asInt(props?.total_slots);
    vision = !!(props?.modalities && props.modalities.vision);
  }
  if (!ctx) {
    const slotList = await jsonFetch(root + '/slots', { headers: headersFor(key) });
    if (Array.isArray(slotList) && slotList.length) ctx = asInt(slotList[0]?.n_ctx);
  }
  const out = ctx ? { ctx, slots, vision } : null;
  propsCache.set(root, { at: Date.now(), props: out });
  return out;
}

export async function llamaContext(model) {
  const p = await llamaProps(model);
  return p ? p.ctx : 0;
}

export async function llamaTokenCount(model, messages) {
  const prov = resolveProvider(model && model.provider_id);
  if (!prov || prov.type !== 'llamacpp') return 0;
  const { base, key } = providerSpec(prov);
  const root = rootOf(base);
  const headers = headersFor(key);
  const wire = messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content) ? m.content.map(p => (p.type === 'text' ? p.text : '[image]')).join('\n') : String(m.content ?? ''))
  }));
  const sig = wire.length + ':' + wire.reduce((n, m) => n + m.content.length, 0) + ':' + (wire[wire.length - 1]?.content.slice(-64) || '');
  const cached = tokenCache.get(sig);
  if (cached) return cached;
  const tpl = await jsonFetch(root + '/apply-template', { method: 'POST', headers, body: JSON.stringify({ messages: wire }) }, 8000);
  const text = tpl && typeof tpl.prompt === 'string' ? tpl.prompt : wire.map(m => m.role + ':\n' + m.content).join('\n\n');
  const tok = await jsonFetch(root + '/tokenize', { method: 'POST', headers, body: JSON.stringify({ content: text, add_special: true }) }, 8000);
  const n = Array.isArray(tok?.tokens) ? tok.tokens.length : 0;
  if (n) {
    tokenCache.set(sig, n);
    if (tokenCache.size > TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value);
  }
  return n;
}

const OVERFLOW_RE = /exceed(s|ed)?\s+the\s+(available\s+)?context|context\s+(size|window|length)\s+(exceeded|is\s+too|too\s+small)|prompt\s+is\s+too\s+long|n_ctx|kv\s*cache\s*is\s*full|context_length_exceeded|too\s+many\s+tokens/i;

export function isContextOverflowError(err) {
  const msg = String((err && (err.message || err.error || err)) || '');
  return OVERFLOW_RE.test(msg);
}

export function clearLlamaCaches() { propsCache.clear(); tokenCache.clear(); }
