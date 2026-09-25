import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseName,
  extOf,
  fmtSize,
  escHtml,
  diffLines,
  stableLineDiff,
  collapseRuns as collapseDiffRuns,
  splitHighlightedLines,
  markLine,
  buildTree as buildFileTree,
  findMatches,
  countFiles,
  allDirPaths,
  ancestorDirs
} from '../src/lib/artifacts.js';

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
