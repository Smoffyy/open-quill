export const BRAND_ICON = '/brand/mark.svg';
export const BRAND_GENERATING = '/brand/mark-generating.svg';
export const BRAND_THINKING = '/brand/mark-thinking.svg';

const LEGACY = {
  __proto__: null,
  '/starburst.svg': BRAND_ICON,
  '/starburst-generating.svg': BRAND_GENERATING,
  '/starburst-thinking.svg': BRAND_THINKING,
  '/brand/starburst.svg': BRAND_ICON,
  '/brand/starburst-generating.svg': BRAND_GENERATING,
  '/brand/starburst-thinking.svg': BRAND_THINKING
};

export function remapBrandPath(v) {
  return (typeof v === 'string' && LEGACY[v]) || v;
}

export const BRAND_ICON_FIELDS = ['static_icon', 'generating_icon', 'thinking_icon'];
