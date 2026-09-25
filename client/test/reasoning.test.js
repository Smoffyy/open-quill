import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSteps, lastSentence, refineSentence, thoughtSeconds } from '../src/lib/reasoning.js';

test('lastSentence returns the newest COMPLETE sentence, so the header lags by one', () => {
  assert.equal(lastSentence('I need to edit this file. Then I will run'), 'I need to edit this file.');
  assert.equal(lastSentence('I need to edit this file. Then I will run it.'), 'Then I will run it.');
});

test('lastSentence does not treat a dotted filename as a sentence end', () => {
  assert.equal(lastSentence('Created it. Now thinking about beta.py...'), 'Now thinking about beta.py...');
  assert.equal(lastSentence("Done with alpha.py's functions."), "Done with alpha.py's functions.");
});

test('lastSentence does not treat a decimal point as a sentence end', () => {
  assert.equal(lastSentence('The value is 0.5 meters. Done here.'), 'The value is 0.5 meters.');
});

test('lastSentence yields nothing until the first sentence closes', () => {
  assert.equal(lastSentence('No punctuation yet so nothing'), '');
  assert.equal(lastSentence(''), '');
  assert.equal(lastSentence(null), '');
});

test('lastSentence skips fragments too short to read', () => {
  assert.equal(lastSentence('A. B. This is the real one.'), 'This is the real one.');
});

test('lastSentence strips markdown decoration so the header reads as plain prose', () => {
  assert.equal(lastSentence('* *Constraint Check:* No lists/bullets in the explanation.'), 'Constraint Check: No lists/bullets in the explanation.');
  assert.equal(lastSentence('**Constraint Check:** No lists/bullets in the explanation.'), 'Constraint Check: No lists/bullets in the explanation.');
  assert.equal(lastSentence('### Step 1: check the constraint.'), 'Step 1: check the constraint.');
  assert.equal(lastSentence('Run `pytest -k foo` to check.'), 'Run pytest -k foo to check.');
  assert.equal(lastSentence('- First check a*b is not italic.'), 'First check a*b is not italic.');
});

test('lastSentence truncates a very long sentence rather than overflowing the header', () => {
  const long = ('the quick brown fox jumps over the lazy dog ').repeat(12).trim() + '.';
  const out = lastSentence(long);
  assert.ok(out.length <= 151, out.length);
  assert.ok(out.endsWith('…'));
});

test('the preview never shows a quotation', () => {
  assert.equal(lastSentence('I checked the config. "Well maybe its this."'), 'I checked the config.');
  assert.equal(lastSentence('The user asked for "dark mode" in the settings.'),
    'The user asked for dark mode in the settings.');
  assert.equal(lastSentence('He said "no." Then I moved on.'), 'Then I moved on.',
    'a closing quote after the stop must not defeat the split');
  assert.equal(lastSentence("Done with alpha.py's functions."), "Done with alpha.py's functions.",
    'an apostrophe is not a quote mark');
});

test('the preview only shows a complete thought, never a fragment or an interjection', () => {
  for (const frag of ['Okay.', 'Hmm.', 'Right.', 'Done here.', 'Let me check.', 'Well maybe its this.']) {
    assert.equal(lastSentence(frag), '', frag);
  }
  assert.equal(lastSentence('Checked the router file already. Okay.'), 'Checked the router file already.');
});

test('a hedging opener is dropped and the thought recapitalised, but only on a word boundary', () => {
  assert.equal(lastSentence('Well, I should check the config file first.'), 'I should check the config file first.');
  assert.equal(lastSentence('so i need to open the router file next.'), 'I need to open the router file next.');
  assert.equal(lastSentence('Wellington is the capital of New Zealand.'), 'Wellington is the capital of New Zealand.');
  assert.equal(lastSentence('Sorting it out now.'), 'Sorting it out now.');
});

test('refineSentence carries no stray control characters in its patterns', async () => {
  const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/lib/reasoning.js', import.meta.url), 'utf8'));
  const bad = [...src].filter(c => c.charCodeAt(0) < 9 || (c.charCodeAt(0) > 13 && c.charCodeAt(0) < 32));
  assert.deepEqual(bad, [], 'a literal control byte here silently breaks the pattern it sits in');
  assert.equal(refineSentence(''), '');
  assert.equal(refineSentence(null), '');
});

test('parseSteps: blank lines make steps, single newlines make paragraphs inside one', () => {
  assert.deepEqual(parseSteps('one\ntwo\n\nthree'), [['one', 'two'], ['three']]);
  assert.deepEqual(parseSteps('solo'), [['solo']]);
  assert.deepEqual(parseSteps(''), []);
  assert.deepEqual(parseSteps('   \n\n   '), []);
});

test('parseSteps normalises CRLF so Windows reasoning groups the same way', () => {
  assert.deepEqual(parseSteps('one\r\ntwo\r\n\r\nthree'), [['one', 'two'], ['three']]);
});

test('thoughtSeconds rounds up to at least a second and ignores nonsense', () => {
  assert.equal(thoughtSeconds(0), 0);
  assert.equal(thoughtSeconds(-5), 0);
  assert.equal(thoughtSeconds(120), 1);
  assert.equal(thoughtSeconds(57000), 57);
});

test('lastSentence has no regex lookbehind (parse-time fatal on Safari < 16.4)', async () => {
  const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/lib/reasoning.js', import.meta.url), 'utf8'));
  assert.equal(/\(\?<[=!]/.test(src), false, 'lookbehind would take down the whole bundle, not just this module');
});
