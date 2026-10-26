import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChanges, valueOf, lineDiff, isMine, othersIn, areaOf } from '../src/lib/changeset.js';
import {
  flagOn, folderOf, folderPatch, folderNames, layout, displayOrder, planMove, nudge,
  rangeIds, matches, STATUS, shared, variants, applyText, reasons, tabsFor, revertPatch, publishedOrder, norm,
  tabChanges, folderChanged, orderChanged, LEVELS, usesTools, isCloudModel, presetApplied, presetPatch, reasoningSummary
} from '../src/lib/modelcatalog.js';
import {
  docsConfig, docsTree, docsSearch, parseDocsPath, docsPath, fmtTokens, fmtPrice, priceRange,
  bulletLines, publicModelId, docsModels, docsModelPatch, docsSize
} from '../src/lib/modeldocs.js';
import {
  MAX_LANES, laneKey, makeLane, addLane, moveSubject, laneRow, kwargDefsOf, usesPromptToken,
  pickedText, historyFor, tally, sseSplit, runStats, fmtDuration, replyStats, settle,
  restoreSession, suiteWins, patchCase, groupModels
} from '../src/lib/playground.js';
import {
  isRange, kwargAccepts, clampToRange, allNumeric, kwargPayload, controlOf, defaultValueOf, resolveKwargValues,
  gateOpen, kwargVisible, gateSourceIds, KWARG_PRESETS, replayWhenOf, replayValuesOf, rangeSteps, nearestStep,
  kwargChip, chipNumber, rangeLabel, kwargValuesArr, stopLabel, budgetMessageOff, BUDGET_MESSAGE_TEXT,
  kwargMode, kwargKind, kwargPath, kindPatch, fixedValuePatch, followPatch, followable, modePatch, pickerChips, replayFieldFor
} from '../src/lib/kwargs.js';
import { parseMcpConfig, joinArgs, nameFrom } from '../src/lib/mcpconfig.js';
import { promptSegments } from '../src/lib/promptview.js';
import { syncModelPrompt } from '../src/lib/promptblocks.js';
import { logoFor, mentions, modelIconFor } from '../src/lib/logos.js';

const c = (o) => ({ authors: [], ...o });

test('changes group by model, theme and settings section, in a fixed area order', () => {
  const list = [
    c({ key: 'setting:disclaimer', scope: 'setting', target: 'disclaimer' }),
    c({ key: 'model:a:temperature', scope: 'model', target: 'a', field: 'temperature', label: 'Alpha' }),
    c({ key: 'setting:voice_mic_enabled', scope: 'setting', target: 'voice_mic_enabled' }),
    c({ key: 'model:a:top_p', scope: 'model', target: 'a', field: 'top_p', label: 'Alpha' }),
    c({ key: 'models:order', scope: 'model', target: null, field: 'order' }),
    c({ key: 'theme:t:doc', scope: 'theme', target: 't', field: 'doc', label: 'Ocean' })
  ];
  const areas = groupChanges(list);
  assert.deepEqual(areas.map(a => a.area), ['models', 'workspace', 'interface']);
  assert.deepEqual(areas[0].groups.map(g => [g.key, g.items.length]), [['model:a', 2], ['models:order', 1]]);
  assert.deepEqual(areas[1].groups.map(g => g.key), ['section:voice']);
  assert.deepEqual(areas[2].groups.map(g => g.key), ['section:interface', 'theme:t']);
  assert.equal(areaOf({ scope: 'setting', target: 'greetings' }), 'interface');
});

test('change values read the way the panel shows them', () => {
  assert.deepEqual(valueOf({ scope: 'setting', target: 'voice_mic_enabled', before: '0', after: '1' }, 'after'), { kind: 'flag', on: true });
  assert.deepEqual(valueOf({ scope: 'model', field: 'sandbox_allowed', before: null, after: 0 }, 'before'), { kind: 'flag', on: true }, 'an inverted flag defaults on');
  assert.deepEqual(valueOf({ scope: 'setting', target: 'greetings', after: '["Hi","Hello"]' }, 'after'), { kind: 'list', items: ['Hi', 'Hello'] });
  assert.deepEqual(valueOf({ scope: 'setting', target: 'quick_prompts', after: '[]' }, 'after'), { kind: 'empty' });
  assert.deepEqual(valueOf({ scope: 'setting', target: 'api_key', secret: true, after: null }, 'after'), { kind: 'hidden' });
  assert.equal(valueOf({ scope: 'model', field: 'system_prompt', after: 'a\nb' }, 'after').kind, 'long');
  assert.deepEqual(valueOf({ scope: 'model', field: 'temperature', before: 0.7 }, 'before'), { kind: 'text', text: '0.7' });
});

test('a change line diff keeps shared lines, and authorship splits mine from everyone else', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nx\nc'), [
    { op: 'same', text: 'a' }, { op: 'del', text: 'b' }, { op: 'add', text: 'x' }, { op: 'same', text: 'c' }
  ]);
  assert.deepEqual(lineDiff('', 'new'), [{ op: 'del', text: '' }, { op: 'add', text: 'new' }]);
  const list = [c({ authors: [{ id: 'me', name: 'Me' }] }), c({ authors: [{ id: 'sam', name: 'Sam' }, { id: 'me', name: 'Me' }] })];
  assert.equal(isMine(list[0], 'me'), true);
  assert.equal(isMine(list[0], 'sam'), false);
  assert.deepEqual(othersIn(list, 'me'), ['Sam']);
});

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
  assert.deepEqual(nudge(rows, 'd', -1).order.map(m => m.id), ['a', 'b', 'd', 'c']);
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
  assert.deepEqual(tabsFor([{ id: 'r', kind: 'router' }]), { shown: ['general', 'appearance', 'routing'], optional: [] });
});

