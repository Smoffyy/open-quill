import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newerVersion, syncDelay, draftReloads, SYNC_JITTER_MS } from '../src/lib/configsync.js';

test('only a newer release triggers a refetch', () => {
  assert.equal(newerVersion(4, 5), 5);
  assert.equal(newerVersion(5, 5), 0, 'the same release twice is one refetch');
  assert.equal(newerVersion(6, 5), 0, 'a late frame never rolls a client back');
  assert.equal(newerVersion(0, undefined), 0);
  assert.equal(newerVersion(undefined, '3'), 3);
});

test('members spread their refetch out, admins do not wait', () => {
  assert.equal(syncDelay(true, () => 0.99), 0);
  assert.equal(syncDelay(false, () => 0), 0);
  assert.equal(syncDelay(false, () => 1), SYNC_JITTER_MS);
  assert.ok(syncDelay(false) <= SYNC_JITTER_MS);
});

test('a draft frame reloads only what it touched, and never echoes a theme back to its own tab', () => {
  assert.deepEqual(draftReloads({ scope: 'models' }, 'me'), ['models']);
  assert.deepEqual(draftReloads({ scope: 'settings' }, 'me'), ['config']);
  assert.deepEqual(draftReloads({ scope: 'theme', tab: 'other' }, 'me'), ['theme']);
  assert.deepEqual(draftReloads({ scope: 'theme', tab: 'me' }, 'me'), []);
  assert.deepEqual(draftReloads({ scope: 'all' }, 'me'), ['models', 'config', 'theme']);
  assert.deepEqual(draftReloads({ scope: 'folders' }, 'me'), []);
  assert.deepEqual(draftReloads({ scope: '__proto__' }, 'me'), []);
});