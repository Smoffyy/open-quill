import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import crypto from 'crypto';
import * as cookie from 'cookie';
import { db, uid, now, getSetting, setSetting } from './db.js';
import { clientIp } from './lib/audit.js';
import { permissionsOf, roleOf, gateOf, isActive, isOwner, mfaRequired } from './lib/authz/effective.js';
import { roleName } from './lib/authz/roles.js';
import { hasTotp, recoveryLeft } from './lib/identity/mfa.js';

let SECRET = getSetting('jwt_secret');
if (!SECRET) { SECRET = crypto.randomBytes(48).toString('base64url'); setSetting('jwt_secret', SECRET); }

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const DAY_MS = 24 * 60 * 60 * 1000;

export function sessionTtlDays() {
  const d = Number(getSetting('session_ttl_days', 30));
  return Number.isFinite(d) && d > 0 ? d : 30;
}
function sessionTtlMs() {
  return sessionTtlDays() * DAY_MS;
}
function tokenLifeDays() {
  return Math.max(2, Math.ceil(sessionTtlDays()) + 7);
}
export function sessionMaxAgeSeconds() {
  return tokenLifeDays() * 24 * 60 * 60;
}
function maxSessions() {
  const n = Number(getSetting('max_sessions', 0));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function hash(pw) { return argon2.hash(pw, ARGON_OPTS); }
export async function check(pw, h) { try { return await argon2.verify(h, pw); } catch { return false; } }

export function createSession(user, req, method = 'password', mfa = null) {
  const t = now();
  const ua = String(req?.headers?.['user-agent'] || '').slice(0, 300);
  const ip = clientIp(req);
  const cap = maxSessions();
  if (cap) {
    const existing = db.sessions.byUser(user.id);
    if (existing.length >= cap) {
      const sorted = [...existing].sort((a, b) => (a.last_seen || 0) - (b.last_seen || 0));
      db.sessions.removeByIds(sorted.slice(0, existing.length - cap + 1).map(o => o.id));
    }
  }
  const s = db.sessions.insert({ id: uid(), user_id: user.id, ip, user_agent: ua, method, mfa, auth_at: t, mfa_at: mfa ? t : null, last_seen: t, created_at: t });
  return s.id;
}
export function sign(user, sessionId) { return jwt.sign({ id: user.id, sid: sessionId }, SECRET, { expiresIn: `${tokenLifeDays()}d` }); }
export function revokeSession(id) { db.sessions.removeById(id); }
export function pruneSessions() { return db.sessions.prune(now() - sessionTtlMs()); }
export function revokeOtherSessions(userId, keepId) { db.sessions.removeByIds(db.sessions.byUser(userId).filter(s => s.id !== keepId).map(s => s.id)); }

export function publicUser(u, session = null) {
  return {
    id: u.id, email: u.email, displayName: u.display_name || (u.email || '').split('@')[0],
    role: roleOf(u), roleName: roleName(roleOf(u)), owner: isOwner(u), gate: gateOf(u, session), source: u.source || 'local', hasPassword: !!u.password_hash,
    permissions: [...permissionsOf(u)], twoFactor: hasTotp(u.id), twoFactorRequired: mfaRequired(u), recoveryLeft: recoveryLeft(u.id),
    prefs: u.prefs || {}, instructions: u.instructions || '', styles: Array.isArray(u.styles) ? u.styles : []
  };
}

function resolveToken(token) {
  let payload;
  try { payload = jwt.verify(token, SECRET); } catch { return null; }
  if (!payload?.sid) return null;
  const u = db.users.byId(payload.id);
  if (!u) return null;
  const s = db.sessions.byId(payload.sid);
  if (!s || s.user_id !== u.id) return null;
  if (!isActive(u) || now() - (s.last_seen || 0) > sessionTtlMs()) { db.sessions.removeById(s.id); return null; }
  if (Date.now() - (s.last_seen || 0) > 60 * 1000) db.sessions.touch(s.id, now());
  return { user: u, sessionId: s.id, session: s };
}

export function authAccount(req, res, next) {
  const r = req.cookies?.token ? resolveToken(req.cookies.token) : null;
  if (!r) return res.status(401).json({ error: 'unauthorized' });
  req.user = r.user;
  req.sessionId = r.sessionId;
  req.session = r.session;
  next();
}

export function authMiddleware(req, res, next) {
  authAccount(req, res, () => {
    const gate = gateOf(req.user, req.session);
    if (gate === 'pending') return res.status(403).json({ error: 'Your account is waiting for approval.', gate });
    if (gate) return res.status(403).json({ error: 'Set up two-factor authentication to continue.', gate });
    next();
  });
}

export function sessionFromRequest(req) {
  const raw = req.headers.cookie ? cookie.parseCookie(req.headers.cookie) : {};
  if (!raw.token) return null;
  return resolveToken(raw.token);
}

export function parseCookies(req, _res, next) {
  req.cookies = req.headers.cookie ? cookie.parseCookie(req.headers.cookie) : {};
  next();
}