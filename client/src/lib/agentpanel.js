import { oqrRecords } from './oqr.js';

const stepKey = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const finished = (it) => it.status === 'completed' || it.status === 'cancelled';

const isClosedPlan = (items) => !items.length || items.every(finished);

const isPlanRecord = ({ call, result }) => call.tool === 'todo' && !!result && !!result.ok && Array.isArray(result.items);

export function planRecords(messages, dismissed = null) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m.role !== 'assistant') continue;
    let n = 0;
    for (const rec of oqrRecords(m.content)) {
      if (!isPlanRecord(rec)) continue;
      n++;
      if (!rec.hidden) out.push(rec.result.items);
      if (dismissed && dismissed.msg === m.id && dismissed.n === n) out.push([]);
    }
  }
  return out;
}

export function latestPlanRef(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.role !== 'assistant' || !m.id) continue;
    const n = oqrRecords(m.content).filter(isPlanRecord).length;
    if (n) return { msg: m.id, n };
  }
  return null;
}

export function isNewPlan(prev, next) {
  if (!prev) return true;
  const had = new Set(prev.map(it => stepKey(it.content)));
  const shared = next.filter(it => had.has(stepKey(it.content))).length;
  return shared * 2 < Math.max(prev.length, next.length);
}

const shape = (plan) => (plan ? {
  key: plan.key,
  items: plan.items,
  done: plan.items.filter(it => it.status === 'completed').length,
  total: plan.items.filter(it => it.status !== 'cancelled').length
} : null);

export function groupPlans(records) {
  let current = null, previous = null;
  (records || []).forEach((items, i) => {
    if (isNewPlan(current?.items, items)) {
      previous = current || previous;
      current = { key: 'p' + i, items };
    } else {
      current = { ...current, items };
    }
    if (isClosedPlan(items)) {
      if (items.length) previous = current;
      current = null;
    }
  });
  return { plan: shape(current), previousPlan: shape(previous) };
}

export function agentPanelState(messages, { liveContent = '', liveId = null, dismissed = null } = {}) {
  const live = liveContent ? [{ id: liveId, role: 'assistant', content: liveContent }] : [];
  return groupPlans(planRecords([...(messages || []), ...live], dismissed));
}