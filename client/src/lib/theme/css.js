import { TOKEN_GROUPS, ELEMENT_INDEX, orderItemSel } from './schema.js';

// The stylesheet the builder produces is injected after every app sheet, but
// plenty of app rules are two or three classes deep. Repeating :root lifts the
// theme above them on specificity alone, which keeps !important for the one case
// that genuinely needs it (hiding something the app wants to show).
const BOOST = ':root:root:root ';
const MEDIA = { __proto__: null, tablet: '(max-width: 1024px)', mobile: '(max-width: 640px)' };

const KEBAB = /[A-Z]/g;
const prop = (k) => k.replace(KEBAB, (c) => '-' + c.toLowerCase());

// A value has already been screened on the server; this is the last stop before
// it reaches a stylesheet, so anything that could close a rule is dropped.
function safeValue(v) {
  const s = String(v ?? '').trim();
  if (!s || /[<>{};]|url\s*\(|@import|expression\s*\(|javascript:/i.test(s)) return '';
  return s.slice(0, 240);
}

function declarations(style) {
  if (!style) return '';
  const out = [];
  for (const key of Object.keys(style)) {
    const v = safeValue(style[key]);
    if (!v) continue;
    out.push(prop(key) + ':' + v);
  }
  return out.join(';');
}

function boost(sel) {
  return sel.split(',').map(s => BOOST + s.trim()).filter(s => s.length > BOOST.length).join(',');
}

const STATE_SUFFIX = {
  __proto__: null,
  hover: ':hover',
  active: ':active',
  focus: ':focus-visible',
  disabled: ':disabled,[aria-disabled="true"]',
  selected: '.on,.active,[aria-current="page"]'
};

function stateRule(sel, state, style) {
  const body = declarations(style);
  if (!body) return '';
  // disabled and selected each carry two forms; expanding here keeps the
  // inspector's single "Disabled" tab honest about both.
  const parts = (STATE_SUFFIX[state] || '').split(',');
  const full = parts.flatMap(sfx => sel.split(',').map(s => BOOST + s.trim() + sfx)).join(',');
  return full ? full + '{' + body + '}' : '';
}

// Tokens the builder introduces (--oq-*) always get their default so an element
// control can reference one before anybody has touched the palette. Tokens that
// name a variable the app already defines are emitted only when an admin set
// them, or a fresh theme would silently flatten the preset it is based on.
function tokenCss(tokens) {
  const rows = [];
  for (const group of TOKEN_GROUPS) {
    const vals = tokens?.[group.id];
    for (const tok of group.tokens) {
      const explicit = vals?.[tok.id];
      const own = explicit != null && explicit !== '';
      if (!own && !tok.var.startsWith('--oq-')) continue;
      const v = safeValue(own ? explicit : tok.def);
      if (!v) continue;
      rows.push(tok.var + ':' + v);
    }
  }
  // The palette is defined on :root[data-theme=…][data-palette=…] rules two and
  // three classes deep, so the token block has to carry the same weight.
  return rows.length ? ':root:root:root{' + rows.join(';') + '}' : '';
}

// Device preview narrows the canvas, but the app's own media queries still watch
// the real window. Forcing the theme's own breakpoint rules on is what makes the
// responsive settings an admin writes here actually previewable.
const WIDER = { __proto__: null, tablet: ['tablet'], mobile: ['tablet', 'mobile'] };

function elementCss(id, cfg, preview) {
  const meta = ELEMENT_INDEX.get(id);
  const sel = meta ? meta.sel : orderItemSel(id);
  if (!sel || !cfg) return '';
  const out = [];

  if (cfg.hidden) out.push(boost(sel) + '{display:none!important}');

  const base = { ...(cfg.style || {}) };
  if (Number.isFinite(Number(cfg.order))) base.order = String(cfg.order);
  if (cfg.animation?.name) {
    const a = cfg.animation;
    base.animation = `oq-${a.name} ${Math.max(0, a.duration || 240)}ms ${safeValue(a.easing) || 'ease'} ${Math.max(0, a.delay || 0)}ms both`;
  }
  const body = declarations(base);
  if (body) out.push(boost(sel) + '{' + body + '}');

  for (const state of Object.keys(cfg.states || {})) {
    const rule = stateRule(sel, state, cfg.states[state]);
    if (rule) out.push(rule);
  }

  const forced = new Set(WIDER[preview] || []);
  for (const bp of Object.keys(cfg.responsive || {})) {
    const media = MEDIA[bp];
    if (!media) continue;
    const entry = cfg.responsive[bp] || {};
    const inner = [];
    if (entry.hidden) inner.push(boost(sel) + '{display:none!important}');
    const b = declarations(entry.style);
    if (b) inner.push(boost(sel) + '{' + b + '}');
    if (!inner.length) continue;
    out.push(forced.has(bp) ? inner.join('') : '@media ' + media + '{' + inner.join('') + '}');
  }

  return out.join('');
}

// Only entrance effects live here. An animation the builder cannot name is one
// an admin cannot remove, so the set stays closed.
const KEYFRAMES = `
@keyframes oq-fade{from{opacity:0}to{opacity:1}}
@keyframes oq-slide-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes oq-slide-down{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
@keyframes oq-slide-left{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}
@keyframes oq-slide-right{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
@keyframes oq-scale{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
@keyframes oq-pop{0%{transform:scale(.9)}60%{transform:scale(1.03)}100%{transform:scale(1)}}
@keyframes oq-pulse{0%,100%{opacity:1}50%{opacity:.55}}
`;

export const ANIMATIONS = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade in' },
  { id: 'slide-up', label: 'Slide up' },
  { id: 'slide-down', label: 'Slide down' },
  { id: 'slide-left', label: 'Slide from right' },
  { id: 'slide-right', label: 'Slide from left' },
  { id: 'scale', label: 'Scale in' },
  { id: 'pop', label: 'Pop' },
  { id: 'pulse', label: 'Pulse' }
];

export const EASINGS = [
  { id: 'ease', label: 'Ease' },
  { id: 'linear', label: 'Linear' },
  { id: 'ease-in', label: 'Ease in' },
  { id: 'ease-out', label: 'Ease out' },
  { id: 'ease-in-out', label: 'Ease in out' },
  { id: 'cubic-bezier(.34,1.56,.64,1)', label: 'Overshoot' },
  { id: 'cubic-bezier(.4,0,.2,1)', label: 'Standard' }
];

export function docToCss(doc, preview) {
  if (!doc) return '';
  const parts = [KEYFRAMES, tokenCss(doc.tokens)];
  for (const id of Object.keys(doc.elements || {})) parts.push(elementCss(id, doc.elements[id], preview));
  if (doc.css && !/[<]/.test(doc.css)) parts.push(doc.css);
  return parts.filter(Boolean).join('\n');
}

const STYLE_ID = 'oq-theme-style';

export function injectCss(css) {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  // The sheet has to stay last so equal-specificity ties fall to the theme.
  if (el !== document.head.lastElementChild) document.head.appendChild(el);
  if (el.textContent !== css) el.textContent = css;
}

export function clearCss() {
  document.getElementById(STYLE_ID)?.remove();
}
