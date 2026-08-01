import { getSetting } from '../db.js';

function selfOrigins(req) {
  const host = String(req.headers.host || '').trim();
  if (!host || /[^a-zA-Z0-9.:_-]/.test(host)) return [];
  const secure = req.socket?.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return [secure ? `wss://${host}` : `ws://${host}`];
}

export function localOnlyEnabled() {
  return getSetting('local_only', '1') === '1';
}

export function localOnlyCsp(req) {
  const connect = ["'self'", ...selfOrigins(req)].join(' ');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    `connect-src ${connect}`,
  ].join('; ');
}

export function localOnlyMiddleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  if (localOnlyEnabled()) res.setHeader('Content-Security-Policy', localOnlyCsp(req));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
}
