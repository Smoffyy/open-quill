import { legacyRevealStyle } from './reveal.js';

export function presetDefaults(layout, theme = 'system') {
  return {
    revealStyle: 'modern', autoscroll: true, theme, density: 'comfortable',
    streamCursor: layout.cursor.on, cursorStyle: layout.cursor.style,
    cursorBlinkMs: 500, cursorPulseMs: 1000, revealMs: 40,
    oledShift: false,
    threadRail: false, threadFind: true, branchMap: true, threadOutline: true, msgKeys: true, readWidth: 'normal', keybinds: {}
  };
}

export function shownThemeFallback(appliedTheme) {
  if (appliedTheme === 'light') return 'light';
  if (appliedTheme === 'anthropic' || appliedTheme === 'openai') return 'dark';
  return 'system';
}

export function initialPrefs(stored, layout) {
  const own = stored && typeof stored === 'object' ? stored : {};
  const merged = { ...presetDefaults(layout), ...own };
  if (own.revealStyle == null) merged.revealStyle = legacyRevealStyle(own);
  if (merged.theme == null || merged.theme === 'oled') merged.theme = merged.theme === 'oled' ? 'dark' : 'system';
  return merged;
}