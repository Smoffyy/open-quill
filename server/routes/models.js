import { db, uid, tx, getSetting, setSetting } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { getProviders, resolveProvider, providerSpec } from '../lib/providers.js';
import { matchPreset, presetList, setCustomPresets, getCustomPresets } from '../lib/pricing.js';
import { logAudit } from '../lib/audit.js';
import { staged } from '../lib/releases.js';
import { draftModels, publicModels, detectContextLength, timedFetch } from '../lib/models.js';
import { sanitizeKwargs } from '../lib/kwargs.js';
import { listAnthropicModels } from '../llm/index.js';
import { sanitizeBadgesOff } from '../lib/badges.js';
import { ROUTE_MATCHERS } from '../lib/router.js';
import { DOCS_MODEL_STR, DOCS_MODEL_BOOL, DOCS_MODEL_INT, DOCS_MODEL_FLOAT, DOCS_BADGES, sanitizePairs, sanitizeCards, sanitizeDocsLinks, sanitizeStrList } from '../lib/modeldocs.js';
import { listLogos } from '../lib/logos.js';
import { syncedPrompt, draftFeatures } from '../lib/systemprompt.js';
import { sanitizeConsultModels } from '../lib/consult.js';
import { touchesBlocks, addBlocks, eligibleBlocks } from '../lib/promptblocks.js';

function sanitizeRouterRules(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 40).map(r => ({
    match: ROUTE_MATCHERS.includes(r?.match) ? r.match : 'keyword',
    value: String(r?.value ?? '').slice(0, 400),
    modelId: String(r?.modelId ?? ''),
    label: String(r?.label ?? '').slice(0, 60),
  })).filter(r => r.modelId);
}

function sanitizeStop(raw) {
  const lines = Array.isArray(raw) ? raw : String(raw ?? '').split('\n');
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const s = String(line ?? '').trim().slice(0, 120);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 8) break;
  }
  return out.join('\n');
}

function modelPatch(b, cur) {
  const str = ['display_name', 'description', 'internal_name', 'system_prompt', 'call_prompt', 'reasoning_token', 'non_reasoning_token', 'more_models_label', 'static_icon', 'generating_icon', 'thinking_icon', 'icon_position', 'think_open', 'think_close', 'generating_anim', 'thinking_anim', 'unavailable_reason', 'provider_id', 'bg_image', 'effort_kwarg', 'effort_default', ...DOCS_MODEL_STR];
  const bool = ['has_reasoning', 'has_vision', 'in_more_models', 'enabled', 'sandbox_auto', 'sandbox_allowed', 'dropdown_icon', 'is_default', 'enable_summaries', 'unavailable', 'reasoning_collapsible', 'bg_enabled', 'web_search_auto', 'web_search_allowed', 'show_name', 'skills_allowed', 'mcp_allowed', 'chat_search_allowed', 'end_chat_allowed', 'memory_allowed', 'calculator_allowed', 'hide_tool_calls', 'todo_allowed', 'ask_user_allowed', 'consult_allowed', 'consult_images', 'long_convo_reminder', 'effort_enabled', 'effort_admin_only', 'hide_thinking', ...DOCS_MODEL_BOOL];
  const patch = {};
  for (const k of str) if (k in b) patch[k] = b[k];
  for (const k of bool) if (k in b) patch[k] = b[k] ? 1 : 0;
  if ('sunset_at' in b) {
    const v = String(b.sunset_at || '').trim();
    patch.sunset_at = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  }
  if ('sunset_action' in b) {
    const v = String(b.sunset_action || '');
    patch.sunset_action = v === 'unavailable' ? 'unavailable' : 'hide';
  }
  if ('docs_badge' in patch) patch.docs_badge = DOCS_BADGES.has(patch.docs_badge) ? patch.docs_badge : '';
  if ('docs_ids' in b) patch.docs_ids = sanitizePairs(b.docs_ids);
  if ('docs_platforms' in b) patch.docs_platforms = sanitizeStrList(b.docs_platforms);
  if ('docs_links' in b) patch.docs_links = sanitizeDocsLinks(b.docs_links);
  if ('docs_resources' in b) patch.docs_resources = sanitizeCards(b.docs_resources);
  if ('docs_reference' in b) patch.docs_reference = sanitizeCards(b.docs_reference);
  if ('kind' in b) patch.kind = b.kind === 'router' ? 'router' : 'model';
  if ('router_default' in b) patch.router_default = String(b.router_default || '');
  if ('router_rules' in b) patch.router_rules = sanitizeRouterRules(b.router_rules);
  if ('kwargs' in b) patch.kwargs = sanitizeKwargs(b.kwargs);
  if ('badges_off' in b) patch.badges_off = badgesOff(b.badges_off);
  if ('consult_models' in b) patch.consult_models = sanitizeConsultModels(b.consult_models);
  if ('effort_levels' in b) {
    const arr = Array.isArray(b.effort_levels) ? b.effort_levels : String(b.effort_levels || '').split(',');
    const clean = arr.map(s => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 8);
    patch.effort_levels = clean.length ? clean : ['low', 'medium', 'high'];
  }
  if ('agent_steps' in b) patch.agent_steps = Math.max(0, parseInt(b.agent_steps) || 0);
  if ('num_ctx' in b) patch.num_ctx = Math.max(0, parseInt(b.num_ctx) || 0);
  if ('recent_window' in b) patch.recent_window = Math.max(1, parseInt(b.recent_window) || 4);
  if ('icon_size' in b) patch.icon_size = Math.max(0, Math.min(80, parseInt(b.icon_size) || 0));
  if ('summary_padding' in b) patch.summary_padding = Math.max(0.03, Math.min(0.6, parseFloat(b.summary_padding) || 0.125));
  if ('ctx_trim_mode' in b) patch.ctx_trim_mode = b.ctx_trim_mode === 'cache' ? 'cache' : 'retain';
  if ('stop' in b) patch.stop = sanitizeStop(b.stop);
  const numF = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'min_p', 'cost_in', 'cost_out',
    'dry_multiplier', 'dry_base', 'xtc_probability', 'xtc_threshold', 'mirostat_tau', 'mirostat_eta', ...DOCS_MODEL_FLOAT];
  const numI = ['top_k', 'seed', 'max_tokens', ...DOCS_MODEL_INT,
    'dry_allowed_length', 'dry_penalty_last_n', 'mirostat'];
  for (const k of numF) if (k in b) { const v = b[k]; patch[k] = (v === '' || v == null || isNaN(Number(v))) ? null : Number(v); }
  for (const k of numI) if (k in b) { const v = b[k]; patch[k] = (v === '' || v == null || isNaN(parseInt(v))) ? null : parseInt(v); }
  if ('internal_name' in patch && !('cost_in' in b) && !('cost_out' in b) && cur.cost_in == null && cur.cost_out == null) {
    const preset = matchPreset(patch.internal_name);
    if (preset) { patch.cost_in = preset.in; patch.cost_out = preset.out; }
  }
  if (touchesBlocks(patch)) {
    const text = syncedPrompt(cur, patch);
    if (text != null) patch.system_prompt = text;
  }
  return patch;
}

