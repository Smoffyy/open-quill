import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caretsAtEnd, insert, erase, move, selectAll, place, parts } from '../src/lib/multicaret.js';

const texts = (c) => Object.fromEntries(Object.entries(c).map(([id, v]) => [id, v.text]));

test('carets start at the end of every name and typing appends to all', () => {
  const c = insert(caretsAtEnd({ a: 'Opera', b: 'Aria 3.5' }), ' Pro');
  assert.deepEqual(texts(c), { a: 'Opera Pro', b: 'Aria 3.5 Pro' });
  assert.equal(c.a.focus, 9);
});

test('arrows move every caret, and typing lands at each one', () => {
  let c = caretsAtEnd({ a: 'ab', b: 'xyz' });
  c = move(c, 'Home');
  c = insert(c, '[');
  assert.deepEqual(texts(c), { a: '[ab', b: '[xyz' });
  c = move(c, 'ArrowRight');
  c = insert(c, '-');
  assert.deepEqual(texts(c), { a: '[a-b', b: '[x-yz' });
  c = move(move(c, 'ArrowLeft'), 'ArrowLeft');
  assert.equal(c.a.focus, 1);
});

test('carets clamp at the edges of shorter names', () => {
  let c = caretsAtEnd({ a: 'a', b: 'abcd' });
  c = move(move(c, 'ArrowLeft'), 'ArrowLeft');
  assert.equal(c.a.focus, 0);
  assert.equal(c.b.focus, 2);
});

test('backspace and delete remove one character or a whole word', () => {
  let c = caretsAtEnd({ a: 'Model one', b: 'Model two' });
  c = erase(c, -1);
  assert.deepEqual(texts(c), { a: 'Model on', b: 'Model tw' });
  c = erase(c, -1, true);
  assert.deepEqual(texts(c), { a: 'Model ', b: 'Model ' });
  c = erase(move(c, 'Home'), 1, true);
  assert.deepEqual(texts(c), { a: ' ', b: ' ' });
  c = erase(c, -1);
  assert.deepEqual(texts(c), { a: ' ', b: ' ' }, 'nothing before the caret');
});

test('select all then type replaces every name', () => {
  const c = insert(selectAll(caretsAtEnd({ a: 'one', b: 'two' })), 'x');
  assert.deepEqual(texts(c), { a: 'x', b: 'x' });
});

test('shift extends a selection and a plain arrow collapses it', () => {
  let c = move(caretsAtEnd({ a: 'hello' }), 'ArrowLeft', { shift: true });
  c = move(c, 'ArrowLeft', { shift: true });
  assert.deepEqual(parts(c.a), { before: 'hel', sel: 'lo', after: '', caretAtStart: true });
  c = move(c, 'ArrowRight');
  assert.equal(c.a.anchor, 5);
  assert.equal(c.a.focus, 5);
  c = move(c, 'ArrowLeft', { word: true });
  assert.equal(c.a.focus, 0);
});

test('placing one caret leaves the others where they are', () => {
  let c = place(caretsAtEnd({ a: 'abc', b: 'xyz' }), 'a', 1);
  c = insert(c, '_');
  assert.deepEqual(texts(c), { a: 'a_bc', b: 'xyz_' });
  assert.equal(place(c, 'missing', 0), c);
  assert.equal(place(c, 'b', 99).b.focus, 4);
});
