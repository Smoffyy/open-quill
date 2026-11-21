export const SESSION_EXPIRED = 'oq-session-expired';
export const ACCOUNT_GATED = 'oq-account-gated';

function noteExpiry(url, status, body) {
  if (url.startsWith('/api/auth/') || typeof window === 'undefined') return;
  if (status === 401) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED));
  else if (status === 403 && body?.gate) window.dispatchEvent(new CustomEvent(ACCOUNT_GATED));
}

let translate = (s) => s;

export function setErrorTranslator(fn) {
  translate = typeof fn === 'function' ? fn : (s) => s;
}

async function failure(url, res, fallback) {
  const body = await res.json().catch(() => ({}));
  noteExpiry(url, res.status, body);
  const err = new Error(translate(body.error || fallback || res.statusText));
  err.status = res.status;
  err.body = body;
  return err;
}

export const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

async function req(method, url, body) {
  const opts = { method, headers: { 'X-Oq-Tab': TAB_ID }, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  if (!res.ok) throw await failure(url, res);
  return res.status === 204 ? null : res.json();
}

async function upload(url, field, files) {
  const fd = new FormData();
  for (const f of files) fd.append(field, f);
  const res = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin' });
  if (!res.ok) throw await failure(url, res, 'Upload failed.');
  return res.json();
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b),
  put: (u, b) => req('PUT', u, b),
  patch: (u, b) => req('PATCH', u, b),
  del: (u, b) => req('DELETE', u, b),
  upload: (file) => upload('/api/admin/upload', 'file', [file]),
  uploadFiles: (files) => upload('/api/upload', 'files', files),
  uploadTo: (url, file) => upload(url, 'file', [file]),
  uploadReferenceFiles: (files) => upload('/api/admin/membank', 'files', files)
};