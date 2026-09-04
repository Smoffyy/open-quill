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
import { extractHeadings, buildOutline } from '../src/lib/outline.js';
import {
  docsConfig, docsTree, docsSearch, parseDocsPath, docsPath, fmtTokens, fmtPrice,
  priceRange, bulletLines, publicModelId, docsModels
} from '../src/lib/modeldocs.js';
import { paletteFor, palettesFor, themeValue, paletteById, DEFAULT_DARK, DEFAULT_LIGHT, presetOf, nextTheme } from '../src/lib/palettes.js';
import { scrollInsideMenu } from '../src/lib/anchor.js';
import { nextFitSize, FIT_MIN, FIT_PASSES } from '../src/lib/fittext.js';
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
import { folderOf, groupRows, planMove } from '../src/lib/modelfolders.js';
import { isInside, anyMounted, asRefList } from '../src/lib/dismiss.js';
import { createSocketClient, retryDelay, socketUrl, RETRY_BASE, RETRY_MAX } from '../src/lib/wsclient.js';
import { draftKey } from '../src/lib/drafts.js';
import { isFileWrite, fileFrom, mergeCall, supersededFile } from '../src/lib/livetools.js';
import { createLru } from '../src/lib/lru.js';
import { parseRoute, shouldResetPath, pathForChat, pathForProject } from '../src/lib/route.js';
import { revealChunk, revealPeriod, hasMarker } from '../src/lib/turnstream.js';
import { dispatchWs, handlers, isSpaceFrame } from '../src/lib/wsmessages.js';

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

test('nextFitSize returns null when the text already fits', () => {
  assert.equal(nextFitSize(20, 200, 120, 12), null);
  assert.equal(nextFitSize(20, 200, 200, 12), null);
});

test('nextFitSize shrinks by the overflow ratio', () => {
  assert.equal(nextFitSize(20, 180, 200, 12), 18);
  assert.equal(nextFitSize(20, 150, 200, 12), 15);
});

test('nextFitSize stops at the floor', () => {
  assert.equal(nextFitSize(20, 10, 1000, 12), 12);
  assert.equal(nextFitSize(12, 10, 1000, 12), null);
});

test('nextFitSize converges within FIT_PASSES when glyph rounding overshoots', () => {
  // real text does not scale perfectly linearly; model a 2px rounding overshoot
  const ideal = 200, avail = 182, base = 20;
  const widthAt = (size) => ideal * (size / base) + 2;
  let size = base, natural = ideal;
  for (let i = 0; i < FIT_PASSES; i++) {
    const next = nextFitSize(size, avail, natural, base * FIT_MIN);
    if (!next) break;
    size = next;
    natural = widthAt(size);
  }
  assert.ok(natural <= avail, 'expected fit, got ' + natural + ' in ' + avail);
  assert.ok(size > base * FIT_MIN, 'should not have needed the floor');
});

test('nextFitSize is safe on unmeasured elements', () => {
  assert.equal(nextFitSize(0, 100, 200, 10), null);
  assert.equal(nextFitSize(20, 0, 200, 10), null);
  assert.equal(nextFitSize(20, 100, NaN, 10), null);
});

test('nextFitSize treats a missing floor as no floor', () => {
  assert.equal(nextFitSize(20, 50, 200, 0), 5);
});

/* ---------- admin model folders ---------- */

const inFolder = (id, name) => ({ id, in_more_models: 1, more_models_label: name });
const loose = (id) => ({ id, in_more_models: 0, more_models_label: 'More models' });

test('folderOf only reports a folder when the row is actually in one', () => {
  assert.equal(folderOf(inFolder('a', 'Fast')), 'Fast');
  assert.equal(folderOf(loose('b')), null);
  // A label without the flag is stale data, not membership.
  assert.equal(folderOf({ id: 'c', in_more_models: 0, more_models_label: 'Fast' }), null);
  // A blank or whitespace label cannot name a folder.
  assert.equal(folderOf({ id: 'd', in_more_models: 1, more_models_label: '  ' }), null);
  assert.equal(folderOf(undefined), null);
});

test('groupRows draws one header per folder even when members are separated', () => {
  const rows = [inFolder('a', 'Fast'), loose('b'), inFolder('c', 'Fast')];
  const out = groupRows(rows);
  assert.deepEqual(out.map(e => e.kind), ['folder', 'model']);
  assert.equal(out[0].name, 'Fast');
  assert.deepEqual(out[0].models.map(m => m.id), ['a', 'c']);
});

test('groupRows keeps a folder at the position of its first member', () => {
  const rows = [loose('a'), inFolder('b', 'Slow'), loose('c')];
  const out = groupRows(rows);
  assert.deepEqual(out.map(e => e.key), ['a', 'f:Slow', 'c']);
});

test('groupRows appends folders that hold nothing yet, and never twice', () => {
  const out = groupRows([inFolder('a', 'Fast')], ['New', 'Fast']);
  assert.deepEqual(out.map(e => e.name), ['Fast', 'New']);
  assert.deepEqual(out[1].models, []);
});

