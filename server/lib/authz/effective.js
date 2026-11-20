import { permissionsOfRole, rankOfRole, rolesKey, PENDING, ADMIN, OWNER } from './roles.js';
import { graph, groupsOfUser, pathTo } from './groups.js';
import { MEMBER, ADMIN as ADMIN_TIER, tierOf } from './permissions.js';
import { mfaPolicy, hasTotp } from '../identity/mfa.js';

export const ACTIVE = 'active';
export const DISABLED = 'disabled';

const EMPTY = new Set();
const MEMO_MAX = 2000;
const memo = new Map();

export const roleOf = (user) => (user && typeof user.role === 'string' && user.role ? user.role : PENDING);
export const isActive = (user) => !!user && user.status !== DISABLED;
export const isOwner = (user) => isActive(user) && roleOf(user) === OWNER;
export const rankOf = (user) => rankOfRole(roleOf(user));
export function mfaRequired(user) {
  const policy = mfaPolicy();
  return policy === 'everyone' || (policy === 'admins' && [...permissionsOfRole(roleOf(user))].some(p => tierOf(p) === ADMIN_TIER));
}

export function gateOf(user) {
  if (roleOf(user) === PENDING) return 'pending';
  return mfaRequired(user) && !hasTotp(user.id) ? 'mfa' : null;
}

const holdsEverything = (role) => role === OWNER || role === ADMIN;

export function groupIdsOf(user) {
  if (!isActive(user) || roleOf(user) === PENDING) return EMPTY;
  return new Set(groupsOfUser(user.id).keys());
}

export function permissionsOf(user) {
  if (!isActive(user)) return EMPTY;
  const role = roleOf(user);
  if (role === PENDING) return EMPTY;
  const base = permissionsOfRole(role);
  if (holdsEverything(role)) return base;
  const key = `${role}:${graph().key}:${rolesKey()}`;
  const hit = memo.get(user.id);
  if (hit && hit.key === key) return hit.set;
  const set = new Set(base);
  const { groups } = graph();
  for (const id of groupsOfUser(user.id).keys()) {
    for (const p of groups.get(id)?.permissions || []) if (tierOf(p) === MEMBER) set.add(p);
  }
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
  memo.set(user.id, { key, set });
  return set;
}

export const can = (user, permission) => permissionsOf(user).has(permission);

export function explain(user) {
  const role = roleOf(user);
  const active = isActive(user) && role !== PENDING;
  const seen = active ? groupsOfUser(user.id) : new Map();
  const { groups } = graph();
  const fromRole = active ? permissionsOfRole(role) : EMPTY;
  const sources = new Map();
  const note = (p, source) => {
    if (!sources.has(p)) sources.set(p, []);
    sources.get(p).push(source);
  };
  for (const p of fromRole) note(p, { type: 'role', role });
  const memberships = [];
  for (const [id, { depth }] of seen) {
    const g = groups.get(id);
    const path = pathTo(seen, id).map(gid => ({ id: gid, name: groups.get(gid)?.name || '' }));
    memberships.push({ id, name: g.name, depth, path, source: g.source || 'local' });
    if (holdsEverything(role)) continue;
    for (const p of g.permissions || []) if (tierOf(p) === MEMBER) note(p, { type: 'group', id, path });
  }
  memberships.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
  return {
    role, active,
    groups: memberships,
    permissions: [...permissionsOf(user)].map(id => ({ id, sources: sources.get(id) || [] }))
  };
}