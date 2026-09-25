import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderOf, groupRows, planMove } from '../src/lib/modelfolders.js';

const inFolder = (id, name) => ({ id, in_more_models: 1, more_models_label: name });

const loose = (id) => ({ id, in_more_models: 0, more_models_label: 'More models' });

test('folderOf only reports a folder when the row is actually in one', () => {
  assert.equal(folderOf(inFolder('a', 'Fast')), 'Fast');
  assert.equal(folderOf(loose('b')), null);
  // A label without the flag is stale data, not membership.
  assert.equal(folderOf({ id: 'c', in_more_models: 0, more_models_label: 'Fast' }), null);
  // A blank or whitespace label cannot name a folder.
  assert.equal(folderOf({ id: 'd', in_more_models: 1, more_models_label: '  ' }), null);
  assert.equal(folderOf(undefined), null);
});

test('groupRows draws one header per folder even when members are separated', () => {
  const rows = [inFolder('a', 'Fast'), loose('b'), inFolder('c', 'Fast')];
  const out = groupRows(rows);
  assert.deepEqual(out.map(e => e.kind), ['folder', 'model']);
  assert.equal(out[0].name, 'Fast');
  assert.deepEqual(out[0].models.map(m => m.id), ['a', 'c']);
});

test('groupRows keeps a folder at the position of its first member', () => {
  const rows = [loose('a'), inFolder('b', 'Slow'), loose('c')];
  const out = groupRows(rows);
  assert.deepEqual(out.map(e => e.key), ['a', 'f:Slow', 'c']);
});

test('groupRows appends folders that hold nothing yet, and never twice', () => {
  const out = groupRows([inFolder('a', 'Fast')], ['New', 'Fast']);
  assert.deepEqual(out.map(e => e.name), ['Fast', 'New']);
  assert.deepEqual(out[1].models, []);
});

test('planMove drops a row before or after the row it was dropped on', () => {
  const models = [loose('a'), loose('b'), loose('c')];
  assert.deepEqual(planMove(models, ['c'], { targetId: 'a' }).order.map(m => m.id), ['c', 'a', 'b']);
  assert.deepEqual(planMove(models, ['c'], { targetId: 'a', after: true }).order.map(m => m.id), ['a', 'c', 'b']);
});

test('planMove onto a folder header lands after that folder last member', () => {
  const models = [inFolder('a', 'Fast'), inFolder('b', 'Fast'), loose('c')];
  const plan = planMove(models, ['c'], { folder: 'Fast' });
  assert.deepEqual(plan.order.map(m => m.id), ['a', 'b', 'c']);
  assert.deepEqual(plan.patch, { in_more_models: 1, more_models_label: 'Fast' });
  assert.equal(plan.needsPatch, true);
});

test('planMove taking a row out of a folder clears membership', () => {
  const models = [inFolder('a', 'Fast'), loose('b')];
  const plan = planMove(models, ['a'], { folder: null });
  assert.deepEqual(plan.patch, { in_more_models: 0 });
  assert.equal(plan.needsPatch, true);
});

test('planMove reorders within a folder without rewriting the label', () => {
  const models = [inFolder('a', 'Fast'), inFolder('b', 'Fast')];
  const plan = planMove(models, ['b'], { folder: 'Fast', targetId: 'a' });
  assert.deepEqual(plan.order.map(m => m.id), ['b', 'a']);
  assert.equal(plan.needsPatch, false);
});

test('planMove keeps a multi-row selection together and in order', () => {
  const models = [loose('a'), loose('b'), loose('c'), loose('d')];
  const plan = planMove(models, ['a', 'c'], { targetId: 'd', after: true });
  assert.deepEqual(plan.order.map(m => m.id), ['b', 'd', 'a', 'c']);
});
