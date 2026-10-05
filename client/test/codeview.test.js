import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTurn, withLive, groupCounts, fileChanges, totals, stepTarget, canonTool } from '../src/lib/codeview.js';
import { parseRoute, pathForCode } from '../src/lib/route.js';

const oqr = (call, result) => '[[OQR:' + Buffer.from(JSON.stringify({ call, result })).toString('base64') + ']]';

test('a turn splits into text and runs of tool calls', () => {
  const content = 'Starting.\n\n' + oqr({ tool: 'create_file', path: 'a.py' }, { ok: true, adds: 3, v: 1 })
    + '\n' + oqr({ tool: 'bash', cmd: 'python a.py' }, { ok: true, output: 'hi' }) + '\n\nDone.';
  const parts = splitTurn(content);
  assert.deepEqual(parts.map(p => p.kind), ['text', 'tools', 'text']);
  assert.equal(parts[1].items.length, 2);
  assert.equal(parts[1].items[1].call.cmd, 'python a.py');
});

test('text between two tool calls starts a new group', () => {
  const content = oqr({ tool: 'view', path: 'a' }, { ok: true }) + '\n\nNow editing.\n\n' + oqr({ tool: 'str_replace', path: 'a' }, { ok: true, adds: 1, dels: 1 });
  assert.deepEqual(splitTurn(content).map(p => p.kind), ['tools', 'text', 'tools']);
});

test('tool aliases resolve to the canonical names the transcript knows', () => {
  assert.equal(canonTool('write_file'), 'create_file');
  assert.equal(canonTool('rename_file'), 'move_file');
  assert.equal(canonTool('constructor'), 'constructor');
});

test('calls still being written join the last group or open a new one', () => {
  const parts = splitTurn(oqr({ tool: 'view', path: 'a' }, { ok: true }));
  const live = withLive(parts, [{ index: 0, call: { tool: 'write_file', path: 'b' } }]);
  assert.equal(live.length, 1);
  assert.equal(live[0].items[1].call.tool, 'create_file');
  assert.equal(live[0].items[1].result, null);
  assert.equal(withLive(splitTurn('Just text.'), [{ index: 0, call: { tool: 'bash' } }]).length, 2);
  assert.equal(withLive(parts, []), parts);
});

test('a group is summarised by kind, in a fixed order, with failures counted', () => {
  const items = [
    { call: { tool: 'bash' }, result: { ok: false } },
    { call: { tool: 'view' }, result: { ok: true } },
    { call: { tool: 'bash' }, result: { ok: true } },
    { call: { tool: 'mcp_x_y' }, result: { ok: true } }
  ];
  const { list, failed } = groupCounts(items);
  assert.deepEqual(list, [{ kind: 'command', n: 2 }, { kind: 'read', n: 1 }, { kind: 'tool', n: 1 }]);
  assert.equal(failed, 1);
});

test('file changes add up per path and follow moves and deletes', () => {
  const parts = splitTurn([
    oqr({ tool: 'create_file', path: 'a.py' }, { ok: true, adds: 5, v: 1 }),
    oqr({ tool: 'str_replace', path: 'a.py' }, { ok: true, adds: 2, dels: 1, v: 2 }),
    oqr({ tool: 'create_file', path: 'b.py' }, { ok: false, error: 'nope' }),
    oqr({ tool: 'create_file', path: 'c.py' }, { ok: true, adds: 1, v: 1 }),
    oqr({ tool: 'move_file', path: 'a.py', new_path: 'src/a.py' }, { ok: true }),
    oqr({ tool: 'delete_file', path: 'c.py' }, { ok: true })
  ].join(''));
  const changes = fileChanges(parts);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], { path: 'src/a.py', adds: 7, dels: 1, created: true, v: 2 });
  assert.deepEqual(totals(changes), { adds: 7, dels: 1 });
});

test('a step names what it acted on', () => {
  assert.equal(stepTarget({ tool: 'bash', cmd: 'npm test\necho done' }), 'npm test');
  assert.equal(stepTarget({ tool: 'move_file', path: 'a', new_path: 'b' }), 'a → b');
  assert.equal(stepTarget({ tool: 'search', query: 'x' }), '"x"');
  assert.equal(stepTarget({ tool: 'create_file', partialPath: 'sr' }), 'sr');
});

test('the code screens have their own addresses', () => {
  assert.deepEqual(parseRoute('/code'), { view: 'code', id: null });
  assert.deepEqual(parseRoute('/code/'), { view: 'code', id: null });
  assert.deepEqual(parseRoute('/code/abc'), { view: 'code', id: 'abc' });
  assert.equal(pathForCode('abc'), '/code/abc');
  assert.equal(pathForCode(null), '/code');
  assert.deepEqual(parseRoute('/codes'), { view: 'notfound' });
});