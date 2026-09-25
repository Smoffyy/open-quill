import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comboFromEvent,
  isValidCombo,
  isChord,
  chordParts,
  sanitizeKeybinds,
  resolveKeybinds,
  keybindIndex,
  keybindConflicts,
  leaderCombo,
  chordMenu,
  presetBinds,
  activePresetId,
  exportKeybinds,
  importKeybinds,
  KEYBIND_ACTIONS,
  KEYBIND_BY_ID,
  DEFAULT_LEADER
} from '../src/lib/keybinds.js';

const ev = (o) => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

test('comboFromEvent: the normal single-letter path', () => {
  assert.equal(comboFromEvent(ev({ key: 'k', code: 'KeyK', ctrlKey: true })), 'mod+k');
  assert.equal(comboFromEvent(ev({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true })), 'mod+shift+k');
  assert.equal(comboFromEvent(ev({ key: '3', code: 'Digit3', altKey: true })), 'alt+3');
});

test('comboFromEvent: ctrl and cmd are both "mod" so one binding works everywhere', () => {
  assert.equal(comboFromEvent(ev({ key: 'k', code: 'KeyK', ctrlKey: true })),
               comboFromEvent(ev({ key: 'k', code: 'KeyK', metaKey: true })));
});

test('comboFromEvent: macOS Option produces a symbol, so e.code must carry the key', () => {
  // Option+W on macOS reports e.key as "∑"; without the code fallback the binding dies.
  assert.equal(comboFromEvent(ev({ key: '∑', code: 'KeyW', altKey: true })), 'alt+w');
});

test('comboFromEvent: dead keys fall through to e.code instead of bailing', () => {
  // macOS reports Option+I as "Dead" (circumflex). Treating it as a modifier would kill the binding.
  assert.equal(comboFromEvent(ev({ key: 'Dead', code: 'KeyI', altKey: true })), 'alt+i');
  assert.equal(comboFromEvent(ev({ key: 'Unidentified', code: 'KeyJ', ctrlKey: true })), 'mod+j');
});

test('comboFromEvent: a bare modifier is never a combo', () => {
  for (const k of ['Control', 'Shift', 'Alt', 'Meta']) {
    assert.equal(comboFromEvent(ev({ key: k })), '');
  }
});

test('comboFromEvent: shift is recorded for letters and named keys, not punctuation', () => {
  // "?" already encodes shift; storing shift+/ would stop it matching.
  assert.equal(comboFromEvent(ev({ key: '?', code: 'Slash', shiftKey: true })), '?');
  assert.equal(comboFromEvent(ev({ key: 'Enter', code: 'Enter', shiftKey: true })), 'shift+Enter');
});

test('comboFromEvent: space normalises from both key and code', () => {
  assert.equal(comboFromEvent(ev({ key: ' ', code: 'Space' })), 'space');
});

test('isValidCombo: modifier order, duplicates and chords', () => {
  assert.equal(isValidCombo('mod+k'), true);
  assert.equal(isValidCombo('mod+alt+shift+k'), true);
  assert.equal(isValidCombo('mod+mod+k'), false);
  assert.equal(isValidCombo('mod'), false);
  assert.equal(isValidCombo(''), false);
  assert.equal(isValidCombo('space l'), true);
  assert.equal(isValidCombo('space l k'), false);
});

test('isValidCombo rejects a junk key, so a corrupt import cannot disable a shortcut', () => {
  // A stored combo that survives validation but can never be typed silently kills that action.
  for (const junk of ['((((', '!!', '+++', 'mod+', '   ']) {
    assert.equal(isValidCombo(junk), false, junk);
  }
  // Real DOM key names and single characters must still pass.
  for (const ok of ['a', '3', '?', '/', 'space', 'Enter', 'Escape', 'ArrowUp', 'F5', 'mod+ArrowDown']) {
    assert.equal(isValidCombo(ok), true, ok);
  }
});

test('chords split into exactly a head and a tail', () => {
  assert.equal(isChord('space l'), true);
  assert.equal(isChord('mod+k'), false);
  assert.deepEqual(chordParts('space l'), ['space', 'l']);
});

test('sanitizeKeybinds drops junk, unknown ids and fixed actions', () => {
  const fixed = KEYBIND_ACTIONS.find(a => a.fixed);
  const raw = { commandPalette: 'mod+j', nonsense: 'mod+z', broken: '+++', bad: 42 };
  if (fixed) raw[fixed.id] = 'mod+q';
  const out = sanitizeKeybinds(raw);
  assert.equal(out.commandPalette, 'mod+j');
  assert.equal('nonsense' in out, false);
  assert.equal('broken' in out, false);
  if (fixed) assert.equal(fixed.id in out, false, 'fixed actions ignore stored overrides');
});

