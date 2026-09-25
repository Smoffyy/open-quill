import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasToolCall, previewOf, buildTree, collapseRuns } from '../src/lib/threadmeta.js';

test('hasToolCall detects the stored tool marker', () => {
  assert.equal(hasToolCall('[[OQR:eyJhIjoxfQ==]]'), true);
  assert.equal(hasToolCall('just prose'), false);
  assert.equal(hasToolCall(''), false);
});

test('previewOf strips markdown, code fences and tool markers', () => {
  assert.equal(previewOf('# Title with **bold**'), 'Title with bold');
  assert.equal(previewOf('before ```js\ncode\n``` after'), 'before after');
  assert.equal(previewOf('see [the docs](https://x.example)'), 'see the docs');
  assert.equal(previewOf(''), '');
});

test('previewOf truncates to the requested length', () => {
  const out = previewOf('word '.repeat(80), 20);
  assert.ok(out.length <= 20, out.length);
  assert.ok(out.endsWith('…'));
});

test('buildTree returns roots and nests children in list order', () => {
  assert.deepEqual(buildTree([]), []);
  const roots = buildTree([
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'a' }
  ]);
  assert.equal(roots.length, 1);
  assert.deepEqual(roots[0].children.map(n => n.id), ['b', 'c']);
});

test('buildTree treats an orphaned parent id as a root rather than dropping the node', () => {
  const roots = buildTree([{ id: 'x', parentId: 'ghost' }]);
  assert.deepEqual(roots.map(n => n.id), ['x']);
});

test('collapseRuns folds a linear chain into one run and stops at a fork', () => {
  const linear = buildTree([
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b' }
  ]);
  const flat = collapseRuns(linear[0]);
  assert.deepEqual(flat.run.map(n => n.id), ['a', 'b', 'c']);
  assert.deepEqual(flat.forks, []);

  const forked = buildTree([
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'a' }
  ]);
  const split = collapseRuns(forked[0]);
  assert.deepEqual(split.run.map(n => n.id), ['a']);
  assert.deepEqual(split.forks.map(n => n.id), ['b', 'c']);
});
