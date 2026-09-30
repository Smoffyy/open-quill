export const MODEL_WEAVE = 'builtin:weave';
export const BRAND_FRAME = { time: 123.1833, angle: 0.5074 };
export const BRAND_FAVICON_DARK = '/brand/favicon-dark.svg';
export const BRAND_FAVICON_LIGHT = '/brand/favicon-light.svg';

export const LEGACY_MARK_SET = ['/brand/mark.svg', '/brand/mark-generating.svg', '/brand/mark-thinking.svg'];

const LEGACY = {
  __proto__: null,
  '/starburst.svg': LEGACY_MARK_SET[0],
  '/starburst-generating.svg': LEGACY_MARK_SET[1],
  '/starburst-thinking.svg': LEGACY_MARK_SET[2],
  '/brand/starburst.svg': LEGACY_MARK_SET[0],
  '/brand/starburst-generating.svg': LEGACY_MARK_SET[1],
  '/brand/starburst-thinking.svg': LEGACY_MARK_SET[2]
};

export function remapBrandPath(v) {
  return (typeof v === 'string' && LEGACY[v]) || v;
}

export function retireLegacyMark(v) {
  return typeof v === 'string' && LEGACY_MARK_SET.includes(v) ? MODEL_WEAVE : v;
}

export const BRAND_ICON_FIELDS = ['static_icon', 'generating_icon', 'thinking_icon'];
