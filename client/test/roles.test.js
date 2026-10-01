import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManage, canAssign } from '../src/lib/roles.js';

test('only the owner manages publishers, and nobody manages their own rank', () => {
  assert.equal(canManage('owner', 'publisher'), true);
  assert.equal(canManage('publisher', 'publisher'), false);
  assert.equal(canManage('publisher', 'editor'), true);
  assert.equal(canManage('editor', 'editor'), false);
  assert.equal(canManage('editor', 'member'), true);
  assert.equal(canManage('publisher', 'owner'), false);
});

test('a role can only be granted below your own', () => {
  assert.equal(canAssign('owner', 'publisher'), true);
  assert.equal(canAssign('owner', 'owner'), false, 'ownership is never handed out here');
  assert.equal(canAssign('publisher', 'publisher'), false);
  assert.equal(canAssign('publisher', 'editor'), true);
  assert.equal(canAssign('editor', 'editor'), false);
  assert.equal(canAssign('editor', 'member'), true);
  assert.equal(canAssign('owner', 'nonsense'), false);
});
