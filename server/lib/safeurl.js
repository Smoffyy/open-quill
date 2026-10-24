const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEME = /^(https?|mailto):/i;

export function safeUrl(value) {
  const url = String(value ?? '').trim();
  const bare = url.replace(/[\u0000- \u007f-\u009f]/g, '');
  if (!SCHEME.test(bare)) return url;
  return SAFE_SCHEME.test(bare) ? url : '';
}