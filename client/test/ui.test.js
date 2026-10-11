import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollInsideMenu } from '../src/lib/anchor.js';
import { isInside, anyMounted, asRefList, pushLayer, handleLayerKey, hasOpenLayer, isModalOpen } from '../src/lib/dismiss.js';
import { placeTip, placeAtCursor, TIP_GAP, TIP_EDGE, TIP_CURSOR_X, TIP_CURSOR_Y, TIP_FLIP_GAP } from '../src/lib/tip.js';
import { nextFitSize, FIT_MIN, FIT_PASSES } from '../src/lib/fittext.js';
import { clampPx, knobAt, knobRaw, knobTravel, overshoot, nearestIndex, slideFor, magnetStep, SLIDE_BASE, SLIDE_SPAN } from '../src/lib/dragsteps.js';
import { caretsAtEnd, insert, erase, move, selectAll, place, parts } from '../src/lib/multicaret.js';
import { faviconFor } from '../src/lib/favicon.js';
import { BRAND_FAVICON_DARK, BRAND_FAVICON_LIGHT } from '../src/lib/brand.js';
import { isCaptureCancel, screenshotName } from '../src/lib/screenshot.js';
import { createHistory, changedKeys, pick, historyKey } from '../src/components/admin/state/history.js';
import { stampTrail } from '../src/lib/cellfield.js';

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

const elWith = (kids = [], match = null) => {
  const el = {
    kids,
    contains: (t) => el === t || kids.includes(t),
    closest: (sel) => (match === sel ? el : null)
  };
  return el;
};

test('isInside counts the element, its children and a portalled selector, and nothing unattached', () => {
  const child = elWith();
  const a = elWith([child]);
  const b = elWith();
  assert.equal(isInside(child, [{ current: a }, { current: b }], ''), true);
  assert.equal(isInside(child, [{ current: b }], ''), false);
  assert.equal(isInside(a, [{ current: a }], ''), true);
  assert.equal(isInside(null, [{ current: null }], ''), false);
  assert.equal(isInside(elWith(), [{ current: null }, null, undefined], ''), false);
  const portalled = elWith([], '.model-submenu');
  assert.equal(isInside(portalled, [{ current: elWith() }], ''), false);
  assert.equal(isInside(portalled, [{ current: elWith() }], '.model-submenu'), true);
});

test('anyMounted gates the handler until a ref has attached, and asRefList takes one ref or many', () => {
  assert.equal(anyMounted([{ current: null }]), false);
  assert.equal(anyMounted([{ current: null }, { current: elWith() }]), true);
  assert.equal(anyMounted([]), false);
  const r = { current: null };
  assert.deepEqual(asRefList(r), [r]);
  assert.deepEqual(asRefList([r]), [r]);
});

