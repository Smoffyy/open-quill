import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paletteFor,
  palettesFor,
  themeValue,
  paletteById,
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  presetOf,
  nextTheme
} from '../src/lib/palettes.js';

test('a palette resolves to a theme plus an optional palette attribute', () => {
  assert.equal(paletteFor('system', 'anthropic', true).id, 'anthropic-2026q3');
  assert.equal(paletteFor('system', 'anthropic', false).id, 'anthropic-light');
  assert.equal(paletteFor('system', 'openai', true).id, 'openai-2025');
  assert.equal(paletteFor('anthropic-2026q3', 'anthropic').theme, 'anthropic');
  assert.equal(paletteFor('anthropic-2026q3', 'anthropic').palette, '2026q3');
  assert.equal(paletteFor('anthropic-2025q2', 'anthropic').palette, '', 'the older dark carries no palette attribute');
});

test('legacy theme values still land on the preset default', () => {
  for (const legacy of ['dark', 'oled', 'anthropic', 'openai']) {
    assert.equal(paletteFor(legacy, 'anthropic').id, 'anthropic-2026q3', legacy);
    assert.equal(paletteFor(legacy, 'openai').id, 'openai-2025', legacy);
  }
  assert.equal(paletteFor('light', 'openai').id, 'openai-light');
});

test('a palette from the other preset falls back by darkness, never breaks', () => {
  assert.equal(paletteFor('anthropic-2026q3', 'openai').id, 'openai-2025');
  assert.equal(paletteFor('anthropic-light', 'openai').id, 'openai-light');
  assert.equal(paletteFor('openai-2024q1', 'anthropic').id, 'anthropic-2026q3');
  assert.equal(paletteFor('nonsense', 'anthropic', true).id, 'anthropic-2026q3');
  assert.equal(paletteFor(null, 'anthropic', false).id, 'anthropic-light');
});

test('the theme picker only ever offers its own preset a value it can select', () => {
  for (const preset of ['anthropic', 'openai']) {
    const ids = palettesFor(preset).map(p => p.id).concat('system');
    for (const stored of ['system', 'light', 'dark', 'oled', 'anthropic-2025q2', 'anthropic-legacy', 'openai-light', '', 'junk']) {
      assert.ok(ids.includes(themeValue(stored, preset)), preset + ' / ' + stored);
    }
  }
  assert.equal(palettesFor('anthropic').length, 4);
  assert.equal(palettesFor('openai').length, 3);
});

test('the 2025 openai palette is a token override, not a new theme value', () => {
  const p = paletteFor('openai-2025', 'openai');
  assert.equal(p.id, 'openai-2025');
  assert.equal(p.theme, 'openai', 'a new data-theme would silently drop every rule scoped to the old one');
  assert.equal(p.palette, '2025');
  assert.ok(p.dark);
  assert.equal(themeValue('openai-2025', 'openai'), 'openai-2025', 'the picker can select it');
  assert.equal(paletteFor('openai-2025', 'anthropic').id, 'anthropic-2026q3', 'falls back by darkness under the other preset');
  assert.deepEqual(palettesFor('openai').map(x => x.id), ['openai-light', 'openai-2024q1', 'openai-2025']);
});

test('the legacy palette is a distinct anthropic dark, not the default', () => {
  const leg = paletteFor('anthropic-legacy', 'anthropic');
  assert.equal(leg.theme, 'anthropic');
  assert.equal(leg.palette, 'legacy');
  assert.notEqual(paletteFor('dark', 'anthropic').id, 'anthropic-legacy', 'legacy is opt-in, never the default');
  assert.equal(paletteFor('anthropic-legacy', 'openai').id, 'openai-2025', 'falls back by darkness under the other preset');
  const ids = palettesFor('anthropic').map(p => p.id);
  assert.deepEqual(ids, ['anthropic-light', 'anthropic-legacy', 'anthropic-2025q2', 'anthropic-2026q3']);
});

test('every dark palette round-trips, so toggling to light and back can restore it', () => {
  for (const preset of ['anthropic', 'openai']) {
    const p = presetOf(preset);
    const light = paletteById(DEFAULT_LIGHT[p]);
    assert.ok(light && !light.dark && light.preset === p, p + ' has a light default');
    for (const pal of palettesFor(p).filter(x => x.dark)) {
      assert.equal(paletteFor(pal.id, p).id, pal.id, pal.id + ' survives a round trip');
    }
    assert.equal(paletteFor(DEFAULT_LIGHT[p], p).id, DEFAULT_LIGHT[p]);
    assert.ok(paletteById(DEFAULT_DARK[p]).dark, p + ' dark default is dark');
  }
  assert.equal(paletteFor('dark', 'anthropic').id, 'anthropic-2026q3');
  assert.notEqual(paletteFor('dark', 'anthropic').id, 'anthropic-legacy');
});

test('nextTheme from a dark palette goes to light and remembers which dark it was', () => {
  const r = nextTheme({ themePref: DEFAULT_DARK.anthropic, preset: 'anthropic', prefersDark: true, lastDark: '' });
  assert.equal(r.theme, DEFAULT_LIGHT.anthropic);
  assert.equal(r.remember, DEFAULT_DARK.anthropic, 'so coming back restores this one');
});

test('nextTheme from light returns the remembered dark palette, not just the default', () => {
  const other = palettesFor('anthropic').find(p => p.dark && p.id !== DEFAULT_DARK.anthropic);
  if (!other) return; // only one dark palette for this preset
  const r = nextTheme({ themePref: DEFAULT_LIGHT.anthropic, preset: 'anthropic', prefersDark: false, lastDark: other.id });
  assert.equal(r.theme, other.id);
  assert.equal(r.remember, null);
});

test('nextTheme falls back to the preset default when nothing is remembered', () => {
  const r = nextTheme({ themePref: DEFAULT_LIGHT.anthropic, preset: 'anthropic', prefersDark: false, lastDark: '' });
  assert.equal(r.theme, DEFAULT_DARK.anthropic);
});

test('nextTheme ignores a remembered palette belonging to the other preset', () => {
  // Switching preset must not drag the old preset's palette across; ~40 rules are
  // scoped to the existing data-theme values.
  const r = nextTheme({ themePref: DEFAULT_LIGHT.openai, preset: 'openai', prefersDark: false, lastDark: DEFAULT_DARK.anthropic });
  assert.equal(r.theme, DEFAULT_DARK.openai);
});

test('nextTheme round-trips: dark to light and back lands where it started', () => {
  const start = DEFAULT_DARK.anthropic;
  const toLight = nextTheme({ themePref: start, preset: 'anthropic', prefersDark: true, lastDark: '' });
  const back = nextTheme({ themePref: toLight.theme, preset: 'anthropic', prefersDark: false, lastDark: toLight.remember });
  assert.equal(back.theme, start);
});
