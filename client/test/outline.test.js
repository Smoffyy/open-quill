import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHeadings, buildOutline } from '../src/lib/outline.js';

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
