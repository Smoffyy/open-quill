import { db, uid, now } from '../db.js';

const AUDIT_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

// X-Forwarded-For is attacker-controlled unless something in front of this server
// rewrites it, so it is honoured only when the operator says a proxy is there. Reading
// it unconditionally would let any caller forge audit-log entries and, worse, hand
// themselves an unlimited number of login attempts by rotating the header.
const TRUST_PROXY = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''));

export function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd.slice(0, 64);
  }
  return String(req?.socket?.remoteAddress || '').trim().slice(0, 64);
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
