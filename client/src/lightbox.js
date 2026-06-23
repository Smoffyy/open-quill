const subs = new Set();
export function subscribeLightbox(fn) { subs.add(fn); return () => subs.delete(fn); }
export function openLightbox(src, alt = '') { subs.forEach(fn => fn({ src, alt })); }