test('planMove drops a row before or after the row it was dropped on', () => {
  const models = [loose('a'), loose('b'), loose('c')];
  assert.deepEqual(planMove(models, ['c'], { targetId: 'a' }).order.map(m => m.id), ['c', 'a', 'b']);
  assert.deepEqual(planMove(models, ['c'], { targetId: 'a', after: true }).order.map(m => m.id), ['a', 'c', 'b']);
});

test('planMove onto a folder header lands after that folder last member', () => {
  const models = [inFolder('a', 'Fast'), inFolder('b', 'Fast'), loose('c')];
  const plan = planMove(models, ['c'], { folder: 'Fast' });
  assert.deepEqual(plan.order.map(m => m.id), ['a', 'b', 'c']);
  assert.deepEqual(plan.patch, { in_more_models: 1, more_models_label: 'Fast' });
  assert.equal(plan.needsPatch, true);
});

test('planMove taking a row out of a folder clears membership', () => {
  const models = [inFolder('a', 'Fast'), loose('b')];
  const plan = planMove(models, ['a'], { folder: null });
  assert.deepEqual(plan.patch, { in_more_models: 0 });
  assert.equal(plan.needsPatch, true);
});

test('planMove reorders within a folder without rewriting the label', () => {
  const models = [inFolder('a', 'Fast'), inFolder('b', 'Fast')];
  const plan = planMove(models, ['b'], { folder: 'Fast', targetId: 'a' });
  assert.deepEqual(plan.order.map(m => m.id), ['b', 'a']);
  assert.equal(plan.needsPatch, false);
});

test('planMove keeps a multi-row selection together and in order', () => {
  const models = [loose('a'), loose('b'), loose('c'), loose('d')];
  const plan = planMove(models, ['a', 'c'], { targetId: 'd', after: true });
  assert.deepEqual(plan.order.map(m => m.id), ['b', 'd', 'a', 'c']);
});

/* ---------- dismiss (outside click / Escape) ---------- */

const elWith = (kids = [], match = null) => {
  const el = {
    kids,
    contains: (t) => el === t || kids.includes(t),
    closest: (sel) => (match === sel ? el : null)
  };
  return el;
};

test('isInside: a target inside any of the refs counts as inside', () => {
  const child = elWith();
  const a = elWith([child]);
  const b = elWith();
  assert.equal(isInside(child, [{ current: a }, { current: b }], ''), true);
  assert.equal(isInside(child, [{ current: b }], ''), false);
});

test('isInside: the element itself is inside, not only its children', () => {
  const a = elWith();
  assert.equal(isInside(a, [{ current: a }], ''), true);
});

test('isInside: unattached refs and a null target are simply not inside', () => {
  assert.equal(isInside(null, [{ current: null }], ''), false);
  assert.equal(isInside(elWith(), [{ current: null }, null, undefined], ''), false);
});

test('isInside: the selector escape hatch covers a panel portalled out of the ref tree', () => {
  const portalled = elWith([], '.model-submenu');
  assert.equal(isInside(portalled, [{ current: elWith() }], ''), false);
  assert.equal(isInside(portalled, [{ current: elWith() }], '.model-submenu'), true);
});

test('anyMounted gates the handler until a ref has attached', () => {
  // Without this the first mousedown after opening a menu closes it again,
  // because nothing is mounted yet to compare the click against.
  assert.equal(anyMounted([{ current: null }]), false);
  assert.equal(anyMounted([{ current: null }, { current: elWith() }]), true);
  assert.equal(anyMounted([]), false);
});

test('asRefList accepts a single ref or a list', () => {
  const r = { current: null };
  assert.deepEqual(asRefList(r), [r]);
  assert.deepEqual(asRefList([r]), [r]);
});

/* ---------- websocket client ---------- */

function fakeSockets() {
  const made = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      made.push(this);
    }
    open() { this.readyState = 1; if (this.onopen) this.onopen(); }
    recv(data) { if (this.onmessage) this.onmessage({ data }); }
    send(s) { this.sent.push(s); }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
  }
  return { made, FakeWS };
}

function fakeTimers() {
  let seq = 0;
  const jobs = new Map();
  return {
    api: {
      set: (fn, ms) => { const id = ++seq; jobs.set(id, { fn, ms }); return id; },
      clear: (id) => { jobs.delete(id); }
    },
    pending: () => jobs.size,
    runAll: () => { const all = [...jobs.values()]; jobs.clear(); all.forEach(j => j.fn()); }
  };
}

test('socket client: an unexpected drop reconnects with backoff', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api });
  c.connect();
  made[0].open();
  assert.equal(c.isOpen(), true);
  made[0].close();
  assert.equal(timers.pending(), 1, 'a retry is queued');
  timers.runAll();
  assert.equal(made.length, 2, 'it opened a fresh socket');
});

test('socket client: close() stays closed and never reconnects', () => {
  // The regression this guards: close() used to hang up the socket and let its
  // own onclose queue a retry, so every remount left a live socket nobody owned.
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api });
  c.connect();
  made[0].open();
  c.close();
  assert.equal(timers.pending(), 0, 'no retry was queued');
  timers.runAll();
  assert.equal(made.length, 1, 'no second socket was ever created');
  assert.equal(c.isOpen(), false);
});

