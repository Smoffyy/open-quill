import { resolveProvider, providerSpec } from '../providers.js';

const CACHE_MS = 5 * 60 * 1000;
const infoCache = new Map();
const tokenCache = new Map();
const imageCostCache = new Map();
const TOKEN_CACHE_MAX = 400;
const DEFAULT_IMAGE_TOKENS = 1600;
const PER_MSG_OVERHEAD = 8;
const templateBroken = new Map();

const asInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

function rootOf(base) { return String(base || '').replace(/\/+$/, '').replace(/\/v\d+$/, ''); }

function headersFor(key) {
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

export function isLlamaCpp(model) {
  const prov = resolveProvider(model && model.provider_id);
  return !!prov && prov.type === 'llamacpp';
}

function endpointFor(model) {
  const prov = resolveProvider(model && model.provider_id);
  if (!prov || prov.type !== 'llamacpp') return null;
  const { base, key } = providerSpec(prov);
  return { root: rootOf(base), headers: headersFor(key), name: String(model.internal_name || '') };
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

function withModel(url, name) {
  if (!name) return url;
  return url + (url.includes('?') ? '&' : '?') + 'model=' + encodeURIComponent(name);
}

async function getWithModel(ep, path, ms) {
  if (ep.name) {
    const routed = await jsonFetch(withModel(ep.root + path, ep.name), { headers: ep.headers }, ms);
    if (routed) return routed;
  }
  return jsonFetch(ep.root + path, { headers: ep.headers }, ms);
}

async function postWithModel(ep, path, body, ms) {
  if (ep.name) {
    const payload = { ...body, model: ep.name };
    const routed = await jsonFetch(withModel(ep.root + path, ep.name), { method: 'POST', headers: ep.headers, body: JSON.stringify(payload) }, ms);
    if (routed) return routed;
  }
  return jsonFetch(ep.root + path, { method: 'POST', headers: ep.headers, body: JSON.stringify(body) }, ms);
}

function ctxFromProps(props) {
  if (!props) return 0;
  return asInt(props?.default_generation_settings?.n_ctx)
    || asInt(props?.default_generation_settings?.params?.n_ctx)
    || asInt(props?.n_ctx);
}

function ctxFromModelList(list, name) {
  const rows = Array.isArray(list) ? list : (Array.isArray(list?.data) ? list.data : []);
  if (!rows.length) return 0;
  const match = (name && rows.find(r => r?.id === name || (Array.isArray(r?.aliases) && r.aliases.includes(name)))) || null;
  const pick = match || (rows.length === 1 ? rows[0] : null);
  if (!pick) return 0;
  return asInt(pick?.meta?.n_ctx) || asInt(pick?.n_ctx) || asInt(pick?.context_length);
}

export async function llamaInfo(model) {
  const ep = endpointFor(model);
  if (!ep) return null;
  const cacheKey = ep.root + '|' + ep.name;
  const hit = infoCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.info;

  const props = await getWithModel(ep, '/props', 4000);
  let ctx = ctxFromProps(props);
  let slots = asInt(props?.total_slots);
  let vision = !!(props?.modalities && props.modalities.vision);

  if (!ctx) {
    const list = await jsonFetch(ep.root + '/v1/models', { headers: ep.headers }, 4000);
    ctx = ctxFromModelList(list, ep.name);
    if (!vision) {
      const rows = Array.isArray(list?.data) ? list.data : [];
      const m = rows.find(r => r?.id === ep.name);
      vision = !!(m?.meta?.vision || m?.meta?.modalities?.vision);
    }
  }
  if (!ctx) {
    const slotList = await getWithModel(ep, '/slots', 4000);
    const rows = Array.isArray(slotList) ? slotList : (Array.isArray(slotList?.slots) ? slotList.slots : []);
    if (rows.length) { ctx = asInt(rows[0]?.n_ctx); slots = slots || rows.length; }
  }

  const info = ctx ? { ctx, slots, vision } : null;
  infoCache.set(cacheKey, { at: Date.now(), info });
  return info;
}

export async function llamaProps(model) { return llamaInfo(model); }

export async function llamaEngine(provider) {
  if (!provider || provider.type !== 'llamacpp') return null;
  const { base, key } = providerSpec(provider);
  const ep = { root: rootOf(base), headers: headersFor(key), name: '' };

  const list = await jsonFetch(ep.root + '/v1/models', { headers: ep.headers }, 5000);
  const rows = Array.isArray(list?.data) ? list.data : (Array.isArray(list) ? list : []);
  if (!rows.length && !list) return { ok: false, models: [], slots: 0, slotsBusy: null, ctx: 0, vision: false, slotsHidden: false };

  const props = await jsonFetch(ep.root + '/props', { headers: ep.headers }, 5000);
  const slotList = await jsonFetch(ep.root + '/slots', { headers: ep.headers }, 5000);
  const slotRows = Array.isArray(slotList) ? slotList : (Array.isArray(slotList?.slots) ? slotList.slots : []);

  const models = rows.map(r => ({
    id: String(r?.id || r?.name || ''),
    ctx: asInt(r?.meta?.n_ctx) || asInt(r?.n_ctx) || 0,
    trained: asInt(r?.meta?.n_ctx_train) || 0,
    vision: !!(r?.meta?.vision || r?.meta?.modalities?.vision)
  })).filter(m => m.id);

  return {
    ok: true,
    models,
    ctx: ctxFromProps(props) || (slotRows.length ? asInt(slotRows[0]?.n_ctx) : 0) || (models.length === 1 ? models[0].ctx : 0),
    slots: asInt(props?.total_slots) || slotRows.length,
    slotsBusy: slotRows.length ? slotRows.filter(s => s && s.is_processing).length : null,
    slotsHidden: !slotRows.length,
    vision: !!(props?.modalities && props.modalities.vision) || models.some(m => m.vision)
  };
}

export async function llamaContext(model) {
  const p = await llamaInfo(model);
  return p ? p.ctx : 0;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content.map(p => (p && p.type === 'text' ? (p.text || '') : '')).filter(Boolean).join('\n');
}

export function countImages(messages) {
  let n = 0;
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content) if (p && p.type === 'image_url') n++;
  }
  return n;
}

