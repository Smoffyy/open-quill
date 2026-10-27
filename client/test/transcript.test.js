import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSteps, lastSentence, refineSentence, thoughtSeconds } from '../src/lib/reasoning.js';
import { hasToolCall, previewOf, buildTree, collapseRuns } from '../src/lib/threadmeta.js';
import { extractHeadings, buildOutline } from '../src/lib/outline.js';
import { hasMath, isolateDisplayMath, wrapMathEnvironments } from '../src/lib/mathjs.js';
import { ensureCommon, highlight } from '../src/lib/hljs.js';
import { dirOf, baseName as fileBaseName } from '../src/lib/files.js';
import { previewKind, uploadFileOf, isVisionImage, needsConversion } from '../src/lib/filepreview.js';
import { isAnimatedImage } from '../src/lib/animatedimage.js';
import { splitTurn, withLive, groupCounts, fileChanges, totals, stepTarget, canonTool } from '../src/lib/codeview.js';
import { agentPanelState, groupPlans, isNewPlan, planRecords, latestPlanRef } from '../src/lib/agentpanel.js';
import { oqrRecords } from '../src/lib/oqr.js';
import {
  baseName, extOf, fmtSize, escHtml, diffLines, stableLineDiff, collapseRuns as collapseDiffRuns,
  splitHighlightedLines, markLine, buildTree as buildFileTree, findMatches, countFiles, allDirPaths, ancestorDirs
} from '../src/lib/artifacts.js';

const oqr = (rec) => '[[OQR:' + Buffer.from(JSON.stringify(rec), 'utf8').toString('base64') + ']]';
const toolRun = (call, result) => oqr({ call, result });

test('lastSentence returns the newest complete thought as plain prose', () => {
  const cases = [
    ['I need to edit this file. Then I will run', 'I need to edit this file.'],
    ['I need to edit this file. Then I will run it.', 'Then I will run it.'],
    ['Created it. Now thinking about beta.py...', 'Now thinking about beta.py...'],
    ["Done with alpha.py's functions.", "Done with alpha.py's functions."],
    ['The value is 0.5 meters. Done here.', 'The value is 0.5 meters.'],
    ['No punctuation yet so nothing', ''],
    ['', ''],
    [null, ''],
    ['A. B. This is the real one.', 'This is the real one.'],
    ['* *Constraint Check:* No lists/bullets in the explanation.', 'Constraint Check: No lists/bullets in the explanation.'],
    ['**Constraint Check:** No lists/bullets in the explanation.', 'Constraint Check: No lists/bullets in the explanation.'],
    ['### Step 1: check the constraint.', 'Step 1: check the constraint.'],
    ['Run `pytest -k foo` to check.', 'Run pytest -k foo to check.'],
    ['- First check a*b is not italic.', 'First check a*b is not italic.'],
    ['I checked the config. "Well maybe its this."', 'I checked the config.'],
    ['The user asked for "dark mode" in the settings.', 'The user asked for dark mode in the settings.'],
    ['He said "no." Then I moved on.', 'Then I moved on.'],
    ['Checked the router file already. Okay.', 'Checked the router file already.'],
    ['Well, I should check the config file first.', 'I should check the config file first.'],
    ['so i need to open the router file next.', 'I need to open the router file next.'],
    ['Wellington is the capital of New Zealand.', 'Wellington is the capital of New Zealand.'],
    ['Sorting it out now.', 'Sorting it out now.']
  ];
  for (const [input, expected] of cases) assert.equal(lastSentence(input), expected, String(input));
  for (const frag of ['Okay.', 'Hmm.', 'Right.', 'Done here.', 'Let me check.', 'Well maybe its this.']) {
    assert.equal(lastSentence(frag), '', frag);
  }
  const long = lastSentence(('the quick brown fox jumps over the lazy dog ').repeat(12).trim() + '.');
  assert.ok(long.length <= 151 && long.endsWith('…'), 'a very long sentence is truncated');
  assert.equal(refineSentence(''), '');
  assert.equal(refineSentence(null), '');
});

