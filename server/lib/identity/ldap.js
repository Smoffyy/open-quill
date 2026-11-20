import { Client } from 'ldapts';
import { db, now, getSetting, setSetting } from '../../db.js';
import { seal, unseal } from './seal.js';
import { resolveAccount } from './sso.js';
import { syncExternalGroups } from '../authz/groups.js';
import { setStatus } from '../authz/accounts.js';
import { DISABLED } from '../authz/effective.js';

export const LDAP_PROVIDER = 'ldap';
const SECURITY = ['ldaps', 'starttls', 'none'];
const PROVISIONING = ['off', 'pending', 'user'];
const GROUP_MODES = ['none', 'memberOf', 'search'];
const ATTR = /^[A-Za-z][\w-]{0,63}$/;
const SYNC_CHECK_MS = 10 * 60 * 1000;
const SYNC_EMPTY = 'The directory returned no accounts, so nothing was changed.';
const SYNC_TOO_MANY = 'The sync would disable more accounts than allowed, so nothing was changed.';
const SYNC_UNREACHABLE = 'The directory could not be reached, so nothing was changed.';

export const PRESETS = {
  openldap: {
    user_filter: '(&(objectClass=inetOrgPerson)(uid={{username}}))',
    attrs: { login: 'uid', email: 'mail', name: 'cn', id: 'entryUUID' },
    group_mode: 'search', group_filter: '(&(objectClass=groupOfNames)(member={{dn}}))', group_name_attr: 'cn'
  },
  activedirectory: {
    user_filter: '(&(objectCategory=person)(objectClass=user)(|(sAMAccountName={{username}})(userPrincipalName={{username}})))',
    attrs: { login: 'sAMAccountName', email: 'mail', name: 'displayName', id: 'objectGUID' },
    group_mode: 'memberOf', group_filter: '(&(objectClass=group)(member={{dn}}))', group_name_attr: 'cn'
  }
};

const DEFAULTS = {
  enabled: false, url: '', security: 'ldaps', ca: '', bind_dn: '', bind_password: '', user_base: '', group_base: '',
  ...PRESETS.openldap, provision: 'off', link_by_email: false, timeout_ms: 8000, sync_hours: 0, sync_disable: false, sync_max_disable_pct: 10
};

export function ldapConfig() {
  const stored = getSetting('auth_ldap', null) || {};
  return { ...DEFAULTS, ...stored, attrs: { ...DEFAULTS.attrs, ...(stored.attrs || {}) } };
}

export const ldapEnabled = () => {
  const c = ldapConfig();
  return c.enabled && !!c.url && !!c.user_base;
};

export function escapeFilter(value) {
  return String(value).replace(/[\\*()\0]/g, ch => '\\' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
}

export function firstRdnValue(dn) {
  const s = String(dn || '');
  let out = '';
  let started = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!started) {
      if (ch === '=') started = true;
      continue;
    }
    if (ch === '\\' && i + 1 < s.length) {
      const hex = s.slice(i + 1, i + 3);
      if (/^[0-9a-f]{2}$/i.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 2; }
      else { out += s[i + 1]; i += 1; }
      continue;
    }
    if (ch === ',' || ch === '+') break;
    out += ch;
  }
  return out.trim();
}

const isLoopbackHost = (host) => host === 'localhost' || host === '[::1]' || /^127\./.test(host);

export function publicLdap(c = ldapConfig()) {
  return {
    enabled: c.enabled, url: c.url, security: c.security, ca: c.ca, bindDn: c.bind_dn, hasPassword: !!c.bind_password,
    userBase: c.user_base, userFilter: c.user_filter, attrs: c.attrs, groupMode: c.group_mode, groupBase: c.group_base,
    groupFilter: c.group_filter, groupNameAttr: c.group_name_attr, provision: c.provision, linkByEmail: c.link_by_email,
    timeoutMs: c.timeout_ms, syncHours: c.sync_hours, syncDisable: c.sync_disable, syncMaxDisablePct: c.sync_max_disable_pct,
    lastSync: getSetting('auth_ldap_last_sync', null),
    presets: Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, {
      userFilter: p.user_filter, attrs: p.attrs, groupMode: p.group_mode, groupFilter: p.group_filter, groupNameAttr: p.group_name_attr
    }]))
  };
}

