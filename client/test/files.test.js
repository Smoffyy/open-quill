import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirOf, baseName as fileBaseName } from '../src/lib/files.js';

// The tool line splits a path into a dim folder and a readable name; getting the
// split wrong is what made two different __init__.py steps render identically.
test('dirOf splits a path and copes with the shapes the sandbox produces', () => {
  assert.equal(dirOf('src/utils/__init__.py'), 'src/utils');
  assert.equal(dirOf('README.md'), '');
  assert.equal(dirOf('src\\utils\\a.py'), 'src/utils');
  assert.equal(dirOf(null), '');
  assert.equal(fileBaseName('src/utils/__init__.py'), '__init__.py');
});
