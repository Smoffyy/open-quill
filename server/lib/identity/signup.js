import crypto from 'crypto';
import { db, getSetting } from '../../db.js';

export const SIGNUP_POLICIES = ['open', 'approval', 'closed'];
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_DOMAINS = 100;

export function signupPolicy() {
  const v = getSetting('auth_signup_policy', 'open');
  return SIGNUP_POLICIES.includes(v) ? v : 'open';
}

export function signupDomains() {
  const v = getSetting('auth_signup_domains', []);
  return Array.isArray(v) ? v : [];
}

export function cleanDomains(list) {
  const raw = Array.isArray(list) ? list : String(list || '').split(/[\s,]+/);
  const out = raw.map(d => String(d || '').trim().toLowerCase().replace(/^@/, '')).filter(d => DOMAIN.test(d));
  return [...new Set(out)].slice(0, MAX_DOMAINS);
}

export function domainAllowed(email) {
  const domains = signupDomains();
  if (!domains.length) return true;
  const domain = String(email || '').slice(String(email || '').lastIndexOf('@') + 1).toLowerCase();
  return domains.includes(domain);
}

let setup = null;

export function setupToken() {
  if (db.users.count() !== 0) return null;
  if (!setup) setup = String(process.env.OPEN_QUILL_SETUP_TOKEN || '').trim() || crypto.randomBytes(18).toString('base64url');
  return setup;
}

export function setupTokenMatches(value) {
  const want = setupToken();
  if (!want) return false;
  const digest = (v) => crypto.createHash('sha256').update(String(v || '')).digest();
  return crypto.timingSafeEqual(digest(value), digest(want));
}

export function announceSetup() {
  const token = setupToken();
  if (!token) return;
  console.log(`[setup] No owner account yet. Setup token: ${token}`);
  console.log(`[setup] Enter it on the sign-in page, or open the app with ?setup=${token} at the end of its address.`);
}