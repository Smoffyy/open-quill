// push the chosen theme / accent / density onto the root element
export function resolveTheme(t) {
  if (t === 'system') return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  return t || 'dark';
}
export function applyPrefs(prefs) {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolveTheme(prefs?.theme));
  root.setAttribute('data-density', prefs?.density === 'compact' ? 'compact' : 'comfortable');
  root.setAttribute('data-entrance', prefs?.messageEntrance === false ? 'off' : 'on');
  if (prefs?.accent) root.style.setProperty('--accent', prefs.accent);
  else root.style.removeProperty('--accent');
}

export const ACCENT_PRESETS = ['#d97757', '#4f8ff7', '#46b07a', '#9b6bd8', '#e0567f', '#e0a93c', '#3bb6c4', '#7a8794'];
