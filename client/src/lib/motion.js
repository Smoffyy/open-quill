export function simpleMotion() {
  return document.documentElement.dataset.motion === 'simple' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}