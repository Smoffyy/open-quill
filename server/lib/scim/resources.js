import { db, uid, now } from '../../db.js';
import { ScimError } from './errors.js';
import { getKey } from './filter.js';
import { ACTIVE, DISABLED } from '../authz/effective.js';
import { PENDING, USER } from '../authz/roles.js';
import { setStatus, endActivity, accountChanged } from '../authz/accounts.js';
import { isLastOwner } from '../authz/rules.js';
import { createSourceGroup, renameSourceGroup, setSourceMembers, deleteGroup } from '../authz/groups.js';
import { holdsAdmin } from '../identity/sso.js';
import { purgeUser } from '../purge.js';

export const SCIM = 'scim';
export const REMOVED = 'scim-removed';
export const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const ENTERPRISE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
export const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const USER_SCHEMAS = [USER_SCHEMA, ENTERPRISE_SCHEMA];
export const GROUP_SCHEMAS = [GROUP_SCHEMA];

const TEXT_MAX = 256;
const LIST_MAX = 10;
const MEMBERS_MAX = 20000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_PARTS = ['formatted', 'familyName', 'givenName', 'middleName', 'honorificPrefix', 'honorificSuffix'];
const PROFILE_TEXT = ['nickName', 'title', 'userType', 'preferredLanguage', 'locale', 'timezone'];
const ENTERPRISE_TEXT = ['employeeNumber', 'costCenter', 'organization', 'division', 'department'];

const iso = (ms) => new Date(ms || 0).toISOString();
const invalidValue = (detail) => new ScimError(400, 'invalidValue', detail);
const conflict = (detail) => new ScimError(409, 'uniqueness', detail);
const lastOwner = () => new ScimError(400, 'mutability', 'This account is the last owner here, so it cannot be turned off or removed.');
const read = (obj, name) => { const key = getKey(obj, name); return key === undefined ? undefined : obj[key]; };

function text(v, max = TEXT_MAX) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' && typeof v !== 'number') throw invalidValue('A text attribute has a value that is not text.');
  return String(v).trim().slice(0, max) || undefined;
}

function bool(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  throw invalidValue('"active" and "primary" must be true or false.');
}

function multi(v, fields) {
  if (v === undefined || v === null) return undefined;
  return (Array.isArray(v) ? v : [v]).slice(0, LIST_MAX).map(item => {
    if (!item || typeof item !== 'object') return { value: text(item) };
    const out = {};
    for (const f of fields) {
      const x = read(item, f);
      if (x !== undefined && x !== null) out[f] = f === 'primary' ? bool(x) : text(x);
    }
    return out;
  }).filter(item => item.value);
}

export function userFromScim(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ScimError(400, 'invalidSyntax', 'The request body is not a User.');
  const userName = text(read(body, 'userName'));
  if (!userName) throw invalidValue('A user needs a userName.');
  const profile = {};
  const nameIn = read(body, 'name');
  if (nameIn && typeof nameIn === 'object') {
    const name = {};
    for (const part of NAME_PARTS) { const v = text(read(nameIn, part)); if (v) name[part] = v; }
    if (Object.keys(name).length) profile.name = name;
  }
  for (const f of PROFILE_TEXT) { const v = text(read(body, f)); if (v) profile[f] = v; }
  const emails = multi(read(body, 'emails'), ['value', 'type', 'primary', 'display']);
  if (emails?.length) profile.emails = emails;
  const phones = multi(read(body, 'phoneNumbers'), ['value', 'type', 'primary']);
  if (phones?.length) profile.phoneNumbers = phones;
  const ext = read(body, ENTERPRISE_SCHEMA);
  if (ext && typeof ext === 'object') {
    const enterprise = {};
    for (const f of ENTERPRISE_TEXT) { const v = text(read(ext, f)); if (v) enterprise[f] = v; }
    const manager = read(ext, 'manager');
    const managerId = text(manager && typeof manager === 'object' ? read(manager, 'value') : manager);
    if (managerId) enterprise.manager = { value: managerId };
    if (Object.keys(enterprise).length) profile.enterprise = enterprise;
  }
  const chosen = emails?.find(e => e.primary) || emails?.find(e => String(e.type || '').toLowerCase() === 'work') || emails?.[0];
  const email = String(chosen?.value || (EMAIL.test(userName) ? userName : '')).toLowerCase();
  if (!EMAIL.test(email)) throw invalidValue('A user needs an email address, in emails or as the userName.');
  const name = profile.name || {};
  const displayName = text(read(body, 'displayName'), 80) || name.formatted?.slice(0, 80)
    || [name.givenName, name.familyName].filter(Boolean).join(' ').slice(0, 80) || email.split('@')[0];
  return { userName, externalId: text(read(body, 'externalId')) ?? null, email, displayName, active: bool(read(body, 'active')) ?? true, profile };
}

