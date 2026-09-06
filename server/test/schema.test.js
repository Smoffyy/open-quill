import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3-multiple-ciphers';
import { SCHEMA, MIGRATIONS, LATEST_VERSION, migrate } from '../db/schema.js';

const fresh = () => new Database(':memory:');
const tables = (sdb) =>
  new Set(sdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
const indexes = (sdb) =>
  new Set(sdb.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name));

const EXPECTED_TABLES = [
  'users', 'folders', 'chats', 'messages', 'models', 'usage', 'settings',
  'spaces', 'space_messages', 'sessions', 'audit', 'projects', 'feedback',
  'toolstats', 'tasks', 'skills'
];

test('an empty database migrates all the way to the current version', () => {
  const sdb = fresh();
  assert.equal(sdb.pragma('user_version', { simple: true }), 0);
  assert.equal(migrate(sdb), LATEST_VERSION);
  assert.equal(LATEST_VERSION, MIGRATIONS.length + 1, 'SCHEMA is version 1 and each migration adds one');
  for (const t of EXPECTED_TABLES) assert.ok(tables(sdb).has(t), `table ${t} exists`);
  sdb.close();
});

test('migrating is idempotent and never re-runs a step', () => {
  const sdb = fresh();
  migrate(sdb);
  const before = { tables: tables(sdb), indexes: indexes(sdb) };
  assert.equal(migrate(sdb), LATEST_VERSION, 'a second pass is a no-op');
  assert.deepEqual([...tables(sdb)].sort(), [...before.tables].sort());
  assert.deepEqual([...indexes(sdb)].sort(), [...before.indexes].sort());
  sdb.close();
});

test('a database part-way through the migrations catches up from where it is', () => {
  const sdb = fresh();
  sdb.exec(SCHEMA);
  sdb.pragma('user_version = 1');
  assert.equal(tables(sdb).has('spaces'), false, 'spaces arrives in a later migration');

  assert.equal(migrate(sdb), LATEST_VERSION);
  assert.ok(tables(sdb).has('spaces'));
  assert.ok(tables(sdb).has('skills'));
  sdb.close();
});

test('every migration is valid SQL on its own', () => {
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const sdb = fresh();
    sdb.exec(SCHEMA);
    sdb.pragma('user_version = 1');
    for (let j = 0; j <= i; j++) sdb.exec(MIGRATIONS[j]);
    assert.ok(tables(sdb).size > 0, `migrations 1..${i + 2} apply cleanly`);
    sdb.close();
  }
});
