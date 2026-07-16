import { db, getSetting } from '../db.js';

export function monthStartMs() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function monthSpend(userId) {
  const since = monthStartMs();
  let cost = 0;
  for (const r of db.usage.byUser(userId)) if ((r.created_at || 0) >= since) cost += r.cost || 0;
  return cost;
}

export function budgetConfig() {
  return {
    user: Number(getSetting('budget_user', 0)) || 0,
    admin: Number(getSetting('budget_admin', 0)) || 0,
    warnFraction: Math.min(0.99, Math.max(0.1, Number(getSetting('budget_warn_fraction', 0.8)) || 0.8)),
    enforce: getSetting('budget_enforce', '0') === '1'
  };
}

export function budgetFor(user) {
  if (user.budget != null && Number(user.budget) >= 0) return Number(user.budget);
  const cfg = budgetConfig();
  return user.is_admin ? cfg.admin : cfg.user;
}

export function budgetStatus(user) {
  const cap = budgetFor(user);
  const cfg = budgetConfig();
  const spent = monthSpend(user.id);
  if (!cap) return { cap: 0, spent, fraction: 0, state: 'none', enforce: false };
  const fraction = spent / cap;
  let state = 'ok';
  if (fraction >= 1) state = 'over';
  else if (fraction >= cfg.warnFraction) state = 'warn';
  return { cap, spent, fraction, state, enforce: cfg.enforce };
}
