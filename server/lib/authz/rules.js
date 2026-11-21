import { db } from '../../db.js';
import { can, isOwner, isActive, rankOf, roleOf } from './effective.js';
import { roleExists, rankOfRole, OWNER } from './roles.js';

export function canActOn(actor, target) {
  if (!actor || !target || actor.id === target.id || !can(actor, 'admin.users')) return false;
  if (isOwner(actor) && roleOf(target) === OWNER) return true;
  return rankOf(actor) > rankOf(target);
}

export function canAssign(actor, target, role) {
  if (!canActOn(actor, target) || !roleExists(role)) return false;
  if (role === OWNER) return isOwner(actor);
  return rankOfRole(role) < rankOf(actor);
}

export function activeOwnerCount(exceptId = null) {
  return db.users.all().filter(u => u.id !== exceptId && isOwner(u)).length;
}

export function isLastOwner(user) {
  return !!user && roleOf(user) === OWNER && isActive(user) && activeOwnerCount(user.id) === 0;
}