test('sanitizeKeybinds does not store a value equal to the default', () => {
  const def = KEYBIND_BY_ID.commandPalette.def;
  assert.deepEqual(sanitizeKeybinds({ commandPalette: def }), {});
});

test('resolveKeybinds merges overrides over defaults and always covers every action', () => {
  const binds = resolveKeybinds({ keybinds: { commandPalette: 'mod+j' } });
  assert.equal(binds.commandPalette, 'mod+j');
  for (const a of KEYBIND_ACTIONS) assert.ok(binds[a.id], `${a.id} resolved`);
});

test('resolveKeybinds falls back when a stored override is unparseable', () => {
  const binds = resolveKeybinds({ keybinds: { commandPalette: 'not a combo!!' } });
  assert.equal(binds.commandPalette, KEYBIND_BY_ID.commandPalette.def);
});

test('keybindIndex: exact-match map plus a separate chord tree', () => {
  const index = keybindIndex(resolveKeybinds({}));
  const commandPalette = KEYBIND_BY_ID.commandPalette.def;
  assert.equal(index.get(commandPalette).id, 'commandPalette');
  assert.ok(index.chords instanceof Map);
});

test('keybindIndex: a duplicate goes to whichever action is listed first', () => {
  const dupe = 'mod+alt+shift+y';
  const ids = KEYBIND_ACTIONS.filter(a => !a.fixed).map(a => a.id);
  const binds = resolveKeybinds({});
  binds[ids[0]] = dupe;
  binds[ids[1]] = dupe;
  assert.equal(keybindIndex(binds).get(dupe).id, ids[0]);
});

test('keybindConflicts reports duplicates', () => {
  const binds = resolveKeybinds({});
  const ids = KEYBIND_ACTIONS.filter(a => !a.fixed).map(a => a.id);
  binds[ids[0]] = 'mod+alt+shift+u';
  binds[ids[1]] = 'mod+alt+shift+u';
  assert.equal(keybindConflicts(binds).has('mod+alt+shift+u'), true);
});

test('every default binding is itself valid, and defaults do not collide', () => {
  const binds = resolveKeybinds({});
  for (const a of KEYBIND_ACTIONS) assert.equal(isValidCombo(binds[a.id]), true, `${a.id}: ${binds[a.id]}`);
  assert.equal(keybindConflicts(binds).size, 0, 'shipped defaults must not conflict');
});

test('leaderCombo rejects a chord or junk and falls back', () => {
  assert.equal(leaderCombo({ leaderKey: 'g' }), 'g');
  assert.equal(leaderCombo({ leaderKey: 'space l' }), DEFAULT_LEADER);
  assert.equal(leaderCombo({ leaderKey: '!!' }), DEFAULT_LEADER);
  assert.equal(leaderCombo({}), DEFAULT_LEADER);
});

test('chordMenu lists only what is bound under the given head', () => {
  const binds = resolveKeybinds({});
  const ids = KEYBIND_ACTIONS.filter(a => !a.fixed).map(a => a.id);
  binds[ids[0]] = 'space l';
  binds[ids[1]] = 'space k';
  const menu = chordMenu(binds, 'space');
  assert.deepEqual(menu.map(m => m.key).sort(), ['k', 'l']);
  assert.deepEqual(chordMenu(binds, 'g'), []);
});

test('keybind presets round-trip through activePresetId', () => {
  const vim = presetBinds('vim');
  if (Object.keys(vim).length) assert.equal(activePresetId({ keybinds: vim }), 'vim');
  assert.equal(activePresetId({ keybinds: {} }), 'default');
});

test('exportKeybinds/importKeybinds round-trip only the overrides', () => {
  const payload = exportKeybinds({ keybinds: { commandPalette: 'mod+j' } });
  assert.equal(payload.kind, 'open-quill-keybinds');
  assert.deepEqual(payload.binds, { commandPalette: 'mod+j' });
  assert.equal(importKeybinds(payload).commandPalette, 'mod+j');
});

test('importKeybinds refuses a non-object and sanitizes a malformed one', () => {
  assert.equal(importKeybinds('not an object'), null);
  assert.equal(importKeybinds(null), null);
  assert.deepEqual(importKeybinds({ binds: { commandPalette: '((((' } }), {});
  assert.deepEqual(importKeybinds({ binds: { madeUpAction: 'mod+j' } }), {});
});
