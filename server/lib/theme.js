import { getSetting, setSetting } from '../db.js';
import { draftGet, draftSet } from './draft.js';

export const THEME_SCHEMA = 1;

const STORE_KEY = 'ui_theme_store';
const MAX_THEMES = 40;
const MAX_HISTORY = 20;
const MAX_ELEMENTS = 400;
const MAX_PROPS = 60;
const MAX_SLOT_NODES = 40;
const MAX_CSS = 20000;
const MAX_TOKEN_GROUPS = 20;

// The builder writes plain declarations; anything that could break out of a rule
// or reach off-origin is dropped at the boundary rather than at render time.
const VALUE_BAD = /[<>{};@]|url\s*\(|expression\s*\(|javascript:|import|behaviou?r\s*:/i;
const ID_OK = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

// Every style key the generated stylesheet is allowed to emit. Keeping the list
// here as well as in the client means a hand-crafted import cannot smuggle a
// property the builder itself would never produce.
export const STYLE_PROPS = new Set([
  'display', 'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'overflow', 'overflowX', 'overflowY',
  'width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight', 'aspectRatio',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf', 'gap', 'rowGap', 'columnGap',
  'flexGrow', 'flexShrink', 'flexBasis', 'order',
  'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'placeItems',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
  'textTransform', 'textAlign', 'textDecoration', 'whiteSpace', 'color',
  'background', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundClip',
  'border', 'borderWidth', 'borderStyle', 'borderColor', 'borderRadius',
  'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'boxShadow', 'textShadow', 'opacity', 'filter', 'backdropFilter', 'mixBlendMode',
  'transform', 'transformOrigin', 'transition', 'animation', 'cursor', 'visibility',
  'outline', 'outlineOffset', 'objectFit', 'isolation', 'contentVisibility'
]);

export const STATE_KEYS = new Set(['hover', 'active', 'focus', 'disabled', 'selected']);
export const BREAKPOINTS = new Set(['tablet', 'mobile']);
export const PRESET_IDS = new Set(['anthropic', 'openai']);

const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);
const clean = (v, n) => { const s = str(v, n).trim(); return !s || VALUE_BAD.test(s) ? '' : s; };

function sanitizeStyle(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = { __proto__: null };
  let n = 0;
  for (const key of Object.keys(raw)) {
    if (n >= MAX_PROPS) break;
    if (!STYLE_PROPS.has(key)) continue;
    const v = clean(raw[key], 240);
    if (!v) continue;
    out[key] = v;
    n++;
  }
  return { ...out };
}

function sanitizeContent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = { __proto__: null };
  let n = 0;
  for (const key of Object.keys(raw)) {
    if (n >= MAX_PROPS || !ID_OK.test(key)) break;
    const v = str(raw[key], 600);
    if (!v.trim()) continue;
    out[key] = v;
    n++;
  }
  return { ...out };
}

function sanitizeElement(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const el = {};
  if (raw.hidden) el.hidden = true;
  if (Number.isFinite(Number(raw.order))) el.order = Math.max(-999, Math.min(999, Math.trunc(Number(raw.order))));
  const style = sanitizeStyle(raw.style);
  if (Object.keys(style).length) el.style = style;
  const content = sanitizeContent(raw.content);
  if (Object.keys(content).length) el.content = content;
  if (raw.icon && typeof raw.icon === 'object') {
    const name = clean(raw.icon.name, 40);
    if (name) el.icon = { name };
  }
  if (raw.states && typeof raw.states === 'object') {
    const states = {};
    for (const k of Object.keys(raw.states)) {
      if (!STATE_KEYS.has(k)) continue;
      const s = sanitizeStyle(raw.states[k]);
      if (Object.keys(s).length) states[k] = s;
    }
    if (Object.keys(states).length) el.states = states;
  }
  if (raw.responsive && typeof raw.responsive === 'object') {
    const bp = {};
    for (const k of Object.keys(raw.responsive)) {
      if (!BREAKPOINTS.has(k)) continue;
      const entry = raw.responsive[k] || {};
      const s = sanitizeStyle(entry.style);
      const one = {};
      if (Object.keys(s).length) one.style = s;
      if (entry.hidden) one.hidden = true;
      if (Object.keys(one).length) bp[k] = one;
    }
    if (Object.keys(bp).length) el.responsive = bp;
  }
  if (raw.animation && typeof raw.animation === 'object') {
    const name = clean(raw.animation.name, 40);
    if (name && name !== 'none') {
      el.animation = {
        name,
        duration: Math.max(0, Math.min(5000, Number(raw.animation.duration) || 0)),
        delay: Math.max(0, Math.min(5000, Number(raw.animation.delay) || 0)),
        easing: clean(raw.animation.easing, 60) || 'ease'
      };
    }
  }
  return Object.keys(el).length ? el : null;
}

