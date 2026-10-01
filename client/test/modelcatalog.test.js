import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flagOn, folderOf, folderPatch, folderNames, layout, displayOrder, planMove, nudge,
  rangeIds, matches, STATUS, shared, variants, applyText, reasons, tabsFor, revertPatch, publishedOrder, norm,
  tabChanges, folderChanged, orderChanged, LEVELS, usesTools
} from '../src/lib/modelcatalog.js';

const inF = (id, name, extra = {}) => ({ id, in_more_models: 1, more_models_label: name, ...extra });
const top = (id, extra = {}) => ({ id, in_more_models: 0, more_models_label: 'More models', ...extra });

test('folder membership needs both the flag and a label', () => {
  assert.equal(folderOf(inF('a', 'Fast')), 'Fast');
  assert.equal(folderOf(top('b')), null);
  assert.equal(folderOf({ id: 'c', in_more_models: 0, more_models_label: 'Fast' }), null);
  assert.equal(folderOf(inF('d', '  ')), null);
  assert.equal(folderOf(undefined), null);
  assert.deepEqual(folderPatch('  Fast '), { in_more_models: 1, more_models_label: 'Fast' });
  assert.deepEqual(folderPatch(''), { in_more_models: 0, more_models_label: 'More models' });
  assert.deepEqual(folderNames([inF('a', 'b'), top('x'), inF('c', 'a'), inF('d', 'b')]), ['a', 'b']);
});

test('inverted flags are on unless explicitly zero', () => {
  assert.equal(flagOn({}, 'sandbox_allowed'), true);
  assert.equal(flagOn({ sandbox_allowed: 0 }, 'sandbox_allowed'), false);
  assert.equal(flagOn({}, 'has_vision'), false);
  assert.equal(flagOn({ has_vision: 1 }, 'has_vision'), true);
});

test('layout draws each folder once, at its first member', () => {
  const rows = [top('a'), inF('b', 'F'), top('c'), inF('d', 'F')];
  const out = layout(rows);
  assert.deepEqual(out.map(e => e.key), ['a', 'f:F', 'c']);
  assert.deepEqual(out[1].models.map(m => m.id), ['b', 'd']);
  assert.deepEqual(displayOrder(rows).map(m => m.id), ['a', 'b', 'd', 'c']);
});

test('planMove places rows and reports only those changing folder', () => {
  const rows = [top('a'), inF('b', 'F'), top('c')];
  const into = planMove(rows, ['c'], { folder: 'F' });
  assert.deepEqual(into.order.map(m => m.id), ['a', 'b', 'c']);
  assert.deepEqual(into.moved, ['c']);
  assert.deepEqual(into.patch, { in_more_models: 1, more_models_label: 'F' });

  const before = planMove(rows, ['c'], { targetId: 'a' });
  assert.deepEqual(before.order.map(m => m.id), ['c', 'a', 'b']);
  assert.deepEqual(before.moved, []);

  const out = planMove(rows, ['b'], { folder: null, targetId: 'c', after: true });
  assert.deepEqual(out.order.map(m => m.id), ['a', 'c', 'b']);
  assert.deepEqual(out.moved, ['b']);
});

test('nudge walks the visible order and adopts the neighbour folder', () => {
  const rows = [top('a'), inF('b', 'F'), inF('c', 'F'), top('d')];
  assert.equal(nudge(rows, 'a', -1), null);
  const down = nudge(rows, 'a', 1);
  assert.deepEqual(down.order.map(m => m.id), ['b', 'a', 'c', 'd']);
  assert.deepEqual(down.moved, ['a']);
  assert.equal(down.patch.more_models_label, 'F');
  const up = nudge(rows, 'd', -1);
  assert.deepEqual(up.order.map(m => m.id), ['a', 'b', 'd', 'c']);
});