test('reasoning.js has no control bytes or regex lookbehind that would break the bundle', () => {
  const src = fs.readFileSync(new URL('../src/lib/reasoning.js', import.meta.url), 'utf8');
  const bad = [...src].filter(c => c.charCodeAt(0) < 9 || (c.charCodeAt(0) > 13 && c.charCodeAt(0) < 32));
  assert.deepEqual(bad, [], 'a literal control byte silently breaks the pattern it sits in');
  assert.equal(/\(\?<[=!]/.test(src), false, 'lookbehind is a parse-time error on Safari < 16.4');
});

test('parseSteps splits on blank lines, keeps paragraphs inside a step and normalises CRLF', () => {
  assert.deepEqual(parseSteps('one\ntwo\n\nthree'), [['one', 'two'], ['three']]);
  assert.deepEqual(parseSteps('one\r\ntwo\r\n\r\nthree'), [['one', 'two'], ['three']]);
  assert.deepEqual(parseSteps('solo'), [['solo']]);
  assert.deepEqual(parseSteps(''), []);
  assert.deepEqual(parseSteps('   \n\n   '), []);
});

test('thoughtSeconds rounds up to at least a second and ignores nonsense', () => {
  assert.equal(thoughtSeconds(0), 0);
  assert.equal(thoughtSeconds(-5), 0);
  assert.equal(thoughtSeconds(120), 1);
  assert.equal(thoughtSeconds(57000), 57);
});

test('hasToolCall and previewOf read the stored message text', () => {
  assert.equal(hasToolCall('[[OQR:eyJhIjoxfQ==]]'), true);
  assert.equal(hasToolCall('just prose'), false);
  assert.equal(hasToolCall(''), false);
  assert.equal(previewOf('# Title with **bold**'), 'Title with bold');
  assert.equal(previewOf('before ```js\ncode\n``` after'), 'before after');
  assert.equal(previewOf('see [the docs](https://x.example)'), 'see the docs');
  assert.equal(previewOf(''), '');
  const out = previewOf('word '.repeat(80), 20);
  assert.ok(out.length <= 20 && out.endsWith('…'));
});

test('buildTree nests children in order and keeps an orphan as a root', () => {
  assert.deepEqual(buildTree([]), []);
  const roots = buildTree([{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'a' }]);
  assert.equal(roots.length, 1);
  assert.deepEqual(roots[0].children.map(n => n.id), ['b', 'c']);
  assert.deepEqual(buildTree([{ id: 'x', parentId: 'ghost' }]).map(n => n.id), ['x']);
});

test('collapseRuns folds a linear chain into one run and stops at a fork', () => {
  const flat = collapseRuns(buildTree([{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }])[0]);
  assert.deepEqual(flat.run.map(n => n.id), ['a', 'b', 'c']);
  assert.deepEqual(flat.forks, []);
  const split = collapseRuns(buildTree([{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'a' }])[0]);
  assert.deepEqual(split.run.map(n => n.id), ['a']);
  assert.deepEqual(split.forks.map(n => n.id), ['b', 'c']);
});

test('extractHeadings pulls plain ATX headings in order, outside code fences', () => {
  const hs = extractHeadings('# Title\n\nintro\n\n## Section A\ntext\n\n### Deep\n\n## Section B');
  assert.deepEqual(hs.map(h => [h.level, h.text, h.li]), [[1, 'Title', 0], [2, 'Section A', 1], [3, 'Deep', 2], [2, 'Section B', 3]]);
  assert.deepEqual(extractHeadings('## Real\n\n```bash\n# not a heading\n```\n\n## Also real').map(h => h.text), ['Real', 'Also real']);
  assert.equal(extractHeadings('## The `run` **tool** and [a link](http://x)')[0].text, 'The run tool and a link');
  assert.deepEqual(extractHeadings('just a paragraph, no hashes'), []);
  assert.deepEqual(extractHeadings(''), []);
});

test('buildOutline flattens only assistant answers, tagged by message id', () => {
  const msgs = [
    { id: 'u1', role: 'user', content: '# not mine' },
    { id: 'a1', role: 'assistant', content: '## One\n\n## Two' },
    { id: 'a2', role: 'assistant', content: 'no headings here' },
    { id: 'a3', role: 'assistant', content: '### Three' }
  ];
  assert.deepEqual(buildOutline(msgs), [
    { mid: 'a1', li: 0, level: 2, text: 'One' },
    { mid: 'a1', li: 1, level: 2, text: 'Two' },
    { mid: 'a3', li: 0, level: 3, text: 'Three' }
  ]);
});

test('hasMath gates the expensive KaTeX path', () => {
  assert.equal(hasMath('plain prose with no maths'), false);
  assert.equal(hasMath('inline $x^2$ here'), true);
  assert.equal(hasMath('display \\[x\\]'), true);
  assert.equal(hasMath('\\begin{align}x\\end{align}'), true);
  assert.equal(hasMath('\\ce{H2O}'), true);
  assert.equal(hasMath(''), false);
});

test('wrapMathEnvironments leaves code, existing math and eqnarray alone', () => {
  for (const src of [
    '```\n\\begin{align}x\\end{align}\n```',
    '~~~\n\\begin{align}x\\end{align}\n~~~',
    '$$\\begin{align}x\\end{align}$$',
    '$\\begin{align}x\\end{align}$',
    '\\begin{eqnarray}a&=&b\\end{eqnarray}'
  ]) assert.equal(wrapMathEnvironments(src), src);
});

test('wrapMathEnvironments wraps every supported environment, past an unpaired dollar, without blank lines inside', () => {
  const out = wrapMathEnvironments('The plan costs $5 total.\n\n\\begin{align}\nE = mc^2\n\\end{align}');
  assert.ok(out.includes('$$') && out.includes('\\begin{align}'), 'a price does not stop a later environment being wrapped');
  for (const env of ['subequations', 'multlined', 'cases*']) {
    assert.ok(wrapMathEnvironments(`\\begin{${env}}\na=b\n\\end{${env}}`).includes('$$'), env + ' should be wrapped');
  }
  const gap = wrapMathEnvironments('\\begin{align}\na &= b\n\n c &= d\n\\end{align}');
  assert.ok(!/\n[ \t]*\n/.test(gap.slice(gap.indexOf('$$') + 2, gap.lastIndexOf('$$'))), 'no blank line may survive inside the wrapped body');
});

test('isolateDisplayMath gives a display block its own paragraph and leaves inline math and code alone', () => {
  assert.equal(isolateDisplayMath('$$\\begin{align}a &= b\\end{align}$$\nCosts 5.'), '$$\n\\begin{align}a &= b\\end{align}\n$$\n\nCosts 5.');
  assert.equal(isolateDisplayMath('Here:\n$$x^2$$\nDone.'), 'Here:\n\n$$\nx^2\n$$\n\nDone.');
  assert.equal(isolateDisplayMath('Intro:\n$$\n\\begin{align}\na &= b\n\\end{align}\n$$\nOutro.'), 'Intro:\n\n$$\n\\begin{align}\na &= b\n\\end{align}\n$$\n\nOutro.');
  assert.equal(isolateDisplayMath('Intro:\n\n$$x^2$$\n\nOutro.'), 'Intro:\n\n$$\nx^2\n$$\n\nOutro.');
  assert.equal(isolateDisplayMath('1.  Solve:\n    $$x = 2$$\n    Done.'), '1.  Solve:\n\n    $$\n    x = 2\n    $$\n\n    Done.', 'a block inside a list item keeps the item\'s indent');
  const inline = 'The value $x$ and $y$ are inline.';
  assert.equal(isolateDisplayMath(inline), inline);
  const fenced = '```\n$$x^2$$\ntext\n```';
  assert.equal(isolateDisplayMath(fenced), fenced);
});

test('highlighting is identical with the cache bypassed, so the streaming path cannot change output', async () => {
  assert.ok(await ensureCommon(), 'highlight.js common bundle loaded');
  const code = 'function add(a, b) {\n  return a + b;\n}\n';
  const viaCache = highlight(code, 'javascript');
  assert.equal(highlight(code, 'javascript', { cache: false }), viaCache);
  assert.match(viaCache, /<span class="hljs-/, 'really highlighted, not escaped plain text');
  let prev = '';
  for (const n of [10, 20, 30]) {
    const out = highlight(code.slice(0, n), 'javascript', { cache: false });
    assert.notEqual(out, prev);
    assert.equal(out, highlight(code.slice(0, n), 'javascript', { cache: false }));
    prev = out;
  }
});

test('a path splits into folder and name for the shapes the sandbox produces', () => {
  assert.equal(dirOf('src/utils/__init__.py'), 'src/utils');
  assert.equal(dirOf('README.md'), '');
  assert.equal(dirOf('src\\utils\\a.py'), 'src/utils');
  assert.equal(dirOf(null), '');
  assert.equal(fileBaseName('src/utils/__init__.py'), '__init__.py');
});

test('previewKind picks a native viewer by extension first, then by mime', () => {
  assert.equal(previewKind('photo.JPG'), 'image');
  assert.equal(previewKind('logo.svg', 'image/svg+xml'), 'image');
  assert.equal(previewKind('clip', 'video/mp4'), 'video');
  assert.equal(previewKind('song.flac'), 'audio');
  assert.equal(previewKind('paper.pdf'), 'pdf');
  assert.equal(previewKind('README.md'), 'markdown');
  assert.equal(previewKind('report.docx'), 'text');
  assert.equal(previewKind('Makefile'), 'text');
  assert.equal(previewKind('index.ts', 'video/mp2t'), 'text');
  assert.equal(previewKind('Main.hx', ''), 'text');
  assert.equal(previewKind('scan.heic', 'image/heic'), 'text');
  assert.equal(previewKind('scan.tiff', 'image/tiff'), 'text');
});

test('uploads: only /uploads paths, SVG is not a vision image, and only unreadable images convert', () => {
  assert.equal(uploadFileOf('/uploads/abc.pdf'), 'abc.pdf');
  assert.equal(uploadFileOf('/uploads/abc.pdf?x=1'), 'abc.pdf');
  assert.equal(uploadFileOf('https://example.com/uploads/abc.pdf'), '');
  assert.equal(uploadFileOf(null), '');
  assert.equal(isVisionImage('image/png'), true);
  assert.equal(isVisionImage('image/svg+xml'), false);
  assert.equal(isVisionImage('text/plain'), false);
  for (const t of ['image/bmp', 'image/avif', 'image/tiff', 'image/x-icon', 'IMAGE/BMP']) assert.equal(needsConversion(t), true, t);
  for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'application/pdf', '', undefined]) assert.equal(needsConversion(t), false, String(t));
});

