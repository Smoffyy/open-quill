import { db, uid, now, tx } from '../../db.js';
import { MEMBER, cleanPermissions, tierOf } from './permissions.js';

export const MAX_DEPTH = 8;
export const MAX_GROUPS = 2000;
export const LOCAL = 'local';
const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

export const nameKey = (name) => String(name || '').trim().toLowerCase();

const add = (map, key, value) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
};

let cache = { key: null, groups: new Map(), parents: new Map(), children: new Map() };

export function graph() {
  const key = `${db.groups.version()}:${db.groupMembers.version()}`;
  if (cache.key === key) return cache;
  const groups = new Map(db.groups.all().map(g => [g.id, g]));
  const parents = new Map();
  const children = new Map();
  for (const link of db.groupMembers.groupLinks()) {
    if (!groups.has(link.group_id) || !groups.has(link.member_id)) continue;
    add(parents, link.member_id, link.group_id);
    add(children, link.group_id, link.member_id);
  }
  cache = { key, groups, parents, children };
  return cache;
}

export function closure(directIds) {
  const { groups, parents } = graph();
  const seen = new Map();
  const queue = [];
  for (const id of directIds) {
    if (!groups.has(id) || seen.has(id)) continue;
    seen.set(id, { depth: 0, via: null });
    queue.push(id);
  }
  while (queue.length) {
    const id = queue.shift();
    const depth = seen.get(id).depth;
    for (const parent of parents.get(id) || []) {
      if (seen.has(parent)) continue;
      seen.set(parent, { depth: depth + 1, via: id });
      queue.push(parent);
    }
  }
  return seen;
}

export const groupsOfUser = (userId) => closure(db.groupMembers.directGroups(userId));

export function pathTo(seen, id) {
  const path = [];
  for (let at = id; at; at = seen.get(at)?.via ?? null) path.unshift(at);
  return path;
}

function reach(start, edges) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    for (const next of edges.get(stack.pop()) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

function longest(start, edges, memo = new Map(), path = new Set()) {
  if (memo.has(start)) return memo.get(start);
  if (path.has(start)) return 0;
  path.add(start);
  let best = 0;
  for (const next of edges.get(start) || []) best = Math.max(best, longest(next, edges, memo, path));
  path.delete(start);
  memo.set(start, best + 1);
  return best + 1;
}

function cleanName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return name || null;
}

function nameTaken(name, exceptId = null) {
  const key = nameKey(name);
  return db.groups.all().some(g => g.id !== exceptId && g.source === LOCAL && g.name_key === key);
}

export function createGroup(body, actorId) {
  const name = cleanName(body?.name);
  if (!name) return { status: 400, error: 'Give the group a name.' };
  if (db.groups.count() >= MAX_GROUPS) return { status: 400, error: 'This workspace has reached the group limit.' };
  if (nameTaken(name)) return { status: 409, error: 'A group with that name already exists.' };
  const t = now();
  const group = db.groups.insert({
    id: uid(), name, name_key: nameKey(name), description: String(body?.description ?? '').slice(0, DESCRIPTION_MAX),
    source: LOCAL, external_id: null, permissions: [], default_model_id: null, priority: db.groups.count(),
    created_by: actorId, created_at: t, updated_at: t
  });
  return { group };
}

export function updateGroup(id, body) {
  const group = db.groups.byId(id);
  if (!group) return { status: 404, error: 'not found' };
  const patch = { updated_at: now() };
  if ('name' in body) {
    const name = cleanName(body.name);
    if (!name) return { status: 400, error: 'Give the group a name.' };
    if (group.source !== LOCAL && name !== group.name) return { status: 409, error: 'This group is kept in sync by its directory, so it keeps the directory’s name.' };
    if (nameTaken(name, id)) return { status: 409, error: 'A group with that name already exists.' };
    Object.assign(patch, { name, name_key: nameKey(name) });
  }
  if ('description' in body) patch.description = String(body.description ?? '').slice(0, DESCRIPTION_MAX);
  if ('permissions' in body) {
    const asked = Array.isArray(body.permissions) ? body.permissions : [];
    if (asked.some(p => tierOf(p) && tierOf(p) !== MEMBER)) return { status: 400, error: 'Groups can only grant everyday permissions. Admin permissions come from roles.' };
    patch.permissions = cleanPermissions(asked, MEMBER);
  }
  if ('defaultModelId' in body) patch.default_model_id = typeof body.defaultModelId === 'string' && body.defaultModelId ? body.defaultModelId.slice(0, 64) : null;
  return { group: db.groups.update(id, patch) };
}

export function deleteGroup(id) {
  if (!db.groups.byId(id)) return { status: 404, error: 'not found' };
  tx(() => {
    db.groupMembers.dropMember('group', id);
    db.groupMembers.removeWhere('group_id', id);
    db.groups.removeById(id);
    db.acl.prune();
  });
  return { ok: true };
}

function link(groupId, type, memberId, actorId, source = 'manual') {
  if (db.groupMembers.link(groupId, type, memberId)) return;
  db.groupMembers.insert({ id: uid(), group_id: groupId, member_type: type, member_id: memberId, source, added_by: actorId, added_at: now() });
}