test('socket client: a close while still connecting hangs up rather than leaking', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api });
  c.connect();
  c.close();
  made[0].open();
  assert.equal(made[0].readyState, 3, 'the late open closed itself');
  assert.equal(timers.pending(), 0);
});

test('socket client: frames stop being delivered once closed', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const seen = [];
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api, onMessage: (m) => seen.push(m) });
  c.connect();
  made[0].open();
  made[0].recv('{"type":"a"}');
  c.close();
  made[0].recv('{"type":"b"}');
  assert.deepEqual(seen, [{ type: 'a' }]);
});

test('socket client: an unparseable frame is dropped, not thrown', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const seen = [];
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api, onMessage: (m) => seen.push(m) });
  c.connect();
  made[0].open();
  made[0].recv('not json');
  made[0].recv('{"ok":1}');
  assert.deepEqual(seen, [{ ok: 1 }]);
});

test('socket client: shouldReconnect false skips the retry but keeps the client usable', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  let live = false;
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api, shouldReconnect: () => live });
  c.connect();
  made[0].open();
  made[0].close();
  timers.runAll();
  assert.equal(made.length, 1, 'signed out, so no reconnect');
  live = true;
  c.connect();
  assert.equal(made.length, 2);
});

test('socket client: connect() is idempotent while a socket is live', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api });
  c.connect();
  c.connect();
  made[0].open();
  c.connect();
  assert.equal(made.length, 1);
});

test('socket client: send reports failure and reopens a dead socket', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api, shouldReconnect: () => true });
  c.connect();
  made[0].open();
  assert.equal(c.send({ a: 1 }), true);
  assert.deepEqual(made[0].sent, ['{"a":1}']);
  made[0].close();
  assert.equal(c.send({ b: 2 }), false, 'nothing to send on');
});

test('retryDelay backs off geometrically and then holds at the ceiling', () => {
  assert.equal(retryDelay(0), RETRY_BASE);
  assert.equal(retryDelay(1), RETRY_BASE * 2);
  assert.ok(retryDelay(20) === RETRY_MAX);
});

test('socketUrl upgrades to wss on a secure page', () => {
  assert.equal(socketUrl({ protocol: 'http:', host: 'localhost:5173' }), 'ws://localhost:5173/ws');
  assert.equal(socketUrl({ protocol: 'https:', host: 'x.dev' }), 'wss://x.dev/ws');
});

/* ---------- drafts ---------- */

test('draftKey namespaces per chat and has one slot for the unsaved new chat', () => {
  assert.equal(draftKey('abc'), 'oq-draft-abc');
  assert.equal(draftKey(null), 'oq-draft-new');
  assert.notEqual(draftKey('a'), draftKey('b'));
});

/* ---------- live tool rows ---------- */

test('isFileWrite only claims the two tools that actually write a file', () => {
  assert.equal(isFileWrite({ tool: 'create_file', path: 'a.py' }), true);
  assert.equal(isFileWrite({ tool: 'str_replace', path: 'a.py' }), true);
  assert.equal(isFileWrite({ tool: 'bash', path: 'a.py' }), false);
  assert.equal(isFileWrite({ tool: 'create_file' }), false, 'no path yet, nothing to preview');
  assert.equal(isFileWrite(null), false);
});

test('fileFrom normalises a partial live call into a preview record', () => {
  assert.deepEqual(fileFrom({ tool: 'create_file', path: 'a.py' }),
    { path: 'a.py', content: '', tool: 'create_file', oldStr: null });
  assert.deepEqual(fileFrom({ tool: 'str_replace', path: 'a.py', content: 'x', oldStr: 'y' }),
    { path: 'a.py', content: 'x', tool: 'str_replace', oldStr: 'y' });
});

test('mergeCall updates a row in place instead of overwriting the one before it', () => {
  let rows = mergeCall([], 0, { tool: 'create_file', path: 'a.py' });
  rows = mergeCall(rows, 1, { tool: 'create_file', path: 'b.py' });
  assert.equal(rows.length, 2);
  rows = mergeCall(rows, 0, { tool: 'create_file', path: 'a.py', content: 'more' });
  assert.equal(rows.length, 2, 'still two rows');
  assert.equal(rows[0].call.content, 'more');
  assert.deepEqual(rows.map(r => r.index), [0, 1], 'kept in index order');
});

test('mergeCall keeps rows sorted even when indexes arrive out of order', () => {
  let rows = mergeCall([], 2, { tool: 'bash' });
  rows = mergeCall(rows, 0, { tool: 'bash' });
  rows = mergeCall(rows, 1, { tool: 'bash' });
  assert.deepEqual(rows.map(r => r.index), [0, 1, 2]);
});

test('mergeCall clears the whole step on a null call', () => {
  const rows = mergeCall([], 0, { tool: 'bash' });
  assert.deepEqual(mergeCall(rows, 0, null), []);
  assert.deepEqual(mergeCall(rows, undefined, { tool: 'bash' }), [], 'no index means no row');
});

