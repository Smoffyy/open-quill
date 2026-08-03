import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeKwargs, kwargDefs, applyKwargs, resolveKwargValues, kwargPayload,
  oneShotKwargPayload, controlOf, defaultValueOf, isBoolPair, coerceKwargValue,
  isRange, clampToRange, normalizeKwarg, gateOpen, kwargVisible
} from '../lib/kwargs.js';
import { parseTextToolCalls, parseArgs, toCall, cutOffOf } from '../tools/index.js';
import { classifyToolError } from '../lib/toolstats.js';
import { cutOffError } from '../lib/prompts.js';
import { makeToolTextFilter, makeEmitter } from '../llm/emitter.js';
import { trimInTurn, compactThreshold, estimateTokens, textTokens, makeTokenCounter, truncateForRollingCtx, FALLBACK_CTX } from '../lib/convo.js';
import { scanTools } from '../toolproto.js';
import { isContextOverflowError } from '../lib/llamacpp.js';
import { winTranslate } from '../sandbox.js';
import { screenCommand, normalizeRel } from '../lib/sandboxguard.js';
import { resolveToolName, makeToolResolver, nearestTool, SANDBOX_TOOLS } from '../tools/aliases.js';
import { isPrivateAddress, hostAllowed } from '../lib/egress.js';
import { resolveRouted, ruleMatches, routerRules, modelLabel } from '../lib/router.js';
import { preferredChild } from '../lib/tree.js';
import { samplingParams, parseStop } from '../llm/sampling.js';
import { PROVIDER_TYPES } from '../providers.js';
import { slideWithCounter, trimMode } from '../lib/ctxwindow.js';

test('kwargs: legacy effort fields migrate', () => {
  const m = { effort_enabled: 1, effort_levels: ['false', 'true'], effort_default: 'false', effort_kwarg: 'enable_thinking' };
  const defs = kwargDefs(m);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].id, 'effort');
  assert.equal(defs[0].name, 'enable_thinking');
  assert.equal(applyKwargs(m, {}, false).resolved_kwargs.chat_template_kwargs.enable_thinking, false);
  assert.equal(applyKwargs(m, { effort: 'true' }, false).resolved_kwargs.chat_template_kwargs.enable_thinking, true);
});

test('kwargs: a min and a max make a range, and the range owns the value list', () => {
  const d = normalizeKwarg({ id: 'b', name: 'reasoning_budget', min: 0, max: 4096, step: 128, values: ['1', '2'], default: '512' });
  assert.equal(isRange(d), true);
  assert.equal(controlOf(d), 'range');
  assert.deepEqual(d.values, [], 'an enumerated list alongside a range would be a second source of truth');
  assert.equal(d.default, '512');
  assert.equal(d.step, 128);

  const plain = normalizeKwarg({ id: 'p', name: 'x', values: ['low', 'high'] });
  assert.equal(isRange(plain), false);
  assert.equal(plain.min, null);
  assert.equal(plain.max, null);
});

test('kwargs: a range with no usable bounds falls back to a value list', () => {
  for (const bad of [{ min: 5, max: 5 }, { min: 10, max: 2 }, { min: 0 }, { max: 10 }, { min: 'a', max: 'b' }]) {
    const d = normalizeKwarg({ id: 'k', name: 'x', values: ['low', 'high'], ...bad });
    assert.equal(isRange(d), false, JSON.stringify(bad));
    assert.deepEqual(d.values, ['low', 'high'], 'the list survives when the range is unusable');
  }
});

test('kwargs: a range value is clamped and snapped to the step', () => {
  const d = normalizeKwarg({ id: 'b', name: 'budget', min: 0, max: 1000, step: 100 });
  assert.equal(clampToRange(d, 250), 300);
  assert.equal(clampToRange(d, -50), 0, 'below the minimum clamps up');
  assert.equal(clampToRange(d, 99999), 1000, 'above the maximum clamps down');
  assert.equal(clampToRange(d, 'nonsense'), null);

  const off = normalizeKwarg({ id: 'o', name: 'x', min: 5, max: 100, step: 10 });
  assert.equal(clampToRange(off, 6), 5, 'steps are measured from the minimum, not from zero');
  assert.equal(clampToRange(off, 100), 100, 'the maximum stays reachable when it is off the step grid');

  // Snapping alone would round 2048 down to 2000, so the value under the slider
  // could never reach the maximum printed at the end of its own track.
  const odd = normalizeKwarg({ id: 'x', name: 'x', min: 0, max: 2048, step: 100 });
  assert.equal(clampToRange(odd, 2048), 2048);
  assert.equal(clampToRange(odd, 99999), 2048);
  assert.equal(clampToRange(odd, 2000), 2000);
  assert.equal(clampToRange(odd, 1250), 1300, 'everything between the ends still snaps');

  const frac = normalizeKwarg({ id: 'f', name: 'temp', min: 0, max: 2, step: 0.1 });
  assert.equal(clampToRange(frac, 0.30000000000000004), 0.3, 'float dust is rounded away');
});

test('kwargs: a hand-edited request cannot escape the range the admin set', () => {
  const m = { kwargs: [{ id: 'b', name: 'reasoning_budget', target: 'extra_body', type: 'number', min: 0, max: 2048, step: 256, default: '512' }] };
  const body = (req) => applyKwargs(m, req, false).resolved_kwargs.extra_body.reasoning_budget;
  assert.equal(body({}), 512, 'the default is used when nothing is asked for');
  assert.equal(body({ b: '1024' }), 1024);
  assert.equal(body({ b: '999999' }), 2048, 'over the maximum is clamped to the maximum, not rejected');
  assert.equal(body({ b: '-5' }), 0);
  assert.equal(body({ b: '600' }), 512, 'snapped to the nearest step');
  assert.equal(body({ b: 'drop table' }), 512, 'junk falls back to the default');
  assert.equal(typeof body({ b: '1024' }), 'number', 'it lands in extra_body as a number');
});

