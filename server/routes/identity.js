import { db, setSetting, delSetting } from '../db.js';
import { authMiddleware } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import { requirePermission, requireOwner } from '../lib/authz/middleware.js';
import { isOwner, isActive, roleOf, gateOf } from '../lib/authz/effective.js';
import { PENDING } from '../lib/authz/roles.js';
import { MFA_POLICIES, mfaPolicy, hasTotp } from '../lib/identity/mfa.js';
import { broadcastAll } from '../lib/ws/index.js';
import { PROVIDER_TYPES, MAX_PROVIDERS, providers, providerById, newProvider, publicProvider, updateProvider, publicBase, cleanPublicUrl, clientConfig, forgetConfig } from '../lib/identity/providers.js';

function providersView(user) {
  return {
    providers: providers().map(publicProvider),
    publicUrl: publicBase(),
    publicUrlFromEnv: !!cleanPublicUrl(process.env.PUBLIC_URL),
    editable: isOwner(user)
  };
}

function saveProviders(list) {
  setSetting('auth_providers', list);
}

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

  app.get('/api/admin/auth/providers', authMiddleware, requirePermission('admin.users'), (req, res) => {
    res.json(providersView(req.user));
  });

  app.post('/api/admin/auth/providers', authMiddleware, requireOwner, (req, res) => {
    const type = req.body?.type;
    if (!PROVIDER_TYPES.includes(type)) return res.status(400).json({ error: 'Choose Google, Microsoft, GitHub or OpenID Connect.' });
    if (providers().length >= MAX_PROVIDERS) return res.status(400).json({ error: 'This server has as many sign-in providers as it can hold.' });
    const p = newProvider(type);
    saveProviders([...providers(), p]);
    logAudit(req, 'auth.provider_create', { meta: { provider: p.id, type } });
    res.json({ ...providersView(req.user), created: p.id });
  });

  app.patch('/api/admin/auth/providers/:id', authMiddleware, requireOwner, (req, res) => {
    const cur = providerById(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const r = updateProvider(cur, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    saveProviders(providers().map(p => (p.id === cur.id ? r.provider : p)));
    forgetConfig(cur.id);
    logAudit(req, 'auth.provider_update', { meta: { provider: cur.id, type: cur.type, enabled: r.provider.enabled, secretChanged: r.provider.secret !== cur.secret } });
    res.json(providersView(req.user));
  });

  app.delete('/api/admin/auth/providers/:id', authMiddleware, requireOwner, (req, res) => {
    const cur = providerById(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    saveProviders(providers().filter(p => p.id !== cur.id));
    db.identities.removeWhere('provider_id', cur.id);
    forgetConfig(cur.id);
    logAudit(req, 'auth.provider_delete', { meta: { provider: cur.id, type: cur.type } });
    res.json(providersView(req.user));
  });

  app.post('/api/admin/auth/providers/:id/test', authMiddleware, requireOwner, async (req, res) => {
    const cur = providerById(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    if (!cur.client_id || !cur.secret) return res.status(400).json({ error: 'Fill in the client ID and the secret first.' });
    try {
      const meta = (await clientConfig(cur)).serverMetadata();
      res.json({ ok: true, issuer: meta.issuer, authorization: meta.authorization_endpoint || '' });
    } catch {
      res.status(502).json({ error: 'The provider could not be reached, or its settings are not valid.' });
    }
  });

  app.put('/api/admin/auth/public-url', authMiddleware, requireOwner, (req, res) => {
    const raw = String(req.body?.url || '').trim();
    const url = cleanPublicUrl(raw);
    if (raw && !url) return res.status(400).json({ error: 'Enter the address people use to reach this server, for example https://chat.example.com.' });
    if (url) setSetting('auth_public_url', url);
    else delSetting('auth_public_url');
    logAudit(req, 'auth.public_url', { meta: { url } });
    res.json(providersView(req.user));
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