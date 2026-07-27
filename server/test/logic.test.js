import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeKwargs, kwargDefs, applyKwargs, resolveKwargValues, kwargPayload,
  oneShotKwargPayload, controlOf, defaultValueOf, isBoolPair, coerceKwargValue
} from '../lib/kwargs.js';
import { parseTextToolCalls, parseArgs, toCall } from '../tools/index.js';
import { trimInTurn, compactThreshold, estimateTokens, textTokens, makeTokenCounter, truncateForRollingCtx, FALLBACK_CTX } from '../lib/convo.js';
import { scanTools } from '../toolproto.js';
import { isContextOverflowError } from '../lib/llamacpp.js';
import { winTranslate } from '../sandbox.js';

test('kwargs: legacy effort fields migrate', () => {
  const m = { effort_enabled: 1, effort_levels: ['false', 'true'], effort_default: 'false', effort_kwarg: 'enable_thinking' };
  const defs = kwargDefs(m);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].id, 'effort');
  assert.equal(defs[0].name, 'enable_thinking');
  assert.equal(applyKwargs(m, {}, false).resolved_kwargs.chat_template_kwargs.enable_thinking, false);
  assert.equal(applyKwargs(m, { effort: 'true' }, false).resolved_kwargs.chat_template_kwargs.enable_thinking, true);
});

test('kwargs: paired child sends only on match', () => {
  const m = { kwargs: [
    { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
    { id: 'pres', name: 'preserve_thinking', values: ['false', 'true'], visible: false, parentId: 'think',
      rules: [{ when: 'true', value: 'true', send: true }, { when: 'false', value: 'false', send: false }] }
  ] };
  const off = applyKwargs(m, {}, false).resolved_kwargs.chat_template_kwargs;
  assert.equal(off.enable_thinking, false);
  assert.equal('preserve_thinking' in off, false);
  const on = applyKwargs(m, { think: 'true' }, false).resolved_kwargs.chat_template_kwargs;
  assert.equal(on.preserve_thinking, true);
});

test('kwargs: multi-level chains resolve', () => {
  const m = { kwargs: [
    { id: 'a', name: 'a', values: ['false', 'true'], default: 'false' },
    { id: 'b', name: 'b', values: ['false', 'true'], visible: false, parentId: 'a', rules: [{ when: 'true', value: 'true', send: true }] },
    { id: 'c', name: 'c', values: ['0', '1'], visible: false, parentId: 'b', rules: [{ when: 'true', value: '1', send: true }] }
  ] };
  const on = applyKwargs(m, { a: 'true' }, false).resolved_kwargs.chat_template_kwargs;
  assert.deepEqual(on, { a: true, b: true, c: 1 });
  const off = applyKwargs(m, {}, false).resolved_kwargs.chat_template_kwargs;
  assert.deepEqual(off, { a: false });
});

test('kwargs: adminOnly locks non-admins to the default', () => {
  const m = { kwargs: [{ id: 'e', name: 'reasoning_effort', values: ['low', 'medium', 'high'], default: 'medium', adminOnly: true }] };
  assert.equal(applyKwargs(m, { e: 'high' }, false).resolved_kwargs.chat_template_kwargs.reasoning_effort, 'medium');
  assert.equal(applyKwargs(m, { e: 'high' }, true).resolved_kwargs.chat_template_kwargs.reasoning_effort, 'high');
});

test('kwargs: reserved body keys are never injected', () => {
  const m = { kwargs: [{ id: 'x', name: 'messages', values: ['boom'], visible: false, target: 'body' }] };
  assert.deepEqual(applyKwargs(m, {}, true).resolved_kwargs, {});
});

test('kwargs: body target and typing', () => {
  const m = { kwargs: [{ id: 't', name: 'top_k', values: ['40'], visible: false, target: 'body', type: 'number' }] };
  assert.equal(applyKwargs(m, {}, true).resolved_kwargs.top_k, 40);
});

test('kwargs: one-shot uses the cheapest value', () => {
  const m = { kwargs: [{ id: 'e', name: 'reasoning_effort', values: ['low', 'medium', 'high'], default: 'high' }] };
  assert.equal(oneShotKwargPayload(m).chat_template_kwargs.reasoning_effort, 'low');
});

function hasCycle(defs) {
  const byId = new Map(defs.map(d => [d.id, d]));
  for (const start of defs) {
    const seen = new Set([start.id]);
    let cur = start;
    while (cur && cur.parentId) {
      if (seen.has(cur.parentId)) return true;
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }
  return false;
}

test('kwargs: cycles broken and duplicate ids made unique', () => {
  const two = sanitizeKwargs([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }]);
  assert.equal(hasCycle(two), false);
  const three = sanitizeKwargs([{ id: 'a', parentId: 'c' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }]);
  assert.equal(hasCycle(three), false);
  const selfRef = sanitizeKwargs([{ id: 'a', parentId: 'a' }]);
  assert.equal(selfRef[0].parentId, '');
  const missing = sanitizeKwargs([{ id: 'a', parentId: 'ghost' }]);
  assert.equal(missing[0].parentId, '');
  assert.deepEqual(sanitizeKwargs([{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }]).map(d => d.id), ['a', 'a-2']);
});

test('kwargs: resolution terminates on a broken cycle', () => {
  const defs = sanitizeKwargs([
    { id: 'a', name: 'a', values: ['false', 'true'], parentId: 'b', rules: [{ when: 'true', value: 'true', send: true }] },
    { id: 'b', name: 'b', values: ['false', 'true'], parentId: 'a', rules: [{ when: 'true', value: 'true', send: true }] }
  ]);
  const values = resolveKwargValues(defs, {}, true);
  assert.equal(Object.keys(values).length, 2);
  assert.doesNotThrow(() => kwargPayload(defs, values));
});

test('kwargs: control inference and coercion', () => {
  assert.equal(controlOf({ values: ['false', 'true'], control: 'auto' }), 'toggle');
  assert.equal(controlOf({ values: ['low', 'mid', 'high'], control: 'auto' }), 'slider');
  assert.equal(isBoolPair(['true', 'false']), true);
  assert.equal(defaultValueOf({ values: ['false', 'true'], default: '' }), 'false');
  assert.equal(coerceKwargValue('true', 'auto'), true);
  assert.equal(coerceKwargValue('12', 'auto'), 12);
  assert.equal(coerceKwargValue('12', 'string'), '12');
});

test('kwargs: no defs means nothing is sent', () => {
  assert.deepEqual(applyKwargs({}, { anything: 'x' }, true).resolved_kwargs, {});
});

const allow = (n) => ['make_dir', 'create_file', 'bash'].includes(n);

test('text tool calls: qwen xml wrapped', () => {
  const calls = parseTextToolCalls('\n<function=make_dir>\n<parameter=path>\nsrc/main\n</parameter>\n</function>\n', allow);
  assert.deepEqual(calls, [{ name: 'make_dir', argsText: '{"path":"src/main"}' }]);
});

test('text tool calls: hermes json', () => {
  const calls = parseTextToolCalls('{"name":"create_file","arguments":{"path":"a.txt","content":"hi\\nthere"}}', allow);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].argsText), { path: 'a.txt', content: 'hi\nthere' });
});

