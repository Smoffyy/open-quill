import { db } from '../db.js';

const DEVICES = new Set(['phone', 'desktop']);
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

function validZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

export function cleanClient(raw) {
  const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    timeZone: validZone(c.timeZone) ? c.timeZone : '',
    language: typeof c.language === 'string' && LANG_RE.test(c.language) ? c.language : '',
    device: DEVICES.has(c.device) ? c.device : ''
  };
}

export function rememberClient(user, client) {
  if (!user || !client) return;
  const saved = user.client_ctx || {};
  const next = { timeZone: client.timeZone || saved.timeZone || '', language: client.language || saved.language || '' };
  if (next.timeZone === (saved.timeZone || '') && next.language === (saved.language || '')) return;
  db.users.update(user.id, { client_ctx: next });
}

export function memberContext(user, client) {
  const saved = cleanClient(user?.client_ctx);
  const now = cleanClient(client);
  return {
    timeZone: now.timeZone || saved.timeZone,
    language: now.language || saved.language,
    device: now.device
  };
}

export function languageName(code) {
  if (!code) return '';
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return code; }
}