export function updateLdap(b) {
  const next = ldapConfig();
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  if (b.preset && PRESETS[b.preset]) Object.assign(next, PRESETS[b.preset], { attrs: { ...PRESETS[b.preset].attrs } });
  if ('url' in b) next.url = text(b.url, 300);
  if ('security' in b) next.security = SECURITY.includes(b.security) ? b.security : 'ldaps';
  if ('ca' in b) next.ca = text(b.ca, 20000);
  if ('bindDn' in b) next.bind_dn = text(b.bindDn, 500);
  if (typeof b.bindPassword === 'string' && b.bindPassword) next.bind_password = seal(b.bindPassword.slice(0, 500));
  if (b.clearBindPassword === true) next.bind_password = '';
  if ('userBase' in b) next.user_base = text(b.userBase, 500);
  if ('userFilter' in b) next.user_filter = text(b.userFilter, 1000);
  if ('groupMode' in b) next.group_mode = GROUP_MODES.includes(b.groupMode) ? b.groupMode : 'none';
  if ('groupBase' in b) next.group_base = text(b.groupBase, 500);
  if ('groupFilter' in b) next.group_filter = text(b.groupFilter, 1000);
  if ('groupNameAttr' in b) next.group_name_attr = text(b.groupNameAttr, 64);
  if (b.attrs && typeof b.attrs === 'object') {
    for (const key of ['login', 'email', 'name', 'id']) if (key in b.attrs) next.attrs[key] = text(b.attrs[key], 64);
  }
  if ('provision' in b) next.provision = PROVISIONING.includes(b.provision) ? b.provision : 'off';
  if ('linkByEmail' in b) next.link_by_email = b.linkByEmail === true;
  if ('timeoutMs' in b) next.timeout_ms = Math.min(30000, Math.max(1000, Math.round(Number(b.timeoutMs) || 8000)));
  if ('syncHours' in b) next.sync_hours = Math.min(168, Math.max(0, Math.round(Number(b.syncHours) || 0)));
  if ('syncDisable' in b) next.sync_disable = b.syncDisable === true;
  if ('syncMaxDisablePct' in b) next.sync_max_disable_pct = Math.min(100, Math.max(0, Math.round(Number(b.syncMaxDisablePct) || 0)));
  if ('enabled' in b) next.enabled = b.enabled === true;

  if (next.url) {
    let url;
    try { url = new URL(next.url); } catch { return { error: 'Enter the directory address, for example ldaps://ldap.example.com.' }; }
    if (url.protocol !== 'ldap:' && url.protocol !== 'ldaps:') return { error: 'Enter the directory address, for example ldaps://ldap.example.com.' };
    if ((next.security === 'ldaps') !== (url.protocol === 'ldaps:')) return { error: 'Use an ldaps:// address with LDAPS, and an ldap:// address with StartTLS or no encryption.' };
    if (next.security === 'none' && !isLoopbackHost(url.hostname)) return { error: 'Unencrypted connections are only allowed to a directory on this machine.' };
  }
  if (next.user_filter && !next.user_filter.includes('{{username}}')) return { error: 'The user filter must contain {{username}}.' };
  if (next.group_mode === 'search' && next.group_filter && !next.group_filter.includes('{{dn}}')) return { error: 'The group filter must contain {{dn}}.' };
  if (!Object.values(next.attrs).every(a => ATTR.test(a)) || (next.group_mode !== 'none' && !ATTR.test(next.group_name_attr))) return { error: 'Attribute names may use letters, digits and dashes only.' };
  if (next.enabled && (!next.url || !next.user_base || !next.attrs.email)) return { error: 'Fill in the address, the user base and the email attribute before turning this on.' };
  return { config: next };
}

function tlsOptions(c) {
  return { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(c.ca ? { ca: [c.ca] } : {}) };
}

async function connect(c) {
  const client = new Client({ url: c.url, timeout: c.timeout_ms, connectTimeout: c.timeout_ms, tlsOptions: c.security === 'ldaps' ? tlsOptions(c) : undefined, strictDN: false });
  if (c.security === 'starttls') await client.startTLS(tlsOptions(c));
  return client;
}