export function userToScim(u, base) {
  const p = u.scim?.profile || {};
  const groups = db.groupMembers.directGroups(u.id).map(id => db.groups.byId(id)).filter(g => g?.source === SCIM)
    .map(g => ({ value: g.id, display: g.name, $ref: `${base}/Groups/${g.id}`, type: 'direct' }));
  return {
    schemas: p.enterprise ? USER_SCHEMAS : [USER_SCHEMA],
    id: u.id,
    externalId: u.external_id || undefined,
    userName: u.scim?.user_name || u.email,
    name: p.name,
    displayName: u.display_name || undefined,
    nickName: p.nickName, title: p.title, userType: p.userType, preferredLanguage: p.preferredLanguage, locale: p.locale, timezone: p.timezone,
    active: u.status !== DISABLED,
    emails: p.emails || [{ value: u.email, type: 'work', primary: true }],
    phoneNumbers: p.phoneNumbers,
    groups,
    ...(p.enterprise ? { [ENTERPRISE_SCHEMA]: p.enterprise } : {}),
    meta: { resourceType: 'User', created: iso(u.created_at), lastModified: iso(u.updated_at || u.created_at), location: `${base}/Users/${u.id}` }
  };
}

export const managedUser = (id) => {
  const u = typeof id === 'string' ? db.users.byId(id) : null;
  return u?.source === SCIM ? u : null;
};

function checkUnique(attrs, selfId) {
  if (db.users.byScimName(attrs.userName).some(u => u.id !== selfId && u.source === SCIM)) throw conflict('Another user already has this userName.');
  if (attrs.externalId && db.users.byExternalId(attrs.externalId).some(u => u.id !== selfId && u.source === SCIM)) throw conflict('Another user already has this externalId.');
  const owner = db.users.byEmail(attrs.email);
  if (owner && owner.id !== selfId && owner.source === SCIM) throw conflict('Another user already has this email address.');
}

function save(user, attrs, extra = {}) {
  if (!attrs.active && user.status !== DISABLED && isLastOwner(user)) throw lastOwner();
  const holder = attrs.email !== user.email ? db.users.byEmail(attrs.email) : null;
  if (holder && holder.id !== user.id) throw conflict('Another account already has this email address.');
  let saved = db.users.update(user.id, {
    email: attrs.email, display_name: attrs.displayName, external_id: attrs.externalId,
    scim: { user_name: attrs.userName, profile: attrs.profile }, updated_at: now(), ...extra
  });
  if (attrs.active && saved.status === DISABLED) saved = setStatus(saved, ACTIVE);
  else if (!attrs.active && saved.status !== DISABLED) saved = setStatus(saved, DISABLED);
  if (saved.status !== DISABLED) accountChanged(saved.id);
  return saved;
}