const bytes = (...parts) => {
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
};
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const pngChunk = (type, len = 0) => bytes(be32(len), type, new Array(len).fill(0), [0, 0, 0, 0]);
const png = (...chunks) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ...chunks);
const webp = (...chunks) => bytes('RIFF', le32(4), 'WEBP', ...chunks);

test('an animated PNG, WebP or GIF is recognised and a still image is not', () => {
  assert.equal(isAnimatedImage(png(pngChunk('IHDR', 13), pngChunk('acTL', 8), pngChunk('IDAT', 4))), true);
  assert.equal(isAnimatedImage(png(pngChunk('IHDR', 13), pngChunk('IDAT', 4), pngChunk('IEND'))), false);
  assert.equal(isAnimatedImage(png(pngChunk('IHDR', 13), pngChunk('IDAT', 4), pngChunk('acTL', 8))), false, 'acTL after the image data does not count');
  assert.equal(isAnimatedImage(webp('VP8X', le32(10), [0x02], new Array(9).fill(0))), true);
  assert.equal(isAnimatedImage(webp('VP8X', le32(10), [0x10], new Array(9).fill(0))), false);
  assert.equal(isAnimatedImage(webp('VP8 ', le32(2), [0, 0])), false);
  assert.equal(isAnimatedImage(bytes('GIF89a', [0, 0])), true);
  assert.equal(isAnimatedImage(bytes([0xff, 0xd8, 0xff, 0xe0])), false);
  assert.equal(isAnimatedImage(new Uint8Array(0)), false);
  assert.equal(isAnimatedImage(null), false);
});

