import { db, setSetting } from '../db.js';
import { authMiddleware } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import { requirePermission, requireOwner } from '../lib/authz/middleware.js';
import { isOwner, isActive, roleOf, gateOf } from '../lib/authz/effective.js';
import { PENDING } from '../lib/authz/roles.js';
import { MFA_POLICIES, mfaPolicy, hasTotp } from '../lib/identity/mfa.js';
import { broadcastAll } from '../lib/ws/index.js';

function mfaView(user) {
  const active = db.users.all().filter(u => isActive(u) && roleOf(u) !== PENDING);
  return {
    policy: mfaPolicy(),
    editable: isOwner(user),
    total: active.length,
    enrolled: active.filter(u => hasTotp(u.id)).length,
    owing: active.filter(u => gateOf(u) === 'mfa').length
  };
}
import { SIGNUP_POLICIES, signupPolicy, signupDomains, cleanDomains } from '../lib/identity/signup.js';

export default function registerIdentityRoutes(app) {
  app.get('/api/admin/auth/signup', authMiddleware, requirePermission('admin.users'), (req, res) => {
    res.json({ policy: signupPolicy(), domains: signupDomains(), editable: isOwner(req.user) });
  });

  app.put('/api/admin/auth/signup', authMiddleware, requireOwner, (req, res) => {
    const b = req.body || {};
    if ('policy' in b) {
      if (!SIGNUP_POLICIES.includes(b.policy)) return res.status(400).json({ error: 'Choose open, approval or closed.' });
      setSetting('auth_signup_policy', b.policy);
    }
    if ('domains' in b) setSetting('auth_signup_domains', cleanDomains(b.domains));
    logAudit(req, 'auth.signup_policy', { meta: { policy: signupPolicy(), domains: signupDomains().length } });
    res.json({ policy: signupPolicy(), domains: signupDomains(), editable: true });
  });

  app.get('/api/admin/auth/mfa', authMiddleware, requirePermission('admin.users'), (req, res) => {
    res.json(mfaView(req.user));
  });

  app.put('/api/admin/auth/mfa', authMiddleware, requireOwner, (req, res) => {
    const policy = req.body?.policy;
    if (!MFA_POLICIES.includes(policy)) return res.status(400).json({ error: 'Choose optional, admins or everyone.' });
    if (policy !== 'optional' && !hasTotp(req.user.id)) return res.status(400).json({ error: 'Set up two-factor on your own account first.' });
    setSetting('auth_mfa_policy', policy);
    logAudit(req, 'auth.mfa_policy', { meta: { policy } });
    broadcastAll({ type: 'account' });
    res.json(mfaView(req.user));
  });
}