test('supersededFile commits a finished create_file exactly once', () => {
  const prev = { tool: 'create_file', path: 'a.py', content: 'body' };
  // moved on to a different file
  assert.deepEqual(supersededFile(prev, { tool: 'create_file', path: 'b.py' }), { path: 'a.py', text: 'body' });
  // the step ended
  assert.deepEqual(supersededFile(prev, null), { path: 'a.py', text: 'body' });
  // still writing the same file
  assert.equal(supersededFile(prev, { tool: 'create_file', path: 'a.py', content: 'body+' }), null);
});

test('supersededFile ignores a str_replace, which is not a whole-file write', () => {
  assert.equal(supersededFile({ tool: 'str_replace', path: 'a.py', content: 'x' }, null), null);
  assert.equal(supersededFile(null, null), null);
});

test('socket client: the DEFAULT timers reconnect for real', async () => {
  // Guards a browser-only failure node cannot see directly: `{ set: setTimeout }`
  // detaches the timer from `window` and throws "Illegal invocation" on call, which
  // silently disables every reconnect. Exercising the default path keeps the
  // wrappers in place.
  const { made, FakeWS } = fakeSockets();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS });
  c.connect();
  made[0].open();
  made[0].close();
  await new Promise(r => { setTimeout(r, RETRY_BASE + 250); });
  assert.equal(made.length, 2, 'the real timer fired and reopened the socket');
  c.close();
});

/* ---------- bounded chat cache ---------- */

test('lru evicts the least recently used once past its limit', () => {
  const c = createLru(3);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  c.set('d', 4);
  assert.equal(c.has('a'), false, 'oldest went');
  assert.deepEqual(c.keys(), ['b', 'c', 'd']);
  assert.equal(c.size, 3);
});

test('lru counts a re-set as fresh use, so it is not the next evicted', () => {
  const c = createLru(3);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  c.set('a', 9);
  c.set('d', 4);
  assert.equal(c.has('a'), true, 'a was touched, so b went instead');
  assert.equal(c.has('b'), false);
  assert.equal(c.get('a'), 9);
});

test('lru merge lets a chat arrive in pieces without wiping the earlier ones', () => {
  const c = createLru(3);
  c.merge('x', { chat: { id: 'x' } });
  c.merge('x', { messages: [1, 2] });
  c.merge('x', { files: ['a.py'] });
  assert.deepEqual(c.get('x'), { chat: { id: 'x' }, messages: [1, 2], files: ['a.py'] });
});

test('lru merge overwrites only the keys it is given', () => {
  const c = createLru(3);
  c.merge('x', { messages: [1], files: ['a'] });
  c.merge('x', { messages: [1, 2] });
  assert.deepEqual(c.get('x'), { messages: [1, 2], files: ['a'] });
});

test('lru ignores a missing key rather than caching under undefined', () => {
  const c = createLru(3);
  c.set(null, 1); c.set('', 2); c.merge(undefined, { a: 1 });
  assert.equal(c.size, 0);
});

/* ---------- routes ---------- */

test('parseRoute reads each screen off the path', () => {
  assert.deepEqual(parseRoute('/'), { view: 'home' });
  assert.deepEqual(parseRoute('/spaces'), { view: 'spaces' });
  assert.deepEqual(parseRoute('/spaces/'), { view: 'spaces' });
  assert.deepEqual(parseRoute('/projects'), { view: 'projects', id: null });
  assert.deepEqual(parseRoute('/project/abc'), { view: 'project', id: 'abc' });
  assert.deepEqual(parseRoute('/chat/xyz'), { view: 'chat', id: 'xyz' });
});

test('parseRoute sends a member away from the admin-only screens', () => {
  assert.deepEqual(parseRoute('/admin', { isAdmin: true }), { view: 'admin' });
  assert.deepEqual(parseRoute('/admin'), { view: 'home', replace: '/' });
  assert.deepEqual(parseRoute('/playground'), { view: 'home', replace: '/' });
  assert.deepEqual(parseRoute('/playground', { isAdmin: true }), { view: 'playground' });
});

test('parseRoute decodes an id and survives a malformed one', () => {
  assert.equal(parseRoute('/chat/a%20b').id, 'a b');
  assert.equal(parseRoute('/chat/100%').id, '100%', 'a stray percent is kept, not thrown on');
});

test('parseRoute does not mistake a lookalike path for a screen', () => {
  assert.deepEqual(parseRoute('/administrator'), { view: 'home' });
  assert.deepEqual(parseRoute('/chatter'), { view: 'home' });
  assert.deepEqual(parseRoute(''), { view: 'home' });
  assert.deepEqual(parseRoute(null), { view: 'home' });
});

test('shouldResetPath only claims the paths its own screen owns', () => {
  assert.equal(shouldResetPath('admin', '/admin'), true);
  assert.equal(shouldResetPath('admin', '/chat/x'), false, 'user navigated away, leave the URL alone');
  assert.equal(shouldResetPath('projects', '/project/a'), true);
  assert.equal(shouldResetPath('projects', '/projects'), true);
  assert.equal(shouldResetPath('spaces', '/spaces'), true);
  assert.equal(shouldResetPath('home', '/'), false);
});

test('path builders round-trip through parseRoute', () => {
  assert.equal(parseRoute(pathForChat('c1')).id, 'c1');
  assert.equal(parseRoute(pathForProject('p1')).id, 'p1');
  assert.deepEqual(parseRoute(pathForProject(null)), { view: 'projects', id: null });
});

