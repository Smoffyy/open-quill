import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimStorage, clearPrivateStorage, isPrivateKey } from '../src/lib/privacy.js';
import { STORE_KEY } from '../src/lib/playground.js';

function memoryStore(seed = {}) {
  const data = { ...seed };
  const store = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
  return new Proxy(store, { ownKeys: () => Object.keys(data), getOwnPropertyDescriptor: (_t, k) => (k in data ? { enumerable: true, configurable: true, value: data[k] } : undefined) });
}

test('unsent drafts and playground runs are private, interface choices are not', () => {
  assert.ok(isPrivateKey('oq-draft-abc'));
  assert.ok(isPrivateKey('oq-draft-new'));
  assert.ok(isPrivateKey(STORE_KEY));
  assert.ok(!isPrivateKey('oq-lang'));
  assert.ok(!isPrivateKey('oq-palette'));
});

test('signing out clears private content and keeps preferences', () => {
  const store = memoryStore({ 'oq-draft-new': 'secret plan', [STORE_KEY]: '{}', 'oq-lang': 'de', 'oq-owner': 'u1' });
  clearPrivateStorage(store);
  assert.deepEqual(Object.keys(store).sort(), ['oq-lang']);
});

test('a different account on the same browser never sees the previous drafts', () => {
  const store = memoryStore({ 'oq-draft-new': 'from u1', 'oq-owner': 'u1' });
  claimStorage('u1', store);
  assert.equal(store.getItem('oq-draft-new'), 'from u1');
  claimStorage('u2', store);
  assert.equal(store.getItem('oq-draft-new'), null);
  assert.equal(store.getItem('oq-owner'), 'u2');
});