const MAX_BATCH = 500;

function badgesOff(raw) {
  const list = sanitizeBadgesOff(raw);
  return list.length ? list : undefined;
}
const MAX_FOLDERS = 200;
const FOLDER_NAME = 60;

function sanitizeFolders(raw) {
  const out = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const name = typeof v === 'string' ? v.trim().slice(0, FOLDER_NAME) : '';
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_FOLDERS) break;
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function idList(raw) {
  return new Set((Array.isArray(raw) ? raw : []).slice(0, MAX_BATCH).filter(id => typeof id === 'string'));
}

function defaultHolders() {
  return db.models.all().filter(m => m.is_default).map(m => m.id);
}

function syncModels(req, plan, holders) {
  const keys = [];
  const ids = new Set();
  for (const [cur, patch] of plan) {
    ids.add(cur.id);
    for (const f of Object.keys(patch)) keys.push(`model:${cur.id}:${f}`);
  }
  if (plan.some(([, p]) => p.is_default === 1)) {
    for (const id of holders) {
      ids.add(id);
      keys.push(`model:${id}:is_default`);
    }
  }
  staged(req, 'models', { keys, rows: [...ids].map(id => db.models.byId(id)).filter(Boolean) });
}

function applyPatch(cur, patch) {
  if (patch.is_default === 1) for (const other of db.models.all()) if (other.id !== cur.id && other.is_default) db.models.update(other.id, { is_default: 0 });
  db.models.update(cur.id, patch);
}

