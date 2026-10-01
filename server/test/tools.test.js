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

test('todo items are cleaned, statuses normalised and the list capped', async () => {
  const { sanitizeTodos, todoText, TODO_MAX_ITEMS } = await import('../lib/todo.js');
  const r = sanitizeTodos([{ content: '  Write   tests ', status: 'done' }, { content: 'Ship', status: 'In Progress' }, { content: 'Plan' }, { content: '' }, 'Loose string']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, [
    { content: 'Write tests', status: 'completed' },
    { content: 'Ship', status: 'in_progress' },
    { content: 'Plan', status: 'pending' },
    { content: 'Loose string', status: 'pending' }
  ]);
  assert.equal(todoText(r.items), '[x] Write tests\n[>] Ship\n[ ] Plan\n[ ] Loose string');
  assert.equal(todoText([]), '(empty)');
  assert.equal(sanitizeTodos(JSON.stringify([{ content: 'a', status: 'pending' }])).items.length, 1, 'a JSON string from a small model still parses');
  assert.equal(sanitizeTodos('not a list').ok, false);
  assert.equal(sanitizeTodos(Array.from({ length: TODO_MAX_ITEMS + 1 }, (_, i) => ({ content: 'x' + i }))).ok, false);
});

test('todo steps can be cancelled and the plan closes when nothing is left to do', async () => {
  const { sanitizeTodos, runTodo, latestTodos, todoText } = await import('../lib/todo.js');
  assert.equal(sanitizeTodos([{ content: 'a', status: 'Canceled' }, { content: 'b', status: "won't do" }]).items.every(t => t.status === 'cancelled'), true);
  const open = runTodo({ items: [{ content: 'Build', status: 'completed' }, { content: 'Lint', status: 'cancelled' }, { content: 'Test', status: 'in_progress' }] });
  assert.equal(open.payload.closed, undefined);
  assert.equal(open.payload.total, 2);
  assert.match(open.formatted, /\[-\] Lint/);
  const finished = runTodo({ items: [{ content: 'Build', status: 'completed' }, { content: 'Lint', status: 'cancelled' }] });
  assert.equal(finished.payload.closed, 'finished');
  assert.equal(runTodo({ items: [] }).payload.closed, 'cancelled');
  assert.equal(runTodo({ items: [{ content: 'x', status: 'cancelled' }] }).payload.closed, 'cancelled');
  const rec = (payload) => '[[OQR:' + Buffer.from(JSON.stringify({ call: { tool: 'todo' }, result: payload }), 'utf8').toString('base64') + ']]';
  const thread = [
    { role: 'assistant', content: rec(open.payload) },
    { role: 'user', content: 'go on' },
    { role: 'assistant', content: 'no tools' }
  ];
  assert.equal(todoText(latestTodos(thread)), '[x] Build\n[-] Lint\n[>] Test');
  assert.deepEqual(latestTodos([...thread, { role: 'assistant', content: rec(finished.payload) }]), [], 'a closed plan leaves the prompt empty');
  assert.deepEqual(latestTodos([]), []);
});

test('ask_user needs a question and 2 to 6 distinct options', async () => {
  const { runAskUser, formatAskUser } = await import('../lib/askuser.js');
  const ok = runAskUser({ question: ' Which   database? ', options: ['SQLite', 'Postgres', 'sqlite', ''] });
  assert.deepEqual(ok, { ok: true, question: 'Which database?', options: ['SQLite', 'Postgres'], multiple: false });
  const multi = runAskUser({ question: 'Which features?', options: ['Auth', 'Search'], multiple: true });
  assert.equal(multi.multiple, true);
  assert.match(formatAskUser({ ...multi, answer: 'Auth, Search' }), /the user answered: Auth, Search$/);
  assert.match(formatAskUser({ ...multi, skipped: true }), /skipped the question/);
  assert.match(formatAskUser({ ...multi, stopped: true }), /stopped the reply/);
  assert.match(formatAskUser({ ...multi, timedOut: true }), /no answer came/);
  assert.deepEqual(runAskUser({ question: 'Q', options: 'Yes\nNo' }).options, ['Yes', 'No'], 'newline-separated options are accepted');
  assert.equal(runAskUser({ question: 'Q', options: ['Only one'] }).ok, false);
  assert.equal(runAskUser({ question: 'Q', options: ['1', '2', '3', '4', '5', '6', '7'] }).ok, false);
  assert.equal(runAskUser({ question: '', options: ['a', 'b'] }).ok, false);
});

