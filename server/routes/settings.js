import { db, uid, getSetting, setSetting } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { oneShot } from '../llm/index.js';
import { PROVIDER_TYPES, getProviders, typesForClient, isProviderType, publicProvider } from '../lib/providers.js';
import { llamaEngine } from '../lib/llamacpp.js';
import { logAudit } from '../lib/audit.js';
import { draftGet, draftSet } from '../lib/draft.js';
import { DEFAULT_SAFETY_PROMPT, SAFETY_REASON_SUFFIX, resolveSafetyModel, parseSafetyVerdict } from '../lib/safety.js';
import { draftFeatures, syncAllModels } from '../lib/systemprompt.js';
import { SETTING_FIELDS, coerceSetting, adminSettings } from '../lib/settingfields.js';
import { staged } from '../lib/releases.js';

export default function registerSettingsRoutes(app) {
  app.post('/api/safety-check', authMiddleware, async (req, res) => {
    if (getSetting('safety_enabled', '0') !== '1') return res.json({ allowed: true });
    const text = String(req.body?.text || '').slice(0, 32000);
    if (!text.trim()) return res.json({ allowed: true });
    const model = resolveSafetyModel(String(req.body?.modelId || ''), !!req.user.is_admin);
    if (!model) return res.json({ allowed: true });
    let sys = getSetting('safety_prompt', DEFAULT_SAFETY_PROMPT) || DEFAULT_SAFETY_PROMPT;
    const wantReason = getSetting('safety_reason_enabled', '0') === '1';
    if (wantReason) sys = sys.replace(/\s+$/, '') + '\n' + SAFETY_REASON_SUFFIX;
    try {
      const raw = await oneShot(model, [{ role: 'system', content: sys }, { role: 'user', content: text }]);
      if (!raw) return res.json({ allowed: true });
      const r = parseSafetyVerdict(model, raw);
      if (r.allowed) return res.json({ allowed: true });
      try {
        db.feedback.insert({
          id: uid(), ts: Date.now(), user_id: req.user.id, kind: 'safety',
          model_id: model.id || null, snippet: text.slice(0, 400), comment: r.reason || '', rating: 0
        });
      } catch {}
      res.json({ allowed: false, reason: wantReason ? r.reason : '' });
    } catch {
      res.json({ allowed: true });
    }
  });

  app.get('/api/admin/settings', authMiddleware, adminOnly, (req, res) => res.json(adminSettings()));

  app.patch('/api/admin/settings', authMiddleware, adminOnly, (req, res) => {
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const applied = [];
    const keys = [];
    const before = draftFeatures();
    const was = adminSettings();
    for (const field of Object.keys(b)) {
      const spec = SETTING_FIELDS[field];
      if (!spec) continue;
      const value = coerceSetting(spec, b[field]);
      if (JSON.stringify(draftGet(spec.key, null)) === JSON.stringify(value)) continue;
      draftSet(spec.key, value);
      applied.push(field);
      keys.push('setting:' + spec.key);
    }
    if (!applied.length) return res.json({ ok: true });
    const after = draftFeatures();
    const synced = Object.keys(after).some(k => after[k] !== before[k]) ? syncAllModels(before, after) : [];
    const now = adminSettings();
    const values = Object.fromEntries(Object.keys(now).filter(k => JSON.stringify(now[k]) !== JSON.stringify(was[k])).map(k => [k, now[k]]));
    logAudit(req, 'settings.stage', { meta: { fields: applied } });
    staged(req, 'settings', { keys: [...keys, ...synced.map(id => `model:${id}:system_prompt`)], values });
    if (synced.length) staged(req, 'models', { rows: synced.map(id => db.models.byId(id)).filter(Boolean) });
    res.json({ ok: true });
  });

  app.post('/api/admin/setup-complete', authMiddleware, adminOnly, (req, res) => {
    const done = req.body?.done === false ? '0' : '1';
    setSetting('setup_complete', done);
    logAudit(req, done === '1' ? 'setup.complete' : 'setup.replay');
    res.json({ ok: true });
  });

  app.get('/api/admin/provider-types', authMiddleware, adminOnly, (req, res) => res.json(typesForClient()));
  app.get('/api/admin/providers', authMiddleware, adminOnly, (req, res) => res.json({ providers: getProviders().map(publicProvider), types: typesForClient() }));

  app.get('/api/admin/providers/:id/engine', authMiddleware, adminOnly, async (req, res) => {
    const prov = getProviders().find(p => p.id === req.params.id);
    if (!prov) return res.status(404).json({ error: 'not found' });
    if (prov.type !== 'llamacpp') return res.status(400).json({ error: 'Only llama.cpp servers report engine details.' });
    try {
      const info = await llamaEngine(prov);
      if (!info || !info.ok) return res.status(502).json({ error: 'The server did not answer.' });
      res.json(info);
    } catch (e) { res.status(502).json({ error: String(e.message || e).slice(0, 200) }); }
  });
  app.post('/api/admin/providers', authMiddleware, adminOnly, (req, res) => {
    const b = req.body || {};
    const type = isProviderType(b.type) ? b.type : 'lmstudio';
    const prov = { id: uid(), name: String(b.name || PROVIDER_TYPES[type].label).trim().slice(0, 120), type, base_url: String(b.base_url || '').trim().slice(0, 500) || PROVIDER_TYPES[type].defaultBaseUrl, api_key: String(b.api_key || '').slice(0, 500) };
    setSetting('providers', [...getProviders(), prov]);
    logAudit(req, 'provider.create', { type: 'provider', id: prov.id, meta: { name: prov.name, type: prov.type } });
    staged(req, 'providers');
    res.json({ id: prov.id });
  });
  app.patch('/api/admin/providers/:id', authMiddleware, adminOnly, (req, res) => {
    const b = req.body || {};
    const list = getProviders().slice();
    const i = list.findIndex(p => p.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'not found' });
    const p = { ...list[i] };
    if ('name' in b) p.name = String(b.name || '').trim().slice(0, 120) || p.name;
    const was = p.type;
    if ('type' in b && isProviderType(b.type)) p.type = b.type;
    if (!isProviderType(p.type)) p.type = 'lmstudio';
    if (p.type !== was && !('base_url' in b) && (!p.base_url || p.base_url === PROVIDER_TYPES[was]?.defaultBaseUrl)) p.base_url = PROVIDER_TYPES[p.type].defaultBaseUrl;
    if ('base_url' in b) p.base_url = String(b.base_url || '').trim().slice(0, 500) || PROVIDER_TYPES[p.type].defaultBaseUrl;
    if ('api_key' in b) p.api_key = String(b.api_key || '').slice(0, 500);
    list[i] = p;
    setSetting('providers', list);
    logAudit(req, 'provider.update', { type: 'provider', id: p.id, meta: { name: p.name } });
    staged(req, 'providers');
    res.json({ ok: true });
  });
  app.delete('/api/admin/providers/:id', authMiddleware, adminOnly, (req, res) => {
    const list = getProviders();
    if (list.length <= 1) return res.status(400).json({ error: 'At least one provider is required.' });
    const next = list.filter(p => p.id !== req.params.id);
    const fallback = next[0].id;
    const moved = db.models.all().filter(m => m.provider_id === req.params.id).map(m => m.id);
    for (const id of moved) db.models.update(id, { provider_id: fallback });
    setSetting('providers', next);
    logAudit(req, 'provider.delete', { type: 'provider', id: req.params.id });
    staged(req, 'providers');
    if (moved.length) staged(req, 'models', { keys: moved.map(id => `model:${id}:provider_id`), rows: moved.map(id => db.models.byId(id)) });
    res.json({ ok: true });
  });
}