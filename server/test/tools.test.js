import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, runCalculator, formatNumber } from '../lib/calculator.js';
import { applyMemoryOp, sanitizeMemories, legacyMemories, userMemoryOn, MEMORY_MAX_ITEMS, MEMORY_MAX_CHARS } from '../lib/memory.js';
import { buildTools } from '../tools/index.js';

test('calculator follows operator precedence and associativity', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.equal(evaluate('(2 + 3) * 4'), 20);
  assert.equal(evaluate('2 ^ 3 ^ 2'), 512);
  assert.equal(evaluate('-2 ^ 2'), -4);
  assert.equal(evaluate('2 ^ -1'), 0.5);
  assert.equal(evaluate('2 ** 10'), 1024);
  assert.equal(evaluate('10 - 4 - 3'), 3);
  assert.equal(evaluate('7 % 3'), 1);
  assert.equal(evaluate('5!'), 120);
  assert.equal(evaluate('1.5e3 / 3'), 500);
  assert.equal(evaluate('12 × 3 ÷ 4'), 9);
});

test('calculator functions and constants', () => {
  assert.equal(evaluate('sqrt(16) + log(100)'), 6);
  assert.equal(evaluate('log(8, 2)'), 3);
  assert.equal(evaluate('max(1, 5, 3)'), 5);
  assert.equal(evaluate('round(3.14159, 2)'), 3.14);
  assert.equal(evaluate('ncr(5, 2)'), 10);
  assert.equal(evaluate('PI'), Math.PI);
  assert.ok(Math.abs(evaluate('sin(pi / 2)') - 1) < 1e-12);
});

test('calculator reports errors instead of throwing to the caller', () => {
  for (const bad of ['', '1 / 0', '(1 + 2', 'foo(1)', 'toString', 'constructor(1)', '__proto__', '2 +', 'sqrt(1, 2)', '171!', '1e999', 'x'.repeat(501)]) {
    const r = runCalculator({ expression: bad });
    assert.equal(r.ok, false, bad);
    assert.equal(typeof r.error, 'string');
  }
});

test('calculator refuses code and deep nesting', () => {
  assert.equal(runCalculator({ expression: 'process.exit(1)' }).ok, false);
  assert.equal(runCalculator({ expression: '('.repeat(200) + '1' + ')'.repeat(200) }).ok, false);
});

test('calculator formats floating point noise away', () => {
  assert.equal(runCalculator({ expression: '0.1 + 0.2' }).result, '0.3');
  assert.equal(formatNumber(-0), '0');
  assert.equal(formatNumber(1e21), '1e+21');
});

test('memory add, update and delete', () => {
  let r = applyMemoryOp([], { action: 'add', text: '  Prefers   TypeScript ', source: 'assistant' }, 5);
  assert.equal(r.ok, true);
  assert.equal(r.item.text, 'Prefers TypeScript');
  assert.equal(r.item.source, 'assistant');
  assert.match(r.item.id, /^[a-z0-9]{6}$/);
  const id = r.item.id;
  let list = r.list;

  r = applyMemoryOp(list, { action: 'add', text: 'prefers typescript' });
  assert.equal(r.duplicate, true);
  assert.equal(r.list, list);

  r = applyMemoryOp(list, { action: 'update', id: `[${id}]`, text: 'Prefers Rust' }, 9);
  assert.equal(r.ok, true);
  assert.equal(r.list[0].text, 'Prefers Rust');
  assert.equal(r.list[0].created_at, 5);
  assert.equal(r.list[0].updated_at, 9);
  list = r.list;

  r = applyMemoryOp(list, { action: 'delete', id });
  assert.equal(r.ok, true);
  assert.deepEqual(r.list, []);
});

test('memory rejects bad operations', () => {
  assert.equal(applyMemoryOp([], { action: 'add', text: '   ' }).ok, false);
  assert.equal(applyMemoryOp([], { action: 'update', id: 'nope12', text: 'x' }).ok, false);
  assert.equal(applyMemoryOp([], { action: 'delete' }).ok, false);
  assert.equal(applyMemoryOp([], { action: 'wipe' }).ok, false);
  const full = Array.from({ length: MEMORY_MAX_ITEMS }, (_, i) => ({ id: 'id' + String(i).padStart(4, '0'), text: 'fact ' + i }));
  assert.equal(applyMemoryOp(full, { action: 'add', text: 'one more' }).ok, false);
});

test('memory entries are sanitized and capped', () => {
  const long = 'a'.repeat(MEMORY_MAX_CHARS + 50);
  const out = sanitizeMemories([{ id: 'abc123', text: long }, { id: 'abc123', text: 'dup' }, { id: '../x', text: 'bad id' }, { id: 'def456', text: '' }, null]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text.length, MEMORY_MAX_CHARS);
  assert.equal(out[0].source, 'user');
});

test('legacy memory text becomes one entry per line', () => {
  const out = legacyMemories('- Name is Sam\n\n* Uses Vim\n1. Lives in Oslo', 7);
  assert.deepEqual(out.map(m => m.text), ['Name is Sam', 'Uses Vim', 'Lives in Oslo']);
  assert.equal(new Set(out.map(m => m.id)).size, 3);
  assert.ok(out.every(m => m.created_at === 7));
});

test('memory and calculator schemas are only offered when enabled', () => {
  const names = (o) => buildTools(o).map(s => s.function.name);
  assert.deepEqual(names({}), []);
  assert.deepEqual(names({ memoryOn: true, calculatorOn: true }), ['memory', 'calculator']);
});

test('memory is off until the member turns it on', () => {
  assert.equal(userMemoryOn(null), false);
  assert.equal(userMemoryOn({ prefs: {} }), false);
  assert.equal(userMemoryOn({}), false);
  assert.equal(userMemoryOn({ prefs: { memoryEnabled: false } }), false);
  assert.equal(userMemoryOn({ prefs: { memoryEnabled: 'true' } }), false);
  assert.equal(userMemoryOn({ prefs: { memoryEnabled: true } }), true);
});
