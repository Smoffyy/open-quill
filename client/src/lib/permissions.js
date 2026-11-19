const cache = new WeakMap();

function setOf(user) {
  if (!user || !Array.isArray(user.permissions)) return new Set();
  let set = cache.get(user.permissions);
  if (!set) {
    set = new Set(user.permissions);
    cache.set(user.permissions, set);
  }
  return set;
}

export const can = (user, permission) => setOf(user).has(permission);

export const canAny = (user, ...permissions) => permissions.some(p => can(user, p));

export const ADMIN_SECTIONS = {
  __proto__: null,
  overview: 'admin.panel',
  releases: 'admin.panel',
  models: 'admin.models',
  providers: 'admin.providers',
  search: 'admin.tools',
  voice: 'admin.tools',
  history: 'admin.tools',
  files: 'admin.tools',
  skills: 'admin.tools',
  mcp: 'admin.tools',
  interface: 'admin.interface',
  launcher: 'admin.interface',
  users: 'admin.users',
  groups: 'admin.groups',
  roles: 'admin.groups',
  guardrails: 'admin.policy',
  network: 'admin.policy',
  quotas: 'admin.policy',
  evaluations: 'admin.quality',
  quality: 'admin.quality',
  usage: 'admin.usage',
  ratings: 'admin.quality',
  events: 'admin.audit',
  storage: 'admin.storage'
};

export const canSeeSection = (user, id) => can(user, 'admin.panel') && can(user, ADMIN_SECTIONS[id] || 'admin.panel');