test('text tool calls: unknown tool is rejected', () => {
  assert.deepEqual(parseTextToolCalls('<function=not_a_tool><parameter=x>1</parameter></function>', allow), []);
});

test('text tool calls: prose is not a call', () => {
  assert.deepEqual(parseTextToolCalls('I would call a function here but cannot.', allow), []);
});

test('text tool calls: multiple in one block', () => {
  const calls = parseTextToolCalls('<function=make_dir><parameter=path>a</parameter></function><function=make_dir><parameter=path>b</parameter></function>', allow);
  assert.equal(calls.length, 2);
});

test('text tool calls: numeric and boolean coercion by key', () => {
  const calls = parseTextToolCalls('<function=bash><parameter=cmd>ls</parameter><parameter=timeout_s>30</parameter></function>', allow);
  assert.deepEqual(JSON.parse(calls[0].argsText), { cmd: 'ls', timeout_s: 30 });
});

test('tool args: partial json survives', () => {
  assert.equal(toCall('bash', '{"cmd":"echo hi"}').tool, 'bash');
  assert.equal(parseArgs('{"cmd":"echo hi"}').cmd, 'echo hi');
});

test('compaction: threshold falls back when context is unknown', () => {
  assert.equal(compactThreshold({ enable_summaries: 0 }, 0), Infinity);
  const t = compactThreshold({ enable_summaries: 1, summary_padding: 0.125 }, 0);
  assert.equal(t, Math.floor(FALLBACK_CTX * 0.875));
  assert.equal(compactThreshold({ enable_summaries: 1, summary_padding: 0.125 }, 4096), 3584);
});

test('compaction: in-turn trim keeps recent tool results', () => {
  const big = 'x'.repeat(2000);
  const inTurn = [
    { role: 'assistant', content: 'a' },
    { role: 'tool', content: big },
    { role: 'tool', content: big },
    { role: 'tool', content: big }
  ];
  const { list, trimmed } = trimInTurn(inTurn, 2);
  assert.equal(trimmed, 1);
  assert.ok(list[1].content.length < 600);
  assert.equal(list[2].content.length, 2000);
  assert.equal(list[3].content.length, 2000);
  assert.equal(list[0].content, 'a');
  assert.equal(trimInTurn(list, 2).trimmed, 0);
});

test('compaction: estimate counts roles and tool calls', () => {
  assert.ok(estimateTokens([{ role: 'user', content: 'hello world' }]) > 0);
  assert.ok(estimateTokens([{ role: 'assistant', content: '', tool_calls: [{ name: 'bash', argsText: '{"cmd":"ls"}' }] }]) > 8);
});