test('kwargs: a hidden range still sends its default, and an admin-only one ignores the user', () => {
  const hidden = { kwargs: [{ id: 'b', name: 'budget', min: 0, max: 100, step: 10, default: '40', visible: false }] };
  assert.equal(applyKwargs(hidden, { b: '90' }, false).resolved_kwargs.chat_template_kwargs.budget, 40);

  const silent = { kwargs: [{ id: 'b', name: 'budget', min: 0, max: 100, default: '40', visible: false, sendWhenHidden: false }] };
  assert.deepEqual(applyKwargs(silent, {}, false).resolved_kwargs, {}, 'hidden and not sent means nothing goes out');

  const adminOnly = { kwargs: [{ id: 'b', name: 'budget', min: 0, max: 100, step: 10, default: '40', adminOnly: true }] };
  assert.equal(applyKwargs(adminOnly, { b: '90' }, false).resolved_kwargs.chat_template_kwargs.budget, 40);
  assert.equal(applyKwargs(adminOnly, { b: '90' }, true).resolved_kwargs.chat_template_kwargs.budget, 90);
});

test('kwargs: a range default outside its own bounds is corrected on save', () => {
  const d = normalizeKwarg({ id: 'b', name: 'x', min: 10, max: 20, step: 1, default: '999' });
  assert.equal(d.default, '20');
  const none = normalizeKwarg({ id: 'b', name: 'x', min: 10, max: 20, step: 1, default: '' });
  assert.equal(defaultValueOf(none), '10', 'no default starts at the minimum');
});

