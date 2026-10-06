import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS } from '../src/lib/layout.js';

// ---- reveal styles --------------------------------------------------------

test('resolveReveal prefers the named style and falls back to the legacy booleans', async () => {
  const { resolveReveal } = await import('../src/lib/reveal.js');
  assert.equal(resolveReveal({ revealStyle: 'instant' }, LAYOUTS.card), 'instant');
  assert.equal(resolveReveal({ revealStyle: 'modern' }, LAYOUTS.card), 'modern');
  assert.equal(resolveReveal({ revealStyle: 'legacy' }, LAYOUTS.card), 'legacy');
  // `typewriter` is retired: it resolves to the current default, not to the
  // style that inherited its behaviour.
  assert.equal(resolveReveal({ revealStyle: 'typewriter' }, LAYOUTS.card), 'modern');
  assert.equal(resolveReveal({}, LAYOUTS.card), 'modern');
  assert.equal(resolveReveal(null, LAYOUTS.card), 'modern');
  assert.equal(resolveReveal({ typewriter: false }, LAYOUTS.card), 'instant');
  assert.equal(resolveReveal({ animations: false }, LAYOUTS.card), 'instant');
  // The named style wins over a stale pre-split boolean sitting beside it.
  assert.equal(resolveReveal({ typewriter: false, revealStyle: 'legacy' }, LAYOUTS.card), 'legacy');
});

test('a retired or unknown style resolves to the default reveal, never to nothing', async () => {
  const { resolveReveal } = await import('../src/lib/reveal.js');
  // 'fade' shipped briefly and was removed; a pref still holding it must keep
  // revealing rather than silently degrade to instant.
  for (const v of ['fade', 'glide', 'blur', 'sparkle', '', 0, {}]) {
    assert.equal(resolveReveal({ revealStyle: v }, LAYOUTS.card), 'modern', String(v));
  }
  // ...unless the legacy boolean genuinely said off.
  assert.equal(resolveReveal({ revealStyle: 'fade', typewriter: false }, LAYOUTS.card), 'instant');
});

test('the OpenAI preset has no reveal, whatever the pref says', async () => {
  const { resolveReveal, REVEAL_STYLES } = await import('../src/lib/reveal.js');
  for (const s of REVEAL_STYLES) assert.equal(resolveReveal({ revealStyle: s }, LAYOUTS.pill), 'instant');
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