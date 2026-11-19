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

const PROVIDERS = 'admin.providers';
const TOOLS = 'admin.tools';
const POLICY = 'admin.policy';

export const SETTING_FIELDS = {
  __proto__: null,
  apiBaseUrl: { key: 'api_base_url', text: 500, trim: true, perm: PROVIDERS },
  apiKey: { key: 'api_key', text: 500, secret: true, perm: PROVIDERS },
  webSearchEnabled: { key: 'web_search_enabled', bool: true, perm: TOOLS },
  webSearchEngine: { key: 'web_search_engine', text: 40, trim: true, fallback: 'searxng', perm: TOOLS },
  searxngUrl: { key: 'searxng_url', text: 500, trim: true, perm: TOOLS },
  webSearchCount: { key: 'web_search_count', int: [1, 20], def: 5, perm: TOOLS },
  webSearchDomains: { key: 'web_search_domains', map: domainList, perm: TOOLS },
  uploadLimitAdminMb: { key: 'upload_limit_mb_admin', num: [0, 4096], def: 8, perm: POLICY },
  uploadLimitUserMb: { key: 'upload_limit_mb_user', num: [0, 4096], def: 8, perm: POLICY },
  sandboxLimitAdminMb: { key: 'sandbox_limit_mb_admin', num: [0, 1048576], def: 1024, perm: POLICY },
  sandboxLimitUserMb: { key: 'sandbox_limit_mb_user', num: [0, 1048576], def: 256, perm: POLICY },
  modelQueue: { key: 'model_queue', bool: true, perm: POLICY },
  membankEnabled: { key: 'membank_enabled', bool: true, perm: TOOLS },
  membankHideTools: { key: 'membank_hide_tools', bool: true, perm: TOOLS },
  budgetUser: { key: 'budget_user', num: [0, 1e9], def: 0, perm: POLICY },
  budgetAdmin: { key: 'budget_admin', num: [0, 1e9], def: 0, perm: POLICY },
  budgetWarnFraction: { key: 'budget_warn_fraction', num: [0.1, 0.99], def: 0.8, perm: POLICY },
  budgetEnforce: { key: 'budget_enforce', bool: true, perm: POLICY },
  sessionTtlDays: { key: 'session_ttl_days', int: [1, 365], def: 30, perm: POLICY },
  maxSessions: { key: 'max_sessions', int: [0, 50], def: 0, perm: POLICY },
  voiceMicEnabled: { key: 'voice_mic_enabled', bool: true, perm: TOOLS },
  voiceCallEnabled: { key: 'voice_call_enabled', bool: true, perm: TOOLS },
  voiceSttEngine: { key: 'voice_stt_engine', enum: ['browser', 'server'], def: 'browser', perm: TOOLS },
  voiceSttUrl: { key: 'voice_stt_url', text: 500, trim: true, perm: TOOLS },
  voiceSttKey: { key: 'voice_stt_key', text: 500, trim: true, secret: true, perm: TOOLS },
  voiceSttModel: { key: 'voice_stt_model', text: 120, trim: true, fallback: 'whisper-1', perm: TOOLS },
  voiceTtsEngine: { key: 'voice_tts_engine', enum: ['browser', 'server'], def: 'browser', perm: TOOLS },
  voiceTtsUrl: { key: 'voice_tts_url', text: 500, trim: true, perm: TOOLS },
  voiceTtsKey: { key: 'voice_tts_key', text: 500, trim: true, secret: true, perm: TOOLS },
  voiceTtsModel: { key: 'voice_tts_model', text: 120, trim: true, fallback: 'tts-1', perm: TOOLS },
  voiceTtsVoice: { key: 'voice_tts_voice', text: 120, trim: true, perm: TOOLS },
  voiceTtsSpeed: { key: 'voice_tts_speed', num: [0.25, 4], def: 1, perm: TOOLS },
  safetyEnabled: { key: 'safety_enabled', bool: true, perm: POLICY },
  safetyModelMode: { key: 'safety_model_mode', enum: ['current', 'specific'], def: 'current', perm: POLICY },
  safetyModelId: { key: 'safety_model_id', text: 64, trim: true, perm: POLICY },
  safetyPrompt: { key: 'safety_prompt', text: 24000, fallback: DEFAULT_SAFETY_PROMPT, perm: POLICY },
  safetyVerbose: { key: 'safety_verbose', bool: true, perm: POLICY },
  safetyReasonEnabled: { key: 'safety_reason_enabled', bool: true, perm: POLICY },
  chatSearchEnabled: { key: 'chat_search_enabled', bool: true, perm: TOOLS },
  autoTitleEnabled: { key: 'auto_title_enabled', bool: true, perm: POLICY },
  autoTitleModelMode: { key: 'auto_title_model_mode', enum: ['current', 'specific'], def: 'current', perm: POLICY },
  autoTitleModelId: { key: 'auto_title_model_id', text: 64, trim: true, perm: POLICY }
};

export const CONFIG_KEYS = [
  'app_name', 'disclaimer', 'support_contact', 'greetings', 'quick_prompts', 'local_only',
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