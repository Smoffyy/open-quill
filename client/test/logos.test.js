import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logoFor, mentions, modelIconFor } from '../src/lib/logos.js';

const LOGOS = ['alibabacloud-color.svg', 'anthropic.svg', 'cohere-color.svg', 'deepseek-color.svg',
  'gemini-color.svg', 'gemma-color.svg', 'google-color.svg', 'grok.svg', 'liquid.svg', 'lmstudio.svg',
  'meta-color.svg', 'microsoft-color.svg', 'mistral-color.svg', 'moonshot.svg', 'ollama.svg',
  'openai.svg', 'qwen-color.svg', 'upstage-color.svg', 'vllm-color.svg', 'xai.svg', 'zai.svg'];

const logoName = (text) => { const hit = logoFor(text, LOGOS); return hit && hit.src.replace('/assets/', ''); };

test('a keyword only counts where it stands as its own word', () => {
  assert.equal(mentions('qwen3-next-80b', 'qwen'), true, 'a digit ends the word');
  assert.equal(mentions('gpt-4o', 'gpt'), true);
  assert.equal(mentions('metallama-7b', 'meta'), false, 'a letter after it makes it another word');
  assert.equal(mentions('ollama', 'llama'), false, 'a letter before it does too');
  assert.equal(mentions('llama', 'llama'), true);
});

test('a model name finds its family mark through the alias table', () => {
  assert.equal(logoName('claude-opus-5'), 'anthropic.svg');
  assert.equal(logoName('gpt-4o-mini'), 'openai.svg');
  assert.equal(logoName('codellama-13b'), 'meta-color.svg');
  assert.equal(logoName('mixtral-8x7b'), 'mistral-color.svg');
  assert.equal(logoName('glm-4.6'), 'zai.svg');
  assert.equal(logoName('kimi-k2'), 'moonshot.svg');
  assert.equal(logoName('phi-4-reasoning'), 'microsoft-color.svg');
  assert.equal(logoName('command-r-plus'), 'cohere-color.svg');
  assert.equal(logoName('lfm2-1.2b'), 'liquid.svg', 'a digit ends the word, as it does for qwen3');
  assert.equal(logoName('lfm-7b'), 'liquid.svg');
  assert.equal(logoName('solar-pro-2'), 'upstage-color.svg');
});

test('a file name is a keyword on its own, so a new mark needs no code', () => {
  assert.equal(logoName('qwen3-next-80b-a3b'), 'qwen-color.svg');
  assert.equal(logoName('gemma-3-27b-it'), 'gemma-color.svg', 'its own mark beats the vendor one');
  assert.equal(logoName('deepseek-r1-distill'), 'deepseek-color.svg');
  assert.equal(logoName('granite-3.3-8b'), null);
  assert.equal(logoFor('granite-3.3-8b', [...LOGOS, 'granite.svg']).src, '/assets/granite.svg');
});

test('a name that matches nothing gets no mark rather than a wrong one', () => {
  assert.equal(logoName('some-local-finetune'), null);
  assert.equal(logoName(''), null);
  assert.equal(logoName(null), null);
  assert.equal(logoFor('qwen3', []), null, 'no manifest yet, no mark');
});

test('llama.cpp claims its own name rather than answering with Meta', () => {
  for (const name of ['llama.cpp', 'llamacpp', 'llama-cpp', 'my llama cpp box']) {
    assert.equal(logoName(name), null, name);
  }
  assert.equal(logoName('llama-3.1-70b'), 'meta-color.svg', 'the family itself still matches');
});

test('one mark answers to every spelling of a separator', () => {
  for (const file of ['llamacpp.svg', 'llama-cpp.svg', 'llama_cpp.svg', 'llama-cpp-color.svg']) {
    const withFile = [...LOGOS, file];
    for (const name of ['llama.cpp', 'llamacpp', 'llama-cpp', 'LLAMA CPP']) {
      assert.equal(logoFor(name, withFile).src, '/assets/' + file, file + ' vs ' + name);
    }
  }
  assert.equal(logoFor('LM-Studio', LOGOS).src, '/assets/lmstudio.svg');
  assert.equal(logoFor('lm studio', LOGOS).src, '/assets/lmstudio.svg');
});

test('a provider falls back from the name an admin typed to the connection type', () => {
  assert.equal(logoFor(['Local box', 'ollama'], LOGOS).src, '/assets/ollama.svg');
  assert.equal(logoFor(['My OpenAI key', 'openai'], LOGOS).src, '/assets/openai.svg');
  assert.equal(logoFor(['', 'vllm'], LOGOS).src, '/assets/vllm-color.svg');
  assert.equal(logoFor(['Anthropic', 'openai'], LOGOS).src, '/assets/anthropic.svg');
  assert.equal(logoFor(['llama.cpp', 'llamacpp'], LOGOS), null);
  assert.equal(logoFor(['llama.cpp', 'llamacpp'], [...LOGOS, 'llamacpp.svg']).src, '/assets/llamacpp.svg');
});

test('the longest keyword wins, and a colour file beats a plain one', () => {
  assert.equal(logoFor('LM Studio', LOGOS).src, '/assets/lmstudio.svg');
  assert.equal(logoFor('LM Studio', LOGOS).color, false, 'a plain mark is tinted, not drawn as an image');
  assert.equal(logoFor('qwen3', LOGOS).color, true);
  assert.equal(logoFor('grok-4', [...LOGOS, 'grok-color.svg']).src, '/assets/grok-color.svg');
});

test('a discovered model is stamped with whatever mark its name matches', () => {
  assert.equal(modelIconFor('qwen3-next-80b-a3b', LOGOS), '/assets/qwen-color.svg');
  assert.equal(modelIconFor('gemma-3-27b', LOGOS), '/assets/gemma-color.svg');
  assert.equal(modelIconFor('claude-opus-5', LOGOS), '/assets/anthropic.svg');
  assert.equal(modelIconFor('kimi-k2', LOGOS), '/assets/moonshot.svg');
  assert.equal(modelIconFor('some-local-finetune', LOGOS), null);
});
