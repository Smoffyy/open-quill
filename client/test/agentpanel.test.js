import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentPanelState } from '../src/lib/agentpanel.js';
import { oqrRecords } from '../src/lib/oqr.js';

const oqr = (rec) => '[[OQR:' + Buffer.from(JSON.stringify(rec), 'utf8').toString('base64') + ']]';
const todo = (items, extra = {}) => oqr({ call: { tool: 'todo' }, result: { ok: true, items }, ...extra });
const ask = (question, options) => oqr({ call: { tool: 'ask_user', question }, result: { ok: true, question, options } });

test('OQR records decode, including non-ASCII text', () => {
  const recs = oqrRecords('before ' + ask('Café ou thé ?', ['Café', 'Thé']) + ' after [[OQR:@@@]]');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].result.question, 'Café ou thé ?');
});

test('the plan is the latest todo list in the thread', () => {
  const messages = [
    { id: 'a', role: 'assistant', content: todo([{ content: 'Old', status: 'pending' }]) },
    { id: 'u', role: 'user', content: 'go on' },
    { id: 'b', role: 'assistant', content: 'text ' + todo([{ content: 'One', status: 'completed' }, { content: 'Two', status: 'in_progress' }]) },
    { id: 'c', role: 'assistant', content: 'no tools here' }
  ];
  const { plan } = agentPanelState(messages);
  assert.deepEqual(plan.items.map(i => i.content), ['One', 'Two']);
  assert.equal(plan.done, 1);
  assert.equal(plan.total, 2);
});

test('a hidden todo record and a failed one are ignored', () => {
  assert.equal(agentPanelState([{ role: 'assistant', content: todo([{ content: 'x', status: 'pending' }], { hidden: true }) }]).plan, null);
  assert.equal(agentPanelState([{ role: 'assistant', content: oqr({ call: { tool: 'todo' }, result: { ok: false, error: 'bad' } }) }]).plan, null);
});

const step = (content, status = 'pending') => ({ content, status });
const asst = (content) => ({ role: 'assistant', content });

test('status changes and small edits update the plan; a different list starts a new one', async () => {
  const { groupPlans, isNewPlan } = await import('../src/lib/agentpanel.js');
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
});

test('only the plan right before the current one is kept', async () => {
  const { groupPlans } = await import('../src/lib/agentpanel.js');
  const g = groupPlans([[step('One')], [step('Two')], [step('Three'), step('Four')], [step('Three', 'completed'), step('Four')]]);
  assert.equal(g.plan.items[0].content, 'Three');
  assert.equal(g.plan.done, 1);
  assert.equal(g.previousPlan.items[0].content, 'Two');
  assert.deepEqual(groupPlans([]), { plan: null, previousPlan: null });
});

test('a plan in the reply still being written shows up straight away', () => {
  const state = agentPanelState([asst(todo([step('Old A'), step('Old B')]))], { liveContent: 'Starting. ' + todo([step('New A'), step('New B')]) });
  assert.equal(state.plan.items[0].content, 'New A');
  assert.equal(state.previousPlan.items[0].content, 'Old A');
});

test('a plan closes once every step is completed or cancelled, and an empty list cancels it', async () => {
  const { groupPlans } = await import('../src/lib/agentpanel.js');
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
});

test('a cancelled step stays in the open plan', async () => {
  const { groupPlans } = await import('../src/lib/agentpanel.js');
  const g = groupPlans([[step('A', 'completed'), step('B', 'cancelled'), step('C', 'in_progress')]]);
  assert.equal(g.plan.total, 2);
  assert.equal(g.plan.items[1].status, 'cancelled');
});

test('a plan the member dismissed stays closed until the model writes a newer one', async () => {
  const { planRecords, groupPlans, latestPlanRef } = await import('../src/lib/agentpanel.js');
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
