import { paletteFor } from './lib/palettes.js';

export function prefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
export function resolveTheme(t) {
  if (!t || t === 'system') return prefersDark() ? 'dark' : 'light';
  return t;
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
  const minimal = !!prefs?.minimalAnims;
  root.setAttribute('data-entrance', minimal ? 'off' : 'on');
  root.setAttribute('data-animations', minimal ? 'off' : 'on');
  const cursorOn = prefs?.streamCursor == null ? p === 'openai' : !!prefs.streamCursor;
  const cursorStyle = prefs?.cursorStyle || (p === 'openai' ? 'circle' : 'block');
  root.setAttribute('data-cursor', cursorOn ? (cursorStyle === 'circle' ? 'circle' : 'block') : 'off');
  root.setAttribute('data-microfx', minimal ? 'off' : 'on');
  root.setAttribute('data-composerfx', minimal ? 'off' : 'on');
  root.setAttribute('data-oled', prefs?.oledShift ? 'on' : 'off');
  root.setAttribute('data-minimal', prefs?.minimalAnims ? 'on' : 'off');
  const blink = Math.max(150, Math.min(2000, parseInt(prefs?.cursorBlinkMs) || 500));
  const pulse = Math.max(300, Math.min(4000, parseInt(prefs?.cursorPulseMs) || 1000));
  root.style.setProperty('--caret-blink', blink + 'ms');
  root.style.setProperty('--caret-cycle', (blink * 2) + 'ms');
  root.style.setProperty('--caret-pulse', pulse + 'ms');
  if (prefs?.accent) root.style.setProperty('--accent', prefs.accent);
  else root.style.removeProperty('--accent');
  applyUserFont();
}

export const ACCENT_PRESETS = ['#d97757', '#4f8ff7', '#46b07a', '#9b6bd8', '#e0567f', '#e0a93c', '#3bb6c4', '#7a8794'];

export const USER_FONT_KEY = 'oq-user-font';
const USER_FONT_STACKS = {
  sans: "'Open Sans'",
  serif: "'Source Serif 4 Variable'",
};
export function getUserFont() {
  try { const v = localStorage.getItem(USER_FONT_KEY); return v === 'sans' || v === 'serif' ? v : 'default'; } catch { return 'default'; }
}
export function applyUserFont(v) {
  const font = v || getUserFont();
  const root = document.documentElement;
  if (font === 'sans' || font === 'serif') {
    root.style.setProperty('--font-sans', USER_FONT_STACKS[font]);
    root.style.setProperty('--font-serif', USER_FONT_STACKS[font]);
  } else {
    root.style.removeProperty('--font-sans');
    root.style.removeProperty('--font-serif');
  }
}
export function setUserFont(v) {
  const font = v === 'sans' || v === 'serif' ? v : 'default';
  try { if (font === 'default') localStorage.removeItem(USER_FONT_KEY); else localStorage.setItem(USER_FONT_KEY, font); } catch {}
  applyUserFont(font);
}
