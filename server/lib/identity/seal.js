import crypto from 'crypto';
import { deriveKey } from '../../db.js';

const SEAL_KEY = deriveKey('seal v1');
const HASH_KEY = deriveKey('hash v1');

export function seal(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SEAL_KEY, iv);
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unseal(value) {
  if (typeof value !== 'string' || !value.startsWith('v1.')) return null;
  try {
    const raw = Buffer.from(value.slice(3), 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', SEAL_KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const keyedHash = (purpose, text) => crypto.createHmac('sha256', HASH_KEY).update(purpose + ':' + String(text)).digest('hex');