import { db, now } from '../db.js';
import { sign, sessionFromRequest, createSession, sessionMaxAgeSeconds } from '../auth.js';
import { isActive } from '../lib/authz/effective.js';
import { logAudit, clientIp } from '../lib/audit.js';
import { enabledProviders, publicBase } from '../lib/identity/providers.js';
import { startFlow, readFlow, finishFlow, resolveAccount, FLOW_SECONDS } from '../lib/identity/sso.js';
import { hasTotp, issueChallenge, CHALLENGE_SECONDS } from '../lib/identity/mfa.js';
import { sessionCookie, challengeCookie, flowCookie, FLOW_COOKIE } from '../lib/identity/cookies.js';
import { syncExternalGroups } from '../lib/authz/groups.js';
import { broadcastAll } from '../lib/ws/index.js';
import { throttle, rateLimiter } from '../lib/ratelimit.js';

const enabledById = (id) => enabledProviders().find(p => p.id === id) || null;
const starts = throttle(rateLimiter({ windowMs: 60000, max: 30 }), 'Too many attempts. Try again in a few minutes.', (req) => clientIp(req));

export default function registerSsoRoutes(app) {
  app.post('/api/auth/sso/:id/start', starts, async (req, res) => {
    const p = enabledById(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    if (!publicBase()) return res.status(503).json({ error: 'Single sign-on needs the server’s public address. Ask the owner to set it.' });
    const intent = req.body?.intent === 'link' ? 'link' : 'login';
    const session = intent === 'link' ? sessionFromRequest(req) : null;
    if (intent === 'link' && !session) return res.status(401).json({ error: 'unauthorized' });
    try {
      const { url, flow } = await startFlow(p, { intent, returnTo: req.body?.returnTo, sessionId: session?.sessionId });
      flowCookie(req, res, flow, FLOW_SECONDS);
      res.json({ url });
    } catch {
      res.status(502).json({ error: 'The sign-in provider could not be reached. Try again later.' });
    }
  });

  app.get('/api/auth/sso/:id/callback', async (req, res) => {
    const leave = (path) => { flowCookie(req, res, ''); res.redirect(302, path); };
    const fail = (code) => leave('/?sso_error=' + code);
    const p = enabledById(req.params.id);
    const flow = p ? readFlow(req.cookies?.[FLOW_COOKIE], p.id) : null;
    if (!p || !flow) return fail('expired');
    let identity;
    try {
      identity = await finishFlow(p, flow, new URL(req.originalUrl, publicBase()));
    } catch {
      return fail('failed');
    }
    if (!identity.allowed) return fail('not_allowed');
    let linkUser = null;
    if (flow.intent === 'link') {
      const current = sessionFromRequest(req);
      if (!current || current.sessionId !== flow.sid) return fail('link_session');
      linkUser = current.user;
    }
    const r = resolveAccount(p, identity, flow.intent, linkUser);
    if (r.error) {
      logAudit(req, 'auth.sso_refused', { meta: { provider: p.id, reason: r.error } });
      return fail(r.error);
    }
    const u = r.user;
    req.user = u;
    if (r.created) {
      logAudit(req, 'user.provision', { type: 'user', id: u.id, meta: { email: u.email, provider: p.id, role: u.role } });
      broadcastAll({ type: 'account' });
    }
    if (r.linked) logAudit(req, 'account.identity_link', { type: 'user', id: u.id, meta: { provider: p.id } });
    if (flow.intent === 'link') return leave(flow.ret + (flow.ret.includes('?') ? '&' : '?') + 'sso=linked');
    if (!isActive(u)) return fail('disabled');
    if (p.sync_groups) syncExternalGroups(u.id, 'sso:' + p.id, identity.groups);
    if (p.require_mfa && hasTotp(u.id)) {
      challengeCookie(req, res, issueChallenge(u, 'sso:' + p.id), CHALLENGE_SECONDS);
      return leave('/?mfa=1');
    }
    const sid = createSession(u, req, 'sso:' + p.id, p.require_mfa ? null : 'idp');
    sessionCookie(req, res, sign(u, sid), sessionMaxAgeSeconds());
    db.users.update(u.id, { last_login_at: now() });
    logAudit(req, 'auth.login', { type: 'user', id: u.id, meta: { method: 'sso', provider: p.id } });
    leave(flow.ret);
  });
}