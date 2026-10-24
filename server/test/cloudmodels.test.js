import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudPreset, presetPatch, catalogCtx, rememberListing, listingFor, forgetListings } from '../lib/cloudmodels.js';
import { sanitizeKwargs, kwargPayload, resolveKwargValues, replayFieldFor } from '../lib/kwargs.js';
import * as clientKwargs from '../../client/src/lib/kwargs.js';

const DB_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'data', 'databases', 'oqcloudtest');
process.env.OPEN_QUILL_DB = 'oqcloudtest';
fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const { closeDb } = await import('../db.js');
const { PROVIDER_TYPES, isLocalType } = await import('../lib/providers.js');
const { buildParams } = await import('../llm/anthropic.js');
const { buildResponsesBody } = await import('../llm/responses.js');

after(() => {
  closeDb();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const efforts = (type, id) => cloudPreset(type, id)?.kwargs.find(k => k.id === 'effort');
const payload = (preset, picked = {}) => {
  const defs = sanitizeKwargs(preset.kwargs);
  return kwargPayload(defs, resolveKwargValues(defs, picked, false));
};

test('every cloud connection type has a catalog, and local ones are left to the admin', () => {
  for (const [type, spec] of Object.entries(PROVIDER_TYPES)) {
    if (spec.local) continue;
    const sample = {
      openai: 'gpt-5.5', anthropic: 'claude-opus-5-5', gemini: 'gemini-3.1-pro-preview', moonshot: 'kimi-k2.6', mistral: 'mistral-medium-3-5',
      meta: 'Llama-4-Maverick-17B-128E-Instruct-FP8', xai: 'grok-4.7', deepseek: 'deepseek-v4-pro'
    }[type];
    if (type === 'openrouter') continue;
    assert.ok(sample, 'a sample model for ' + type);
    assert.ok(cloudPreset(type, sample), type + ' recognises ' + sample);
  }
  assert.equal(isLocalType('llamacpp'), true);
  assert.equal(cloudPreset('llamacpp', 'qwen3'), null);
  assert.equal(cloudPreset('openai', ''), null);
  assert.equal(cloudPreset('openai', 'my-fine-tune'), null, 'an unknown id gets nothing rather than a guess');
});

test('OpenAI models offer the effort levels each generation accepts', () => {
  assert.deepEqual(efforts('openai', 'gpt-6-astra').values, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(efforts('openai', 'gpt-6.1-sol').values, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(efforts('openai', 'gpt-6-luna').values, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(efforts('openai', 'gpt-5.5').values, ['none', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(efforts('openai', 'gpt-5.4-mini').values, ['none', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(efforts('openai', 'gpt-5.1').values, ['none', 'low', 'medium', 'high']);
  assert.deepEqual(efforts('openai', 'gpt-5-mini').values, ['minimal', 'low', 'medium', 'high']);
  assert.deepEqual(efforts('openai', 'o3').values, ['low', 'medium', 'high']);
  assert.equal(cloudPreset('openai', 'gpt-5-chat-latest').kwargs.length, 0);
  assert.equal(cloudPreset('openai', 'gpt-4o').vision, true);
  assert.equal(efforts('openai', 'gpt-6-astra').control, 'auto');
  assert.equal(efforts('openai', 'gpt-6-luna').control, 'select', 'six levels read better as a list');
  assert.equal(catalogCtx('openai', 'gpt-6-astra'), 1050000);
});

test('Claude models get adaptive thinking and their effort range, under the effort name the API reads', () => {
  const opus = cloudPreset('anthropic', 'claude-opus-5-5');
  assert.equal(opus.reasoning, true);
  assert.equal(efforts('anthropic', 'claude-opus-5-5').default, 'medium', 'Opus 5.5 defaults to medium');
  assert.equal(efforts('anthropic', 'claude-sonnet-5-5').default, 'high');
  assert.deepEqual(efforts('anthropic', 'claude-sonnet-4-6').values, ['low', 'medium', 'high', 'max']);
  assert.deepEqual(efforts('anthropic', 'claude-opus-4-5').values, ['low', 'medium', 'high']);
  assert.equal(efforts('anthropic', 'claude-haiku-4-5'), undefined, 'budget-thinking models get no effort control');
  assert.equal(cloudPreset('anthropic', 'claude-haiku-4-5').reasoning, true);
  assert.deepEqual(efforts('anthropic', 'anthropic.claude-fable-5-1').values, ['low', 'medium', 'high', 'xhigh', 'max'], 'a platform prefix is ignored');
  const model = { internal_name: 'claude-opus-5-5', has_reasoning: 1, kwargs: presetPatch(opus).kwargs };
  const params = buildParams(model, PROVIDER_TYPES.anthropic, { messages: [{ role: 'user', content: 'hi' }], kwargs: payload(opus, { effort: 'xhigh' }) });
  assert.deepEqual(params.output_config, { effort: 'xhigh' });
  assert.equal(params.thinking.type, 'adaptive');
  assert.equal('effort' in params, false);
});

test('Gemini, Mistral, xAI and Meta models get their own levels', () => {
  assert.deepEqual(efforts('gemini', 'models/gemini-3-pro-preview').values, ['low', 'high']);
  assert.deepEqual(efforts('gemini', 'gemini-3.5-flash-lite').values, ['minimal', 'low', 'medium', 'high']);
  assert.equal(efforts('gemini', 'gemini-3.5-flash-lite').default, 'minimal');
  assert.deepEqual(efforts('gemini', 'gemini-2.5-flash').values, ['none', 'low', 'medium', 'high']);
  assert.deepEqual(efforts('gemini', 'gemini-4-argon').values, ['low', 'medium', 'high']);
  assert.equal(cloudPreset('gemini', 'gemini-embedding-001').kwargs.length, 0);
  assert.deepEqual(efforts('mistral', 'mistral-small-latest').values, ['none', 'high']);
  assert.deepEqual(efforts('mistral', 'zai-glm-5-3').values, ['low', 'high', 'max']);
  assert.equal(cloudPreset('mistral', 'magistral-medium-latest').kwargs.length, 0);
  assert.deepEqual(efforts('xai', 'grok-4.7').values, ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(efforts('xai', 'grok-4.3').values, ['none', 'low', 'medium', 'high']);
  assert.equal(cloudPreset('meta', 'Llama-4-Scout-17B-16E-Instruct-FP8').vision, true);
});

test('Kimi and DeepSeek get a thinking switch that sends their nested field', () => {
  const kimi = cloudPreset('moonshot', 'kimi-k2.6');
  assert.deepEqual(payload(kimi), { thinking: { type: 'enabled' } });
  assert.deepEqual(payload(kimi, { thinking: 'false' }), { thinking: { type: 'disabled' } });
  assert.equal(cloudPreset('moonshot', 'kimi-k3.1-pro').kwargs.length, 0, 'always-thinking models get no switch');
  const deep = cloudPreset('deepseek', 'deepseek-v4-pro');
  assert.deepEqual(payload(deep), { thinking: { type: 'enabled' }, reasoning_effort: 'high' });
  assert.deepEqual(payload(deep, { thinking: 'false', effort: 'max' }), { thinking: { type: 'disabled' } }, 'effort stays out while thinking is off');
  assert.equal(PROVIDER_TYPES.deepseek.replay, 'reasoning_content');
  assert.equal(PROVIDER_TYPES.moonshot.replay, 'reasoning_content');
});

test('OpenRouter capabilities come from its own model listing', () => {
  forgetListings();
  assert.equal(cloudPreset('openrouter', 'openai/gpt-6-astra'), null, 'nothing is guessed before a listing');
  rememberListing('p-or', [
    { id: 'openai/gpt-6-astra', context_length: 1050000, architecture: { input_modalities: ['text', 'image'] }, reasoning: { supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low'], default_effort: 'medium', mandatory: true } },
    { id: 'qwen/qwen3-max', context_length: 262144, architecture: { input_modalities: ['text'] }, reasoning: { default_enabled: false } },
    { id: 'meta-llama/llama-4-scout', context_length: 327680, architecture: { input_modalities: ['text', 'image'] } }
  ]);
  const listing = listingFor('p-or');
  const astra = cloudPreset('openrouter', 'openai/gpt-6-astra', listing);
  assert.deepEqual(astra.kwargs[0].values, ['low', 'medium', 'high', 'xhigh', 'max'], 'highest-first is turned into a slider order');
  assert.equal(astra.kwargs[0].name, 'reasoning.effort');
  assert.deepEqual(payload(astra, { effort: 'xhigh' }), { reasoning: { effort: 'xhigh' } });
  assert.equal(astra.ctx, 1050000);
  assert.equal(astra.vision, true);
  const qwen = cloudPreset('openrouter', 'qwen/qwen3-max', listing);
  assert.deepEqual(payload(qwen), { reasoning: { enabled: false } });
  assert.deepEqual(payload(qwen, { thinking: 'true' }), { reasoning: { enabled: true } });
  assert.equal(cloudPreset('openrouter', 'meta-llama/llama-4-scout', listing).kwargs.length, 0);
  assert.equal(catalogCtx('openrouter', 'meta-llama/llama-4-scout', listing), 327680);
});

test('every catalog control survives sanitising, and the client builds the same request as the server', () => {
  const ids = {
    openai: ['gpt-6-astra', 'gpt-6-luna', 'gpt-5.5', 'gpt-5.1', 'gpt-5', 'o4-mini'],
    anthropic: ['claude-opus-5-5', 'claude-sonnet-4-6', 'claude-opus-4-5'],
    gemini: ['gemini-3-pro-preview', 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'],
    moonshot: ['kimi-k2.6'], mistral: ['mistral-medium-3-5', 'zai-glm-5-3'], xai: ['grok-4.7', 'grok-4.3', 'grok-3-mini'], deepseek: ['deepseek-v4-flash']
  };
  for (const [type, list] of Object.entries(ids)) {
    for (const id of list) {
      const preset = cloudPreset(type, id);
      const defs = sanitizeKwargs(preset.kwargs);
      assert.equal(defs.length, preset.kwargs.length, `${type}/${id}`);
      for (const d of defs) {
        const raw = preset.kwargs.find(k => k.id === d.id);
        assert.equal(d.id, raw.id, 'ids are stable so member choices keep their key');
        if (raw.values.length) assert.ok(d.values.includes(d.default), `${type}/${id} ${d.id} default ${d.default} is one of its values`);
      }
      for (const picked of [{}, { thinking: 'false' }]) {
        const values = resolveKwargValues(defs, picked, false);
        assert.deepEqual(clientKwargs.kwargPayload(defs, clientKwargs.resolveKwargValues(defs, picked, false)), kwargPayload(defs, values), `${type}/${id}`);
        assert.equal(clientKwargs.replayFieldFor(defs, values), replayFieldFor(defs, values));
      }
    }
  }
});

test('a dotted control name builds a nested field and can never reach the prototype', () => {
  const defs = sanitizeKwargs([
    { id: 'a', name: 'reasoning.effort', target: 'body', values: ['low', 'high'], default: 'high' },
    { id: 'b', name: '__proto__.polluted', target: 'body', values: ['x'], default: 'x' },
    { id: 'c', name: 'constructor.prototype.bad', target: 'extra_body', values: ['x'], default: 'x' },
    { id: 'd', name: 'model.override', target: 'body', values: ['x'], default: 'x' }
  ]);
  for (const lib of [{ kwargPayload, resolveKwargValues }, clientKwargs]) {
    const out = lib.kwargPayload(defs, lib.resolveKwargValues(defs, {}, false));
    assert.deepEqual(out, { reasoning: { effort: 'high' } });
    assert.equal({}.polluted, undefined);
    assert.equal({}.bad, undefined);
  }
});

test('the Responses request maps effort, verbosity and extra body fields onto their own objects', () => {
  const body = buildResponsesBody({ internal_name: 'gpt-5.5' }, PROVIDER_TYPES.openai, {
    messages: [{ role: 'user', content: 'x' }],
    kwargs: { reasoning_effort: 'low', verbosity: 'high', chat_template_kwargs: { enable_thinking: true }, extra_body: { service_tier: 'flex' } }
  });
  assert.deepEqual(body.reasoning, { effort: 'low', summary: 'auto' });
  assert.deepEqual(body.text, { verbosity: 'high' });
  assert.equal(body.service_tier, 'flex');
  assert.equal('chat_template_kwargs' in body, false);
  const none = buildResponsesBody({ internal_name: 'gpt-5.5' }, PROVIDER_TYPES.openai, { messages: [{ role: 'user', content: 'x' }], kwargs: { reasoning_effort: 'none' } });
  assert.deepEqual(none.reasoning, { effort: 'none' }, 'no summary is asked for when there is no reasoning');
  assert.equal(none.include, undefined);
});