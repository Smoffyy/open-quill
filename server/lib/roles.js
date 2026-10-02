export const ROLES = ['member', 'editor', 'publisher', 'owner'];

const PATCHES = {
  __proto__: null,
  member: { is_admin: 0, can_publish: 0 },
  editor: { is_admin: 1, can_publish: 0 },
  publisher: { is_admin: 1, can_publish: 1 }
};

export function roleOf(u) {
  if (!u) return 'member';
  if (u.is_owner) return 'owner';
  if (!u.is_admin) return 'member';
  return u.can_publish ? 'publisher' : 'editor';
}

export const rankOf = (u) => ROLES.indexOf(roleOf(u));

export const canPublish = (u) => rankOf(u) >= ROLES.indexOf('publisher');

export const canManage = (actor, target) => !!actor && !!target && rankOf(actor) > rankOf(target);

export const canAssign = (actor, role) => role in PATCHES && ROLES.indexOf(role) < rankOf(actor);

export const rolePatch = (role) => PATCHES[role] || null;