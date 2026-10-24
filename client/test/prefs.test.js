import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialPrefs, presetDefaults, shownThemeFallback } from '../src/lib/settingsdefaults.js';
import { LAYOUTS, layoutOf } from '../src/lib/layout.js';
import { PRESETS, DEFAULT_PRESET, presetById } from '../src/lib/presets.js';
import { PALETTES, paletteChain, paletteFor, palettesFor, themeValue, paletteById, nextTheme } from '../src/lib/palettes.js';
import { browserName, systemName } from '../src/lib/useragent.js';
import { relativeParts } from '../src/lib/relativetime.js';
import { canManage, canAssign } from '../src/lib/roles.js';
import {
  comboFromEvent, isValidCombo, isChord, chordParts, sanitizeKeybinds, resolveKeybinds, keybindIndex, keybindConflicts,
  leaderCombo, chordMenu, presetBinds, activePresetId, exportKeybinds, importKeybinds, KEYBIND_ACTIONS, KEYBIND_BY_ID, DEFAULT_LEADER
} from '../src/lib/keybinds.js';

test('someone with no stored theme stays on the system theme, and a stored one is kept', () => {
  assert.equal(initialPrefs({}, LAYOUTS.card).theme, 'system');
  assert.equal(initialPrefs(null, LAYOUTS.pill).theme, 'system');
  assert.equal(initialPrefs({ density: 'compact' }, LAYOUTS.card).theme, 'system');
  assert.equal(initialPrefs({ theme: 'anthropic-2025q2' }, LAYOUTS.card).theme, 'anthropic-2025q2');
  assert.equal(initialPrefs({ theme: 'oled' }, LAYOUTS.card).theme, 'dark', 'the retired oled value reads as dark');
});

test('the reveal style is seeded from the old typewriter switch', () => {
  assert.equal(initialPrefs({ typewriter: false }, LAYOUTS.card).revealStyle, 'instant');
  assert.equal(initialPrefs({ animations: false }, LAYOUTS.card).revealStyle, 'instant');
  assert.equal(initialPrefs({}, LAYOUTS.card).revealStyle, 'modern');
  assert.equal(initialPrefs({ revealStyle: 'legacy', typewriter: false }, LAYOUTS.card).revealStyle, 'legacy');
});

test('each layout starts from its own cursor defaults, and a reset keeps the shown mode', () => {
  assert.equal(presetDefaults(LAYOUTS.pill).streamCursor, true);
  assert.equal(presetDefaults(LAYOUTS.pill).cursorStyle, 'circle');
  assert.equal(presetDefaults(LAYOUTS.card).streamCursor, false);
  assert.equal(presetDefaults(LAYOUTS.card).cursorStyle, 'block');
  assert.equal(shownThemeFallback('light'), 'light');
  assert.equal(shownThemeFallback('dark'), 'dark');
  assert.equal(shownThemeFallback(null), 'system');
});

