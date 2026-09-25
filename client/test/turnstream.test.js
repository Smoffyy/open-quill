import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealChunk, revealPeriod, hasMarker } from '../src/lib/turnstream.js';

test('revealChunk catches up fast on a big backlog and eases into a readable pace', () => {
  assert.equal(revealChunk(3000, false), 1000, 'a third while far behind');
  assert.equal(revealChunk(600, false), 100, 'a sixth in the middle band');
  assert.equal(revealChunk(90, false), 10, 'a ninth once close');
});

test('revealChunk always advances, so the reveal cannot stall short of the text', () => {
  for (const remaining of [1, 2, 3, 5, 17, 240, 241, 1200, 1201]) {
    const n = revealChunk(remaining, false);
    assert.ok(n >= 1, `remaining=${remaining} advanced by ${n}`);
    assert.ok(n <= remaining, `remaining=${remaining} did not overshoot`);
  }
});

test('revealChunk with animation off shows everything at once', () => {
  assert.equal(revealChunk(5000, true), 5000);
  assert.equal(revealChunk(1, true), 1);
});

test('revealChunk converges: repeated application always reaches the end', () => {
  let shown = 0;
  const total = 5000;
  let ticks = 0;
  while (shown < total && ticks < 1000) { shown += revealChunk(total - shown, false); ticks++; }
  assert.equal(shown, total);
  assert.ok(ticks < 100, `converged in ${ticks} ticks`);
});

test('revealPeriod stays inside the band where it reads as typing', () => {
  assert.equal(revealPeriod(0), 8, 'never a zero-delay interval');
  assert.equal(revealPeriod(-5), 8);
  assert.equal(revealPeriod(40), 40);
  assert.equal(revealPeriod(5000), 100);
  assert.equal(revealPeriod(undefined), 8);
});

test('hasMarker spots the transcript markers that must not be drawn a character at a time', () => {
  assert.equal(hasMarker('text [[OQR:abc]] more'), true);
  assert.equal(hasMarker('\n\n[[OQT:0]]\n'), true);
  assert.equal(hasMarker('ordinary prose'), false);
  assert.equal(hasMarker(''), false);
});
