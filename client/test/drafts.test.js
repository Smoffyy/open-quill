import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftKey } from '../src/lib/drafts.js';

test('draftKey namespaces per chat and has one slot for the unsaved new chat', () => {
  assert.equal(draftKey('abc'), 'oq-draft-abc');
  assert.equal(draftKey(null), 'oq-draft-new');
  assert.notEqual(draftKey('a'), draftKey('b'));
});
