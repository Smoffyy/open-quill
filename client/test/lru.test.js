import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLru } from '../src/lib/lru.js';

test('lru evicts the least recently used once past its limit', () => {
  const c = createLru(3);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  c.set('d', 4);
  assert.equal(c.has('a'), false, 'oldest went');
  assert.deepEqual(c.keys(), ['b', 'c', 'd']);
  assert.equal(c.size, 3);
});

test('lru counts a re-set as fresh use, so it is not the next evicted', () => {
  const c = createLru(3);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  c.set('a', 9);
  c.set('d', 4);
  assert.equal(c.has('a'), true, 'a was touched, so b went instead');
  assert.equal(c.has('b'), false);
  assert.equal(c.get('a'), 9);
});

test('lru merge lets a chat arrive in pieces without wiping the earlier ones', () => {
  const c = createLru(3);
  c.merge('x', { chat: { id: 'x' } });
  c.merge('x', { messages: [1, 2] });
  c.merge('x', { files: ['a.py'] });
  assert.deepEqual(c.get('x'), { chat: { id: 'x' }, messages: [1, 2], files: ['a.py'] });
});

test('lru merge overwrites only the keys it is given', () => {
  const c = createLru(3);
  c.merge('x', { messages: [1], files: ['a'] });
  c.merge('x', { messages: [1, 2] });
  assert.deepEqual(c.get('x'), { messages: [1, 2], files: ['a'] });
});

test('lru ignores a missing key rather than caching under undefined', () => {
  const c = createLru(3);
  c.set(null, 1); c.set('', 2); c.merge(undefined, { a: 1 });
  assert.equal(c.size, 0);
});
