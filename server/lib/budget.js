import { db, uid, now, getSetting } from '../db.js';
import { cacheRates } from './pricing.js';

export function monthStartMs() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function monthSpend(userId) {
  return db.usage.spendSince(userId, monthStartMs());
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

export function usageCost(model, usage) {
  const prompt = usage?.prompt || 0, completion = usage?.completion || 0;
  const read = Math.min(prompt, usage?.cacheRead || 0);
  const write = Math.min(prompt - read, usage?.cacheWrite || 0);
  const costIn = Number(model?.cost_in) || 0, costOut = Number(model?.cost_out) || 0;
  const rates = cacheRates(model?.internal_name);
  const input = (prompt - read - write) + read * rates.read + write * rates.write;
  return (input / 1e6) * costIn + (completion / 1e6) * costOut;
}

export function recordUsage(userId, model, usage, name = model.display_name || '') {
  if (!usage || !(usage.prompt || usage.completion)) return null;
  const prompt = usage.prompt || 0, completion = usage.completion || 0;
  const costIn = Number(model.cost_in) || 0, costOut = Number(model.cost_out) || 0;
  const rec = {
    prompt, completion, total: usage.total || prompt + completion,
    cache_read: usage.cacheRead || 0, cache_write: usage.cacheWrite || 0, cost: usageCost(model, usage)
  };
  db.usage.insert({ id: uid(), user_id: userId, model_id: model.id, model_name: name, ...rec, cost_in: costIn, cost_out: costOut, created_at: now() });
  return rec;
}