/* ---------- reveal (typewriter) ---------- */

test('revealChunk catches up fast on a big backlog and eases into a readable pace', () => {
  assert.equal(revealChunk(3000, false), 1000, 'a third while far behind');
  assert.equal(revealChunk(600, false), 100, 'a sixth in the middle band');
  assert.equal(revealChunk(90, false), 10, 'a ninth once close');
});

test('revealChunk always advances, so the reveal cannot stall short of the text', () => {
  for (const remaining of [1, 2, 3, 5, 17, 240, 241, 1200, 1201]) {
    const n = revealChunk(remaining, false);
    assert.ok(n >= 1, `remaining=${remaining} advanced by ${n}`);
    assert.ok(n <= remaining, `remaining=${remaining} did not overshoot`);
  }
});

test('revealChunk with animation off shows everything at once', () => {
  assert.equal(revealChunk(5000, true), 5000);
  assert.equal(revealChunk(1, true), 1);
});

test('revealChunk converges: repeated application always reaches the end', () => {
  let shown = 0;
  const total = 5000;
  let ticks = 0;
  while (shown < total && ticks < 1000) { shown += revealChunk(total - shown, false); ticks++; }
  assert.equal(shown, total);
  assert.ok(ticks < 100, `converged in ${ticks} ticks`);
});

test('revealPeriod stays inside the band where it reads as typing', () => {
  assert.equal(revealPeriod(0), 8, 'never a zero-delay interval');
  assert.equal(revealPeriod(-5), 8);
  assert.equal(revealPeriod(40), 40);
  assert.equal(revealPeriod(5000), 100);
  assert.equal(revealPeriod(undefined), 8);
});

test('hasMarker spots the transcript markers that must not be drawn a character at a time', () => {
  assert.equal(hasMarker('text [[OQR:abc]] more'), true);
  assert.equal(hasMarker('\n\n[[OQT:0]]\n'), true);
  assert.equal(hasMarker('ordinary prose'), false);
  assert.equal(hasMarker(''), false);
});

/* ---------- websocket frame handlers ---------- */

function wsCtx(activeKey = 'c1') {
  const recs = new Map();
  const calls = [];
  const log = (name) => (...a) => { calls.push([name, ...a]); };
  const ctx = {
    activeKey: () => activeKey,
    calls,
    recs,
    refs: {
      activeIdRef: { current: activeKey },
      currentIdRef: { current: 'model-1' },
      ledgerOpenRef: { current: false },
      compareRef: { current: null },
      nextTurnPending: { current: false },
      refreshSeq: { current: 0 }
    },
    mirror: {
      recFor: (id) => {
        if (!recs.has(id)) recs.set(id, { content: '', reasoning: '', liveCalls: [] });
        return recs.get(id);
      },
      peek: (id) => recs.get(id),
      dropRec: (id) => { recs.delete(id); calls.push(['dropRec', id]); },
      syncBusy: log('syncBusy'),
      resumeRec: (id, patch) => { recs.set(id, patch); calls.push(['resumeRec', id]); }
    },
    stream: {
      donePending: { current: false },
      setQueued: log('setQueued'),
      begin: log('begin'),
      clear: log('clear'),
      markDone: () => { calls.push(['markDone']); return true; },
      pushContent: (full, delta) => { calls.push(['pushContent', full]); return /\[\[OQ[RT]:/.test(delta); },
      pushReasoning: log('pushReasoning'),
      setSegments: log('setSegments')
    },
    meta: {
      setPromptTokens: log('setPromptTokens'), setRoute: log('setRoute'), setStatus: log('setStatus'),
      setTelemetry: log('setTelemetry'), setSteers: log('setSteers'), reset: log('metaReset')
    },
    tools: {
      fileRef: { current: null }, clearFile: log('clearFile'), clear: log('toolsClear'),
      setRows: log('setRows'), setCall: log('setCall'), apply: () => null, appendToFile: log('appendToFile')
    },
    set: {
      files: log('setFiles'), pendingFiles: log('setPendingFiles'), chats: log('setChats'),
      errors: log('setErrors'), compacting: log('setCompacting'), hasSummary: log('setHasSummary'),
      ended: log('setEnded'), endedReason: log('setEndedReason'), canContinue: log('setCanContinue')
    },
    actions: {
      finalize: log('finalize'), finalizeBackground: log('finalizeBackground'), syncView: log('syncView'),
      loadModels: log('loadModels'), loadAppConfig: log('loadAppConfig'), loadBudget: log('loadBudget'),
      loadLedger: log('loadLedger'), refreshSpacesPending: log('refreshSpacesPending')
    }
  };
  return ctx;
}
const did = (ctx, name) => ctx.calls.some(c => c[0] === name);

test('dispatchWs reports an unknown frame rather than silently dropping it', () => {
  const ctx = wsCtx();
  assert.equal(dispatchWs({ type: 'content', chatId: 'c1', text: 'hi' }, ctx), true);
  assert.equal(dispatchWs({ type: 'not_a_real_frame' }, ctx), false);
  assert.equal(dispatchWs(null, ctx), false);
  assert.equal(dispatchWs({}, ctx), false);
});

test('every frame the server can send has a handler', () => {
  // Kept in step with server/lib/ws: adding a frame type there without one here
  // is exactly the bug this catches.
  const SENT = ['session_revoked', 'config', 'resume', 'files', 'tool_live', 'tool_live_delta',
    'tool_exec', 'tool', 'compacting', 'compacted', 'ctx_rolling', 'title', 'chat_ended',
    'routed', 'queued', 'status', 'prompt_size', 'telemetry', 'steered', 'start',
    'reasoning', 'content', 'error', 'done'];
  for (const type of SENT) assert.ok(handlers[type], 'no handler for ' + type);
});

test('a frame for a background chat updates the mirror but never the view', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c2', text: 'hello' }, ctx);
  assert.equal(ctx.recs.get('c2').content, 'hello', 'the mirror accumulated it');
  assert.equal(did(ctx, 'pushContent'), false, 'but the visible stream was untouched');
});

test('the same frame for the active chat does reach the view', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c1', text: 'hello' }, ctx);
  assert.equal(ctx.recs.get('c1').content, 'hello');
  assert.equal(did(ctx, 'pushContent'), true);
});