test('a cloud model gets the short editor, and anything already set keeps its tab', () => {
  const providers = [{ id: 'p1', type: 'openai' }, { id: 'p2', type: 'llamacpp' }];
  const types = { openai: { local: false }, llamacpp: { local: true } };
  assert.equal(isCloudModel({ provider_id: 'p1' }, providers, types), true);
  assert.equal(isCloudModel({ provider_id: 'p2' }, providers, types), false);
  assert.equal(isCloudModel({ provider_id: 'gone' }, providers, types), true, 'a missing connection falls back to the first one, as the server does');
  assert.equal(isCloudModel({ kind: 'router' }, providers, types), false);
  const cloud = { id: 'c', kwargs: [{ id: 'effort', name: 'reasoning_effort' }] };
  const simple = tabsFor([cloud], { simple: true });
  assert.deepEqual(simple.shown, ['general', 'prompts', 'tools', 'controls', 'appearance'], 'no think tags, prompt tokens or samplers up front');
  assert.deepEqual(simple.optional, ['reasoning', 'controls', 'context', 'sampling']);
  assert.ok(tabsFor([{ ...cloud, temperature: 0 }], { simple: true }).shown.includes('sampling'), 'a temperature of 0 is a setting');
  assert.ok(tabsFor([{ ...cloud, num_ctx: 64000 }], { simple: true }).shown.includes('context'));
  assert.ok(tabsFor([cloud]).shown.includes('reasoning'), 'local models keep the full editor');
});

test('a recommended setup is recognised once applied, and summarised for the lists', () => {
  const preset = { vision: true, reasoning: false, kwargs: [{ id: 'effort', name: 'reasoning_effort', values: ['low', 'high'] }] };
  const m = { has_vision: 0, kwargs: [] };
  assert.equal(presetApplied(m, preset), false);
  const applied = { ...m, ...presetPatch(preset) };
  assert.deepEqual([applied.has_vision, applied.has_reasoning, applied.effort_enabled], [1, 0, 0]);
  assert.equal(presetApplied(applied, preset), true);
  assert.equal(presetApplied({ ...applied, kwargs: [{ ...preset.kwargs[0], default: 'high', label: 'Mine' }] }, preset), true, 'a changed default or label still counts as the same setup');
  assert.equal(reasoningSummary({ efforts: ['low', 'medium', 'max'] }), 'low → max');
  assert.equal(reasoningSummary({ efforts: [], thinking: true }), 'switch');
  assert.equal(reasoningSummary({ efforts: [], reasoning: true }), 'builtin');
  assert.equal(reasoningSummary({ efforts: [] }), '');
});

test('reverting restores the published value and order, folder pair and inverted flags included', () => {
  const live = { id: 'a', in_more_models: 0, more_models_label: 'More models' };
  assert.deepEqual(revertPatch(live, 'folder'), { in_more_models: 0, more_models_label: 'More models' });
  assert.deepEqual(revertPatch(live, 'top_k'), { top_k: null });
  assert.deepEqual(revertPatch({}, 'sandbox_allowed'), { sandbox_allowed: 1 });
  assert.equal(norm({ enabled: true }, 'enabled'), norm({ enabled: 1 }, 'enabled'));
  assert.equal(norm({ temperature: '0.4' }, 'temperature'), norm({ temperature: 0.4 }, 'temperature'));
  assert.deepEqual(publishedOrder([{ id: 'n' }, { id: 'b' }, { id: 'a' }], ['a', 'b', 'gone']).map(m => m.id), ['a', 'b', 'n']);
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
  const none = { artifacts_allowed: 0, web_search_allowed: 1, chat_search_allowed: 1 };
  assert.equal(usesTools(none), false);
  assert.equal(usesTools(none, { webSearch: true }), true);
  assert.equal(usesTools(none, { chatSearch: true }), true);
  assert.equal(usesTools({}), true, 'artifacts are on unless turned off');
  assert.equal(usesTools({ artifacts_allowed: 0, sandbox_allowed: 1 }), false, 'the sandbox belongs to Code, not to chats');
  assert.equal(usesTools({ artifacts_allowed: 0, end_chat_allowed: 1 }), true);
});

const DOCS_MODELS = [
  { id: 'a', displayName: 'Sonata', description: 'Everyday', docsIds: [{ label: 'Chat', value: 'sonata-1' }] },
  { id: 'b', displayName: 'Aria', description: 'Quick', docsGroup: 'Legacy models', docsIds: [] },
  { id: 'c', displayName: 'Cadence', description: 'Old', docsGroup: 'Legacy models', docsIds: [] },
  { id: 'd', displayName: 'Router', kind: 'router', docsIds: [] },
  { id: 'e', displayName: 'Hidden', docsHidden: true, docsIds: [] }
];

test('the docs tree drops routers and hidden rows, folds groups and hides empty sections', () => {
  assert.deepEqual(docsModels(DOCS_MODELS).map(m => m.id), ['a', 'b', 'c']);
  assert.deepEqual(docsModels(null), []);
  const tree = docsTree(DOCS_MODELS, docsConfig(null));
  assert.deepEqual(tree.models.top.map(m => m.id), ['a']);
  assert.equal(tree.models.groups.length, 1);
  assert.equal(tree.models.groups[0].label, 'Legacy models');
  assert.deepEqual(tree.models.groups[0].models.map(m => m.id), ['b', 'c']);
  const cfg = docsConfig({ sections: [{ id: 'g', label: 'Guides', pages: [] }, { id: 'h', label: 'Help', pages: [{ id: 'p', title: 'P' }] }] });
  assert.deepEqual(docsTree(DOCS_MODELS, cfg).sections.map(s => s.id), ['h']);
  assert.equal(docsSearch(tree, '  '), null);
  const hit = docsSearch(tree, 'legacy');
  assert.deepEqual(hit.models.top, []);
  assert.deepEqual(hit.models.groups[0].models.map(m => m.id), ['b', 'c'], 'a group matches by its own label');
});

test('a docs path round-trips and anything else falls back to the overview', () => {
  for (const target of [{ kind: 'overview', id: null }, { kind: 'model', id: 'a b/c' }, { kind: 'page', id: 'pricing' }]) {
    const parsed = parseDocsPath(docsPath(target));
    assert.equal(parsed.kind, target.kind);
    assert.equal(parsed.id, target.id);
  }
  assert.equal(parseDocsPath('/docs').kind, 'overview');
  assert.equal(parseDocsPath('/chat/x').kind, 'overview');
  assert.equal(parseDocsPath('/docs/m/%E0%A4%A').id, '%E0%A4%A');
});

