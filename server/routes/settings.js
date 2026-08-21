import { db, uid, getSetting, setSetting } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { oneShot } from '../llm/index.js';
import { PROVIDER_TYPES, getProviders, typesForClient, isProviderType } from '../providers.js';
import { llamaEngine } from '../lib/llamacpp.js';
import * as membank from '../membank.js';
import * as websearch from '../websearch.js';
import { logAudit } from '../lib/audit.js';
import { roleLimit } from '../lib/models.js';
import { DEFAULT_MEMORY_PROMPT } from '../lib/memory.js';
import { DEFAULT_SAFETY_PROMPT, SAFETY_REASON_SUFFIX, resolveSafetyModel, parseSafetyVerdict } from '../lib/safety.js';
import { broadcastAdminConfig } from '../lib/ws/index.js';

const domainList = (v) => JSON.stringify([...new Set(
  String(v ?? '').slice(0, 20000)
    .split(/[\n,]+/)
    .map(s => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase())
    .filter(Boolean)
)].slice(0, 200));

export const SETTING_FIELDS = {
  __proto__: null,
  apiBaseUrl: { key: 'api_base_url', text: 500, trim: true },
  apiKey: { key: 'api_key', text: 500 },
  webSearchEnabled: { key: 'web_search_enabled', bool: true },
  webSearchEngine: { key: 'web_search_engine', text: 40, trim: true, fallback: 'searxng' },
  searxngUrl: { key: 'searxng_url', text: 500, trim: true },
  webSearchCount: { key: 'web_search_count', int: [1, 20], def: 5 },
  webSearchDomains: { key: 'web_search_domains', map: domainList },
  webSearchPrompt: { key: 'web_search_prompt', text: 16000 },
  uploadLimitAdminMb: { key: 'upload_limit_mb_admin', num: [0, 4096], def: 8 },
  uploadLimitUserMb: { key: 'upload_limit_mb_user', num: [0, 4096], def: 8 },
  sandboxLimitAdminMb: { key: 'sandbox_limit_mb_admin', num: [0, 1048576], def: 1024 },
  sandboxLimitUserMb: { key: 'sandbox_limit_mb_user', num: [0, 1048576], def: 256 },
  modelQueue: { key: 'model_queue', bool: true },
  membankEnabled: { key: 'membank_enabled', bool: true },
  membankHideTools: { key: 'membank_hide_tools', bool: true },
  membankPrompt: { key: 'membank_prompt', text: 16000 },
  budgetUser: { key: 'budget_user', num: [0, 1e9], def: 0 },
  budgetAdmin: { key: 'budget_admin', num: [0, 1e9], def: 0 },
  budgetWarnFraction: { key: 'budget_warn_fraction', num: [0.1, 0.99], def: 0.8 },
  budgetEnforce: { key: 'budget_enforce', bool: true },
  sessionTtlDays: { key: 'session_ttl_days', int: [1, 365], def: 30 },
  maxSessions: { key: 'max_sessions', int: [0, 50], def: 0 },
  voiceMicEnabled: { key: 'voice_mic_enabled', bool: true },
  voiceCallEnabled: { key: 'voice_call_enabled', bool: true },
  voiceSttEngine: { key: 'voice_stt_engine', enum: ['browser', 'server'], def: 'browser' },
  voiceSttUrl: { key: 'voice_stt_url', text: 500, trim: true },
  voiceSttKey: { key: 'voice_stt_key', text: 500, trim: true },
  voiceSttModel: { key: 'voice_stt_model', text: 120, trim: true, fallback: 'whisper-1' },
  voiceTtsEngine: { key: 'voice_tts_engine', enum: ['browser', 'server'], def: 'browser' },
  voiceTtsUrl: { key: 'voice_tts_url', text: 500, trim: true },
  voiceTtsKey: { key: 'voice_tts_key', text: 500, trim: true },
  voiceTtsModel: { key: 'voice_tts_model', text: 120, trim: true, fallback: 'tts-1' },
  voiceTtsVoice: { key: 'voice_tts_voice', text: 120, trim: true },
  voiceTtsSpeed: { key: 'voice_tts_speed', num: [0.25, 4], def: 1 },
  safetyEnabled: { key: 'safety_enabled', bool: true },
  safetyModelMode: { key: 'safety_model_mode', enum: ['current', 'specific'], def: 'current' },
  safetyModelId: { key: 'safety_model_id', text: 64, trim: true },
  safetyPrompt: { key: 'safety_prompt', text: 24000, fallback: DEFAULT_SAFETY_PROMPT },
  safetyVerbose: { key: 'safety_verbose', bool: true },
  safetyReasonEnabled: { key: 'safety_reason_enabled', bool: true },
  memoryEnabled: { key: 'memory_enabled', bool: true },
  memoryPrompt: { key: 'memory_prompt', text: 24000, fallback: DEFAULT_MEMORY_PROMPT },
  chatSearchEnabled: { key: 'chat_search_enabled', bool: true }
};

