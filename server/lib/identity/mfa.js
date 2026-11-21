import crypto from 'crypto';
import QRCode from 'qrcode';
import { db, uid, now, tx, getSetting, setSetting } from '../../db.js';
import { seal, unseal, keyedHash } from './seal.js';
import { randomSecret, totpStep, otpauthUri, makeRecoveryCodes, hashRecovery } from '../totp.js';

export const MFA_POLICIES = ['optional', 'admins', 'everyone'];
const ENROLL_TTL = 10 * 60 * 1000;
const CHALLENGE_TTL = 5 * 60 * 1000;
const spent = new Map();

export function mfaPolicy() {
  const p = getSetting('auth_mfa_policy', 'optional');
  return MFA_POLICIES.includes(p) ? p : 'optional';
}

const factorOf = (userId, type) => db.mfaFactors.where('user_id', userId).find(f => f.type === type) || null;
const cleanRecovery = (code) => String(code || '').replace(/[\s-]/g, '').toLowerCase();
const recoveryHash = (code) => keyedHash('recovery', cleanRecovery(code));

export const hasTotp = (userId) => !!userId && !!factorOf(userId, 'totp');

export function recoveryLeft(userId) {
  const f = factorOf(userId, 'recovery');
  return f ? (f.codes || []).length + (f.legacy_codes || []).length : 0;
}

export async function startEnrollment(user) {
  const secret = randomSecret();
  db.users.update(user.id, { mfa_pending: { secret: seal(secret), expires: now() + ENROLL_TTL } });
  const otpauth = otpauthUri(secret, user.email, getSetting('app_name', 'open-quill') || 'open-quill');
  return { secret, otpauth, qr: await QRCode.toString(otpauth, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
}

function freshCodes(userId) {
  const codes = makeRecoveryCodes();
  const cur = factorOf(userId, 'recovery');
  if (cur) db.mfaFactors.removeById(cur.id);
  db.mfaFactors.insert({ id: uid(), user_id: userId, type: 'recovery', codes: codes.map(recoveryHash), created_at: now() });
  return codes;
}

export function confirmEnrollment(userId, code) {
  const pending = db.users.byId(userId)?.mfa_pending;
  const secret = pending && pending.expires > now() ? unseal(pending.secret) : null;
  if (!secret) return { status: 400, error: 'The setup key has expired. Start again.' };
  const step = totpStep(secret, code);
  if (step === null) return { status: 401, error: 'That code is not valid. Check your authenticator and try again.' };
  const codes = tx(() => {
    removeFactors(userId);
    db.mfaFactors.insert({ id: uid(), user_id: userId, type: 'totp', secret: seal(secret), last_step: step, created_at: now() });
    return freshCodes(userId);
  });
  return { ok: true, recoveryCodes: codes };
}

export const regenerateCodes = (userId) => tx(() => freshCodes(userId));

export function removeFactors(userId) {
  db.mfaFactors.removeWhere('user_id', userId);
  if (db.users.byId(userId)?.mfa_pending) db.users.update(userId, { mfa_pending: undefined });
}

function useTotp(userId, code) {
  const f = factorOf(userId, 'totp');
  const secret = f ? unseal(f.secret) : null;
  const step = secret ? totpStep(secret, code) : null;
  if (step === null || step <= (f.last_step ?? -1)) return false;
  db.mfaFactors.update(f.id, { last_step: step, last_used_at: now() });
  return true;
}

function useRecovery(userId, code) {
  const f = factorOf(userId, 'recovery');
  if (!f || !cleanRecovery(code)) return false;
  const h = recoveryHash(code);
  const legacy = hashRecovery(code);
  if ((f.codes || []).includes(h)) {
    db.mfaFactors.update(f.id, { codes: f.codes.filter(c => c !== h), last_used_at: now() });
    return true;
  }
  if ((f.legacy_codes || []).includes(legacy)) {
    db.mfaFactors.update(f.id, { legacy_codes: f.legacy_codes.filter(c => c !== legacy), last_used_at: now() });
    return true;
  }
  return false;
}

export function verifySecondFactor(userId, { code, recovery }) {
  if (code) return useTotp(userId, code) ? 'totp' : null;
  if (recovery) return useRecovery(userId, recovery) ? 'recovery' : null;
  return null;
}

export function issueChallenge(user, method) {
  return seal(JSON.stringify({ uid: user.id, method, nonce: crypto.randomBytes(16).toString('hex'), exp: now() + CHALLENGE_TTL }));
}

export function readChallenge(value) {
  let c;
  try { c = JSON.parse(unseal(value) || 'null'); } catch { return null; }
  if (!c || typeof c.uid !== 'string' || !(c.exp > now()) || spent.has(c.nonce)) return null;
  const user = db.users.byId(c.uid);
  return user ? { user, challenge: c } : null;
}

export function spendChallenge(c) {
  const t = now();
  for (const [nonce, exp] of spent) if (exp < t) spent.delete(nonce);
  spent.set(c.nonce, c.exp);
}

export const CHALLENGE_SECONDS = CHALLENGE_TTL / 1000;

function moveLegacyFactors() {
  const legacy = db.users.all().filter(u => u.totp_secret || u.totp_pending || u.recovery_codes || 'totp_enabled' in u);
  tx(() => {
    for (const u of legacy) {
      if (u.totp_enabled && u.totp_secret && !factorOf(u.id, 'totp')) {
        db.mfaFactors.insert({ id: uid(), user_id: u.id, type: 'totp', secret: seal(u.totp_secret), last_step: -1, created_at: now() });
        db.mfaFactors.insert({ id: uid(), user_id: u.id, type: 'recovery', codes: [], legacy_codes: Array.isArray(u.recovery_codes) ? u.recovery_codes : [], created_at: now() });
      }
      db.users.update(u.id, { totp_secret: undefined, totp_pending: undefined, totp_enabled: undefined, recovery_codes: undefined });
    }
  });
  setSetting('mfa_factors_v1', '1');
}

if (!getSetting('mfa_factors_v1')) moveLegacyFactors();