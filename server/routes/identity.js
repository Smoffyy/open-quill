import { db, setSetting, delSetting } from '../db.js';
import { authMiddleware } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import { requirePermission, requireOwner } from '../lib/authz/middleware.js';
import { isOwner, isActive, roleOf, gateOf } from '../lib/authz/effective.js';
import { PENDING } from '../lib/authz/roles.js';
import { MFA_POLICIES, mfaPolicy, hasTotp } from '../lib/identity/mfa.js';
import { broadcastAll } from '../lib/ws/index.js';
import { headerStatus } from '../lib/identity/header.js';
import { publicLdap, updateLdap, testLdap, lookupLdap, syncLdap } from '../lib/identity/ldap.js';
import { scimConfig, updateScim, tokenList, createToken, revokeToken } from '../lib/scim/config.js';
import { isHttps } from '../lib/origin.js';
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
    res.json({ ...providersView(req.user), header: headerStatus() });
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

  app.get('/api/admin/auth/ldap', authMiddleware, requirePermission('admin.users'), (req, res) => {
    res.json({ ...publicLdap(), editable: isOwner(req.user) });
  });

  app.put('/api/admin/auth/ldap', authMiddleware, requireOwner, (req, res) => {
    const r = updateLdap(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    setSetting('auth_ldap', r.config);
    logAudit(req, 'auth.ldap_update', { meta: { enabled: r.config.enabled, url: r.config.url, provision: r.config.provision } });
    res.json({ ...publicLdap(), editable: true });
  });

  app.post('/api/admin/auth/ldap/test', authMiddleware, requireOwner, async (req, res) => {
    try {
      res.json(await testLdap());
    } catch {
      res.status(502).json({ error: 'The directory could not be reached, or it refused the service account.' });
    }
  });

  app.post('/api/admin/auth/ldap/lookup', authMiddleware, requireOwner, async (req, res) => {
    const username = String(req.body?.username || '').trim().slice(0, 256);
    if (!username) return res.status(400).json({ error: 'Enter a username to look up.' });
    try {
      res.json(await lookupLdap(username));
    } catch {
      res.status(502).json({ error: 'The directory could not be reached, or it refused the service account.' });
    }
  });

  app.post('/api/admin/auth/ldap/sync', authMiddleware, requireOwner, async (req, res) => {
    const report = await syncLdap();
    logAudit(req, 'auth.ldap_sync', { meta: { ok: report.ok, checked: report.checked, updated: report.updated, disabled: report.disabled, missing: report.missing } });
    if (report.updated || report.disabled) broadcastAll({ type: 'account' });
    res.json(report);
  });

  function scimView(req) {
    const base = publicBase() || `${isHttps(req) ? 'https' : 'http'}://${req.get('host')}`;
    const recent = db.audit.query({ action: 'scim.', actor: '', category: '', since: 0, limit: 20, offset: 0 })
      .map(r => ({ id: r.id, ts: r.ts, action: r.action, actor: r.actor_email || '', meta: r.meta || null }));
    return {
      ...scimConfig(), baseUrl: `${base}/scim/v2`, baseFromRequest: !publicBase(), tokens: tokenList(), recent,
      managed: db.users.bySource('scim').length, editable: isOwner(req.user)
    };
  }

  app.get('/api/admin/auth/scim', authMiddleware, requirePermission('admin.users'), (req, res) => {
    res.json(scimView(req));
  });

  app.put('/api/admin/auth/scim', authMiddleware, requireOwner, (req, res) => {
    const next = updateScim(req.body || {});
    setSetting('auth_scim', next);
    logAudit(req, 'auth.scim_update', { meta: next });
    res.json(scimView(req));
  });

  app.post('/api/admin/auth/scim/tokens', authMiddleware, requireOwner, (req, res) => {
    const r = createToken(req.body || {}, req.user);
    if (r.error) return res.status(400).json({ error: r.error });
    logAudit(req, 'auth.scim_token_create', { meta: { name: String(req.body?.name || '').slice(0, 80) } });
    res.json({ ...scimView(req), token: r.token });
  });

  app.delete('/api/admin/auth/scim/tokens/:id', authMiddleware, requireOwner, (req, res) => {
    const row = revokeToken(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    logAudit(req, 'auth.scim_token_revoke', { meta: { name: row.name } });
    res.json(scimView(req));
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