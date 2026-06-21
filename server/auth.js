import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import * as cookie from 'cookie';
import { db, uid, getSetting, setSetting } from './db.js';

let SECRET = getSetting('jwt_secret');
if (!SECRET) { SECRET = uid() + uid(); setSetting('jwt_secret', SECRET); }

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hash(pw) { return argon2.hash(pw, ARGON_OPTS); }
export async function check(pw, h) { try { return await argon2.verify(h, pw); } catch { return false; } }
export function sign(user) { return jwt.sign({ id: user.id }, SECRET, { expiresIn: '30d' }); }

export function publicUser(u) {
  return { id: u.id, email: u.email, displayName: u.display_name || u.email.split('@')[0], isAdmin: !!u.is_admin, isOwner: !!u.is_owner, prefs: u.prefs || {} };
}

function userFromToken(token) {
  try { return db.users.byId(jwt.verify(token, SECRET).id) || null; } catch { return null; }
}

export function authMiddleware(req, res, next) {
  const u = req.cookies?.token ? userFromToken(req.cookies.token) : null;
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  req.user = u;
  next();
}

export function adminOnly(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'forbidden' });
  next();
}

export function userFromRequest(req) {
  const raw = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
  return raw.token ? userFromToken(raw.token) : null;
}

export function parseCookies(req, _res, next) {
  req.cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
  next();
}
