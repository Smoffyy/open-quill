const TURNS = new Set(['chat', 'regenerate', 'edit', 'incognito']);

export function clientContext(language) {
  let timeZone = '';
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
  const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches;
  return { timeZone, language, device: phone ? 'phone' : 'desktop' };
}

export const withClient = (obj, language) => (TURNS.has(obj?.type) ? { ...obj, client: clientContext(language) } : obj);