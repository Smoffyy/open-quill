import { graph, groupsOfUser } from './groups.js';
import { can, groupIdsOf } from './effective.js';

export const cleanGroupIds = (raw) => (Array.isArray(raw) ? [...new Set(raw.filter(id => typeof id === 'string' && id.length <= 64))].slice(0, 200) : []);

export function allowedFor(user, accessGroups, bypassPermission) {
  const wanted = Array.isArray(accessGroups) ? accessGroups : [];
  if (!wanted.length || can(user, bypassPermission)) return true;
  const mine = groupIdsOf(user);
  return wanted.some(id => mine.has(id));
}

export const modelAllowed = (user, model) => !!model && allowedFor(user, model.access_groups, 'admin.models');

export function defaultModelFor(user, pool) {
  const usable = pool.filter(Boolean);
  const byId = new Map(usable.map(m => [m.id, m]));
  const own = user?.prefs?.defaultModel;
  if (typeof own === 'string' && byId.has(own)) return byId.get(own);
  const { groups } = graph();
  const seen = groupIdsOf(user).size ? groupsOfUser(user.id) : new Map();
  const picks = [...seen.entries()]
    .map(([id, { depth }]) => ({ group: groups.get(id), depth }))
    .filter(({ group }) => group?.default_model_id && byId.has(group.default_model_id))
    .sort((a, b) => (a.group.priority ?? 0) - (b.group.priority ?? 0) || a.depth - b.depth || String(a.group.name).localeCompare(String(b.group.name)));
  if (picks.length) return byId.get(picks[0].group.default_model_id);
  return usable.find(m => m.is_default) || usable[0] || null;
}