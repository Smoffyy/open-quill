import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRange,
  clampToRange,
  allNumeric,
  kwargPayload,
  controlOf as controlOfKwarg,
  defaultValueOf as defaultValueOfKwarg,
  resolveKwargValues as resolveKwargs,
  gateOpen,
  kwargVisible,
  gateSourceIds,
  KWARG_PRESETS
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
  const p = KWARG_PRESETS.find(x => x.key === 'thinking_budget_tokens').make();
  assert.equal(p.name, 'thinking_budget_tokens');
  assert.equal(p.target, 'body', 'top level, not nested under extra_body');
  assert.equal(p.type, 'number');
  assert.deepEqual([p.min, p.max, p.step, p.default], [1024, 8192, 1024, '1024']);
  assert.equal(defaultValueOfKwarg(p), '1024');
  assert.equal(controlOfKwarg(p), 'range');
  const out = kwargPayload([p], resolveKwargs([p], { [p.id]: '5000' }, false));
  assert.equal(out.thinking_budget_tokens, 5120, 'snapped to the 1024 grid');
  assert.equal('extra_body' in out, false);
});
