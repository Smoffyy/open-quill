import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeParts, resumeTurn, stitch, createStitcher, isPrefillRefusal, RESUME_INSTRUCTION, RESUME_TOOLS_INSTRUCTION, stoppedCall, fenceFor, fileStep, fileRest, joinFile, STOPPED_FILE } from '../lib/resume.js';
import { slideWithCounter } from '../lib/ctxwindow.js';

const oqr = (call, result) => '\n\n[[OQR:' + Buffer.from(JSON.stringify({ call, result }), 'utf8').toString('base64') + ']]\n';

test('a plain cut-off reply is handed back verbatim as a prefill', () => {
  const plan = resumeTurn('Here is the function:\n\n```js\nfunction add(a, b) {\n  return a +', true);
  assert.equal(plan.mode, 'prefill');
  assert.equal(plan.messages.length, 1);
  assert.deepEqual(plan.messages[0], { role: 'assistant', content: 'Here is the function:\n\n```js\nfunction add(a, b) {\n  return a +', prefill: true, held: true });
});

test('without prefill support the reply is followed by an instruction to carry straight on', () => {
  const plan = resumeTurn('Half a sente', false);
  assert.equal(plan.mode, 'fallback');
  assert.deepEqual(plan.messages.map(m => m.role), ['assistant', 'user']);
  assert.equal(plan.messages[0].content, 'Half a sente');
  assert.equal(plan.messages[1].content, RESUME_INSTRUCTION);
  assert.ok(plan.messages.every(m => m.held && !m.prefill));
});

test('tool activity before the cut becomes one note, and the text after it stays raw', () => {
  const content = 'Writing it now.' + oqr({ tool: 'create_file', path: 'a.py' }, { ok: true }) + 'Next I will  edit';
  const { head, tail } = resumeParts(content);
  assert.match(head, /Writing it now\./);
  assert.match(head, /Tools already run in this turn: create_file/);
  assert.equal(tail, '\nNext I will  edit');
  const plan = resumeTurn(content, true);
  assert.ok(plan.messages[0].content.endsWith(']\n\nNext I will  edit'));
  assert.ok(!plan.messages[0].content.includes('[[OQR:'));
});

test('a reply stopped right after its tool calls resumes the task, not a sentence', () => {
  const plan = resumeTurn('Starting.' + oqr({ tool: 'bash', command: 'npm test' }, { ok: true }), true);
  assert.equal(plan.mode, 'tools');
  assert.equal(plan.messages[1].content, RESUME_TOOLS_INSTRUCTION);
});

test('nothing visible means there is nothing to continue', () => {
  assert.equal(resumeTurn('', true), null);
  assert.equal(resumeTurn('  \n\n[[OQT:0]]\n', true), null);
});

test('stitch drops whitespace the model repeats after a prefill', () => {
  assert.equal(stitch('end.\n\n', '\n\nNext', 'prefill'), 'Next');
  assert.equal(stitch('the ', ' cat', 'prefill'), 'cat');
  assert.equal(stitch('foo()\n', '\n    bar()', 'prefill'), '    bar()');
  assert.equal(stitch('foo()\n    ', 'bar()', 'prefill'), 'bar()');
  assert.equal(stitch('hel', 'lo', 'prefill'), 'lo');
});

test('stitch removes a repeated tail and a reopened code fence in fallback mode', () => {
  assert.equal(stitch('const total = items.redu', 'const total = items.reduce((a, b) => a + b, 0);', 'fallback'), 'ce((a, b) => a + b, 0);');
  assert.equal(stitch('```python\ndef f(x):\n    return', '```python\n x * 2\n```', 'fallback'), ' x * 2\n```');
  assert.equal(stitch('```python\ndef f(x):\n    return x\n', '```\n\nDone.', 'fallback'), '```\n\nDone.', 'a bare fence closes the block and is kept');
  assert.equal(stitch('The first point.', 'The second point.', 'fallback'), ' The second point.');
  assert.equal(stitch('abc', 'xyz', 'fallback'), 'xyz');
});

test('the stitcher holds text until it can judge the seam, then passes the rest through', () => {
  const p = createStitcher('one two ', { mode: 'prefill', messages: [{ content: '' }] });
  assert.equal(p.touched, false);
  assert.equal(p.push(' '), '');
  assert.equal(p.touched, true);
  assert.equal(p.push(' three'), ' three');
  assert.equal(p.push(' four'), ' four');
  assert.equal(p.flush(), '');

  const f = createStitcher('Hello wor', resumeTurn('Hello wor', false));
  assert.equal(f.push('Hello world, how'), '');
  assert.equal(f.flush(), 'ld, how');
  assert.equal(createStitcher('x', { mode: 'tools', messages: [] }), null);
  assert.equal(createStitcher('x', null), null);
});

test('a server that echoes the prefill back has the echo removed', () => {
  const prev = '```python\ndef load(path):\n    """Load todos.\n\n   ';
  const s = createStitcher(prev, resumeTurn(prev, true));
  assert.equal(s.push('```python\ndef load('), '', 'held while it still matches the prefill');
  assert.equal(s.push('path):\n    """Load todos.\n\n    Args:'), ' Args:');
  assert.equal(s.push('\n'), '\n');
  const n = createStitcher('1, 2, 3, 4,', resumeTurn('1, 2, 3, 4,', true));
  assert.equal(n.push('1, 2, 3, 4, '), '');
  assert.equal(n.push('5'), ' 5');
  const plain = createStitcher('1, 2,', resumeTurn('1, 2,', true));
  assert.equal(plain.push(' 3,'), ' 3,', 'a provider that does not echo passes straight through');
});

