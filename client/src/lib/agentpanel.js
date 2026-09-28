import { oqrRecords } from './oqr.js';

const stepKey = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function planRecords(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m.role !== 'assistant') continue;
    for (const { call, result, hidden } of oqrRecords(m.content)) {
      if (hidden || call.tool !== 'todo' || !result || !result.ok || !Array.isArray(result.items)) continue;
      out.push(result.items);
    }
  }
  return out;
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
  total: plan.items.length
} : null);

export function groupPlans(records) {
  let current = null, previous = null;
  (records || []).forEach((items, i) => {
    if (isNewPlan(current?.items, items)) {
      previous = current;
      current = { key: 'p' + i, items };
    } else {
      current = { ...current, items };
    }
  });
  return { plan: shape(current), previousPlan: shape(previous) };
}

export function agentPanelState(messages, { liveContent = '' } = {}) {
  const live = liveContent ? [{ role: 'assistant', content: liveContent }] : [];
  return groupPlans(planRecords([...(messages || []), ...live]));
}