test('rangeIds selects inclusively in either direction', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(rangeIds(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeIds(order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(rangeIds(order, 'gone', 'c'), ['c']);
  assert.deepEqual(rangeIds(order, 'a', 'gone'), []);
});

test('matching and status filters', () => {
  const m = { display_name: 'Opera', internal_name: 'qwen-3', description: 'hard tasks', enabled: 1, unavailable: 0 };
  assert.ok(matches(m, 'QWEN'));
  assert.ok(matches(m, 'hard'));
  assert.ok(!matches(m, 'llama'));
  assert.ok(STATUS.listed(m));
  assert.ok(!STATUS.hidden(m));
  assert.ok(STATUS.down({ unavailable: 1 }));
  assert.ok(STATUS.unpublished({ id: 'x' }, new Set(['x'])));
  assert.ok(!STATUS.unpublished({ id: 'x' }, null));
});

test('shared reports a common value or a mix', () => {
  const rows = [{ id: 'a', temperature: 0.7, kwargs: [{ id: 'k' }] }, { id: 'b', temperature: '0.7', kwargs: [{ id: 'k' }] }];
  assert.deepEqual(shared(rows, 'temperature'), { value: 0.7, mixed: false });
  assert.equal(shared(rows, 'kwargs').mixed, false);
  assert.equal(shared([...rows, { id: 'c', temperature: null }], 'temperature').mixed, true);
  assert.deepEqual(shared([{ id: 'a' }, { id: 'b', sandbox_allowed: 1 }], 'sandbox_allowed', { flag: true }), { value: true, mixed: false });
  assert.deepEqual(shared([inF('a', 'F'), inF('b', 'F')], 'folder'), { value: 'F', mixed: false });
  assert.equal(shared([], 'x').mixed, false);
  assert.deepEqual(variants(rows.concat({ id: 'c', temperature: 1 }), 'temperature').map(g => g.map(m => m.id)), [['a', 'b'], ['c']]);
});

test('applyText edits each prompt in place', () => {
  assert.equal(applyText('old', 'replace', 'new'), 'new');
  assert.equal(applyText('body', 'prepend', 'head'), 'head\n\nbody');
  assert.equal(applyText('', 'prepend', 'head'), 'head');
  assert.equal(applyText('body', 'append', 'tail'), 'body\n\ntail');
  assert.equal(applyText('body', 'append', ''), 'body');
  assert.equal(applyText('Acme and Acme', 'swap', 'Initech', 'Acme'), 'Initech and Initech');
  assert.equal(applyText('same', 'swap', 'x', ''), 'same');
});

test('tabs follow what the selection actually uses', () => {
  const plain = { id: 'a', kind: 'model' };
  assert.deepEqual(tabsFor([plain]).shown, ['general', 'prompts', 'tools', 'context', 'sampling', 'appearance']);
  assert.deepEqual(tabsFor([plain]).optional, ['reasoning', 'controls']);
  const thinker = { id: 'b', kwargs: [{ id: 'k', name: 'enable_thinking' }] };
  assert.ok(tabsFor([thinker]).shown.includes('reasoning'));
  assert.ok(tabsFor([thinker]).shown.includes('controls'));
  assert.deepEqual(tabsFor([thinker]).optional, ['reasoning', 'controls'], 'optional tabs are always offered to answering models');
  assert.ok(reasons({ reasoning_collapsible: 0 }));
  assert.ok(!reasons({ kwargs: [{ name: 'top_k' }] }));
  const router = { id: 'r', kind: 'router' };
  assert.deepEqual(tabsFor([router]), { shown: ['general', 'appearance', 'routing'], optional: [] });
});

test('revertPatch restores the published value, folder pair and inverted flags included', () => {
  const live = { id: 'a', in_more_models: 0, more_models_label: 'More models' };
  assert.deepEqual(revertPatch(live, 'folder'), { in_more_models: 0, more_models_label: 'More models' });
  assert.deepEqual(revertPatch(live, 'top_k'), { top_k: null });
  assert.deepEqual(revertPatch({}, 'sandbox_allowed'), { sandbox_allowed: 1 });
  assert.equal(norm({ enabled: true }, 'enabled'), norm({ enabled: 1 }, 'enabled'));
  assert.equal(norm({ temperature: '0.4' }, 'temperature'), norm({ temperature: 0.4 }, 'temperature'));
});

test('publishedOrder restores the live order and keeps new rows last', () => {
  const rows = [{ id: 'n' }, { id: 'b' }, { id: 'a' }];
  assert.deepEqual(publishedOrder(rows, ['a', 'b', 'gone']).map(m => m.id), ['a', 'b', 'n']);
});

test('change counts, folder and order drift are reported against the live copy', () => {
  const live = { a: { id: 'a', system_prompt: 'x', kwargs: [], in_more_models: 0 } };
  const draft = [{ id: 'a', system_prompt: 'y', temperature: 0.2, in_more_models: 1, more_models_label: 'F' }, { id: 'b' }];
  const counts = tabChanges(draft, live);
  assert.equal(counts.prompts, 1);
  assert.equal(counts.sampling, 1);
  assert.equal(counts.controls, 0, 'an emptied list matches a missing one');
  assert.equal(counts.general, 0);
  assert.ok(folderChanged(draft, live));
  assert.ok(!folderChanged([{ id: 'a', in_more_models: 0 }], live));
  assert.ok(folderChanged([{ id: 'a', in_more_models: 0, more_models_label: 'stale' }], live), 'a leftover label still counts');
  assert.ok(orderChanged([{ id: 'b' }, { id: 'a' }], ['a', 'b']));
  assert.ok(!orderChanged([{ id: 'n' }, { id: 'a' }, { id: 'b' }], ['a', 'gone', 'b']));
});

test('levels fold a pair of flags into one choice and back', () => {
  const { sandbox, thoughts } = LEVELS;
  assert.equal(sandbox.read({}), 'on', 'sandbox is allowed by default and not auto');
  assert.equal(sandbox.read({ sandbox_allowed: 0, sandbox_auto: 1 }), 'off', 'a stale auto flag cannot outrank off');
  assert.equal(sandbox.read({ sandbox_auto: 1 }), 'auto');
  for (const [level, patch] of Object.entries(sandbox.patch)) assert.equal(sandbox.read(patch), level);
  assert.equal(thoughts.read({}), 'shown');
  assert.equal(thoughts.read({ reasoning_collapsible: 0 }), 'status');
  assert.equal(thoughts.read({ reasoning_collapsible: 0, hide_thinking: 1 }), 'hidden');
  assert.equal(thoughts.read({ hide_thinking: 1 }), 'shown', 'hiding the status line only applies once the thoughts are hidden');
  for (const [level, patch] of Object.entries(thoughts.patch)) assert.equal(thoughts.read(patch), level);
});

test('usesTools only counts workspace features that are switched on', () => {
  const none = { sandbox_allowed: 0, web_search_allowed: 1, chat_search_allowed: 1 };
  assert.equal(usesTools(none), false);
  assert.equal(usesTools(none, { webSearch: true }), true);
  assert.equal(usesTools(none, { chatSearch: true }), true);
  assert.equal(usesTools({}), true, 'the sandbox is on unless turned off');
  assert.equal(usesTools({ sandbox_allowed: 0, end_chat_allowed: 1 }), true);
});