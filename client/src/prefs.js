export function resolveTheme(t) {
  if (!t || t === 'system') return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
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
  let t = prefs?.theme;
  if (t === 'oled') t = 'dark';
  let nextTheme = resolveTheme(t);
  if (nextTheme === 'dark' || nextTheme === 'anthropic' || nextTheme === 'oled' || nextTheme === 'openai') {
    nextTheme = p === 'openai' ? 'openai' : 'anthropic';
  }
  root.setAttribute('data-theme', nextTheme);
  try { localStorage.setItem('oq-theme', nextTheme); } catch {}
  root.setAttribute('data-density', prefs?.density === 'compact' ? 'compact' : 'comfortable');
  root.setAttribute('data-entrance', prefs?.messageEntrance === false ? 'off' : 'on');
  root.setAttribute('data-animations', prefs?.animations === false ? 'off' : 'on');
  const cursorOn = prefs?.streamCursor == null ? p === 'openai' : !!prefs.streamCursor;
  const cursorStyle = prefs?.cursorStyle || (p === 'openai' ? 'circle' : 'block');
  root.setAttribute('data-cursor', cursorOn ? (cursorStyle === 'circle' ? 'circle' : 'block') : 'off');
  root.setAttribute('data-microfx', prefs?.microFx === false ? 'off' : 'on');
  root.setAttribute('data-composerfx', prefs?.composerFx === false ? 'off' : 'on');
  root.setAttribute('data-focusglow', prefs?.focusGlow ? 'on' : 'off');
  root.setAttribute('data-iconglow', prefs?.iconGlow ? 'on' : 'off');
  root.setAttribute('data-oled', prefs?.oledShift ? 'on' : 'off');
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