test('docs numbers, prices and bullet lists format the way the page shows them', () => {
  assert.equal(fmtTokens(1000000), '1M');
  assert.equal(fmtTokens(1500000), '1.5M');
  assert.equal(fmtTokens(128000), '128K');
  assert.equal(fmtTokens(512), '512');
  assert.equal(fmtTokens(0), '');
  assert.equal(fmtTokens(null), '');
  assert.equal(fmtPrice(2), '$2');
  assert.equal(fmtPrice(0.2), '$0.2');
  assert.equal(fmtPrice(2.5), '$2.5');
  assert.equal(fmtPrice(null), '');
  assert.equal(fmtPrice(''), '');
  assert.equal(priceRange({ priceIn: 2, priceOut: 10 }), '$2 / $10');
  assert.equal(priceRange({ priceIn: 2, priceOut: null }), '$2');
  assert.equal(priceRange({ priceIn: null, priceOut: null }), '');
  assert.deepEqual(bulletLines('- one\n\n* two\n  three  '), ['one', 'two', 'three']);
  assert.deepEqual(bulletLines(''), []);
});

test('a docs model shows its first admin identifier, and reads and saves its size in billions', () => {
  assert.equal(publicModelId(DOCS_MODELS[0]), 'sonata-1');
  assert.equal(publicModelId(DOCS_MODELS[1]), '');
  assert.deepEqual(docsSize({ docsTotalParams: '175', docsMoe: true, docsActiveParams: '35' }), { total: 175, moe: true, active: 35 });
  assert.deepEqual(docsSize({ docsTotalParams: 175, docsMoe: false, docsActiveParams: 35 }), { total: 175, moe: false, active: null });
  assert.deepEqual(docsSize({}), { total: null, moe: false, active: null });
  const p = docsModelPatch({ docsTotalParams: '2.4T', docsActiveParams: 'nope', docsMoe: true });
  assert.equal(p.docs_total_params, 2400);
  assert.equal(p.docs_active_params, null);
  assert.equal(p.docs_moe, 1);
});

test('playground throughput is measured over generation, and a run with no tokens reports no rate', () => {
  const s = runStats({ startedAt: 0, firstAt: 20000, endedAt: 22000, usage: { completion: 80, prompt: 300 } });
  assert.equal(s.ttft, 20000);
  assert.equal(s.total, 22000);
  assert.equal(Math.round(s.tps), 40);
  assert.equal(s.out, 80);
  assert.equal(s.prompt, 300);
  const empty = runStats({ startedAt: 0, endedAt: 5000 });
  assert.equal(empty.ttft, null);
  assert.equal(empty.tps, null);
  assert.equal(empty.total, 5000);
  assert.equal(replyStats({}), null, 'a reply that never started has no numbers');
  assert.equal(fmtDuration(374), '374ms');
  assert.equal(fmtDuration(1240), '1.24s');
  assert.equal(fmtDuration(64000), '1m 04s');
  assert.equal(fmtDuration(NaN), '–');
});

test('a playground column is a model and a version, never added twice, and follows the subject', () => {
  let lanes = [makeLane('a')];
  lanes = addLane(lanes, 'a', 'live');
  assert.deepEqual(lanes.map(laneKey), ['a:draft', 'a:live']);
  assert.equal(addLane(lanes, 'a', 'live'), lanes);
  lanes = addLane(lanes, 'b', 'draft');
  assert.equal(lanes.length, MAX_LANES);
  assert.equal(addLane(lanes, 'c', 'draft'), lanes, 'the column limit holds');
  const next = moveSubject(lanes, 'a', 'c');
  assert.deepEqual(next.map(laneKey), ['c:draft', 'c:live', 'b:draft']);
  assert.equal(next[0].id, lanes[0].id, 'the first column keeps its identity');
  assert.deepEqual(moveSubject(lanes, 'a', 'b').map(laneKey), ['b:draft', 'b:live'], 'a duplicate after the move is dropped');
});

test('a live column reads the released row, a draft column the edited one', () => {
  const models = [{ id: 'a', temperature: 0.2 }];
  const live = { a: { id: 'a', temperature: 0.7 } };
  assert.equal(laneRow(makeLane('a'), models, live).temperature, 0.2);
  assert.equal(laneRow(makeLane('a', 'live'), models, live).temperature, 0.7);
  assert.equal(laneRow(makeLane('x', 'live'), models, live), null);
});

test('run options come from the model kwargs, or the legacy effort setting', () => {
  const legacy = (m) => ({ id: 'effort', values: m.effort_levels });
  assert.deepEqual(kwargDefsOf({ kwargs: [{ id: 'k' }] }, legacy), [{ id: 'k' }]);
  assert.deepEqual(kwargDefsOf({ effort_enabled: 1, effort_levels: ['low', 'high'] }, legacy), [{ id: 'effort', values: ['low', 'high'] }]);
  assert.deepEqual(kwargDefsOf({}, legacy), []);
  assert.equal(usesPromptToken({ has_reasoning: 1, reasoning_token: '/think' }), true);
  assert.equal(usesPromptToken({ has_reasoning: 1, effort_enabled: 1, reasoning_token: '/think' }), false, 'effort replaces the prompt token');
});