test('only an upstream 400 or 422 reads as a refused prefill', () => {
  assert.equal(isPrefillRefusal(new Error('Upstream error 400: Assistant response prefill is incompatible with enable_thinking.')), true);
  assert.equal(isPrefillRefusal(new Error('Upstream error 422: bad')), true);
  assert.equal(isPrefillRefusal(new Error('Upstream error 500: boom')), false);
  assert.equal(isPrefillRefusal(null), false);
});

test('the context window drops older turns before it touches the resumed reply', async () => {
  const count = (list) => list.reduce((n, m) => n + Math.ceil(String(m.content || '').length / 4) + 4, 0);
  const msgs = [{ role: 'system', content: 'S'.repeat(200) }];
  for (let i = 0; i < 20; i++) msgs.push({ role: 'user', content: 'u'.repeat(400) }, { role: 'assistant', content: 'a'.repeat(400) });
  msgs.push({ role: 'user', content: 'write it' });
  const partial = 'x'.repeat(2000);
  const fallback = resumeTurn(partial, false).messages;
  const r = await slideWithCounter(count, msgs.concat(fallback), 2000);
  assert.ok(r.dropped > 0);
  assert.equal(r.msgs.at(-2).content, partial, 'the reply being continued survives intact');
  assert.equal(r.msgs.at(-1).content, RESUME_INSTRUCTION);
  const prefill = await slideWithCounter(count, msgs.concat(resumeTurn(partial, true).messages), 2000);
  assert.equal(prefill.msgs.at(-1).content, partial);
});

test('a file stopped mid-write is found at the end of the reply and resumed as a file', () => {
  const block = oqr({ tool: 'create_file', path: 'todo.py' }, { ok: false, interrupted: true, error: STOPPED_FILE });
  const content = 'Creating the app.' + block;
  const found = stoppedCall(content);
  assert.equal(found.call.path, 'todo.py');
  assert.equal(content.slice(found.start, found.end).startsWith('[[OQR:'), true);
  const plan = resumeTurn(content, true);
  assert.deepEqual([plan.mode, plan.path, plan.head, plan.start, plan.end], ['file', 'todo.py', 'Creating the app.', found.start, found.end]);
  assert.equal(resumeTurn(content, true, { file: false }).mode, 'tools');
  assert.equal(stoppedCall(content + 'more text'), null, 'text after the card means the card is not where it stopped');
  assert.equal(stoppedCall('x' + oqr({ tool: 'create_file', path: 'a' }, { ok: true })), null);
  const bash = resumeTurn('x' + oqr({ tool: 'bash', cmd: 'ls' }, { ok: false, interrupted: true, error: 'x' }), true);
  assert.equal(bash.mode, 'tools', 'only a file can be written onward; other calls are redone');
});

test('the fence around a resumed file is longer than any backtick run inside it', () => {
  assert.equal(fenceFor('print(1)'), '```');
  assert.equal(fenceFor('# Doc\n```js\nx\n```\n'), '````');
});

test('a prefilled file step strips the echo and stops at the closing fence', () => {
  const partial = 'def add(a, b):\n    return a +';
  const step = fileStep('calc.py', partial, '', true);
  assert.equal(step.messages.at(-1).content, '```py\n' + partial);
  assert.equal(step.messages[0].content, 'I am writing calc.py.');
  assert.deepEqual(fileRest('```py\ndef add(', step), { text: '', closed: false }, 'still echoing');
  assert.deepEqual(fileRest(step.echo + ' b\n\n\nprint(add(1, 2))\n', step), { text: ' b\n\n\nprint(add(1, 2))\n', closed: false });
  assert.deepEqual(fileRest(' b\n\nprint(1)\n```\nDone!', step), { text: ' b\n\nprint(1)\n', closed: true }, 'a server that does not echo');
  assert.equal(joinFile(partial, ' b\n', true), ' b\n');
});

test('a file step without prefill reads the code block and drops what the model repeats', () => {
  const partial = 'def add(a, b):\n    return a +';
  const step = fileStep('calc.py', partial, 'Writing.', false);
  assert.equal(step.messages.length, 2);
  assert.ok(step.messages[1].content.includes(partial));
  assert.deepEqual(fileRest('Sure:\n```python\n', step), { text: '', closed: false });
  const got = fileRest('Sure:\n```python\n    return a + b\n```\n', step);
  assert.deepEqual(got, { text: '    return a + b\n', closed: true });
  assert.equal(joinFile(partial, got.text, false), ' b\n');
  assert.equal(joinFile(partial, partial + ' b\n', false), ' b\n', 'a full restart is trimmed back to the new part');
  const md = fileStep('README.md', '# T\n```js\nx\n```\n', '', false);
  assert.deepEqual(fileRest('````md\nmore\n```\nstill inside\n````\n', md), { text: 'more\n```\nstill inside\n', closed: true });
});