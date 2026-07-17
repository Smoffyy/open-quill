import { db, getSetting } from '../db.js';
import { getProviders, resolveProvider, providerSpec } from '../providers.js';

export function shapePublic(m) {
  return {
    id: m.id, displayName: m.display_name, description: m.description,
    hasReasoning: !!m.has_reasoning, inMoreModels: !!m.in_more_models, moreModelsLabel: m.more_models_label,
    effortEnabled: !!m.effort_enabled, effortLevels: (Array.isArray(m.effort_levels) && m.effort_levels.length) ? m.effort_levels : ['low', 'medium', 'high'], effortDefault: m.effort_default || '', effortAdminOnly: !!m.effort_admin_only,
    reasoningCollapsible: m.reasoning_collapsible !== 0, hideThinking: !!m.hide_thinking,
    staticIcon: m.static_icon, generatingIcon: m.generating_icon, thinkingIcon: m.thinking_icon, generatingAnim: m.generating_anim || 'spin', thinkingAnim: m.thinking_anim || 'pulse',
    iconPosition: m.icon_position || 'below', hasVision: !!m.has_vision, iconSize: m.icon_size || 0, showName: !!m.show_name,
    sandboxAuto: !!m.sandbox_auto, sandboxAllowed: m.sandbox_allowed !== 0, dropdownIcon: m.dropdown_icon !== 0, isDefault: !!m.is_default, agentSteps: m.agent_steps || 0,
    webSearchAuto: !!m.web_search_auto, webSearchAllowed: m.web_search_allowed !== 0,
    enableSummaries: !!m.enable_summaries, numCtx: m.num_ctx || 0, summaryPadding: m.summary_padding || 0.125, recentWindow: m.recent_window || 4,
    unavailable: !!m.unavailable, unavailableReason: m.unavailable_reason || '',
    bgEnabled: !!m.bg_enabled, bgImage: m.bg_image || '',
    capVision: !!m.cap_vision, capReasoning: !!m.cap_reasoning, capText: !!m.cap_text, capCompact: !!m.cap_compact
  };
}

export function draftModels() {
  return db.models.filter(m => m.enabled).sort((a, b) => a.sort_order - b.sort_order).map(shapePublic);
}

export function publicModels() {
  const snap = getSetting('published_models', null);
  if (!Array.isArray(snap)) return draftModels();
  return snap.filter(m => m.enabled).sort((a, b) => a.sort_order - b.sort_order).map(shapePublic);
}

// resolve the model used to RUN a completion: admins use live draft, clients use the published snapshot
export function resolveModel(modelId, isAdmin) {
  if (isAdmin) return db.models.byId(modelId);
  const snap = getSetting('published_models', null);
  if (!Array.isArray(snap)) return db.models.byId(modelId);
  return snap.find(m => m.id === modelId) || null;
}

export function resolveModelOrDefault(modelId, isAdmin) {
  const m = resolveModel(modelId, isAdmin);
  if (m) return m;
  const snap = getSetting('published_models', null);
  const pool = (!isAdmin && Array.isArray(snap)) ? snap : db.models.all();
  return pool.filter(x => x.enabled).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0] || null;
}

export function effortLevelsOf(model) {
  return (Array.isArray(model.effort_levels) && model.effort_levels.length) ? model.effort_levels : ['low', 'medium', 'high'];
}

export function applyEffort(model, requested, allowRequest = true) {
  if (!model || !model.effort_enabled) return model;
  const levels = effortLevelsOf(model);
  const isBool = levels.length === 2 && levels.some(x => /^true$/i.test(x)) && levels.some(x => /^false$/i.test(x));
  const fallback = isBool ? levels.find(x => /^false$/i.test(x)) : (levels[Math.floor(levels.length / 2)] || levels[0]);
  const def = levels.includes(model.effort_default) ? model.effort_default : fallback;
  const level = (allowRequest && typeof requested === 'string' && levels.includes(requested)) ? requested : def;
  return { ...model, reasoning_effort_level: level, reasoning_effort_kwarg: (model.effort_kwarg || 'reasoning_effort').trim() || 'reasoning_effort' };
}

export function roleLimit(key, isAdmin, fallback) {
  const v = getSetting(key + (isAdmin ? '_admin' : '_user'));
  if (v != null) return Number(v);
  return Number(getSetting(key, String(fallback)));
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
      try {
        const r = await fetch(root + '/props', { headers });
        if (r.ok) {
          const json = await r.json();
          const ctx = asInt(json?.default_generation_settings?.n_ctx) || asInt(json?.n_ctx);
          if (ctx) return ctx;
        }
      } catch {}
      try {
        const r = await fetch(base + '/models', { headers });
        if (r.ok) {
          const json = await r.json();
          const list = Array.isArray(json.data) ? json.data : [];
          const hit = list.find(m => m.id === internal) || list[0];
          const ctx = asInt(hit?.meta?.n_ctx_train) || asInt(hit?.meta?.n_ctx);
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
const CTX_AUTO_TYPES = new Set(['llamacpp', 'ollama', 'lmstudio']);

export async function modelCtx(model) {
  const manual = parseInt(model.num_ctx);
  if (Number.isFinite(manual) && manual > 0) return manual;
  const prov = resolveProvider(model.provider_id);
  if (!prov || !CTX_AUTO_TYPES.has(prov.type)) return 0;
  const cacheKey = prov.id + ':' + (model.internal_name || '');
  const hit = ctxDetectCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CTX_CACHE_MS) return hit.ctx;
  const ctx = await detectContextLength(prov, model.internal_name || '');
  ctxDetectCache.set(cacheKey, { ctx, at: Date.now() });
  return ctx;
}

export function defaultProviderId() {
  return getProviders()[0]?.id || null;
}