test('content carrying a tool marker retires the live tool rows', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c1', text: '\n\n[[OQR:eyJ9]]\n' }, ctx);
  assert.equal(did(ctx, 'setCall'), true);
  assert.equal(did(ctx, 'setRows'), true);
});

test('ordinary content leaves the live tool rows alone', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c1', text: 'just prose' }, ctx);
  assert.equal(did(ctx, 'setCall'), false);
});

test('a new turn commits a previous one whose reveal had not caught up', () => {
  const ctx = wsCtx('c1');
  ctx.stream.donePending.current = true;
  ctx.refs.nextTurnPending.current = true;
  dispatchWs({ type: 'start', chatId: 'c1', messageId: 'a1' }, ctx);
  assert.equal(did(ctx, 'finalize'), true, 'the stranded turn was committed');
  assert.equal(ctx.refs.nextTurnPending.current, false, 'and it does not also trigger the queue');
  assert.equal(did(ctx, 'begin'), true);
});

test('a new turn with nothing pending does not commit anything', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'start', chatId: 'c1', messageId: 'a1' }, ctx);
  assert.equal(did(ctx, 'finalize'), false);
  assert.equal(did(ctx, 'begin'), true);
});

test('start resets the record so a retry does not inherit the last attempt', () => {
  const ctx = wsCtx('c1');
  const rec = ctx.mirror.recFor('c1');
  rec.content = 'old'; rec.reasoning = 'old'; rec.done = true; rec.steers = ['x'];
  dispatchWs({ type: 'start', chatId: 'c1', messageId: 'a2' }, ctx);
  assert.equal(rec.content, '');
  assert.equal(rec.reasoning, '');
  assert.equal(rec.done, false);
  assert.deepEqual(rec.steers, []);
  assert.equal(rec.assistantId, 'a2');
});

test('an error after text has streamed keeps the text instead of discarding it', () => {
  const ctx = wsCtx('c1');
  ctx.mirror.recFor('c1').content = 'half a reply';
  dispatchWs({ type: 'error', chatId: 'c1', error: 'boom' }, ctx);
  assert.equal(did(ctx, 'finalize'), true, 'committed');
  assert.equal(did(ctx, 'clear'), false, 'not thrown away');
  assert.equal(did(ctx, 'setErrors'), true);
});

test('an error before any text clears the stream instead of committing nothing', () => {
  const ctx = wsCtx('c1');
  ctx.mirror.recFor('c1');
  dispatchWs({ type: 'error', chatId: 'c1', error: 'boom' }, ctx);
  assert.equal(did(ctx, 'finalize'), false);
  assert.equal(did(ctx, 'clear'), true);
  assert.equal(did(ctx, 'dropRec'), true);
});

test('an error in a background chat is finalized there, not on screen', () => {
  const ctx = wsCtx('c1');
  ctx.mirror.recFor('c2').content = 'text';
  dispatchWs({ type: 'error', chatId: 'c2', error: 'boom' }, ctx);
  assert.equal(did(ctx, 'finalizeBackground'), true);
  assert.equal(did(ctx, 'finalize'), false);
});

test('done on a background chat finalizes it without touching the view', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'done', chatId: 'c2', messageId: 'a1' }, ctx);
  assert.equal(did(ctx, 'finalizeBackground'), true);
  assert.equal(did(ctx, 'setCanContinue'), false);
  assert.equal(did(ctx, 'syncBusy'), true, 'the sidebar busy dot still updates');
});

test('done records the message id a pending model comparison was waiting for', () => {
  const ctx = wsCtx('c1');
  ctx.refs.compareRef.current = { chatId: 'c1', messageId: null, remaining: ['m2'] };
  dispatchWs({ type: 'done', chatId: 'c1', messageId: 'a9' }, ctx);
  assert.equal(ctx.refs.compareRef.current.messageId, 'a9');
  assert.equal(ctx.refs.nextTurnPending.current, true);
});

