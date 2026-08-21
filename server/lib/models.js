import { db, getSetting, setSetting } from '../db.js';
import { resolveProvider, providerSpec } from '../providers.js';
import { publicKwargDefs } from './kwargs.js';
import { llamaContext } from './llamacpp.js';

let sunsetCheckedAt = 0;
let sunsetCheckedVersion = -1;
const SUNSET_INTERVAL_MS = 60000;

export function applySunsets() {
  const version = db.models.version();
  if (version === sunsetCheckedVersion && Date.now() - sunsetCheckedAt < SUNSET_INTERVAL_MS) return;
  sunsetCheckedAt = Date.now();
  sunsetCheckedVersion = version;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const m of db.models.all()) {
    if (!m.sunset_at) continue;
    const d = new Date(m.sunset_at + 'T00:00:00');
    if (isNaN(d.getTime()) || d.getTime() > today.getTime()) continue;
    const patch = m.sunset_action === 'unavailable'
      ? { unavailable: 1, unavailable_reason: m.unavailable_reason || 'This model has been retired.', sunset_at: '' }
      : { enabled: 0, sunset_at: '' };
    db.models.update(m.id, patch);
    const snap = getSetting('published_models', null);
    if (Array.isArray(snap)) {
      const i = snap.findIndex(x => x.id === m.id);
      if (i >= 0) {
        const next = snap.slice();
        next[i] = { ...next[i], ...patch };
        setSetting('published_models', next);
        invalidateModelShapes();
      }
    }
  }
}

export function shapePublic(m) {
  return {
    id: m.id, displayName: m.display_name, description: m.description,
    kind: m.kind === 'router' ? 'router' : 'model',
    routerTargets: m.kind === 'router' ? [...new Set([...(Array.isArray(m.router_rules) ? m.router_rules : []).map(r => r.modelId), m.router_default].filter(Boolean))] : [],
    hasReasoning: !!m.has_reasoning, inMoreModels: !!m.in_more_models, moreModelsLabel: m.more_models_label,
    effortEnabled: !!m.effort_enabled, effortLevels: (Array.isArray(m.effort_levels) && m.effort_levels.length) ? m.effort_levels : ['low', 'medium', 'high'], effortDefault: m.effort_default || '', effortAdminOnly: !!m.effort_admin_only,
    kwargs: publicKwargDefs(m),
    reasoningCollapsible: m.reasoning_collapsible !== 0, hideThinking: !!m.hide_thinking,
    staticIcon: m.static_icon, generatingIcon: m.generating_icon, thinkingIcon: m.thinking_icon, generatingAnim: m.generating_anim || 'none', thinkingAnim: m.thinking_anim || 'none',
    iconPosition: m.icon_position || 'below', hasVision: !!m.has_vision, iconSize: m.icon_size || 0, showName: !!m.show_name,
    sandboxAuto: !!m.sandbox_auto, sandboxAllowed: m.sandbox_allowed !== 0, dropdownIcon: m.dropdown_icon !== 0, isDefault: !!m.is_default, agentSteps: m.agent_steps || 0,
    webSearchAuto: !!m.web_search_auto, webSearchAllowed: m.web_search_allowed !== 0,
    enableSummaries: !!m.enable_summaries, numCtx: m.num_ctx || 0, summaryPadding: m.summary_padding || 0.125, recentWindow: m.recent_window || 4,
    unavailable: !!m.unavailable, unavailableReason: m.unavailable_reason || '',
    sunsetAt: m.sunset_at || '',
    bgEnabled: !!m.bg_enabled, bgImage: m.bg_image || '',
    capVision: !!m.cap_vision, capReasoning: !!m.cap_reasoning, capText: !!m.cap_text, capCompact: !!m.cap_compact,
    priceIn: m.cost_in ?? null, priceOut: m.cost_out ?? null,
    docsFeatured: !!m.docs_featured, docsIntelligence: m.docs_intelligence || 0, docsSpeed: m.docs_speed || 0,
    docsMaxOutput: m.docs_max_output || 0, docsCutoff: m.docs_cutoff || '', docsBody: m.docs_body || '', docsImage: m.docs_image || '', docsIcon: m.docs_icon || '',
    docsIn: { text: m.docs_in_text !== 0, image: !!m.docs_in_image || !!m.has_vision, audio: !!m.docs_in_audio, video: !!m.docs_in_video },
    docsOut: { text: m.docs_out_text !== 0, image: !!m.docs_out_image, audio: !!m.docs_out_audio, video: !!m.docs_out_video }
  };
}

const shapeCache = { draft: null, published: null };

function shapeList(rows) {
  return rows.filter(m => m.enabled).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(shapePublic);
}

export function draftModels() {
  applySunsets();
  const version = db.models.version();
  if (shapeCache.draft && shapeCache.draft.version === version) return shapeCache.draft.list;
  const list = shapeList(db.models.all());
  shapeCache.draft = { version, list };
  return list;
}

