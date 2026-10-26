import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleForm, formSchedule, scheduleProblem, localInput, unitFor } from '../src/lib/schedule.js';

test('a schedule survives a round trip through the editor form', () => {
  for (const schedule of [
    { kind: 'daily', hour: 9, minute: 5 },
    { kind: 'weekdays', hour: 23, minute: 59 },
    { kind: 'weekly', hour: 16, minute: 0, days: [1, 3, 5] },
    { kind: 'interval', everyMinutes: 90 },
    { kind: 'interval', everyMinutes: 180 },
    { kind: 'interval', everyMinutes: 2880 }
  ]) {
    assert.deepEqual(formSchedule(scheduleForm(schedule)), schedule);
  }
  const at = new Date(2026, 9, 25, 14, 30).getTime();
  assert.deepEqual(formSchedule(scheduleForm({ kind: 'once', at })), { kind: 'once', at });
});

test('the form picks the largest whole unit for an interval', () => {
  assert.equal(unitFor(45), 'minutes');
  assert.equal(unitFor(120), 'hours');
  assert.equal(unitFor(1440), 'days');
  const form = scheduleForm({ kind: 'interval', everyMinutes: 120 });
  assert.equal(form.every, '2');
  assert.equal(form.unit, 'hours');
});

test('a blank one-shot defaults to the next whole hour', () => {
  const now = new Date(2026, 9, 25, 14, 30).getTime();
  assert.equal(scheduleForm({ kind: 'once' }, now).at, localInput(new Date(2026, 9, 25, 15, 0).getTime()));
});

test('scheduleProblem catches what the server would silently clamp', () => {
  const now = new Date(2026, 9, 25, 14, 30).getTime();
  const base = scheduleForm({ kind: 'daily', hour: 9, minute: 0 }, now);
  assert.equal(scheduleProblem(base, now), '');
  assert.equal(scheduleProblem({ ...base, kind: 'once', at: localInput(now - 60000) }, now), 'past');
  assert.equal(scheduleProblem({ ...base, kind: 'once', at: '' }, now), 'past');
  assert.equal(scheduleProblem({ ...base, kind: 'once', at: localInput(now + 3600000) }, now), '');
  assert.equal(scheduleProblem({ ...base, kind: 'interval', every: '2', unit: 'minutes' }, now), 'short');
  assert.equal(scheduleProblem({ ...base, kind: 'interval', every: '', unit: 'hours' }, now), 'short');
  assert.equal(scheduleProblem({ ...base, kind: 'interval', every: '8', unit: 'days' }, now), 'long');
  assert.equal(scheduleProblem({ ...base, kind: 'interval', every: '7', unit: 'days' }, now), '');
  assert.equal(scheduleProblem({ ...base, kind: 'weekly', days: [] }, now), 'days');
  assert.equal(scheduleProblem({ ...base, time: '' }, now), 'time');
});