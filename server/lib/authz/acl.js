import path from 'path';
import { db, uid, now, tx } from '../../db.js';
import { can, isActive, roleOf, groupIdsOf } from './effective.js';
import { graph } from './groups.js';
import { PENDING } from './roles.js';

const RANK = { __proto__: null, view: 1, edit: 2, manage: 3, owner: 4 };
const SHARE_LIMIT = 200;

export const RESOURCES = {
  __proto__: null,
  project: { levels: ['view', 'edit', 'manage'], share: 'projects.share', load: (id) => db.projects.byId(id) },
  chat: { levels: ['view'], share: 'chats.share', load: (id) => db.chats.byId(id), shareable: (c) => c.mode !== 'code' },
  skill: { levels: ['view', 'edit', 'manage'], share: 'skills.share', load: (id) => db.skills.byId(id) }
};

export const atLeast = (level, needed) => (RANK[level] || 0) >= (RANK[needed] || 0);

const usable = (user) => isActive(user) && roleOf(user) !== PENDING;
const nameOf = (u) => u.display_name || (u.email || '').split('@')[0];

export function levelOf(user, type, resource) {
  if (!resource || !RESOURCES[type] || !usable(user)) return null;
  if (resource.user_id === user.id) return 'owner';
  const groups = groupIdsOf(user);
  let best = null;
  for (const entry of db.acl.forResource(type, resource.id)) {
    const mine = entry.principal_type === 'user' ? entry.principal_id === user.id : groups.has(entry.principal_id);
    if (mine && (RANK[entry.level] || 0) > (RANK[best] || 0)) best = entry.level;
  }
  return best;
}

export function access(user, type, id, needed = 'view') {
  const resource = RESOURCES[type] && typeof id === 'string' ? RESOURCES[type].load(id) : null;
  const level = levelOf(user, type, resource);
  if (!level) return { status: 404, error: 'not found' };
  if (!atLeast(level, needed)) return { status: 403, error: 'You can open this but not change it.' };
  return { resource, level };
}

export function sharedWith(user, type) {
  const out = new Map();
  if (!usable(user)) return out;
  for (const r of db.acl.sharedWith(type, user.id, [...groupIdsOf(user)])) {
    if ((RANK[r.level] || 0) > (RANK[out.get(r.resource_id)] || 0)) out.set(r.resource_id, r.level);
  }
  return out;
}

function principalOf(type, id) {
  if (type === 'user') {
    const u = db.users.byId(id);
    return u && usable(u) ? { name: nameOf(u), email: u.email } : null;
  }
  if (type === 'group') {
    const g = db.groups.byId(id);
    return g ? { name: g.name } : null;
  }
  return null;
}

function descend(groupId) {
  const { groups, children } = graph();
  const seen = new Map([[groupId, [groupId]]]);
  const queue = [groupId];
  while (queue.length) {
    const id = queue.shift();
    for (const child of children.get(id) || []) {
      if (seen.has(child) || !groups.has(child)) continue;
      seen.set(child, [...seen.get(id), child]);
      queue.push(child);
    }
  }
  return seen;
}

export function usersReached(principalType, principalId) {
  if (principalType === 'user') return [principalId];
  const ids = new Set();
  for (const gid of descend(principalId).keys()) for (const userId of db.groupMembers.usersOf(gid)) ids.add(userId);
  return [...ids];
}

