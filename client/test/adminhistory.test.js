import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, changedKeys, pick, historyKey } from '../src/components/admin/state/history.js';

test('undo runs entries newest first', () => {
  const log = [];
  const h = createHistory();
  h.record({ undo: () => log.push('a') });
  h.record({ undo: () => log.push('b') });
  assert.equal(h.undo(), true);
  assert.equal(h.undo(), true);
  assert.equal(h.undo(), false, 'an empty history does nothing');
  assert.deepEqual(log, ['b', 'a']);
});

test('a burst of edits to the same field undoes as one step', () => {
  let clock = 0;
  const log = [];
  const h = createHistory({ now: () => clock });
  h.record({ key: 'name', undo: () => log.push('first') });
  clock = 400;
  h.record({ key: 'name', undo: () => log.push('second') });
  clock = 800;
  h.record({ key: 'name', undo: () => log.push('third') });
  assert.equal(h.size, 1);
  clock = 5000;
  h.record({ key: 'name', undo: () => log.push('later') });
  h.record({ key: 'other', undo: () => log.push('other') });
  assert.equal(h.size, 3, 'a pause or another field starts a new step');
  while (h.undo());
  assert.deepEqual(log, ['other', 'later', 'first'], 'the merged step restores the value from before the burst');
});

test('unkeyed entries never merge and the stack is bounded', () => {
  const h = createHistory({ limit: 3 });
  for (let i = 0; i < 5; i++) h.record({ undo: () => {} });
  assert.equal(h.size, 3);
  h.clear();
  assert.equal(h.size, 0);
});

test('changedKeys and pick describe what an edit touched', () => {
  assert.deepEqual(changedKeys({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }), ['b', 'c']);
  assert.deepEqual(pick({ a: 1 }, ['a', 'b']), { a: 1, b: undefined });
});

test('redo replays undone steps until a new edit branches off', () => {
  let value = 0;
  const h = createHistory();
  const set = (v) => { const was = value; value = v; h.record({ undo: () => { value = was; }, redo: () => { value = v; } }); };
  set(1);
  set(2);
  h.undo();
  h.undo();
  assert.equal(value, 0);
  assert.equal(h.redo(), true);
  assert.equal(value, 1);
  assert.equal(h.redoSize, 1);
  set(5);
  assert.equal(h.redoSize, 0, 'a new edit drops the redo branch');
  assert.equal(h.redo(), false);
  h.undo();
  assert.equal(value, 1);
});

test('a merged burst redoes to its last value', () => {
  let clock = 0;
  let value = 'a';
  const h = createHistory({ now: () => clock });
  const set = (v) => { const was = value; value = v; h.record({ key: 'f', undo: () => { value = was; }, redo: () => { value = v; } }); };
  set('ab');
  clock = 300;
  set('abc');
  h.undo();
  assert.equal(value, 'a');
  h.redo();
  assert.equal(value, 'abc');
});

test('undoing a step that cannot be redone clears the redo branch', () => {
  const h = createHistory();
  h.record({ undo: () => {} });
  h.record({ undo: () => {}, redo: () => {} });
  h.undo();
  assert.equal(h.redoSize, 1);
  h.undo();
  assert.equal(h.redoSize, 0);
});

test('the shortcuts follow the platform modifier', () => {
  const key = (o) => ({ key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
  assert.equal(historyKey(key({ metaKey: true }), true), 'undo');
  assert.equal(historyKey(key({ ctrlKey: true }), true), null);
  assert.equal(historyKey(key({ ctrlKey: true }), false), 'undo');
  assert.equal(historyKey(key({ metaKey: true }), false), null);
  assert.equal(historyKey(key({ metaKey: true, shiftKey: true, key: 'Z' }), true), 'redo');
  assert.equal(historyKey(key({ ctrlKey: true, shiftKey: true, key: 'Z' }), false), 'redo');
  assert.equal(historyKey(key({ ctrlKey: true, key: 'y' }), false), 'redo');
  assert.equal(historyKey(key({ metaKey: true, key: 'y' }), true), null, 'Cmd+Y is not redo on a Mac');
  assert.equal(historyKey(key({ ctrlKey: true, altKey: true }), false), null);
});