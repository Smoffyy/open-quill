// push the chosen theme / accent / density onto the root element
export function resolveTheme(t) {
  if (t === 'system') return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  return t || 'dark';
}
export function applyPrefs(prefs) {
  const root = document.documentElement;
  const nextTheme = resolveTheme(prefs?.theme);
  if (prefs?.themeFade !== false && root.getAttribute('data-theme') && root.getAttribute('data-theme') !== nextTheme) {
    root.classList.add('theme-anim');
    clearTimeout(applyPrefs._t);
    applyPrefs._t = setTimeout(() => root.classList.remove('theme-anim'), 340);
  }
  root.setAttribute('data-theme', nextTheme);
  root.setAttribute('data-density', prefs?.density === 'compact' ? 'compact' : 'comfortable');
  root.setAttribute('data-entrance', prefs?.messageEntrance === false ? 'off' : 'on');
  root.setAttribute('data-cursor', prefs?.streamCursor ? (prefs?.cursorStyle === 'circle' ? 'circle' : 'block') : 'off');
  root.setAttribute('data-microfx', prefs?.microFx === false ? 'off' : 'on');
  root.setAttribute('data-composerfx', prefs?.composerFx === false ? 'off' : 'on');
  root.setAttribute('data-focusglow', prefs?.focusGlow ? 'on' : 'off');
  root.setAttribute('data-iconglow', prefs?.iconGlow ? 'on' : 'off');
  root.setAttribute('data-fluidmotion', prefs?.fluidMotion ? 'on' : 'off');
  root.setAttribute('data-fluidlevel', prefs?.fluidLevel === 'gentle' ? 'gentle' : (prefs?.fluidLevel === 'expressive' ? 'expressive' : 'balanced'));
  if (prefs?.accent) root.style.setProperty('--accent', prefs.accent);
  else root.style.removeProperty('--accent');
}

export const ACCENT_PRESETS = ['#d97757', '#4f8ff7', '#46b07a', '#9b6bd8', '#e0567f', '#e0a93c', '#3bb6c4', '#7a8794'];
