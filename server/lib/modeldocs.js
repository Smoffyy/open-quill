const text = (v, cap) => String(v ?? '').slice(0, cap);
const slug = (v, cap) => text(v, cap).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

export const DOCS_DEFAULTS = {
  title: 'Models overview',
  intro: 'Every model available on this workspace. Compare the current lineup, find the id each one runs under, and open a model for its full specification.',
  links: [],
  compareTitle: 'Compare models',
  compareIntro: 'If you are unsure which model to use, start with the default. Each model\'s page lists everything it supports.',
  navLabel: 'Models',
  overviewLabel: 'Models overview',
  specTitle: 'Specifications',
  featureLabel: 'Feature',
  outro: '',
  tilesTitle: 'Get started',
  tiles: [],
  sections: []
};

function sanitizeLinks(raw, cap) {
  return (Array.isArray(raw) ? raw : []).slice(0, cap).map(l => ({
    label: text(l?.label, 60).trim(),
    url: text(l?.url, 500).trim(),
    ext: !!l?.ext
  })).filter(l => l.label);
}

function sanitizePages(raw, section) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).slice(0, 40).map((p, i) => {
    let id = slug(p?.id, 60) || slug(p?.title, 60) || `page-${i + 1}`;
    while (seen.has(id)) id += '-1';
    seen.add(id);
    return {
      id,
      section,
      title: text(p?.title, 120).trim() || 'Untitled',
      subtitle: text(p?.subtitle, 400).trim(),
      body: text(p?.body, 40000)
    };
  });
}

export function sanitizeDocsConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const sections = (Array.isArray(c.sections) ? c.sections : []).slice(0, 12).map((s, i) => {
    let id = slug(s?.id, 60) || slug(s?.label, 60) || `section-${i + 1}`;
    while (seen.has(id)) id += '-1';
    seen.add(id);
    return { id, label: text(s?.label, 60).trim() || 'Section', pages: sanitizePages(s?.pages, id) };
  });
  return {
    title: text(c.title, 120).trim() || DOCS_DEFAULTS.title,
    intro: text(c.intro, 2000),
    links: sanitizeLinks(c.links, 8),
    compareTitle: text(c.compareTitle, 120).trim() || DOCS_DEFAULTS.compareTitle,
    compareIntro: text(c.compareIntro, 2000),
    navLabel: text(c.navLabel, 60).trim() || DOCS_DEFAULTS.navLabel,
    overviewLabel: text(c.overviewLabel, 60).trim() || DOCS_DEFAULTS.overviewLabel,
    specTitle: text(c.specTitle, 60).trim() || DOCS_DEFAULTS.specTitle,
    featureLabel: text(c.featureLabel, 60).trim() || DOCS_DEFAULTS.featureLabel,
    outro: text(c.outro, 40000),
    tilesTitle: text(c.tilesTitle, 120).trim() || DOCS_DEFAULTS.tilesTitle,
    tiles: sanitizeCards(c.tiles, 12),
    sections
  };
}

export function readDocsConfig(read) {
  const raw = read('model_docs_config', null);
  if (raw == null) return DOCS_DEFAULTS;
  let parsed = raw;
  if (typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch { return DOCS_DEFAULTS; } }
  return sanitizeDocsConfig(parsed);
}

export const DOCS_MODEL_STR = [
  'docs_cutoff', 'docs_body', 'docs_image', 'docs_icon', 'docs_badge', 'docs_group', 'docs_summary',
  'docs_latency', 'docs_thinking', 'docs_effort', 'docs_train_cutoff', 'docs_status', 'docs_released',
  'docs_retired', 'docs_price_batch', 'docs_notes', 'docs_notice', 'docs_notice_action', 'docs_notice_url',
  'docs_action_label', 'docs_params', 'docs_params_active'
];
export const DOCS_MODEL_BOOL = [
  'docs_featured', 'docs_hidden', 'docs_in_text', 'docs_in_image', 'docs_in_audio', 'docs_in_video',
  'docs_out_text', 'docs_out_image', 'docs_out_audio', 'docs_out_video'
];
export const DOCS_MODEL_INT = ['docs_intelligence', 'docs_speed', 'docs_max_output'];
export const DOCS_MODEL_FLOAT = ['docs_price_cache_write', 'docs_price_cache_read'];

export const DOCS_BADGES = new Set(['', 'latest', 'legacy', 'preview', 'new']);

export function sanitizePairs(raw, cap = 12) {
  return (Array.isArray(raw) ? raw : []).slice(0, cap).map(p => ({
    label: text(p?.label, 60).trim(),
    value: text(p?.value, 200).trim()
  })).filter(p => p.label || p.value);
}

export function sanitizeCards(raw, cap = 12) {
  return (Array.isArray(raw) ? raw : []).slice(0, cap).map(p => ({
    title: text(p?.title, 80).trim(),
    desc: text(p?.desc, 300).trim(),
    url: text(p?.url, 500).trim()
  })).filter(p => p.title);
}

export function sanitizeDocsLinks(raw, cap = 8) {
  return sanitizeLinks(raw, cap);
}