test('a truncated chunk length never throws or loops', () => {
  assert.equal(isAnimatedImage(png(be32(0xffffffff), 'IHDR')), false);
  assert.equal(isAnimatedImage(webp('ANI')), false);
});

test('a turn splits into text and runs of tool calls, and text between calls starts a new group', () => {
  const content = 'Starting.\n\n' + toolRun({ tool: 'create_file', path: 'a.py' }, { ok: true, adds: 3, v: 1 })
    + '\n' + toolRun({ tool: 'bash', cmd: 'python a.py' }, { ok: true, output: 'hi' }) + '\n\nDone.';
  const parts = splitTurn(content);
  assert.deepEqual(parts.map(p => p.kind), ['text', 'tools', 'text']);
  assert.equal(parts[1].items.length, 2);
  assert.equal(parts[1].items[1].call.cmd, 'python a.py');
  const split = toolRun({ tool: 'view', path: 'a' }, { ok: true }) + '\n\nNow editing.\n\n' + toolRun({ tool: 'str_replace', path: 'a' }, { ok: true, adds: 1, dels: 1 });
  assert.deepEqual(splitTurn(split).map(p => p.kind), ['tools', 'text', 'tools']);
});

test('calls still being written resolve their alias and join the last group or open a new one', () => {
  assert.equal(canonTool('write_file'), 'create_file');
  assert.equal(canonTool('rename_file'), 'move_file');
  assert.equal(canonTool('constructor'), 'constructor');
  const parts = splitTurn(toolRun({ tool: 'view', path: 'a' }, { ok: true }));
  const live = withLive(parts, [{ index: 0, call: { tool: 'write_file', path: 'b' } }]);
  assert.equal(live.length, 1);
  assert.equal(live[0].items[1].call.tool, 'create_file');
  assert.equal(live[0].items[1].result, null);
  assert.equal(withLive(splitTurn('Just text.'), [{ index: 0, call: { tool: 'bash' } }]).length, 2);
  assert.equal(withLive(parts, []), parts);
});