test('the conversation continues from the preferred reply, and only an explicit preference wins', () => {
  const turn = { role: 'assistant', pick: 1, replies: [{ content: 'a', key: 'm:draft' }, { content: 'b', key: 'm:live' }] };
  assert.equal(pickedText(turn), 'b');
  assert.equal(pickedText({ role: 'assistant', pick: 9, replies: [{ content: 'a' }] }), 'a');
  assert.deepEqual(historyFor([{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }, turn, { role: 'user', content: ' ' }]),
    [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'b' }]);
  const replies = [{ key: 'a:draft' }, { key: 'a:live' }];
  assert.deepEqual(tally([
    { role: 'assistant', pick: 0, chosen: false, replies },
    { role: 'assistant', pick: 1, chosen: true, replies },
    { role: 'assistant', pick: 0, chosen: true, replies: [{ key: 'a:draft' }] }
  ]), { 'a:live': 1 });
  assert.deepEqual(suiteWins({ c1: { pick: 'a:live' }, c2: { pick: '' }, c3: { pick: 'gone:draft' } }, [makeLane('a'), makeLane('a', 'live')]),
    { 'a:draft': 0, 'a:live': 1 });
});

test('a stream chunk split mid-line keeps the tail for the next read', () => {
  const { events, rest } = sseSplit('data: {"type":"content","text":"Hi"}\n\ndata: {"type":"con');
  assert.deepEqual(events, [{ type: 'content', text: 'Hi' }]);
  assert.equal(rest, 'data: {"type":"con');
  assert.deepEqual(sseSplit(rest + 'tent","text":"!"}\n').events, [{ type: 'content', text: '!' }]);
  assert.deepEqual(sseSplit('data: not json\n').events, []);
});

test('a playground reload never leaves a reply spinning', () => {
  assert.equal(settle({ status: 'run', startedAt: 5, firstAt: 9 }).status, 'stopped');
  assert.equal(settle({ status: 'queue', startedAt: 5 }).endedAt, 5);
  const done = { status: 'done' };
  assert.equal(settle(done), done);
  const s = restoreSession({
    subjectId: 'gone',
    lanes: [{ modelId: 'a', source: 'live' }, { modelId: 'gone' }],
    thread: [{ role: 'assistant', replies: [{ status: 'run' }] }, { role: 'tool', content: 'x' }],
    results: { s1: { c1: { pick: 'a:live', cells: { 'a:live': { status: 'queue' } } } } },
    mode: 'suite'
  }, ['a']);
  assert.equal(s.subjectId, '');
  assert.deepEqual(s.lanes.map(laneKey), ['a:live']);
  assert.equal(s.thread.length, 1);
  assert.equal(s.thread[0].replies[0].status, 'stopped');
  assert.equal(s.results.s1.c1.cells['a:live'].status, 'stopped');
  assert.equal(s.mode, 'suite');
  assert.equal(s.panel, true);
});

test('editing one playground test leaves the others alone, and the picker groups by folder', () => {
  const suites = [{ id: 's', cases: [{ id: '1', prompt: 'a' }, { id: '2', prompt: 'b' }] }];
  const next = patchCase(suites, 's', '2', { prompt: 'c' });
  assert.deepEqual(next[0].cases.map(x => x.prompt), ['a', 'c']);
  assert.equal(next[0].cases[0], suites[0].cases[0]);
  const groups = groupModels([{ id: 'a', f: 'X' }, { id: 'b' }, { id: 'c', f: 'X' }], (m) => m.f || '');
  assert.deepEqual(groups.map(g => g.label), ['X', '']);
  assert.deepEqual(groups[0].items.map(m => m.id), ['a', 'c']);
});

test('a kwarg range is detected the same way on the client, and a range control wins', () => {
  assert.equal(isRange({ min: 0, max: 4096 }), true);
  for (const bad of [{ min: 5, max: 5 }, { min: 10, max: 2 }, { min: 0 }, { max: 10 }, {}, { min: '', max: '' }, { min: 'a', max: 'b' }]) {
    assert.equal(isRange(bad), false, JSON.stringify(bad));
  }
  assert.equal(isRange({ min: '0', max: '100' }), true, 'the editor holds these as strings while being typed');
  assert.equal(controlOf({ min: 0, max: 100, control: 'select' }), 'range');
  assert.equal(controlOf({ values: ['false', 'true'] }), 'toggle');
  assert.equal(controlOf({ values: ['a', 'b', 'c'] }), 'slider');
  assert.equal(allNumeric(['0', '512', '2048']), true);
  assert.equal(allNumeric(['low', 'high']), false);
  assert.equal(allNumeric(['1', 'high']), false);
  assert.equal(allNumeric([]), false);
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
  assert.equal(defaultValueOf({ min: 10, max: 20, step: 1, default: '' }), '10');
  assert.equal(defaultValueOf({ min: 10, max: 20, step: 1, default: '999' }), '20');
  const defs = [{ id: 'b', name: 'reasoning_budget', target: 'extra_body', type: 'number', min: 0, max: 2048, step: 256 }];
  const out = kwargPayload(defs, resolveKwargValues(defs, { b: '600' }, false));
  assert.equal(out.extra_body.reasoning_budget, 512);
  assert.equal(typeof out.extra_body.reasoning_budget, 'number');
});