const INTEL_LABELS = ['', 'Low', 'Fair', 'Medium', 'High', 'Highest'];
const SPEED_LABELS = ['', 'Slow', 'Steady', 'Medium', 'Fast', 'Fastest'];
const BADGE_LABELS = { __proto__: null, latest: 'Latest', legacy: 'Legacy', preview: 'Preview', new: 'New' };
const MODALITIES = [['text', 'Text'], ['image', 'Images'], ['audio', 'Audio'], ['video', 'Video']];

function tokensText(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  const short = v >= 1000000 ? Number((v / 1000000).toFixed(1)) + 'M' : v >= 1000 ? Number((v / 1000).toFixed(1)) + 'K' : String(v);
  return short + ' tokens';
}

function priceText(v) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return '';
  return '$' + (Number.isInteger(n) ? n : Number(n.toFixed(4))) + ' per million tokens';
}

function modalitiesText(m, dir) {
  const on = (k) => (k === 'text' ? m[`docs_${dir}_text`] !== 0 : !!m[`docs_${dir}_${k}`] || (dir === 'in' && k === 'image' && !!m.has_vision));
  return MODALITIES.filter(([k]) => on(k)).map(([, label]) => label).join(', ');
}

export function paramSize(v) {
  const s = str(String(v ?? '')).replace(/^a(?=\d)/i, '').replace(/\s+/g, '').toUpperCase();
  if (!s) return '';
  const m = s.match(/^(\d*\.?\d+)([BT]?)$/);
  if (!m) return s;
  const b = Number(m[1]) * (m[2] === 'T' ? 1000 : 1);
  const trim = (x) => String(Math.round(x * 100) / 100);
  return b >= 1000 ? trim(b / 1000) + 'T' : trim(b) + 'B';
}

const paramBillions = (s) => {
  const m = /^(\d*\.?\d+)([BT])$/.exec(s);
  return m ? Number(m[1]) * (m[2] === 'T' ? 1000 : 1) : null;
};

export function paramParts(total, active) {
  const t = paramSize(total);
  let a = paramSize(active);
  const tb = paramBillions(t);
  const ab = paramBillions(a);
  if (tb != null && ab != null && ab >= tb) a = '';
  return { t, a };
}

export function paramsText(total, active) {
  const { t, a } = paramParts(total, active);
  if (!t) return '';
  return a ? `${t} A${a}` : t;
}

function sizeText({ t, a }) {
  if (!t) return '';
  return a ? `${t} parameters, ${a} active per token (mixture-of-experts)` : `${t} parameters`;
}

const level = (labels, n) => labels[Math.max(0, Math.min(5, Number(n) || 0))] || '';
const pairs = (raw) => (Array.isArray(raw) ? raw : []).filter(p => p && p.value);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

export function docsVars(m) {
  if (!m) return {};
  const ids = pairs(m.docs_ids);
  const size = paramParts(m.docs_params, m.docs_params_active);
  return {
    modelId: ids[0]?.value || '',
    modelIds: ids.map(p => (p.label ? `${p.label}: ${p.value}` : p.value)).join('\n'),
    modelDescription: str(m.description),
    modelSummary: str(m.docs_summary),
    modelAbout: str(m.docs_body),
    modelBadge: BADGE_LABELS[m.docs_badge] || '',
    modelGroup: str(m.docs_group),
    modelNotice: str(m.docs_notice),
    modelNotes: String(m.docs_notes || '').split('\n').map(s => s.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean).map(s => '- ' + s).join('\n'),
    modelParameterSummary: sizeText(size),
    modelParameters: size.t,
    modelActiveParameters: size.a,
    modelContextWindow: tokensText(m.num_ctx),
    modelMaxOutput: tokensText(m.docs_max_output),
    modelThinking: str(m.docs_thinking) || (m.has_reasoning ? 'Supported' : ''),
    modelEffort: str(m.docs_effort),
    modelLatency: str(m.docs_latency),
    modelInput: modalitiesText(m, 'in'),
    modelOutput: modalitiesText(m, 'out'),
    modelKnowledgeCutoff: str(m.docs_cutoff),
    modelTrainingCutoff: str(m.docs_train_cutoff),
    modelIntelligence: level(INTEL_LABELS, m.docs_intelligence),
    modelSpeed: level(SPEED_LABELS, m.docs_speed),
    modelPriceInput: priceText(m.cost_in),
    modelPriceOutput: priceText(m.cost_out),
    modelPriceCacheWrite: priceText(m.docs_price_cache_write),
    modelPriceCacheRead: priceText(m.docs_price_cache_read),
    modelPriceBatch: str(m.docs_price_batch),
    modelStatus: str(m.docs_status),
    modelReleased: str(m.docs_released),
    modelRetirement: str(m.docs_retired),
    modelPlatforms: (Array.isArray(m.docs_platforms) ? m.docs_platforms : []).filter(Boolean).join(', ')
  };
}

export function sanitizeStrList(raw, cap = 12) {
  return (Array.isArray(raw) ? raw : []).map(s => text(s, 80).trim()).filter(Boolean).slice(0, cap);
}