import { draftGet } from './draft.js';
import { DEFAULT_SAFETY_PROMPT } from './safety.js';
import { autoTitleDefault } from './autotitle.js';
import { keyHint } from './secrets.js';

const domainList = (v) => JSON.stringify([...new Set(
  String(v ?? '').slice(0, 20000)
    .split(/[\n,]+/)
    .map(s => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase())
    .filter(Boolean)
)].slice(0, 200));

export const SETTING_FIELDS = {
  __proto__: null,
  apiBaseUrl: { key: 'api_base_url', text: 500, trim: true },
  apiKey: { key: 'api_key', text: 500, secret: true },
  webSearchEnabled: { key: 'web_search_enabled', bool: true },
  webSearchEngine: { key: 'web_search_engine', text: 40, trim: true, fallback: 'searxng' },
  searxngUrl: { key: 'searxng_url', text: 500, trim: true },
  webSearchCount: { key: 'web_search_count', int: [1, 20], def: 5 },
  webSearchDomains: { key: 'web_search_domains', map: domainList },
  uploadLimitAdminMb: { key: 'upload_limit_mb_admin', num: [0, 4096], def: 8 },
  uploadLimitUserMb: { key: 'upload_limit_mb_user', num: [0, 4096], def: 8 },
  sandboxLimitAdminMb: { key: 'sandbox_limit_mb_admin', num: [0, 1048576], def: 1024 },
  sandboxLimitUserMb: { key: 'sandbox_limit_mb_user', num: [0, 1048576], def: 256 },
  modelQueue: { key: 'model_queue', bool: true },
  membankEnabled: { key: 'membank_enabled', bool: true },
  membankHideTools: { key: 'membank_hide_tools', bool: true },
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
  voiceSttKey: { key: 'voice_stt_key', text: 500, trim: true, secret: true },
  voiceSttModel: { key: 'voice_stt_model', text: 120, trim: true, fallback: 'whisper-1' },
  voiceTtsEngine: { key: 'voice_tts_engine', enum: ['browser', 'server'], def: 'browser' },
  voiceTtsUrl: { key: 'voice_tts_url', text: 500, trim: true },
  voiceTtsKey: { key: 'voice_tts_key', text: 500, trim: true, secret: true },
  voiceTtsModel: { key: 'voice_tts_model', text: 120, trim: true, fallback: 'tts-1' },
  voiceTtsVoice: { key: 'voice_tts_voice', text: 120, trim: true },
  voiceTtsSpeed: { key: 'voice_tts_speed', num: [0.25, 4], def: 1 },
  safetyEnabled: { key: 'safety_enabled', bool: true },
  safetyModelMode: { key: 'safety_model_mode', enum: ['current', 'specific'], def: 'current' },
  safetyModelId: { key: 'safety_model_id', text: 64, trim: true },
  safetyPrompt: { key: 'safety_prompt', text: 24000, fallback: DEFAULT_SAFETY_PROMPT },
  safetyVerbose: { key: 'safety_verbose', bool: true },
  safetyReasonEnabled: { key: 'safety_reason_enabled', bool: true },
  chatSearchEnabled: { key: 'chat_search_enabled', bool: true },
  autoTitleEnabled: { key: 'auto_title_enabled', bool: true },
  autoTitleModelMode: { key: 'auto_title_model_mode', enum: ['current', 'specific'], def: 'current' },
  autoTitleModelId: { key: 'auto_title_model_id', text: 64, trim: true }
};

export const CONFIG_KEYS = [
  'app_name', 'disclaimer', 'support_contact', 'greetings', 'quick_prompts', 'allow_signups', 'local_only',
  'egress_local_only', 'egress_allow_websearch', 'egress_allowlist', 'model_docs_enabled', 'model_docs_config',
  'app_icon', 'app_font', 'ui_preset'
];

export const STAGED_KEYS = [...new Set([...Object.values(SETTING_FIELDS).map(s => s.key), ...CONFIG_KEYS])];

export const SECRET_KEYS = new Set(Object.values(SETTING_FIELDS).filter(s => s.secret).map(s => s.key));

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

