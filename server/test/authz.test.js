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
const { can, permissionsOf, rankOf, isOwner, gateOf } = await import('../lib/authz/effective.js');
const { canActOn, canAssign, isLastOwner } = await import('../lib/authz/rules.js');

after(() => {
  closeDb();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const person = (role, extra = {}) => db.users.insert({ id: uid(), email: `${uid()}@authz.test`, role, status: 'active', source: 'local', prefs: {}, created_at: Date.now(), ...extra });

beforeEach(() => {
  for (const u of db.users.all()) db.users.removeById(u.id);
  for (const r of db.roles.all()) db.roles.removeById(r.id);
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