export function grant(actor, type, resource, principalType, principalId, level) {
  const spec = RESOURCES[type];
  if (!spec || !resource) return { status: 404, error: 'not found' };
  const mine = levelOf(actor, type, resource);
  if (!mine) return { status: 404, error: 'not found' };
  if (!atLeast(mine, 'manage')) return { status: 403, error: 'Only someone who manages this can share it.' };
  if (spec.shareable && !spec.shareable(resource)) return { status: 400, error: 'This can’t be shared.' };
  if (!can(actor, spec.share)) return { status: 403, error: 'Your organization does not let you share this.' };
  if (!spec.levels.includes(level)) return { status: 400, error: 'Choose a level this can be shared at.' };
  if (!atLeast(mine, level)) return { status: 403, error: 'You can only share up to your own access.' };
  if (!principalOf(principalType, principalId)) return { status: 400, error: 'Pick an active person or a group.' };
  if (principalType === 'user' && principalId === resource.user_id) return { status: 400, error: 'The owner already has full access.' };
  return tx(() => {
    const cur = db.acl.entry(type, resource.id, principalType, principalId);
    if (cur) {
      db.acl.update(cur.id, { level, granted_by: actor.id, updated_at: now() });
      return { ok: true, before: cur.level };
    }
    if (db.acl.forResource(type, resource.id).length >= SHARE_LIMIT) return { status: 400, error: 'This is already shared with as many people and groups as it can be.' };
    db.acl.insert({ id: uid(), resource_type: type, resource_id: resource.id, principal_type: principalType, principal_id: principalId, level, granted_by: actor.id, created_at: now() });
    return { ok: true, before: null };
  });
}

export function revoke(actor, type, resource, principalType, principalId) {
  if (!RESOURCES[type] || !resource) return { status: 404, error: 'not found' };
  const mine = levelOf(actor, type, resource);
  if (!mine) return { status: 404, error: 'not found' };
  const leaving = principalType === 'user' && principalId === actor.id;
  if (!leaving && !atLeast(mine, 'manage')) return { status: 403, error: 'Only someone who manages this can change who has it.' };
  const cur = db.acl.entry(type, resource.id, principalType, principalId);
  if (cur) db.acl.removeById(cur.id);
  return { ok: true, before: cur?.level || null };
}

export function accessList(type, resource) {
  const { groups } = graph();
  const owner = db.users.byId(resource.user_id);
  const entries = db.acl.forResource(type, resource.id);
  const grants = entries.map(e => ({
    principalType: e.principal_type, principalId: e.principal_id, level: e.level, createdAt: e.created_at || 0,
    ...(principalOf(e.principal_type, e.principal_id) || { name: '', email: '', inactive: true })
  }));
  const people = new Map();
  const reach = (user, level, reason) => {
    if (!user || !usable(user) || user.id === resource.user_id) return;
    const cur = people.get(user.id) || { id: user.id, name: nameOf(user), email: user.email, level: null, reasons: [] };
    if ((RANK[level] || 0) > (RANK[cur.level] || 0)) cur.level = level;
    cur.reasons.push({ ...reason, level });
    people.set(user.id, cur);
  };
  for (const e of entries) {
    if (e.principal_type === 'user') reach(db.users.byId(e.principal_id), e.level, { type: 'direct' });
    else for (const [gid, trail] of descend(e.principal_id)) {
      for (const userId of db.groupMembers.usersOf(gid)) {
        reach(db.users.byId(userId), e.level, { type: 'group', path: trail.map(id => ({ id, name: groups.get(id)?.name || '' })) });
      }
    }
  }
  return {
    owner: owner ? { id: owner.id, name: nameOf(owner), email: owner.email } : null,
    grants,
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
  };
}

export function forgetResource(type, id) {
  db.acl.dropResource(type, id);
}

function uploadRow(url) {
  let name;
  try { name = path.posix.basename(decodeURIComponent(String(url || ''))); } catch { return null; }
  return name ? db.uploads.byId(name.toLowerCase()) : null;
}

export function ownsUpload(user, url) {
  const row = uploadRow(url);
  return !!row && !!user && row.user_id === user.id;
}

export function canReadUpload(user, url) {
  if (!usable(user)) return false;
  const row = uploadRow(url);
  if (!row) return false;
  if (row.workspace || row.user_id === user.id) return true;
  const chats = [...sharedWith(user, 'chat').keys()];
  return chats.length > 0 && db.messages.mentionedIn(chats, '/uploads/' + row.file);
}