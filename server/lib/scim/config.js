import crypto from 'node:crypto';
import { db, uid, now, getSetting } from '../../db.js';

const DEFAULTS = { enabled: false, provision: 'user', deprovision: 'disable', adopt: 'off' };
const PROVISIONING = ['user', 'pending'];
const DEPROVISIONING = ['disable', 'delete'];
const ADOPTION = ['off', 'members'];
const TOKEN_PREFIX = 'oqscim_';
const MAX_TOKENS = 20;
const TOKEN_DAYS = [0, 30, 90, 180, 365];
const TOUCH_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function scimConfig() {
  return { ...DEFAULTS, ...(getSetting('auth_scim', null) || {}) };
}

export function updateScim(b) {
  const next = scimConfig();
  if ('enabled' in b) next.enabled = b.enabled === true;
  if ('provision' in b) next.provision = PROVISIONING.includes(b.provision) ? b.provision : DEFAULTS.provision;
  if ('deprovision' in b) next.deprovision = DEPROVISIONING.includes(b.deprovision) ? b.deprovision : DEFAULTS.deprovision;
  if ('adopt' in b) next.adopt = ADOPTION.includes(b.adopt) ? b.adopt : DEFAULTS.adopt;
  return next;
}

const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function tokenList() {
  return db.scimTokens.all()
    .sort((a, b) => b.created_at - a.created_at)
    .map(t => ({
      id: t.id, name: t.name, hint: t.hint, createdAt: t.created_at, createdBy: t.created_by_email || '',
      expiresAt: t.expires_at || 0, lastUsedAt: t.last_used_at || 0, lastUsedIp: t.last_used_ip || '', expired: !!t.expires_at && t.expires_at <= now()
    }));
}

export function createToken({ name, days }, actor) {
  const label = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!label) return { error: 'Give the token a name, such as the identity provider it is for.' };
  if (db.scimTokens.count() >= MAX_TOKENS) return { error: 'Revoke an old token before creating another.' };
  const life = TOKEN_DAYS.includes(Number(days)) ? Number(days) : 365;
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const t = now();
  db.scimTokens.insert({
    id: uid(), hash: hashOf(token), name: label, hint: token.slice(-4), created_at: t, created_by: actor.id, created_by_email: actor.email,
    expires_at: life ? t + life * DAY_MS : 0, last_used_at: 0, last_used_ip: ''
  });
  return { token };
}

export function revokeToken(id) {
  const row = db.scimTokens.byId(id);
  if (!row) return null;
  db.scimTokens.removeById(id);
  return row;
}

export function tokenFor(header) {
  const match = /^Bearer\s+(\S+)$/i.exec(String(header || ''));
  if (!match || !match[1].startsWith(TOKEN_PREFIX) || match[1].length > 200) return null;
  const row = db.scimTokens.byHash(hashOf(match[1]));
  if (!row || (row.expires_at && row.expires_at <= now())) return null;
  return row;
}

export function touchToken(row, ip) {
  const t = now();
  if (t - (row.last_used_at || 0) < TOUCH_MS && row.last_used_ip === ip) return;
  db.scimTokens.update(row.id, { last_used_at: t, last_used_ip: ip });
}