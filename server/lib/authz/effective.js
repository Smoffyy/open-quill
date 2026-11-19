import { permissionsOfRole, rankOfRole, PENDING, OWNER } from './roles.js';

export const ACTIVE = 'active';
export const DISABLED = 'disabled';

const EMPTY = new Set();

export const roleOf = (user) => (user && typeof user.role === 'string' && user.role ? user.role : PENDING);
export const isActive = (user) => !!user && user.status !== DISABLED;
export const isOwner = (user) => isActive(user) && roleOf(user) === OWNER;
export const rankOf = (user) => rankOfRole(roleOf(user));
export const gateOf = (user) => (roleOf(user) === PENDING ? 'pending' : null);

export function permissionsOf(user) {
  if (!isActive(user)) return EMPTY;
  return permissionsOfRole(roleOf(user));
}

export const can = (user, permission) => permissionsOf(user).has(permission);