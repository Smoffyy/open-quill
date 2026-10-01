export const ROLES = ['member', 'editor', 'publisher', 'owner'];

export const ASSIGNABLE = ['member', 'editor', 'publisher'];

export const rankOf = (role) => Math.max(0, ROLES.indexOf(role));

export const canManage = (actor, target) => rankOf(actor) > rankOf(target);

export const canAssign = (actor, role) => ASSIGNABLE.includes(role) && rankOf(role) < rankOf(actor);