const gated = (send) => [
  { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
  { id: 'budget', name: 'thinking_budget_tokens', target: 'body', type: 'number',
    min: 1024, max: 8192, step: 1024, default: '1024', sendWhenHidden: send, showIf: { id: 'think', value: 'true' } }
];

test('a gated kwarg hides its control but keeps its value, and sendWhenHidden decides if it is sent', () => {
  const defs = gated(true);
  const off = resolveKwargValues(defs, {}, false);
  assert.equal(gateOpen(defs, off, defs[1]), false);
  assert.equal(kwargVisible(defs, off, defs[1]), false);
  assert.equal(off.budget, '1024');
  assert.equal(kwargPayload(defs, off).thinking_budget_tokens, 1024);
  const on = resolveKwargValues(defs, { think: 'true', budget: '4096' }, false);
  assert.equal(kwargVisible(defs, on, defs[1]), true);
  assert.equal(kwargPayload(defs, on).thinking_budget_tokens, 4096);
  const dropped = gated(false);
  assert.equal('thinking_budget_tokens' in kwargPayload(dropped, resolveKwargValues(dropped, {}, false)), false);
});

test('the kwarg behind an open gate takes over the trigger chip, unless an admin hid it', () => {
  const defs = [
    { id: 'think', name: 'enable_thinking', chip: 'Extended', values: ['false', 'true'], default: 'false' },
    { id: 'effort', name: 'reasoning_effort', values: ['low', 'medium', 'xhigh'], default: 'low', showIf: { id: 'think', value: 'true' } }
  ];
  assert.equal(gateSourceIds(defs, resolveKwargValues(defs, {}, false)).has('think'), false);
  const on = resolveKwargValues(defs, { think: 'true' }, false);
  assert.equal(gateSourceIds(defs, on).has('think'), true);
  assert.equal(gateSourceIds(defs, on).has('effort'), false);
  const hidden = [defs[0], { ...defs[1], visible: false }];
  assert.equal(gateSourceIds(hidden, resolveKwargValues(hidden, { think: 'true' }, false)).has('think'), false);
  const single = [{ id: 'a', name: 'a', values: ['1', '2'] }];
  assert.equal(gateOpen(single, {}, single[0]), true);
  assert.equal(gateOpen(single, {}, { id: 'b', showIf: { id: 'ghost', value: '1' } }), true, 'an unresolvable gate leaves the kwarg visible');
});

test('the thinking budget preset matches the shape llama.cpp expects', () => {
  assert.equal(KWARG_PRESETS.some(x => x.key === 'thinking_budget_tokens'), false);
  const p = KWARG_PRESETS.find(x => x.key === 'reasoning_budget_tokens').make();
  assert.equal(p.name, 'reasoning_budget_tokens');
  assert.equal(p.target, 'body', 'top level, not nested under extra_body');
  assert.equal(p.type, 'number');
  assert.deepEqual([p.min, p.max, p.step, p.default], [1024, 16384, 1024, '4096']);
  assert.equal(defaultValueOf(p), '4096');
  assert.equal(controlOf(p), 'range');
  const out = kwargPayload([p], resolveKwargValues([p], { [p.id]: '5000' }, false));
  assert.equal(out.reasoning_budget_tokens, 5120, 'snapped to the 1024 grid');
  assert.equal('extra_body' in out, false);
});

test('the budget message is sent beside the budget only while enabled and the budget is above 0', () => {
  const budget = KWARG_PRESETS.find(x => x.key === 'reasoning_budget_tokens').make();
  assert.deepEqual(kwargPayload([budget], resolveKwargValues([budget], { [budget.id]: '4096' }, false)), { reasoning_budget_tokens: 4096 });
  const on = { ...budget, budgetMessage: { ...budgetMessageOff(), enabled: true, text: BUDGET_MESSAGE_TEXT } };
  const sent = kwargPayload([on], resolveKwargValues([on], { [on.id]: '4096' }, false));
  assert.equal(sent.reasoning_budget_message, BUDGET_MESSAGE_TEXT);
  assert.equal(sent.reasoning_budget_tokens, 4096);
  const levels = KWARG_PRESETS.find(x => x.key === 'reasoning_levels').make();
  const levelsOn = { ...levels, budgetMessage: { ...budgetMessageOff(), enabled: true, text: BUDGET_MESSAGE_TEXT } };
  assert.equal('reasoning_budget_message' in kwargPayload([levelsOn], resolveKwargValues([levelsOn], { [levels.id]: '0' }, false)), false, 'Off sends no message');
  const renamed = { ...on, budgetMessage: { ...on.budgetMessage, name: 'stop_note', target: 'chat_template_kwargs' } };
  assert.equal(kwargPayload([renamed], resolveKwargValues([renamed], { [renamed.id]: '4096' }, false)).chat_template_kwargs.stop_note, BUDGET_MESSAGE_TEXT);
  const blank = { ...on, budgetMessage: { ...on.budgetMessage, name: '' } };
  assert.equal('reasoning_budget_message' in kwargPayload([blank], resolveKwargValues([blank], { [blank.id]: '4096' }, false)), false, 'a blank key sends nothing');
});

test('replay defaults match the server and an explicit blank opts out', () => {
  assert.equal(replayWhenOf({ name: 'preserve_thinking' }), 'true');
  assert.equal(replayWhenOf({ name: 'clear_thinking' }), 'false');
  assert.equal(replayWhenOf({ name: 'enable_thinking' }), '');
  assert.equal(replayWhenOf({ name: 'preserve_thinking', replayWhen: '' }), '');
  assert.equal(replayWhenOf({ name: 'keep', replayWhen: 'on' }), 'on');
  assert.deepEqual(replayValuesOf({ values: ['off', 'on'] }), ['off', 'on']);
  assert.deepEqual(replayValuesOf({ parentId: 'p', rules: [{ when: 'true', value: 'true' }, { when: 'false', value: 'x', send: false }] }), ['true']);
  assert.deepEqual(replayValuesOf({ min: 0, max: 10 }), []);
  assert.equal(KWARG_PRESETS.find(p => p.key === 'preserve_thinking').make().replayWhen, 'true');
  assert.equal(KWARG_PRESETS.find(p => p.key === 'clear_thinking').make().replayWhen, 'false');
});

test('a range becomes the step list the effort slider walks', () => {
  const steps = rangeSteps({ min: 512, max: 16384, step: 512 });
  assert.equal(steps.length, 32);
  assert.deepEqual([steps[0], steps[1], steps[steps.length - 1]], ['512', '1024', '16384']);
  assert.deepEqual(rangeSteps({ min: 0, max: 10, step: 3 }), ['0', '3', '6', '9', '10'], 'the max stays reachable off the grid');
  assert.deepEqual(rangeSteps({ min: 0, max: 1, step: 0.25 }), ['0', '0.25', '0.5', '0.75', '1']);
  assert.ok(rangeSteps({ min: 0, max: 100000, step: 1 }).length <= 402, 'a fine range is thinned so the slider stays usable');
  assert.equal(nearestStep(steps, '4096'), 7);
  assert.equal(nearestStep(steps, 5000), 9);
  assert.equal(nearestStep(steps, 99999), 31);
});

test('a number slider chip and header follow the admin template, unit and 0 means off', () => {
  const budget = KWARG_PRESETS.find(x => x.key === 'reasoning_budget_tokens').make();
  assert.equal(kwargChip(budget, '0'), '', '0 means off leaves just the model name');
  assert.equal(kwargChip(budget, '4096'), 'Thinking · 4K tokens');
  assert.equal(kwargChip({ ...budget, chip: 'Thinking' }, '4096'), 'Thinking', 'no {value} means the word alone');
  assert.equal(kwargChip({ ...budget, chip: '' }, '16384'), '16K tokens', 'no chip falls back to the number and unit');
  assert.equal(kwargChip({ min: 0, max: 2, step: 0.1, chip: 'Temp {value}' }, '0'), 'Temp 0', 'without 0 means off, 0 is a value');
  assert.equal(chipNumber('1536'), '1.5K');
  assert.equal(chipNumber('512'), '512');
  assert.equal(kwargChip({ values: ['low', 'medium', 'high'] }, 'medium'), 'Medium', 'step sliders are unchanged');
  assert.equal(kwargChip({ values: ['low', 'high'], chip: 'Level {value}' }, 'high'), 'Level High');
  assert.equal(kwargChip({ values: ['low', 'high'], chip: 'Level' }, 'high'), 'Level');
  const header = { min: 0, max: 16384, step: 1024, unit: 'tokens', zeroOff: true };
  assert.equal(rangeLabel(header, '0', 'Off'), 'Off');
  assert.equal(rangeLabel(header, '4096', 'Off'), (4096).toLocaleString() + ' tokens');
  assert.equal(rangeLabel({ min: 0, max: 2, step: 0.1 }, '0', 'Off'), '0');
  assert.equal(rangeLabel({ min: 0, max: 2, step: 0.1 }, '0.7', 'Off'), (0.7).toLocaleString());
});

test('a stored value is kept only when the model still accepts it, for sliders and lists alike', () => {
  const budget = { min: 1024, max: 16384, step: 1024, values: [] };
  assert.equal(kwargAccepts(budget, '8192'), true);
  assert.equal(kwargAccepts(budget, '16384'), true);
  assert.equal(kwargAccepts(budget, '20000'), false, 'above the admin maximum of another model');
  assert.equal(kwargAccepts(budget, '1500'), false, 'off the step grid is reseeded to the default');
  assert.equal(kwargAccepts(budget, null), false);
  assert.equal(kwargAccepts({ values: ['low', 'high'] }, 'high'), true);
  assert.equal(kwargAccepts({ values: ['low', 'high'] }, 'medium'), false);
});

test('labelled steps show their words in the picker and send their numbers', () => {
  const levels = KWARG_PRESETS.find(x => x.key === 'reasoning_levels').make();
  assert.equal(controlOf(levels), 'slider');
  assert.deepEqual(kwargValuesArr(levels), ['0', '1024', '2048', '4096']);
  assert.equal(stopLabel(levels, '2048'), 'Medium');
  assert.equal(stopLabel(levels, '3000'), '3000', 'a number that is not a step keeps its digits');
  assert.equal(defaultValueOf(levels), '2048');
  assert.equal(kwargChip(levels, '0'), '', 'the step marked Off adds no chip');
  assert.equal(kwargChip(levels, '1024'), 'Low', 'the preset chip is just the word');
  const unmarked = { ...levels, stops: levels.stops.map(s => ({ ...s, off: false })) };
  assert.equal(kwargChip(unmarked, '0'), 'Off', 'a step at 0 keeps its chip unless it is marked Off');
  const out = kwargPayload([levels], resolveKwargValues([levels], { [levels.id]: '4096' }, false));
  assert.equal(out.reasoning_budget_tokens, 4096);
  assert.equal(typeof out.reasoning_budget_tokens, 'number');
});

test('the editor reads a kwarg as a mode and a kind, and a half-typed range stays a range', () => {
  assert.equal(kwargMode({ visible: true }), 'choose');
  assert.equal(kwargMode({ visible: false }), 'fixed');
  assert.equal(kwargMode({ visible: false, parentId: 'p' }), 'follow');
  assert.equal(kwargKind({ values: ['false', 'true'] }), 'toggle');
  assert.equal(kwargKind({ values: ['low', 'high'] }), 'list');
  assert.equal(kwargKind(KWARG_PRESETS.find(p => p.key === 'reasoning_levels').make()), 'steps');
  assert.equal(kwargKind({ min: 0, max: 100 }), 'range');
  assert.equal(kwargKind({ min: '', max: '' }), 'range', 'clearing a bound mid-edit keeps the range editor');
  assert.equal(kwargPath({ name: 'enable_thinking' }), 'chat_template_kwargs.enable_thinking');
  assert.equal(kwargPath({ name: 'reasoning_budget_tokens', target: 'body' }), 'reasoning_budget_tokens');
});

test('switching kind gives a working starting point and carries numbers across', () => {
  const steps = KWARG_PRESETS.find(p => p.key === 'reasoning_levels').make();
  const range = kindPatch(steps, 'range');
  assert.deepEqual([range.min, range.max, range.step], [0, 4096, 1024]);
  assert.deepEqual(range.stops, []);
  const list = kindPatch(steps, 'list');
  assert.deepEqual(list.values, ['0', '1024', '2048', '4096']);
  assert.equal(list.default, '2048');
  assert.deepEqual(kindPatch({ values: ['false', 'true'] }, 'list').values, ['low', 'medium', 'high']);
  const toggle = kindPatch(range, 'toggle');
  assert.deepEqual([toggle.min, toggle.max, toggle.values], [null, null, ['false', 'true']]);
  assert.deepEqual(fixedValuePatch('true'), { min: null, max: null, step: null, stops: [], values: ['true'], default: 'true' });
  assert.deepEqual(fixedValuePatch('  ').values, []);
});

test('following seeds true and false from the parent, and never offers a cycle', () => {
  const levels = { ...KWARG_PRESETS.find(p => p.key === 'reasoning_levels').make(), id: 'lv' };
  const keep = { id: 'keep', values: ['false', 'true'], rules: [] };
  const seeded = followPatch(keep, levels).rules;
  assert.deepEqual(seeded.map(r => [r.when, r.value]), [['0', 'false'], ['1024', 'true'], ['2048', 'true'], ['4096', 'true']]);
  const named = followPatch({ id: 'n', values: ['a', 'b'], rules: [] }, { id: 'p', values: ['low', 'high'] }).rules;
  assert.deepEqual(named.map(r => r.value), ['low', 'high'], 'a non-boolean follower mirrors the parent');
  const kept = [{ when: '1024', value: 'x', send: true }];
  assert.equal(followPatch({ ...keep, rules: kept }, levels).rules, kept, 'existing rules that fit are left alone');
  const defs = [levels, { ...keep, parentId: 'lv' }, { id: 'deep', parentId: 'keep' }];
  assert.deepEqual(followable(defs, levels).map(d => d.id), [], 'a parent cannot follow its own descendants');
  assert.deepEqual(modePatch(defs, defs[2], 'fixed'), { visible: false, parentId: '', sendWhenHidden: true });
  const think = { id: 'think', values: ['false', 'true'] };
  const preserve = KWARG_PRESETS.find(p => p.key === 'preserve_thinking');
  assert.equal(preserve.make([think]).parentId, 'think', 'the preset pairs itself with a thinking switch');
  assert.equal(preserve.make().parentId, '', 'alone it is a fixed true');
  assert.equal(preserve.make().default, 'true');
});

test('the admin preview chips and replay field match what the picker and server do', () => {
  const think = { id: 'think', name: 'enable_thinking', chip: 'Thinking', values: ['false', 'true'], default: 'false' };
  const keep = { id: 'keep', name: 'preserve_thinking', parentId: 'think', rules: [{ when: 'true', value: 'true', send: true }] };
  const off = resolveKwargValues([think, keep], {}, false);
  assert.deepEqual(pickerChips([think, keep], off), []);
  assert.equal(replayFieldFor([think, keep], off), '');
  const on = resolveKwargValues([think, keep], { think: 'true' }, false);
  assert.deepEqual(pickerChips([think, keep], on), ['Thinking']);
  assert.equal(replayFieldFor([think, keep], on), 'reasoning_content');
  assert.equal(replayFieldFor([think, { ...keep, replayAs: 'reasoning' }], on), 'reasoning');
});

test('a Claude Desktop style block becomes one server per entry', () => {
  const { servers, error } = parseMcpConfig(JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\My Docs'] },
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' } },
      remote: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } },
      off: { command: 'uvx', args: ['mcp-server-fetch'], disabled: true }
    }
  }));
  assert.equal(error, '');
  assert.deepEqual(servers.map(s => [s.name, s.transport]), [['filesystem', 'stdio'], ['github', 'stdio'], ['remote', 'http'], ['off', 'stdio']]);
  assert.equal(servers[0].args, '-y @modelcontextprotocol/server-filesystem "C:\\My Docs"', 'an argument with a space stays one argument');
  assert.equal(servers[1].env, 'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x');
  assert.equal(servers[2].headers, 'Authorization: Bearer t');
  assert.equal(servers[3].enabled, false);
});

