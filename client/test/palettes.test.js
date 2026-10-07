import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paletteFor,
  palettesFor,
  themeValue,
  paletteById,
  paletteChain,
  PALETTES,
  nextTheme
} from '../src/lib/palettes.js';
import { PRESETS, presetById } from '../src/lib/presets.js';

const DARK = (p) => presetById(p).palettes.dark;
const LIGHT = (p) => presetById(p).palettes.light;

test('a palette resolves to a mode plus the chain of palettes it builds on', () => {
  assert.equal(paletteFor('system', 'anthropic', true).id, 'anthropic-2026q3');
  assert.equal(paletteFor('system', 'anthropic', false).id, 'anthropic-light');
  assert.equal(paletteFor('system', 'openai', true).id, 'openai-2025');
  assert.equal(paletteFor('anthropic-2026q3', 'anthropic').mode, 'dark');
  assert.deepEqual(paletteChain('anthropic-2026q3'), ['anthropic-2025q2', 'anthropic-2026q3']);
  assert.deepEqual(paletteChain('anthropic-2025q2'), ['anthropic-2025q2']);
  assert.deepEqual(paletteChain('nonsense'), []);
});

test('every palette is complete, and builds only on a palette of the same preset and mode', () => {
  const ids = new Set(PALETTES.map(p => p.id));
  assert.equal(ids.size, PALETTES.length, 'palette ids are unique');
  for (const p of PALETTES) {
    assert.ok(presetById(p.preset).id === p.preset, p.id + ' names a real preset');
    assert.ok(p.mode === 'light' || p.mode === 'dark', p.id + ' has a mode');
    assert.ok(/^#[0-9a-f]{3,8}$/i.test(p.bg), p.id + ' has a boot background');
    if (p.base) {
      const base = paletteById(p.base);
      assert.ok(base, p.id + ' builds on a known palette');
      assert.equal(base.preset, p.preset, p.id + ' builds on its own preset');
      assert.equal(base.mode, p.mode, p.id + ' builds on its own mode');
    }
  }
  for (const preset of PRESETS) {
    assert.equal(paletteById(preset.palettes.dark)?.mode, 'dark', preset.id + ' dark default');
    assert.equal(paletteById(preset.palettes.light)?.mode, 'light', preset.id + ' light default');
    assert.equal(paletteById(preset.palettes.dark).preset, preset.id);
    assert.equal(paletteById(preset.palettes.light).preset, preset.id);
  }
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

test('the 2025 openai palette builds on the 2024 one rather than repeating it', () => {
  const p = paletteFor('openai-2025', 'openai');
  assert.equal(p.id, 'openai-2025');
  assert.deepEqual(paletteChain(p.id), ['openai-2024q1', 'openai-2025']);
  assert.equal(p.mode, 'dark');
  assert.equal(themeValue('openai-2025', 'openai'), 'openai-2025', 'the picker can select it');
  assert.equal(paletteFor('openai-2025', 'anthropic').id, 'anthropic-2026q3', 'falls back by darkness under the other preset');
  assert.deepEqual(palettesFor('openai').map(x => x.id), ['openai-light', 'openai-2024q1', 'openai-2025']);
});

test('the legacy palette is a distinct anthropic dark, not the default', () => {
  const leg = paletteFor('anthropic-legacy', 'anthropic');
  assert.equal(leg.mode, 'dark');
  assert.deepEqual(paletteChain(leg.id), ['anthropic-2025q2', 'anthropic-legacy']);
  assert.notEqual(paletteFor('dark', 'anthropic').id, 'anthropic-legacy', 'legacy is opt-in, never the default');
  assert.equal(paletteFor('anthropic-legacy', 'openai').id, 'openai-2025', 'falls back by darkness under the other preset');
  const ids = palettesFor('anthropic').map(p => p.id);
  assert.deepEqual(ids, ['anthropic-light', 'anthropic-legacy', 'anthropic-2025q2', 'anthropic-2026q3']);
});

test('every dark palette round-trips, so toggling to light and back can restore it', () => {
  for (const preset of ['anthropic', 'openai']) {
    const p = preset;
    const light = paletteById(LIGHT(p));
    assert.ok(light && light.mode === 'light' && light.preset === p, p + ' has a light default');
    for (const pal of palettesFor(p).filter(x => x.mode === 'dark')) {
      assert.equal(paletteFor(pal.id, p).id, pal.id, pal.id + ' survives a round trip');
    }
    assert.equal(paletteFor(LIGHT(p), p).id, LIGHT(p));
    assert.equal(paletteById(DARK(p)).mode, 'dark', p + ' dark default is dark');
  }
  assert.equal(paletteFor('dark', 'anthropic').id, 'anthropic-2026q3');
  assert.notEqual(paletteFor('dark', 'anthropic').id, 'anthropic-legacy');
});

test('nextTheme from a dark palette goes to light and remembers which dark it was', () => {
  const r = nextTheme({ themePref: DARK('anthropic'), preset: 'anthropic', prefersDark: true, lastDark: '' });
  assert.equal(r.theme, LIGHT('anthropic'));
  assert.equal(r.remember, DARK('anthropic'), 'so coming back restores this one');
});

test('nextTheme from light returns the remembered dark palette, not just the default', () => {
  const other = palettesFor('anthropic').find(p => p.mode === 'dark' && p.id !== DARK('anthropic'));
  if (!other) return; // only one dark palette for this preset
  const r = nextTheme({ themePref: LIGHT('anthropic'), preset: 'anthropic', prefersDark: false, lastDark: other.id });
  assert.equal(r.theme, other.id);
  assert.equal(r.remember, null);
});

test('nextTheme falls back to the preset default when nothing is remembered', () => {
  const r = nextTheme({ themePref: LIGHT('anthropic'), preset: 'anthropic', prefersDark: false, lastDark: '' });
  assert.equal(r.theme, DARK('anthropic'));
});

test('nextTheme ignores a remembered palette belonging to the other preset', () => {
  const r = nextTheme({ themePref: LIGHT('openai'), preset: 'openai', prefersDark: false, lastDark: DARK('anthropic') });
  assert.equal(r.theme, DARK('openai'));
});

test('nextTheme round-trips: dark to light and back lands where it started', () => {
  const start = DARK('anthropic');
  const toLight = nextTheme({ themePref: start, preset: 'anthropic', prefersDark: true, lastDark: '' });
  const back = nextTheme({ themePref: toLight.theme, preset: 'anthropic', prefersDark: false, lastDark: toLight.remember });
  assert.equal(back.theme, start);
});