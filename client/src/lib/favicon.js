import { BRAND_FAVICON_DARK, BRAND_FAVICON_LIGHT } from './brand.js';

let custom = '';

export function faviconFor(theme, customIcon) {
  if (customIcon) return customIcon;
  return theme === 'light' ? BRAND_FAVICON_LIGHT : BRAND_FAVICON_DARK;
}

export function syncFavicon() {
  if (typeof document === 'undefined') return;
  let link = document.getElementById('favicon');
  if (!link) {
    link = document.createElement('link');
    link.id = 'favicon';
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  const href = faviconFor(document.documentElement.getAttribute('data-theme'), custom);
  if (link.getAttribute('href') === href) return;
  if (/\.svg(\?|#|$)/i.test(href)) link.setAttribute('type', 'image/svg+xml');
  else link.removeAttribute('type');
  link.setAttribute('href', href);
}

export function setCustomFavicon(src) {
  custom = typeof src === 'string' ? src : '';
  syncFavicon();
}
