import { isHttps } from '../origin.js';

export const MFA_COOKIE = 'oq_mfa';
export const FLOW_COOKIE = 'oq_sso';

function cookieLine(req, name, value, { path, maxAge, sameSite }) {
  return [
    `${name}=${value}`, 'HttpOnly', `Path=${path}`,
    `Max-Age=${value ? maxAge : 0}`,
    `SameSite=${sameSite}`,
    ...(isHttps(req) ? ['Secure'] : [])
  ].join('; ');
}

export const sessionCookie = (req, res, token, maxAge) =>
  res.append('Set-Cookie', cookieLine(req, 'token', token, { path: '/', maxAge, sameSite: 'Lax' }));

export const challengeCookie = (req, res, value, maxAge) =>
  res.append('Set-Cookie', cookieLine(req, MFA_COOKIE, value, { path: '/api/auth', maxAge, sameSite: 'Strict' }));

export const flowCookie = (req, res, value, maxAge) =>
  res.append('Set-Cookie', cookieLine(req, FLOW_COOKIE, value, { path: '/api/auth/sso', maxAge, sameSite: 'Lax' }));