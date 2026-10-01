import { FLAGS, flagOn } from './modelcatalog.js';

export const AREAS = ['models', 'workspace', 'interface'];

export const SETTING_SECTIONS = {
  __proto__: null,
  api_base_url: 'providers', api_key: 'providers',
  web_search_enabled: 'search', web_search_engine: 'search', searxng_url: 'search', web_search_count: 'search', web_search_domains: 'search',
  upload_limit_mb_admin: 'quotas', upload_limit_mb_user: 'quotas', sandbox_limit_mb_admin: 'quotas', sandbox_limit_mb_user: 'quotas',
  model_queue: 'quotas', budget_user: 'quotas', budget_admin: 'quotas', budget_warn_fraction: 'quotas', budget_enforce: 'quotas',
  session_ttl_days: 'quotas', max_sessions: 'quotas', auto_title_enabled: 'quotas', auto_title_model_mode: 'quotas', auto_title_model_id: 'quotas',
  membank_enabled: 'files', membank_hide_tools: 'files',
  voice_mic_enabled: 'voice', voice_call_enabled: 'voice', voice_stt_engine: 'voice', voice_stt_url: 'voice', voice_stt_key: 'voice',
  voice_stt_model: 'voice', voice_tts_engine: 'voice', voice_tts_url: 'voice', voice_tts_key: 'voice', voice_tts_model: 'voice',
  voice_tts_voice: 'voice', voice_tts_speed: 'voice',
  safety_enabled: 'guardrails', safety_model_mode: 'guardrails', safety_model_id: 'guardrails', safety_prompt: 'guardrails',
  safety_verbose: 'guardrails', safety_reason_enabled: 'guardrails',
  chat_search_enabled: 'history',
  allow_signups: 'members',
  local_only: 'network', egress_local_only: 'network', egress_allow_websearch: 'network', egress_allowlist: 'network',
  greetings: 'launcher', quick_prompts: 'launcher',
  app_name: 'interface', disclaimer: 'interface', support_contact: 'interface', model_docs_enabled: 'interface',
  model_docs_config: 'interface', app_icon: 'interface', app_font: 'interface', ui_preset: 'interface'
};

const INTERFACE_SECTIONS = new Set(['interface', 'launcher']);

const BOOL_SETTINGS = new Set([
  'web_search_enabled', 'model_queue', 'membank_enabled', 'membank_hide_tools', 'budget_enforce', 'voice_mic_enabled',
  'voice_call_enabled', 'safety_enabled', 'safety_verbose', 'safety_reason_enabled', 'chat_search_enabled', 'auto_title_enabled',
  'allow_signups', 'local_only', 'egress_local_only', 'egress_allow_websearch', 'model_docs_enabled'
]);

const LIST_SETTINGS = new Set(['greetings', 'quick_prompts', 'web_search_domains', 'egress_allowlist']);

const SHORT_TEXT = 80;
const DIFF_CELLS = 250000;

export const sectionOf = (c) => (c.scope === 'model' ? 'models' : c.scope === 'theme' ? 'interface' : SETTING_SECTIONS[c.target] || 'overview');

export function areaOf(c) {
  if (c.scope === 'model') return 'models';
  if (c.scope === 'theme') return 'interface';
  return INTERFACE_SECTIONS.has(sectionOf(c)) ? 'interface' : 'workspace';
}

export function groupKeyOf(c) {
  if (c.scope === 'model') return c.target ? 'model:' + c.target : 'models:order';
  if (c.scope === 'theme') return c.key === 'themes:active' ? 'themes' : 'theme:' + c.target;
  return 'section:' + sectionOf(c);
}

export function groupChanges(changes) {
  const groups = new Map();
  for (const c of changes) {
    const key = groupKeyOf(c);
    if (!groups.has(key)) groups.set(key, { key, area: areaOf(c), section: sectionOf(c), label: c.scope === 'setting' ? '' : c.label || '', items: [] });
    groups.get(key).items.push(c);
  }
  return AREAS
    .map(area => ({ area, groups: [...groups.values()].filter(g => g.area === area) }))
    .filter(a => a.groups.length);
}

export const isMine = (c, userId) => !!userId && (c.authors || []).some(a => a.id === userId);

export const othersIn = (changes, userId) => {
  const names = new Map();
  for (const c of changes) for (const a of c.authors || []) if (a.id !== userId) names.set(a.id, a.name);
  return [...names.values()];
};

function itemText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.label === 'string') return v.label;
  return JSON.stringify(v);
}

export function valueOf(c, side) {
  const raw = side === 'before' ? c.before : c.after;
  if (c.secret) return { kind: 'hidden' };
  if (c.scope === 'model' && FLAGS.has(c.field)) return { kind: 'flag', on: flagOn({ [c.field]: raw }, c.field) };
  if (c.scope === 'setting' && BOOL_SETTINGS.has(c.target)) return { kind: 'flag', on: raw === '1' || raw === true };
  if (raw == null || raw === '') return { kind: 'empty' };
  let v = raw;
  if (c.scope === 'setting' && LIST_SETTINGS.has(c.target) && typeof v === 'string') {
    try { v = JSON.parse(v); } catch {}
  }
  if (Array.isArray(v)) return v.length ? { kind: 'list', items: v.map(itemText) } : { kind: 'empty' };
  if (typeof v === 'object') return { kind: 'long', text: JSON.stringify(v, null, 2) };
  const text = String(v);
  return text.length > SHORT_TEXT || text.includes('\n') ? { kind: 'long', text } : { kind: 'text', text };
}

export function lineDiff(a, b) {
  const x = String(a ?? '').split('\n');
  const y = String(b ?? '').split('\n');
  if (x.length * y.length > DIFF_CELLS) {
    return [...x.map(text => ({ op: 'del', text })), ...y.map(text => ({ op: 'add', text }))];
  }
  const w = y.length + 1;
  const lcs = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { out.push({ op: 'same', text: x[i] }); i++; j++; }
    else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) out.push({ op: 'del', text: x[i++] });
    else out.push({ op: 'add', text: y[j++] });
  }
  while (i < x.length) out.push({ op: 'del', text: x[i++] });
  while (j < y.length) out.push({ op: 'add', text: y[j++] });
  return out;
}
