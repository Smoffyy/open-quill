import { db, getSetting, settingsVersion } from '../../db.js';
import { PERMISSION_IDS, ADMIN_PERMISSIONS, DEFAULT_USER_BASELINE, MEMBER, cleanPermissions } from './permissions.js';

export const PENDING = 'pending';
export const USER = 'user';
export const ADMIN = 'admin';
export const OWNER = 'owner';

export const BUILTIN_ROLES = {
  __proto__: null,
  [PENDING]: { id: PENDING, rank: 0 },
  [USER]: { id: USER, rank: 10 },
  [ADMIN]: { id: ADMIN, rank: 100 },
  [OWNER]: { id: OWNER, rank: 1000 }
};

export const CUSTOM_MIN_RANK = 11;
export const CUSTOM_MAX_RANK = 99;

const PRESETS = {
  __proto__: null,
  'legacy-editor': () => ADMIN_PERMISSIONS.filter(id => id !== 'admin.publish')
};

const EMPTY = new Set();

export function userBaseline() {
  const stored = getSetting('auth_user_baseline', null);
  return Array.isArray(stored) ? cleanPermissions(stored, MEMBER) : DEFAULT_USER_BASELINE;
}

export function customExtras(role) {
  return PRESETS[role.preset] ? PRESETS[role.preset]() : cleanPermissions(role.permissions);
}

let cache = { key: null, custom: new Map(), perms: new Map() };

function snapshot() {
  const key = `${db.roles.version()}:${settingsVersion()}`;
  if (cache.key === key) return cache;
  const baseline = userBaseline();
  const custom = new Map(db.roles.all().map(r => [r.id, r]));
  const perms = new Map([
    [PENDING, EMPTY],
    [USER, new Set(baseline)],
    [ADMIN, new Set(PERMISSION_IDS)],
    [OWNER, new Set(PERMISSION_IDS)]
  ]);
  for (const r of custom.values()) perms.set(r.id, new Set([...baseline, ...customExtras(r)]));
  cache = { key, custom, perms };
  return cache;
}

export const rolesKey = () => snapshot().key;

export const isBuiltinRole = (id) => typeof id === 'string' && id in BUILTIN_ROLES;

export function roleExists(id) {
  return isBuiltinRole(id) || (typeof id === 'string' && snapshot().custom.has(id));
}

export function rankOfRole(id) {
  if (isBuiltinRole(id)) return BUILTIN_ROLES[id].rank;
  const r = typeof id === 'string' ? snapshot().custom.get(id) : null;
  return r ? r.rank : -1;
}

export function permissionsOfRole(id) {
  return (typeof id === 'string' && snapshot().perms.get(id)) || EMPTY;
}

export function roleList() {
  const { custom, perms } = snapshot();
  const shape = (id, extra) => ({ id, rank: rankOfRole(id), permissions: [...perms.get(id)], ...extra });
  return [
    shape(OWNER, { builtin: true }),
    shape(ADMIN, { builtin: true }),
    ...[...custom.values()].sort((a, b) => b.rank - a.rank || String(a.name).localeCompare(String(b.name)))
      .map(r => shape(r.id, { builtin: false, name: r.name, description: r.description || '', extras: customExtras(r), preset: r.preset || null })),
    shape(USER, { builtin: true }),
    shape(PENDING, { builtin: true })
  ];
}

export function roleName(id) {
  if (isBuiltinRole(id)) return id;
  return snapshot().custom.get(id)?.name || id;
}