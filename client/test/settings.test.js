import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPrefs, presetDefaults, shownThemeFallback } from '../src/lib/settingsdefaults.js';
import { browserName, systemName } from '../src/lib/useragent.js';
import { relativeParts } from '../src/lib/relativetime.js';

test('someone with no stored theme stays on the system theme', () => {
  assert.equal(initialPrefs({}, false).theme, 'system');
  assert.equal(initialPrefs(null, true).theme, 'system');
  assert.equal(initialPrefs({ density: 'compact' }, false).theme, 'system');
});

test('a stored theme is kept as it is, and the retired oled value reads as dark', () => {
  assert.equal(initialPrefs({ theme: 'anthropic-2025q2' }, false).theme, 'anthropic-2025q2');
  assert.equal(initialPrefs({ theme: 'oled' }, false).theme, 'dark');
});

test('the reveal style is seeded from the old typewriter switch', () => {
  assert.equal(initialPrefs({ typewriter: false }, false).revealStyle, 'instant');
  assert.equal(initialPrefs({ animations: false }, false).revealStyle, 'instant');
  assert.equal(initialPrefs({}, false).revealStyle, 'modern');
  assert.equal(initialPrefs({ revealStyle: 'legacy', typewriter: false }, false).revealStyle, 'legacy');
});

test('each preset starts from its own cursor defaults', () => {
  assert.equal(presetDefaults(true).streamCursor, true);
  assert.equal(presetDefaults(true).cursorStyle, 'circle');
  assert.equal(presetDefaults(false).streamCursor, false);
  assert.equal(presetDefaults(false).cursorStyle, 'block');
});

test('resetting keeps the light or dark the page is showing', () => {
  assert.equal(shownThemeFallback('light'), 'light');
  assert.equal(shownThemeFallback('anthropic'), 'dark');
  assert.equal(shownThemeFallback('openai'), 'dark');
  assert.equal(shownThemeFallback(null), 'system');
});

test('browsers are named by their most specific claim', () => {
  const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0';
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  assert.equal(browserName(edge), 'Edge');
  assert.equal(browserName(chrome), 'Chrome');
  assert.equal(browserName(safari), 'Safari');
  assert.equal(browserName('curl/8.0'), null);
  assert.equal(systemName(edge), 'Windows');
  assert.equal(systemName(chrome), 'macOS');
  assert.equal(systemName(safari), 'iOS');
  assert.equal(systemName(''), null);
});

test('relative times pick the largest whole unit', () => {
  const now = Date.UTC(2026, 8, 24, 12, 0, 0);
  assert.deepEqual(relativeParts(now - 20 * 1000, now), { value: 0, unit: 'second' });
  assert.deepEqual(relativeParts(now - 5 * 60 * 1000, now), { value: -5, unit: 'minute' });
  assert.deepEqual(relativeParts(now - 3 * 3600 * 1000, now), { value: -3, unit: 'hour' });
  assert.deepEqual(relativeParts(now - 2 * 86400 * 1000, now), { value: -2, unit: 'day' });
  assert.deepEqual(relativeParts(now + 2 * 86400 * 1000, now), { value: 2, unit: 'day' });
});

test('a moment just short of the next unit rounds up into it', () => {
  const now = Date.UTC(2026, 8, 24, 12, 0, 0);
  assert.deepEqual(relativeParts(now - 3599 * 1000, now), { value: -1, unit: 'hour' });
});

test('a missing or broken timestamp has no relative time', () => {
  assert.equal(relativeParts(0), null);
  assert.equal(relativeParts(undefined), null);
  assert.equal(relativeParts('soon'), null);
});
