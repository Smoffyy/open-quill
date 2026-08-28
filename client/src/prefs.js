import { paletteFor } from './lib/palettes.js';

export function prefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
export function currentPreset() {
  const attr = document.documentElement.getAttribute('data-preset');
  if (attr === 'openai' || attr === 'anthropic') return attr;
  try { const s = localStorage.getItem('oq-preset'); if (s === 'openai' || s === 'anthropic') return s; } catch {}
  return 'anthropic';
}
export function applyPrefs(prefs, preset) {
  const root = document.documentElement;
  const p = preset === 'openai' || preset === 'anthropic' ? preset : currentPreset();
  root.setAttribute('data-preset', p);
  try { localStorage.setItem('oq-preset', p); } catch {}
  const pal = paletteFor(prefs?.theme, p, prefersDark());
  root.setAttribute('data-theme', pal.theme);
  if (pal.palette) root.setAttribute('data-palette', pal.palette);
  else root.removeAttribute('data-palette');
  try {
    localStorage.setItem('oq-theme', pal.theme);
    if (pal.palette) localStorage.setItem('oq-palette', pal.palette);
    else localStorage.removeItem('oq-palette');
  } catch {}
  root.setAttribute('data-density', prefs?.density === 'compact' ? 'compact' : 'comfortable');
  const cursorOn = prefs?.streamCursor == null ? p === 'openai' : !!prefs.streamCursor;
  const cursorStyle = prefs?.cursorStyle || (p === 'openai' ? 'circle' : 'block');
  root.setAttribute('data-cursor', cursorOn ? (cursorStyle === 'circle' ? 'circle' : 'block') : 'off');
  root.setAttribute('data-oled', prefs?.oledShift ? 'on' : 'off');
  const blink = Math.max(150, Math.min(2000, parseInt(prefs?.cursorBlinkMs) || 500));
  const pulse = Math.max(300, Math.min(4000, parseInt(prefs?.cursorPulseMs) || 1000));
  root.style.setProperty('--caret-blink', blink + 'ms');
  root.style.setProperty('--caret-cycle', (blink * 2) + 'ms');
  root.style.setProperty('--caret-pulse', pulse + 'ms');
  applyUserFont();
}

export const APP_FONTS = new Set(['newsreader', 'sourceserif', 'sans']);
const LEGACY_FONT_IDS = { __proto__: null, serif: 'newsreader' };

export function appFontId(v) {
  const id = LEGACY_FONT_IDS[v] || v;
  return APP_FONTS.has(id) ? id : 'newsreader';
}

export const USER_FONT_KEY = 'oq-user-font';
export const USER_FONTS = {
  __proto__: null,
  newsreader: { stack: "'Newsreader Variable'", weight: 420, strong: 615 },
  sourceserif: { stack: "'Source Serif 4 Variable'", weight: 465, strong: 680 },
  sans: { stack: "'Open Sans'", weight: 400, strong: 600 },
};
const LEGACY_USER_FONT_IDS = { __proto__: null, serif: 'sourceserif' };

function userFontId(v) {
  const id = LEGACY_USER_FONT_IDS[v] || v;
  return USER_FONTS[id] ? id : 'default';
}
export function getUserFont() {
  try { return userFontId(localStorage.getItem(USER_FONT_KEY)); } catch { return 'default'; }
}
export function applyUserFont(v) {
  const font = v || getUserFont();
  const root = document.documentElement;
  const pick = USER_FONTS[font];
  if (pick) {
    root.style.setProperty('--font-sans', pick.stack);
    root.style.setProperty('--font-serif', pick.stack);
    root.style.setProperty('--prose-weight', String(pick.weight));
    root.style.setProperty('--prose-strong', String(pick.strong));
  } else {
    root.style.removeProperty('--font-sans');
    root.style.removeProperty('--font-serif');
    root.style.removeProperty('--prose-weight');
    root.style.removeProperty('--prose-strong');
  }
}
export function setUserFont(v) {
  const font = userFontId(v);
  try { if (font === 'default') localStorage.removeItem(USER_FONT_KEY); else localStorage.setItem(USER_FONT_KEY, font); } catch {}
  applyUserFont(font);
}