test('a group is summarised by kind, in a fixed order, with failures counted', () => {
  const { list, failed } = groupCounts([
    { call: { tool: 'bash' }, result: { ok: false } },
    { call: { tool: 'view' }, result: { ok: true } },
    { call: { tool: 'bash' }, result: { ok: true } },
    { call: { tool: 'mcp_x_y' }, result: { ok: true } }
  ]);
  assert.deepEqual(list, [{ kind: 'command', n: 2 }, { kind: 'read', n: 1 }, { kind: 'tool', n: 1 }]);
  assert.equal(failed, 1);
});

test('file changes add up per path and follow moves and deletes', () => {
  const parts = splitTurn([
    toolRun({ tool: 'create_file', path: 'a.py' }, { ok: true, adds: 5, v: 1 }),
    toolRun({ tool: 'str_replace', path: 'a.py' }, { ok: true, adds: 2, dels: 1, v: 2 }),
    toolRun({ tool: 'create_file', path: 'b.py' }, { ok: false, error: 'nope' }),
    toolRun({ tool: 'create_file', path: 'c.py' }, { ok: true, adds: 1, v: 1 }),
    toolRun({ tool: 'move_file', path: 'a.py', new_path: 'src/a.py' }, { ok: true }),
    toolRun({ tool: 'delete_file', path: 'c.py' }, { ok: true })
  ].join(''));
  const changes = fileChanges(parts);
  assert.deepEqual(changes, [{ path: 'src/a.py', adds: 7, dels: 1, created: true, v: 2 }]);
  assert.deepEqual(totals(changes), { adds: 7, dels: 1 });
});

test('a step names what it acted on', () => {
  assert.equal(stepTarget({ tool: 'bash', cmd: 'npm test\necho done' }), 'npm test');
  assert.equal(stepTarget({ tool: 'move_file', path: 'a', new_path: 'b' }), 'a → b');
  assert.equal(stepTarget({ tool: 'search', query: 'x' }), '"x"');
  assert.equal(stepTarget({ tool: 'create_file', partialPath: 'sr' }), 'sr');
});

