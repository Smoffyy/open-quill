import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockAnthropic, mockOpenAi, anthropicTurn } from './mockapis.js';

const SERVER_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB_DIR = path.join(SERVER_ROOT, 'data', 'databases', 'oqprovtest');

process.env.OPEN_QUILL_DB = 'oqprovtest';
fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const { setSetting, closeDb } = await import('../db.js');
const { PROVIDER_TYPES } = await import('../lib/providers.js');
const { streamCompletion, oneShotFull, listAnthropicModels, anthropicModelInfo } = await import('../llm/index.js');
const { toAnthropic, buildParams, legacyThinking, toolUseId } = await import('../llm/anthropic.js');
const { resetMemo, upstreamMessage, fixOpenAiBody, memoFor } = await import('../llm/compat.js');
const { usageCost } = await import('../lib/budget.js');
const { cacheRates, matchPreset } = await import('../lib/pricing.js');
const { parseOverflow, isContextOverflowError } = await import('../lib/llamacpp.js');

const mocks = [];
after(async () => {
  for (const m of mocks) await m.close();
  closeDb();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

async function anthropic(opts) {
  const m = await mockAnthropic(opts);
  mocks.push(m);
  return m;
}

async function openai(opts) {
  const m = await mockOpenAi(opts);
  mocks.push(m);
  return m;
}

function useProvider(type, base_url, api_key) {
  resetMemo();
  setSetting('providers', [{ id: 'p-' + type, name: type, type, base_url, api_key }]);
  return 'p-' + type;
}

async function run(model, messages, { tools = [], signal } = {}) {
  const events = [];
  await streamCompletion({ model, messages, tools, signal, onEvent: (e) => events.push(e) });
  const of = (type) => events.filter(e => e.type === type);
  return {
    events,
    text: of('content').map(e => e.text).join(''),
    reasoning: of('reasoning').map(e => e.text).join(''),
    calls: of('tool_calls')[0] || null,
    finish: of('finish').map(e => e.reason).pop() || '',
    usage: of('usage').pop()?.usage || null,
    deltas: of('tool_call_delta')
  };
}

const CALC_TOOL = { type: 'function', function: { name: 'calculator', description: 'Evaluate maths', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } } };

test('an OpenAI-style history becomes a valid Anthropic conversation', () => {
  const { system, messages } = toAnthropic([
    { role: 'system', content: 'Be brief.' },
    { role: 'system', content: 'Use metric.' },
    { role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'image_url', image_url: { url: 'data:image/svg+xml;base64,AAAA' } }, { type: 'image_url', image_url: { url: 'https://x.test/a.png' } }] },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call.1', name: 'calculator', argsText: '{"expression":"2+2"}' }, { id: 'call_2', name: 'calculator', argsText: 'not json' }] },
    { role: 'tool', tool_call_id: 'call.1', content: '4' },
    { role: 'user', content: '   ' },
    { role: 'system', content: 'Mid-conversation note.' },
    { role: 'tool', tool_call_id: 'stray', content: 'orphan' },
    { role: 'assistant', content: 'Done.' }
  ]);
  assert.equal(system, 'Be brief.\n\nUse metric.');
  assert.deepEqual(messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  const [first, call, results] = messages;
  assert.deepEqual(first.content.map(b => b.type), ['text', 'image', 'text', 'image']);
  assert.equal(first.content[1].source.media_type, 'image/png');
  assert.match(first.content[2].text, /unsupported format/);
  assert.equal(first.content[3].source.type, 'url');
  assert.deepEqual(call.content.map(b => b.id), ['call_1', 'call_2'], 'ids are made API-safe');
  assert.deepEqual(call.content[0].input, { expression: '2+2' });
  assert.deepEqual(call.content[1].input, {}, 'unparseable arguments become an empty object rather than a 400');
  assert.deepEqual(results.content.slice(0, 2).map(b => [b.type, b.tool_use_id]), [['tool_result', 'call_1'], ['tool_result', 'call_2']]);
  assert.equal(results.content[1].is_error, true, 'a call with no result gets an error result so the API accepts the turn');
  assert.ok(results.content.some(b => b.type === 'text' && /system_note/.test(b.text)));
  assert.ok(results.content.some(b => b.type === 'text' && /Tool result: orphan/.test(b.text)), 'a result with no call becomes text');
  assert.equal(messages[4].content[0].text, 'Continue.', 'a conversation never ends on an assistant prefill');
  assert.equal(toolUseId('a b'), 'a_b');
});

