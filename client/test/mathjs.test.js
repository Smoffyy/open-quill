import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMath, isolateDisplayMath, wrapMathEnvironments } from '../src/lib/mathjs.js';

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