const todo = (items, extra = {}) => oqr({ call: { tool: 'todo' }, result: { ok: true, items }, ...extra });
const ask = (question, options) => oqr({ call: { tool: 'ask_user', question }, result: { ok: true, question, options } });
const step = (content, status = 'pending') => ({ content, status });
const asst = (content) => ({ role: 'assistant', content });

test('OQR records decode, including non-ASCII text', () => {
  const recs = oqrRecords('before ' + ask('Café ou thé ?', ['Café', 'Thé']) + ' after [[OQR:@@@]]');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].result.question, 'Café ou thé ?');
});

test('the plan is the latest visible, successful todo list in the thread', () => {
  const { plan } = agentPanelState([
    { id: 'a', role: 'assistant', content: todo([step('Old')]) },
    { id: 'u', role: 'user', content: 'go on' },
    { id: 'b', role: 'assistant', content: 'text ' + todo([step('One', 'completed'), step('Two', 'in_progress')]) },
    { id: 'c', role: 'assistant', content: 'no tools here' }
  ]);
  assert.deepEqual(plan.items.map(i => i.content), ['One', 'Two']);
  assert.equal(plan.done, 1);
  assert.equal(plan.total, 2);
  assert.equal(agentPanelState([asst(todo([step('x')], { hidden: true }))]).plan, null);
  assert.equal(agentPanelState([asst(oqr({ call: { tool: 'todo' }, result: { ok: false, error: 'bad' } }))]).plan, null);
});

test('status changes and small edits update the plan; a different list starts a new one', () => {
  const a1 = [step('Scaffold'), step('Write code'), step('Test')];
  const a2 = [step('Scaffold', 'completed'), step('Write code', 'in_progress'), step('Test'), step('Ship')];
  const b1 = [step('Draft the haiku'), step('Translate it')];
  assert.equal(isNewPlan(null, a1), true);
  assert.equal(isNewPlan(a1, a2), false, 'same steps with a new one added is an update');
  assert.equal(isNewPlan(a2, b1), true);
  const g = groupPlans([a1, a2, b1]);
  assert.deepEqual(g.plan.items, b1);
  assert.deepEqual(g.previousPlan.items, a2, 'the previous plan is kept in its last state');
  assert.equal(g.previousPlan.done, 1);
  assert.notEqual(g.plan.key, g.previousPlan.key);
  const three = groupPlans([[step('One')], [step('Two')], [step('Three'), step('Four')], [step('Three', 'completed'), step('Four')]]);
  assert.equal(three.plan.items[0].content, 'Three');
  assert.equal(three.previousPlan.items[0].content, 'Two', 'only the plan right before the current one is kept');
  assert.deepEqual(groupPlans([]), { plan: null, previousPlan: null });
});

test('a plan in the reply still being written shows up straight away', () => {
  const state = agentPanelState([asst(todo([step('Old A'), step('Old B')]))], { liveContent: 'Starting. ' + todo([step('New A'), step('New B')]) });
  assert.equal(state.plan.items[0].content, 'New A');
  assert.equal(state.previousPlan.items[0].content, 'Old A');
});

test('a plan closes once every step is completed or cancelled, and an empty list cancels it', () => {
  const open = [step('Scaffold', 'completed'), step('Write code', 'in_progress'), step('Test')];
  const finished = [step('Scaffold', 'completed'), step('Write code', 'completed'), step('Test', 'cancelled')];
  const done = groupPlans([open, finished]);
  assert.equal(done.plan, null);
  assert.deepEqual(done.previousPlan.items, finished);
  assert.equal(done.previousPlan.total, 2, 'a cancelled step does not count towards the total');
  assert.equal(done.previousPlan.done, 2);
  const cancelled = groupPlans([open, []]);
  assert.equal(cancelled.plan, null);
  assert.deepEqual(cancelled.previousPlan.items, open, 'the cancelled plan is kept in its last state');
  const next = groupPlans([open, [], [step('Other')]]);
  assert.equal(next.plan.items[0].content, 'Other');
  assert.deepEqual(next.previousPlan.items, open);
  assert.deepEqual(groupPlans([[]]), { plan: null, previousPlan: null });
  const partial = groupPlans([[step('A', 'completed'), step('B', 'cancelled'), step('C', 'in_progress')]]);
  assert.equal(partial.plan.total, 2);
  assert.equal(partial.plan.items[1].status, 'cancelled', 'a cancelled step stays in the open plan');
});