function sanitizeSlots(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const slot of Object.keys(raw)) {
    if (!ID_OK.test(slot)) continue;
    const list = Array.isArray(raw[slot]) ? raw[slot] : [];
    const nodes = [];
    for (const node of list.slice(0, MAX_SLOT_NODES)) {
      if (!node || typeof node !== 'object') continue;
      const id = clean(node.id, 60);
      const type = clean(node.type, 40);
      if (!id || !type) continue;
      nodes.push({ id, type, props: sanitizeContent(node.props), style: sanitizeStyle(node.style) });
    }
    if (nodes.length) out[slot] = nodes;
  }
  return out;
}

// A token group this file does not recognise is kept rather than dropped: the
// client's registry decides what actually renders, and stripping here would mean
// an older server could not hold a theme a newer client wrote. The count is
// capped instead, so "kept" never means "unbounded".
function sanitizeTokens(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const group of Object.keys(raw)) {
    if (Object.keys(out).length >= MAX_TOKEN_GROUPS) break;
    if (!ID_OK.test(group)) continue;
    const vals = raw[group];
    if (!vals || typeof vals !== 'object' || Array.isArray(vals)) continue;
    const g = {};
    let n = 0;
    for (const key of Object.keys(vals)) {
      if (n >= MAX_PROPS || !ID_OK.test(key)) continue;
      const v = clean(vals[key], 200);
      if (!v) continue;
      g[key] = v;
      n++;
    }
    if (Object.keys(g).length) out[group] = g;
  }
  return out;
}

export function sanitizeDoc(raw) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const elements = {};
  const rawEls = d.elements && typeof d.elements === 'object' && !Array.isArray(d.elements) ? d.elements : {};
  let n = 0;
  for (const id of Object.keys(rawEls)) {
    if (n >= MAX_ELEMENTS || !ID_OK.test(id)) continue;
    const el = sanitizeElement(rawEls[id]);
    if (!el) continue;
    elements[id] = el;
    n++;
  }
  const css = str(d.css, MAX_CSS).replace(/<\/?\s*(script|style)/gi, '');
  return {
    v: THEME_SCHEMA,
    basePreset: PRESET_IDS.has(d.basePreset) ? d.basePreset : 'anthropic',
    tokens: sanitizeTokens(d.tokens),
    content: sanitizeContent(d.content),
    elements,
    slots: sanitizeSlots(d.slots),
    css: VALUE_BAD.test(css.replace(/[{};@]/g, '')) ? '' : css
  };
}

export function emptyDoc(basePreset = 'anthropic') {
  return { v: THEME_SCHEMA, basePreset: PRESET_IDS.has(basePreset) ? basePreset : 'anthropic', tokens: {}, content: {}, elements: {}, slots: {}, css: '' };
}

/* The Blank layout: the plain preset with its decoration turned down. Square
   corners, no shadows, one sans family, flat controls. Every value is a variable
   or a keyword rather than a literal colour, so a member's theme, palette and
   font choices all keep working on top of it. That is the whole point of it
   being a starting layout rather than a skin. */