function escape(extra = {}) {
  return { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
}

function layer(log, name, modal = false) {
  return pushLayer({ current: () => log.push(name) }, modal);
}

test('Escape closes only the most recently opened layer and consumes the key', () => {
  const log = [];
  const popDialog = layer(log, 'dialog', true);
  const popMenu = layer(log, 'menu');
  const e = escape();
  assert.equal(handleLayerKey(e), true);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(log, ['menu']);
  popMenu();
  handleLayerKey(escape());
  assert.deepEqual(log, ['menu', 'dialog']);
  popDialog();
  assert.equal(hasOpenLayer(), false);
});

test('a claimed Escape and other keys reach no layer', () => {
  const log = [];
  const pop = layer(log, 'dialog', true);
  assert.equal(handleLayerKey(escape({ defaultPrevented: true })), false);
  const enter = { key: 'Enter', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  assert.equal(handleLayerKey(enter), false);
  assert.equal(enter.defaultPrevented, false);
  assert.deepEqual(log, []);
  pop();
});

test('only modal layers pause background shortcuts', () => {
  const popMenu = layer([], 'menu');
  assert.equal(hasOpenLayer(), true);
  assert.equal(isModalOpen(), false);
  const popDialog = layer([], 'dialog', true);
  assert.equal(isModalOpen(), true);
  popDialog();
  popMenu();
  assert.equal(isModalOpen(), false);
});

test('removing a layer out of order leaves the others stacked', () => {
  const log = [];
  const popA = layer(log, 'a');
  const popB = layer(log, 'b');
  const popC = layer(log, 'c');
  popB();
  handleLayerKey(escape());
  assert.deepEqual(log, ['c']);
  popC();
  handleLayerKey(escape());
  assert.deepEqual(log, ['c', 'a']);
  popA();
  popA();
  assert.equal(hasOpenLayer(), false);
});

const anchor = { top: 100, bottom: 130, left: 200, right: 240, width: 40, height: 30 };

test('placeTip sits below and centred, flips above, clamps to the viewport and can sit to the right', () => {
  assert.deepEqual(placeTip({ anchor, width: 80, height: 20, vw: 1000, vh: 800 }), { top: 130 + TIP_GAP, left: 180 });
  const low = { top: 780, bottom: 800, left: 200, right: 240, width: 40, height: 20 };
  assert.equal(placeTip({ anchor: low, width: 80, height: 20, vw: 1000, vh: 810 }).top, Math.max(TIP_EDGE, 780 - TIP_GAP - 20));
  const edge = { top: 100, bottom: 120, left: 2, right: 12, width: 10, height: 20 };
  assert.equal(placeTip({ anchor: edge, width: 200, height: 20, vw: 1000, vh: 800 }).left, TIP_EDGE);
  assert.deepEqual(placeTip({ anchor, width: 80, height: 20, side: 'right', vw: 1000, vh: 800 }), { top: 115 - 10, left: 240 + TIP_GAP });
});

test('placeAtCursor sits bottom-right of the pointer and flips near the right and bottom edges', () => {
  assert.deepEqual(placeAtCursor({ x: 100, y: 100, width: 80, height: 20, vw: 1000, vh: 800 }), { top: 100 + TIP_CURSOR_Y, left: 100 + TIP_CURSOR_X });
  assert.equal(placeAtCursor({ x: 950, y: 100, width: 80, height: 20, vw: 1000, vh: 800 }).left, 950 - TIP_FLIP_GAP - 80);
  assert.equal(placeAtCursor({ x: 100, y: 790, width: 80, height: 20, vw: 1000, vh: 800 }).top, 790 - TIP_FLIP_GAP - 20);
});

test('nextFitSize shrinks by the overflow ratio down to the floor, and leaves fitting or unmeasured text alone', () => {
  assert.equal(nextFitSize(20, 200, 120, 12), null);
  assert.equal(nextFitSize(20, 200, 200, 12), null);
  assert.equal(nextFitSize(20, 180, 200, 12), 18);
  assert.equal(nextFitSize(20, 10, 1000, 12), 12);
  assert.equal(nextFitSize(12, 10, 1000, 12), null);
  assert.equal(nextFitSize(20, 50, 200, 0), 5, 'a missing floor is no floor');
  assert.equal(nextFitSize(0, 100, 200, 10), null);
  assert.equal(nextFitSize(20, 0, 200, 10), null);
  assert.equal(nextFitSize(20, 100, NaN, 10), null);
});

test('nextFitSize converges within FIT_PASSES when glyph rounding overshoots', () => {
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

test('the switch knob centres on the pointer, stops at both ends and keeps its raw overshoot', () => {
  const r = { left: 100, width: 36 };
  assert.equal(knobAt(110, r, 2, 16), 0);
  assert.equal(knobAt(0, r, 2, 16), 0);
  assert.equal(knobAt(118, r, 2, 16), 8);
  assert.equal(knobAt(999, r, 2, 16), 16);
  assert.equal(knobAt(50, { left: 0, width: 12 }, 2, 16), 0, 'a switch too narrow for its knob still reports a position');
  assert.equal(clampPx(5, 10, 2), 10);
  const z = { left: 0, width: 36 };
  assert.equal(knobTravel(z, 2, 16), 16);
  assert.equal(knobRaw(60, z, 2, 16), 50);
  assert.equal(knobRaw(-20, z, 2, 16), -30);
  assert.equal(overshoot(8, 0, 16), 0);
  assert.equal(overshoot(-9, 0, 16), -9);
  assert.equal(overshoot(20, 0, 16), 4);
});

test('a segmented control picks the nearest segment and slides for a bounded time', () => {
  const stops = [{ x: 1, w: 60 }, { x: 61, w: 90 }];
  assert.equal(nearestIndex(stops, 31), 0);
  assert.equal(nearestIndex(stops, 106), 1);
  assert.equal(nearestIndex(stops, 999), 1);
  assert.equal(nearestIndex(null, 5), 0);
  assert.equal(slideFor(0), SLIDE_BASE);
  assert.equal(slideFor(-1), SLIDE_BASE + SLIDE_SPAN);
  assert.equal(slideFor(5), SLIDE_BASE + SLIDE_SPAN);
  assert.equal(slideFor(NaN), SLIDE_BASE);
});

test('a stepped thumb lands on every step and never runs backwards or jumps', () => {
  for (const span of [1, 2, 15]) {
    for (let k = 0; k <= span; k++) assert.ok(Math.abs(magnetStep(k / span, span) - k / span) < 1e-9);
  }
  let prev = magnetStep(0, 4);
  for (let i = 1; i <= 4000; i++) {
    const cur = magnetStep(i / 4000, 4);
    assert.ok(cur >= prev - 1e-12, 'monotonic at ' + i);
    assert.ok(cur - prev < 0.01, 'continuous at ' + i);
    prev = cur;
  }
  assert.equal(magnetStep(0.3, 0), 0.3, 'nothing to snap to');
});

const texts = (c) => Object.fromEntries(Object.entries(c).map(([id, v]) => [id, v.text]));

test('carets start at the end of every name and typing appends to all', () => {
  const c = insert(caretsAtEnd({ a: 'Opera', b: 'Aria 3.5' }), ' Pro');
  assert.deepEqual(texts(c), { a: 'Opera Pro', b: 'Aria 3.5 Pro' });
  assert.equal(c.a.focus, 9);
});

test('arrows move every caret, clamp at the edges, and typing lands at each one', () => {
  let c = caretsAtEnd({ a: 'ab', b: 'xyz' });
  c = move(c, 'Home');
  c = insert(c, '[');
  assert.deepEqual(texts(c), { a: '[ab', b: '[xyz' });
  c = move(c, 'ArrowRight');
  c = insert(c, '-');
  assert.deepEqual(texts(c), { a: '[a-b', b: '[x-yz' });
  let short = caretsAtEnd({ a: 'a', b: 'abcd' });
  short = move(move(short, 'ArrowLeft'), 'ArrowLeft');
  assert.equal(short.a.focus, 0);
  assert.equal(short.b.focus, 2);
});

test('backspace and delete remove one character or a whole word', () => {
  let c = caretsAtEnd({ a: 'Model one', b: 'Model two' });
  c = erase(c, -1);
  assert.deepEqual(texts(c), { a: 'Model on', b: 'Model tw' });
  c = erase(c, -1, true);
  assert.deepEqual(texts(c), { a: 'Model ', b: 'Model ' });
  c = erase(move(c, 'Home'), 1, true);
  assert.deepEqual(texts(c), { a: ' ', b: ' ' });
  c = erase(c, -1);
  assert.deepEqual(texts(c), { a: ' ', b: ' ' }, 'nothing before the caret');
});

test('selection: select all replaces, shift extends, a plain arrow collapses', () => {
  assert.deepEqual(texts(insert(selectAll(caretsAtEnd({ a: 'one', b: 'two' })), 'x')), { a: 'x', b: 'x' });
  let c = move(caretsAtEnd({ a: 'hello' }), 'ArrowLeft', { shift: true });
  c = move(c, 'ArrowLeft', { shift: true });
  assert.deepEqual(parts(c.a), { before: 'hel', sel: 'lo', after: '', caretAtStart: true });
  c = move(c, 'ArrowRight');
  assert.equal(c.a.anchor, 5);
  assert.equal(c.a.focus, 5);
  c = move(c, 'ArrowLeft', { word: true });
  assert.equal(c.a.focus, 0);
});

test('placing one caret leaves the others where they are', () => {
  let c = place(caretsAtEnd({ a: 'abc', b: 'xyz' }), 'a', 1);
  c = insert(c, '_');
  assert.deepEqual(texts(c), { a: 'a_bc', b: 'xyz_' });
  assert.equal(place(c, 'missing', 0), c);
  assert.equal(place(c, 'b', 99).b.focus, 4);
});

test('the favicon follows the theme unless an icon was uploaded', () => {
  assert.equal(faviconFor('light', ''), BRAND_FAVICON_LIGHT);
  for (const theme of ['anthropic', 'openai', 'dark', null, undefined]) {
    assert.equal(faviconFor(theme, ''), BRAND_FAVICON_DARK, String(theme));
  }
  assert.equal(faviconFor('light', '/uploads/logo.png'), '/uploads/logo.png');
  assert.equal(faviconFor('anthropic', '/uploads/logo.png'), '/uploads/logo.png');
});

test('a cancelled screen capture is not a failure, and a screenshot name is timestamped', () => {
  for (const name of ['NotAllowedError', 'AbortError', 'NotFoundError']) assert.equal(isCaptureCancel({ name }), true, name);
  for (const name of ['NotReadableError', 'TypeError', 'anything']) assert.equal(isCaptureCancel({ name }), false, name);
  assert.equal(isCaptureCancel(null), false);
  assert.equal(screenshotName(new Date(2026, 8, 22, 9, 5, 3)), 'screenshot-20260922-090503.png');
});

test('undo runs entries newest first, and unkeyed entries stay bounded', () => {
  const log = [];
  const h = createHistory({ limit: 3 });
  h.record({ undo: () => log.push('a') });
  h.record({ undo: () => log.push('b') });
  assert.equal(h.undo(), true);
  assert.equal(h.undo(), true);
  assert.equal(h.undo(), false, 'an empty history does nothing');
  assert.deepEqual(log, ['b', 'a']);
  for (let i = 0; i < 5; i++) h.record({ undo: () => {} });
  assert.equal(h.size, 3);
  h.clear();
  assert.equal(h.size, 0);
});

test('a burst of edits to the same field undoes as one step and redoes to its last value', () => {
  let clock = 0;
  const log = [];
  const h = createHistory({ now: () => clock });
  h.record({ key: 'name', undo: () => log.push('first') });
  clock = 400;
  h.record({ key: 'name', undo: () => log.push('second') });
  clock = 800;
  h.record({ key: 'name', undo: () => log.push('third') });
  assert.equal(h.size, 1);
  clock = 5000;
  h.record({ key: 'name', undo: () => log.push('later') });
  h.record({ key: 'other', undo: () => log.push('other') });
  assert.equal(h.size, 3, 'a pause or another field starts a new step');
  while (h.undo());
  assert.deepEqual(log, ['other', 'later', 'first'], 'the merged step restores the value from before the burst');

  let value = 'a';
  const r = createHistory({ now: () => clock });
  const set = (v) => { const was = value; value = v; r.record({ key: 'f', undo: () => { value = was; }, redo: () => { value = v; } }); };
  set('ab');
  clock += 300;
  set('abc');
  r.undo();
  assert.equal(value, 'a');
  r.redo();
  assert.equal(value, 'abc');
});

test('redo replays undone steps until a new edit or an unredoable undo drops the branch', () => {
  let value = 0;
  const h = createHistory();
  const set = (v) => { const was = value; value = v; h.record({ undo: () => { value = was; }, redo: () => { value = v; } }); };
  set(1);
  set(2);
  h.undo();
  h.undo();
  assert.equal(value, 0);
  assert.equal(h.redo(), true);
  assert.equal(value, 1);
  assert.equal(h.redoSize, 1);
  set(5);
  assert.equal(h.redoSize, 0, 'a new edit drops the redo branch');
  assert.equal(h.redo(), false);
  const g = createHistory();
  g.record({ undo: () => {} });
  g.record({ undo: () => {}, redo: () => {} });
  g.undo();
  assert.equal(g.redoSize, 1);
  g.undo();
  assert.equal(g.redoSize, 0);
});

test('changedKeys and pick describe what an edit touched', () => {
  assert.deepEqual(changedKeys({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }), ['b', 'c']);
  assert.deepEqual(pick({ a: 1 }, ['a', 'b']), { a: 1, b: undefined });
});

test('the undo shortcuts follow the platform modifier', () => {
  const key = (o) => ({ key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
  assert.equal(historyKey(key({ metaKey: true }), true), 'undo');
  assert.equal(historyKey(key({ ctrlKey: true }), true), null);
  assert.equal(historyKey(key({ ctrlKey: true }), false), 'undo');
  assert.equal(historyKey(key({ metaKey: true }), false), null);
  assert.equal(historyKey(key({ metaKey: true, shiftKey: true, key: 'Z' }), true), 'redo');
  assert.equal(historyKey(key({ ctrlKey: true, shiftKey: true, key: 'Z' }), false), 'redo');
  assert.equal(historyKey(key({ ctrlKey: true, key: 'y' }), false), 'redo');
  assert.equal(historyKey(key({ metaKey: true, key: 'y' }), true), null, 'Cmd+Y is not redo on a Mac');
  assert.equal(historyKey(key({ ctrlKey: true, altKey: true }), false), null);
});

test('a progress sweep lights every column it crossed and clamps at both edges', () => {
  const heat = new Float32Array(10);
  stampTrail(heat, 2, 6);
  for (let c = 2; c <= 6; c++) assert.equal(heat[c], 1, 'column ' + c);
  assert.equal(heat[1], 0);
  assert.equal(heat[7], 0);
  const edge = new Float32Array(4);
  stampTrail(edge, -9, 1);
  stampTrail(edge, 2, 99);
  assert.deepEqual([...edge], [1, 1, 1, 1]);
  assert.equal(edge.length, 4);
});