test('request parameters follow what each Claude generation accepts', () => {
  const spec = PROVIDER_TYPES.anthropic;
  const base = { internal_name: 'claude-opus-5-5', temperature: 1.6, stop: 'END\nSTOP', has_reasoning: 1 };
  const p = buildParams(base, spec, { messages: [{ role: 'user', content: 'hi' }], tools: [CALC_TOOL] });
  assert.equal(p.max_tokens, 32000);
  assert.equal(p.temperature, 1, 'temperature is clamped to the Anthropic range');
  assert.deepEqual(p.stop_sequences, ['END', 'STOP']);
  assert.deepEqual(p.thinking, { type: 'adaptive', display: 'summarized' });
  assert.equal(p.tools[0].input_schema.type, 'object');
  assert.equal(p.tools[0].eager_input_streaming, true);
  const legacy = buildParams({ ...base, internal_name: 'claude-haiku-4-5', max_tokens: 2000 }, spec, { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(legacy.thinking.type, 'enabled');
  assert.ok(legacy.thinking.budget_tokens >= 1024 && legacy.thinking.budget_tokens < legacy.max_tokens);
  assert.equal(legacy.temperature, undefined, 'budgeted thinking cannot carry a custom temperature');
  const effort = buildParams({ ...base, resolved_kwargs: { chat_template_kwargs: { reasoning_effort: 'xhigh' }, metadata: { user_id: 'u' } } }, spec, { messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(effort.output_config, { effort: 'xhigh' });
  assert.deepEqual(effort.metadata, { user_id: 'u' });
  const plain = buildParams({ internal_name: 'claude-sonnet-5-5' }, spec, { messages: [{ role: 'user', content: 'hi' }], oneShot: true });
  assert.equal(plain.thinking, undefined);
  assert.equal(plain.max_tokens, 4096);
  for (const id of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514', 'claude-opus-4-1', 'claude-3-7-sonnet-latest', 'anthropic.claude-sonnet-4-5', 'anthropic.claude-haiku-4-5-20251001-v1:0', 'claude-opus-4-5@20251101']) assert.equal(legacyThinking(id), true, id);
  for (const id of ['claude-opus-4-6', 'claude-opus-4-8', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5-5']) assert.equal(legacyThinking(id), false, id);
});

test('Anthropic streams text, summarized thinking, tool calls and usage', async () => {
  const mock = await anthropic({
    respond: () => ({ thinking: 'Need to add.', text: 'Let me compute.', tools: [{ id: 'toolu_01', name: 'calculator', input: { expression: '17*23' } }], usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 } })
  });
  const model = { provider_id: useProvider('anthropic', mock.url + '/v1', 'sk-ant-test'), internal_name: 'claude-opus-5-5', has_reasoning: 1 };
  const r = await run(model, [{ role: 'system', content: 'Sys' }, { role: 'user', content: 'What is 17*23?' }], { tools: [CALC_TOOL] });
  assert.equal(mock.requests[0].rejected, undefined, mock.requests[0].rejected);
  assert.equal(mock.requests[0].headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(mock.requests[0].body.system, [{ type: 'text', text: 'Sys', cache_control: { type: 'ephemeral' } }]);
  assert.equal(r.reasoning, 'Need to add.');
  assert.equal(r.text, 'Let me compute.');
  assert.equal(r.finish, 'tool_calls');
  assert.deepEqual(r.calls.calls.map(c => [c.id, c.name, JSON.parse(c.argsText).expression]), [['toolu_01', 'calculator', '17*23']]);
  assert.equal(r.calls.blocks.length, 1);
  assert.match(r.calls.blocks[0].signature, /^sig_/);
  assert.ok(r.deltas.length > 2, 'tool arguments stream as they are written');
  assert.equal(r.usage.prompt, 100, 'cached input tokens count toward the prompt');
  assert.equal(r.usage.cacheRead, 90);
  assert.equal(r.usage.completion, 21);
});

test('a tool round trip replays the signed thinking block and the result', async () => {
  const mock = await anthropic({
    respond: (body, i) => (i === 0
      ? { thinking: 'Use the tool.', tools: [{ id: 'toolu_a', name: 'calculator', input: { expression: '2+2' } }] }
      : { thinking: 'It said 4.', text: 'The answer is 4.' })
  });
  const model = { provider_id: useProvider('anthropic', mock.url, 'sk-ant-test'), internal_name: 'claude-opus-5-5', has_reasoning: 1 };
  const convo = [{ role: 'system', content: 'Sys' }, { role: 'user', content: '2+2?' }];
  const first = await run(model, convo, { tools: [CALC_TOOL] });
  const second = await run(model, [
    ...convo,
    { role: 'assistant', content: '', tool_calls: first.calls.calls, blocks: first.calls.blocks },
    { role: 'tool', tool_call_id: first.calls.calls[0].id, name: 'calculator', content: '4' }
  ], { tools: [CALC_TOOL] });
  assert.equal(mock.requests[1].rejected, undefined, mock.requests[1].rejected);
  const sent = mock.requests[1].body.messages;
  assert.deepEqual(sent[1].content.map(b => b.type), ['thinking', 'tool_use']);
  assert.deepEqual(sent[2].content[0], { type: 'tool_result', tool_use_id: 'toolu_a', content: '4' });
  assert.equal(second.text, 'The answer is 4.');
  assert.equal(second.finish, 'stop');
});

test('a thinking block invalidated by a changed system prompt is stripped and the turn retried', async () => {
  const mock = await anthropic({
    respond: (body, i) => (i === 0 ? { thinking: 'Plan.', tools: [{ id: 'toolu_b', name: 'calculator', input: {} }] } : { text: 'Recovered.' })
  });
  const model = { provider_id: useProvider('anthropic', mock.url, 'sk-ant-test'), internal_name: 'claude-opus-5-5', has_reasoning: 1 };
  const first = await run(model, [{ role: 'system', content: 'Todo: none' }, { role: 'user', content: 'go' }], { tools: [CALC_TOOL] });
  const second = await run(model, [
    { role: 'system', content: 'Todo: step one done' },
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', tool_calls: first.calls.calls, blocks: first.calls.blocks },
    { role: 'tool', tool_call_id: 'toolu_b', content: 'ok' }
  ], { tools: [CALC_TOOL] });
  assert.match(mock.requests[1].rejected, /bound to a different conversation/);
  assert.equal(mock.requests[2].rejected, undefined);
  assert.deepEqual(mock.requests[2].body.messages[1].content.map(b => b.type), ['tool_use']);
  assert.equal(second.text, 'Recovered.');
});

test('a parameter a model refuses is dropped, retried and remembered', async () => {
  const mock = await anthropic({ respond: () => ({ text: 'ok' }) });
  const model = { provider_id: useProvider('anthropic', mock.url, 'sk-ant-test'), internal_name: 'claude-opus-5-5', temperature: 0.4, top_p: 0.9 };
  const r = await run(model, [{ role: 'user', content: 'hi' }]);
  assert.equal(r.text, 'ok');
  assert.equal(mock.requests.length, 3, 'temperature, then top_p, were each refused once');
  await run(model, [{ role: 'user', content: 'again' }]);
  assert.equal(mock.requests.length, 4, 'the next request goes straight through');
  assert.equal('temperature' in mock.requests[3].body, false);
});

test('legacy budgeted thinking works through a tool loop', async () => {
  const mock = await anthropic({
    respond: (body, i) => (i === 0 ? { thinking: 'Think.', tools: [{ id: 'toolu_c', name: 'calculator', input: { expression: '1' } }] } : { text: 'Fine.' })
  });
  const model = { provider_id: useProvider('anthropic', mock.url, 'sk-ant-test'), internal_name: 'claude-haiku-4-5', has_reasoning: 1, temperature: 0.5, max_tokens: 4000 };
  const first = await run(model, [{ role: 'user', content: 'go' }], { tools: [CALC_TOOL] });
  assert.equal(mock.requests[0].rejected, undefined, mock.requests[0].rejected);
  const lost = await run(model, [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', tool_calls: first.calls.calls },
    { role: 'tool', tool_call_id: 'toolu_c', content: '1' }
  ], { tools: [CALC_TOOL] });
  assert.match(mock.requests[1].rejected, /must start with a thinking block/);
  assert.equal(mock.requests[2].body.thinking, undefined, 'thinking is turned off rather than failing the turn');
  assert.equal(lost.text, 'Fine.');
});

test('an output cap above the model limit is lowered to the limit', async () => {
  let cap = true;
  const mock = await anthropic({
    respond: (body) => {
      if (cap && body.max_tokens > 8192) { cap = false; return { status: 400, type: 'invalid_request_error', message: `max_tokens: ${body.max_tokens} > 8192, which is the maximum allowed number of output tokens for claude-3-5-haiku` }; }
      return { text: 'short' };
    }
  });
  const model = { provider_id: useProvider('anthropic', mock.url, 'sk-ant-test'), internal_name: 'claude-3-5-haiku' };
  assert.equal((await run(model, [{ role: 'user', content: 'hi' }])).text, 'short');
  assert.equal(mock.requests[1].body.max_tokens, 8192);
});

test('Anthropic failures read as what to fix', async () => {
  const mock = await anthropic({ key: 'right', respond: (body) => (body.model === 'nope' ? { status: 404, type: 'not_found_error', message: 'model: nope' } : { status: 400, type: 'invalid_request_error', message: 'prompt is too long: 250000 tokens > 200000 maximum' }) });
  const bad = { provider_id: useProvider('anthropic', mock.url, 'wrong'), internal_name: 'claude-opus-5-5' };
  await assert.rejects(run(bad, [{ role: 'user', content: 'x' }]), /Upstream error 401: Anthropic rejected the API key/);
  const missing = { provider_id: useProvider('anthropic', mock.url, 'right'), internal_name: 'nope' };
  await assert.rejects(run(missing, [{ role: 'user', content: 'x' }]), /no model named "nope"/);
  const long = { provider_id: useProvider('anthropic', mock.url, 'right'), internal_name: 'claude-opus-5-5' };
  const err = await run(long, [{ role: 'user', content: 'x' }]).catch(e => e);
  assert.equal(isContextOverflowError(err), true, 'the context window code recognises the overflow');
  assert.deepEqual(parseOverflow(err), { prompt: 250000, ctx: 200000 });
  const down = { provider_id: useProvider('anthropic', 'http://127.0.0.1:1', 'right'), internal_name: 'claude-opus-5-5' };
  await assert.rejects(run(down, [{ role: 'user', content: 'x' }]), /Could not reach the model provider at http:\/\/127\.0\.0\.1:1/);
});

test('a rate limit is retried before it reaches the member', async () => {
  let n = 0;
  const mock = await anthropic({ respond: () => (n++ === 0 ? { status: 429, type: 'rate_limit_error', message: 'slow down', headers: { 'retry-after-ms': '10' } } : { text: 'through' }) });
  const model = { provider_id: useProvider('anthropic', mock.url, 'sk-ant-test'), internal_name: 'claude-opus-5-5' };
  assert.equal((await run(model, [{ role: 'user', content: 'x' }])).text, 'through');
});

test('stopping an Anthropic reply aborts the stream cleanly', async () => {
  const mock = await anthropic({ respond: () => ({ text: 'a'.repeat(400), chunk: 4, delayMs: 15 }) });
  const model = { provider_id: useProvider('anthropic', mock.url, 'sk-ant-test'), internal_name: 'claude-opus-5-5' };
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 120);
  const err = await run(model, [{ role: 'user', content: 'x' }], { signal: ctl.signal }).catch(e => e);
  assert.equal(err?.name, 'AbortError');
});

test('a refusal says so instead of showing an empty reply', async () => {
  const mock = await anthropic({ respond: () => ({ stop: 'refusal' }) });
  const model = { provider_id: useProvider('anthropic', mock.url, 'sk-ant-test'), internal_name: 'claude-opus-5-5' };
  const r = await run(model, [{ role: 'user', content: 'x' }]);
  assert.equal(r.finish, 'refusal');
  assert.match(r.text, /declined/);
});

test('one-shot calls, model listing and context detection work against Anthropic', async () => {
  const models = Array.from({ length: 5 }, (_, i) => ({ id: 'claude-mock-' + i, max_input_tokens: 1000000, max_tokens: 128000 }));
  const mock = await anthropic({ models, respond: () => anthropicTurn({ text: 'A short title' }) });
  const provider_id = useProvider('anthropic', mock.url, 'sk-ant-test');
  const r = await oneShotFull({ provider_id, internal_name: 'claude-opus-5-5', has_reasoning: 1 }, [{ role: 'user', content: 'Title this' }]);
  assert.equal(r.text, 'A short title');
  assert.equal(mock.requests.at(-1).body.stream, undefined);
  assert.equal(mock.requests.at(-1).body.thinking, undefined, 'one-shot helpers do not pay for thinking');
  const list = await listAnthropicModels({ base: mock.url, key: 'sk-ant-test' });
  assert.equal(list.length, 5, 'every page of the model list is read');
  assert.deepEqual(await anthropicModelInfo({ base: mock.url, key: 'sk-ant-test' }, 'claude-mock-2'), { context: 1000000, maxOutput: 128000 });
});

test('OpenAI streams text, parallel tool calls and usage', async () => {
  const mock = await openai({
    respond: () => ({ text: 'Checking.', tools: [{ id: 'call_x', name: 'calculator', input: { expression: '1+1' } }, { id: 'call_y', name: 'calculator', input: { expression: '2+2' } }] })
  });
  const model = { provider_id: useProvider('openai', mock.url, 'sk-test'), internal_name: 'gpt-mock', max_tokens: 500 };
  const r = await run(model, [{ role: 'system', content: 'Sys' }, { role: 'user', content: 'go' }], { tools: [CALC_TOOL] });
  const body = mock.requests[0].body;
  assert.equal(mock.requests[0].rejected, undefined, mock.requests[0].rejected);
  assert.equal(body.max_completion_tokens, 500, 'OpenAI gets max_completion_tokens');
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.stream_options.include_usage, true);
  assert.equal(r.text, 'Checking.');
  assert.deepEqual(r.calls.calls.map(c => [c.id, JSON.parse(c.argsText).expression]), [['call_x', '1+1'], ['call_y', '2+2']]);
  assert.deepEqual(r.usage, { prompt: 30, completion: 12, total: 42, cacheRead: 0, cacheWrite: 0 });
  const next = await run(model, [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: 'Checking.', tool_calls: r.calls.calls },
    { role: 'tool', tool_call_id: 'call_x', content: '2' },
    { role: 'tool', tool_call_id: 'call_y', content: '4' }
  ], { tools: [CALC_TOOL] });
  assert.equal(mock.requests[1].rejected, undefined, mock.requests[1].rejected);
  assert.equal(next.finish, 'tool_calls');
});

test('OpenAI reasoning models get the parameters they accept', async () => {
  const rejects = {
    'o-mock': {
      max_tokens: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
      temperature: "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported."
    },
    'compat-mock': { max_completion_tokens: "Unrecognized request argument supplied: max_completion_tokens" }
  };
  const mock = await openai({ rejects, respond: () => ({ text: 'fine' }) });
  const provider_id = useProvider('openai', mock.url, 'sk-test');
  const r = await run({ provider_id, internal_name: 'o-mock', temperature: 0.7, max_tokens: 300 }, [{ role: 'user', content: 'x' }]);
  assert.equal(r.text, 'fine');
  assert.equal(mock.requests.at(-1).body.temperature, undefined);
  const compat = await run({ provider_id, internal_name: 'compat-mock', max_tokens: 300 }, [{ role: 'user', content: 'x' }]);
  assert.equal(compat.text, 'fine');
  assert.equal(mock.requests.at(-1).body.max_tokens, 300, 'a compatible server that only knows max_tokens gets it back');
});

test('OpenAI failures read as what to fix', async () => {
  const mock = await openai({ key: 'right', respond: () => ({ status: 429, message: 'You exceeded your current quota, please check your plan and billing details.' }) });
  await assert.rejects(run({ provider_id: useProvider('openai', mock.url, 'wrong'), internal_name: 'gpt-mock' }, [{ role: 'user', content: 'x' }]), /Upstream error 401: The provider rejected the API key\. Check the key on this connection\. Incorrect API key/);
  await assert.rejects(run({ provider_id: useProvider('openai', mock.url, 'right'), internal_name: 'gpt-mock' }, [{ role: 'user', content: 'x' }]), /Upstream error 429: .*exceeded your current quota/);
  assert.equal(upstreamMessage(500, 'plain text failure'), 'Upstream error 500: The provider had an internal error. plain text failure');
  assert.equal(fixOpenAiBody(400, '{"error":{"message":"bad","param":"messages"}}', { messages: [] }, memoFor('x', 'y')), null, 'a required field is never dropped');
});

test('OpenAI one-shot calls recover the same way', async () => {
  const mock = await openai({ rejects: { 'o-mock': { reasoning_effort: "Unsupported parameter: 'reasoning_effort' is not supported with this model." } }, respond: () => ({ text: 'Title' }) });
  const provider_id = useProvider('openai', mock.url, 'sk-test');
  const r = await oneShotFull({ provider_id, internal_name: 'o-mock', resolved_kwargs: { reasoning_effort: 'low' }, kwargs: [{ id: 'e', name: 'reasoning_effort', target: 'body', values: ['low', 'high'] }] }, [{ role: 'user', content: 'x' }]);
  assert.equal(r.text, 'Title');
});

const BIG_SYSTEM = 'You are a careful assistant. '.repeat(400);

test('Claude reuses the cached prompt across tool steps and turns', async () => {
  const mock = await anthropic({
    respond: (body) => {
      const done = body.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'));
      return done ? { text: 'Done.' } : { tools: [{ id: 'toolu_k', name: 'calculator', input: { expression: '1+1' } }] };
    }
  });
  const model = { provider_id: useProvider('anthropic', mock.url, 'sk-ant-test'), internal_name: 'claude-opus-4-8' };
  const turn = [{ role: 'system', content: BIG_SYSTEM }, { role: 'user', content: 'Add one and one.' }];
  const step1 = await run(model, turn, { tools: [CALC_TOOL] });
  const body = mock.requests[0].body;
  assert.deepEqual(body.cache_control, { type: 'ephemeral' }, 'the conversation carries the moving breakpoint');
  assert.deepEqual(body.tools.at(-1).cache_control, { type: 'ephemeral' });
  assert.equal(body.system[0].cache_control.type, 'ephemeral');
  assert.equal(step1.usage.cacheRead, 0);
  assert.ok(step1.usage.cacheWrite > 2000, 'the first request writes the prefix');

  const step2 = await run(model, [...turn, { role: 'assistant', content: '', tool_calls: step1.calls.calls }, { role: 'tool', tool_call_id: 'toolu_k', content: '2' }], { tools: [CALC_TOOL] });
  assert.ok(step2.usage.cacheRead >= step1.usage.cacheWrite, 'the next tool step reads everything the first one wrote');

  const next = await run(model, [...turn, { role: 'assistant', content: 'Done.' }, { role: 'user', content: 'And two and two?' }], { tools: [CALC_TOOL] });
  assert.ok(next.usage.cacheRead > 2000, 'the next turn reads the tools and system prompt back');

  const priced = { internal_name: 'claude-opus-4-8', cost_in: 5, cost_out: 25 };
  assert.ok(usageCost(priced, step2.usage) < usageCost(priced, { ...step2.usage, cacheRead: 0, cacheWrite: 0 }) / 2, 'a cached step costs well under half');
});

test('a proxy that refuses cache markers still gets the request, without them', async () => {
  const mock = await anthropic({ rejectCache: true, respond: () => ({ text: 'plain' }) });
  const model = { provider_id: useProvider('anthropic', mock.url, 'sk-ant-test'), internal_name: 'claude-opus-4-8' };
  assert.equal((await run(model, [{ role: 'system', content: 'Sys' }, { role: 'user', content: 'hi' }], { tools: [CALC_TOOL] })).text, 'plain');
  assert.equal((await run(model, [{ role: 'user', content: 'again' }])).text, 'plain');
  assert.equal(mock.requests.length, 3, 'refused once, then remembered');
  assert.equal(mock.requests[2].body.cache_control, undefined);
});

test('OpenAI cached tokens are counted and priced', async () => {
  const mock = await openai({ respond: () => ({ text: 'ok', usage: { prompt_tokens: 1000, completion_tokens: 10 }, cached: 800 }) });
  const r = await run({ provider_id: useProvider('openai', mock.url, 'sk-test'), internal_name: 'gpt-5.4' }, [{ role: 'user', content: 'x' }]);
  assert.equal(r.usage.cacheRead, 800);
  const cost = usageCost({ internal_name: 'gpt-5.4', cost_in: 2.5, cost_out: 15 }, r.usage);
  assert.equal(Number(cost.toFixed(6)), Number(((200 + 800 * 0.1) / 1e6 * 2.5 + 10 / 1e6 * 15).toFixed(6)));
});

test('Claude prices and cache rates match the published ones', () => {
  const price = (id) => { const p = matchPreset(id); return p && [p.in, p.out]; };
  assert.deepEqual(price('claude-haiku-4-5'), [1, 5]);
  assert.deepEqual(price('claude-opus-4-6'), [5, 25]);
  assert.deepEqual(price('claude-opus-4-1'), [15, 75]);
  assert.deepEqual(price('claude-sonnet-4-6'), [3, 15]);
  assert.deepEqual(price('claude-sonnet-5-5'), [2, 10]);
  assert.deepEqual(price('claude-opus-5-5'), [4, 20]);
  assert.deepEqual(cacheRates('claude-opus-5-5'), { read: 0.05, write: 1.25 });
  assert.deepEqual(cacheRates('claude-fable-5-1'), { read: 0.025, write: 1.25 });
  assert.deepEqual(cacheRates('claude-sonnet-5-5'), { read: 0.1, write: 1.25 });
  assert.deepEqual(cacheRates('local-model'), { read: 1, write: 1 });
});
