export const SESSION_EXPIRED = 'oq-session-expired';

function noteExpiry(url, status) {
  if (status !== 401 || url.startsWith('/api/auth/') || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED));
}

async function failure(url, res, fallback) {
  noteExpiry(url, res.status);
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || fallback || res.statusText);
}

async function req(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
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
  uploadReferenceFiles: (files) => upload('/api/admin/membank', 'files', files)
};
