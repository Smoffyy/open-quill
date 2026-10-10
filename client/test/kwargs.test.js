import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRange,
  kwargAccepts,
  clampToRange,
  allNumeric,
  kwargPayload,
  controlOf as controlOfKwarg,
  defaultValueOf as defaultValueOfKwarg,
  resolveKwargValues as resolveKwargs,
  gateOpen,
  kwargVisible,
  gateSourceIds,
  KWARG_PRESETS,
  replayWhenOf,
  replayValuesOf,
  rangeSteps,
  nearestStep,
  kwargChip,
  chipNumber,
  rangeLabel,
  kwargValuesArr,
  stopLabel
} from '../src/lib/kwargs.js';

// --- kwarg number ranges ---------------------------------------------------
// The client mirrors server/lib/kwargs.js. If the two disagree the payload
// preview in the admin editor lies about what the server will actually send.

test('a kwarg range is detected the same way on the client', () => {
  assert.equal(isRange({ min: 0, max: 4096 }), true);
  for (const bad of [{ min: 5, max: 5 }, { min: 10, max: 2 }, { min: 0 }, { max: 10 }, {}, { min: '', max: '' }, { min: 'a', max: 'b' }]) {
    assert.equal(isRange(bad), false, JSON.stringify(bad));
  }
  assert.equal(isRange({ min: '0', max: '100' }), true, 'the editor holds these as strings while being typed');
});

test('a range control wins over any other control setting', () => {
  assert.equal(controlOfKwarg({ min: 0, max: 100, control: 'select' }), 'range');
  assert.equal(controlOfKwarg({ values: ['false', 'true'] }), 'toggle');
  assert.equal(controlOfKwarg({ values: ['a', 'b', 'c'] }), 'slider');
});

test('client clamping matches the server, including the reachable maximum', () => {
  const d = { min: 0, max: 1000, step: 100 };
  assert.equal(clampToRange(d, 250), 300);
  assert.equal(clampToRange(d, -50), 0);
  assert.equal(clampToRange(d, 99999), 1000);
  assert.equal(clampToRange(d, 'nonsense'), null);
  assert.equal(clampToRange({ min: 5, max: 100, step: 10 }, 100), 100);
  assert.equal(clampToRange({ min: 0, max: 2048, step: 100 }, 2048), 2048, 'an off-grid maximum is still reachable');
  assert.equal(clampToRange({ min: 0, max: 2048, step: 100 }, 1250), 1300);
  assert.equal(clampToRange({ min: 0, max: 2, step: 0.1 }, 0.30000000000000004), 0.3);
  assert.equal(clampToRange({ min: 0, max: 10 }, 3.7), 4, 'no step means whole numbers');
});

test('a range default falls back to the minimum, and the payload carries a number', () => {
  assert.equal(defaultValueOfKwarg({ min: 10, max: 20, step: 1, default: '' }), '10');
  assert.equal(defaultValueOfKwarg({ min: 10, max: 20, step: 1, default: '999' }), '20');
  const defs = [{ id: 'b', name: 'reasoning_budget', target: 'extra_body', type: 'number', min: 0, max: 2048, step: 256 }];
  const out = kwargPayload(defs, resolveKwargs(defs, { b: '600' }, false));
  assert.equal(out.extra_body.reasoning_budget, 512);
  assert.equal(typeof out.extra_body.reasoning_budget, 'number');
});

test('allNumeric decides whether a slider is worth offering', () => {
  assert.equal(allNumeric(['0', '512', '2048']), true);
  assert.equal(allNumeric(['low', 'high']), false);
  assert.equal(allNumeric(['1', 'high']), false);
  assert.equal(allNumeric([]), false);
});

