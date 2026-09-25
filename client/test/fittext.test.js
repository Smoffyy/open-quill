import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextFitSize, FIT_MIN, FIT_PASSES } from '../src/lib/fittext.js';

test('nextFitSize returns null when the text already fits', () => {
  assert.equal(nextFitSize(20, 200, 120, 12), null);
  assert.equal(nextFitSize(20, 200, 200, 12), null);
});

test('nextFitSize shrinks by the overflow ratio', () => {
  assert.equal(nextFitSize(20, 180, 200, 12), 18);
  assert.equal(nextFitSize(20, 150, 200, 12), 15);
});

test('nextFitSize stops at the floor', () => {
  assert.equal(nextFitSize(20, 10, 1000, 12), 12);
  assert.equal(nextFitSize(12, 10, 1000, 12), null);
});

test('nextFitSize converges within FIT_PASSES when glyph rounding overshoots', () => {
  // real text does not scale perfectly linearly; model a 2px rounding overshoot
  const ideal = 200, avail = 182, base = 20;
  const widthAt = (size) => ideal * (size / base) + 2;
  let size = base, natural = ideal;
  for (let i = 0; i < FIT_PASSES; i++) {
    const next = nextFitSize(size, avail, natural, base * FIT_MIN);
    if (!next) break;
    size = next;
    natural = widthAt(size);
  }
  assert.ok(natural <= avail, 'expected fit, got ' + natural + ' in ' + avail);
  assert.ok(size > base * FIT_MIN, 'should not have needed the floor');
});

test('nextFitSize is safe on unmeasured elements', () => {
  assert.equal(nextFitSize(0, 100, 200, 10), null);
  assert.equal(nextFitSize(20, 0, 200, 10), null);
  assert.equal(nextFitSize(20, 100, NaN, 10), null);
});

test('nextFitSize treats a missing floor as no floor', () => {
  assert.equal(nextFitSize(20, 50, 200, 0), 5);
});
