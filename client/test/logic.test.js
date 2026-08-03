import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comboFromEvent, isValidCombo, isChord, chordParts, sanitizeKeybinds, resolveKeybinds,
  keybindIndex, keybindConflicts, leaderCombo, chordMenu, presetBinds, activePresetId,
  exportKeybinds, importKeybinds, KEYBIND_ACTIONS, KEYBIND_BY_ID, DEFAULT_LEADER
} from '../src/lib/keybinds.js';
import { parseSteps, lastSentence, thoughtSeconds } from '../src/lib/reasoning.js';
import { hasMath, wrapMathEnvironments } from '../src/lib/mathjs.js';
import { hasToolCall, previewOf, buildTree, collapseRuns } from '../src/lib/threadmeta.js';
import { scanTools } from '../src/toolproto.js';

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

test('lastSentence returns the newest COMPLETE sentence, so the header lags by one', () => {
  assert.equal(lastSentence('I need to edit this file. Then I will run'), 'I need to edit this file.');
  assert.equal(lastSentence('I need to edit this file. Then I will run it.'), 'Then I will run it.');
});

test('lastSentence does not treat a decimal point as a sentence end', () => {
  assert.equal(lastSentence('The value is 0.5 meters. Done here.'), 'Done here.');
});

test('lastSentence yields nothing until the first sentence closes', () => {
  assert.equal(lastSentence('No punctuation yet so nothing'), '');
  assert.equal(lastSentence(''), '');
  assert.equal(lastSentence(null), '');
});

test('lastSentence skips fragments too short to read', () => {
  assert.equal(lastSentence('A. B. This is the real one.'), 'This is the real one.');
});

test('lastSentence truncates a very long sentence rather than overflowing the header', () => {
  const long = 'x'.repeat(400) + '.';
  const out = lastSentence(long);
  assert.ok(out.length <= 151, out.length);
  assert.ok(out.endsWith('…'));
});

test('lastSentence has no regex lookbehind (parse-time fatal on Safari < 16.4)', async () => {
  const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/lib/reasoning.js', import.meta.url), 'utf8'));
  assert.equal(/\(\?<[=!]/.test(src), false, 'lookbehind would take down the whole bundle, not just this module');
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

test('hasMath gates the expensive KaTeX path', () => {
  assert.equal(hasMath('plain prose with no maths'), false);
  assert.equal(hasMath('inline $x^2$ here'), true);
  assert.equal(hasMath('display \\[x\\]'), true);
  assert.equal(hasMath('\\begin{align}x\\end{align}'), true);
  assert.equal(hasMath('\\ce{H2O}'), true);
  assert.equal(hasMath(''), false);
});

test('wrapMathEnvironments leaves fenced code alone', () => {
  const src = '```\n\\begin{align}x\\end{align}\n```';
  assert.equal(wrapMathEnvironments(src), src);
});

test('wrapMathEnvironments does not double-wrap something already inside math', () => {
  const src = '$$\\begin{align}x\\end{align}$$';
  assert.equal(wrapMathEnvironments(src), src);
});

test('hasToolCall detects the stored tool marker', () => {
  assert.equal(hasToolCall('[[OQR:eyJhIjoxfQ==]]'), true);
  assert.equal(hasToolCall('just prose'), false);
  assert.equal(hasToolCall(''), false);
});

test('previewOf strips markdown, code fences and tool markers', () => {
  assert.equal(previewOf('# Title with **bold**'), 'Title with bold');
  assert.equal(previewOf('before ```js\ncode\n``` after'), 'before after');
  assert.equal(previewOf('see [the docs](https://x.example)'), 'see the docs');
  assert.equal(previewOf(''), '');
});

test('previewOf truncates to the requested length', () => {
  const out = previewOf('word '.repeat(80), 20);
  assert.ok(out.length <= 20, out.length);
  assert.ok(out.endsWith('…'));
});

test('buildTree returns roots and nests children in list order', () => {
  assert.deepEqual(buildTree([]), []);
  const roots = buildTree([
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'a' }
  ]);
  assert.equal(roots.length, 1);
  assert.deepEqual(roots[0].children.map(n => n.id), ['b', 'c']);
});

test('buildTree treats an orphaned parent id as a root rather than dropping the node', () => {
  const roots = buildTree([{ id: 'x', parentId: 'ghost' }]);
  assert.deepEqual(roots.map(n => n.id), ['x']);
});

test('collapseRuns folds a linear chain into one run and stops at a fork', () => {
  const linear = buildTree([
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b' }
  ]);
  const flat = collapseRuns(linear[0]);
  assert.deepEqual(flat.run.map(n => n.id), ['a', 'b', 'c']);
  assert.deepEqual(flat.forks, []);

  const forked = buildTree([
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'a' }
  ]);
  const split = collapseRuns(forked[0]);
  assert.deepEqual(split.run.map(n => n.id), ['a']);
  assert.deepEqual(split.forks.map(n => n.id), ['b', 'c']);
});

test('scanTools does not turn prose into a tool call', () => {
  const r = scanTools('I would call bash here but I will not.');
  assert.equal(r.calls.length, 0);
  assert.equal(r.live, null);
});
