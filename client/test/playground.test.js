import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LANES, laneKey, makeLane, addLane, moveSubject, laneRow, kwargDefsOf, usesPromptToken,
  pickedText, historyFor, tally, sseSplit, runStats, fmtDuration, replyStats, settle,
  restoreSession, suiteWins, patchCase, groupModels
} from '../src/lib/playground.js';

test('throughput is measured over generation, not over the wait before it', () => {
  const s = runStats({ startedAt: 0, firstAt: 20000, endedAt: 22000, usage: { completion: 80, prompt: 300 } });
  assert.equal(s.ttft, 20000);
  assert.equal(s.total, 22000);
  assert.equal(Math.round(s.tps), 40);
  assert.equal(s.out, 80);
  assert.equal(s.prompt, 300);
});

test('a run with no tokens yet reports no rate rather than zero', () => {
  const s = runStats({ startedAt: 0, endedAt: 5000 });
  assert.equal(s.ttft, null);
  assert.equal(s.tps, null);
  assert.equal(s.total, 5000);
  assert.equal(replyStats({}), null, 'a reply that never started has no numbers');
});

test('durations read at the scale a human is judging', () => {
  assert.equal(fmtDuration(374), '374ms');
  assert.equal(fmtDuration(1240), '1.24s');
  assert.equal(fmtDuration(64000), '1m 04s');
  assert.equal(fmtDuration(NaN), '–');
});

test('a column is a model and a version, and the same pair is never added twice', () => {
  let lanes = [makeLane('a')];
  lanes = addLane(lanes, 'a', 'live');
  assert.deepEqual(lanes.map(laneKey), ['a:draft', 'a:live']);
  assert.equal(addLane(lanes, 'a', 'live'), lanes);
  lanes = addLane(lanes, 'b', 'draft');
  assert.equal(lanes.length, MAX_LANES);
  assert.equal(addLane(lanes, 'c', 'draft'), lanes, 'the column limit holds');
});

test('switching the model under test carries its live column with it', () => {
  const lanes = [makeLane('a'), makeLane('a', 'live'), makeLane('b')];
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

test('the conversation continues from the preferred reply', () => {
  const turn = { role: 'assistant', pick: 1, replies: [{ content: 'a', key: 'm:draft' }, { content: 'b', key: 'm:live' }] };
  assert.equal(pickedText(turn), 'b');
  assert.equal(pickedText({ role: 'assistant', pick: 9, replies: [{ content: 'a' }] }), 'a');
  assert.deepEqual(historyFor([{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }, turn, { role: 'user', content: ' ' }]),
    [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'b' }]);
});

test('only an explicit preference counts as a win', () => {
  const replies = [{ key: 'a:draft' }, { key: 'a:live' }];
  const wins = tally([
    { role: 'assistant', pick: 0, chosen: false, replies },
    { role: 'assistant', pick: 1, chosen: true, replies },
    { role: 'assistant', pick: 0, chosen: true, replies: [{ key: 'a:draft' }] }
  ]);
  assert.deepEqual(wins, { 'a:live': 1 });
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

test('a reload never leaves a reply spinning', () => {
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

test('editing one test leaves the others alone', () => {
  const suites = [{ id: 's', cases: [{ id: '1', prompt: 'a' }, { id: '2', prompt: 'b' }] }];
  const next = patchCase(suites, 's', '2', { prompt: 'c' });
  assert.deepEqual(next[0].cases.map(c => c.prompt), ['a', 'c']);
  assert.equal(next[0].cases[0], suites[0].cases[0]);
});

test('the model picker groups by folder in catalog order', () => {
  const groups = groupModels([{ id: 'a', f: 'X' }, { id: 'b' }, { id: 'c', f: 'X' }], (m) => m.f || '');
  assert.deepEqual(groups.map(g => g.label), ['X', '']);
  assert.deepEqual(groups[0].items.map(m => m.id), ['a', 'c']);
});