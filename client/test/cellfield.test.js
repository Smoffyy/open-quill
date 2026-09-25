import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellRand,
  cellRamp,
  cellAlpha,
  headColumn,
  fadeTrail,
  stampTrail,
  parseRgb,
  hotMix,
  CELL,
  CELL_GAP,
  TRAIL_DECAY,
  HEAD_WHITE
} from '../src/lib/cellfield.js';

test('a sweep lights every column it crossed, not just the two ends', () => {
  const heat = new Float32Array(10);
  stampTrail(heat, 2, 6);
  for (let c = 2; c <= 6; c++) assert.equal(heat[c], 1, 'column ' + c);
  assert.equal(heat[1], 0);
  assert.equal(heat[7], 0);
  stampTrail(heat, 8, 4);
  assert.equal(heat[8], 1);
});

test('a sweep past either edge clamps instead of writing out of bounds', () => {
  const heat = new Float32Array(4);
  stampTrail(heat, -9, 1);
  assert.equal(heat[0], 1);
  stampTrail(heat, 2, 99);
  assert.equal(heat[3], 1);
  assert.equal(heat.length, 4);
});

test('older columns are dimmer than newer ones, which is what makes it a tail', () => {
  const heat = new Float32Array(6);
  stampTrail(heat, 0, 0);
  fadeTrail(heat);
  stampTrail(heat, 1, 1);
  fadeTrail(heat);
  stampTrail(heat, 2, 2);
  assert.ok(heat[2] > heat[1] && heat[1] > heat[0]);
  assert.ok(heat[0] > 0);
});

test('the trail fades out rather than lingering forever', () => {
  const heat = new Float32Array(2);
  stampTrail(heat, 0, 1);
  for (let i = 0; i < 80; i++) fadeTrail(heat);
  assert.ok(heat[0] < 0.001);
  assert.ok(TRAIL_DECAY > 0 && TRAIL_DECAY < 1);
});

test('the head sits at the last filled column, and off the strip when empty', () => {
  assert.equal(headColumn(1, 200), 49);
  assert.equal(headColumn(0, 200), -1);
  assert.ok(headColumn(0.5, 200) < headColumn(1, 200));
});

test('a colour reads the same whether the theme hands over channels or an rgb string', () => {
  assert.deepEqual(parseRgb('rgb(198, 97, 63)'), [198, 97, 63]);
  assert.deepEqual(parseRgb(' 255, 255, 255 '), [255, 255, 255]);
  assert.deepEqual(parseRgb('rgba(1, 2, 3, .5)'), [1, 2, 3]);
  assert.deepEqual(parseRgb('nonsense', [9, 9, 9]), [9, 9, 9]);
  assert.deepEqual(parseRgb('', [9, 9, 9]), [9, 9, 9]);
});

test('the comet head whitens while the cold tail keeps the accent', () => {
  const base = [198, 97, 63];
  const white = [255, 255, 255];
  assert.equal(hotMix(base, white, 0), 'rgb(198,97,63)');
  const warm = parseRgb(hotMix(base, white, 0.5));
  const head = parseRgb(hotMix(base, white, 1));
  assert.ok(head[1] > warm[1] && warm[1] > base[1]);
  assert.equal(head[1], Math.round(97 + (255 - 97) * HEAD_WHITE));
});

test('whitening is biased to the very front, so the tail does not wash out', () => {
  const base = [0, 0, 0];
  const white = [255, 255, 255];
  const half = parseRgb(hotMix(base, white, 0.5))[0];
  assert.ok(half < 255 * HEAD_WHITE * 0.5);
});

test('a light theme can pull the head the other way, towards its own ink', () => {
  const base = [201, 102, 63];
  const ink = [74, 26, 8];
  const head = parseRgb(hotMix(base, ink, 1));
  assert.ok(head[0] < base[0]);
});

test('a hot cell outshines a cold one at the same column and phase', () => {
  const cold = cellAlpha(10, 50, 0.3, 1, 0);
  const hot = cellAlpha(10, 50, 0.3, 1, 1);
  assert.ok(hot > cold);
  assert.ok(hot <= 1);
});

test('every cell gets a stable value of its own, so the field does not pulse as one', () => {
  const a = cellRand(3, 1);
  assert.equal(cellRand(3, 1), a);
  assert.notEqual(cellRand(4, 1), a);
  assert.notEqual(cellRand(3, 2), a);
  for (const [c, r] of [[0, 0], [7, 2], [49, 4], [123, 9]]) {
    const v = cellRand(c, r);
    assert.ok(v >= 0 && v < 1, `cellRand(${c},${r}) = ${v}`);
  }
});

test('the field ramps up towards the smart end and never goes dark at the bright one', () => {
  assert.equal(cellRamp(0, 50), 0);
  assert.equal(cellRamp(49, 50), 1);
  assert.ok(cellRamp(25, 50) < 0.5);
  assert.equal(cellRamp(0, 1), 1);
});

test('cell alpha stays inside 0..1 whatever the phase', () => {
  for (let p = 0; p < 12; p++) {
    for (const col of [0, 10, 49]) {
      const a = cellAlpha(col, 50, cellRand(col, 2), p / 2);
      assert.ok(a >= 0 && a <= 1, `alpha ${a} out of range`);
    }
  }
});

test('the cells leave a gap, so the grid reads as pixels and not a solid bar', () => {
  assert.ok(CELL_GAP > 0 && CELL_GAP < CELL);
});