test('other MCP client formats and bare entries are understood too', () => {
  assert.equal(parseMcpConfig('{"servers":{"docs":{"type":"sse","url":"http://h/sse"}}}').servers[0].url, 'http://h/sse', 'VS Code');
  assert.equal(parseMcpConfig('{"docs":{"serverUrl":"https://h/mcp"}}').servers[0].url, 'https://h/mcp', 'Windsurf');
  assert.equal(parseMcpConfig('"fetch": {"command": "uvx", "args": ["mcp-server-fetch"]}').servers[0].name, 'fetch', 'a pasted entry without braces');
  assert.equal(parseMcpConfig('{"command":"npx","args":["-y","@acme/server-weather"]}').servers[0].name, 'weather', 'a nameless entry is named after its package');
  const win = parseMcpConfig('{"mcpServers":{"x":{"command":"cmd","args":["/c","npx","-y","pkg"]}}}').servers[0];
  assert.deepEqual([win.command, win.args], ['npx', '-y pkg'], 'the Windows cmd /c wrapper is unwrapped');
});

test('an MCP paste that is not a config says why, and arguments join the way the server splits them', () => {
  assert.equal(parseMcpConfig('').error, '');
  assert.equal(parseMcpConfig('{ "mcpServers": ').error, 'not-json');
  assert.equal(parseMcpConfig('{"hello":"world"}').error, 'no-servers');
  assert.equal(parseMcpConfig('[1,2]').error, 'no-servers');
  assert.equal(joinArgs(['a', 'b c', '']), 'a "b c" ""');
  assert.equal(joinArgs(['say "hi"']), '["say \\"hi\\""]', 'a quote inside an argument falls back to a JSON list');
  assert.equal(nameFrom('', { url: 'https://tools.example.com/mcp' }), 'tools');
  assert.equal(nameFrom('', { args: ['mcp-server-fetch'] }), 'fetch');
});

