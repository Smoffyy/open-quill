import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollInsideMenu } from '../src/lib/anchor.js';

test('a scroll inside an anchored menu does not count as a scroll away from it', () => {
  const item = { tag: 'item' };
  const menu = { contains: (n) => n === item };
  assert.equal(scrollInsideMenu(menu, item), true, 'a scroll on a menu row stays open');
  assert.equal(scrollInsideMenu(menu, menu), true, 'the menu scrolling itself stays open');
  assert.equal(scrollInsideMenu(menu, { tag: 'thread' }), false, 'an outside scroll still closes');
  assert.equal(scrollInsideMenu(null, item), false, 'no menu yet, nothing to protect');
  assert.equal(scrollInsideMenu(menu, null), false);
  assert.equal(scrollInsideMenu({ contains: () => false }, { self: true }), false);
});