const BLANK_STYLE = {
  greeting: { fontFamily: 'var(--font-sans)', fontSize: '28px', fontWeight: '600', letterSpacing: 'normal' },
  brand: { fontFamily: 'var(--font-sans)', fontSize: '17px', fontWeight: '600', letterSpacing: 'normal' },
  sidebar: { borderRight: '1px solid var(--border)' },
  navItem: { borderRadius: 'var(--oq-radius-sm)' },
  chatRow: { borderRadius: 'var(--oq-radius-sm)' },
  composer: { borderRadius: 'var(--oq-radius-md)', border: '1px solid var(--border)', boxShadow: 'none' },
  quickPrompt: { borderRadius: 'var(--oq-radius-sm)' },
  userBubble: { borderRadius: 'var(--oq-radius-md)' },
  msgAvatar: { borderRadius: 'var(--oq-radius-sm)' },
  codeWrap: { borderRadius: 'var(--oq-radius-sm)' },
  modal: { borderRadius: 'var(--oq-radius-md)', boxShadow: 'none' },
  toast: { borderRadius: 'var(--oq-radius-sm)', boxShadow: 'none' },
  button: { borderRadius: 'var(--oq-radius-sm)' },
  iconBtn: { borderRadius: 'var(--oq-radius-sm)' },
  sendBtn: { borderRadius: 'var(--oq-radius-sm)' },
  plusBtn: { borderRadius: 'var(--oq-radius-sm)' },
  modelTrigger: { borderRadius: 'var(--oq-radius-sm)' }
};

export function blankLayoutDoc() {
  return sanitizeDoc({
    basePreset: 'anthropic',
    tokens: {
      font: { display: 'var(--font-sans)' },
      radius: { base: '6px', sm: '4px', md: '6px', lg: '8px' },
      shadow: { popover: 'none' }
    },
    elements: Object.fromEntries(Object.entries(BLANK_STYLE).map(([id, style]) => [id, { style }]))
  });
}

// What "reset to the preset" restores. A builtin goes back to the layout it
// shipped with; anything else goes back to nothing on top of its base preset.
/* How many settings actually differ between two documents. The builder needs
   this to say "3 unpublished changes" honestly: counting everything a theme
   sets would report a number even when nothing has moved since the last
   publish. */
export function docDiffCount(a, b) {
  let n = 0;
  const walk = (x, y) => {
    const keys = new Set([...Object.keys(x || {}), ...Object.keys(y || {})]);
    for (const k of keys) {
      const av = x ? x[k] : undefined;
      const bv = y ? y[k] : undefined;
      // A whole branch that only one side has still counts leaf by leaf: adding
      // six properties to an element is six changes, not one.
      const objish = (v) => v === undefined || (v && typeof v === 'object' && !Array.isArray(v));
      if (objish(av) && objish(bv) && (av !== undefined || bv !== undefined)) walk(av || {}, bv || {});
      else if (JSON.stringify(av) !== JSON.stringify(bv)) n++;
    }
  };
  walk(a, b);
  return n;
}

export function seedDocFor(theme) {
  if (theme?.id === 'blank') return blankLayoutDoc();
  return emptyDoc(theme?.basePreset);
}

/* ---------- store ---------- */

