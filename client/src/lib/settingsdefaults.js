import { legacyRevealStyle } from './reveal.js';

export function presetDefaults(isOpenai, theme = 'system') {
  return {
    revealStyle: 'modern', autoscroll: true, theme, density: 'comfortable',
    streamCursor: isOpenai, cursorStyle: isOpenai ? 'circle' : 'block',
    cursorBlinkMs: 500, cursorPulseMs: 1000, revealMs: 40,
    oledShift: false,
    threadRail: true, threadFind: true, branchMap: true, threadOutline: true, msgKeys: true, readWidth: 'normal', keybinds: {}
  };
}

export function shownThemeFallback(appliedTheme) {
  if (appliedTheme === 'light') return 'light';
  if (appliedTheme === 'anthropic' || appliedTheme === 'openai') return 'dark';
  return 'system';
}

export function initialPrefs(stored, isOpenai) {
  const own = stored && typeof stored === 'object' ? stored : {};
  const merged = { ...presetDefaults(isOpenai), ...own };
  if (own.revealStyle == null) merged.revealStyle = legacyRevealStyle(own);
  if (merged.theme == null || merged.theme === 'oled') merged.theme = merged.theme === 'oled' ? 'dark' : 'system';
  return merged;
}