test('a plan the member dismissed stays closed until the model writes a newer one', () => {
  const messages = [
    { id: 'a1', role: 'assistant', content: todo([step('One', 'in_progress'), step('Two')]) + todo([step('One', 'completed'), step('Two', 'in_progress')]) },
    { id: 'u1', role: 'user', content: 'stop' }
  ];
  const ref = latestPlanRef(messages);
  assert.deepEqual(ref, { msg: 'a1', n: 2 });
  const closed = groupPlans(planRecords(messages, ref));
  assert.equal(closed.plan, null);
  assert.equal(closed.previousPlan.done, 1, 'the dismissed plan is still there as the previous one');
  const later = [...messages, { id: 'a2', role: 'assistant', content: todo([step('New')]) }];
  assert.equal(groupPlans(planRecords(later, ref)).plan.items[0].content, 'New');
  assert.equal(groupPlans(planRecords(messages, { msg: 'a1', n: 1 })).plan.items[1].status, 'in_progress', 'a later update in the same reply brings the plan back');
  assert.equal(latestPlanRef([{ id: 'u', role: 'user', content: 'hi' }]), null);
});

test('artifact paths split into a name and only a real extension', () => {
  assert.equal(baseName('src/main/java/App.java'), 'App.java');
  assert.equal(baseName('README.md'), 'README.md');
  assert.equal(extOf('src/App.JAVA'), 'java');
  assert.equal(extOf('src/app.py'), 'py');
  assert.equal(extOf('notes.markdown'), 'markdown', 'a long extension is still an extension');
  assert.equal(extOf('archive.tar.gz'), 'gz');
  for (const name of ['Makefile', 'Procfile', 'notes', '.gitignore', 'src/cmd/run']) assert.equal(extOf(name), '', name);
});

test('file sizes render at a sensible precision and escHtml leaves quotes alone', () => {
  assert.equal(fmtSize(null), '');
  assert.equal(fmtSize(512), '512 B');
  assert.equal(fmtSize(2048), '2.0 KB');
  assert.equal(fmtSize(1024 * 100), '100 KB');
  assert.equal(fmtSize(1024 * 1024 * 3), '3.0 MB');
  assert.equal(escHtml('<script>a && b</script>'), '&lt;script&gt;a &amp;&amp; b&lt;/script&gt;');
  assert.equal(escHtml('say "hi"'), 'say "hi"');
});

test('line diffs find the minimal edit, keep shared context and refuse a pair that would blow up', () => {
  const rows = diffLines(['a', 'b', 'c'], ['a', 'x', 'c']);
  assert.deepEqual(rows.map(r => r.type), ['ctx', 'del', 'add', 'ctx']);
  assert.equal(rows.find(r => r.type === 'add').text, 'x');
  assert.equal(rows.find(r => r.type === 'del').text, 'b');
  assert.equal(new Set(rows.map(r => r.key)).size, rows.length, 'every row key is unique');
  const big = Array.from({ length: 2100 }, (_, i) => 'line ' + i);
  assert.equal(diffLines(big, big.slice().reverse()), null);
  const stable = stableLineDiff(['a', 'b', 'z'], ['a', 'c', 'z']);
  assert.deepEqual(stable.map(r => r.type), ['ctx', 'del', 'add', 'ctx']);
  assert.equal(stable[0].text, 'a');
  assert.equal(stable[3].text, 'z');
});

test('collapseRuns folds long unchanged stretches and expands on demand', () => {
  const rows = [
    { key: 'x', type: 'add', text: '+' },
    ...Array.from({ length: 20 }, (_, i) => ({ key: 'c' + i, type: 'ctx', text: 'same ' + i })),
    { key: 'y', type: 'del', text: '-' }
  ];
  const folded = collapseDiffRuns(rows, 3, new Set());
  const fold = folded.find(r => r.fold);
  assert.equal(fold.count, 14, 'three lines are kept at each end');
  assert.equal(folded.length, 2 + 3 + 3 + 1);
  const opened = collapseDiffRuns(rows, 3, new Set([fold.key]));
  assert.equal(opened.some(r => r.fold), false);
  assert.equal(opened.length, rows.length);
  const short = [{ key: 'a', type: 'ctx', text: '1' }, { key: 'b', type: 'ctx', text: '2' }];
  assert.deepEqual(collapseDiffRuns(short, 3, new Set()), short, 'a short run is left alone');
});