// One settings blob holds every theme plus which one is live. Admins read their
// own copy through the existing draft namespace, so nothing they touch reaches a
// member until the same Publish button that promotes the rest of the config.
function normalizeStore(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const themes = [];
  const list = Array.isArray(s.themes) ? s.themes : [];
  for (const th of list.slice(0, MAX_THEMES)) {
    if (!th || typeof th !== 'object') continue;
    const id = clean(th.id, 60);
    if (!id) continue;
    themes.push({
      id,
      name: str(th.name, 80).trim() || 'Untitled theme',
      basePreset: PRESET_IDS.has(th.basePreset) ? th.basePreset : 'anthropic',
      // A builtin's blurb is shipped metadata, so it always comes from the seed
      // list rather than from whatever an older store happened to save.
      note: SEED_BY_ID[id]?.note || str(th.note, 120),
      blurb: SEED_BY_ID[id]?.blurb || str(th.blurb, 200),
      builtin: !!th.builtin,
      createdAt: Number(th.createdAt) || Date.now(),
      updatedAt: Number(th.updatedAt) || Date.now(),
      doc: sanitizeDoc(th.doc),
      history: (Array.isArray(th.history) ? th.history : []).slice(0, MAX_HISTORY).map(h => ({
        ts: Number(h?.ts) || 0,
        label: str(h?.label, 80),
        doc: sanitizeDoc(h?.doc)
      }))
    });
  }
  // A workspace that predates a builtin still gets it, rather than needing a
  // migration of its own: the seed list is the source of truth for what ships.
  for (const seed of SEEDS) if (!themes.some(t => t.id === seed.id)) themes.push(seedTheme(seed));
  const activeId = themes.some(t => t.id === s.activeId) ? s.activeId : themes[0].id;
  return { v: THEME_SCHEMA, activeId, themes };
}

// note is the one-liner beside a theme in a list; blurb is the longer line the
// first-run card has room for. Both ship with the seed so neither surface has to
// keep its own copy of what a layout is.
const SEEDS = [
  { id: 'anthropic', name: 'Anthropic', basePreset: 'anthropic',
    note: 'The native layout',
    blurb: 'Warm serif type and the classic open-quill layout.' },
  { id: 'openai', name: 'OpenAI', basePreset: 'openai',
    note: 'Top-left model picker, pill composer, pitch-black palette',
    blurb: 'Pitch-black, with a top model picker and a pill composer.' },
  { id: 'blank', name: 'Blank', basePreset: 'anthropic',
    note: 'A plain, unstyled starting point',
    blurb: 'Plain and flat. A neutral base to build your own design on.' }
];

const SEED_BY_ID = Object.fromEntries(SEEDS.map(s => [s.id, s]));

function seedTheme(seed) {
  const now = Date.now();
  return {
    id: seed.id, name: seed.name, basePreset: seed.basePreset, note: seed.note, blurb: seed.blurb,
    builtin: true, createdAt: now, updatedAt: now,
    doc: seed.id === 'blank' ? blankLayoutDoc() : emptyDoc(seed.basePreset),
    history: []
  };
}

// The normalizer is the only place the shipped layout list is applied, so it is
// exported for the test that guards that behaviour.
export const normalizeStoreForTest = normalizeStore;

export function readStore(isAdmin) {
  const get = isAdmin ? draftGet : getSetting;
  return normalizeStore(get(STORE_KEY, null));
}

export function writeStore(store) {
  draftSet(STORE_KEY, normalizeStore(store));
}

// The live store is what members render. Publishing copies the admin's staged
// store over it, which promoteDrafts() already does for every draft key. This
// is only used when a theme is published on its own.
export function publishStore() {
  const staged = readStore(true);
  setSetting(STORE_KEY, staged);
  // Re-staging the value it now matches clears the draft key, so the workspace
  // publish banner does not keep claiming there is something left to send.
  draftSet(STORE_KEY, staged);
  return staged;
}

export function activeTheme(isAdmin) {
  const store = readStore(isAdmin);
  return store.themes.find(t => t.id === store.activeId) || store.themes[0];
}

export function themeForClient(isAdmin) {
  const th = activeTheme(isAdmin);
  return { id: th.id, name: th.name, basePreset: th.basePreset, updatedAt: th.updatedAt, doc: th.doc };
}

export function pushHistory(theme, label) {
  const entry = { ts: Date.now(), label: str(label, 80), doc: theme.doc };
  theme.history = [entry, ...(theme.history || [])].slice(0, MAX_HISTORY);
}
