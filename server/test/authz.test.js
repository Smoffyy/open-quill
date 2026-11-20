import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3-multiple-ciphers';
import { SCHEMA, MIGRATIONS, migrate } from '../db/schema.js';

const SERVER_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB_DIR = path.join(SERVER_ROOT, 'data', 'databases', 'oqauthztest');

process.env.OPEN_QUILL_DB = 'oqauthztest';
fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const { db, uid, closeDb, setSetting, delSetting } = await import('../db.js');
const { PERMISSIONS, PERMISSION_IDS, ADMIN_PERMISSIONS, MEMBER_PERMISSIONS, DEFAULT_USER_BASELINE, cleanPermissions } = await import('../lib/authz/permissions.js');
const { permissionsOfRole, rankOfRole, roleExists, roleList, userBaseline } = await import('../lib/authz/roles.js');
const { can, permissionsOf, rankOf, isOwner, gateOf, explain, groupIdsOf } = await import('../lib/authz/effective.js');
const { createGroup, updateGroup, deleteGroup, setMembers, nestGroup, unnestGroup, closure, MAX_DEPTH } = await import('../lib/authz/groups.js');
const { modelAllowed, defaultModelFor, allowedFor } = await import('../lib/authz/access.js');
const { canActOn, canAssign, isLastOwner } = await import('../lib/authz/rules.js');
const { levelOf, access, grant, revoke, accessList, sharedWith, usersReached, canReadUpload, ownsUpload } = await import('../lib/authz/acl.js');