export function coerceSetting(spec, raw) {
  if (spec.map) return spec.map(raw);
  if (spec.bool) return raw ? '1' : '0';
  if (spec.enum) return spec.enum.includes(raw) ? raw : spec.def;
  if (spec.int || spec.num) {
    const [min, max] = spec.int || spec.num;
    const n = spec.int ? parseInt(raw, 10) : Number(raw);
    return String(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : spec.def);
  }
  let v = String(raw ?? '').slice(0, spec.text);
  if (spec.trim) v = v.trim();
  return v || (spec.fallback ?? '');
}

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

  app.get('/api/admin/settings', authMiddleware, adminOnly, (req, res) =>
    res.json({
      apiBaseUrl: getSetting('api_base_url'), apiKey: getSetting('api_key'),
      uploadLimitAdminMb: roleLimit('upload_limit_mb', true, 8),
      uploadLimitUserMb: roleLimit('upload_limit_mb', false, 8),
      sandboxLimitAdminMb: roleLimit('sandbox_limit_mb', true, 1024),
      sandboxLimitUserMb: roleLimit('sandbox_limit_mb', false, 256),
      modelQueue: getSetting('model_queue', '0') === '1',
      membankEnabled: getSetting('membank_enabled', '0') === '1',
      membankHideTools: getSetting('membank_hide_tools', '0') === '1',
      membankPrompt: getSetting('membank_prompt', membank.DEFAULT_PROMPT),
      webSearchEnabled: getSetting('web_search_enabled', '0') === '1',
      webSearchEngine: getSetting('web_search_engine', 'searxng'),
      searxngUrl: getSetting('searxng_url', ''),
      webSearchCount: parseInt(getSetting('web_search_count', '5')) || 5,
      webSearchDomains: (() => { try { const d = JSON.parse(getSetting('web_search_domains', '[]')); return Array.isArray(d) ? d.join('\n') : ''; } catch { return ''; } })(),
      webSearchPrompt: getSetting('web_search_prompt', websearch.DEFAULT_WS_PROMPT),
      budgetUser: Number(getSetting('budget_user', 0)) || 0,
      budgetAdmin: Number(getSetting('budget_admin', 0)) || 0,
      budgetWarnFraction: Number(getSetting('budget_warn_fraction', 0.8)) || 0.8,
      budgetEnforce: getSetting('budget_enforce', '0') === '1',
      sessionTtlDays: Number(getSetting('session_ttl_days', 30)) || 30,
      maxSessions: Number(getSetting('max_sessions', 0)) || 0,
      voiceMicEnabled: getSetting('voice_mic_enabled', '0') === '1',
      voiceCallEnabled: getSetting('voice_call_enabled', '0') === '1',
      voiceSttEngine: getSetting('voice_stt_engine', 'browser'),
      voiceSttUrl: getSetting('voice_stt_url', ''),
      voiceSttKey: getSetting('voice_stt_key', ''),
      voiceSttModel: getSetting('voice_stt_model', 'whisper-1'),
      voiceTtsEngine: getSetting('voice_tts_engine', 'browser'),
      voiceTtsUrl: getSetting('voice_tts_url', ''),
      voiceTtsKey: getSetting('voice_tts_key', ''),
      voiceTtsModel: getSetting('voice_tts_model', 'tts-1'),
      voiceTtsVoice: getSetting('voice_tts_voice', 'alloy'),
      voiceTtsSpeed: Number(getSetting('voice_tts_speed', 1)) || 1,
      safetyEnabled: getSetting('safety_enabled', '0') === '1',
      safetyModelMode: getSetting('safety_model_mode', 'current') === 'specific' ? 'specific' : 'current',
      safetyModelId: getSetting('safety_model_id', ''),
      safetyPrompt: getSetting('safety_prompt', DEFAULT_SAFETY_PROMPT),
      safetyVerbose: getSetting('safety_verbose', '1') === '1',
      safetyReasonEnabled: getSetting('safety_reason_enabled', '0') === '1',
      memoryEnabled: getSetting('memory_enabled', '0') === '1',
      memoryPrompt: getSetting('memory_prompt', DEFAULT_MEMORY_PROMPT),
      chatSearchEnabled: getSetting('chat_search_enabled', '0') === '1'
    }));

  app.patch('/api/admin/settings', authMiddleware, adminOnly, (req, res) => {
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const applied = [];
    for (const field of Object.keys(b)) {
      const spec = SETTING_FIELDS[field];
      if (!spec) continue;
      setSetting(spec.key, coerceSetting(spec, b[field]));
      applied.push(field);
    }
    logAudit(req, 'settings.update', { meta: { fields: applied } });
    res.json({ ok: true });
  });

  app.get('/api/admin/provider-types', authMiddleware, adminOnly, (req, res) => res.json(typesForClient()));
  app.get('/api/admin/providers', authMiddleware, adminOnly, (req, res) => res.json({ providers: getProviders(), types: typesForClient() }));

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
    res.json({ id: prov.id });
  });
  app.patch('/api/admin/providers/:id', authMiddleware, adminOnly, (req, res) => {
    const b = req.body || {};
    const list = getProviders().slice();
    const i = list.findIndex(p => p.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'not found' });
    const p = { ...list[i] };
    if ('name' in b) p.name = String(b.name || '').trim().slice(0, 120) || p.name;
    if ('type' in b && isProviderType(b.type)) p.type = b.type;
    if (!isProviderType(p.type)) p.type = 'lmstudio';
    if ('base_url' in b) p.base_url = String(b.base_url || '').trim().slice(0, 500) || PROVIDER_TYPES[p.type].defaultBaseUrl;
    if ('api_key' in b) p.api_key = String(b.api_key || '').slice(0, 500);
    list[i] = p;
    setSetting('providers', list);
    logAudit(req, 'provider.update', { type: 'provider', id: p.id, meta: { name: p.name } });
    res.json({ ok: true });
  });
  app.delete('/api/admin/providers/:id', authMiddleware, adminOnly, (req, res) => {
    const list = getProviders();
    if (list.length <= 1) return res.status(400).json({ error: 'At least one provider is required.' });
    const next = list.filter(p => p.id !== req.params.id);
    const fallback = next[0].id;
    for (const m of db.models.all()) if (m.provider_id === req.params.id) db.models.update(m.id, { provider_id: fallback });
    setSetting('providers', next);
    logAudit(req, 'provider.delete', { type: 'provider', id: req.params.id });
    broadcastAdminConfig();
    res.json({ ok: true });
  });
}