export function imageTokenCost(model) {
  const key = String(model?.id || model?.internal_name || '');
  const learned = imageCostCache.get(key);
  return learned && learned > 0 ? learned : DEFAULT_IMAGE_TOKENS;
}

export function learnImageCost(model, images, measured) {
  if (!images || images < 1 || !(measured > 0)) return;
  const key = String(model?.id || model?.internal_name || '');
  const per = Math.ceil(measured / images);
  if (per < 16 || per > 20000) return;
  const prev = imageCostCache.get(key) || 0;
  imageCostCache.set(key, Math.max(prev, per));
}

function wireFor(messages) {
  return messages.map(m => {
    const out = { role: m.role, content: textOf(m.content) };
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name) out.name = m.name;
    return out;
  });
}

function toolSig(tools) {
  if (!Array.isArray(tools) || !tools.length) return '0';
  let chars = 0;
  const names = [];
  for (const t of tools) {
    const fn = t && t.function;
    if (!fn) continue;
    names.push(fn.name || '');
    try { chars += JSON.stringify(fn.parameters || {}).length + (fn.description || '').length; } catch {}
  }
  return tools.length + ':' + chars + ':' + names.join(',');
}

function signature(wire, tools, name, images) {
  let chars = 0;
  for (const m of wire) chars += m.content.length + m.role.length;
  const tail = wire.length ? wire[wire.length - 1].content.slice(-96) : '';
  return name + '|' + wire.length + '|' + chars + '|' + images + '|' + toolSig(tools) + '|' + tail;
}

export async function llamaPromptTokens(model, messages, tools) {
  const ep = endpointFor(model);
  if (!ep) return 0;
  const wire = wireFor(messages);
  const sig = signature(wire, tools, ep.name, countImages(messages));
  const cached = tokenCache.get(sig);
  if (cached) {
    tokenCache.delete(sig);
    tokenCache.set(sig, cached);
    return cached + countImages(messages) * imageTokenCost(model);
  }
  const broken = templateBroken.get(ep.root + '|' + ep.name);
  let prompt = null;
  let pad = 0;
  if (!broken || Date.now() - broken > CACHE_MS) {
    const body = { messages: wire, add_generation_prompt: true };
    if (Array.isArray(tools) && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    const tpl = await postWithModel(ep, '/apply-template', body, 15000);
    prompt = tpl && typeof tpl.prompt === 'string' ? tpl.prompt : null;
    if (prompt === null) templateBroken.set(ep.root + '|' + ep.name, Date.now());
    else templateBroken.delete(ep.root + '|' + ep.name);
  }
  if (prompt === null) {
    prompt = wire.map(m => m.role + '\n' + m.content).join('\n');
    if (Array.isArray(tools) && tools.length) { try { prompt += '\n' + JSON.stringify(tools); } catch {} }
    pad = wire.length * PER_MSG_OVERHEAD + 8;
  }
  const tok = await postWithModel(ep, '/tokenize', { content: prompt, add_special: true }, 15000);
  const n = Array.isArray(tok?.tokens) ? tok.tokens.length : 0;
  if (!n) return 0;
  const text = n + pad;
  tokenCache.set(sig, text);
  if (tokenCache.size > TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value);
  return text + countImages(messages) * imageTokenCost(model);
}

export async function llamaTokenCount(model, messages, tools) {
  return llamaPromptTokens(model, messages, tools);
}

const OVERFLOW_RE = /exceed(s|ed)?\s+the\s+(available\s+)?context|context\s+(size|window|length)\s+(exceeded|is\s+too|too\s+small)|prompt\s+is\s+too\s+long|n_ctx|kv\s*cache\s*is\s*full|context_length_exceeded|too\s+many\s+tokens/i;

export function isContextOverflowError(err) {
  const msg = String((err && (err.message || err.error || err)) || '');
  return OVERFLOW_RE.test(msg);
}

export function parseOverflow(err) {
  const msg = String((err && (err.message || err.error || err)) || '');
  if (!msg) return null;
  let prompt = 0;
  let ctx = 0;
  const fieldPrompt = msg.match(/"n_prompt_tokens"\s*:\s*(\d+)/);
  const fieldCtx = msg.match(/"n_ctx"\s*:\s*(\d+)/);
  if (fieldPrompt) prompt = asInt(fieldPrompt[1]);
  if (fieldCtx) ctx = asInt(fieldCtx[1]);
  if (!prompt || !ctx) {
    const pair = msg.match(/\((\d+)\s*tokens?\)[^(]*\((\d+)\s*tokens?\)/);
    if (pair) { prompt = prompt || asInt(pair[1]); ctx = ctx || asInt(pair[2]); }
  }
  if (!prompt || !ctx) return null;
  return { prompt, ctx };
}

export function clearLlamaCaches() { infoCache.clear(); tokenCache.clear(); templateBroken.clear(); }