test('a gated kwarg hides its control but keeps its value', () => {
  const defs = [
    { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
    { id: 'budget', name: 'thinking_budget_tokens', target: 'body', type: 'number',
      min: 1024, max: 8192, step: 1024, default: '1024', showIf: { id: 'think', value: 'true' } }
  ];
  const off = resolveKwargs(defs, {}, false);
  assert.equal(gateOpen(defs, off, defs[1]), false);
  assert.equal(kwargVisible(defs, off, defs[1]), false);
  assert.equal(off.budget, '1024');

  const on = resolveKwargs(defs, { think: 'true', budget: '4096' }, false);
  assert.equal(kwargVisible(defs, on, defs[1]), true);
  assert.equal(kwargPayload(defs, on).thinking_budget_tokens, 4096);
});

test('a closed gate drops the value only when sendWhenHidden is off', () => {
  const mk = (send) => [
    { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
    { id: 'budget', name: 'thinking_budget_tokens', target: 'body', type: 'number',
      min: 1024, max: 8192, step: 1024, default: '1024', sendWhenHidden: send,
      showIf: { id: 'think', value: 'true' } }
  ];
  const kept = mk(true);
  assert.equal(kwargPayload(kept, resolveKwargs(kept, {}, false)).thinking_budget_tokens, 1024);
  const dropped = mk(false);
  assert.equal('thinking_budget_tokens' in kwargPayload(dropped, resolveKwargs(dropped, {}, false)), false);
});

test('the kwarg behind an open gate takes over the trigger chip', () => {
  const defs = [
    { id: 'think', name: 'enable_thinking', chip: 'Extended', values: ['false', 'true'], default: 'false' },
    { id: 'effort', name: 'reasoning_effort', values: ['low', 'medium', 'xhigh'], default: 'low',
      showIf: { id: 'think', value: 'true' } }
  ];
  const off = resolveKwargs(defs, {}, false);
  assert.equal(gateSourceIds(defs, off).has('think'), false);

  const on = resolveKwargs(defs, { think: 'true' }, false);
  assert.equal(gateSourceIds(defs, on).has('think'), true);
  assert.equal(gateSourceIds(defs, on).has('effort'), false);
});

test('an admin-hidden gated kwarg leaves its source chip alone', () => {
  const defs = [
    { id: 'think', name: 'enable_thinking', chip: 'Extended', values: ['false', 'true'], default: 'false' },
    { id: 'effort', name: 'reasoning_effort', values: ['low', 'high'], default: 'low',
      visible: false, showIf: { id: 'think', value: 'true' } }
  ];
  assert.equal(gateSourceIds(defs, resolveKwargs(defs, { think: 'true' }, false)).has('think'), false);
});

test('an unresolvable or absent gate leaves the kwarg visible', () => {
  const defs = [{ id: 'a', name: 'a', values: ['1', '2'] }];
  assert.equal(gateOpen(defs, {}, defs[0]), true);
  assert.equal(gateOpen(defs, {}, { id: 'b', showIf: { id: 'ghost', value: '1' } }), true);
});

test('the thinking budget preset matches the shape llama.cpp expects', () => {
  assert.equal(KWARG_PRESETS.some(x => x.key === 'thinking_budget_tokens'), false);
  const p = KWARG_PRESETS.find(x => x.key === 'reasoning_budget_tokens').make();
  assert.equal(p.name, 'reasoning_budget_tokens');
  assert.equal(p.target, 'body', 'top level, not nested under extra_body');
  assert.equal(p.type, 'number');
  assert.deepEqual([p.min, p.max, p.step, p.default], [1024, 16384, 1024, '4096']);
  assert.equal(defaultValueOfKwarg(p), '4096');
  assert.equal(controlOfKwarg(p), 'range');
  const out = kwargPayload([p], resolveKwargs([p], { [p.id]: '5000' }, false));
  assert.equal(out.reasoning_budget_tokens, 5120, 'snapped to the 1024 grid');
  assert.equal('extra_body' in out, false);
});

test('replay defaults match the server and an explicit blank opts out', () => {
  assert.equal(replayWhenOf({ name: 'preserve_thinking' }), 'true');
  assert.equal(replayWhenOf({ name: 'clear_thinking' }), 'false');
  assert.equal(replayWhenOf({ name: 'enable_thinking' }), '');
  assert.equal(replayWhenOf({ name: 'preserve_thinking', replayWhen: '' }), '');
  assert.equal(replayWhenOf({ name: 'keep', replayWhen: 'on' }), 'on');
  assert.deepEqual(replayValuesOf({ values: ['off', 'on'] }), ['off', 'on']);
  assert.deepEqual(replayValuesOf({ parentId: 'p', rules: [{ when: 'true', value: 'true' }, { when: 'false', value: 'x', send: false }] }), ['true']);
  assert.deepEqual(replayValuesOf({ min: 0, max: 10 }), []);
  assert.equal(KWARG_PRESETS.find(p => p.key === 'preserve_thinking').make().replayWhen, 'true');
  assert.equal(KWARG_PRESETS.find(p => p.key === 'clear_thinking').make().replayWhen, 'false');
});

test('a range becomes the step list the effort slider walks', () => {
  const budget = { min: 512, max: 16384, step: 512 };
  const steps = rangeSteps(budget);
  assert.equal(steps.length, 32);
  assert.deepEqual([steps[0], steps[1], steps[steps.length - 1]], ['512', '1024', '16384']);
  assert.deepEqual(rangeSteps({ min: 0, max: 10, step: 3 }), ['0', '3', '6', '9', '10'], 'the max stays reachable off the grid');
  assert.deepEqual(rangeSteps({ min: 0, max: 1, step: 0.25 }), ['0', '0.25', '0.5', '0.75', '1']);
  assert.ok(rangeSteps({ min: 0, max: 100000, step: 1 }).length <= 402, 'a fine range is thinned so the slider stays usable');
  assert.equal(nearestStep(steps, '4096'), 7);
  assert.equal(nearestStep(steps, 5000), 9);
  assert.equal(nearestStep(steps, 99999), 31);
});

test('a number slider chip follows the admin template, unit and 0 means off', () => {
  const budget = KWARG_PRESETS.find(x => x.key === 'reasoning_budget_tokens').make();
  assert.equal(kwargChip(budget, '0'), '', '0 means off leaves just the model name');
  assert.equal(kwargChip(budget, '4096'), 'Thinking · 4K tokens');
  assert.equal(kwargChip({ ...budget, chip: 'Thinking' }, '4096'), 'Thinking', 'no {value} means the word alone');
  assert.equal(kwargChip({ ...budget, chip: '' }, '16384'), '16K tokens', 'no chip falls back to the number and unit');
  assert.equal(kwargChip({ min: 0, max: 2, step: 0.1, chip: 'Temp {value}' }, '0'), 'Temp 0', 'without 0 means off, 0 is a value');
  assert.equal(chipNumber('1536'), '1.5K');
  assert.equal(chipNumber('512'), '512');
  assert.equal(kwargChip({ values: ['low', 'medium', 'high'] }, 'medium'), 'Medium', 'step sliders are unchanged');
});

test('a number slider header reads Off at 0 and the full number with its unit', () => {
  const budget = { min: 0, max: 16384, step: 1024, unit: 'tokens', zeroOff: true };
  assert.equal(rangeLabel(budget, '0', 'Off'), 'Off');
  assert.equal(rangeLabel(budget, '4096', 'Off'), (4096).toLocaleString() + ' tokens');
  assert.equal(rangeLabel({ min: 0, max: 2, step: 0.1 }, '0', 'Off'), '0');
  assert.equal(rangeLabel({ min: 0, max: 2, step: 0.1 }, '0.7', 'Off'), (0.7).toLocaleString());
});

test('a stored value is kept only when the model still accepts it, for sliders and lists alike', () => {
  const budget = { min: 1024, max: 16384, step: 1024, values: [] };
  assert.equal(kwargAccepts(budget, '8192'), true);
  assert.equal(kwargAccepts(budget, '16384'), true);
  assert.equal(kwargAccepts(budget, '20000'), false, 'above the admin maximum of another model');
  assert.equal(kwargAccepts(budget, '1500'), false, 'off the step grid is reseeded to the default');
  assert.equal(kwargAccepts(budget, null), false);
  assert.equal(kwargAccepts({ values: ['low', 'high'] }, 'high'), true);
  assert.equal(kwargAccepts({ values: ['low', 'high'] }, 'medium'), false);
});

test('labelled steps show their words in the picker and send their numbers', () => {
  const levels = KWARG_PRESETS.find(x => x.key === 'reasoning_levels').make();
  assert.equal(controlOfKwarg(levels), 'slider');
  assert.deepEqual(kwargValuesArr(levels), ['0', '1024', '2048', '4096']);
  assert.equal(stopLabel(levels, '2048'), 'Medium');
  assert.equal(stopLabel(levels, '3000'), '3000', 'a number that is not a step keeps its digits');
  assert.equal(defaultValueOfKwarg(levels), '2048');
  assert.equal(kwargChip(levels, '0'), '', 'Off with 0 means off shows no chip');
  assert.equal(kwargChip(levels, '1024'), 'Low', 'the preset chip is just the word');
  assert.equal(kwargChip(levels, '0'), '', 'the step marked Off adds no chip');
  const unmarked = { ...levels, stops: levels.stops.map(s => ({ ...s, off: false })) };
  assert.equal(kwargChip(unmarked, '0'), 'Off', 'a step at 0 keeps its chip unless it is marked Off');
  const out = kwargPayload([levels], resolveKwargs([levels], { [levels.id]: '4096' }, false));
  assert.equal(out.reasoning_budget_tokens, 4096);
  assert.equal(typeof out.reasoning_budget_tokens, 'number');
});

test('a chip template fills in its value for every kind of control', () => {
  assert.equal(kwargChip({ values: ['low', 'high'], chip: 'Level {value}' }, 'high'), 'Level High');
  assert.equal(kwargChip({ values: ['low', 'high'], chip: 'Level' }, 'high'), 'Level');
});