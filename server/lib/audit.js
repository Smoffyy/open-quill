import { db, uid, now } from '../db.js';

const AUDIT_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

export function clientIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '').trim().slice(0, 64);
}

export function logAudit(req, action, target = {}) {
  try {
    db.audit.insert({
      id: uid(), ts: now(), actor_id: req.user?.id || null,
      actor_email: req.user?.email || 'system', action,
      target_type: target.type || null, target_id: target.id || null,
      meta: target.meta || null, ip: clientIp(req)
    });
  } catch {}
}

export function pruneAudit() {
  try { db.audit.prune(now() - AUDIT_RETENTION_MS); } catch {}
}
