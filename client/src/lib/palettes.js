export const PALETTES = [
  { id: 'anthropic-light', preset: 'anthropic', theme: 'light', palette: '', dark: false, label: 'Anthropic Light', bg: '#f4f3ee' },
  { id: 'anthropic-legacy', preset: 'anthropic', theme: 'anthropic', palette: 'legacy', dark: true, label: 'Anthropic Legacy', bg: '#1f1f1e' },
  { id: 'anthropic-2025q2', preset: 'anthropic', theme: 'anthropic', palette: '', dark: true, label: 'Anthropic Dark 2025 Q2', bg: '#1a1a19' },
  { id: 'anthropic-2026q3', preset: 'anthropic', theme: 'anthropic', palette: '2026q3', dark: true, label: 'Anthropic Dark 2026 Q3', bg: '#151515' },
  { id: 'openai-light', preset: 'openai', theme: 'light', palette: '', dark: false, label: 'OpenAI Light', bg: '#fcfcfc' },
  { id: 'openai-2024q1', preset: 'openai', theme: 'openai', palette: '', dark: true, label: 'OpenAI Dark 2024 Q1', bg: '#000000' },
  { id: 'openai-2025', preset: 'openai', theme: 'openai', palette: '2025', dark: true, label: 'OpenAI Dark 2025', bg: '#000000' }
];

export const DEFAULT_DARK = { anthropic: 'anthropic-2026q3', openai: 'openai-2025' };
export const DEFAULT_LIGHT = { anthropic: 'anthropic-light', openai: 'openai-light' };

const LEGACY_DARK = ['dark', 'oled', 'anthropic', 'openai'];

export function presetOf(preset) {
  return preset === 'openai' ? 'openai' : 'anthropic';
}

export function palettesFor(preset) {
  const p = presetOf(preset);
  return PALETTES.filter(x => x.preset === p);
}

export function paletteById(id) {
  return PALETTES.find(x => x.id === id) || null;
}

export function paletteFor(themePref, preset, prefersDark) {
  const p = presetOf(preset);
  const dark = () => paletteById(DEFAULT_DARK[p]);
  const light = () => paletteById(DEFAULT_LIGHT[p]);
  const t = typeof themePref === 'string' ? themePref : '';
  if (!t || t === 'system') return prefersDark ? dark() : light();
  if (t === 'light') return light();
  if (LEGACY_DARK.includes(t)) return dark();
  const hit = paletteById(t);
  if (!hit) return prefersDark ? dark() : light();
  if (hit.preset !== p) return hit.dark ? dark() : light();
  return hit;
}

export function themeValue(themePref, preset) {
  const p = presetOf(preset);
  const t = typeof themePref === 'string' ? themePref : '';
  if (!t) return 'system';
  if (t === 'system') return 'system';
  if (t === 'light') return DEFAULT_LIGHT[p];
  if (LEGACY_DARK.includes(t)) return DEFAULT_DARK[p];
  const hit = paletteById(t);
  if (!hit) return 'system';
  if (hit.preset !== p) return DEFAULT_DARK[p] && hit.dark ? DEFAULT_DARK[p] : DEFAULT_LIGHT[p];
  return hit.id;
}
