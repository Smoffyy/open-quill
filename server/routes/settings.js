import { db, uid, getSetting, setSetting } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { oneShot } from '../llm.js';
import { PROVIDER_TYPES, getProviders, typesForClient } from '../providers.js';
import * as membank from '../membank.js';
import * as websearch from '../websearch.js';
import { logAudit } from '../lib/audit.js';
import { roleLimit } from '../lib/models.js';
import { DEFAULT_MEMORY_PROMPT } from '../lib/memory.js';
import { DEFAULT_SAFETY_PROMPT, SAFETY_REASON_SUFFIX, resolveSafetyModel, parseSafetyVerdict } from '../lib/safety.js';
import { broadcastAdminConfig } from '../lib/ws.js';

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
    if ('apiBaseUrl' in req.body) setSetting('api_base_url', req.body.apiBaseUrl);
    if ('apiKey' in req.body) setSetting('api_key', req.body.apiKey);
    if ('webSearchEnabled' in req.body) setSetting('web_search_enabled', req.body.webSearchEnabled ? '1' : '0');
    if ('webSearchEngine' in req.body) setSetting('web_search_engine', req.body.webSearchEngine || 'searxng');
    if ('searxngUrl' in req.body) setSetting('searxng_url', (req.body.searxngUrl || '').trim());
    if ('webSearchCount' in req.body) { const n = parseInt(req.body.webSearchCount); setSetting('web_search_count', String(Number.isFinite(n) && n > 0 ? Math.min(20, n) : 5)); }
    if ('webSearchDomains' in req.body) { const list = String(req.body.webSearchDomains || '').split(/[\n,]+/).map(s => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()).filter(Boolean); setSetting('web_search_domains', JSON.stringify(list)); }
    if ('webSearchPrompt' in req.body) setSetting('web_search_prompt', req.body.webSearchPrompt || '');
    const lim = (k, v, def) => { const n = Number(v); setSetting(k, String(Number.isFinite(n) && n >= 0 ? n : def)); };
    if ('uploadLimitAdminMb' in req.body) lim('upload_limit_mb_admin', req.body.uploadLimitAdminMb, 8);
    if ('uploadLimitUserMb' in req.body) lim('upload_limit_mb_user', req.body.uploadLimitUserMb, 8);
    if ('sandboxLimitAdminMb' in req.body) lim('sandbox_limit_mb_admin', req.body.sandboxLimitAdminMb, 1024);
    if ('sandboxLimitUserMb' in req.body) lim('sandbox_limit_mb_user', req.body.sandboxLimitUserMb, 256);
    if ('modelQueue' in req.body) setSetting('model_queue', req.body.modelQueue ? '1' : '0');
    if ('membankEnabled' in req.body) setSetting('membank_enabled', req.body.membankEnabled ? '1' : '0');
    if ('membankHideTools' in req.body) setSetting('membank_hide_tools', req.body.membankHideTools ? '1' : '0');
    if ('membankPrompt' in req.body) setSetting('membank_prompt', String(req.body.membankPrompt || ''));
    if ('budgetUser' in req.body) lim('budget_user', req.body.budgetUser, 0);
    if ('budgetAdmin' in req.body) lim('budget_admin', req.body.budgetAdmin, 0);
    if ('budgetWarnFraction' in req.body) { const n = Number(req.body.budgetWarnFraction); setSetting('budget_warn_fraction', String(Number.isFinite(n) ? Math.min(0.99, Math.max(0.1, n)) : 0.8)); }
    if ('budgetEnforce' in req.body) setSetting('budget_enforce', req.body.budgetEnforce ? '1' : '0');
    if ('sessionTtlDays' in req.body) { const n = parseInt(req.body.sessionTtlDays); setSetting('session_ttl_days', String(Number.isFinite(n) && n > 0 ? Math.min(365, n) : 30)); }
    if ('maxSessions' in req.body) { const n = parseInt(req.body.maxSessions); setSetting('max_sessions', String(Number.isFinite(n) && n >= 0 ? Math.min(50, n) : 0)); }
    if ('voiceMicEnabled' in req.body) setSetting('voice_mic_enabled', req.body.voiceMicEnabled ? '1' : '0');
    if ('voiceCallEnabled' in req.body) setSetting('voice_call_enabled', req.body.voiceCallEnabled ? '1' : '0');
    if ('voiceSttEngine' in req.body) setSetting('voice_stt_engine', req.body.voiceSttEngine === 'server' ? 'server' : 'browser');
    if ('voiceSttUrl' in req.body) setSetting('voice_stt_url', String(req.body.voiceSttUrl || '').trim());
    if ('voiceSttKey' in req.body) setSetting('voice_stt_key', String(req.body.voiceSttKey || '').trim());
    if ('voiceSttModel' in req.body) setSetting('voice_stt_model', String(req.body.voiceSttModel || '').trim() || 'whisper-1');
    if ('voiceTtsEngine' in req.body) setSetting('voice_tts_engine', req.body.voiceTtsEngine === 'server' ? 'server' : 'browser');
    if ('voiceTtsUrl' in req.body) setSetting('voice_tts_url', String(req.body.voiceTtsUrl || '').trim());
    if ('voiceTtsKey' in req.body) setSetting('voice_tts_key', String(req.body.voiceTtsKey || '').trim());
    if ('voiceTtsModel' in req.body) setSetting('voice_tts_model', String(req.body.voiceTtsModel || '').trim() || 'tts-1');
    if ('voiceTtsVoice' in req.body) setSetting('voice_tts_voice', String(req.body.voiceTtsVoice || '').trim());
    if ('voiceTtsSpeed' in req.body) { const n = Number(req.body.voiceTtsSpeed); setSetting('voice_tts_speed', String(Number.isFinite(n) && n >= 0.25 && n <= 4 ? n : 1)); }
    if ('safetyEnabled' in req.body) setSetting('safety_enabled', req.body.safetyEnabled ? '1' : '0');
    if ('safetyModelMode' in req.body) setSetting('safety_model_mode', req.body.safetyModelMode === 'specific' ? 'specific' : 'current');
    if ('safetyModelId' in req.body) setSetting('safety_model_id', String(req.body.safetyModelId || ''));
    if ('safetyPrompt' in req.body) setSetting('safety_prompt', String(req.body.safetyPrompt || '') || DEFAULT_SAFETY_PROMPT);
    if ('safetyVerbose' in req.body) setSetting('safety_verbose', req.body.safetyVerbose ? '1' : '0');
    if ('safetyReasonEnabled' in req.body) setSetting('safety_reason_enabled', req.body.safetyReasonEnabled ? '1' : '0');
    if ('memoryEnabled' in req.body) setSetting('memory_enabled', req.body.memoryEnabled ? '1' : '0');
    if ('memoryPrompt' in req.body) setSetting('memory_prompt', String(req.body.memoryPrompt || '') || DEFAULT_MEMORY_PROMPT);
    if ('chatSearchEnabled' in req.body) setSetting('chat_search_enabled', req.body.chatSearchEnabled ? '1' : '0');
    logAudit(req, 'settings.update', { meta: { fields: Object.keys(req.body || {}) } });
    res.json({ ok: true });
  });

  app.get('/api/admin/provider-types', authMiddleware, adminOnly, (req, res) => res.json(typesForClient()));
  app.get('/api/admin/providers', authMiddleware, adminOnly, (req, res) => res.json({ providers: getProviders(), types: typesForClient() }));
  app.post('/api/admin/providers', authMiddleware, adminOnly, (req, res) => {
    const b = req.body || {};
    const type = PROVIDER_TYPES[b.type] ? b.type : 'lmstudio';
    const prov = { id: uid(), name: (b.name || PROVIDER_TYPES[type].label).trim(), type, base_url: (b.base_url || '').trim() || PROVIDER_TYPES[type].defaultBaseUrl, api_key: b.api_key || '' };
    setSetting('providers', [...getProviders(), prov]);
    logAudit(req, 'provider.create', { type: 'provider', id: prov.id, meta: { name: prov.name, type: prov.type } });
    res.json({ id: prov.id });
  });
  app.patch('/api/admin/providers/:id', authMiddleware, adminOnly, (req, res) => {
    const b = req.body || {};
    const list = getProviders();
    const i = list.findIndex(p => p.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'not found' });
    const p = { ...list[i] };
    if ('name' in b) p.name = (b.name || '').trim() || p.name;
    if ('type' in b && PROVIDER_TYPES[b.type]) p.type = b.type;
    if ('base_url' in b) p.base_url = (b.base_url || '').trim() || PROVIDER_TYPES[p.type].defaultBaseUrl;
    if ('api_key' in b) p.api_key = b.api_key || '';
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