export default function registerModelRoutes(app) {
  app.get('/api/models', authMiddleware, (req, res) => res.json(req.user.is_admin ? draftModels() : publicModels()));

  app.get('/api/admin/models', authMiddleware, adminOnly, (req, res) =>
    res.json(db.models.all().sort((a, b) => a.sort_order - b.sort_order)));

  app.get('/api/admin/logos', authMiddleware, adminOnly, (req, res) => res.json({ logos: listLogos() }));

  app.get('/api/admin/discover-models', authMiddleware, adminOnly, async (req, res) => {
    try {
      const prov = req.query.provider ? resolveProvider(req.query.provider) : getProviders()[0];
      const { spec, base, key } = providerSpec(prov);
      const headers = key ? { Authorization: `Bearer ${key}` } : {};
      let ids = [];
      if (spec.protocol === 'anthropic') {
        if (!key) return res.status(400).json({ error: 'Add an API key to this connection first.' });
        ids = (await listAnthropicModels({ base, key })).map(m => m.id);
      } else if (spec.protocol === 'ollama') {
        const r = await timedFetch(base.replace(/\/v1$/, '') + '/api/tags', { headers });
        if (!r.ok) return res.status(502).json({ error: `Backend returned ${r.status}.` });
        const j = await r.json().catch(() => ({}));
        ids = (Array.isArray(j?.models) ? j.models : []).map(x => x?.name || x?.model).filter(Boolean);
      } else {
        const r = await timedFetch(base + '/models', { headers });
        if (!r.ok) return res.status(502).json({ error: `Backend returned ${r.status}.` });
        const j = await r.json().catch(() => ({}));
        const raw = Array.isArray(j?.data) ? j.data : (Array.isArray(j?.models) ? j.models : []);
        ids = raw.map(x => (typeof x === 'string' ? x : (x?.id || x?.name))).filter(Boolean);
      }
      if (spec.modelPrefix) ids = ids.map(id => (String(id).startsWith(spec.modelPrefix) ? String(id).slice(spec.modelPrefix.length) : id));
      ids = [...new Set(ids)];
      const existing = new Set(db.models.all().map(m => (m.internal_name || '').toLowerCase()));
      res.json({ models: ids.map(id => ({ id, added: existing.has(String(id).toLowerCase()) })) });
    } catch {
      res.status(502).json({ error: 'Could not reach the backend. Check the Connection settings.' });
    }
  });

  app.post('/api/admin/models', authMiddleware, adminOnly, (req, res) => {
    const max = db.models.all().reduce((a, m) => Math.max(a, m.sort_order || 0), 0);
    const b = req.body;
    const preset = matchPreset(b.internal_name || '');
    const m = db.models.insert({
      id: uid(), display_name: b.display_name || 'New model', description: b.description || '',
      kind: b.kind === 'router' ? 'router' : 'model', router_rules: sanitizeRouterRules(b.router_rules), router_default: String(b.router_default || ''),
      internal_name: b.internal_name || 'local-model', system_prompt: b.system_prompt || '',
      call_prompt: b.call_prompt || '',
      provider_id: b.provider_id || (getProviders()[0]?.id || null), max_tokens: parseInt(b.max_tokens) || null,
      has_reasoning: b.has_reasoning ? 1 : 0, reasoning_token: b.reasoning_token || '', non_reasoning_token: b.non_reasoning_token || '',
      kwargs: sanitizeKwargs(b.kwargs),
      effort_enabled: b.effort_enabled ? 1 : 0, effort_levels: Array.isArray(b.effort_levels) && b.effort_levels.length ? b.effort_levels : ['low', 'medium', 'high'], effort_default: b.effort_default || 'medium', effort_kwarg: b.effort_kwarg || 'reasoning_effort', effort_admin_only: b.effort_admin_only ? 1 : 0, hide_thinking: b.hide_thinking ? 1 : 0,
      reasoning_collapsible: b.reasoning_collapsible === false ? 0 : 1, icon_size: parseInt(b.icon_size) || (getSetting('ui_preset', '') === 'openai' ? 28 : 0),
      show_name: 'show_name' in b ? (b.show_name ? 1 : 0) : (getSetting('ui_preset', '') === 'openai' ? 1 : 0),
      generating_anim: b.generating_anim || 'none',
      thinking_anim: b.thinking_anim || 'none',
      has_vision: b.has_vision ? 1 : 0,
      think_open: b.think_open || '', think_close: b.think_close || '',
      sandbox_auto: b.sandbox_auto ? 1 : 0, sandbox_allowed: b.sandbox_allowed === false ? 0 : 1, dropdown_icon: 'dropdown_icon' in b ? (b.dropdown_icon === false ? 0 : 1) : (getSetting('ui_preset', '') === 'openai' ? 0 : 1), is_default: 0, agent_steps: Number.isInteger(b.agent_steps) ? Math.max(0, b.agent_steps) : 0,
      web_search_auto: b.web_search_auto ? 1 : 0, web_search_allowed: b.web_search_allowed === false ? 0 : 1,
      skills_allowed: b.skills_allowed ? 1 : 0, mcp_allowed: b.mcp_allowed ? 1 : 0, chat_search_allowed: b.chat_search_allowed ? 1 : 0,
      end_chat_allowed: b.end_chat_allowed ? 1 : 0, memory_allowed: b.memory_allowed ? 1 : 0, calculator_allowed: b.calculator_allowed ? 1 : 0, todo_allowed: b.todo_allowed ? 1 : 0, ask_user_allowed: b.ask_user_allowed ? 1 : 0, consult_allowed: b.consult_allowed ? 1 : 0, consult_images: b.consult_images ? 1 : 0, consult_models: sanitizeConsultModels(b.consult_models), hide_tool_calls: b.hide_tool_calls ? 1 : 0, long_convo_reminder: b.long_convo_reminder ? 1 : 0,
      enable_summaries: b.enable_summaries ? 1 : 0, num_ctx: parseInt(b.num_ctx) || 0, summary_padding: typeof b.summary_padding === "number" ? b.summary_padding : 0.125, recent_window: parseInt(b.recent_window) > 0 ? parseInt(b.recent_window) : 4,
      in_more_models: b.in_more_models ? 1 : 0, more_models_label: b.more_models_label || 'More models',
      unavailable: b.unavailable ? 1 : 0, unavailable_reason: b.unavailable_reason || '',
      bg_enabled: b.bg_enabled ? 1 : 0, bg_image: b.bg_image || '',
      badges_off: badgesOff(b.badges_off),
      static_icon: b.static_icon || '', generating_icon: b.generating_icon || '', thinking_icon: b.thinking_icon || '',
      icon_position: b.icon_position || (getSetting('ui_preset', '') === 'openai' ? 'left' : 'below'),
      temperature: null, top_p: null, presence_penalty: null, frequency_penalty: null, repetition_penalty: null, min_p: null, top_k: null, seed: null,
      cost_in: preset ? preset.in : null, cost_out: preset ? preset.out : null,
      sort_order: max + 1, enabled: 1
    });
    const withBlocks = addBlocks(m.system_prompt || '', eligibleBlocks(m, draftFeatures()));
    if (withBlocks !== (m.system_prompt || '')) db.models.update(m.id, { system_prompt: withBlocks });
    logAudit(req, 'model.create', { type: 'model', id: m.id, meta: { displayName: m.display_name, internalName: m.internal_name } });
    staged(req, 'models', { keys: ['model:' + m.id], rows: [db.models.byId(m.id)] });
    res.json({ id: m.id });
  });

  app.patch('/api/admin/models/:id', authMiddleware, adminOnly, (req, res) => {
    const cur = db.models.byId(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const patch = modelPatch(req.body || {}, cur);
    const holders = defaultHolders();
    tx(() => applyPatch(cur, patch));
    logAudit(req, 'model.update', { type: 'model', id: cur.id, meta: { fields: Object.keys(patch) } });
    syncModels(req, [[cur, patch]], holders);
    res.json({ ok: true });
  });

  app.patch('/api/admin/models', authMiddleware, adminOnly, (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, MAX_BATCH) : null;
    if (!rows) return res.status(400).json({ error: 'rows must be an array' });
    const plan = [];
    for (const row of rows) {
      const cur = row && typeof row === 'object' ? db.models.byId(row.id) : undefined;
      if (!cur) return res.status(404).json({ error: 'not found', id: row?.id ?? null });
      plan.push([cur, modelPatch(row, cur)]);
    }
    if (plan.filter(([, p]) => p.is_default === 1).length > 1) return res.status(400).json({ error: 'only one model can be the default' });
    const holders = defaultHolders();
    tx(() => { for (const [cur, patch] of plan) applyPatch(cur, patch); });
    logAudit(req, 'model.update', { type: 'model', meta: { ids: plan.map(([c]) => c.id), fields: [...new Set(plan.flatMap(([, p]) => Object.keys(p)))] } });
    syncModels(req, plan, holders);
    res.json({ ok: true, count: plan.length });
  });

  app.post('/api/admin/models/duplicate', authMiddleware, adminOnly, (req, res) => {
    const ids = idList(req.body?.ids);
    const all = db.models.all().sort((a, b) => a.sort_order - b.sort_order);
    const made = [];
    const order = [];
    for (const m of all) {
      order.push(m);
      if (!ids.has(m.id)) continue;
      const copy = { ...m, id: uid(), display_name: (m.display_name || 'Model') + ' copy', is_default: 0 };
      made.push(copy);
      order.push(copy);
    }
    tx(() => {
      for (const c of made) db.models.insert(c);
      order.forEach((m, i) => db.models.update(m.id, { sort_order: i }));
    });
    for (const c of made) logAudit(req, 'model.create', { type: 'model', id: c.id, meta: { displayName: c.display_name, internalName: c.internal_name } });
    staged(req, 'models', { keys: made.map(c => 'model:' + c.id), reload: true });
    res.json({ ids: made.map(c => c.id) });
  });

  app.post('/api/admin/models/remove', authMiddleware, adminOnly, (req, res) => {
    const gone = db.models.all().filter(m => idList(req.body?.ids).has(m.id));
    db.models.removeByIds(gone.map(m => m.id));
    for (const m of gone) logAudit(req, 'model.delete', { type: 'model', id: m.id, meta: { displayName: m.display_name } });
    staged(req, 'models', { keys: gone.map(m => 'model:' + m.id), removed: gone.map(m => m.id) });
    res.json({ ok: true, count: gone.length });
  });

  app.delete('/api/admin/models/:id', authMiddleware, adminOnly, (req, res) => {
    const m = db.models.byId(req.params.id);
    db.models.removeById(req.params.id);
    logAudit(req, 'model.delete', { type: 'model', id: req.params.id, meta: { displayName: m?.display_name } });
    if (m) staged(req, 'models', { keys: ['model:' + m.id], removed: [m.id] });
    res.json({ ok: true });
  });

  app.get('/api/admin/pricing/preset', authMiddleware, adminOnly, (req, res) => {
    res.json({ preset: matchPreset(req.query.name || '') });
  });
  app.get('/api/admin/pricing/presets', authMiddleware, adminOnly, (req, res) => {
    res.json({ presets: presetList(), custom: getCustomPresets() });
  });
  app.post('/api/admin/pricing/presets', authMiddleware, adminOnly, (req, res) => {
    const b = req.body || {};
    const match = String(b.match || '').trim();
    const ci = Number(b.in), co = Number(b.out);
    if (!match || !Number.isFinite(ci) || !Number.isFinite(co) || ci < 0 || co < 0) return res.status(400).json({ error: 'Provide a model name fragment and non-negative input/output prices.' });
    const list = getCustomPresets().filter(p => p.match !== match.toLowerCase());
    list.push({ match, label: String(b.label || match).trim() || match, in: ci, out: co });
    setSetting('custom_presets', list);
    setCustomPresets(list);
    logAudit(req, 'pricing.preset_set', { meta: { match } });
    res.json({ custom: getCustomPresets() });
  });
  app.delete('/api/admin/pricing/presets/:match', authMiddleware, adminOnly, (req, res) => {
    const target = decodeURIComponent(req.params.match).toLowerCase();
    const list = getCustomPresets().filter(p => p.match !== target);
    setSetting('custom_presets', list);
    setCustomPresets(list);
    logAudit(req, 'pricing.preset_delete', { meta: { match: target } });
    res.json({ custom: getCustomPresets() });
  });

  app.get('/api/admin/detect-ctx', authMiddleware, adminOnly, async (req, res) => {
    const internal = req.query.model || '';
    const prov = req.query.provider ? resolveProvider(req.query.provider) : getProviders()[0];
    const numCtx = await detectContextLength(prov, internal);
    res.json({ numCtx, ok: !!numCtx });
  });

  app.get('/api/admin/models/folders', authMiddleware, adminOnly, (req, res) => {
    res.json({ folders: sanitizeFolders(getSetting('model_folders', [])) });
  });

  app.put('/api/admin/models/folders', authMiddleware, adminOnly, (req, res) => {
    const folders = sanitizeFolders(req.body?.folders);
    setSetting('model_folders', folders);
    logAudit(req, 'model.folders', { meta: { count: folders.length } });
    staged(req, 'folders', { folders });
    res.json({ folders });
  });

  app.post('/api/admin/models/folders/add', authMiddleware, adminOnly, (req, res) => {
    const have = sanitizeFolders(getSetting('model_folders', []));
    const folders = sanitizeFolders([...have, ...(Array.isArray(req.body?.folders) ? req.body.folders : [])]);
    if (folders.length !== have.length) {
      setSetting('model_folders', folders);
      staged(req, 'folders', { folders });
    }
    res.json({ folders });
  });

  app.post('/api/admin/models/reorder', authMiddleware, adminOnly, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    tx(() => ids.forEach((id, i) => db.models.update(id, { sort_order: i })));
    staged(req, 'models', { keys: ['models:order'], order: ids.filter(id => typeof id === 'string') });
    res.json({ ok: true });
  });
}