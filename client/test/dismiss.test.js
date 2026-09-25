import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInside, anyMounted, asRefList, pushLayer, handleLayerKey, hasOpenLayer, isModalOpen } from '../src/lib/dismiss.js';

const elWith = (kids = [], match = null) => {
  const el = {
    kids,
    contains: (t) => el === t || kids.includes(t),
    closest: (sel) => (match === sel ? el : null)
  };
  return el;
};

test('isInside: a target inside any of the refs counts as inside', () => {
  const child = elWith();
  const a = elWith([child]);
  const b = elWith();
  assert.equal(isInside(child, [{ current: a }, { current: b }], ''), true);
  assert.equal(isInside(child, [{ current: b }], ''), false);
});

test('isInside: the element itself is inside, not only its children', () => {
  const a = elWith();
  assert.equal(isInside(a, [{ current: a }], ''), true);
});

test('isInside: unattached refs and a null target are simply not inside', () => {
  assert.equal(isInside(null, [{ current: null }], ''), false);
  assert.equal(isInside(elWith(), [{ current: null }, null, undefined], ''), false);
});

test('isInside: the selector escape hatch covers a panel portalled out of the ref tree', () => {
  const portalled = elWith([], '.model-submenu');
  assert.equal(isInside(portalled, [{ current: elWith() }], ''), false);
  assert.equal(isInside(portalled, [{ current: elWith() }], '.model-submenu'), true);
});

test('anyMounted gates the handler until a ref has attached', () => {
  // Without this the first mousedown after opening a menu closes it again,
  // because nothing is mounted yet to compare the click against.
  assert.equal(anyMounted([{ current: null }]), false);
  assert.equal(anyMounted([{ current: null }, { current: elWith() }]), true);
  assert.equal(anyMounted([]), false);
});

test('asRefList accepts a single ref or a list', () => {
  const r = { current: null };
  assert.deepEqual(asRefList(r), [r]);
  assert.deepEqual(asRefList([r]), [r]);
});

function escape(extra = {}) {
  return { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
}

function layer(log, name, modal = false) {
  return pushLayer({ current: () => log.push(name) }, modal);
}

test('Escape closes only the most recently opened layer', () => {
  const log = [];
  const popDialog = layer(log, 'dialog', true);
  const popMenu = layer(log, 'menu');
  assert.equal(handleLayerKey(escape()), true);
  assert.deepEqual(log, ['menu']);
  popMenu();
  handleLayerKey(escape());
  assert.deepEqual(log, ['menu', 'dialog']);
  popDialog();
  assert.equal(hasOpenLayer(), false);
});

test('an Escape a field already claimed reaches no layer', () => {
  const log = [];
  const pop = layer(log, 'dialog', true);
  assert.equal(handleLayerKey(escape({ defaultPrevented: true })), false);
  assert.deepEqual(log, []);
  pop();
});

test('a layer consumes the key so nothing behind it acts on it too', () => {
  const pop = layer([], 'menu');
  const e = escape();
  handleLayerKey(e);
  assert.equal(e.defaultPrevented, true);
  pop();
});

test('other keys pass through untouched', () => {
  const log = [];
  const pop = layer(log, 'dialog', true);
  const e = { key: 'Enter', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  assert.equal(handleLayerKey(e), false);
  assert.equal(e.defaultPrevented, false);
  assert.deepEqual(log, []);
  pop();
});

test('only modal layers pause background shortcuts', () => {
  const popMenu = layer([], 'menu');
  assert.equal(hasOpenLayer(), true);
  assert.equal(isModalOpen(), false);
  const popDialog = layer([], 'dialog', true);
  assert.equal(isModalOpen(), true);
  popDialog();
  popMenu();
  assert.equal(isModalOpen(), false);
});

test('removing a layer out of order leaves the others stacked', () => {
  const log = [];
  const popA = layer(log, 'a');
  const popB = layer(log, 'b');
  const popC = layer(log, 'c');
  popB();
  handleLayerKey(escape());
  assert.deepEqual(log, ['c']);
  popC();
  handleLayerKey(escape());
  assert.deepEqual(log, ['c', 'a']);
  popA();
  popA();
  assert.equal(hasOpenLayer(), false);
});
