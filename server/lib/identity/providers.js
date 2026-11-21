import * as oidc from 'openid-client';
import { getSetting, uid } from '../../db.js';
import { seal, unseal } from './seal.js';
import { identityFetch, secureEnough } from './idpfetch.js';
import { cleanDomains } from './signup.js';

export const PROVIDER_TYPES = ['google', 'microsoft', 'github', 'oidc'];
export const PROVISIONING = ['off', 'pending', 'user'];
export const GITHUB_API = 'https://api.github.com';

const LABELS = { google: 'Google', microsoft: 'Microsoft', github: 'GitHub', oidc: 'Single sign-on' };
const GITHUB = { issuer: 'https://github.com', authorization_endpoint: 'https://github.com/login/oauth/authorize', token_endpoint: 'https://github.com/login/oauth/access_token' };
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM = /^[\w.:-]{1,64}$/;
const SCOPE = /^[\w:./-]{1,64}$/;
const ORG = /^[A-Za-z0-9-]{1,39}$/;
const CONFIG_TTL = 10 * 60 * 1000;
export const MAX_PROVIDERS = 20;

export function providers() {
  const v = getSetting('auth_providers', []);
  return Array.isArray(v) ? v : [];
}

export const providerById = (id) => providers().find(p => p.id === id) || null;
export const enabledProviders = () => providers().filter(p => p.enabled && p.client_id && p.secret);

export function cleanPublicUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash && !u.username ? u.origin : '';
  } catch {
    return '';
  }
}

export const publicBase = () => cleanPublicUrl(process.env.PUBLIC_URL) || cleanPublicUrl(getSetting('auth_public_url', ''));
export const callbackUrl = (p) => (publicBase() ? `${publicBase()}/api/auth/sso/${p.id}/callback` : '');

export function issuerOf(p) {
  if (p.type === 'google') return 'https://accounts.google.com';
  if (p.type === 'microsoft') return p.tenant ? `https://login.microsoftonline.com/${p.tenant}/v2.0` : '';
  if (p.type === 'github') return GITHUB.issuer;
  return p.issuer || '';
}

export function newProvider(type) {
  return {
    id: uid(), type, label: LABELS[type], client_id: '', secret: '', issuer: '', tenant: '', domains: [], scopes: '',
    auth_method: 'post', link_by_email: false, provision: 'off', require_mfa: false, sync_groups: false,
    groups_claim: 'groups', required_group: '', github_org: '', enabled: false
  };
}

export function publicProvider(p) {
  return {
    id: p.id, type: p.type, label: p.label, clientId: p.client_id, hasSecret: !!p.secret, issuer: issuerOf(p), tenant: p.tenant,
    domains: p.domains, scopes: p.scopes, authMethod: p.auth_method, linkByEmail: p.link_by_email, provision: p.provision,
    requireMfa: p.require_mfa, syncGroups: p.sync_groups, groupsClaim: p.groups_claim, requiredGroup: p.required_group,
    githubOrg: p.github_org, enabled: p.enabled, callback: callbackUrl(p)
  };
}

export function updateProvider(cur, b) {
  const next = { ...cur };
  if ('label' in b) next.label = String(b.label || '').trim().slice(0, 40) || LABELS[cur.type];
  if ('clientId' in b) next.client_id = String(b.clientId || '').trim().slice(0, 300);
  if (typeof b.clientSecret === 'string' && b.clientSecret.trim()) next.secret = seal(b.clientSecret.trim().slice(0, 500));
  if ('domains' in b) next.domains = cleanDomains(b.domains);
  if ('linkByEmail' in b) next.link_by_email = b.linkByEmail === true;
  if ('provision' in b) next.provision = PROVISIONING.includes(b.provision) ? b.provision : 'off';
  if ('requireMfa' in b) next.require_mfa = b.requireMfa === true;
  if ('enabled' in b) next.enabled = b.enabled === true;
  if (cur.type === 'microsoft' && 'tenant' in b) {
    const tenant = String(b.tenant || '').trim().toLowerCase();
    if (tenant && !GUID.test(tenant)) return { error: 'Enter the directory (tenant) ID, a GUID from the app registration.' };
    next.tenant = tenant;
  }
  if (cur.type === 'oidc') {
    if ('issuer' in b) {
      const raw = String(b.issuer || '').trim().replace(/\/+$/, '');
      let url;
      try { url = raw ? new URL(raw) : null; } catch { url = null; }
      if (raw && (!url || !secureEnough(url) || url.search || url.hash)) return { error: 'The issuer must be an https address.' };
      next.issuer = url ? url.href.replace(/\/+$/, '') : '';
    }
    if ('scopes' in b) next.scopes = String(b.scopes || '').split(/\s+/).filter(s => SCOPE.test(s)).slice(0, 12).join(' ');
    if ('authMethod' in b) next.auth_method = b.authMethod === 'basic' ? 'basic' : 'post';
    if ('syncGroups' in b) next.sync_groups = b.syncGroups === true;
    if ('groupsClaim' in b) next.groups_claim = CLAIM.test(String(b.groupsClaim || '')) ? String(b.groupsClaim) : 'groups';
    if ('requiredGroup' in b) next.required_group = String(b.requiredGroup || '').trim().slice(0, 120);
  }
  if (cur.type === 'github' && 'githubOrg' in b) {
    const org = String(b.githubOrg || '').trim();
    if (org && !ORG.test(org)) return { error: 'Enter the organization’s login, for example acme.' };
    next.github_org = org;
  }
  if (next.enabled && (!next.client_id || !next.secret || !issuerOf(next))) return { error: 'Fill in the client ID, the secret and the issuer before turning this on.' };
  return { provider: next };
}

export function scopesOf(p) {
  if (p.type === 'github') return p.github_org ? 'read:user user:email read:org' : 'read:user user:email';
  const extra = p.type === 'oidc' ? p.scopes.split(' ').filter(Boolean) : [];
  return [...new Set(['openid', 'email', 'profile', ...extra])].join(' ');
}

const configs = new Map();

export async function clientConfig(p) {
  const key = JSON.stringify([p.type, issuerOf(p), p.client_id, p.secret, p.auth_method]);
  const hit = configs.get(p.id);
  if (hit && hit.key === key && Date.now() - hit.at < CONFIG_TTL) return hit.config;
  const secret = unseal(p.secret);
  const auth = p.auth_method === 'basic' ? oidc.ClientSecretBasic(secret) : oidc.ClientSecretPost(secret);
  let config;
  if (p.type === 'github') {
    config = new oidc.Configuration(GITHUB, p.client_id, secret, auth);
  } else {
    const issuer = new URL(issuerOf(p));
    const insecure = issuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : [];
    config = await oidc.discovery(issuer, p.client_id, secret, auth, { [oidc.customFetch]: identityFetch(new Set([issuer.host])), execute: insecure });
  }
  const meta = config.serverMetadata();
  const hosts = new Set();
  for (const field of ['issuer', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint']) {
    if (!meta[field]) continue;
    const url = new URL(meta[field]);
    if (!secureEnough(url)) throw new Error('idp_insecure_endpoint');
    hosts.add(url.host);
  }
  if (p.type === 'github') hosts.add(new URL(GITHUB_API).host);
  config[oidc.customFetch] = identityFetch(hosts);
  configs.set(p.id, { key, config, at: Date.now() });
  return config;
}

export const forgetConfig = (id) => configs.delete(id);