after(() => {
  closeDb();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const person = (role, extra = {}) => db.users.insert({ id: uid(), email: `${uid()}@authz.test`, role, status: 'active', source: 'local', prefs: {}, created_at: Date.now(), ...extra });

beforeEach(() => {
  for (const g of db.groups.all()) deleteGroup(g.id);
  for (const u of db.users.all()) db.users.removeById(u.id);
  for (const r of db.roles.all()) db.roles.removeById(r.id);
  db.acl.prune();
  delSetting('auth_user_baseline');
});

test('the permission registry is unique, tiered and gives users nothing administrative', () => {
  assert.equal(new Set(PERMISSION_IDS).size, PERMISSION_IDS.length, 'ids are unique');
  for (const p of PERMISSIONS) {
    assert.ok(p.tier === 'member' || p.tier === 'admin', `${p.id} has a tier`);
    assert.equal(p.id.startsWith('admin.'), p.tier === 'admin', `${p.id} is named for its tier`);
  }
  assert.equal(MEMBER_PERMISSIONS.length + ADMIN_PERMISSIONS.length, PERMISSION_IDS.length);
  assert.ok(DEFAULT_USER_BASELINE.every(id => MEMBER_PERMISSIONS.includes(id)));
  assert.ok(!DEFAULT_USER_BASELINE.includes('chats.advanced') && !DEFAULT_USER_BASELINE.includes('models.unavailable'));
  assert.deepEqual(cleanPermissions(['tools.memory', 'nope', 'admin.users', 'chats.create', 'chats.create', 7], 'member'), ['chats.create', 'tools.memory'], 'unknown, duplicate and out-of-tier ids are dropped, registry order kept');
  assert.deepEqual(cleanPermissions('chats.create'), [], 'a non-list grants nothing');
});

test('built-in roles carry their baselines and unknown roles carry nothing', () => {
  assert.equal(permissionsOfRole('pending').size, 0);
  assert.deepEqual([...permissionsOfRole('user')], DEFAULT_USER_BASELINE);
  assert.deepEqual([...permissionsOfRole('admin')].sort(), [...PERMISSION_IDS].sort());
  assert.deepEqual([...permissionsOfRole('owner')].sort(), [...PERMISSION_IDS].sort());
  assert.equal(permissionsOfRole('ghost').size, 0);
  assert.equal(rankOfRole('ghost'), -1);
  assert.ok(rankOfRole('pending') < rankOfRole('user') && rankOfRole('user') < rankOfRole('admin') && rankOfRole('admin') < rankOfRole('owner'));
  assert.equal(roleExists('__proto__'), false, 'lookup tables do not leak prototype keys');
});

test('a custom role is the user baseline plus its extras, and presets follow the registry', () => {
  db.roles.insert({ id: 'auditor', rank: 40, name: 'Auditor', permissions: ['admin.panel', 'admin.audit', 'bogus'] });
  db.roles.insert({ id: 'editor', rank: 50, name: 'Editor', permissions: [], preset: 'legacy-editor' });
  const auditor = permissionsOfRole('auditor');
  assert.ok(auditor.has('admin.audit') && auditor.has('chats.create') && !auditor.has('admin.users') && !auditor.has('bogus'));
  const editor = permissionsOfRole('editor');
  assert.ok(!editor.has('admin.publish'), 'the legacy editor cannot publish');
  assert.ok(ADMIN_PERMISSIONS.filter(id => id !== 'admin.publish').every(id => editor.has(id)), 'but holds every other admin permission');
  assert.deepEqual(roleList().map(r => r.id), ['owner', 'admin', 'editor', 'auditor', 'user', 'pending'], 'listed by rank');
});

test('narrowing the user baseline changes users and custom roles at once, and never admits admin permissions', () => {
  db.roles.insert({ id: 'helper', rank: 20, name: 'Helper', permissions: ['admin.panel'] });
  const u = person('user');
  const h = person('helper');
  assert.ok(can(u, 'code.use') && can(h, 'code.use'));
  setSetting('auth_user_baseline', ['chats.create', 'admin.users']);
  assert.deepEqual(userBaseline(), ['chats.create']);
  assert.equal(can(u, 'code.use'), false);
  assert.equal(can(h, 'code.use'), false, 'custom roles build on the baseline');
  assert.equal(can(u, 'admin.users'), false);
  assert.ok(can(h, 'admin.panel'));
});

test('disabled accounts, pending accounts and missing roles hold no permissions', () => {
  const off = person('admin', { status: 'disabled' });
  assert.equal(permissionsOf(off).size, 0);
  assert.equal(isOwner(person('owner', { status: 'disabled' })), false);
  const pending = person('pending');
  assert.equal(gateOf(pending), 'pending');
  assert.equal(permissionsOf(pending).size, 0);
  const legacy = person(undefined);
  assert.equal(gateOf(legacy), 'pending', 'an account with no role fails closed');
  assert.equal(can(null, 'chats.create'), false);
});

test('nobody acts on an equal or higher rank, except owners on owners', () => {
  db.roles.insert({ id: 'editor', rank: 50, name: 'Editor', permissions: [], preset: 'legacy-editor' });
  db.roles.insert({ id: 'viewer', rank: 30, name: 'Viewer', permissions: ['admin.panel'] });
  const owner = person('owner');
  const owner2 = person('owner');
  const admin = person('admin');
  const admin2 = person('admin');
  const editor = person('editor');
  const viewer = person('viewer');
  const user = person('user');
  const pending = person('pending');

  assert.ok(canActOn(owner, owner2) && canActOn(owner, admin) && canActOn(owner, pending));
  assert.equal(canActOn(owner, owner), false, 'not on yourself');
  assert.ok(canActOn(admin, editor) && canActOn(admin, user) && canActOn(admin, pending));
  assert.equal(canActOn(admin, admin2), false);
  assert.equal(canActOn(admin, owner), false);
  assert.ok(canActOn(editor, user) && canActOn(editor, viewer));
  assert.equal(canActOn(editor, admin), false);
  assert.equal(canActOn(viewer, user), false, 'rank alone is not enough without user management');
  assert.equal(canActOn(user, pending), false);

  assert.ok(canAssign(owner, admin, 'owner'), 'owners make owners');
  assert.ok(canAssign(owner, user, 'admin'));
  assert.equal(canAssign(admin, user, 'admin'), false, 'admins do not make admins');
  assert.ok(canAssign(admin, user, 'editor'));
  assert.ok(canAssign(admin, pending, 'user'));
  assert.equal(canAssign(admin, user, 'owner'), false);
  assert.equal(canAssign(editor, user, 'editor'), false, 'never a role at your own rank');
  assert.ok(canAssign(editor, pending, 'viewer'));
  assert.equal(canAssign(admin, user, 'ghost'), false);
  assert.equal(rankOf(editor), 50);
});

test('the last active owner is protected, and a disabled owner does not count', () => {
  const a = person('owner');
  assert.equal(isLastOwner(a), true);
  const b = person('owner', { status: 'disabled' });
  assert.equal(isLastOwner(a), true, 'a disabled owner cannot take over');
  db.users.update(b.id, { status: 'active' });
  assert.equal(isLastOwner(a), false);
  assert.equal(isLastOwner(person('admin')), false);
});

test('the role migration maps the old tiers and the sign-up switch', () => {
  const sdb = new Database(':memory:');
  const roleMigration = MIGRATIONS.findIndex(m => m.includes('CREATE TABLE IF NOT EXISTS roles'));
  sdb.exec(SCHEMA);
  for (let i = 0; i < roleMigration; i++) sdb.exec(MIGRATIONS[i]);
  sdb.pragma(`user_version = ${roleMigration + 1}`);
  const add = (id, data) => sdb.prepare('INSERT INTO users (id, email, created_at, data) VALUES (?, ?, 0, ?)').run(id, id + '@x.test', JSON.stringify({ id, email: id + '@x.test', ...data }));
  add('own', { is_admin: 1, is_owner: 1, can_publish: 1 });
  add('pub', { is_admin: 1, can_publish: 1 });
  add('old', { is_admin: 1 });
  add('ed', { is_admin: 1, can_publish: 0 });
  add('mem', { is_admin: 0 });
  sdb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('allow_signups', JSON.stringify('0'));
  migrate(sdb);
  const user = (id) => JSON.parse(sdb.prepare('SELECT data FROM users WHERE id=?').get(id).data);
  assert.equal(user('own').role, 'owner');
  assert.equal(user('pub').role, 'admin');
  assert.equal(user('old').role, 'admin', 'admins from before publishing existed keep publishing');
  assert.equal(user('ed').role, 'editor');
  assert.equal(user('mem').role, 'user');
  for (const id of ['own', 'pub', 'ed', 'mem']) {
    const u = user(id);
    assert.equal(u.status, 'active');
    assert.ok(!('is_admin' in u) && !('is_owner' in u) && !('can_publish' in u), 'the old flags are removed');
  }
  const editor = JSON.parse(sdb.prepare("SELECT data FROM roles WHERE id='editor'").get().data);
  assert.equal(editor.preset, 'legacy-editor');
  assert.equal(JSON.parse(sdb.prepare("SELECT value FROM settings WHERE key='auth_signup_policy'").get().value), 'closed');
  assert.equal(sdb.prepare("SELECT 1 FROM settings WHERE key='allow_signups'").get(), undefined);
  sdb.close();
});

test('the editor role is only created when someone was an editor', () => {
  const sdb = new Database(':memory:');
  migrate(sdb);
  assert.equal(sdb.prepare('SELECT count(*) AS n FROM roles').get().n, 0);
  assert.equal(sdb.prepare("SELECT 1 FROM settings WHERE key='auth_signup_policy'").get(), undefined, 'a fresh install keeps the default');
  sdb.close();
});

const group = (name, permissions = []) => {
  const { group: g } = createGroup({ name }, null);
  if (permissions.length) updateGroup(g.id, { permissions });
  return g.id;
};
const join = (groupId, user) => assert.ok(setMembers(groupId, { add: [user.id] }, null).ok);

test('a nested group passes its permissions down, and unlinking takes them back on the next check', () => {
  setSetting('auth_user_baseline', ['chats.create']);
  const u = person('user');
  const team = group('Team');
  const search = group('Search users', ['tools.web_search']);
  join(team, u);
  assert.equal(can(u, 'tools.web_search'), false);
  assert.ok(nestGroup(search, team, null).ok, 'Team goes inside Search users');
  assert.equal(can(u, 'tools.web_search'), true, 'members of the child inherit the parent');
  assert.deepEqual(explain(u).permissions.find(p => p.id === 'tools.web_search').sources[0].path.map(x => x.name), ['Team', 'Search users']);
  unnestGroup(search, team);
  assert.equal(can(u, 'tools.web_search'), false);
  nestGroup(search, team, null);
  setMembers(team, { remove: [u.id] }, null);
  assert.equal(can(u, 'tools.web_search'), false, 'leaving the direct group drops everything inherited through it');
});

test('overlapping grants survive the loss of one of them', () => {
  setSetting('auth_user_baseline', []);
  const u = person('user');
  const a = group('A', ['code.use']);
  const b = group('B', ['code.use', 'tools.memory']);
  join(a, u);
  join(b, u);
  updateGroup(b, { permissions: ['tools.memory'] });
  assert.ok(can(u, 'code.use'), 'still granted by A');
  deleteGroup(a);
  assert.equal(can(u, 'code.use'), false);
  assert.ok(can(u, 'tools.memory'));
});

test('groups never grant admin permissions, even when the stored data claims so', () => {
  const u = person('user');
  const g = group('Sneaky');
  assert.equal(updateGroup(g, { permissions: ['admin.users'] }).status, 400);
  db.groups.update(g, { permissions: ['admin.users', 'admin.panel', 'code.use'] });
  join(g, u);
  assert.equal(can(u, 'admin.users'), false);
  assert.equal(can(u, 'admin.panel'), false);
  assert.ok(can(u, 'code.use'));
});

test('pending and disabled accounts get nothing from their groups', () => {
  const g = group('Everyone', ['tools.web_search', 'chats.create']);
  const pending = person('pending');
  const off = person('user', { status: 'disabled' });
  join(g, pending);
  join(g, off);
  assert.equal(permissionsOf(pending).size, 0);
  assert.equal(permissionsOf(off).size, 0);
  assert.equal(groupIdsOf(pending).size, 0);
});

test('cycles are refused, depth is capped, and diamonds count each group once', () => {
  const a = group('A');
  const b = group('B');
  assert.ok(nestGroup(a, b, null).ok);
  assert.equal(nestGroup(b, a, null).status, 409, 'B already sits inside A');
  assert.equal(nestGroup(a, a, null).status, 409, 'nor inside itself');

  const chain = Array.from({ length: MAX_DEPTH }, (_, i) => group('Level ' + i));
  for (let i = 1; i < chain.length; i++) assert.ok(nestGroup(chain[i - 1], chain[i], null).ok, `level ${i}`);
  const extra = group('Too deep');
  assert.equal(nestGroup(chain[chain.length - 1], extra, null).status, 409, 'a ninth level is refused');
  assert.equal(nestGroup(extra, chain[0], null).status, 409, 'from either end');

  const leaf = group('Leaf');
  const left = group('Left');
  const right = group('Right');
  const top = group('Top', ['tools.consult']);
  nestGroup(left, leaf, null);
  nestGroup(right, leaf, null);
  nestGroup(top, left, null);
  nestGroup(top, right, null);
  const seen = closure([leaf]);
  assert.deepEqual([...seen.keys()].sort(), [leaf, left, right, top].sort());
  assert.equal(seen.get(top).depth, 2);
  const u = person('user');
  join(leaf, u);
  assert.equal(explain(u).permissions.find(p => p.id === 'tools.consult').sources.filter(s => s.type === 'group').length, 1, 'one grant, not one per path');
});

test('hand-made cycles in the stored links cannot loop the closure', () => {
  const a = group('Loop A');
  const b = group('Loop B', ['tools.memory']);
  db.groupMembers.insert({ id: uid(), group_id: a, member_type: 'group', member_id: b, source: 'manual' });
  db.groupMembers.insert({ id: uid(), group_id: b, member_type: 'group', member_id: a, source: 'manual' });
  const u = person('user');
  join(a, u);
  assert.ok(can(u, 'tools.memory'));
  assert.equal(closure([a]).size, 2);
});

test('the default model follows the personal choice, then group priority and distance, then the workspace', () => {
  const m = (id, extra = {}) => ({ id, enabled: 1, ...extra });
  const pool = [m('ws', { is_default: 1 }), m('near'), m('far'), m('first'), m('locked', { access_groups: ['nobody'] })];
  const u = person('user');
  assert.equal(defaultModelFor(u, pool).id, 'ws', 'no groups: the workspace default');
  const close = group('Close');
  const parent = group('Parent');
  updateGroup(parent, { defaultModelId: 'far' });
  join(close, u);
  nestGroup(parent, close, null);
  assert.equal(defaultModelFor(u, pool).id, 'far');
  updateGroup(close, { defaultModelId: 'near' });
  db.groups.update(close, { priority: 5 });
  db.groups.update(parent, { priority: 5 });
  assert.equal(defaultModelFor(u, pool).id, 'near', 'at equal priority the nearer group wins');
  db.groups.update(parent, { priority: 1 });
  assert.equal(defaultModelFor(u, pool).id, 'far', 'priority beats distance');
  updateGroup(parent, { defaultModelId: 'gone' });
  assert.equal(defaultModelFor(u, pool).id, 'near', 'a default that is not usable is skipped');
  const chooser = person('user', { prefs: { defaultModel: 'first' } });
  join(close, chooser);
  assert.equal(defaultModelFor(chooser, pool).id, 'first', 'a personal choice wins');
  assert.equal(defaultModelFor(person('pending'), pool).id, 'ws');
});

test('restricted models and servers are open to their groups, nested members and the matching admins', () => {
  const u = person('user');
  const outsider = person('user');
  const team = group('Model team');
  const inner = group('Inner team');
  nestGroup(team, inner, null);
  join(inner, u);
  const model = { id: 'm', enabled: 1, access_groups: [team] };
  assert.ok(modelAllowed(u, model), 'through the nested group');
  assert.equal(modelAllowed(outsider, model), false);
  assert.ok(modelAllowed(outsider, { id: 'open', enabled: 1 }), 'no list means everyone');
  assert.ok(modelAllowed(person('admin'), model), 'model admins see everything');
  assert.equal(allowedFor(outsider, [team], 'admin.tools'), false);
  assert.ok(allowedFor(person('admin'), [team], 'admin.tools'));
});

const project = (owner) => db.projects.insert({ id: uid(), user_id: owner.id, name: 'Plans', created_at: Date.now(), updated_at: Date.now() });
const chatOf = (owner, mode = 'chat') => db.chats.insert({ id: uid(), user_id: owner.id, title: 'Notes', mode, created_at: Date.now(), updated_at: Date.now() });

test('a shared project gives exactly the granted level, through nested groups, and revoking takes it back', () => {
  const owner = person('user');
  const viewer = person('user');
  const member = person('user');
  const p = project(owner);
  assert.equal(levelOf(owner, 'project', p), 'owner');
  assert.equal(levelOf(viewer, 'project', p), null);
  assert.ok(grant(owner, 'project', p, 'user', viewer.id, 'view').ok);
  assert.equal(levelOf(viewer, 'project', p), 'view');
  assert.equal(access(viewer, 'project', p.id, 'edit').status, 403, 'seen but not editable');
  assert.equal(access(member, 'project', p.id).status, 404, 'no access looks exactly like no project');
  assert.equal(access(member, 'project', 'missing').status, 404);
  assert.equal(access(member, 'project', { id: p.id }).status, 404, 'a non-string id matches nothing');

  const team = group('Team');
  const inner = group('Inner');
  nestGroup(team, inner, null);
  join(inner, member);
  assert.ok(grant(owner, 'project', p, 'group', team, 'edit').ok);
  assert.equal(levelOf(member, 'project', p), 'edit', 'members of a nested group get the group grant');
  assert.deepEqual(usersReached('group', team), [member.id]);
  assert.ok(grant(owner, 'project', p, 'user', member.id, 'view').ok);
  assert.equal(levelOf(member, 'project', p), 'edit', 'the highest grant wins');
  const why = accessList('project', p).people.find(x => x.id === member.id);
  assert.deepEqual(why.reasons.map(r => r.type).sort(), ['direct', 'group']);
  assert.deepEqual(why.reasons.find(r => r.type === 'group').path.map(g => g.name), ['Team', 'Inner']);
  assert.ok(revoke(owner, 'project', p, 'group', team).ok);
  assert.equal(levelOf(member, 'project', p), 'view', 'the direct grant is all that is left');
  deleteGroup(inner);
  assert.ok(grant(owner, 'project', p, 'group', team, 'manage').ok);
  deleteGroup(team);
  assert.equal(db.acl.forResource('project', p.id).some(e => e.principal_type === 'group'), false, 'deleting a group removes what was shared with it');
});

test('only managers share, never above their own level, and only with the share permission', () => {
  const owner = person('user');
  const editor = person('user');
  const manager = person('user');
  const other = person('user');
  const p = project(owner);
  assert.ok(grant(owner, 'project', p, 'user', editor.id, 'edit').ok);
  assert.ok(grant(owner, 'project', p, 'user', manager.id, 'manage').ok);
  assert.equal(grant(editor, 'project', p, 'user', other.id, 'view').status, 403, 'an editor cannot share');
  assert.ok(grant(manager, 'project', p, 'user', other.id, 'manage').ok, 'a manager shares up to manage');
  assert.equal(grant(owner, 'project', p, 'user', other.id, 'owner').status, 400, 'ownership is not a grant');
  assert.equal(grant(owner, 'project', p, 'user', owner.id, 'view').status, 400, 'the owner needs no grant');
  assert.equal(grant(owner, 'project', p, 'user', person('pending').id, 'view').status, 400, 'pending accounts cannot be picked');
  assert.equal(grant(owner, 'project', p, 'user', 'ghost', 'view').status, 400);
  assert.equal(grant(owner, 'project', p, 'user', '__proto__', 'view').status, 400);
  assert.equal(grant(owner, 'project', p, 'user', other.id, '__proto__').status, 400);
  const stranger = person('user');
  assert.equal(grant(stranger, 'project', p, 'user', stranger.id, 'view').status, 404, 'a stranger learns nothing');
  assert.equal(revoke(stranger, 'project', p, 'user', editor.id).status, 404);
  setSetting('auth_user_baseline', DEFAULT_USER_BASELINE.filter(id => id !== 'projects.share'));
  assert.equal(grant(owner, 'project', p, 'user', stranger.id, 'view').status, 403, 'without the share permission nobody shares');
  assert.equal(revoke(editor, 'project', p, 'user', manager.id).status, 403, 'an editor cannot take access away');
  assert.ok(revoke(editor, 'project', p, 'user', editor.id).ok, 'anyone can leave');
  assert.equal(levelOf(editor, 'project', p), null);
});

test('chats share read-only, Code sessions never, and inactive accounts lose what was shared', () => {
  const owner = person('user');
  const reader = person('user');
  const chat = chatOf(owner);
  assert.equal(grant(owner, 'chat', chat, 'user', reader.id, 'edit').status, 400, 'chats are read-only shares');
  assert.ok(grant(owner, 'chat', chat, 'user', reader.id, 'view').ok);
  assert.equal(grant(owner, 'chat', chatOf(owner, 'code'), 'user', reader.id, 'view').status, 400);
  assert.deepEqual([...sharedWith(reader, 'chat').keys()], [chat.id]);
  db.users.update(reader.id, { status: 'disabled' });
  const off = db.users.byId(reader.id);
  assert.equal(levelOf(off, 'chat', chat), null);
  assert.equal(sharedWith(off, 'chat').size, 0);
  assert.equal(accessList('chat', chat).people.length, 0, 'and they drop out of the access list');
});

test('an upload is read by its owner, by readers of a shared chat that shows it, and workspace files by everyone', () => {
  const owner = person('user');
  const reader = person('user');
  const stranger = person('user');
  const file = `${uid()}.png`;
  db.uploads.insert({ id: file, file, user_id: owner.id, workspace: false, created_at: Date.now() });
  const icon = `${uid()}.svg`;
  db.uploads.insert({ id: icon, file: icon, user_id: null, workspace: true, created_at: Date.now() });
  const chat = chatOf(owner);
  db.messages.insert({ id: uid(), chat_id: chat.id, role: 'user', content: 'look', attachments: [{ url: '/uploads/' + file, name: 'a.png' }], parent_id: null, created_at: Date.now() });
  const url = '/uploads/' + file;
  assert.ok(canReadUpload(owner, url));
  assert.ok(ownsUpload(owner, url));
  assert.equal(canReadUpload(stranger, url), false);
  assert.ok(grant(owner, 'chat', chat, 'user', reader.id, 'view').ok);
  assert.ok(canReadUpload(reader, url), 'shown in a chat shared with them');
  assert.equal(ownsUpload(reader, url), false, 'reading is not owning, so it cannot be attached anywhere else');
  assert.equal(canReadUpload(stranger, url), false);
  assert.ok(canReadUpload(stranger, '/' + icon), 'workspace files are open to members');
  assert.equal(canReadUpload(person('pending'), '/' + icon), false);
  assert.ok(canReadUpload(owner, '/' + file.toUpperCase()), 'case does not hide a file from its owner');
  assert.equal(canReadUpload(stranger, '/' + file.toUpperCase()), false, 'nor open it to anyone else');
  assert.equal(canReadUpload(stranger, '/' + file + '.'), false, 'a trailing dot is not a way round the owner');
  assert.equal(canReadUpload(stranger, '/' + file + '::$DATA'), false);
  assert.equal(canReadUpload(owner, '/' + file + '.txt'), false, 'extracted text is never served');
  assert.equal(canReadUpload(stranger, '/%2e%2e%2f' + file), false);
  assert.equal(canReadUpload(owner, '/%E0%A4%A'), false, 'a malformed escape is refused');
  assert.ok(revoke(owner, 'chat', chat, 'user', reader.id).ok);
  assert.equal(canReadUpload(reader, url), false, 'revoking the chat revokes what it showed');
});