export function publicModels() {
  applySunsets();
  const snap = getSetting('published_models', null);
  if (!Array.isArray(snap)) return draftModels();
  if (shapeCache.published && shapeCache.published.snap === snap) return shapeCache.published.list;
  const list = shapeList(snap);
  shapeCache.published = { snap, list };
  return list;
}

export function invalidateModelShapes() {
  shapeCache.draft = null;
  shapeCache.published = null;
  snapIndex.snap = null;
  snapIndex.byId = null;
}

// resolve the model used to RUN a completion: admins use live draft, clients use the published snapshot
const snapIndex = { snap: null, byId: null };

function publishedById(snap, modelId) {
  if (snapIndex.snap !== snap) {
    snapIndex.snap = snap;
    snapIndex.byId = new Map(snap.map(m => [m.id, m]));
  }
  return snapIndex.byId.get(modelId) || null;
}

export function resolveModel(modelId, isAdmin) {
  applySunsets();
  if (isAdmin) return db.models.byId(modelId);
  const snap = getSetting('published_models', null);
  if (!Array.isArray(snap)) return db.models.byId(modelId);
  return publishedById(snap, modelId);
}

export function resolveModelOrDefault(modelId, isAdmin) {
  const m = resolveModel(modelId, isAdmin);
  if (m) return m;
  const snap = getSetting('published_models', null);
  const pool = (!isAdmin && Array.isArray(snap)) ? snap : db.models.all();
  return pool.filter(x => x.enabled).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0] || null;
}

export function roleLimit(key, isAdmin, fallback) {
  const scoped = Number(getSetting(key + (isAdmin ? '_admin' : '_user')));
  if (Number.isFinite(scoped) && scoped >= 0) return scoped;
  const shared = Number(getSetting(key));
  return Number.isFinite(shared) && shared >= 0 ? shared : Number(fallback) || 0;
}

export async function detectContextLength(prov, internal) {
  const { spec, base, key } = providerSpec(prov);
  const headers = { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const root = base.replace(/\/v1$/, '');
  const asInt = (v) => { const n = parseInt(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  try {
    if (spec.protocol === 'ollama') {
      const r = await fetch(root + '/api/show', { method: 'POST', headers, body: JSON.stringify({ model: internal }) });
      if (!r.ok) return 0;
      const json = await r.json();
      const info = json.model_info || {};
      const ctxKey = Object.keys(info).find(k => k.endsWith('.context_length'));
      return asInt(ctxKey ? info[ctxKey] : 0);
    }
    if (prov?.type === 'llamacpp') {
      const propsUrls = internal
        ? [root + '/props?model=' + encodeURIComponent(internal), root + '/props']
        : [root + '/props'];
      for (const url of propsUrls) {
        try {
          const r = await fetch(url, { headers });
          if (!r.ok) continue;
          const json = await r.json();
          const ctx = asInt(json?.default_generation_settings?.n_ctx)
            || asInt(json?.default_generation_settings?.params?.n_ctx)
            || asInt(json?.n_ctx);
          if (ctx) return ctx;
        } catch {}
      }
      try {
        const r = await fetch(base + '/models', { headers });
        if (r.ok) {
          const json = await r.json();
          const list = Array.isArray(json.data) ? json.data : [];
          const hit = list.find(m => m.id === internal) || (list.length === 1 ? list[0] : null);
          const ctx = asInt(hit?.meta?.n_ctx) || asInt(hit?.n_ctx) || asInt(hit?.meta?.n_ctx_train);
          if (ctx) return ctx;
        }
      } catch {}
      return 0;
    }
    const r = await fetch(root + '/api/v0/models', { headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) return 0;
    const json = await r.json();
    const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    const hit = list.find(m => (m.id || m.key) === internal) || list.find(m => (m.id || '').includes(internal));
    return asInt(hit ? (hit.max_context_length || hit.loaded_context_length || hit.context_length || 0) : 0);
  } catch { return 0; }
}

const ctxDetectCache = new Map();
const CTX_CACHE_MS = 5 * 60 * 1000;
const CTX_CACHE_MAX = 200;
const CTX_AUTO_TYPES = new Set(['llamacpp', 'ollama', 'lmstudio']);

export async function modelCtx(model) {
  const manual = parseInt(model.num_ctx);
  if (Number.isFinite(manual) && manual > 0) return manual;
  const llama = await llamaContext(model);
  if (llama > 0) return llama;
  const prov = resolveProvider(model.provider_id);
  if (!prov || !CTX_AUTO_TYPES.has(prov.type)) return 0;
  const cacheKey = prov.id + ':' + (model.internal_name || '');
  const hit = ctxDetectCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CTX_CACHE_MS) return hit.ctx;
  const ctx = await detectContextLength(prov, model.internal_name || '');
  ctxDetectCache.set(cacheKey, { ctx, at: Date.now() });
  if (ctxDetectCache.size > CTX_CACHE_MAX) ctxDetectCache.delete(ctxDetectCache.keys().next().value);
  return ctx;
}