test('consult targets are sanitised and only admin-chosen models resolve', async () => {
  const { sanitizeConsultModels, consultTargetsText } = await import('../lib/consult.js');
  assert.deepEqual(sanitizeConsultModels(['a', 'a', 7, '', 'b', { id: 'c' }]), ['a', 'b']);
  assert.deepEqual(sanitizeConsultModels('a'), []);
  const text = consultTargetsText({ consult_images: 1 }, [
    { display_name: 'Vision', has_vision: 1, description: 'Sees   things' },
    { display_name: 'Big', has_vision: 0 }
  ]);
  assert.equal(text, '- Vision (can see images): Sees things\n- Big');
  assert.equal(consultTargetsText({ consult_images: 0 }, [{ display_name: 'Vision', has_vision: 1 }]), '- Vision', 'image support is only advertised when forwarding is on');
});

test('the new tools are offered only when enabled', () => {
  const names = (o) => buildTools(o).map(s => s.function.name);
  assert.deepEqual(names({ todoOn: true, askUserOn: true, consultNames: ['Vision'] }), ['todo', 'ask_user', 'consult_model']);
  const consult = buildTools({ consultNames: ['Vision', 'Big'] })[0];
  assert.deepEqual(consult.function.parameters.properties.model.enum, ['Vision', 'Big']);
});

test('a pending question resolves with the answer, a skip, a stop or a timeout', async () => {
  const live = await import('../lib/ws/live.js');
  const answered = live.waitForAnswer('chat-a', null, 5000);
  assert.equal(live.answerQuestion('chat-a', { answer: 'clap' }), true);
  assert.deepEqual(await answered, { answer: 'clap' });
  assert.equal(live.answerQuestion('chat-a', { answer: 'late' }), false, 'nothing is waiting any more');

  const ctl = new AbortController();
  const stopped = live.waitForAnswer('chat-b', ctl.signal, 5000);
  ctl.abort();
  assert.deepEqual(await stopped, { stopped: true });

  assert.deepEqual(await live.waitForAnswer('chat-c', null, 10), { timedOut: true });

  const first = live.waitForAnswer('chat-d', null, 5000);
  const second = live.waitForAnswer('chat-d', null, 5000);
  assert.deepEqual(await first, { stopped: true }, 'a newer question replaces an older one');
  live.answerQuestion('chat-d', { skipped: true });
  assert.deepEqual(await second, { skipped: true });
});

test('a dismissed plan leaves the prompt, and a newer plan comes back', async () => {
  const { runTodo, latestTodos } = await import('../lib/todo.js');
  const rec = (payload) => '[[OQR:' + Buffer.from(JSON.stringify({ call: { tool: 'todo' }, result: payload }), 'utf8').toString('base64') + ']]';
  const plan = runTodo({ items: [{ content: 'Build', status: 'in_progress' }, { content: 'Test', status: 'pending' }] }).payload;
  const thread = [{ id: 'a1', role: 'assistant', content: rec(plan) }];
  assert.equal(latestTodos(thread).length, 2);
  assert.deepEqual(latestTodos(thread, { msg: 'a1', n: 1 }), []);
  assert.equal(latestTodos([...thread, { id: 'a2', role: 'assistant', content: rec(plan) }], { msg: 'a1', n: 1 }).length, 2);
});