const SECRET_FIELDS = Object.entries(SETTING_FIELDS).filter(([, s]) => s.secret).map(([name]) => name);

export function maskSecrets(values) {
  const out = { ...values };
  for (const name of SECRET_FIELDS) {
    if (!(name in out)) continue;
    const v = out[name];
    out[name] = '';
    out[name + 'Saved'] = !!v;
    out[name + 'Hint'] = keyHint(v);
  }
  return out;
}

export function adminSettings() {
  return maskSecrets({
    apiBaseUrl: draftGet('api_base_url'), apiKey: draftGet('api_key'),
    uploadLimitAdminMb: Number(draftGet('upload_limit_mb_admin', 8)) || 0,
    uploadLimitUserMb: Number(draftGet('upload_limit_mb_user', 8)) || 0,
    sandboxLimitAdminMb: Number(draftGet('sandbox_limit_mb_admin', 1024)) || 0,
    sandboxLimitUserMb: Number(draftGet('sandbox_limit_mb_user', 256)) || 0,
    modelQueue: draftGet('model_queue', '0') === '1',
    membankEnabled: draftGet('membank_enabled', '0') === '1',
    membankHideTools: draftGet('membank_hide_tools', '0') === '1',
    webSearchEnabled: draftGet('web_search_enabled', '0') === '1',
    webSearchEngine: draftGet('web_search_engine', 'searxng'),
    searxngUrl: draftGet('searxng_url', ''),
    webSearchCount: parseInt(draftGet('web_search_count', '5')) || 5,
    webSearchDomains: (() => { try { const d = JSON.parse(draftGet('web_search_domains', '[]')); return Array.isArray(d) ? d.join('\n') : ''; } catch { return ''; } })(),
    budgetUser: Number(draftGet('budget_user', 0)) || 0,
    budgetAdmin: Number(draftGet('budget_admin', 0)) || 0,
    budgetWarnFraction: Number(draftGet('budget_warn_fraction', 0.8)) || 0.8,
    budgetEnforce: draftGet('budget_enforce', '0') === '1',
    sessionTtlDays: Number(draftGet('session_ttl_days', 30)) || 30,
    maxSessions: Number(draftGet('max_sessions', 0)) || 0,
    voiceMicEnabled: draftGet('voice_mic_enabled', '0') === '1',
    voiceCallEnabled: draftGet('voice_call_enabled', '0') === '1',
    voiceSttEngine: draftGet('voice_stt_engine', 'browser'),
    voiceSttUrl: draftGet('voice_stt_url', ''),
    voiceSttKey: draftGet('voice_stt_key', ''),
    voiceSttModel: draftGet('voice_stt_model', 'whisper-1'),
    voiceTtsEngine: draftGet('voice_tts_engine', 'browser'),
    voiceTtsUrl: draftGet('voice_tts_url', ''),
    voiceTtsKey: draftGet('voice_tts_key', ''),
    voiceTtsModel: draftGet('voice_tts_model', 'tts-1'),
    voiceTtsVoice: draftGet('voice_tts_voice', 'alloy'),
    voiceTtsSpeed: Number(draftGet('voice_tts_speed', 1)) || 1,
    safetyEnabled: draftGet('safety_enabled', '0') === '1',
    safetyModelMode: draftGet('safety_model_mode', 'current') === 'specific' ? 'specific' : 'current',
    safetyModelId: draftGet('safety_model_id', ''),
    safetyPrompt: draftGet('safety_prompt', DEFAULT_SAFETY_PROMPT),
    safetyVerbose: draftGet('safety_verbose', '1') === '1',
    safetyReasonEnabled: draftGet('safety_reason_enabled', '0') === '1',
    chatSearchEnabled: draftGet('chat_search_enabled', '0') === '1',
    autoTitleEnabled: draftGet('auto_title_enabled', autoTitleDefault()) === '1',
    autoTitleModelMode: draftGet('auto_title_model_mode', 'current') === 'specific' ? 'specific' : 'current',
    autoTitleModelId: draftGet('auto_title_model_id', '')
  });
}