test('done does not overwrite a comparison id that is already set', () => {
  const ctx = wsCtx('c1');
  ctx.refs.compareRef.current = { chatId: 'c1', messageId: 'first', remaining: [] };
  dispatchWs({ type: 'done', chatId: 'c1', messageId: 'a9' }, ctx);
  assert.equal(ctx.refs.compareRef.current.messageId, 'first');
});

test('reasoning segments accumulate per index, not into one blob', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'reasoning', chatId: 'c1', seg: 0, text: 'aa' }, ctx);
  dispatchWs({ type: 'reasoning', chatId: 'c1', seg: 1, text: 'bb' }, ctx);
  dispatchWs({ type: 'reasoning', chatId: 'c1', seg: 0, text: 'cc' }, ctx);
  assert.deepEqual(ctx.recs.get('c1').reasonSegs, ['aacc', 'bb']);
});

test('unsegmented reasoning marks the turn as thinking only while no text has arrived', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'reasoning', chatId: 'c1', text: 'hmm' }, ctx);
  assert.equal(ctx.recs.get('c1').phase, 'thinking');
  ctx.recs.get('c1').content = 'answer';
  dispatchWs({ type: 'reasoning', chatId: 'c1', text: ' more' }, ctx);
  assert.equal(ctx.recs.get('c1').reasoning, 'hmm more');
});

test('status of generating clears the prefill readout rather than showing a phase', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'status', chatId: 'c1', phase: 'prefill', pct: 40 }, ctx);
  assert.equal(ctx.recs.get('c1').status.pct, 40);
  dispatchWs({ type: 'status', chatId: 'c1', phase: 'generating' }, ctx);
  assert.equal(ctx.recs.get('c1').status, null);
});

test('a space frame goes out as an event and refreshes only for membership changes', () => {
  const ctx = wsCtx();
  assert.equal(isSpaceFrame('space_invite'), true);
  assert.equal(isSpaceFrame('done'), false);
  dispatchWs({ type: 'space_message' }, ctx);
  assert.equal(did(ctx, 'refreshSpacesPending'), false);
  dispatchWs({ type: 'space_invite' }, ctx);
  assert.equal(did(ctx, 'refreshSpacesPending'), true);
});

test('resume rebuilds every turn and only syncs the view when one is on screen', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'resume', turns: [{ chatId: 'c2', content: 'x' }] }, ctx);
  assert.equal(did(ctx, 'resumeRec'), true);
  assert.equal(did(ctx, 'syncView'), false, 'nothing resumed for the chat on screen');
  const ctx2 = wsCtx('c1');
  dispatchWs({ type: 'resume', turns: [{ chatId: 'c1', content: 'x', promptTokens: 42 }] }, ctx2);
  assert.equal(did(ctx2, 'syncView'), true);
  assert.equal(did(ctx2, 'setPromptTokens'), true);
});

test('resume ignores a malformed turn instead of throwing away the batch', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'resume', turns: [null, { chatId: null }, { chatId: 'c1', content: 'ok' }] }, ctx);
  assert.equal(ctx.calls.filter(c => c[0] === 'resumeRec').length, 1);
});

test('a files frame for another chat is ignored', () => {
  const ctx = wsCtx('c1');
  ctx.refs.activeIdRef.current = 'c1';
  dispatchWs({ type: 'files', chatId: 'c2', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'setFiles'), false);
  dispatchWs({ type: 'files', chatId: 'c1', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'setFiles'), true);
});

test('a file that has landed on disk retires its live preview', () => {
  const ctx = wsCtx('c1');
  ctx.tools.fileRef.current = { path: 'a.py' };
  dispatchWs({ type: 'files', chatId: 'c1', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'clearFile'), true);
});

test('a preview of a file that has not landed yet is left running', () => {
  const ctx = wsCtx('c1');
  ctx.tools.fileRef.current = { path: 'b.py' };
  dispatchWs({ type: 'files', chatId: 'c1', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'clearFile'), false);
});

test('chat_ended marks the sidebar row even when the chat is not on screen', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'chat_ended', chatId: 'c2', reason: 'done here' }, ctx);
  assert.equal(did(ctx, 'setChats'), true);
  assert.equal(did(ctx, 'setEnded'), false, 'but the banner is only for the open chat');
});

/* ---------- light/dark toggle ---------- */

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

test('extractHeadings pulls ATX headings with their level and source order', () => {
  const md = '# Title\n\nintro\n\n## Section A\ntext\n\n### Deep\n\n## Section B';
  const hs = extractHeadings(md);
  assert.deepEqual(hs.map(h => [h.level, h.text, h.li]), [
    [1, 'Title', 0], [2, 'Section A', 1], [3, 'Deep', 2], [2, 'Section B', 3]
  ]);
});

test('extractHeadings ignores hash lines inside fenced code', () => {
  const md = '## Real\n\n```bash\n# not a heading\n```\n\n## Also real';
  assert.deepEqual(extractHeadings(md).map(h => h.text), ['Real', 'Also real']);
});

test('extractHeadings strips inline markdown from the heading text', () => {
  const md = '## The `run` **tool** and [a link](http://x)';
  assert.equal(extractHeadings(md)[0].text, 'The run tool and a link');
});

