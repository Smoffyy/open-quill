import { setSetting } from '../db.js';
import { authMiddleware } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import { requirePermission, requireOwner } from '../lib/authz/middleware.js';
import { isOwner } from '../lib/authz/effective.js';
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
}