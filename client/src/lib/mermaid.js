let loading = null;
let seq = 0;

export function isDarkMode() {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') !== 'light';
}

export function subscribeThemeMode(fn) {
  if (typeof MutationObserver === 'undefined') return () => { };
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

export async function renderMermaid(code, dark, fontFamily) {
  if (!loading) loading = import('mermaid').then(m => m.default);
  const mermaid = await loading;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: dark ? 'dark' : 'default', fontFamily });
  const { svg } = await mermaid.render('oq-mermaid-' + (++seq), code);
  return svg;
}