import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comboFromEvent, isValidCombo, isChord, chordParts, sanitizeKeybinds, resolveKeybinds,
  keybindIndex, keybindConflicts, leaderCombo, chordMenu, presetBinds, activePresetId,
  exportKeybinds, importKeybinds, KEYBIND_ACTIONS, KEYBIND_BY_ID, DEFAULT_LEADER
} from '../src/lib/keybinds.js';
import { parseSteps, lastSentence, thoughtSeconds } from '../src/lib/reasoning.js';
import { hasMath, isolateDisplayMath, wrapMathEnvironments } from '../src/lib/mathjs.js';
import { hasToolCall, previewOf, buildTree, collapseRuns } from '../src/lib/threadmeta.js';
import { scanTools } from '../src/toolproto.js';
import { STATUS_DELAY_DEFAULT, STATUS_DELAY_MAX, statusDelayMs, statusDelaySecs } from '../src/lib/status.js';
import { paletteFor, palettesFor, themeValue, paletteById, DEFAULT_DARK, DEFAULT_LIGHT, presetOf } from '../src/lib/palettes.js';
import { scrollInsideMenu } from '../src/lib/anchor.js';
import { clampPx, knobAt, knobRaw, knobTravel, overshoot, stretchFor, squashFor, stretchOrigin, nearestIndex, slideFor, DRAG_SLOP, STRETCH_PX, SLIDE_BASE, SLIDE_SPAN } from '../src/lib/dragsteps.js';
import { cellRand, cellRamp, cellAlpha, headColumn, fadeTrail, stampTrail, parseRgb, hotMix, CELL, CELL_GAP, TRAIL_DECAY, HEAD_WHITE } from '../src/lib/cellfield.js';
import {
  isRange, clampToRange, allNumeric, kwargPayload,
  controlOf as controlOfKwarg, defaultValueOf as defaultValueOfKwarg,
  resolveKwargValues as resolveKwargs, gateOpen, kwargVisible, gateSourceIds, KWARG_PRESETS
} from '../src/kwargs.js';
import {
  baseName, extOf, fmtSize, escHtml, diffLines, stableLineDiff,
  collapseRuns as collapseDiffRuns, splitHighlightedLines, markLine,
  buildTree as buildFileTree, findMatches, countFiles, allDirPaths, ancestorDirs
} from '../src/lib/artifacts.js';
import { dirOf, baseName as fileBaseName } from '../src/lib/files.js';

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

