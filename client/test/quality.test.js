import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyRates, criterionRates } from '../src/lib/quality.js';

const DAY = 86400000;

test('every day in the period gets a bar, empty days included', () => {
  const now = 20 * DAY + 5000;
  const out = dailyRates([{ day: 18, verdict: 'fail', n: 2 }, { day: 18, verdict: 'pass', n: 3 }, { day: 20, verdict: 'na', n: 9 }, { day: 2, verdict: 'fail', n: 1 }], 0, 3, now);
  assert.deepEqual(out.map(d => d.day), [17, 18, 19, 20]);
  assert.deepEqual(out.find(d => d.day === 18), { day: 18, pass: 3, fail: 2 });
  assert.deepEqual(out.find(d => d.day === 20), { day: 20, pass: 0, fail: 0 }, 'not applicable is not a result');
});

test('rates follow the saved checks and ignore removed ones', () => {
  const rates = criterionRates([
    { criterion: 'a', verdict: 'fail', n: 4 }, { criterion: 'a', verdict: 'pass', n: 6 }, { criterion: 'a', verdict: 'na', n: 1 },
    { criterion: 'gone', verdict: 'fail', n: 9 }
  ], [{ id: 'a', name: 'Policy' }, { id: 'b', name: 'Grounding' }]);
  assert.deepEqual(rates, [{ id: 'a', name: 'Policy', pass: 6, fail: 4, na: 1 }, { id: 'b', name: 'Grounding', pass: 0, fail: 0, na: 0 }]);
});