test('extractHeadings returns nothing when there are no headings', () => {
  assert.deepEqual(extractHeadings('just a paragraph, no hashes'), []);
  assert.deepEqual(extractHeadings(''), []);
});

test('buildOutline flattens only assistant answers, tagged by message id', () => {
  const msgs = [
    { id: 'u1', role: 'user', content: '# not mine' },
    { id: 'a1', role: 'assistant', content: '## One\n\n## Two' },
    { id: 'a2', role: 'assistant', content: 'no headings here' },
    { id: 'a3', role: 'assistant', content: '### Three' },
  ];
  assert.deepEqual(buildOutline(msgs), [
    { mid: 'a1', li: 0, level: 2, text: 'One' },
    { mid: 'a1', li: 1, level: 2, text: 'Two' },
    { mid: 'a3', li: 0, level: 3, text: 'Three' },
  ]);
});

const DOCS_MODELS = [
  { id: 'a', displayName: 'Sonata', description: 'Everyday', docsIds: [{ label: 'Chat', value: 'sonata-1' }] },
  { id: 'b', displayName: 'Aria', description: 'Quick', docsGroup: 'Legacy models', docsIds: [] },
  { id: 'c', displayName: 'Cadence', description: 'Old', docsGroup: 'Legacy models', docsIds: [] },
  { id: 'd', displayName: 'Router', kind: 'router', docsIds: [] },
  { id: 'e', displayName: 'Hidden', docsHidden: true, docsIds: [] }
];

test('docsModels drops routers, hidden entries and removed rows', () => {
  assert.deepEqual(docsModels(DOCS_MODELS).map(m => m.id), ['a', 'b', 'c']);
  assert.deepEqual(docsModels(null), []);
});

test('docsTree keeps ungrouped models at the top and folds the rest by label', () => {
  const tree = docsTree(DOCS_MODELS, docsConfig(null));
  assert.deepEqual(tree.models.top.map(m => m.id), ['a']);
  assert.equal(tree.models.groups.length, 1);
  assert.equal(tree.models.groups[0].label, 'Legacy models');
  assert.deepEqual(tree.models.groups[0].models.map(m => m.id), ['b', 'c']);
});

test('docsTree hides a custom section that has no pages', () => {
  const cfg = docsConfig({ sections: [{ id: 'g', label: 'Guides', pages: [] }, { id: 'h', label: 'Help', pages: [{ id: 'p', title: 'P' }] }] });
  assert.deepEqual(docsTree(DOCS_MODELS, cfg).sections.map(s => s.id), ['h']);
});

test('docsSearch matches a group by its own label, and returns null for an empty query', () => {
  const tree = docsTree(DOCS_MODELS, docsConfig(null));
  assert.equal(docsSearch(tree, '  '), null);
  const hit = docsSearch(tree, 'legacy');
  assert.deepEqual(hit.models.top, []);
  assert.deepEqual(hit.models.groups[0].models.map(m => m.id), ['b', 'c']);
});

test('a docs path round-trips through parseDocsPath', () => {
  for (const target of [{ kind: 'overview', id: null }, { kind: 'model', id: 'a b/c' }, { kind: 'page', id: 'pricing' }]) {
    const parsed = parseDocsPath(docsPath(target));
    assert.equal(parsed.kind, target.kind);
    assert.equal(parsed.id, target.id);
  }
});

test('parseDocsPath falls back to the overview for anything else', () => {
  assert.equal(parseDocsPath('/docs').kind, 'overview');
  assert.equal(parseDocsPath('/chat/x').kind, 'overview');
  assert.equal(parseDocsPath('/docs/m/%E0%A4%A').id, '%E0%A4%A');
});

test('fmtTokens shortens to K and M and drops a trailing zero', () => {
  assert.equal(fmtTokens(1000000), '1M');
  assert.equal(fmtTokens(1500000), '1.5M');
  assert.equal(fmtTokens(128000), '128K');
  assert.equal(fmtTokens(512), '512');
  assert.equal(fmtTokens(0), '');
  assert.equal(fmtTokens(null), '');
});

test('fmtPrice keeps integers bare and trims float noise', () => {
  assert.equal(fmtPrice(2), '$2');
  assert.equal(fmtPrice(0.2), '$0.2');
  assert.equal(fmtPrice(2.5), '$2.5');
  assert.equal(fmtPrice(null), '');
  assert.equal(fmtPrice(''), '');
});

test('priceRange keeps whichever half is set', () => {
  assert.equal(priceRange({ priceIn: 2, priceOut: 10 }), '$2 / $10');
  assert.equal(priceRange({ priceIn: 2, priceOut: null }), '$2');
  assert.equal(priceRange({ priceIn: null, priceOut: null }), '');
});

test('bulletLines strips list markers and blank lines', () => {
  assert.deepEqual(bulletLines('- one\n\n* two\n  three  '), ['one', 'two', 'three']);
  assert.deepEqual(bulletLines(''), []);
});

test('publicModelId uses the first identifier an admin entered, never the catalog row id', () => {
  assert.equal(publicModelId(DOCS_MODELS[0]), 'sonata-1');
  assert.equal(publicModelId(DOCS_MODELS[1]), '');
});
