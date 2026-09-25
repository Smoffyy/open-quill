import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFileWrite, fileFrom, mergeCall, supersededFile } from '../src/lib/livetools.js';

test('isFileWrite only claims the two tools that actually write a file', () => {
  assert.equal(isFileWrite({ tool: 'create_file', path: 'a.py' }), true);
  assert.equal(isFileWrite({ tool: 'str_replace', path: 'a.py' }), true);
  assert.equal(isFileWrite({ tool: 'bash', path: 'a.py' }), false);
  assert.equal(isFileWrite({ tool: 'create_file' }), false, 'no path yet, nothing to preview');
  assert.equal(isFileWrite(null), false);
});

test('fileFrom normalises a partial live call into a preview record', () => {
  assert.deepEqual(fileFrom({ tool: 'create_file', path: 'a.py' }),
    { path: 'a.py', content: '', tool: 'create_file', oldStr: null });
  assert.deepEqual(fileFrom({ tool: 'str_replace', path: 'a.py', content: 'x', oldStr: 'y' }),
    { path: 'a.py', content: 'x', tool: 'str_replace', oldStr: 'y' });
});

test('mergeCall updates a row in place instead of overwriting the one before it', () => {
  let rows = mergeCall([], 0, { tool: 'create_file', path: 'a.py' });
  rows = mergeCall(rows, 1, { tool: 'create_file', path: 'b.py' });
  assert.equal(rows.length, 2);
  rows = mergeCall(rows, 0, { tool: 'create_file', path: 'a.py', content: 'more' });
  assert.equal(rows.length, 2, 'still two rows');
  assert.equal(rows[0].call.content, 'more');
  assert.deepEqual(rows.map(r => r.index), [0, 1], 'kept in index order');
});

test('mergeCall keeps rows sorted even when indexes arrive out of order', () => {
  let rows = mergeCall([], 2, { tool: 'bash' });
  rows = mergeCall(rows, 0, { tool: 'bash' });
  rows = mergeCall(rows, 1, { tool: 'bash' });
  assert.deepEqual(rows.map(r => r.index), [0, 1, 2]);
});

test('mergeCall clears the whole step on a null call', () => {
  const rows = mergeCall([], 0, { tool: 'bash' });
  assert.deepEqual(mergeCall(rows, 0, null), []);
  assert.deepEqual(mergeCall(rows, undefined, { tool: 'bash' }), [], 'no index means no row');
});

test('supersededFile commits a finished create_file exactly once', () => {
  const prev = { tool: 'create_file', path: 'a.py', content: 'body' };
  // moved on to a different file
  assert.deepEqual(supersededFile(prev, { tool: 'create_file', path: 'b.py' }), { path: 'a.py', text: 'body' });
  // the step ended
  assert.deepEqual(supersededFile(prev, null), { path: 'a.py', text: 'body' });
  // still writing the same file
  assert.equal(supersededFile(prev, { tool: 'create_file', path: 'a.py', content: 'body+' }), null);
});

test('supersededFile ignores a str_replace, which is not a whole-file write', () => {
  assert.equal(supersededFile({ tool: 'str_replace', path: 'a.py', content: 'x' }, null), null);
  assert.equal(supersededFile(null, null), null);
});
