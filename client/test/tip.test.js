import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeTip, placeAtCursor, TIP_GAP, TIP_EDGE, TIP_CURSOR_X, TIP_CURSOR_Y, TIP_FLIP_GAP } from '../src/lib/tip.js';

const anchor = { top: 100, bottom: 130, left: 200, right: 240, width: 40, height: 30 };

test('placeTip: sits below the anchor and centres on it', () => {
  const p = placeTip({ anchor, width: 80, height: 20, vw: 1000, vh: 800 });
  assert.deepEqual(p, { top: 130 + TIP_GAP, left: 180 });
});

test('placeTip: flips above when there is no room below', () => {
  const low = { top: 780, bottom: 800, left: 200, right: 240, width: 40, height: 20 };
  const p = placeTip({ anchor: low, width: 80, height: 20, vw: 1000, vh: 810 });
  assert.equal(p.top, Math.max(TIP_EDGE, 780 - TIP_GAP - 20));
});

test('placeTip: clamps horizontally inside the viewport', () => {
  const edge = { top: 100, bottom: 120, left: 2, right: 12, width: 10, height: 20 };
  const p = placeTip({ anchor: edge, width: 200, height: 20, vw: 1000, vh: 800 });
  assert.equal(p.left, TIP_EDGE);
});

test('placeTip: right side sits beside the anchor, centred vertically', () => {
  const p = placeTip({ anchor, width: 80, height: 20, side: 'right', vw: 1000, vh: 800 });
  assert.deepEqual(p, { top: 115 - 10, left: 240 + TIP_GAP });
});

test('placeAtCursor: sits bottom-right of the pointer', () => {
  const p = placeAtCursor({ x: 100, y: 100, width: 80, height: 20, vw: 1000, vh: 800 });
  assert.deepEqual(p, { top: 100 + TIP_CURSOR_Y, left: 100 + TIP_CURSOR_X });
});

test('placeAtCursor: flips to the left of the pointer near the right edge', () => {
  const p = placeAtCursor({ x: 950, y: 100, width: 80, height: 20, vw: 1000, vh: 800 });
  assert.equal(p.left, 950 - TIP_FLIP_GAP - 80);
});

test('placeAtCursor: flips just above the pointer near the bottom edge', () => {
  const p = placeAtCursor({ x: 100, y: 790, width: 80, height: 20, vw: 1000, vh: 800 });
  assert.equal(p.top, 790 - TIP_FLIP_GAP - 20);
});