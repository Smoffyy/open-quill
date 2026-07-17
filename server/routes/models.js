import { db, uid, now, getSetting, setSetting } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { getProviders, resolveProvider, providerSpec } from '../providers.js';
import { matchPreset, presetList, setCustomPresets, getCustomPresets } from '../pricing.js';
import { logAudit } from '../lib/audit.js';
import { draftModels, publicModels, detectContextLength } from '../lib/models.js';
import { broadcastConfig, broadcastAdminConfig } from '../lib/ws.js';

export default function registerModelRoutes(app) {
  app.get('/api/models', authMiddleware, (req, res) => res.json(req.user.is_admin ? draftModels() : publicModels()));

  app.get('/api/admin/models', authMiddleware, adminOnly, (req, res) =>
    res.json(db.models.all().sort((a, b) => a.sort_order - b.sort_order)));

  app.get('/api/admin/discover-models', authMiddleware, adminOnly, async (req, res) => {
    try {
      const prov = req.query.provider ? resolveProvider(req.query.provider) : getProviders()[0];
      const { spec, base, key } = providerSpec(prov);
      const headers = key ? { Authorization: `Bearer ${key}` } : {};
      let ids = [];
      if (spec.protocol === 'ollama') {
        const r = await fetch(base.replace(/\/v1$/, '') + '/api/tags', { headers });
        if (!r.ok) return res.status(502).json({ error: `Backend returned ${r.status}.` });
        const j = await r.json().catch(() => ({}));
        ids = (Array.isArray(j?.models) ? j.models : []).map(x => x?.name || x?.model).filter(Boolean);
      } else {
        const r = await fetch(base + '/models', { headers });
        if (!r.ok) return res.status(502).json({ error: `Backend returned ${r.status}.` });
        const j = await r.json().catch(() => ({}));
        const raw = Array.isArray(j?.data) ? j.data : (Array.isArray(j?.models) ? j.models : []);
        ids = raw.map(x => (typeof x === 'string' ? x : (x?.id || x?.name))).filter(Boolean);
      }
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
      internal_name: b.internal_name || 'local-model', system_prompt: b.system_prompt || '',
      call_prompt: b.call_prompt || '',
      provider_id: b.provider_id || (getProviders()[0]?.id || null), max_tokens: parseInt(b.max_tokens) || null,
      has_reasoning: b.has_reasoning ? 1 : 0, reasoning_token: b.reasoning_token || '', non_reasoning_token: b.non_reasoning_token || '',
      effort_enabled: b.effort_enabled ? 1 : 0, effort_levels: Array.isArray(b.effort_levels) && b.effort_levels.length ? b.effort_levels : ['low', 'medium', 'high'], effort_default: b.effort_default || 'medium', effort_kwarg: b.effort_kwarg || 'reasoning_effort', effort_admin_only: b.effort_admin_only ? 1 : 0, hide_thinking: b.hide_thinking ? 1 : 0,
      reasoning_collapsible: b.reasoning_collapsible === false ? 0 : 1, icon_size: parseInt(b.icon_size) || (getSetting('ui_preset', '') === 'openai' ? 28 : 0),
      show_name: 'show_name' in b ? (b.show_name ? 1 : 0) : (getSetting('ui_preset', '') === 'openai' ? 1 : 0),
      generating_anim: b.generating_anim || (getSetting('ui_preset', '') === 'openai' ? 'none' : ''),
      thinking_anim: b.thinking_anim || (getSetting('ui_preset', '') === 'openai' ? 'none' : ''),
      has_vision: b.has_vision ? 1 : 0,
      think_open: b.think_open || '', think_close: b.think_close || '',
      sandbox_auto: b.sandbox_auto ? 1 : 0, sandbox_allowed: b.sandbox_allowed === false ? 0 : 1, dropdown_icon: 'dropdown_icon' in b ? (b.dropdown_icon === false ? 0 : 1) : (getSetting('ui_preset', '') === 'openai' ? 0 : 1), is_default: 0, agent_steps: Number.isInteger(b.agent_steps) ? Math.max(0, b.agent_steps) : 0,
      web_search_auto: b.web_search_auto ? 1 : 0, web_search_allowed: b.web_search_allowed === false ? 0 : 1,
      skills_allowed: b.skills_allowed ? 1 : 0, mcp_allowed: b.mcp_allowed ? 1 : 0, chat_search_allowed: b.chat_search_allowed ? 1 : 0,
      end_chat_allowed: b.end_chat_allowed ? 1 : 0, end_chat_prompt: String(b.end_chat_prompt || ''), long_convo_reminder: b.long_convo_reminder ? 1 : 0,
      enable_summaries: b.enable_summaries ? 1 : 0, num_ctx: parseInt(b.num_ctx) || 0, summary_padding: typeof b.summary_padding === "number" ? b.summary_padding : 0.125, recent_window: parseInt(b.recent_window) > 0 ? parseInt(b.recent_window) : 4,
      in_more_models: b.in_more_models ? 1 : 0, more_models_label: b.more_models_label || 'More models',
      unavailable: b.unavailable ? 1 : 0, unavailable_reason: b.unavailable_reason || '',
      bg_enabled: b.bg_enabled ? 1 : 0, bg_image: b.bg_image || '',
      cap_vision: b.cap_vision ? 1 : 0, cap_reasoning: b.cap_reasoning ? 1 : 0, cap_text: b.cap_text ? 1 : 0, cap_compact: b.cap_compact ? 1 : 0,
      static_icon: b.static_icon || '', generating_icon: b.generating_icon || '', thinking_icon: b.thinking_icon || '',
      icon_position: b.icon_position || (getSetting('ui_preset', '') === 'openai' ? 'left' : 'below'),
      temperature: null, top_p: null, presence_penalty: null, frequency_penalty: null, repetition_penalty: null, min_p: null, top_k: null, seed: null,
      cost_in: preset ? preset.in : null, cost_out: preset ? preset.out : null,
      sort_order: max + 1, enabled: 1
    });
    logAudit(req, 'model.create', { type: 'model', id: m.id, meta: { displayName: m.display_name, internalName: m.internal_name } });
    broadcastAdminConfig();
    res.json({ id: m.id });
  });

  app.patch('/api/admin/models/:id', authMiddleware, adminOnly, (req, res) => {
    const cur = db.models.byId(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const str = ['display_name', 'description', 'internal_name', 'system_prompt', 'call_prompt', 'end_chat_prompt', 'reasoning_token', 'non_reasoning_token', 'more_models_label', 'static_icon', 'generating_icon', 'thinking_icon', 'icon_position', 'think_open', 'think_close', 'generating_anim', 'thinking_anim', 'unavailable_reason', 'provider_id', 'bg_image', 'effort_kwarg', 'effort_default'];
    const bool = ['has_reasoning', 'has_vision', 'in_more_models', 'enabled', 'sandbox_auto', 'sandbox_allowed', 'dropdown_icon', 'is_default', 'enable_summaries', 'unavailable', 'cap_vision', 'cap_reasoning', 'cap_text', 'cap_compact', 'reasoning_collapsible', 'bg_enabled', 'web_search_auto', 'web_search_allowed', 'show_name', 'skills_allowed', 'mcp_allowed', 'chat_search_allowed', 'end_chat_allowed', 'long_convo_reminder', 'effort_enabled', 'effort_admin_only', 'hide_thinking'];
    const patch = {};
    for (const k of str) if (k in req.body) patch[k] = req.body[k];
    for (const k of bool) if (k in req.body) patch[k] = req.body[k] ? 1 : 0;
    if ('effort_levels' in req.body) {
      const arr = Array.isArray(req.body.effort_levels) ? req.body.effort_levels : String(req.body.effort_levels || '').split(',');
      const clean = arr.map(s => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 8);
      patch.effort_levels = clean.length ? clean : ['low', 'medium', 'high'];
    }
    if ('agent_steps' in req.body) patch.agent_steps = Math.max(0, parseInt(req.body.agent_steps) || 0);
    if ('num_ctx' in req.body) patch.num_ctx = Math.max(0, parseInt(req.body.num_ctx) || 0);
    if ('recent_window' in req.body) patch.recent_window = Math.max(1, parseInt(req.body.recent_window) || 4);
    if ('icon_size' in req.body) patch.icon_size = Math.max(0, Math.min(80, parseInt(req.body.icon_size) || 0));
    if ('summary_padding' in req.body) patch.summary_padding = Math.max(0.03, Math.min(0.6, parseFloat(req.body.summary_padding) || 0.125));
    const numF = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'min_p', 'cost_in', 'cost_out'];
    const numI = ['top_k', 'seed', 'max_tokens'];
    for (const k of numF) if (k in req.body) { const v = req.body[k]; patch[k] = (v === '' || v == null || isNaN(Number(v))) ? null : Number(v); }
    for (const k of numI) if (k in req.body) { const v = req.body[k]; patch[k] = (v === '' || v == null || isNaN(parseInt(v))) ? null : parseInt(v); }
    if ('internal_name' in patch && !('cost_in' in req.body) && !('cost_out' in req.body) && cur.cost_in == null && cur.cost_out == null) {
      const preset = matchPreset(patch.internal_name);
      if (preset) { patch.cost_in = preset.in; patch.cost_out = preset.out; }
    }
    // only one model can be the login default
    if (patch.is_default === 1) for (const other of db.models.all()) if (other.id !== cur.id && other.is_default) db.models.update(other.id, { is_default: 0 });
    db.models.update(cur.id, patch);
    logAudit(req, 'model.update', { type: 'model', id: cur.id, meta: { fields: Object.keys(patch) } });
    broadcastAdminConfig();
    res.json({ ok: true });
  });

  app.delete('/api/admin/models/:id', authMiddleware, adminOnly, (req, res) => {
    const m = db.models.byId(req.params.id);
    db.models.remove(x => x.id === req.params.id);
    logAudit(req, 'model.delete', { type: 'model', id: req.params.id, meta: { displayName: m?.display_name } });
    broadcastAdminConfig();
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

  app.post('/api/admin/models/reorder', authMiddleware, adminOnly, (req, res) => {
    (req.body.ids || []).forEach((id, i) => db.models.update(id, { sort_order: i }));
    broadcastAdminConfig();
    res.json({ ok: true });
  });

  // publish the current draft (full model rows) to all clients
  app.post('/api/admin/models/publish', authMiddleware, adminOnly, (req, res) => {
    const snapshot = db.models.all().map(m => ({ ...m }));
    setSetting('published_models', snapshot);
    setSetting('published_at', now());
    logAudit(req, 'models.publish', { meta: { count: snapshot.length } });
    broadcastConfig();
    res.json({ ok: true, count: snapshot.length, publishedAt: getSetting('published_at') });
  });

  // has the draft diverged from what is published?
  app.get('/api/admin/models/publish-state', authMiddleware, adminOnly, (req, res) => {
    const snap = getSetting('published_models', null);
    const draft = db.models.all().map(m => ({ ...m }));
    const dirty = JSON.stringify(snap) !== JSON.stringify(snap === null ? null : draft);
    res.json({ published: Array.isArray(snap), dirty: snap === null ? true : dirty, publishedAt: getSetting('published_at', null) });
  });
}