export function createUser(attrs, settings) {
  checkUnique(attrs, null);
  const existing = db.users.byEmail(attrs.email);
  if (existing) {
    const restoring = existing.source === REMOVED;
    const source = existing.source || 'local';
    const adoptable = settings.adopt === 'members' && (source === 'local' || source.startsWith('sso:')) && !holdsAdmin(existing);
    if (!restoring && !adoptable) throw conflict('An account with this email address already exists here and is not managed by provisioning.');
    if (!restoring) endActivity(existing.id);
    const user = save(existing, attrs, restoring ? { source: SCIM } : { source: SCIM, password_hash: undefined });
    return { user, outcome: restoring ? 'restored' : 'adopted' };
  }
  const t = now();
  const user = db.users.insert({
    id: uid(), email: attrs.email, display_name: attrs.displayName, role: settings.provision === 'pending' ? PENDING : USER,
    status: attrs.active ? ACTIVE : DISABLED, ...(attrs.active ? {} : { disabled_at: t }), source: SCIM, external_id: attrs.externalId,
    scim: { user_name: attrs.userName, profile: attrs.profile }, prefs: {}, created_at: t, updated_at: t
  });
  return { user, outcome: 'created' };
}

export function replaceUser(user, attrs) {
  checkUnique(attrs, user.id);
  return save(user, attrs);
}

export function removeUser(user, settings) {
  if (isLastOwner(user)) throw lastOwner();
  if (settings.deprovision === 'delete') {
    endActivity(user.id);
    purgeUser(user.id);
    return 'deleted';
  }
  if (user.status !== DISABLED) setStatus(user, DISABLED);
  db.users.update(user.id, { source: REMOVED, updated_at: now() });
  return 'disabled';
}

export const managedGroup = (id) => {
  const g = typeof id === 'string' ? db.groups.byId(id) : null;
  return g?.source === SCIM ? g : null;
};

export const scimGroups = () => db.groups.all().filter(g => g.source === SCIM).sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

export function groupToScim(g, base, withMembers = true) {
  const members = withMembers
    ? db.groupMembers.usersOf(g.id).map(id => db.users.byId(id)).filter(Boolean)
      .map(u => ({ value: u.id, display: u.display_name || u.email, $ref: `${base}/Users/${u.id}`, type: 'User' }))
    : undefined;
  return {
    schemas: [GROUP_SCHEMA],
    id: g.id,
    externalId: g.external_id || undefined,
    displayName: g.name,
    members,
    meta: { resourceType: 'Group', created: iso(g.created_at), lastModified: iso(g.updated_at || g.created_at), location: `${base}/Groups/${g.id}` }
  };
}

export function groupFromScim(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ScimError(400, 'invalidSyntax', 'The request body is not a Group.');
  const displayName = text(read(body, 'displayName'), 80);
  if (!displayName) throw invalidValue('A group needs a displayName.');
  const raw = read(body, 'members');
  const list = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
  if (list.length > MEMBERS_MAX) throw invalidValue('The group has too many members.');
  const members = [];
  for (const m of list) {
    const type = m && typeof m === 'object' ? String(read(m, 'type') || '') : '';
    if (type.toLowerCase() === 'group') throw invalidValue('Groups inside groups are not supported. Add the people instead.');
    const value = text(m && typeof m === 'object' ? read(m, 'value') : m, 64);
    if (value) members.push(value);
  }
  return { displayName, externalId: text(read(body, 'externalId')) ?? null, members: [...new Set(members)] };
}

function checkMembers(group, ids) {
  const current = new Set(group ? db.groupMembers.usersOf(group.id) : []);
  for (const id of ids) {
    if (!current.has(id) && !managedUser(id)) throw invalidValue(`"${id}" is not a user managed by provisioning.`);
  }
}

export function createGroup(attrs) {
  checkMembers(null, attrs.members);
  const r = createSourceGroup({ name: attrs.displayName, source: SCIM, externalId: attrs.externalId });
  if (r.status === 409) throw conflict('Another group already has this displayName.');
  if (r.error) throw invalidValue(r.error);
  setSourceMembers(r.group.id, attrs.members, SCIM);
  return r.group;
}

export function replaceGroup(group, attrs) {
  checkMembers(group, attrs.members);
  const r = renameSourceGroup(group, attrs.displayName, attrs.externalId);
  if (r.status === 409) throw conflict('Another group already has this displayName.');
  if (r.error) throw invalidValue(r.error);
  setSourceMembers(group.id, attrs.members, SCIM);
  return r.group;
}

export function removeGroup(group) {
  deleteGroup(group.id);
}