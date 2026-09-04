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

export function docsConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    ...DOCS_DEFAULTS,
    ...c,
    links: Array.isArray(c.links) ? c.links : [],
    tiles: Array.isArray(c.tiles) ? c.tiles : [],
    sections: (Array.isArray(c.sections) ? c.sections : []).map(s => ({
      id: String(s?.id || ''),
      label: String(s?.label || ''),
      pages: (Array.isArray(s?.pages) ? s.pages : []).map(p => ({
        id: String(p?.id || ''),
        title: String(p?.title || ''),
        subtitle: String(p?.subtitle || ''),
        body: String(p?.body || '')
      }))
    }))
  };
}

export function docsModels(models) {
  return (Array.isArray(models) ? models : []).filter(m => m && !m.removed && !m.docsHidden && m.kind !== 'router');
}

export function docsTree(models, cfg) {
  const list = docsModels(models);
  const top = [];
  const groups = [];
  const byLabel = new Map();
  for (const m of list) {
    const label = String(m.docsGroup || '').trim();
    if (!label) { top.push(m); continue; }
    if (!byLabel.has(label)) {
      const g = { id: 'g:' + label, label, models: [] };
      byLabel.set(label, g);
      groups.push(g);
    }
    byLabel.get(label).models.push(m);
  }
  return {
    overviewLabel: cfg.overviewLabel,
    models: { label: cfg.navLabel, top, groups },
    sections: cfg.sections.filter(s => s.pages.length > 0)
  };
}

export function parseDocsPath(pathname) {
  const p = String(pathname || '');
  const m = p.match(/^\/docs\/m\/(.+)$/);
  if (m) return { kind: 'model', id: decodeSafe(m[1]) };
  const g = p.match(/^\/docs\/p\/(.+)$/);
  if (g) return { kind: 'page', id: decodeSafe(g[1]) };
  return { kind: 'overview', id: null };
}

export function docsPath(target) {
  if (!target || target.kind === 'overview') return '/docs';
  return '/docs/' + (target.kind === 'model' ? 'm' : 'p') + '/' + encodeURIComponent(target.id);
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function fmtTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1000000) return trimZero(v / 1000000) + 'M';
  if (v >= 1000) return trimZero(v / 1000) + 'K';
  return String(v);
}

function trimZero(n) {
  const r = Math.round(n * 10) / 10;
  return String(Number.isInteger(r) ? r : r.toFixed(1));
}

export function fmtPrice(v) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return '$' + n;
  return '$' + String(Number(n.toFixed(4)));
}

export function priceRange(m) {
  const a = fmtPrice(m.priceIn), b = fmtPrice(m.priceOut);
  if (a && b) return a + ' / ' + b;
  return a || b || '';
}

export function publicModelId(m) {
  const first = (Array.isArray(m.docsIds) ? m.docsIds : []).find(x => x && x.value);
  return first ? first.value : '';
}

export function docsSearch(tree, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const hit = (s) => String(s || '').toLowerCase().includes(q);
  return {
    overviewLabel: tree.overviewLabel,
    models: {
      ...tree.models,
      top: tree.models.top.filter(m => hit(m.displayName) || hit(m.description)),
      groups: tree.models.groups
        .map(g => ({ ...g, models: g.models.filter(m => hit(m.displayName) || hit(m.description) || hit(g.label)) }))
        .filter(g => g.models.length > 0)
    },
    sections: tree.sections
      .map(s => ({ ...s, pages: s.pages.filter(p => hit(p.title) || hit(p.subtitle) || hit(s.label)) }))
      .filter(s => s.pages.length > 0)
  };
}

export function modalityLabel(mods, labels) {
  const keys = ['text', 'image', 'audio', 'video'].filter(k => mods && mods[k]);
  return keys.map(k => labels[k]).join(', ');
}

export function bulletLines(text) {
  return String(text || '').split('\n').map(s => s.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean);
}

export const DOCS_MODEL_FIELDS = {
  description: 'description',
  numCtx: 'num_ctx',
  priceIn: 'cost_in',
  priceOut: 'cost_out',
  docsFeatured: 'docs_featured',
  docsHidden: 'docs_hidden',
  docsBadge: 'docs_badge',
  docsGroup: 'docs_group',
  docsSummary: 'docs_summary',
  docsBody: 'docs_body',
  docsNotes: 'docs_notes',
  docsLatency: 'docs_latency',
  docsThinking: 'docs_thinking',
  docsEffort: 'docs_effort',
  docsCutoff: 'docs_cutoff',
  docsTrainCutoff: 'docs_train_cutoff',
  docsStatus: 'docs_status',
  docsReleased: 'docs_released',
  docsRetired: 'docs_retired',
  docsMaxOutput: 'docs_max_output',
  docsPriceCacheWrite: 'docs_price_cache_write',
  docsPriceCacheRead: 'docs_price_cache_read',
  docsPriceBatch: 'docs_price_batch',
  docsIds: 'docs_ids',
  docsPlatforms: 'docs_platforms',
  docsLinks: 'docs_links',
  docsResources: 'docs_resources',
  docsReference: 'docs_reference',
  docsNotice: 'docs_notice',
  docsNoticeAction: 'docs_notice_action',
  docsNoticeUrl: 'docs_notice_url',
  docsActionLabel: 'docs_action_label',
  docsIntelligence: 'docs_intelligence',
  docsSpeed: 'docs_speed'
};

const BOOL_FIELDS = new Set(['docs_featured', 'docs_hidden']);
const NUM_FIELDS = new Set(['num_ctx', 'cost_in', 'cost_out', 'docs_max_output', 'docs_price_cache_write', 'docs_price_cache_read', 'docs_intelligence', 'docs_speed']);

export function docsModelPatch(draft) {
  const patch = {};
  for (const [camel, snake] of Object.entries(DOCS_MODEL_FIELDS)) {
    let v = draft[camel];
    if (v === undefined) continue;
    if (BOOL_FIELDS.has(snake)) v = v ? 1 : 0;
    else if (NUM_FIELDS.has(snake)) v = (v === '' || v == null) ? null : Number(v);
    patch[snake] = v;
  }
  for (const dir of ['In', 'Out']) {
    const mods = draft['docs' + dir] || {};
    for (const k of ['text', 'image', 'audio', 'video']) patch['docs_' + dir.toLowerCase() + '_' + k] = mods[k] ? 1 : 0;
  }
  return patch;
}

export const DOCS_BADGE_OPTIONS = [
  ['', 'No badge'],
  ['latest', 'Latest'],
  ['new', 'New'],
  ['preview', 'Preview'],
  ['legacy', 'Legacy']
];

export function parseTokens(v) {
  const s = String(v ?? '').trim().toUpperCase().replace(/\s+|,/g, '');
  if (!s) return null;
  const m = s.match(/^([0-9]*\.?[0-9]+)([KM]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * (m[2] === 'M' ? 1000000 : m[2] === 'K' ? 1000 : 1));
}

export function parseMoney(v) {
  const s = String(v ?? '').trim().replace(/^\$/, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