function unlink(groupId, type, memberId) {
  const row = db.groupMembers.link(groupId, type, memberId);
  if (row) db.groupMembers.removeById(row.id);
}

export function syncExternalGroups(userId, source, names) {
  const wanted = new Map();
  for (const raw of Array.isArray(names) ? names.slice(0, 200) : []) {
    const name = cleanName(raw);
    if (name) wanted.set(nameKey(name), name);
  }
  tx(() => {
    const mine = new Map(db.groups.all().filter(g => g.source === source).map(g => [g.name_key, g]));
    for (const [key, name] of wanted) {
      if (mine.has(key) || db.groups.count() >= MAX_GROUPS) continue;
      const t = now();
      mine.set(key, db.groups.insert({
        id: uid(), name, name_key: key, description: '', source, external_id: name, permissions: [], default_model_id: null,
        priority: db.groups.count(), created_by: null, created_at: t, updated_at: t
      }));
    }
    for (const g of mine.values()) {
      if (wanted.has(g.name_key)) link(g.id, 'user', userId, null, source);
      else unlink(g.id, 'user', userId);
    }
  });
}

export function createSourceGroup({ name: raw, source, externalId = null }) {
  const name = cleanName(raw);
  if (!name) return { status: 400, error: 'Give the group a name.' };
  if (db.groups.count() >= MAX_GROUPS) return { status: 400, error: 'This workspace has reached the group limit.' };
  const key = nameKey(name);
  if (db.groups.all().some(g => g.source === source && g.name_key === key)) return { status: 409, error: 'A group with that name already exists.' };
  const t = now();
  const group = db.groups.insert({
    id: uid(), name, name_key: key, description: '', source, external_id: externalId, permissions: [], default_model_id: null,
    priority: db.groups.count(), created_by: null, created_at: t, updated_at: t
  });
  return { group };
}

export function renameSourceGroup(group, raw, externalId) {
  const name = cleanName(raw);
  if (!name) return { status: 400, error: 'Give the group a name.' };
  const key = nameKey(name);
  if (db.groups.all().some(g => g.id !== group.id && g.source === group.source && g.name_key === key)) return { status: 409, error: 'A group with that name already exists.' };
  return { group: db.groups.update(group.id, { name, name_key: key, external_id: externalId ?? group.external_id ?? null, updated_at: now() }) };
}

export function setSourceMembers(groupId, userIds, source) {
  const keep = new Set(userIds);
  tx(() => {
    for (const userId of db.groupMembers.usersOf(groupId)) if (!keep.has(userId)) unlink(groupId, 'user', userId);
    for (const userId of keep) link(groupId, 'user', userId, null, source);
  });
}

export function setMembers(groupId, { add: adds = [], remove = [] }, actorId) {
  const group = db.groups.byId(groupId);
  if (!group) return { status: 404, error: 'not found' };
  if (group.source !== LOCAL) return { status: 409, error: 'This group is kept in sync by its directory, so its members can’t be changed here.' };
  const ids = (list) => [...new Set((Array.isArray(list) ? list : []).filter(id => typeof id === 'string'))].slice(0, 500);
  const toAdd = ids(adds);
  if (toAdd.some(id => !db.users.byId(id))) return { status: 400, error: 'One of those accounts no longer exists.' };
  tx(() => {
    for (const userId of toAdd) link(groupId, 'user', userId, actorId);
    for (const userId of ids(remove)) unlink(groupId, 'user', userId);
  });
  return { ok: true };
}

export function nestGroup(parentId, childId, actorId) {
  return tx(() => {
    const { groups, parents, children } = graph();
    const parent = groups.get(parentId);
    if (!parent || !groups.has(childId)) return { status: 404, error: 'not found' };
    if (parent.source !== LOCAL) return { status: 409, error: 'A group kept in sync by its directory can’t contain other groups.' };
    if (parentId === childId || reach(childId, children).has(parentId)) return { status: 409, error: 'That would put a group inside itself.' };
    if (longest(parentId, parents) + longest(childId, children) > MAX_DEPTH) return { status: 409, error: 'Groups can be nested at most 8 levels deep.' };
    link(parentId, 'group', childId, actorId);
    return { ok: true };
  });
}

export function unnestGroup(parentId, childId) {
  unlink(parentId, 'group', childId);
  return { ok: true };
}

export function reorderGroups(order) {
  const ids = Array.isArray(order) ? order.filter(id => typeof id === 'string') : [];
  tx(() => ids.forEach((id, i) => { if (db.groups.byId(id)) db.groups.update(id, { priority: i }); }));
  return { ok: true };
}

export function groupView(g, counts = new Map()) {
  const c = counts.get(g.id) || {};
  return {
    id: g.id, name: g.name, description: g.description || '', source: g.source || LOCAL,
    permissions: cleanPermissions(g.permissions, MEMBER), defaultModelId: g.default_model_id || null, priority: g.priority ?? 0,
    members: c.user || 0, groups: c.group || 0, createdAt: g.created_at || 0
  };
}

export function memberCounts() {
  const out = new Map();
  for (const r of db.groupMembers.counts()) {
    if (!out.has(r.group_id)) out.set(r.group_id, {});
    out.get(r.group_id)[r.member_type] = r.n;
  }
  return out;
}