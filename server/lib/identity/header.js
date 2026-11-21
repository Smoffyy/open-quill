import net from 'net';
import crypto from 'crypto';
import { db, uid, now } from '../../db.js';
import { PENDING, USER } from '../authz/roles.js';

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVISIONING = ['pending', 'user', 'off'];
export const SECRET_HEADER = 'x-openquill-proxy-secret';
export const HEADER_PROVIDER = 'header';

function headerName(env, key, required) {
  const v = String(env[key] || '').trim();
  if (!v) return required ? { error: `${key} must name the header the proxy sends.` } : { name: '' };
  return HEADER_NAME.test(v) ? { name: v.toLowerCase() } : { error: `${key} is not a valid header name.` };
}

export function parseHeaderConfig(env) {
  if (String(env.TRUSTED_HEADER_AUTH || '').trim().toLowerCase() !== 'on') return { enabled: false, error: '' };
  const fail = (error) => ({ enabled: false, error });
  const list = String(env.TRUSTED_HEADER_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) return fail('TRUSTED_HEADER_PROXIES must list the proxy addresses.');
  const proxies = new net.BlockList();
  for (const entry of list) {
    const [addr, bits, extra] = entry.split('/');
    const family = net.isIP(addr);
    if (!family || extra !== undefined) return fail(`TRUSTED_HEADER_PROXIES has an invalid entry: ${entry}`);
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) {
      proxies.addAddress(addr, type);
      continue;
    }
    const prefix = Number(bits);
    if (!/^\d{1,3}$/.test(bits) || prefix > (family === 6 ? 128 : 32)) return fail(`TRUSTED_HEADER_PROXIES has an invalid entry: ${entry}`);
    if (prefix === 0) return fail('TRUSTED_HEADER_PROXIES cannot trust every address.');
    proxies.addSubnet(addr, prefix, type);
  }
  const secret = String(env.TRUSTED_HEADER_SECRET || '');
  if (secret.length < 32) return fail('TRUSTED_HEADER_SECRET must be at least 32 characters.');
  const email = headerName(env, 'TRUSTED_HEADER_EMAIL', true);
  const name = headerName(env, 'TRUSTED_HEADER_NAME', false);
  const groups = headerName(env, 'TRUSTED_HEADER_GROUPS', false);
  const bad = [email, name, groups].find(h => h.error);
  if (bad) return fail(bad.error);
  const provision = String(env.TRUSTED_HEADER_PROVISION || 'pending').trim().toLowerCase();
  if (!PROVISIONING.includes(provision)) return fail('TRUSTED_HEADER_PROVISION must be pending, user or off.');
  return {
    enabled: true, error: '', proxies, proxyList: list, secret: Buffer.from(secret),
    emailHeader: email.name, nameHeader: name.name, groupsHeader: groups.name, provision,
    link: String(env.TRUSTED_HEADER_LINK || '').trim().toLowerCase() === 'on'
  };
}

const config = parseHeaderConfig(process.env);
if (config.error) console.error('[auth] trusted header sign-in is off: ' + config.error);

export function headerStatus() {
  return {
    enabled: config.enabled, error: config.error, proxies: config.proxyList || [], emailHeader: config.emailHeader || '',
    nameHeader: config.nameHeader || '', groupsHeader: config.groupsHeader || '', provision: config.provision || '', link: !!config.link
  };
}

export function trustedPeer(cfg, address) {
  const addr = String(address || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  const family = net.isIP(addr);
  return !!family && cfg.proxies.check(addr, family === 6 ? 'ipv6' : 'ipv4');
}

export function readHeaderIdentity(cfg, req) {
  if (!cfg.enabled) return null;
  const raw = req.headers[cfg.emailHeader];
  if (!raw) return null;
  const given = Buffer.from(String(req.headers[SECRET_HEADER] || ''));
  const trusted = trustedPeer(cfg, req.socket?.remoteAddress) && given.length === cfg.secret.length && crypto.timingSafeEqual(given, cfg.secret);
  if (!trusted) return { refused: true };
  const email = String(raw).trim().toLowerCase();
  if (email.length > 320 || !EMAIL.test(email)) return null;
  return {
    email,
    name: cfg.nameHeader ? String(req.headers[cfg.nameHeader] || '').trim().slice(0, 80) : '',
    groups: cfg.groupsHeader ? String(req.headers[cfg.groupsHeader] || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 200) : null
  };
}

export const headerIdentity = (req) => readHeaderIdentity(config, req);

export function headerAccount(ident) {
  const linked = db.identities.find(HEADER_PROVIDER, ident.email);
  if (linked) return { user: db.users.byId(linked.user_id) || null };
  const link = (user) => db.identities.insert({ id: uid(), provider_id: HEADER_PROVIDER, subject: ident.email, user_id: user.id, email: ident.email, linked_at: now(), last_login_at: now() });
  const known = db.users.byEmail(ident.email);
  if (known) {
    if (!config.link) return { user: null };
    link(known);
    return { user: known, linked: true };
  }
  if (config.provision === 'off') return { user: null };
  const user = db.users.insert({
    id: uid(), email: ident.email, display_name: ident.name, role: config.provision === 'user' ? USER : PENDING,
    status: 'active', source: HEADER_PROVIDER, prefs: {}, created_at: now()
  });
  link(user);
  return { user, created: true };
}