const prompt = syncModelPrompt({ kind: 'router' }, { system_prompt: 'You are helpful.', sandbox_allowed: 0, calculator_allowed: 1 }, {});
const joined = (segs) => segs.map(s => s.text).join('');
const toned = (segs, tone) => segs.filter(s => s.tone === tone).map(s => s.text).join('');

test('prompt segments cover the whole prompt and dim only the managed blocks', () => {
  assert.equal(joined(promptSegments(prompt)), prompt);
  assert.equal(joined(promptSegments('')), '');
  assert.deepEqual(promptSegments('Just my own words.'), [{ text: 'Just my own words.', tone: '' }]);
  const segs = promptSegments(prompt);
  assert.deepEqual(segs[0], { text: 'You are helpful.\n\n', tone: '' });
  const dimmed = toned(segs, 'dim');
  assert.ok(dimmed.includes('<tool name="calculator">') && dimmed.includes('<context>') && dimmed.includes('</tools>'));
});

test('the block being edited is shown at full strength', () => {
  const plain = toned(promptSegments(prompt, { caret: prompt.indexOf('Use the `calculator`') + 5 }), '');
  assert.ok(plain.includes('<tool name="calculator">'), 'the block under the caret is not dimmed');
  assert.ok(!plain.includes('<section name="user_instructions">'));
});

