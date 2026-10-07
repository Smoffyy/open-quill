import { presetById, presetId } from './presets.js';

export const PALETTES = [
  { id: 'anthropic-light', preset: 'anthropic', mode: 'light', label: 'Anthropic Light', bg: '#f4f3ee' },
  { id: 'anthropic-legacy', preset: 'anthropic', mode: 'dark', base: 'anthropic-2025q2', label: 'Anthropic Legacy', bg: '#1f1f1e' },
  { id: 'anthropic-2025q2', preset: 'anthropic', mode: 'dark', label: 'Anthropic Dark 2025 Q2', bg: '#1a1a19' },
  { id: 'anthropic-2026q3', preset: 'anthropic', mode: 'dark', base: 'anthropic-2025q2', label: 'Anthropic Dark 2026 Q3', bg: '#151515' },
  { id: 'openai-light', preset: 'openai', mode: 'light', label: 'OpenAI Light', bg: '#fcfcfc' },
  { id: 'openai-2024q1', preset: 'openai', mode: 'dark', label: 'OpenAI Dark 2024 Q1', bg: '#000000' },
  { id: 'openai-2025', preset: 'openai', mode: 'dark', base: 'openai-2024q1', label: 'OpenAI Dark 2025', bg: '#000000' }
];

const LEGACY_DARK = ['dark', 'oled', 'anthropic', 'openai'];

export function palettesFor(preset) {
  const p = presetId(preset);
  return PALETTES.filter(x => x.preset === p);
}

export function paletteById(id) {
  return PALETTES.find(x => x.id === id) || null;
}

export function paletteChain(id) {
  const chain = [];
  for (let pal = paletteById(id); pal; pal = paletteById(pal.base)) chain.unshift(pal.id);
  return chain;
}

function defaults(preset) {
  const { dark, light } = presetById(preset).palettes;
  return { dark: paletteById(dark), light: paletteById(light) };
}

export function paletteFor(themePref, preset, prefersDark) {
  const p = presetId(preset);
  const { dark, light } = defaults(p);
  const t = typeof themePref === 'string' ? themePref : '';
  if (!t || t === 'system') return prefersDark ? dark : light;
  if (t === 'light') return light;
  if (LEGACY_DARK.includes(t)) return dark;
  const hit = paletteById(t);
  if (!hit) return prefersDark ? dark : light;
  if (hit.preset !== p) return hit.mode === 'dark' ? dark : light;
  return hit;
}

export function themeValue(themePref, preset) {
  const p = presetId(preset);
  const { dark, light } = defaults(p);
  const t = typeof themePref === 'string' ? themePref : '';
  if (!t || t === 'system') return 'system';
  if (t === 'light') return light.id;
  if (LEGACY_DARK.includes(t)) return dark.id;
  const hit = paletteById(t);
  if (!hit) return 'system';
  if (hit.preset !== p) return hit.mode === 'dark' ? dark.id : light.id;
  return hit.id;
}

// Toggling light/dark is not a boolean: a palette is a named theme, and a user
// who picked a particular dark palette should get *that* one back rather than the
// preset default. `lastDark` is the id they were last on, remembered across the
// round trip; a remembered palette belonging to another preset is not applicable
// and the preset's own default is used instead.
export function nextTheme({ themePref, preset, prefersDark, lastDark }) {
  const p = presetId(preset);
  const { dark, light } = defaults(p);
  const current = paletteFor(themePref, p, prefersDark);
  if (current.mode === 'dark') {
    return { theme: light.id, remember: current.id };
  }
  const back = paletteById(lastDark);
  return { theme: (back && back.preset === p) ? back.id : dark.id, remember: null };
}