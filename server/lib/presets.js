export const PRESETS = Object.freeze([
  Object.freeze({
    id: 'anthropic',
    label: 'Anthropic',
    layout: 'card',
    font: 'literata',
    palettes: Object.freeze({ dark: 'anthropic-2026q3', light: 'anthropic-light' }),
    model: Object.freeze({ icon_size: 0, show_name: 0, dropdown_icon: 1, icon_position: 'below' }),
    swatch: Object.freeze({ bg: '#262624', border: '#3a3a37', dot: '#d97757', radius: '6px' }),
    note: 'The native layout',
    blurb: 'Warm serif type and the classic open-quill layout.'
  }),
  Object.freeze({
    id: 'openai',
    label: 'OpenAI',
    layout: 'pill',
    font: 'sans',
    palettes: Object.freeze({ dark: 'openai-2025', light: 'openai-light' }),
    model: Object.freeze({ icon_size: 28, show_name: 1, dropdown_icon: 0, icon_position: 'left' }),
    swatch: Object.freeze({ bg: '#000', border: '#2b2b2b', dot: '#fff', radius: '50%' }),
    note: 'Top-left model picker, pill composer, pitch-black palette',
    blurb: 'Pitch-black, with a top model picker and a pill composer.'
  })
]);

export const DEFAULT_PRESET = 'anthropic';

const BY_ID = new Map(PRESETS.map(p => [p.id, p]));

export function isPreset(id) {
  return BY_ID.has(id);
}

export function presetId(id) {
  return BY_ID.has(id) ? id : DEFAULT_PRESET;
}

export function presetById(id) {
  return BY_ID.get(presetId(id));
}