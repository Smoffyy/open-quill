import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeKwargs, kwargDefs, applyKwargs, resolveKwargValues, kwargPayload,
  oneShotKwargPayload, controlOf, defaultValueOf, isBoolPair, coerceKwargValue
} from '../lib/kwargs.js';
import { parseTextToolCalls, parseArgs, toCall } from '../tools/index.js';
import { makeToolTextFilter } from '../llm/emitter.js';
import { trimInTurn, compactThreshold, estimateTokens, textTokens, makeTokenCounter, truncateForRollingCtx, FALLBACK_CTX } from '../lib/convo.js';
import { scanTools } from '../toolproto.js';
import { isContextOverflowError } from '../lib/llamacpp.js';
import { winTranslate } from '../sandbox.js';
import { isPrivateAddress, hostAllowed } from '../lib/egress.js';
import { resolveRouted, ruleMatches, routerRules, modelLabel } from '../lib/router.js';
import { preferredChild } from '../lib/tree.js';

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