test('browsers and systems are named by their most specific claim', () => {
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

test('relative times pick the largest whole unit, rounding up into the next', () => {
  const now = Date.UTC(2026, 8, 24, 12, 0, 0);
  assert.deepEqual(relativeParts(now - 20 * 1000, now), { value: 0, unit: 'second' });
  assert.deepEqual(relativeParts(now - 5 * 60 * 1000, now), { value: -5, unit: 'minute' });
  assert.deepEqual(relativeParts(now - 3 * 3600 * 1000, now), { value: -3, unit: 'hour' });
  assert.deepEqual(relativeParts(now - 2 * 86400 * 1000, now), { value: -2, unit: 'day' });
  assert.deepEqual(relativeParts(now + 2 * 86400 * 1000, now), { value: 2, unit: 'day' });
  assert.deepEqual(relativeParts(now - 3599 * 1000, now), { value: -1, unit: 'hour' });
  assert.equal(relativeParts(0), null);
  assert.equal(relativeParts(undefined), null);
  assert.equal(relativeParts('soon'), null);
});

test('only the owner manages publishers, and nobody manages or grants their own rank', () => {
  assert.equal(canManage('owner', 'publisher'), true);
  assert.equal(canManage('publisher', 'publisher'), false);
  assert.equal(canManage('publisher', 'editor'), true);
  assert.equal(canManage('editor', 'editor'), false);
  assert.equal(canManage('editor', 'member'), true);
  assert.equal(canManage('publisher', 'owner'), false);
  assert.equal(canAssign('owner', 'publisher'), true);
  assert.equal(canAssign('owner', 'owner'), false, 'ownership is never handed out here');
  assert.equal(canAssign('publisher', 'publisher'), false);
  assert.equal(canAssign('publisher', 'editor'), true);
  assert.equal(canAssign('editor', 'editor'), false);
  assert.equal(canAssign('editor', 'member'), true);
  assert.equal(canAssign('owner', 'nonsense'), false);
});

const ev = (o) => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

test('comboFromEvent normalises a key event into one stored combo', () => {
  const cases = [
    [{ key: 'k', code: 'KeyK', ctrlKey: true }, 'mod+k'],
    [{ key: 'k', code: 'KeyK', metaKey: true }, 'mod+k'],
    [{ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true }, 'mod+shift+k'],
    [{ key: '3', code: 'Digit3', altKey: true }, 'alt+3'],
    [{ key: '∑', code: 'KeyW', altKey: true }, 'alt+w'],
    [{ key: 'Dead', code: 'KeyI', altKey: true }, 'alt+i'],
    [{ key: 'Unidentified', code: 'KeyJ', ctrlKey: true }, 'mod+j'],
    [{ key: '?', code: 'Slash', shiftKey: true }, '?'],
    [{ key: 'Enter', code: 'Enter', shiftKey: true }, 'shift+Enter'],
    [{ key: ' ', code: 'Space' }, 'space'],
    [{ key: 'Control' }, ''],
    [{ key: 'Shift' }, ''],
    [{ key: 'Alt' }, ''],
    [{ key: 'Meta' }, '']
  ];
  for (const [e, combo] of cases) assert.equal(comboFromEvent(ev(e)), combo, JSON.stringify(e));
});

test('isValidCombo accepts real keys and chords, and rejects junk a corrupt import could carry', () => {
  for (const ok of ['mod+k', 'mod+alt+shift+k', 'space l', 'a', '3', '?', '/', 'space', 'Enter', 'Escape', 'ArrowUp', 'F5', 'mod+ArrowDown']) {
    assert.equal(isValidCombo(ok), true, ok);
  }
  for (const junk of ['mod+mod+k', 'mod', '', 'space l k', '((((', '!!', '+++', 'mod+', '   ']) {
    assert.equal(isValidCombo(junk), false, junk);
  }
  assert.equal(isChord('space l'), true);
  assert.equal(isChord('mod+k'), false);
  assert.deepEqual(chordParts('space l'), ['space', 'l']);
});

test('sanitizeKeybinds drops junk, unknown ids, fixed actions and values equal to the default', () => {
  const fixed = KEYBIND_ACTIONS.find(a => a.fixed);
  const raw = { commandPalette: 'mod+j', nonsense: 'mod+z', broken: '+++', bad: 42 };
  if (fixed) raw[fixed.id] = 'mod+q';
  const out = sanitizeKeybinds(raw);
  assert.equal(out.commandPalette, 'mod+j');
  assert.equal('nonsense' in out, false);
  assert.equal('broken' in out, false);
  if (fixed) assert.equal(fixed.id in out, false, 'fixed actions ignore stored overrides');
  assert.deepEqual(sanitizeKeybinds({ commandPalette: KEYBIND_BY_ID.commandPalette.def }), {});
});

test('resolveKeybinds merges valid overrides over defaults and covers every action', () => {
  const binds = resolveKeybinds({ keybinds: { commandPalette: 'mod+j' } });
  assert.equal(binds.commandPalette, 'mod+j');
  for (const a of KEYBIND_ACTIONS) assert.ok(binds[a.id], `${a.id} resolved`);
  assert.equal(resolveKeybinds({ keybinds: { commandPalette: 'not a combo!!' } }).commandPalette, KEYBIND_BY_ID.commandPalette.def);
});

test('every default binding is valid and the defaults do not collide', () => {
  const binds = resolveKeybinds({});
  for (const a of KEYBIND_ACTIONS) assert.equal(isValidCombo(binds[a.id]), true, `${a.id}: ${binds[a.id]}`);
  assert.equal(keybindConflicts(binds).size, 0, 'shipped defaults must not conflict');
});

test('keybindIndex maps exact combos, gives a duplicate to the first action and conflicts report it', () => {
  const index = keybindIndex(resolveKeybinds({}));
  assert.equal(index.get(KEYBIND_BY_ID.commandPalette.def).id, 'commandPalette');
  assert.ok(index.chords instanceof Map);
  const dupe = 'mod+alt+shift+y';
  const ids = KEYBIND_ACTIONS.filter(a => !a.fixed).map(a => a.id);
  const binds = resolveKeybinds({});
  binds[ids[0]] = dupe;
  binds[ids[1]] = dupe;
  assert.equal(keybindIndex(binds).get(dupe).id, ids[0]);
  assert.equal(keybindConflicts(binds).has(dupe), true);
});

test('leader and chord menu only offer what can actually be typed', () => {
  assert.equal(leaderCombo({ leaderKey: 'g' }), 'g');
  assert.equal(leaderCombo({ leaderKey: 'space l' }), DEFAULT_LEADER);
  assert.equal(leaderCombo({ leaderKey: '!!' }), DEFAULT_LEADER);
  assert.equal(leaderCombo({}), DEFAULT_LEADER);
  const binds = resolveKeybinds({});
  const ids = KEYBIND_ACTIONS.filter(a => !a.fixed).map(a => a.id);
  binds[ids[0]] = 'space l';
  binds[ids[1]] = 'space k';
  assert.deepEqual(chordMenu(binds, 'space').map(m => m.key).sort(), ['k', 'l']);
  assert.deepEqual(chordMenu(binds, 'g'), []);
});

test('keybind presets and exports round-trip, and a malformed import is refused or sanitized', () => {
  const vim = presetBinds('vim');
  if (Object.keys(vim).length) assert.equal(activePresetId({ keybinds: vim }), 'vim');
  assert.equal(activePresetId({ keybinds: {} }), 'default');
  const payload = exportKeybinds({ keybinds: { commandPalette: 'mod+j' } });
  assert.equal(payload.kind, 'open-quill-keybinds');
  assert.deepEqual(payload.binds, { commandPalette: 'mod+j' });
  assert.equal(importKeybinds(payload).commandPalette, 'mod+j');
  assert.equal(importKeybinds('not an object'), null);
  assert.equal(importKeybinds(null), null);
  assert.deepEqual(importKeybinds({ binds: { commandPalette: '((((' } }), {});
  assert.deepEqual(importKeybinds({ binds: { madeUpAction: 'mod+j' } }), {});
});

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

test('legacy values and palettes from the other preset fall back by darkness, never break', () => {
  for (const legacy of ['dark', 'oled', 'anthropic', 'openai']) {
    assert.equal(paletteFor(legacy, 'anthropic').id, 'anthropic-2026q3', legacy);
    assert.equal(paletteFor(legacy, 'openai').id, 'openai-2025', legacy);
  }
  assert.equal(paletteFor('light', 'openai').id, 'openai-light');
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
  assert.deepEqual(palettesFor('anthropic').map(x => x.id), ['anthropic-light', 'anthropic-legacy', 'anthropic-2025q2', 'anthropic-2026q3']);
  assert.deepEqual(palettesFor('openai').map(x => x.id), ['openai-light', 'openai-2024q1', 'openai-2025']);
});

test('variant palettes build on their base and are opt-in, never the default', () => {
  assert.deepEqual(paletteChain('openai-2025'), ['openai-2024q1', 'openai-2025']);
  assert.equal(themeValue('openai-2025', 'openai'), 'openai-2025', 'the picker can select it');
  const leg = paletteFor('anthropic-legacy', 'anthropic');
  assert.equal(leg.mode, 'dark');
  assert.deepEqual(paletteChain(leg.id), ['anthropic-2025q2', 'anthropic-legacy']);
  assert.notEqual(paletteFor('dark', 'anthropic').id, 'anthropic-legacy', 'legacy is opt-in, never the default');
  assert.equal(paletteFor('anthropic-legacy', 'openai').id, 'openai-2025', 'falls back by darkness under the other preset');
});

test('every dark palette survives a round trip, so toggling to light and back can restore it', () => {
  for (const p of ['anthropic', 'openai']) {
    const light = paletteById(LIGHT(p));
    assert.ok(light && light.mode === 'light' && light.preset === p, p + ' has a light default');
    for (const pal of palettesFor(p).filter(x => x.mode === 'dark')) {
      assert.equal(paletteFor(pal.id, p).id, pal.id, pal.id + ' survives a round trip');
    }
    assert.equal(paletteFor(LIGHT(p), p).id, LIGHT(p));
  }
});

test('nextTheme goes dark to light remembering the dark, and back to it', () => {
  const start = DARK('anthropic');
  const toLight = nextTheme({ themePref: start, preset: 'anthropic', prefersDark: true, lastDark: '' });
  assert.equal(toLight.theme, LIGHT('anthropic'));
  assert.equal(toLight.remember, start);
  const back = nextTheme({ themePref: toLight.theme, preset: 'anthropic', prefersDark: false, lastDark: toLight.remember });
  assert.equal(back.theme, start);
  const other = palettesFor('anthropic').find(p => p.mode === 'dark' && p.id !== start);
  const toOther = nextTheme({ themePref: LIGHT('anthropic'), preset: 'anthropic', prefersDark: false, lastDark: other.id });
  assert.equal(toOther.theme, other.id);
  assert.equal(toOther.remember, null);
});

test('nextTheme falls back to the preset default without a usable remembered palette', () => {
  assert.equal(nextTheme({ themePref: LIGHT('anthropic'), preset: 'anthropic', prefersDark: false, lastDark: '' }).theme, DARK('anthropic'));
  assert.equal(nextTheme({ themePref: LIGHT('openai'), preset: 'openai', prefersDark: false, lastDark: DARK('anthropic') }).theme, DARK('openai'));
});

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const styles = path.join(src, 'styles');

function walk(dir, ext, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) walk(full, ext, out);
    else if (ext.some(e => name.name.endsWith(e))) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(src, f).split(path.sep).join('/');
const read = (f) => fs.readFileSync(f, 'utf8');
const css = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '');

function rules(text) {
  const out = [];
  const flat = text.replace(/@media[^{]+\{/g, '').replace(/@import[^;]+;/g, '');
  for (const chunk of flat.split('}')) {
    const at = chunk.indexOf('{');
    if (at === -1) continue;
    out.push({ selector: chunk.slice(0, at).trim(), body: chunk.slice(at + 1).trim() });
  }
  return out;
}

function importOrder(file, out = []) {
  for (const m of read(file).matchAll(/@import\s+'([^']+)'/g)) {
    const next = path.join(path.dirname(file), m[1]);
    out.push(next);
    importOrder(next, out);
  }
  return out;
}

const layoutDirs = fs.readdirSync(path.join(styles, 'layouts'));
const declared = (body) => body.split(';').map(s => s.trim()).filter(Boolean).map(s => s.split(':')[0].trim());

test('every layout defines the same flags, with the same kind of value', () => {
  const keys = Object.keys(LAYOUTS.card).sort();
  for (const layout of Object.values(LAYOUTS)) {
    assert.deepEqual(Object.keys(layout).sort(), keys, layout.id + ' declares every flag');
    for (const k of keys) assert.equal(typeof layout[k], typeof LAYOUTS.card[k], layout.id + '.' + k);
  }
});

test('every preset names a layout that exists, and has a stylesheet folder for it', () => {
  for (const p of PRESETS) {
    assert.ok(LAYOUTS[p.layout], p.id + ' names layout ' + p.layout);
    assert.equal(layoutOf(p.id), LAYOUTS[p.layout]);
  }
  assert.equal(layoutOf(undefined), LAYOUTS[presetById(DEFAULT_PRESET).layout]);
  assert.deepEqual([...layoutDirs].sort(), Object.keys(LAYOUTS).sort(), 'one folder under styles/layouts per layout');
});

test('app.css pulls in every palette and layout stylesheet', () => {
  const order = importOrder(path.join(styles, 'app.css')).map(rel);
  for (const f of walk(path.join(styles, 'palettes'), ['.css']).concat(walk(path.join(styles, 'layouts'), ['.css']))) {
    assert.ok(order.includes(rel(f)), rel(f) + ' is imported');
  }
});

test('stylesheets are keyed by role: no preset selectors, and each layout stays in its own folder', () => {
  for (const f of walk(styles, ['.css'])) {
    const name = rel(f);
    const text = css(f);
    assert.ok(!/data-preset/.test(text), name + ' must not select on data-preset');
    assert.ok(!/data-theme="(?!light"|dark")/.test(text), name + ' may only use data-theme for light or dark');
    for (const m of text.matchAll(/data-layout="([^"]+)"/g)) {
      assert.ok(name.startsWith('styles/layouts/' + m[1] + '/'), name + ' mentions the ' + m[1] + ' layout outside styles/layouts/' + m[1]);
    }
  }
});

test('layout files only select under their own layout and never need !important', () => {
  for (const id of layoutDirs) {
    for (const f of walk(path.join(styles, 'layouts', id), ['.css'])) {
      const text = css(f);
      assert.ok(!/!important/.test(text), rel(f) + ' uses !important');
      for (const { selector } of rules(text)) {
        for (const part of selector.split(',').map(s => s.trim()).filter(Boolean)) {
          assert.ok(part.includes('data-layout="' + id + '"'), rel(f) + ' has a selector outside its layout: ' + part);
        }
      }
    }
  }
});

test('every layout declares the same layout tokens', () => {
  const sets = layoutDirs.map(id => {
    const blocks = rules(css(path.join(styles, 'layouts', id, 'tokens.css')));
    assert.equal(blocks.length, 1, id + '/tokens.css is a single block');
    assert.equal(blocks[0].selector, ':root[data-layout="' + id + '"]');
    const names = declared(blocks[0].body);
    assert.ok(names.every(n => n.startsWith('--')), id + '/tokens.css only declares custom properties');
    return [id, names.sort()];
  });
  for (const [id, names] of sets) assert.deepEqual(names, sets[0][1], id + ' declares the same tokens as ' + sets[0][0]);
});

test('palette files only declare tokens for registered palettes, base before variant', () => {
  const known = new Set(PALETTES.map(p => p.id));
  const seen = [];
  for (const f of importOrder(path.join(styles, 'app.css')).filter(f => rel(f).startsWith('styles/palettes/'))) {
    for (const { selector, body } of rules(css(f))) {
      const m = /^:root\[data-palette~="([^"]+)"\]( ::selection)?$/.exec(selector);
      assert.ok(m, rel(f) + ' selects something other than a palette: ' + selector);
      assert.ok(known.has(m[1]), rel(f) + ' styles unknown palette ' + m[1]);
      if (m[2]) continue;
      assert.ok(declared(body).every(n => n.startsWith('--')), rel(f) + ' sets a property other than a token for ' + m[1]);
      seen.push(m[1]);
    }
  }
  for (const p of PALETTES) {
    assert.ok(seen.includes(p.id), p.id + ' has a token block');
    const chain = paletteChain(p.id);
    for (let i = 1; i < chain.length; i++) {
      assert.ok(seen.indexOf(chain[i - 1]) < seen.indexOf(chain[i]), chain[i] + ' comes after the palette it builds on');
    }
  }
});

test('components branch on layout flags, not on which preset is active', () => {
  const ids = PRESETS.map(p => p.id).join('|');
  const compare = new RegExp("(===|!==)\\s*'(" + ids + ")'|'(" + ids + ")'\\s*(===|!==)");
  for (const f of walk(src, ['.js', '.jsx'])) {
    const name = rel(f);
    if (name.startsWith('locales/') || name === 'lib/presets.js') continue;
    read(f).split('\n').forEach((line, i) => {
      if (compare.test(line)) assert.fail(name + ':' + (i + 1) + ' compares a preset by name; read lib/presets.js or a flag from lib/layout.js instead');
    });
  }
});

test('every layout flag a component reads exists', () => {
  const known = new Set(Object.keys(LAYOUTS.card));
  for (const f of walk(src, ['.js', '.jsx'])) {
    if (rel(f) === 'lib/layout.js') continue;
    for (const m of read(f).matchAll(/(?<![\w/.])layout\.([A-Za-z]+)\b/g)) {
      assert.ok(known.has(m[1]), rel(f) + ' reads layout.' + m[1] + ' which no layout defines');
    }
  }
});