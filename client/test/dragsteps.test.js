import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPx,
  knobAt,
  knobRaw,
  knobTravel,
  overshoot,
  stretchFor,
  squashFor,
  stretchOrigin,
  nearestIndex,
  slideFor,
  DRAG_SLOP,
  STRETCH_PX,
  SLIDE_BASE,
  SLIDE_SPAN
} from '../src/lib/dragsteps.js';

test('the switch knob centres on the pointer and stops at both ends', () => {
  const r = { left: 100, width: 36 };
  assert.equal(knobAt(110, r, 2, 16), 0);
  assert.equal(knobAt(100, r, 2, 16), 0);
  assert.equal(knobAt(0, r, 2, 16), 0);
  assert.equal(knobAt(136, r, 2, 16), 16);
  assert.equal(knobAt(999, r, 2, 16), 16);
  assert.equal(knobAt(118, r, 2, 16), 8);
});

test('a switch too narrow for its knob still reports a position', () => {
  assert.equal(knobAt(50, { left: 0, width: 12 }, 2, 16), 0);
  assert.equal(clampPx(5, 10, 10), 10);
  assert.equal(clampPx(5, 10, 2), 10);
});

test('a segmented control picks the nearest segment centre, uneven widths included', () => {
  const stops = [{ x: 1, w: 60 }, { x: 61, w: 90 }];
  assert.equal(nearestIndex(stops, 0), 0);
  assert.equal(nearestIndex(stops, 31), 0);
  assert.equal(nearestIndex(stops, 106), 1);
  assert.equal(nearestIndex(stops, 999), 1);
  assert.equal(nearestIndex([], 5), 0);
  assert.equal(nearestIndex(null, 5), 0);
});

test('a longer jump takes longer, but never so long that a nudge feels sluggish', () => {
  assert.equal(slideFor(0), SLIDE_BASE);
  assert.equal(slideFor(1), SLIDE_BASE + SLIDE_SPAN);
  assert.equal(slideFor(-1), SLIDE_BASE + SLIDE_SPAN);
  const oneStep = slideFor(0.2);
  const across = slideFor(1);
  assert.ok(oneStep > SLIDE_BASE && oneStep < across);
  assert.ok(across / oneStep < 2, 'the far jump should not feel twice as slow as a nudge');
});

test('slide time is clamped for distances outside the track', () => {
  assert.equal(slideFor(5), SLIDE_BASE + SLIDE_SPAN);
  assert.equal(slideFor(NaN), SLIDE_BASE);
});

test('overshoot is zero inside the track and signed outside it', () => {
  assert.equal(overshoot(8, 0, 16), 0);
  assert.equal(overshoot(0, 0, 16), 0);
  assert.equal(overshoot(16, 0, 16), 0);
  assert.equal(overshoot(-9, 0, 16), -9);
  assert.equal(overshoot(20, 0, 16), 4);
});

test('the stretch saturates instead of growing without bound', () => {
  assert.equal(stretchFor(0, 16), 1);
  const near = stretchFor(10, 16);
  const far = stretchFor(400, 16);
  assert.ok(near > 1 && near < far);
  assert.ok(far <= 1 + STRETCH_PX / 16 + 1e-9);
  assert.equal(stretchFor(-10, 16), near);
});

test('the stretch is a constant pixel pull, so wide thumbs do not balloon', () => {
  const knob = stretchFor(400, 16) - 1;
  const wide = stretchFor(400, 80) - 1;
  assert.ok(Math.abs(knob * 16 - wide * 80) < 1e-9);
});

test('a stretched thumb thins out, and an unstretched one is left alone', () => {
  assert.equal(squashFor(1), 1);
  assert.equal(squashFor(0.5), 1);
  const sq = squashFor(1.3);
  assert.ok(sq < 1 && sq > 0.8);
});

test('the pinned edge is the one being pulled away from', () => {
  assert.equal(stretchOrigin(5), 'right center');
  assert.equal(stretchOrigin(-5), 'left center');
});

test('knobRaw keeps the overshoot that knobAt clamps away', () => {
  const r = { left: 0, width: 36 };
  assert.equal(knobTravel(r, 2, 16), 16);
  assert.equal(knobRaw(60, r, 2, 16), 50);
  assert.equal(knobAt(60, r, 2, 16), 16);
  assert.equal(knobRaw(-20, r, 2, 16), -30);
  assert.equal(knobAt(-20, r, 2, 16), 0);
});

test('the drag slop stays small enough that a tap is never read as a drag', () => {
  assert.ok(DRAG_SLOP > 0 && DRAG_SLOP <= 4);
});
