import * as oidc from 'openid-client';
import { db, uid, now } from '../../db.js';
import { seal, unseal } from './seal.js';
import { clientConfig, callbackUrl, scopesOf, GITHUB_API } from './providers.js';
import { signupDomains } from './signup.js';
import { permissionsOfRole, PENDING, USER } from '../authz/roles.js';
import { tierOf, ADMIN } from '../authz/permissions.js';
import { roleOf } from '../authz/effective.js';

const FLOW_TTL = 10 * 60 * 1000;
export const FLOW_SECONDS = FLOW_TTL / 1000;

export function safeReturn(path) {
  const p = String(path || '');
  return /^\/(?![/\\])[\w\-./?=&%#]*$/.test(p) && p.length <= 300 ? p : '/';
}

export async function startFlow(p, { intent, returnTo, sessionId }) {
  const config = await clientConfig(p);
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = p.type === 'github' ? null : oidc.randomNonce();
  const params = {
    redirect_uri: callbackUrl(p), scope: scopesOf(p), state,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256'
  };
  if (nonce) params.nonce = nonce;
  if (p.type === 'google' && p.domains.length === 1) params.hd = p.domains[0];
  if (p.type === 'microsoft') params.prompt = 'select_account';
  const url = oidc.buildAuthorizationUrl(config, params);
  const flow = seal(JSON.stringify({ p: p.id, state, nonce, verifier, intent, ret: safeReturn(returnTo), sid: sessionId || null, exp: Date.now() + FLOW_TTL }));
  return { url: url.href, flow };
}

export function readFlow(value, providerId) {
  let flow;
  try { flow = JSON.parse(unseal(value) || 'null'); } catch { return null; }
  return flow && flow.p === providerId && flow.exp > Date.now() ? flow : null;
}

async function githubIdentity(p, config, tokens) {
  const get = (path) => config[oidc.customFetch](GITHUB_API + path, {
    headers: { Authorization: 'Bearer ' + tokens.access_token, Accept: 'application/vnd.github+json', 'User-Agent': 'open-quill' }
  });
  const user = await (await get('/user')).json();
  const emails = await (await get('/user/emails')).json();
  const primary = Array.isArray(emails) ? emails.find(e => e && e.primary && e.verified) : null;
  let allowed = true;
  if (p.github_org) {
    const r = await get('/user/memberships/orgs/' + encodeURIComponent(p.github_org));
    allowed = r.status === 200 && (await r.json()).state === 'active';
  }
  if (!user || !Number.isInteger(user.id)) throw new Error('github_no_account');
  return { subject: String(user.id), email: String(primary?.email || '').toLowerCase(), emailVerified: !!primary, name: String(user.name || user.login || ''), groups: [], allowed };
}

async function oidcIdentity(p, config, tokens) {
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error('idp_no_id_token');
  if (p.type === 'microsoft') {
    if (claims.tid !== p.tenant || !claims.oid) throw new Error('idp_wrong_tenant');
    return {
      subject: `${claims.tid}:${claims.oid}`, email: String(claims.email || claims.preferred_username || '').toLowerCase(),
      emailVerified: claims.xms_edov === true, name: String(claims.name || ''), groups: Array.isArray(claims.groups) ? claims.groups.map(String) : [], allowed: true
    };
  }
  if (p.type === 'google') {
    return {
      subject: claims.sub, email: String(claims.email || '').toLowerCase(), emailVerified: claims.email_verified === true,
      name: String(claims.name || ''), groups: [], allowed: !p.domains.length || p.domains.includes(String(claims.hd || ''))
    };
  }
  let info = claims;
  const wantsGroups = (p.sync_groups || p.required_group) && !(p.groups_claim in claims);
  if ((!claims.email || wantsGroups) && config.serverMetadata().userinfo_endpoint) {
    info = { ...(await oidc.fetchUserInfo(config, tokens.access_token, claims.sub)), ...claims };
  }
  const raw = info[p.groups_claim];
  const groups = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' && raw ? [raw] : [];
  return {
    subject: claims.sub, email: String(info.email || '').toLowerCase(), emailVerified: info.email_verified === true,
    name: String(info.name || info.preferred_username || ''), groups, allowed: !p.required_group || groups.includes(p.required_group)
  };
}

export async function finishFlow(p, flow, currentUrl) {
  const config = await clientConfig(p);
  const checks = { pkceCodeVerifier: flow.verifier, expectedState: flow.state };
  if (flow.nonce) Object.assign(checks, { expectedNonce: flow.nonce, idTokenExpected: true });
  const tokens = await oidc.authorizationCodeGrant(config, currentUrl, checks);
  return p.type === 'github' ? githubIdentity(p, config, tokens) : oidcIdentity(p, config, tokens);
}

export const holdsAdmin = (user) => [...permissionsOfRole(roleOf(user))].some(id => tierOf(id) === ADMIN);
const domainOf = (email) => email.slice(email.lastIndexOf('@') + 1);

function domainOk(p, email) {
  const list = p.domains.length ? p.domains : signupDomains();
  return !list.length || list.includes(domainOf(email));
}

function link(p, identity, userId) {
  return db.identities.insert({ id: uid(), provider_id: p.id, subject: identity.subject, user_id: userId, email: identity.email, linked_at: now(), last_login_at: now() });
}

export function resolveAccount(p, identity, intent, linkUser) {
  const existing = db.identities.find(p.id, identity.subject);
  if (intent === 'link') {
    if (!linkUser) return { error: 'link_session' };
    if (existing && existing.user_id !== linkUser.id) return { error: 'linked_elsewhere' };
    if (!existing) link(p, identity, linkUser.id);
    return { user: linkUser, linked: true };
  }
  if (existing) {
    const user = db.users.byId(existing.user_id);
    if (!user) return { error: 'no_account' };
    db.identities.update(existing.id, { email: identity.email, last_login_at: now() });
    return { user };
  }
  if (!identity.email || !identity.email.includes('@')) return { error: 'no_email' };
  if (!domainOk(p, identity.email)) return { error: 'domain' };
  const known = db.users.byEmail(identity.email);
  if (known) {
    const linkable = p.link_by_email && identity.emailVerified && !known.password_hash
      && db.identities.where('user_id', known.id).length === 0 && !holdsAdmin(known);
    if (!linkable) return { error: 'account_exists' };
    link(p, identity, known.id);
    return { user: known, linked: true };
  }
  if (p.provision === 'off') return { error: 'no_account' };
  if (!identity.emailVerified && p.type !== 'microsoft') return { error: 'unverified' };
  const user = db.users.insert({
    id: uid(), email: identity.email, display_name: identity.name.slice(0, 80), role: p.provision === 'user' ? USER : PENDING,
    status: 'active', source: p.source || 'sso:' + p.id, prefs: {}, created_at: now()
  });
  link(p, identity, user.id);
  return { user, created: true };
}