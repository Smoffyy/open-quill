import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptSegments } from '../src/lib/promptview.js';
import { syncModelPrompt } from '../src/lib/promptblocks.js';

const prompt = syncModelPrompt({ kind: 'router' }, { system_prompt: 'You are helpful.', sandbox_allowed: 0, calculator_allowed: 1 }, {});
const joined = (segs) => segs.map(s => s.text).join('');

test('segments cover the whole prompt exactly', () => {
  assert.equal(joined(promptSegments(prompt)), prompt);
  assert.equal(joined(promptSegments('')), '');
  assert.deepEqual(promptSegments('Just my own words.'), [{ text: 'Just my own words.', tone: '' }]);
});

test('managed blocks are dimmed and the admin text is not', () => {
  const segs = promptSegments(prompt);
  assert.deepEqual(segs[0], { text: 'You are helpful.\n\n', tone: '' });
  const dimmed = segs.filter(s => s.tone === 'dim').map(s => s.text).join('');
  assert.ok(dimmed.includes('<tool name="calculator">') && dimmed.includes('<context>') && dimmed.includes('</tools>'));
});

test('the block being edited is shown at full strength', () => {
  const at = prompt.indexOf('Use the `calculator`') + 5;
  const segs = promptSegments(prompt, { caret: at });
  const plain = segs.filter(s => s.tone === '').map(s => s.text).join('');
  assert.ok(plain.includes('<tool name="calculator">'), 'the block under the caret is not dimmed');
  assert.ok(!plain.includes('<section name="user_instructions">'));
});

test('a block for a tool that is off is marked stale, and custom blocks are left alone', () => {
  const text = prompt.replace('</tools>', '<tool name="house_rules">\nBe kind.\n</tool>\n</tools>');
  const segs = promptSegments(text, { eligible: new Set(['section:user_instructions']) });
  const stale = segs.filter(s => s.tone === 'stale').map(s => s.text).join('');
  assert.ok(stale.includes('<tool name="calculator">'));
  assert.ok(!stale.includes('user_instructions'));
  const plain = segs.filter(s => s.tone === '').map(s => s.text).join('');
  assert.ok(plain.includes('<tool name="house_rules">\nBe kind.\n</tool>'), 'an admin-written block keeps full strength');
});