test('a block for a tool that is off is marked stale, and custom blocks are left alone', () => {
  const text = prompt.replace('</tools>', '<tool name="house_rules">\nBe kind.\n</tool>\n</tools>');
  const segs = promptSegments(text, { eligible: new Set(['section:user_instructions']) });
  const stale = toned(segs, 'stale');
  assert.ok(stale.includes('<tool name="calculator">'));
  assert.ok(!stale.includes('user_instructions'));
  assert.ok(toned(segs, '').includes('<tool name="house_rules">\nBe kind.\n</tool>'), 'an admin-written block keeps full strength');
});

const LOGOS = ['alibabacloud-color.svg', 'anthropic.svg', 'cohere-color.svg', 'deepseek-color.svg',
  'gemini-color.svg', 'gemma-color.svg', 'google-color.svg', 'grok.svg', 'liquid.svg', 'lmstudio.svg',
  'meta-color.svg', 'microsoft-color.svg', 'mistral-color.svg', 'moonshot.svg', 'ollama.svg',
  'openai.svg', 'qwen-color.svg', 'upstage-color.svg', 'vllm-color.svg', 'xai.svg', 'zai.svg'];

const logoName = (text) => { const hit = logoFor(text, LOGOS); return hit && hit.src.replace('/assets/', ''); };

test('a logo keyword only counts where it stands as its own word', () => {
  assert.equal(mentions('qwen3-next-80b', 'qwen'), true, 'a digit ends the word');
  assert.equal(mentions('gpt-4o', 'gpt'), true);
  assert.equal(mentions('metallama-7b', 'meta'), false, 'a letter after it makes it another word');
  assert.equal(mentions('ollama', 'llama'), false, 'a letter before it does too');
  assert.equal(mentions('llama', 'llama'), true);
});

test('a model name finds its mark through the alias table or its own file name', () => {
  const cases = [
    ['claude-opus-5', 'anthropic.svg'], ['gpt-4o-mini', 'openai.svg'], ['codellama-13b', 'meta-color.svg'],
    ['mixtral-8x7b', 'mistral-color.svg'], ['glm-4.6', 'zai.svg'], ['kimi-k2', 'moonshot.svg'],
    ['phi-4-reasoning', 'microsoft-color.svg'], ['command-r-plus', 'cohere-color.svg'], ['lfm2-1.2b', 'liquid.svg'],
    ['lfm-7b', 'liquid.svg'], ['solar-pro-2', 'upstage-color.svg'], ['qwen3-next-80b-a3b', 'qwen-color.svg'],
    ['gemma-3-27b-it', 'gemma-color.svg'], ['deepseek-r1-distill', 'deepseek-color.svg'], ['llama-3.1-70b', 'meta-color.svg']
  ];
  for (const [name, file] of cases) assert.equal(logoName(name), file, name);
  for (const name of ['granite-3.3-8b', 'some-local-finetune', '', null, 'llama.cpp', 'llamacpp', 'llama-cpp', 'my llama cpp box']) {
    assert.equal(logoName(name), null, String(name));
  }
  assert.equal(logoFor('granite-3.3-8b', [...LOGOS, 'granite.svg']).src, '/assets/granite.svg', 'a new mark needs no code');
  assert.equal(logoFor('qwen3', []), null, 'no manifest yet, no mark');
});

test('one mark answers to every spelling of a separator', () => {
  for (const file of ['llamacpp.svg', 'llama-cpp.svg', 'llama_cpp.svg', 'llama-cpp-color.svg']) {
    for (const name of ['llama.cpp', 'llamacpp', 'llama-cpp', 'LLAMA CPP']) {
      assert.equal(logoFor(name, [...LOGOS, file]).src, '/assets/' + file, file + ' vs ' + name);
    }
  }
  assert.equal(logoFor('LM-Studio', LOGOS).src, '/assets/lmstudio.svg');
  assert.equal(logoFor('lm studio', LOGOS).src, '/assets/lmstudio.svg');
});

test('a provider falls back from the name an admin typed to the connection type', () => {
  assert.equal(logoFor(['Local box', 'ollama'], LOGOS).src, '/assets/ollama.svg');
  assert.equal(logoFor(['My OpenAI key', 'openai'], LOGOS).src, '/assets/openai.svg');
  assert.equal(logoFor(['', 'vllm'], LOGOS).src, '/assets/vllm-color.svg');
  assert.equal(logoFor(['Anthropic', 'openai'], LOGOS).src, '/assets/anthropic.svg');
  assert.equal(logoFor(['llama.cpp', 'llamacpp'], LOGOS), null);
  assert.equal(logoFor(['llama.cpp', 'llamacpp'], [...LOGOS, 'llamacpp.svg']).src, '/assets/llamacpp.svg');
});

test('the longest keyword wins, a colour file beats a plain one, and discovered models are stamped', () => {
  assert.equal(logoFor('LM Studio', LOGOS).src, '/assets/lmstudio.svg');
  assert.equal(logoFor('LM Studio', LOGOS).color, false, 'a plain mark is tinted, not drawn as an image');
  assert.equal(logoFor('qwen3', LOGOS).color, true);
  assert.equal(logoFor('grok-4', [...LOGOS, 'grok-color.svg']).src, '/assets/grok-color.svg');
  assert.equal(modelIconFor('qwen3-next-80b-a3b', LOGOS), '/assets/qwen-color.svg');
  assert.equal(modelIconFor('gemma-3-27b', LOGOS), '/assets/gemma-color.svg');
  assert.equal(modelIconFor('claude-opus-5', LOGOS), '/assets/anthropic.svg');
  assert.equal(modelIconFor('kimi-k2', LOGOS), '/assets/moonshot.svg');
  assert.equal(modelIconFor('some-local-finetune', LOGOS), null);
});