test('kwargs: a gated kwarg keeps its own value but hides until the gate opens', () => {
  const kwargs = [
    { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
    { id: 'budget', name: 'thinking_budget_tokens', target: 'body', type: 'number',
      min: 1024, max: 8192, step: 1024, default: '1024', showIf: { id: 'think', value: 'true' } }
  ];
  const defs = sanitizeKwargs(kwargs);

  const off = resolveKwargValues(defs, {}, false);
  assert.equal(gateOpen(defs, off, defs[1]), false);
  assert.equal(kwargVisible(defs, off, defs[1]), false);
  assert.equal(off.budget, '1024', 'the value survives while hidden, it is only the control that goes');

  const on = resolveKwargValues(defs, { think: 'true', budget: '4096' }, false);
  assert.equal(gateOpen(defs, on, defs[1]), true);
  assert.equal(kwargVisible(defs, on, defs[1]), true);
  assert.equal(kwargPayload(defs, on).thinking_budget_tokens, 4096);
});

test('kwargs: a closed gate is a kind of hidden, so sendWhenHidden decides', () => {
  const mk = (send) => sanitizeKwargs([
    { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
    { id: 'budget', name: 'thinking_budget_tokens', target: 'body', type: 'number',
      min: 1024, max: 8192, step: 1024, default: '1024', sendWhenHidden: send,
      showIf: { id: 'think', value: 'true' } }
  ]);

  const kept = mk(true);
  assert.equal(kwargPayload(kept, resolveKwargValues(kept, {}, false)).thinking_budget_tokens, 1024);

  const dropped = mk(false);
  const shut = kwargPayload(dropped, resolveKwargValues(dropped, {}, false));
  assert.equal('thinking_budget_tokens' in shut, false, 'gate shut and set not to send means it is left out');
  const open = kwargPayload(dropped, resolveKwargValues(dropped, { think: 'true' }, false));
  assert.equal(open.thinking_budget_tokens, 1024, 'and it comes back when the gate opens');
});

test('kwargs: a gate pointing at itself or at nothing is dropped', () => {
  const defs = sanitizeKwargs([
    { id: 'a', name: 'a', values: ['1', '2'], showIf: { id: 'a', value: '1' } },
    { id: 'b', name: 'b', values: ['1', '2'], showIf: { id: 'ghost', value: '1' } },
    { id: 'c', name: 'c', values: ['1', '2'], showIf: { id: 'a', value: '2' } }
  ]);
  assert.equal(defs[0].showIf, null, 'self-reference');
  assert.equal(defs[1].showIf, null, 'unknown id');
  assert.deepEqual(defs[2].showIf, { id: 'a', value: '2' }, 'a real reference survives');
});

test('kwargs: an ungated kwarg is always visible', () => {
  const defs = sanitizeKwargs([{ id: 'a', name: 'a', values: ['1', '2'] }]);
  assert.equal(gateOpen(defs, {}, defs[0]), true);
  assert.equal(kwargVisible(defs, {}, defs[0]), true);
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

test('tool args: unterminated json keeps the closed keys', () => {
  assert.equal(parseArgs('{"path":"a.txt","content":"unterminated').path, 'a.txt');
  assert.equal(parseArgs('Sure: {"path":"a.txt"} done').path, 'a.txt');
  assert.equal(parseArgs('```json\n{"path":"a.txt"}\n```').path, 'a.txt');
});

test('tool args: nested arguments wrapper is unwrapped', () => {
  assert.equal(parseArgs('{"arguments":{"path":"b.txt"}}').path, 'b.txt');
  assert.deepEqual(parseArgs('not json at all'), {});
  assert.equal(toCall('bash', 'garbage {{{').tool, 'bash');
});

test('text tool calls: imitation history marker is recovered', () => {
  const calls = parseTextToolCalls('[used create_file]\n<parameter=path>a.txt</parameter>\n<parameter=content>hi</parameter>', allow);
  assert.deepEqual(calls, [{ name: 'create_file', argsText: '{"path":"a.txt","content":"hi"}' }]);
});

test('text tool calls: missing closing tags still parse', () => {
  const calls = parseTextToolCalls('<function=create_file><parameter=path>a.txt</parameter><parameter=content>body', allow);
  assert.deepEqual(JSON.parse(calls[0].argsText), { path: 'a.txt', content: 'body' });
});

test('text tool calls: bare parameters recover the name from the hint', () => {
  const calls = parseTextToolCalls('<parameter=path>a.txt</parameter>', allow, 'create_file');
  assert.deepEqual(calls, [{ name: 'create_file', argsText: '{"path":"a.txt"}' }]);
});

test('text tool calls: python style call is recovered', () => {
  const calls = parseTextToolCalls('functions.bash({"cmd":"ls -la"})', allow);
  assert.deepEqual(calls, [{ name: 'bash', argsText: '{"cmd":"ls -la"}' }]);
});

test('text tool calls: openai style tool_calls wrapper', () => {
  const calls = parseTextToolCalls('{"tool_calls":[{"function":{"name":"bash","arguments":"{\\"cmd\\":\\"ls\\"}"}}]}', allow);
  assert.deepEqual(calls, [{ name: 'bash', argsText: '{"cmd":"ls"}' }]);
});

test('tool text filter: malformed block becomes a call, prose is untouched', () => {
  const run = (input, size) => {
    let text = '';
    const calls = [];
    const f = makeToolTextFilter(t => { text += t; }, cs => { calls.push(...cs); }, allow);
    for (let i = 0; i < input.length; i += size) f.feed(input.slice(i, i + size));
    f.flush();
    return { text, calls };
  };
  const bad = 'Sure.\n[used create_file]\n<parameter=path>a.txt</parameter>\n<parameter=content>hi</parameter>\nDone!';
  for (const size of [1, 5, 4096]) {
    const r = run(bad, size);
    assert.equal(r.calls.length, 1);
    assert.deepEqual(JSON.parse(r.calls[0].argsText), { path: 'a.txt', content: 'hi' });
    assert.equal(r.text, 'Sure.\nDone!');
    const p = run('Compare a < b, list[0] and [used] in prose.', size);
    assert.deepEqual(p.calls, []);
    assert.equal(p.text, 'Compare a < b, list[0] and [used] in prose.');
  }
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
  // mkdir -p src/main/java also has its forward slashes fixed: cmd.exe's own mkdir
  // reads a bare "/" as a switch, so the unpatched output would fail outright.
  assert.equal(winTranslate('mkdir -p src/main/java').cmd, 'mkdir src\\main\\java');
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

test('windows: arguments to ordinary programs are never rewritten', () => {
  assert.equal(winTranslate('gradle build --info').cmd, 'gradle build --info');
  assert.equal(winTranslate('echo please rm -rf nothing').cmd, 'echo please rm -rf nothing');
  assert.equal(winTranslate('node scripts/cp.js').cmd, 'node scripts/cp.js');
  assert.equal(winTranslate('python src/app.py').cmd, 'python src/app.py');
  assert.equal(winTranslate('').cmd, '');
  assert.equal(winTranslate(null).cmd, '');
});

test('windows: untouched commands report no notes', () => {
  assert.equal(winTranslate('npm install').notes.length, 0);
  assert.equal(winTranslate('mkdir out').notes.length, 0);
});

test('windows: forward slashes in cmd.exe builtin path arguments become backslashes', () => {
  // mkdir a/b is parsed by cmd.exe as "mkdir a" plus a bogus "/b" switch and fails
  // with "The syntax of the command is incorrect." — this is the actual reported bug.
  assert.equal(winTranslate('mkdir a/b/c').cmd, 'mkdir a\\b\\c');
  assert.equal(winTranslate('rmdir /s /q old/stuff').cmd, 'rmdir /s /q old\\stuff');
  assert.equal(winTranslate('del /q /f a/b.txt').cmd, 'del /q /f a\\b.txt');
  assert.equal(winTranslate('copy src/a.txt dst/b.txt').cmd, 'copy src\\a.txt dst\\b.txt');
  assert.equal(winTranslate('dir /s /b src/main').cmd, 'dir /s /b src\\main');
  assert.equal(winTranslate('type src/a.txt').cmd, 'type src\\a.txt');
  assert.equal(winTranslate('MKDIR a/b').cmd, 'MKDIR a\\b', 'the builtin name is matched case-insensitively');
});

test('windows: real switches on slash-sensitive builtins survive untouched', () => {
  const r = winTranslate('xcopy /e /i /y src/a dst/b');
  assert.equal(r.cmd, 'xcopy /e /i /y src\\a dst\\b', '/e /i /y are flags, not paths, and must not be turned into backslashes');
});

test('windows: quoted paths with spaces are slash-fixed inside the quotes', () => {
  assert.equal(winTranslate('mkdir "my folder/sub"').cmd, 'mkdir "my folder\\sub"');
});

test('windows: cd is deliberately excluded from the slash fix', () => {
  // cmd.exe's cd/chdir hands the path straight to SetCurrentDirectoryW and accepts
  // forward slashes fine, unlike mkdir/del/copy/etc. Rewriting it would be a no-op
  // at best; this test exists so nobody "completes" the SLASH_SENSITIVE set later
  // without re-checking that cd actually needs it.
  assert.equal(winTranslate('cd src/main').cmd, 'cd src/main');
});

test('windows: the slash fix reports a note, same as every other auto-correction', () => {
  const r = winTranslate('mkdir a/b');
  assert.equal(r.notes.length, 1);
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

test('preferredChild: descending keeps the active branch instead of the newest sibling', () => {
  const kids = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(preferredChild(kids, new Set(['b'])).id, 'b');
  assert.equal(preferredChild(kids, new Set(['a'])).id, 'a');
  assert.equal(preferredChild(kids, new Set(['zz'])).id, 'c');
  assert.equal(preferredChild(kids, new Set()).id, 'c');
  assert.equal(preferredChild(kids, null).id, 'c');
  assert.equal(preferredChild([], new Set(['a'])), null);
  assert.equal(preferredChild(undefined, new Set(['a'])), null);
});

test('egress: private and loopback addresses are reachable', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '172.31.255.254', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('egress: public addresses are not reachable', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '100.128.0.1', '93.184.216.34', '2606:4700::1111', 'not-an-ip', '']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('egress allowlist matches hosts and subdomains without suffix confusion', () => {
  const list = ['api.openai.com', '*.anthropic.com'];
  assert.equal(hostAllowed('api.openai.com', list), true);
  assert.equal(hostAllowed('API.OpenAI.com', list), true);
  assert.equal(hostAllowed('api.anthropic.com', list), true);
  assert.equal(hostAllowed('anthropic.com', list), true);
  assert.equal(hostAllowed('anthropic.com.evil.com', list), false);
  assert.equal(hostAllowed('notanthropic.com', list), false);
  assert.equal(hostAllowed('example.com', list), false);
  assert.equal(hostAllowed('', list), false);
});

const RT_MODELS = {
  hub: { id: 'hub', name: 'Hub', kind: 'router', router_default: 'small', router_rules: [
    { match: 'hasImage', value: '', modelId: 'vision', label: 'images' },
    { match: 'hasCode', value: '', modelId: 'coder', label: 'code' },
    { match: 'keyword', value: 'translate, traducir', modelId: 'trans', label: 'translation' },
    { match: 'longerThan', value: '500', modelId: 'big', label: 'long' },
  ] },
  small: { id: 'small', name: 'Small' }, vision: { id: 'vision', name: 'Vision' },
  coder: { id: 'coder', name: 'Coder' }, trans: { id: 'trans', name: 'Trans' }, big: { id: 'big', name: 'Big' },
  loopA: { id: 'loopA', name: 'A', kind: 'router', router_default: 'loopB', router_rules: [] },
  loopB: { id: 'loopB', name: 'B', kind: 'router', router_default: 'loopA', router_rules: [] },
  orphan: { id: 'orphan', name: 'Orphan', kind: 'router', router_default: '', router_rules: [] },
};
const rtGet = (id) => RT_MODELS[id] || null;
const rtGo = (hub, text, atts) => resolveRouted(RT_MODELS[hub], [{ role: 'user', content: text }], atts, rtGet);

test('router picks the first matching rule and falls back otherwise', () => {
  assert.equal(rtGo('hub', 'hi there').model.name, 'Small');
  assert.equal(rtGo('hub', 'fix this ```js\nconst a=1```').model.name, 'Coder');
  assert.equal(rtGo('hub', 'please translate this').model.name, 'Trans');
  assert.equal(rtGo('hub', 'x'.repeat(600)).model.name, 'Big');
  assert.equal(rtGo('hub', 'what is this', [{ mime: 'image/png' }]).model.name, 'Vision');
});

test('router refuses loops and missing fallbacks instead of guessing', () => {
  const loop = rtGo('loopA', 'hi');
  assert.equal(loop.model, null);
  assert.match(loop.routed.error, /loop/i);
  const orphan = rtGo('orphan', 'hi');
  assert.equal(orphan.model, null);
});

test('non-router models pass straight through', () => {
  const r = resolveRouted(RT_MODELS.small, [{ role: 'user', content: 'hi' }], [], rtGet);
  assert.equal(r.model.name, 'Small');
  assert.equal(r.routed, null);
});

test('router rules reject entries without a target and cap bad matchers', () => {
  const rules = routerRules({ router_rules: [{ match: 'nonsense', value: 'x', modelId: 'a' }, { match: 'keyword', value: 'y' }] });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].match, 'keyword');
});

test('a broken regex rule does not throw', () => {
  assert.equal(ruleMatches({ match: 'regex', value: '([' }, { text: 'abc', lower: 'abc', length: 3 }), false);
});

test('routed payload carries real model names, not undefined', () => {
  const hub = { id: 'h', display_name: 'Hub', kind: 'router', router_default: 'target', router_rules: [] };
  const target = { id: 'target', display_name: 'Target' };
  const r = resolveRouted(hub, [{ role: 'user', content: 'hi' }], [], (id) => (id === 'target' ? target : null));
  assert.equal(r.model.id, 'target');
  assert.equal(r.routed.hubName, 'Hub');
  assert.equal(r.routed.modelName, 'Target');
  assert.equal(r.routed.hops[0].toName, 'Target');
  const dead = resolveRouted({ id: 'h2', display_name: 'Orphan', kind: 'router', router_default: '', router_rules: [] }, [{ role: 'user', content: 'x' }], [], () => null);
  assert.equal(dead.model, null);
  assert.equal(dead.routed.hubName, 'Orphan');
});

test('modelLabel falls back through the name fields a row may carry', () => {
  assert.equal(modelLabel({ display_name: 'A', name: 'B', internal_name: 'C', id: 'D' }), 'A');
  assert.equal(modelLabel({ name: 'B', internal_name: 'C', id: 'D' }), 'B');
  assert.equal(modelLabel({ internal_name: 'C', id: 'D' }), 'C');
  assert.equal(modelLabel({ id: 'D' }), 'D');
  assert.equal(modelLabel(null), '');
});

test('egress: only the reserved slices of 192.0/16 count as private', () => {
  for (const ip of ['192.0.0.1', '192.0.0.255', '192.0.2.1', '192.0.2.254']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['192.0.1.1', '192.0.3.1', '192.0.77.9', '192.0.255.255']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('stop sequences: split, trimmed, deduped and capped per provider', () => {
  assert.deepEqual(parseStop('</s>\n  <|im_end|>  \n\n</s>\nEND', 8), ['</s>', '<|im_end|>', 'END']);
  assert.deepEqual(parseStop('a\nb\nc\nd\ne\nf', 4), ['a', 'b', 'c', 'd']);
  assert.deepEqual(parseStop('', 8), []);
  assert.deepEqual(parseStop(null, 8), []);
  assert.deepEqual(parseStop(['x', ' y ', 'x'], 8), ['x', 'y']);
});

test('samplingParams: stop is sent as a list, capped by the provider', () => {
  const six = 'a\nb\nc\nd\ne\nf';
  assert.deepEqual(samplingParams({ stop: six }, PROVIDER_TYPES.llamacpp).stop, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(samplingParams({ stop: six }, PROVIDER_TYPES.openai).stop, ['a', 'b', 'c', 'd']);
  assert.equal('stop' in samplingParams({ stop: '' }, PROVIDER_TYPES.llamacpp), false);
  assert.equal('stop' in samplingParams({ stop: '   \n  ' }, PROVIDER_TYPES.llamacpp), false);
  assert.equal('stop' in samplingParams({ stop: 'x' }, PROVIDER_TYPES.moonshot), true);
});

test('samplingParams: llama.cpp samplers pass through, unsupported ones are dropped', () => {
  const m = { temperature: 0.7, dry_multiplier: 0.8, dry_allowed_length: 2, xtc_probability: 0.5, mirostat: 2, repetition_penalty: 1.1 };
  const llama = samplingParams(m, PROVIDER_TYPES.llamacpp);
  assert.equal(llama.dry_multiplier, 0.8);
  assert.equal(llama.dry_allowed_length, 2);
  assert.equal(llama.xtc_probability, 0.5);
  assert.equal(llama.mirostat, 2);
  assert.equal(llama.repeat_penalty, 1.1);
  assert.equal('repetition_penalty' in llama, false);
  const oai = samplingParams(m, PROVIDER_TYPES.openai);
  assert.equal(oai.temperature, 0.7);
  for (const k of ['dry_multiplier', 'dry_allowed_length', 'xtc_probability', 'mirostat', 'repetition_penalty', 'repeat_penalty']) {
    assert.equal(k in oai, false, k);
  }
});

test('trimMode only opts in on the exact value', () => {
  assert.equal(trimMode({ ctx_trim_mode: 'cache' }), 'cache');
  assert.equal(trimMode({ ctx_trim_mode: 'retain' }), 'retain');
  assert.equal(trimMode({}), 'retain');
  assert.equal(trimMode(null), 'retain');
});

const stubCount = (list) => list.reduce((n, m) => n + Math.ceil(String(m.content || '').length / 4) + 4, 0);
const convo = (turns) => {
  const out = [{ role: 'system', content: 'S'.repeat(200) }];
  for (let i = 0; i < turns; i++) {
    out.push({ role: 'user', content: `u${i} ` + 'x'.repeat(400) });
    out.push({ role: 'assistant', content: `a${i} ` + 'y'.repeat(400) });
  }
  return out;
};

test('slideWithCounter: cache mode drops past what is needed, retain mode does not', async () => {
  const msgs = convo(40);
  const budget = 4000;
  const retain = await slideWithCounter(stubCount, msgs, budget, { mode: 'retain' });
  const cache = await slideWithCounter(stubCount, msgs, budget, { mode: 'cache' });
  assert.ok(retain.tokens <= budget);
  assert.ok(cache.tokens <= budget);
  assert.ok(cache.tokens <= retain.tokens, `cache ${cache.tokens} should not exceed retain ${retain.tokens}`);
  assert.ok(cache.dropped > retain.dropped, `cache ${cache.dropped} should exceed retain ${retain.dropped}`);
});

const firstKept = (r) => {
  const m = r.msgs.find(x => x.role !== 'system');
  const hit = String(m && m.content || '').match(/\b([ua]\d+)\b/);
  return hit ? hit[1] : 'none';
};

test('slideWithCounter: cache mode holds the prefix still while retain mode moves it every turn', async () => {
  const budget = 4000;
  const retainHeads = new Set();
  const cacheHeads = new Set();
  for (let turns = 40; turns < 46; turns++) {
    const msgs = convo(turns);
    retainHeads.add(firstKept(await slideWithCounter(stubCount, msgs, budget, { mode: 'retain' })));
    cacheHeads.add(firstKept(await slideWithCounter(stubCount, msgs, budget, { mode: 'cache' })));
  }
  assert.equal(retainHeads.size, 6, 'retain mode should move the boundary on every single turn');
  assert.ok(cacheHeads.size <= 2, `cache mode moved the boundary ${cacheHeads.size} times over six turns`);
});

test('slideWithCounter: the cache boundary does move once the slack is used up', async () => {
  const budget = 4000;
  const heads = new Set();
  for (let turns = 40; turns < 70; turns++) {
    heads.add(firstKept(await slideWithCounter(stubCount, convo(turns), budget, { mode: 'cache' })));
  }
  assert.ok(heads.size > 1, 'cache mode must still slide, just less often');
});

test('slideWithCounter: an unreachable cache target still yields a prompt that fits', async () => {
  const msgs = convo(3);
  const budget = 420;
  const r = await slideWithCounter(stubCount, msgs, budget, { mode: 'cache' });
  assert.ok(r.tokens > 0);
  assert.ok(r.tokens <= budget, `${r.tokens} > ${budget}`);
});

test('slideWithCounter: a prompt already inside the budget is left alone in both modes', async () => {
  const msgs = convo(2);
  const total = stubCount(msgs);
  for (const mode of ['retain', 'cache']) {
    const r = await slideWithCounter(stubCount, msgs, total + 500, { mode });
    assert.equal(r.dropped, 0, mode);
    assert.equal(r.trimmed, false, mode);
    assert.equal(r.msgs, msgs, mode);
  }
});

test('sandbox guard: ordinary build and run commands are not blocked', () => {
  const ok = [
    'npm install express', 'node app.js', 'python sum.py nums.txt',
    'pip install -r requirements.txt', 'cd src && node index.js',
    'git init && git add -A', 'npm run build --silent',
    'sed -i s/a/b/g file.txt', 'curl https://example.com/x -o out.html',
    'mkdir -p src/utils', 'cargo build --release', 'echo hi > out.txt',
    'node test.js 2>/dev/null', './gradlew build', 'tar -czf out.tgz src',
    'npx tsc --outDir dist', 'python -c "print(1/2)"'
  ];
  for (const cmd of ok) assert.equal(screenCommand(cmd).ok, true, cmd);
});

test('sandbox guard: paths outside the workspace are refused', () => {
  const bad = [
    'cat /etc/passwd', 'cd /', 'rm -rf /', 'cp ~/.ssh/id_rsa .',
    'node ../../evil.js', 'cd ../../..', 'echo x > /usr/local/bin/y',
    'type C:\\Windows\\System32\\drivers\\etc\\hosts', 'dir \\\\server\\share'
  ];
  for (const cmd of bad) assert.equal(screenCommand(cmd).ok, false, cmd);
});

test('sandbox guard: host administration commands are refused', () => {
  const bad = ['sudo apt-get install nginx', 'systemctl restart nginx', 'reg add HKLM\\x', 'docker run -it x', 'ssh user@host', 'apt install foo', 'shutdown /s'];
  for (const cmd of bad) assert.equal(screenCommand(cmd).ok, false, cmd);
});

test('sandbox guard: cd escapes are judged against the current depth', () => {
  assert.equal(screenCommand('cd ..', 'src/utils').ok, true);
  assert.equal(screenCommand('cd ../..', 'src/utils').ok, true);
  assert.equal(screenCommand('cd ../../..', 'src/utils').ok, false);
  assert.equal(screenCommand('cd ..', '').ok, false);
});

test('sandbox guard: refusals explain the boundary rather than just failing', () => {
  const r = screenCommand('cat /etc/passwd');
  assert.match(r.error, /relative/i);
  assert.match(r.error, /workspace/i);
});

test('normalizeRel: forgiving where intent is clear, strict where it is not', () => {
  assert.equal(normalizeRel('src/app.py').rel, 'src/app.py');
  assert.equal(normalizeRel('/notes.md').rel, 'notes.md');
  assert.equal(normalizeRel('./x/../y.txt').rel, 'y.txt');
  assert.equal(normalizeRel('a\\b\\c.txt').rel, 'a/b/c.txt');
  assert.equal(normalizeRel('"quoted.txt"').rel, 'quoted.txt');
  for (const bad of ['C:/x', 'C:\\Windows\\x', '~/a', '../x', '//server/share', '/etc/passwd', '']) {
    assert.equal(normalizeRel(bad).ok, false, bad);
  }
});

test('normalizeRel: an empty path is only allowed when the caller opts in', () => {
  assert.equal(normalizeRel('', { allowEmpty: true }).rel, '');
  assert.equal(normalizeRel('.', { allowEmpty: true }).rel, '');
  assert.equal(normalizeRel('').ok, false);
});

test('tool aliases: common wrong names resolve to the real tool', () => {
  assert.equal(resolveToolName('write_file'), 'create_file');
  assert.equal(resolveToolName('str_replace_editor'), 'str_replace');
  assert.equal(resolveToolName('read_file'), 'view');
  assert.equal(resolveToolName('run_terminal_cmd'), 'bash');
  assert.equal(resolveToolName('functions.write_to_file'), 'create_file');
  assert.equal(resolveToolName('create_file'), 'create_file');
});

test('tool aliases: bare English words only resolve in loose mode', () => {
  for (const w of ['read', 'list', 'copy', 'type', 'delete', 'open']) {
    assert.equal(resolveToolName(w), null, w);
    assert.ok(resolveToolName(w, true), w);
  }
});

test('tool aliases: unknown names never resolve', () => {
  for (const n of ['browse_web', 'send_email', '', null]) assert.equal(resolveToolName(n, true), null);
});

test('tool resolver: only maps onto tools that are actually enabled', () => {
  const resolve = makeToolResolver(['create_file', 'view']);
  assert.equal(resolve('write_file'), 'create_file');
  assert.equal(resolve('view'), 'view');
  assert.equal(resolve('bash'), null);
  assert.equal(resolve('run_terminal_cmd'), null);
});

test('tool resolver: an exact name always wins over an alias', () => {
  const resolve = makeToolResolver(['write_file', 'create_file']);
  assert.equal(resolve('write_file'), 'write_file');
});

test('tool resolver: no enabled tools means no resolver at all', () => {
  assert.equal(makeToolResolver([]), null);
});

test('nearestTool suggests a fix for a typo but not for nonsense', () => {
  assert.equal(nearestTool('creat_file'), 'create_file');
  assert.equal(nearestTool('lst_files'), 'list_files');
  assert.equal(nearestTool('send_email_to_bob'), null);
});

test('text tool calls resolve aliases through the enabled set', () => {
  const resolve = makeToolResolver(['create_file']);
  const calls = parseTextToolCalls('<function=write_file><parameter=path>a.txt</parameter><parameter=content>hi</parameter></function>', resolve);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'create_file');
  assert.deepEqual(JSON.parse(calls[0].argsText), { path: 'a.txt', content: 'hi' });
});

test('text tool calls still reject names that are not enabled at all', () => {
  const resolve = makeToolResolver(['view']);
  assert.equal(parseTextToolCalls('<function=send_email><parameter=to>x</parameter></function>', resolve).length, 0);
});

test('every sandbox tool name is unique and resolves to itself', () => {
  assert.equal(new Set(SANDBOX_TOOLS).size, SANDBOX_TOOLS.length);
  for (const t of SANDBOX_TOOLS) assert.equal(resolveToolName(t), t);
});

// --- truncated tool calls -------------------------------------------------

test('a tool call cut off mid-argument is reported, not silently emptied', () => {
  const call = toCall('create_file', '{"path": "oe_enderium.json", "content": "{\\n  \\"parent\\": \\"item/gen');
  assert.equal(call.path, 'oe_enderium.json', 'the arguments that did arrive are still usable');
  const cut = cutOffOf(call);
  assert.ok(cut, 'the unclosed argument is reported instead of being dropped');
  assert.equal(cut.key, 'content');
  assert.ok(cut.chars > 0, 'it says how much of the argument arrived');
});

test('a complete tool call carries no cut-off marker', () => {
  for (const args of [
    '{"path": "a.txt", "content": "hello"}',
    '{"path": "a.txt", "content": "hello"',
    '{"path": "a.txt", "content": ""}'
  ]) {
    assert.equal(cutOffOf(toCall('create_file', args)), null, args);
  }
});

test('a cut-off write is told to split the file, not to resend', () => {
  const msg = cutOffError('create_file', { key: 'content', chars: 4213 }, true);
  assert.match(msg, /cut off/i);
  assert.match(msg, /"content"/);
  assert.match(msg, /4213/);
  assert.match(msg, /maximum output length/i);
  assert.match(msg, /insert_lines/, 'it names the tool that appends');
  assert.match(msg, /NOT run/, 'it says nothing was written');

  const other = cutOffError('search', { key: 'query', chars: 90 }, false);
  assert.equal(/insert_lines/.test(other), false, 'the split-write advice is only for file writes');
});

test('tool errors are classified into stable kinds', () => {
  const cases = [
    ['this call was cut off before it finished sending', 'cut_off'],
    ['There is no tool called "creat_file".', 'unknown_tool'],
    ['create_file needs "content". It is the COMPLETE text', 'missing_arg'],
    ['old_str was not found in App.java.', 'no_match'],
    ['Blocked: absolute paths are outside the workspace', 'blocked'],
    ["'gcc' is not recognized as an internal or external command", 'missing_program'],
    ['File not found: app.py. Create it with create_file first.', 'not_found'],
    ['Timed out after 60s', 'timeout'],
    ['Exited with code 1', 'nonzero_exit'],
    ['something nobody predicted', 'other'],
    ['', 'other']
  ];
  for (const [err, kind] of cases) assert.equal(classifyToolError(err), kind, err);
});

// --- sandbox tool surface -------------------------------------------------
// These touch a real (temporary) workspace on purpose: a missing cross-module
// import only shows up when a handler actually runs, which module-load checks
// and node --check both miss.
const SBOX = 'oq-test-sandbox';

async function sbox(call) {
  const { execTool } = await import('../sandbox.js');
  return execTool(SBOX, call);
}
async function sboxReset() {
  const { remove } = await import('../sandbox.js');
  remove(SBOX);
}

test('sandbox: write, read back, edit and list round-trip', async () => {
  await sboxReset();
  assert.equal((await sbox({ tool: 'create_file', path: 'app.py', content: 'print(1)\n' })).ok, true);
  const read = await sbox({ tool: 'view', path: 'app.py' });
  assert.equal(read.ok, true);
  assert.match(read.content, /print\(1\)/);
  assert.equal((await sbox({ tool: 'str_replace', path: 'app.py', old_str: 'print(1)', new_str: 'print(2)' })).ok, true);
  const listed = await sbox({ tool: 'list_files' });
  assert.equal(listed.ok, true);
  assert.ok(listed.files.some(f => f.path === 'app.py'), 'app.py is listed');
  await sboxReset();
});

test('sandbox: search and find reach the workspace', async () => {
  await sboxReset();
  await sbox({ tool: 'create_file', path: 'src/a.py', content: 'import os\n' });
  const found = await sbox({ tool: 'find', pattern: '**/*.py' });
  assert.equal(found.ok, true);
  assert.equal(found.count, 1);
  const hits = await sbox({ tool: 'search', query: 'import' });
  assert.equal(hits.ok, true);
  assert.equal(hits.count, 1);
  await sboxReset();
});

test('sandbox: aliases and alternate argument names resolve', async () => {
  await sboxReset();
  assert.equal((await sbox({ tool: 'write_file', path: 'b.txt', content: 'hi' })).ok, true);
  assert.equal((await sbox({ tool: 'read_file', file_path: 'b.txt' })).ok, true, 'file_path is accepted for path');
  assert.equal((await sbox({ tool: 'edit', path: 'b.txt', old_str: 'hi', new_str: 'yo' })).ok, true, 'loose alias resolves');
  await sboxReset();
});

test('sandbox: every path argument is normalized once', async () => {
  await sboxReset();
  const made = await sbox({ tool: 'create_file', path: '/notes.md', content: 'ok' });
  assert.equal(made.path, 'notes.md', 'leading slash is stripped before it reaches metadata');
  const moved = await sbox({ tool: 'move_file', path: '/notes.md', new_path: 'docs/notes.md' });
  assert.equal(moved.path, 'docs/notes.md');
  await sboxReset();
});

test('sandbox: escaping paths are refused with a teaching error', async () => {
  await sboxReset();
  for (const bad of ['/etc/passwd', 'C:/Windows/x', '../out.txt']) {
    const r = await sbox({ tool: 'create_file', path: bad, content: 'x' });
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /workspace|relative/i, bad);
  }
  await sboxReset();
});

test('sandbox: a missing required argument names the argument', async () => {
  await sboxReset();
  const noContent = await sbox({ tool: 'create_file', path: 'x.txt' });
  assert.equal(noContent.ok, false);
  assert.match(noContent.error, /"content"/);
  const noNew = await sbox({ tool: 'str_replace', path: 'x.txt', old_str: 'a' });
  assert.equal(noNew.ok, false);
  assert.match(noNew.error, /"new_str"/);
  await sboxReset();
});

test('sandbox: an empty string is a real file body, not a missing argument', async () => {
  await sboxReset();
  const made = await sbox({ tool: 'create_file', path: 'empty.txt', content: '' });
  assert.equal(made.ok, true, 'content:"" creates an empty file');
  assert.equal(made.bytes, 0);
  await sbox({ tool: 'create_file', path: 'd.txt', content: 'keep\ndrop\n' });
  const cut = await sbox({ tool: 'str_replace', path: 'd.txt', old_str: 'drop\n', new_str: '' });
  assert.equal(cut.ok, true, 'new_str:"" deletes old_str');
  const after = await sbox({ tool: 'view', path: 'd.txt' });
  assert.equal(/drop/.test(after.content), false);
  await sboxReset();
});

test('sandbox: create_file accepts the other names models use for content', async () => {
  await sboxReset();
  for (const k of ['contents', 'body', 'code', 'file_text', 'source']) {
    const r = await sbox({ tool: 'create_file', path: `${k}.txt`, [k]: 'x' });
    assert.equal(r.ok, true, k);
  }
  await sboxReset();
});

test('sandbox: create_file salvages a body sent under an invented argument name', async () => {
  await sboxReset();
  const long = 'line one of the file\n'.repeat(6);
  const r = await sbox({ tool: 'create_file', path: 'salvaged.txt', the_file_body: long });
  assert.equal(r.ok, true);
  assert.match(r.note, /the_file_body/);
  const back = await sbox({ tool: 'view', path: 'salvaged.txt' });
  assert.match(back.content, /line one of the file/);

  const short = await sbox({ tool: 'create_file', path: 'nope.txt', mood: 'happy' });
  assert.equal(short.ok, false, 'a short unrelated string is not mistaken for a file body');
  await sboxReset();
});

test('sandbox: str_replace tolerates indentation but not ambiguity', async () => {
  await sboxReset();
  await sbox({ tool: 'create_file', path: 'App.java', content: 'class A {\n    void run() {\n        int x = 1;\n    }\n}\n' });
  const fixed = await sbox({ tool: 'str_replace', path: 'App.java', old_str: 'void run() {\nint x = 1;\n}', new_str: 'void run() {\nint x = 2;\n}' });
  assert.equal(fixed.ok, true, 'a snippet retyped without its indentation still matches');
  assert.match(fixed.note, /indentation/i);
  const body = (await sbox({ tool: 'view', path: 'App.java' })).content;
  assert.match(body, /    void run\(\) \{/, "the file's own indentation is preserved");
  assert.match(body, /int x = 2;/);

  await sbox({ tool: 'create_file', path: 'two.txt', content: '  a\n\ta\n' });
  const amb = await sbox({ tool: 'str_replace', path: 'two.txt', old_str: 'a', new_str: 'b' });
  assert.equal(amb.ok, false, 'two indentation-insensitive matches stay an error');
  await sboxReset();
});

test('sandbox: a failed str_replace shows the closest text in the file', async () => {
  await sboxReset();
  await sbox({ tool: 'create_file', path: 'cfg.json', content: '{\n  "name": "enderium",\n  "version": "1.0.0"\n}\n' });
  const r = await sbox({ tool: 'str_replace', path: 'cfg.json', old_str: '"version": "9.9.9"', new_str: '"version": "2"' });
  assert.equal(r.ok, false);
  assert.match(r.error, /closest text/i);
  assert.match(r.error, /1\.0\.0/, 'the real line is quoted back with its line number');
  await sboxReset();
});

test('sandbox: an unknown tool suggests the nearest real one', async () => {
  const r = await sbox({ tool: 'creat_file', path: 'a', content: 'b' });
  assert.equal(r.ok, false);
  assert.match(r.error, /create_file/);
});

test('sandbox: bash refuses host commands and paths outside the workspace', async () => {
  for (const cmd of ['sudo apt-get install nginx', 'cat /etc/passwd']) {
    const r = await sbox({ tool: 'bash', cmd });
    assert.equal(r.ok, false, cmd);
    assert.match(r.error, /Blocked/, cmd);
  }
});

test('sandbox: hostEnvInfo reports a usable shape without leaking host paths', async () => {
  const { hostEnvInfo } = await import('../sandbox.js');
  const env = hostEnvInfo();
  assert.ok(env.osName && env.shellName);
  assert.ok(Array.isArray(env.interpreters));
  assert.ok(Array.isArray(env.missingUtils));
  for (const i of env.interpreters) {
    assert.equal(/[\/]/.test(i.version), false, `${i.name} version must not contain a path: ${i.version}`);
  }
});

// --- reasoning / content split ---------------------------------------------

function emitTo(model, feed) {
  const out = { content: '', reasoning: '' };
  const e = makeEmitter(model, (ev) => {
    if (ev.type === 'content') out.content += ev.text;
    if (ev.type === 'reasoning') out.reasoning += ev.text;
  }, () => {}, null);
  feed(e);
  e.flush();
  return out;
}

test('emitter: a forced close tag on the content channel is swallowed, not printed', () => {
  // llama.cpp streams the thought through reasoning_content, then a thinking
  // budget forces it shut by emitting the raw closing tag as content. Nothing
  // was tracking an open tag, so it used to be printed as the first line.
  const r = emitTo({}, (e) => {
    e.emitReasoning('Thinking Process: 1. Analyze');
    e.emitContent("</think>\n\nI'd be happy to help!");
  });
  assert.equal(r.reasoning, 'Thinking Process: 1. Analyze');
  assert.equal(r.content, "\n\nI'd be happy to help!");
});

test('emitter: a forced close tag split across chunks is still swallowed', () => {
  const r = emitTo({}, (e) => {
    e.emitReasoning('some thought');
    e.emitContent('</thi');
    e.emitContent('nk>Answer here.');
  });
  assert.equal(r.content, 'Answer here.');
});

test('emitter: an answer that talks about a closing tag keeps it', () => {
  // The swallow is scoped to the very start of the answer, so a real mention of
  // the tag further in is never eaten.
  const r = emitTo({}, (e) => {
    e.emitReasoning('thinking');
    e.emitContent('You close a thought with ');
    e.emitContent('</think> in most models.');
  });
  assert.equal(r.content, 'You close a thought with </think> in most models.');
});

test('emitter: with no reasoning at all the tag is left exactly where it is', () => {
  const r = emitTo({}, (e) => { e.emitContent('</think> stays put.'); });
  assert.equal(r.content, '</think> stays put.');
  assert.equal(r.reasoning, '');
});

test('emitter: inline think tags in the content stream still split normally', () => {
  const r = emitTo({}, (e) => { e.emitContent('<think>hidden</think>Visible answer.'); });
  assert.equal(r.reasoning, 'hidden');
  assert.equal(r.content, 'Visible answer.');

  const chunked = emitTo({}, (e) => {
    e.emitContent('<thi'); e.emitContent('nk>hid'); e.emitContent('den</thi'); e.emitContent('nk>out');
  });
  assert.equal(chunked.reasoning, 'hidden');
  assert.equal(chunked.content, 'out');
});

test('emitter: a second thinking block after an answer still opens normally', () => {
  const r = emitTo({}, (e) => {
    e.emitReasoning('first');
    e.emitContent('Answer one. <think>second</think> Answer two.');
  });
  assert.equal(r.reasoning, 'firstsecond');
  assert.equal(r.content, 'Answer one.  Answer two.');
});

test('emitter: custom think tokens are honoured on both paths', () => {
  const model = { think_open: '<reasoning>', think_close: '</reasoning>' };
  const inline = emitTo(model, (e) => { e.emitContent('<reasoning>r</reasoning>c'); });
  assert.equal(inline.reasoning, 'r');
  assert.equal(inline.content, 'c');

  const forced = emitTo(model, (e) => { e.emitReasoning('r'); e.emitContent('</reasoning>c'); });
  assert.equal(forced.content, 'c', 'the configured close tag is the one swallowed');

  const other = emitTo(model, (e) => { e.emitReasoning('r'); e.emitContent('</think>c'); });
  assert.equal(other.content, '</think>c', 'a tag this model never uses is not touched');
});

test('emitter: providers that only ever send structured reasoning are unaffected', () => {
  const r = emitTo({}, (e) => {
    e.emitReasoning('Let me think.');
    e.emitContent('Here is the answer.');
  });
  assert.equal(r.reasoning, 'Let me think.');
  assert.equal(r.content, 'Here is the answer.');
});
