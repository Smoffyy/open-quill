import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import * as cookie from 'cookie';
import { db, uid, now, getSetting, setSetting } from './db.js';

let SECRET = getSetting('jwt_secret');
if (!SECRET) { SECRET = uid() + uid(); setSetting('jwt_secret', SECRET); }

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const DAY_MS = 24 * 60 * 60 * 1000;

function sessionTtlMs() {
  const d = Number(getSetting('session_ttl_days', 30));
  return (Number.isFinite(d) && d > 0 ? d : 30) * DAY_MS;
}
function maxSessions() {
  const n = Number(getSetting('max_sessions', 0));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function hash(pw) { return argon2.hash(pw, ARGON_OPTS); }
export async function check(pw, h) { try { return await argon2.verify(h, pw); } catch { return false; } }

export function createSession(user, req) {
  const t = now();
  const ua = String(req?.headers?.['user-agent'] || '').slice(0, 300);
  const ip = (req?.headers?.['x-forwarded-for']?.split(',')[0] || req?.socket?.remoteAddress || '').trim().slice(0, 64);
  const cap = maxSessions();
  if (cap) {
    const existing = db.sessions.byUser(user.id);
    if (existing.length >= cap) {
      const sorted = [...existing].sort((a, b) => (a.last_seen || 0) - (b.last_seen || 0));
      for (const old of sorted.slice(0, existing.length - cap + 1)) db.sessions.remove(x => x.id === old.id);
    }
  }
  const s = db.sessions.insert({ id: uid(), user_id: user.id, ip, user_agent: ua, last_seen: t, created_at: t });
  return s.id;
}
export function sign(user, sessionId) { return jwt.sign({ id: user.id, sid: sessionId }, SECRET, { expiresIn: '90d' }); }
export function revokeSession(id) { db.sessions.remove(s => s.id === id); }
export function revokeOtherSessions(userId, keepId) { db.sessions.remove(s => s.user_id === userId && s.id !== keepId); }

export function publicUser(u) {
  return { id: u.id, email: u.email, displayName: u.display_name || u.email.split('@')[0], isAdmin: !!u.is_admin, isOwner: !!u.is_owner, twoFactor: !!u.totp_enabled, prefs: u.prefs || {}, instructions: u.instructions || '', savedPrompts: Array.isArray(u.saved_prompts) ? u.saved_prompts : [], personas: Array.isArray(u.personas) ? u.personas : [] };
}

function resolveToken(token) {
  let payload;
  try { payload = jwt.verify(token, SECRET); } catch { return null; }
  const u = db.users.byId(payload.id);
  if (!u) return null;
  if (payload.sid) {
    const s = db.sessions.byId(payload.sid);
    if (!s || s.user_id !== u.id) return null;
    if (now() - (s.last_seen || 0) > sessionTtlMs()) { db.sessions.remove(x => x.id === s.id); return null; }
    if (Date.now() - (s.last_seen || 0) > 60 * 1000) db.sessions.touch(s.id, now());
    return { user: u, sessionId: s.id };
  }
  return { user: u, sessionId: null };
}

export function authMiddleware(req, res, next) {
  const r = req.cookies?.token ? resolveToken(req.cookies.token) : null;
  if (!r) return res.status(401).json({ error: 'unauthorized' });
  req.user = r.user;
  req.sessionId = r.sessionId;
  next();
}

export function adminOnly(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'forbidden' });
  next();
}

export function userFromRequest(req) {
  const raw = req.headers.cookie ? cookie.parseCookie(req.headers.cookie) : {};
  if (!raw.token) return null;
  const r = resolveToken(raw.token);
  return r ? r.user : null;
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