test('splitHighlightedLines reopens spans across a newline and survives a truncated tag', () => {
  assert.deepEqual(splitHighlightedLines('<span class="c">one\ntwo</span>\nthree'),
    ['<span class="c">one</span>', '<span class="c">two</span>', 'three']);
  const cut = splitHighlightedLines('ok<span class="unclosed');
  assert.equal(cut.length, 1);
  assert.match(cut[0], /^ok/);
});

test('markLine highlights matches, escapes around them and drops overlaps', () => {
  const html = markLine('a <b> a', [{ start: 0, end: 1, gid: 0 }, { start: 6, end: 7, gid: 1 }], 1);
  assert.match(html, /&lt;b&gt;/, 'text between matches is escaped');
  assert.equal((html.match(/art-mark/g) || []).length, 2);
  assert.equal((html.match(/art-mark active/g) || []).length, 1, 'only the active match is marked active');
  assert.equal((markLine('abcd', [{ start: 0, end: 3, gid: 0 }, { start: 1, end: 2, gid: 1 }], -1).match(/art-mark/g) || []).length, 1);
});

test('findMatches reports every occurrence on a line, case-insensitively', () => {
  const m = findMatches(['Foo foo', 'bar'], 'foo');
  assert.deepEqual(m.map(x => x.start), [0, 4]);
  assert.deepEqual(m.map(x => x.gid), [0, 1]);
  assert.equal(findMatches(['anything'], '').length, 0);
});

test('the file tree nests, sorts and counts paths, and compacts single-child folders', () => {
  const root = buildFileTree([
    { path: 'src/zeta.js' }, { path: 'src/alpha.js' }, { path: 'src/util/fmt.js' },
    { path: 'tests/t.js' }, { path: 'config/c.json' }, { path: 'README.md' }
  ]);
  assert.deepEqual(root.files.map(f => f.path), ['README.md']);
  assert.deepEqual([...root.dirs.keys()], ['config', 'src', 'tests']);
  const src = root.dirs.get('src');
  assert.deepEqual(src.files.map(f => f.path), ['src/alpha.js', 'src/zeta.js']);
  assert.equal(src.dirs.get('util').path, 'src/util');
  assert.equal(countFiles(root), 6);
  assert.deepEqual(allDirPaths(root).sort(), ['config', 'src', 'src/util', 'tests']);
  const chain = buildFileTree([{ path: 'src/utils/text/case.py' }]).dirs.get('src');
  assert.equal(chain.name, 'src/utils/text');
  assert.equal(chain.path, 'src/utils/text');
  const kept = buildFileTree([{ path: 'src/app.py' }, { path: 'src/utils/text/case.py' }]);
  assert.equal(kept.dirs.get('src').name, 'src', 'a folder holding its own file is not merged away');
  assert.equal([...kept.dirs.get('src').dirs.values()][0].name, 'utils/text');
});

test('the file tree survives folder names that collide with Object prototype keys', () => {
  const root = buildFileTree([{ path: 'constructor/a.js' }, { path: '__proto__/b.js' }, { path: 'toString/c.js' }]);
  assert.deepEqual([...root.dirs.keys()].sort(), ['__proto__', 'constructor', 'toString']);
  assert.deepEqual(root.dirs.get('constructor').files.map(f => f.path), ['constructor/a.js']);
  assert.deepEqual(root.dirs.get('__proto__').files.map(f => f.path), ['__proto__/b.js']);
});

test('ancestorDirs names every folder that must be open to reveal a path', () => {
  assert.deepEqual(ancestorDirs('src/utils/text/case.py'), ['src', 'src/utils', 'src/utils/text']);
  assert.deepEqual(ancestorDirs('README.md'), []);
  assert.deepEqual(ancestorDirs(''), []);
});