test('llamacpp: overflow errors are recognised', () => {
  assert.equal(isContextOverflowError(new Error('the request exceeds the available context size')), true);
  assert.equal(isContextOverflowError(new Error('context_length_exceeded')), true);
  assert.equal(isContextOverflowError(new Error('Upstream error 500: kv cache is full')), true);
  assert.equal(isContextOverflowError(new Error('connection refused')), false);
});

test('windows: unix idioms are translated', () => {
  assert.equal(winTranslate('mkdir -p src/main/java').cmd, 'mkdir src/main/java');
  assert.equal(winTranslate('rm -rf build').cmd, 'rmdir /s /q build');
  assert.equal(winTranslate('cp -r a b').cmd, 'xcopy /e /i /y a b');
  assert.equal(winTranslate('mv a b').cmd, 'move /y a b');
  assert.equal(winTranslate('cat file.txt').cmd, 'type file.txt');
  assert.equal(winTranslate('which node').cmd, 'where node');
  assert.equal(winTranslate('python3 x.py').cmd, 'python x.py');
});

test('windows: chained segments each translate', () => {
  const r = winTranslate('mkdir -p out && cp -r src out');
  assert.equal(r.cmd, 'mkdir out && xcopy /e /i /y src out');
  assert.equal(r.notes.length, 2);
});

test('windows: arguments are never rewritten', () => {
  assert.equal(winTranslate('gradle build --info').cmd, 'gradle build --info');
  assert.equal(winTranslate('echo please rm -rf nothing').cmd, 'echo please rm -rf nothing');
  assert.equal(winTranslate('node scripts/cp.js').cmd, 'node scripts/cp.js');
  assert.equal(winTranslate('').cmd, '');
  assert.equal(winTranslate(null).cmd, '');
});

test('windows: untouched commands report no notes', () => {
  assert.equal(winTranslate('npm install').notes.length, 0);
  assert.equal(winTranslate('mkdir out').notes.length, 0);
});

test('rolling ctx: fits under budget returns the list untouched', () => {
  const msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }];
  const r = truncateForRollingCtx('c1', msgs, 8192);
  assert.equal(r.msgs, msgs);
  assert.equal(r.dropped, 0);
  assert.equal(r.trimmed, false);
});

test('rolling ctx: drops oldest non-system turns first and keeps every system message', () => {
  const msgs = [
    { role: 'system', content: 'S'.repeat(100) },
    { role: 'user', content: 'a'.repeat(6000) },
    { role: 'assistant', content: 'b'.repeat(6000) },
    { role: 'user', content: 'c'.repeat(600) }
  ];
  const r = truncateForRollingCtx('c2', msgs, 2048);
  assert.ok(r.dropped > 0);
  assert.equal(r.msgs.filter(m => m.role === 'system').length, 1);
  assert.equal(r.msgs[r.msgs.length - 1].content, 'c'.repeat(600));
  assert.ok(r.msgs.length < msgs.length);
});

test('rolling ctx: a single oversized turn is trimmed rather than dropped', () => {
  const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'x'.repeat(200000) }];
  const r = truncateForRollingCtx('c3', msgs, 2048);
  assert.equal(r.dropped, 0);
  assert.equal(r.trimmed, true);
  assert.equal(r.msgs.length, 2);
  assert.ok(r.msgs[1].content.length < 200000);
});

test('token counter: chunked adds match a whole-string estimate', () => {
  const text = 'hello world '.repeat(120) + '日本語のテキスト'.repeat(40) + '한국어';
  const counter = makeTokenCounter();
  for (let i = 0; i < text.length; i += 7) counter.add(text.slice(i, i + 7));
  assert.equal(counter.tokens, textTokens(text));
  const empty = makeTokenCounter();
  empty.add('');
  assert.equal(empty.tokens, 0);
});

test('token estimates are stable across repeat calls on long strings', () => {
  const long = 'word '.repeat(500);
  const first = textTokens(long);
  assert.equal(textTokens(long), first);
  assert.equal(estimateTokens([{ role: 'user', content: long }]), first + 4);
});

test('scanTools: prose is never mistaken for a call, real calls still parse', () => {
  assert.deepEqual(scanTools('just some prose with <angle> and [square] bits'), { calls: [], live: null });
  assert.deepEqual(scanTools(''), { calls: [], live: null });
  const parsed = scanTools('<tool bash>\ncmd: ls -la\n</tool>');
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].call.tool, 'bash');
  assert.equal(parsed.calls[0].call.cmd, 'ls -la');
  const live = scanTools('<tool create_file>\npath: a.txt\n<CONTENT>\npartial').live;
  assert.equal(live.tool, 'create_file');
  assert.equal(live.path, 'a.txt');
});