async function serviceClient(c) {
  const client = await connect(c);
  if (c.bind_dn) await client.bind(c.bind_dn, unseal(c.bind_password) || '');
  return client;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function attr(entry, name) {
  if (name in entry) return entry[name];
  const key = Object.keys(entry).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? entry[key] : undefined;
}

function idOf(entry, c) {
  const raw = first(attr(entry, c.attrs.id));
  if (Buffer.isBuffer(raw)) return raw.toString('hex');
  return raw ? String(raw).toLowerCase() : '';
}

function personOf(entry, c) {
  return {
    dn: entry.dn,
    subject: idOf(entry, c),
    login: String(first(attr(entry, c.attrs.login)) || ''),
    email: String(first(attr(entry, c.attrs.email)) || '').trim().toLowerCase(),
    name: String(first(attr(entry, c.attrs.name)) || '').slice(0, 80),
    memberOf: list(attr(entry, 'memberOf')).map(String)
  };
}

async function searchUsers(client, c, filter, sizeLimit) {
  const attributes = [...new Set([...Object.values(c.attrs), 'memberOf'])];
  const { searchEntries } = await client.search(c.user_base, { scope: 'sub', filter, attributes, sizeLimit, paged: sizeLimit === 0, explicitBufferAttributes: c.attrs.id === 'objectGUID' ? ['objectGUID'] : [] });
  return searchEntries.map(e => personOf(e, c));
}

async function groupsOf(client, c, person) {
  if (c.group_mode === 'memberOf') return person.memberOf.map(firstRdnValue).filter(Boolean);
  if (c.group_mode !== 'search' || !c.group_base) return null;
  const filter = c.group_filter.replaceAll('{{dn}}', escapeFilter(person.dn));
  const { searchEntries } = await client.search(c.group_base, { scope: 'sub', filter, attributes: [c.group_name_attr], sizeLimit: 500 });
  return searchEntries.map(e => String(first(attr(e, c.group_name_attr)) || '')).filter(Boolean);
}

async function findPerson(client, c, username) {
  const filter = c.user_filter.replaceAll('{{username}}', escapeFilter(username));
  let found;
  try { found = await searchUsers(client, c, filter, 2); } catch (e) {
    if (e?.code === 4) return { ambiguous: true };
    throw e;
  }
  if (found.length !== 1) return found.length ? { ambiguous: true } : { missing: true };
  return { person: found[0] };
}

export async function ldapSignIn(username, password) {
  const c = ldapConfig();
  if (!password) return { error: 'credentials' };
  let service;
  try {
    service = await serviceClient(c);
    const r = await findPerson(service, c, username);
    if (!r.person) return { error: 'credentials' };
    const person = r.person;
    const userClient = await connect(c);
    try {
      await userClient.bind(person.dn, password);
    } catch (e) {
      if (e?.code === 49) return { error: 'credentials' };
      throw e;
    } finally {
      await userClient.unbind().catch(() => {});
    }
    if (!person.subject || !person.email) return { error: 'no_email' };
    const groups = await groupsOf(service, c, person);
    const provider = { id: LDAP_PROVIDER, source: LDAP_PROVIDER, type: 'ldap', domains: [], link_by_email: c.link_by_email, provision: c.provision };
    const resolved = resolveAccount(provider, { subject: person.subject, email: person.email, emailVerified: true, name: person.name, groups: groups || [] }, 'login', null);
    if (resolved.error) return { error: resolved.error };
    if (groups) syncExternalGroups(resolved.user.id, LDAP_PROVIDER, groups);
    return resolved;
  } catch {
    return { error: 'unavailable' };
  } finally {
    await service?.unbind().catch(() => {});
  }
}

export async function testLdap() {
  const c = ldapConfig();
  const client = await serviceClient(c);
  try {
    const { searchEntries } = await client.search(c.user_base, { scope: 'base', filter: '(objectClass=*)', attributes: ['objectClass'], sizeLimit: 1 });
    return { ok: true, base: searchEntries.length === 1 };
  } finally {
    await client.unbind().catch(() => {});
  }
}

export async function lookupLdap(username) {
  const c = ldapConfig();
  const client = await serviceClient(c);
  try {
    const r = await findPerson(client, c, username);
    if (!r.person) return { found: false, ambiguous: !!r.ambiguous };
    const { person } = r;
    return { found: true, dn: person.dn, id: person.subject, login: person.login, email: person.email, name: person.name, groups: (await groupsOf(client, c, person)) || [] };
  } finally {
    await client.unbind().catch(() => {});
  }
}

export async function syncLdap() {
  const c = ldapConfig();
  const linked = db.identities.where('provider_id', LDAP_PROVIDER);
  const report = { at: now(), checked: 0, updated: 0, disabled: 0, missing: 0, ok: false, error: '' };
  let client;
  try {
    client = await serviceClient(c);
    const everyone = await searchUsers(client, c, c.user_filter.replaceAll('{{username}}', '*'), 0);
    if (!everyone.length && linked.length) {
      report.error = SYNC_EMPTY;
      return report;
    }
    const byId = new Map(everyone.filter(p => p.subject).map(p => [p.subject, p]));
    const missing = [];
    const updates = [];
    for (const ident of linked) {
      const user = db.users.byId(ident.user_id);
      if (!user) continue;
      report.checked++;
      const person = byId.get(ident.subject);
      if (!person) { missing.push(user); continue; }
      updates.push({ user, person, groups: await groupsOf(client, c, person) });
    }
    report.missing = missing.length;
    const toDisable = c.sync_disable ? missing.filter(u => u.status !== DISABLED) : [];
    if (linked.length && toDisable.length * 100 > linked.length * c.sync_max_disable_pct) {
      report.error = SYNC_TOO_MANY;
      return report;
    }
    for (const { user, person, groups } of updates) {
      const patch = {};
      if (person.name && person.name !== user.display_name) patch.display_name = person.name;
      if (person.email && person.email !== user.email && !db.users.byEmail(person.email)) patch.email = person.email;
      if (Object.keys(patch).length) { db.users.update(user.id, patch); report.updated++; }
      if (groups) syncExternalGroups(user.id, LDAP_PROVIDER, groups);
    }
    for (const user of toDisable) { setStatus(user, DISABLED); report.disabled++; }
    report.ok = true;
    return report;
  } catch {
    report.error = SYNC_UNREACHABLE;
    return report;
  } finally {
    await client?.unbind().catch(() => {});
    setSetting('auth_ldap_last_sync', report);
  }
}

let timer = null;
let running = false;

export function startLdapSync() {
  if (timer) return;
  timer = setInterval(async () => {
    const c = ldapConfig();
    if (running || !c.enabled || !c.sync_hours) return;
    const last = getSetting('auth_ldap_last_sync', null)?.at || 0;
    if (Date.now() - last < c.sync_hours * 60 * 60 * 1000) return;
    running = true;
    try { await syncLdap(); } finally { running = false; }
  }, SYNC_CHECK_MS);
  timer.unref?.();
}