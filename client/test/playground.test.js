import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runStats as pgRunStats,
  fmtDuration as pgFmtDuration,
  activePreset as pgActivePreset,
  applyPreset as pgApplyPreset,
  pickedText as pgPickedText,
  historyFor as pgHistoryFor,
  isUnset as pgIsUnset,
  clampField as pgClampField,
  groupModels as pgGroupModels,
  SAMPLING_PRESETS as PG_PRESETS
} from '../src/lib/playground.js';

test('throughput is measured over generation, not over the wait before it', () => {
  // A model that thinks for 20s and then writes 80 tokens in 2s writes at 40/s.
  // Dividing by the whole run would call that 3.6/s and hide the real problem.
  const s = pgRunStats({ startedAt: 0, firstAt: 20000, endedAt: 22000, usage: { completion: 80, prompt: 300 } });
  assert.equal(s.ttft, 20000);
  assert.equal(s.total, 22000);
  assert.equal(Math.round(s.tps), 40);
  assert.equal(s.out, 80);
  assert.equal(s.prompt, 300);
});

test('a run with no tokens yet reports no rate rather than zero', () => {
  const s = pgRunStats({ startedAt: 0, endedAt: 5000 });
  assert.equal(s.ttft, null);
  assert.equal(s.tps, null);
  assert.equal(s.out, null);
  assert.equal(s.total, 5000);
});

test('durations read at the scale a human is judging', () => {
  assert.equal(pgFmtDuration(374), '374ms');
  assert.equal(pgFmtDuration(1240), '1.24s');
  assert.equal(pgFmtDuration(64000), '1m 04s');
  assert.equal(pgFmtDuration(NaN), '—');
});

test('a sampling preset is only active when nothing else is set', () => {
  assert.equal(pgActivePreset({ temperature: 0.7, top_p: 1 }), 'balanced');
  assert.equal(pgActivePreset({ temperature: 0.1, top_p: 0.9 }), 'precise');
  assert.equal(pgActivePreset({ temperature: 0.7, top_p: 1, top_k: 40 }), null, 'a stray sampler is not silently ignored');
  assert.equal(pgActivePreset({}), null);
});

test('applying a preset clears the samplers it does not name', () => {
  const next = pgApplyPreset({ temperature: 2, top_k: 40, min_p: 0.1, max_tokens: 512 }, PG_PRESETS[0]);
  assert.equal(next.temperature, 0.1);
  assert.equal(next.top_k, '');
  assert.equal(next.min_p, '');
  assert.equal(next.max_tokens, 512, 'limits are not samplers and are left alone');
});

test('the kept reply is the one the rest of the screen reads', () => {
  const msg = { role: 'assistant', content: 'a', pick: 1, variants: [{ content: 'a' }, { content: 'b' }] };
  assert.equal(pgPickedText(msg), 'b');
  assert.equal(pgPickedText({ role: 'user', content: 'hi' }), 'hi');
  assert.equal(pgPickedText({ role: 'assistant', pick: 9, variants: [{ content: 'a' }] }), 'a');
  assert.deepEqual(pgHistoryFor([{ role: 'user', content: 'hi' }, msg]),
    [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'b' }]);
});

test('a blank field means the request leaves it out', () => {
  assert.equal(pgIsUnset(''), true);
  assert.equal(pgIsUnset(null), true);
  assert.equal(pgIsUnset(0), false, 'zero is a value an admin chose');
  assert.equal(pgClampField('5', { min: 0, max: 2 }), 2);
  assert.equal(pgClampField('-1', { min: 0, max: 2 }), 0);
  assert.equal(pgClampField('abc', { min: 0, max: 2 }), '');
});

test('models are grouped under the provider they run on', () => {
  const groups = pgGroupModels(
    [{ id: 'a', provider_id: 'p1' }, { id: 'b', provider_id: 'p2' }, { id: 'c', provider_id: 'p1' }, { id: 'd' }],
    [{ id: 'p1', name: 'Local' }, { id: 'p2', name: 'Cloud' }]
  );
  assert.deepEqual(groups.map(g => g.label), ['Local', 'Cloud', 'Other']);
  assert.deepEqual(groups[0].items.map(m => m.id), ['a', 'c']);
});
