import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- reveal styles --------------------------------------------------------

test('resolveReveal prefers the named style and falls back to the legacy booleans', async () => {
  const { resolveReveal } = await import('../src/lib/reveal.js');
  assert.equal(resolveReveal({ revealStyle: 'instant' }, 'anthropic'), 'instant');
  assert.equal(resolveReveal({ revealStyle: 'modern' }, 'anthropic'), 'modern');
  assert.equal(resolveReveal({ revealStyle: 'legacy' }, 'anthropic'), 'legacy');
  // `typewriter` is retired: it resolves to the current default, not to the
  // style that inherited its behaviour.
  assert.equal(resolveReveal({ revealStyle: 'typewriter' }, 'anthropic'), 'modern');
  assert.equal(resolveReveal({}, 'anthropic'), 'modern');
  assert.equal(resolveReveal(null, 'anthropic'), 'modern');
  assert.equal(resolveReveal({ typewriter: false }, 'anthropic'), 'instant');
  assert.equal(resolveReveal({ animations: false }, 'anthropic'), 'instant');
  // The named style wins over a stale pre-split boolean sitting beside it.
  assert.equal(resolveReveal({ typewriter: false, revealStyle: 'legacy' }, 'anthropic'), 'legacy');
});

test('a retired or unknown style resolves to the default reveal, never to nothing', async () => {
  const { resolveReveal } = await import('../src/lib/reveal.js');
  // 'fade' shipped briefly and was removed; a pref still holding it must keep
  // revealing rather than silently degrade to instant.
  for (const v of ['fade', 'glide', 'blur', 'sparkle', '', 0, {}]) {
    assert.equal(resolveReveal({ revealStyle: v }, 'anthropic'), 'modern', String(v));
  }
  // ...unless the legacy boolean genuinely said off.
  assert.equal(resolveReveal({ revealStyle: 'fade', typewriter: false }, 'anthropic'), 'instant');
});

test('the OpenAI preset has no reveal, whatever the pref says', async () => {
  const { resolveReveal, REVEAL_STYLES } = await import('../src/lib/reveal.js');
  for (const s of REVEAL_STYLES) assert.equal(resolveReveal({ revealStyle: s }, 'openai'), 'instant');
});

test('revealSpeedMs clamps anything unreadable to the default interval', async () => {
  const { revealSpeedMs } = await import('../src/lib/reveal.js');
  assert.equal(revealSpeedMs(40), 40);
  assert.equal(revealSpeedMs('70'), 70);
  assert.equal(revealSpeedMs(0), 0);
  for (const v of [null, undefined, 'x', {}]) assert.equal(revealSpeedMs(v), 40, String(v));
  assert.equal(revealSpeedMs(-50), 0);
  assert.equal(revealSpeedMs(9999), 100);
});