test('lastSentence does not treat a dotted filename as a sentence end', () => {
  assert.equal(lastSentence('Created it. Now thinking about beta.py...'), 'Now thinking about beta.py...');
  assert.equal(lastSentence("Done with alpha.py's functions."), "Done with alpha.py's functions.");
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

test('lastSentence strips markdown decoration so the header reads as plain prose', () => {
  assert.equal(lastSentence('* *Constraint Check:* No lists/bullets in the explanation.'), 'Constraint Check: No lists/bullets in the explanation.');
  assert.equal(lastSentence('**Constraint Check:** No lists/bullets in the explanation.'), 'Constraint Check: No lists/bullets in the explanation.');
  assert.equal(lastSentence('### Step 1: check the constraint.'), 'Step 1: check the constraint.');
  assert.equal(lastSentence('Run `pytest -k foo` to check.'), 'Run pytest -k foo to check.');
  assert.equal(lastSentence('- First check a*b is not italic.'), 'First check a*b is not italic.');
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

test('wrapMathEnvironments leaves tilde-fenced code alone', () => {
  const src = '~~~\n\\begin{align}x\\end{align}\n~~~';
  assert.equal(wrapMathEnvironments(src), src);
});

// A price is a lone dollar with no partner. It used to latch the math depth open
// for the rest of the segment, so every later environment went unwrapped.
test('an unpaired dollar does not stop a later environment being wrapped', () => {
  const out = wrapMathEnvironments('The plan costs $5 total.\n\n\\begin{align}\nE = mc^2\n\\end{align}');
  assert.ok(out.includes('$$'), 'environment should be wrapped');
  assert.ok(out.includes('\\begin{align}'));
});

test('a genuinely paired dollar still suppresses wrapping inside it', () => {
  const src = '$\\begin{align}x\\end{align}$';
  assert.equal(wrapMathEnvironments(src), src);
});

// blockify splits on blank lines, so a wrapped body containing one would be torn
// in half and both sides would render as literal text with a stray $$.
test('wrapMathEnvironments collapses blank lines inside the body it wraps', () => {
  const out = wrapMathEnvironments('\\begin{align}\na &= b\n\n c &= d\n\\end{align}');
  const body = out.slice(out.indexOf('$$') + 2, out.lastIndexOf('$$'));
  assert.ok(!/\n[ \t]*\n/.test(body), 'no blank line may survive inside the wrapped body');
});

test('newly supported environments are wrapped', () => {
  for (const env of ['subequations', 'multlined', 'cases*']) {
    const out = wrapMathEnvironments(`\\begin{${env}}\na=b\n\\end{${env}}`);
    assert.ok(out.includes('$$'), env + ' should be wrapped');
  }
});

test('eqnarray is deliberately not wrapped, KaTeX cannot typeset it', () => {
  const src = '\\begin{eqnarray}a&=&b\\end{eqnarray}';
  assert.equal(wrapMathEnvironments(src), src);
});

// remarkBreaks keeps single newlines in one paragraph, so a $$ block on its own
// line was still parsed as INLINE math and KaTeX refused align with
// "can be used only in display mode".
test('isolateDisplayMath gives a display block its own paragraph', () => {
  assert.equal(
    isolateDisplayMath('$$\\begin{align}a &= b\\end{align}$$\nCosts 5.'),
    '$$\n\\begin{align}a &= b\\end{align}\n$$\n\nCosts 5.'
  );
  assert.equal(isolateDisplayMath('Here:\n$$x^2$$\nDone.'), 'Here:\n\n$$\nx^2\n$$\n\nDone.');
});

test('isolateDisplayMath handles a multi-line display block', () => {
  assert.equal(
    isolateDisplayMath('Intro:\n$$\n\\begin{align}\na &= b\n\\end{align}\n$$\nOutro.'),
    'Intro:\n\n$$\n\\begin{align}\na &= b\n\\end{align}\n$$\n\nOutro.'
  );
});

test('isolateDisplayMath leaves inline math and fenced code alone', () => {
  const inline = 'The value $x$ and $y$ are inline.';
  assert.equal(isolateDisplayMath(inline), inline);
  const fenced = '```\n$$x^2$$\ntext\n```';
  assert.equal(isolateDisplayMath(fenced), fenced);
  assert.equal(isolateDisplayMath('Intro:\n\n$$x^2$$\n\nOutro.'), 'Intro:\n\n$$\nx^2\n$$\n\nOutro.');
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

// --- artifacts panel logic -------------------------------------------------

test('artifact paths split into a name and an extension', () => {
  assert.equal(baseName('src/main/java/App.java'), 'App.java');
  assert.equal(baseName('README.md'), 'README.md');
  assert.equal(extOf('src/App.JAVA'), 'java');
  // Previously 'makefile': the bare name was read as its own extension, which
  // showed up as a MAKE file type in the panel. See the extension test below.
  assert.equal(extOf('Makefile'), '');
});

test('file sizes render at a sensible precision', () => {
  assert.equal(fmtSize(null), '');
  assert.equal(fmtSize(512), '512 B');
  assert.equal(fmtSize(2048), '2.0 KB');
  assert.equal(fmtSize(1024 * 100), '100 KB');
  assert.equal(fmtSize(1024 * 1024 * 3), '3.0 MB');
});

test('escHtml neutralises markup but leaves quotes alone', () => {
  assert.equal(escHtml('<script>a && b</script>'), '&lt;script&gt;a &amp;&amp; b&lt;/script&gt;');
  assert.equal(escHtml('say "hi"'), 'say "hi"');
});

test('diffLines finds the minimal edit and marks both sides', () => {
  const rows = diffLines(['a', 'b', 'c'], ['a', 'x', 'c']);
  assert.deepEqual(rows.map(r => r.type), ['ctx', 'del', 'add', 'ctx']);
  assert.equal(rows.find(r => r.type === 'add').text, 'x');
  assert.equal(rows.find(r => r.type === 'del').text, 'b');
  assert.equal(new Set(rows.map(r => r.key)).size, rows.length, 'every row key is unique');
});

test('diffLines refuses to run on a file pair that would blow up', () => {
  const big = Array.from({ length: 2100 }, (_, i) => 'line ' + i);
  assert.equal(diffLines(big, big.slice().reverse()), null);
});

test('stableLineDiff keeps the shared head and tail as context', () => {
  const rows = stableLineDiff(['a', 'b', 'z'], ['a', 'c', 'z']);
  assert.deepEqual(rows.map(r => r.type), ['ctx', 'del', 'add', 'ctx']);
  assert.equal(rows[0].text, 'a');
  assert.equal(rows[3].text, 'z');
});

test('collapseRuns folds long unchanged stretches and expands on demand', () => {
  const rows = [
    { key: 'x', type: 'add', text: '+' },
    ...Array.from({ length: 20 }, (_, i) => ({ key: 'c' + i, type: 'ctx', text: 'same ' + i })),
    { key: 'y', type: 'del', text: '-' }
  ];
  const folded = collapseDiffRuns(rows, 3, new Set());
  const fold = folded.find(r => r.fold);
  assert.ok(fold, 'a long context run collapses');
  assert.equal(fold.count, 14, 'three lines are kept at each end');
  assert.equal(folded.length, 2 + 3 + 3 + 1);

  const opened = collapseDiffRuns(rows, 3, new Set([fold.key]));
  assert.equal(opened.some(r => r.fold), false, 'expanding that fold key shows every line');
  assert.equal(opened.length, rows.length);

  const short = [{ key: 'a', type: 'ctx', text: '1' }, { key: 'b', type: 'ctx', text: '2' }];
  assert.deepEqual(collapseDiffRuns(short, 3, new Set()), short, 'a short run is left alone');
});

test('splitHighlightedLines reopens spans that straddle a newline', () => {
  const lines = splitHighlightedLines('<span class="c">one\ntwo</span>\nthree');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '<span class="c">one</span>');
  assert.equal(lines[1], '<span class="c">two</span>');
  assert.equal(lines[2], 'three');
});

test('splitHighlightedLines survives a truncated tag', () => {
  const lines = splitHighlightedLines('ok<span class="unclosed');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ok/);
});

test('markLine highlights matches and escapes everything around them', () => {
  const html = markLine('a <b> a', [{ start: 0, end: 1, gid: 0 }, { start: 6, end: 7, gid: 1 }], 1);
  assert.match(html, /&lt;b&gt;/, 'text between matches is escaped');
  assert.equal((html.match(/art-mark/g) || []).length, 2);
  assert.equal((html.match(/art-mark active/g) || []).length, 1, 'only the active match is marked active');
});

test('markLine drops a match that overlaps the previous one', () => {
  const html = markLine('abcd', [{ start: 0, end: 3, gid: 0 }, { start: 1, end: 2, gid: 1 }], -1);
  assert.equal((html.match(/art-mark/g) || []).length, 1);
});

test('findMatches reports every occurrence on a line, case-insensitively', () => {
  const m = findMatches(['Foo foo', 'bar'], 'foo');
  assert.equal(m.length, 2);
  assert.deepEqual(m.map(x => x.start), [0, 4]);
  assert.deepEqual(m.map(x => x.gid), [0, 1]);
  assert.equal(findMatches(['anything'], '').length, 0);
});

// A file with no dot has no extension. Reading one off the bare name turns
// `Makefile` into a MAKE file type, colours its icon by a language that does not
// exist, and labels it that way in the artifacts panel.
test('extOf only reports a real extension', () => {
  assert.equal(extOf('src/app.py'), 'py');
  assert.equal(extOf('notes.markdown'), 'markdown', 'a long extension is still an extension');
  assert.equal(extOf('archive.tar.gz'), 'gz');
  assert.equal(extOf('Makefile'), '');
  assert.equal(extOf('Procfile'), '');
  assert.equal(extOf('notes'), '');
  assert.equal(extOf('.gitignore'), '', 'a leading dot is part of the name');
  assert.equal(extOf('src/cmd/run'), '');
});


test('buildFileTree nests paths into folders', () => {
  const root = buildFileTree([
    { path: 'README.md' },
    { path: 'src/main.js' },
    { path: 'src/util/fmt.js' }
  ]);
  assert.deepEqual(root.files.map(f => f.path), ['README.md']);
  assert.deepEqual([...root.dirs.keys()], ['src']);
  const src = root.dirs.get('src');
  assert.deepEqual(src.files.map(f => f.path), ['src/main.js']);
  assert.deepEqual(src.dirs.get('util').files.map(f => f.path), ['src/util/fmt.js']);
  // The node carries the path it stands for, which is what the collapse state keys on.
  assert.equal(src.dirs.get('util').path, 'src/util');
});

// Folder names come straight from the model, so the child table must not be a
// plain object: a directory called "constructor" would otherwise resolve to
// Object's own property and be treated as an existing node.
test('buildFileTree survives folder names that collide with Object prototype keys', () => {
  const root = buildFileTree([
    { path: 'constructor/a.js' },
    { path: '__proto__/b.js' },
    { path: 'toString/c.js' }
  ]);
  assert.deepEqual([...root.dirs.keys()].sort(), ['__proto__', 'constructor', 'toString']);
  assert.deepEqual(root.dirs.get('constructor').files.map(f => f.path), ['constructor/a.js']);
  assert.deepEqual(root.dirs.get('__proto__').files.map(f => f.path), ['__proto__/b.js']);
});

test('buildFileTree compacts a chain of single-child folders into one row', () => {
  const root = buildFileTree([{ path: 'src/utils/text/case.py' }]);
  assert.deepEqual([...root.dirs.keys()], ['src']);
  const only = root.dirs.get('src');
  assert.equal(only.name, 'src/utils/text');
  assert.equal(only.path, 'src/utils/text');
  assert.deepEqual(only.files.map(f => f.path), ['src/utils/text/case.py']);
  // A folder that holds a file of its own is a real stop and is not merged away.
  const kept = buildFileTree([{ path: 'src/app.py' }, { path: 'src/utils/text/case.py' }]);
  assert.equal(kept.dirs.get('src').name, 'src');
  assert.equal([...kept.dirs.get('src').dirs.values()][0].name, 'utils/text');
});

test('buildFileTree sorts folders and files, and counts nested files', () => {
  const root = buildFileTree([
    { path: 'src/zeta.js' }, { path: 'src/alpha.js' },
    { path: 'tests/t.js' }, { path: 'config/c.json' }, { path: 'README.md' }
  ]);
  assert.deepEqual([...root.dirs.keys()], ['config', 'src', 'tests']);
  assert.deepEqual(root.dirs.get('src').files.map(f => f.path), ['src/alpha.js', 'src/zeta.js']);
  assert.equal(countFiles(root), 5);
  assert.equal(countFiles(root.dirs.get('src')), 2);
  assert.deepEqual(allDirPaths(root).sort(), ['config', 'src', 'tests']);
});

test('ancestorDirs names every folder that must be open to reveal a path', () => {
  assert.deepEqual(ancestorDirs('src/utils/text/case.py'), ['src', 'src/utils', 'src/utils/text']);
  assert.deepEqual(ancestorDirs('README.md'), []);
  assert.deepEqual(ancestorDirs(''), []);
});

// The tool line splits a path into a dim folder and a readable name; getting the
// split wrong is what made two different __init__.py steps render identically.
test('dirOf splits a path and copes with the shapes the sandbox produces', () => {
  assert.equal(dirOf('src/utils/__init__.py'), 'src/utils');
  assert.equal(dirOf('README.md'), '');
  assert.equal(dirOf('src\\utils\\a.py'), 'src/utils');
  assert.equal(dirOf(null), '');
  assert.equal(fileBaseName('src/utils/__init__.py'), '__init__.py');
});

// --- kwarg number ranges ---------------------------------------------------
// The client mirrors server/lib/kwargs.js. If the two disagree the payload
// preview in the admin editor lies about what the server will actually send.

test('a kwarg range is detected the same way on the client', () => {
  assert.equal(isRange({ min: 0, max: 4096 }), true);
  for (const bad of [{ min: 5, max: 5 }, { min: 10, max: 2 }, { min: 0 }, { max: 10 }, {}, { min: '', max: '' }, { min: 'a', max: 'b' }]) {
    assert.equal(isRange(bad), false, JSON.stringify(bad));
  }
  assert.equal(isRange({ min: '0', max: '100' }), true, 'the editor holds these as strings while being typed');
});

test('a range control wins over any other control setting', () => {
  assert.equal(controlOfKwarg({ min: 0, max: 100, control: 'select' }), 'range');
  assert.equal(controlOfKwarg({ values: ['false', 'true'] }), 'toggle');
  assert.equal(controlOfKwarg({ values: ['a', 'b', 'c'] }), 'slider');
});

test('client clamping matches the server, including the reachable maximum', () => {
  const d = { min: 0, max: 1000, step: 100 };
  assert.equal(clampToRange(d, 250), 300);
  assert.equal(clampToRange(d, -50), 0);
  assert.equal(clampToRange(d, 99999), 1000);
  assert.equal(clampToRange(d, 'nonsense'), null);
  assert.equal(clampToRange({ min: 5, max: 100, step: 10 }, 100), 100);
  assert.equal(clampToRange({ min: 0, max: 2048, step: 100 }, 2048), 2048, 'an off-grid maximum is still reachable');
  assert.equal(clampToRange({ min: 0, max: 2048, step: 100 }, 1250), 1300);
  assert.equal(clampToRange({ min: 0, max: 2, step: 0.1 }, 0.30000000000000004), 0.3);
  assert.equal(clampToRange({ min: 0, max: 10 }, 3.7), 4, 'no step means whole numbers');
});

test('a range default falls back to the minimum, and the payload carries a number', () => {
  assert.equal(defaultValueOfKwarg({ min: 10, max: 20, step: 1, default: '' }), '10');
  assert.equal(defaultValueOfKwarg({ min: 10, max: 20, step: 1, default: '999' }), '20');
  const defs = [{ id: 'b', name: 'reasoning_budget', target: 'extra_body', type: 'number', min: 0, max: 2048, step: 256 }];
  const out = kwargPayload(defs, resolveKwargs(defs, { b: '600' }, false));
  assert.equal(out.extra_body.reasoning_budget, 512);
  assert.equal(typeof out.extra_body.reasoning_budget, 'number');
});

test('allNumeric decides whether a slider is worth offering', () => {
  assert.equal(allNumeric(['0', '512', '2048']), true);
  assert.equal(allNumeric(['low', 'high']), false);
  assert.equal(allNumeric(['1', 'high']), false);
  assert.equal(allNumeric([]), false);
});

test('a gated kwarg hides its control but keeps its value', () => {
  const defs = [
    { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
    { id: 'budget', name: 'thinking_budget_tokens', target: 'body', type: 'number',
      min: 1024, max: 8192, step: 1024, default: '1024', showIf: { id: 'think', value: 'true' } }
  ];
  const off = resolveKwargs(defs, {}, false);
  assert.equal(gateOpen(defs, off, defs[1]), false);
  assert.equal(kwargVisible(defs, off, defs[1]), false);
  assert.equal(off.budget, '1024');

  const on = resolveKwargs(defs, { think: 'true', budget: '4096' }, false);
  assert.equal(kwargVisible(defs, on, defs[1]), true);
  assert.equal(kwargPayload(defs, on).thinking_budget_tokens, 4096);
});

test('a closed gate drops the value only when sendWhenHidden is off', () => {
  const mk = (send) => [
    { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
    { id: 'budget', name: 'thinking_budget_tokens', target: 'body', type: 'number',
      min: 1024, max: 8192, step: 1024, default: '1024', sendWhenHidden: send,
      showIf: { id: 'think', value: 'true' } }
  ];
  const kept = mk(true);
  assert.equal(kwargPayload(kept, resolveKwargs(kept, {}, false)).thinking_budget_tokens, 1024);
  const dropped = mk(false);
  assert.equal('thinking_budget_tokens' in kwargPayload(dropped, resolveKwargs(dropped, {}, false)), false);
});

test('the kwarg behind an open gate takes over the trigger chip', () => {
  const defs = [
    { id: 'think', name: 'enable_thinking', chip: 'Extended', values: ['false', 'true'], default: 'false' },
    { id: 'effort', name: 'reasoning_effort', values: ['low', 'medium', 'xhigh'], default: 'low',
      showIf: { id: 'think', value: 'true' } }
  ];
  const off = resolveKwargs(defs, {}, false);
  assert.equal(gateSourceIds(defs, off).has('think'), false);

  const on = resolveKwargs(defs, { think: 'true' }, false);
  assert.equal(gateSourceIds(defs, on).has('think'), true);
  assert.equal(gateSourceIds(defs, on).has('effort'), false);
});

test('an admin-hidden gated kwarg leaves its source chip alone', () => {
  const defs = [
    { id: 'think', name: 'enable_thinking', chip: 'Extended', values: ['false', 'true'], default: 'false' },
    { id: 'effort', name: 'reasoning_effort', values: ['low', 'high'], default: 'low',
      visible: false, showIf: { id: 'think', value: 'true' } }
  ];
  assert.equal(gateSourceIds(defs, resolveKwargs(defs, { think: 'true' }, false)).has('think'), false);
});

test('the switch knob centres on the pointer and stops at both ends', () => {
  const r = { left: 100, width: 36 };
  assert.equal(knobAt(110, r, 2, 16), 0);
  assert.equal(knobAt(100, r, 2, 16), 0);
  assert.equal(knobAt(0, r, 2, 16), 0);
  assert.equal(knobAt(136, r, 2, 16), 16);
  assert.equal(knobAt(999, r, 2, 16), 16);
  assert.equal(knobAt(118, r, 2, 16), 8);
});

test('a switch too narrow for its knob still reports a position', () => {
  assert.equal(knobAt(50, { left: 0, width: 12 }, 2, 16), 0);
  assert.equal(clampPx(5, 10, 10), 10);
  assert.equal(clampPx(5, 10, 2), 10);
});

test('a segmented control picks the nearest segment centre, uneven widths included', () => {
  const stops = [{ x: 1, w: 60 }, { x: 61, w: 90 }];
  assert.equal(nearestIndex(stops, 0), 0);
  assert.equal(nearestIndex(stops, 31), 0);
  assert.equal(nearestIndex(stops, 106), 1);
  assert.equal(nearestIndex(stops, 999), 1);
  assert.equal(nearestIndex([], 5), 0);
  assert.equal(nearestIndex(null, 5), 0);
});

test('a sweep lights every column it crossed, not just the two ends', () => {
  const heat = new Float32Array(10);
  stampTrail(heat, 2, 6);
  for (let c = 2; c <= 6; c++) assert.equal(heat[c], 1, 'column ' + c);
  assert.equal(heat[1], 0);
  assert.equal(heat[7], 0);
  stampTrail(heat, 8, 4);
  assert.equal(heat[8], 1);
});

test('a sweep past either edge clamps instead of writing out of bounds', () => {
  const heat = new Float32Array(4);
  stampTrail(heat, -9, 1);
  assert.equal(heat[0], 1);
  stampTrail(heat, 2, 99);
  assert.equal(heat[3], 1);
  assert.equal(heat.length, 4);
});

test('older columns are dimmer than newer ones, which is what makes it a tail', () => {
  const heat = new Float32Array(6);
  stampTrail(heat, 0, 0);
  fadeTrail(heat);
  stampTrail(heat, 1, 1);
  fadeTrail(heat);
  stampTrail(heat, 2, 2);
  assert.ok(heat[2] > heat[1] && heat[1] > heat[0]);
  assert.ok(heat[0] > 0);
});

test('the trail fades out rather than lingering forever', () => {
  const heat = new Float32Array(2);
  stampTrail(heat, 0, 1);
  for (let i = 0; i < 80; i++) fadeTrail(heat);
  assert.ok(heat[0] < 0.001);
  assert.ok(TRAIL_DECAY > 0 && TRAIL_DECAY < 1);
});

test('the head sits at the last filled column, and off the strip when empty', () => {
  assert.equal(headColumn(1, 200), 49);
  assert.equal(headColumn(0, 200), -1);
  assert.ok(headColumn(0.5, 200) < headColumn(1, 200));
});

test('a colour reads the same whether the theme hands over channels or an rgb string', () => {
  assert.deepEqual(parseRgb('rgb(198, 97, 63)'), [198, 97, 63]);
  assert.deepEqual(parseRgb(' 255, 255, 255 '), [255, 255, 255]);
  assert.deepEqual(parseRgb('rgba(1, 2, 3, .5)'), [1, 2, 3]);
  assert.deepEqual(parseRgb('nonsense', [9, 9, 9]), [9, 9, 9]);
  assert.deepEqual(parseRgb('', [9, 9, 9]), [9, 9, 9]);
});

test('the comet head whitens while the cold tail keeps the accent', () => {
  const base = [198, 97, 63];
  const white = [255, 255, 255];
  assert.equal(hotMix(base, white, 0), 'rgb(198,97,63)');
  const warm = parseRgb(hotMix(base, white, 0.5));
  const head = parseRgb(hotMix(base, white, 1));
  assert.ok(head[1] > warm[1] && warm[1] > base[1]);
  assert.equal(head[1], Math.round(97 + (255 - 97) * HEAD_WHITE));
});

test('whitening is biased to the very front, so the tail does not wash out', () => {
  const base = [0, 0, 0];
  const white = [255, 255, 255];
  const half = parseRgb(hotMix(base, white, 0.5))[0];
  assert.ok(half < 255 * HEAD_WHITE * 0.5);
});

test('a light theme can pull the head the other way, towards its own ink', () => {
  const base = [201, 102, 63];
  const ink = [74, 26, 8];
  const head = parseRgb(hotMix(base, ink, 1));
  assert.ok(head[0] < base[0]);
});

test('a hot cell outshines a cold one at the same column and phase', () => {
  const cold = cellAlpha(10, 50, 0.3, 1, 0);
  const hot = cellAlpha(10, 50, 0.3, 1, 1);
  assert.ok(hot > cold);
  assert.ok(hot <= 1);
});

test('every cell gets a stable value of its own, so the field does not pulse as one', () => {
  const a = cellRand(3, 1);
  assert.equal(cellRand(3, 1), a);
  assert.notEqual(cellRand(4, 1), a);
  assert.notEqual(cellRand(3, 2), a);
  for (const [c, r] of [[0, 0], [7, 2], [49, 4], [123, 9]]) {
    const v = cellRand(c, r);
    assert.ok(v >= 0 && v < 1, `cellRand(${c},${r}) = ${v}`);
  }
});

test('the field ramps up towards the smart end and never goes dark at the bright one', () => {
  assert.equal(cellRamp(0, 50), 0);
  assert.equal(cellRamp(49, 50), 1);
  assert.ok(cellRamp(25, 50) < 0.5);
  assert.equal(cellRamp(0, 1), 1);
});

test('cell alpha stays inside 0..1 whatever the phase', () => {
  for (let p = 0; p < 12; p++) {
    for (const col of [0, 10, 49]) {
      const a = cellAlpha(col, 50, cellRand(col, 2), p / 2);
      assert.ok(a >= 0 && a <= 1, `alpha ${a} out of range`);
    }
  }
});

test('the cells leave a gap, so the grid reads as pixels and not a solid bar', () => {
  assert.ok(CELL_GAP > 0 && CELL_GAP < CELL);
});

test('a longer jump takes longer, but never so long that a nudge feels sluggish', () => {
  assert.equal(slideFor(0), SLIDE_BASE);
  assert.equal(slideFor(1), SLIDE_BASE + SLIDE_SPAN);
  assert.equal(slideFor(-1), SLIDE_BASE + SLIDE_SPAN);
  const oneStep = slideFor(0.2);
  const across = slideFor(1);
  assert.ok(oneStep > SLIDE_BASE && oneStep < across);
  assert.ok(across / oneStep < 2, 'the far jump should not feel twice as slow as a nudge');
});

test('slide time is clamped for distances outside the track', () => {
  assert.equal(slideFor(5), SLIDE_BASE + SLIDE_SPAN);
  assert.equal(slideFor(NaN), SLIDE_BASE);
});

test('overshoot is zero inside the track and signed outside it', () => {
  assert.equal(overshoot(8, 0, 16), 0);
  assert.equal(overshoot(0, 0, 16), 0);
  assert.equal(overshoot(16, 0, 16), 0);
  assert.equal(overshoot(-9, 0, 16), -9);
  assert.equal(overshoot(20, 0, 16), 4);
});

test('the stretch saturates instead of growing without bound', () => {
  assert.equal(stretchFor(0, 16), 1);
  const near = stretchFor(10, 16);
  const far = stretchFor(400, 16);
  assert.ok(near > 1 && near < far);
  assert.ok(far <= 1 + STRETCH_PX / 16 + 1e-9);
  assert.equal(stretchFor(-10, 16), near);
});

test('the stretch is a constant pixel pull, so wide thumbs do not balloon', () => {
  const knob = stretchFor(400, 16) - 1;
  const wide = stretchFor(400, 80) - 1;
  assert.ok(Math.abs(knob * 16 - wide * 80) < 1e-9);
});

test('a stretched thumb thins out, and an unstretched one is left alone', () => {
  assert.equal(squashFor(1), 1);
  assert.equal(squashFor(0.5), 1);
  const sq = squashFor(1.3);
  assert.ok(sq < 1 && sq > 0.8);
});

test('the pinned edge is the one being pulled away from', () => {
  assert.equal(stretchOrigin(5), 'right center');
  assert.equal(stretchOrigin(-5), 'left center');
});

test('knobRaw keeps the overshoot that knobAt clamps away', () => {
  const r = { left: 0, width: 36 };
  assert.equal(knobTravel(r, 2, 16), 16);
  assert.equal(knobRaw(60, r, 2, 16), 50);
  assert.equal(knobAt(60, r, 2, 16), 16);
  assert.equal(knobRaw(-20, r, 2, 16), -30);
  assert.equal(knobAt(-20, r, 2, 16), 0);
});

test('the drag slop stays small enough that a tap is never read as a drag', () => {
  assert.ok(DRAG_SLOP > 0 && DRAG_SLOP <= 4);
});

test('an unresolvable or absent gate leaves the kwarg visible', () => {
  const defs = [{ id: 'a', name: 'a', values: ['1', '2'] }];
  assert.equal(gateOpen(defs, {}, defs[0]), true);
  assert.equal(gateOpen(defs, {}, { id: 'b', showIf: { id: 'ghost', value: '1' } }), true);
});

test('the thinking budget preset matches the shape llama.cpp expects', () => {
  const p = KWARG_PRESETS.find(x => x.key === 'thinking_budget_tokens').make();
  assert.equal(p.name, 'thinking_budget_tokens');
  assert.equal(p.target, 'body', 'top level, not nested under extra_body');
  assert.equal(p.type, 'number');
  assert.deepEqual([p.min, p.max, p.step, p.default], [1024, 8192, 1024, '1024']);
  assert.equal(defaultValueOfKwarg(p), '1024');
  assert.equal(controlOfKwarg(p), 'range');
  const out = kwargPayload([p], resolveKwargs([p], { [p.id]: '5000' }, false));
  assert.equal(out.thinking_budget_tokens, 5120, 'snapped to the 1024 grid');
  assert.equal('extra_body' in out, false);
});

test('the progress-line delay clamps to a whole number of seconds in range', () => {
  assert.equal(statusDelaySecs(undefined), STATUS_DELAY_DEFAULT);
  assert.equal(statusDelaySecs(null), STATUS_DELAY_DEFAULT);
  assert.equal(statusDelaySecs(''), STATUS_DELAY_DEFAULT);
  assert.equal(statusDelaySecs('nonsense'), STATUS_DELAY_DEFAULT);
  assert.equal(statusDelaySecs(0), 0, 'zero is instant, not absent');
  assert.equal(statusDelaySecs('0'), 0);
  assert.equal(statusDelaySecs(-4), 0);
  assert.equal(statusDelaySecs(99), STATUS_DELAY_MAX);
  assert.equal(statusDelaySecs(4.6), 5);
  assert.equal(statusDelayMs(3), 3000);
  assert.equal(statusDelayMs(0), 0);
});

test('a palette resolves to a theme plus an optional palette attribute', () => {
  assert.equal(paletteFor('system', 'anthropic', true).id, 'anthropic-2026q3');
  assert.equal(paletteFor('system', 'anthropic', false).id, 'anthropic-light');
  assert.equal(paletteFor('system', 'openai', true).id, 'openai-2024q1');
  assert.equal(paletteFor('anthropic-2026q3', 'anthropic').theme, 'anthropic');
  assert.equal(paletteFor('anthropic-2026q3', 'anthropic').palette, '2026q3');
  assert.equal(paletteFor('anthropic-2025q2', 'anthropic').palette, '', 'the older dark carries no palette attribute');
});

test('legacy theme values still land on the preset default', () => {
  for (const legacy of ['dark', 'oled', 'anthropic', 'openai']) {
    assert.equal(paletteFor(legacy, 'anthropic').id, 'anthropic-2026q3', legacy);
    assert.equal(paletteFor(legacy, 'openai').id, 'openai-2024q1', legacy);
  }
  assert.equal(paletteFor('light', 'openai').id, 'openai-light');
});

test('a palette from the other preset falls back by darkness, never breaks', () => {
  assert.equal(paletteFor('anthropic-2026q3', 'openai').id, 'openai-2024q1');
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
  assert.equal(palettesFor('openai').length, 2);
});

test('the legacy palette is a distinct anthropic dark, not the default', () => {
  const leg = paletteFor('anthropic-legacy', 'anthropic');
  assert.equal(leg.theme, 'anthropic');
  assert.equal(leg.palette, 'legacy');
  assert.notEqual(paletteFor('dark', 'anthropic').id, 'anthropic-legacy', 'legacy is opt-in, never the default');
  assert.equal(paletteFor('anthropic-legacy', 'openai').id, 'openai-2024q1', 'falls back by darkness under the other preset');
  const ids = palettesFor('anthropic').map(p => p.id);
  assert.deepEqual(ids, ['anthropic-light', 'anthropic-legacy', 'anthropic-2025q2', 'anthropic-2026q3']);
});

test('a scroll inside an anchored menu does not count as a scroll away from it', () => {
  const item = { tag: 'item' };
  const menu = { contains: (n) => n === item };
  assert.equal(scrollInsideMenu(menu, item), true, 'a scroll on a menu row stays open');
  assert.equal(scrollInsideMenu(menu, menu), true, 'the menu scrolling itself stays open');
  assert.equal(scrollInsideMenu(menu, { tag: 'thread' }), false, 'an outside scroll still closes');
  assert.equal(scrollInsideMenu(null, item), false, 'no menu yet, nothing to protect');
  assert.equal(scrollInsideMenu(menu, null), false);
  assert.equal(scrollInsideMenu({ contains: () => false }, { self: true }), false);
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

test('highlighting is identical with the cache bypassed, so the streaming path cannot change output', async () => {
  const { ensureCommon, highlight } = await import('../src/lib/hljs.js');
  const hl = await ensureCommon();
  assert.ok(hl, 'highlight.js common bundle loaded');
  const code = 'function add(a, b) {\n  return a + b;\n}\n';
  const viaCache = highlight(code, 'javascript');
  const viaBypass = highlight(code, 'javascript', { cache: false });
  assert.equal(viaBypass, viaCache);
  assert.match(viaCache, /<span class="hljs-/, 'really highlighted, not escaped plain text');
  let prev = '';
  for (const n of [10, 20, 30]) {
    const partial = code.slice(0, n);
    const out = highlight(partial, 'javascript', { cache: false });
    assert.notEqual(out, prev);
    assert.equal(out, highlight(partial, 'javascript', { cache: false }));
    prev = out;
  }
});

// ---- reveal styles --------------------------------------------------------

test('resolveReveal prefers the named style and falls back to the legacy booleans', async () => {
  const { resolveReveal } = await import('../src/lib/reveal.js');
  assert.equal(resolveReveal({ revealStyle: 'instant' }, 'anthropic'), 'instant');
  assert.equal(resolveReveal({ revealStyle: 'typewriter' }, 'anthropic'), 'typewriter');
  assert.equal(resolveReveal({}, 'anthropic'), 'typewriter');
  assert.equal(resolveReveal(null, 'anthropic'), 'typewriter');
  assert.equal(resolveReveal({ typewriter: false }, 'anthropic'), 'instant');
  assert.equal(resolveReveal({ animations: false }, 'anthropic'), 'instant');
  // The named style wins over a stale pre-split boolean sitting beside it.
  assert.equal(resolveReveal({ typewriter: false, revealStyle: 'typewriter' }, 'anthropic'), 'typewriter');
});

test('a retired or unknown style resolves to the default reveal, never to nothing', async () => {
  const { resolveReveal } = await import('../src/lib/reveal.js');
  // 'fade' shipped briefly and was removed; a pref still holding it must keep
  // revealing rather than silently degrade to instant.
  for (const v of ['fade', 'glide', 'blur', 'sparkle', '', 0, {}]) {
    assert.equal(resolveReveal({ revealStyle: v }, 'anthropic'), 'typewriter', String(v));
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
