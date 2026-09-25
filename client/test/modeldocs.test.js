import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  docsConfig,
  docsTree,
  docsSearch,
  parseDocsPath,
  docsPath,
  fmtTokens,
  fmtPrice,
  priceRange,
  bulletLines,
  publicModelId,
  docsModels
} from '../src/lib/modeldocs.js';

const DOCS_MODELS = [
  { id: 'a', displayName: 'Sonata', description: 'Everyday', docsIds: [{ label: 'Chat', value: 'sonata-1' }] },
  { id: 'b', displayName: 'Aria', description: 'Quick', docsGroup: 'Legacy models', docsIds: [] },
  { id: 'c', displayName: 'Cadence', description: 'Old', docsGroup: 'Legacy models', docsIds: [] },
  { id: 'd', displayName: 'Router', kind: 'router', docsIds: [] },
  { id: 'e', displayName: 'Hidden', docsHidden: true, docsIds: [] }
];

test('docsModels drops routers, hidden entries and removed rows', () => {
  assert.deepEqual(docsModels(DOCS_MODELS).map(m => m.id), ['a', 'b', 'c']);
  assert.deepEqual(docsModels(null), []);
});

test('docsTree keeps ungrouped models at the top and folds the rest by label', () => {
  const tree = docsTree(DOCS_MODELS, docsConfig(null));
  assert.deepEqual(tree.models.top.map(m => m.id), ['a']);
  assert.equal(tree.models.groups.length, 1);
  assert.equal(tree.models.groups[0].label, 'Legacy models');
  assert.deepEqual(tree.models.groups[0].models.map(m => m.id), ['b', 'c']);
});

test('docsTree hides a custom section that has no pages', () => {
  const cfg = docsConfig({ sections: [{ id: 'g', label: 'Guides', pages: [] }, { id: 'h', label: 'Help', pages: [{ id: 'p', title: 'P' }] }] });
  assert.deepEqual(docsTree(DOCS_MODELS, cfg).sections.map(s => s.id), ['h']);
});

test('docsSearch matches a group by its own label, and returns null for an empty query', () => {
  const tree = docsTree(DOCS_MODELS, docsConfig(null));
  assert.equal(docsSearch(tree, '  '), null);
  const hit = docsSearch(tree, 'legacy');
  assert.deepEqual(hit.models.top, []);
  assert.deepEqual(hit.models.groups[0].models.map(m => m.id), ['b', 'c']);
});

test('a docs path round-trips through parseDocsPath', () => {
  for (const target of [{ kind: 'overview', id: null }, { kind: 'model', id: 'a b/c' }, { kind: 'page', id: 'pricing' }]) {
    const parsed = parseDocsPath(docsPath(target));
    assert.equal(parsed.kind, target.kind);
    assert.equal(parsed.id, target.id);
  }
});

test('parseDocsPath falls back to the overview for anything else', () => {
  assert.equal(parseDocsPath('/docs').kind, 'overview');
  assert.equal(parseDocsPath('/chat/x').kind, 'overview');
  assert.equal(parseDocsPath('/docs/m/%E0%A4%A').id, '%E0%A4%A');
});

test('fmtTokens shortens to K and M and drops a trailing zero', () => {
  assert.equal(fmtTokens(1000000), '1M');
  assert.equal(fmtTokens(1500000), '1.5M');
  assert.equal(fmtTokens(128000), '128K');
  assert.equal(fmtTokens(512), '512');
  assert.equal(fmtTokens(0), '');
  assert.equal(fmtTokens(null), '');
});

test('fmtPrice keeps integers bare and trims float noise', () => {
  assert.equal(fmtPrice(2), '$2');
  assert.equal(fmtPrice(0.2), '$0.2');
  assert.equal(fmtPrice(2.5), '$2.5');
  assert.equal(fmtPrice(null), '');
  assert.equal(fmtPrice(''), '');
});

test('priceRange keeps whichever half is set', () => {
  assert.equal(priceRange({ priceIn: 2, priceOut: 10 }), '$2 / $10');
  assert.equal(priceRange({ priceIn: 2, priceOut: null }), '$2');
  assert.equal(priceRange({ priceIn: null, priceOut: null }), '');
});

test('bulletLines strips list markers and blank lines', () => {
  assert.deepEqual(bulletLines('- one\n\n* two\n  three  '), ['one', 'two', 'three']);
  assert.deepEqual(bulletLines(''), []);
});

test('publicModelId uses the first identifier an admin entered, never the catalog row id', () => {
  assert.equal(publicModelId(DOCS_MODELS[0]), 'sonata-1');
  assert.equal(publicModelId(DOCS_MODELS[1]), '');
});
