import { db } from '../db.js';

export const ROUTE_MATCHERS = ['keyword', 'regex', 'shorterThan', 'longerThan', 'hasImage', 'hasFile', 'hasCode', 'always'];

export function isRouter(model) {
  return !!model && model.kind === 'router';
}

export function routerRules(model) {
  const raw = model?.router_rules;
  const list = Array.isArray(raw) ? raw : (() => { try { const p = JSON.parse(raw || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } })();
  return list
    .map(r => ({
      match: ROUTE_MATCHERS.includes(r?.match) ? r.match : 'keyword',
      value: String(r?.value ?? '').slice(0, 400),
      modelId: String(r?.modelId ?? ''),
      label: String(r?.label ?? '').slice(0, 60),
    }))
    .filter(r => r.modelId);
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.filter(p => p?.type === 'text').map(p => p.text || '').join('\n');
    return '';
  }
  return '';
}

function signals(messages, attachments) {
  const text = lastUserText(messages);
  const last = messages[messages.length - 1];
  const parts = Array.isArray(last?.content) ? last.content : [];
  const files = Array.isArray(attachments) ? attachments : [];
  return {
    text,
    lower: text.toLowerCase(),
    length: text.length,
    hasImage: parts.some(p => p?.type === 'image_url') || files.some(f => /^image\//i.test(f?.mime || f?.type || '')),
    hasFile: files.length > 0,
    hasCode: /```/.test(text) || /\b(function|class|const |import |def |SELECT |#include)\b/.test(text),
  };
}

export function ruleMatches(rule, sig) {
  const v = String(rule.value || '').trim();
  switch (rule.match) {
    case 'always': return true;
    case 'hasImage': return sig.hasImage;
    case 'hasFile': return sig.hasFile;
    case 'hasCode': return sig.hasCode;
    case 'shorterThan': { const n = parseInt(v, 10); return Number.isFinite(n) && sig.length < n; }
    case 'longerThan': { const n = parseInt(v, 10); return Number.isFinite(n) && sig.length > n; }
    case 'regex': {
      if (!v) return false;
      try { return new RegExp(v, 'i').test(sig.text); } catch { return false; }
    }
    case 'keyword':
    default: {
      if (!v) return false;
      return v.split(',').map(w => w.trim().toLowerCase()).filter(Boolean).some(w => sig.lower.includes(w));
    }
  }
}

export function chooseRoute(router, messages, attachments) {
  const rules = routerRules(router);
  const sig = signals(messages, attachments);
  for (let i = 0; i < rules.length; i++) {
    if (ruleMatches(rules[i], sig)) return { rule: rules[i], index: i };
  }
  return { rule: null, index: -1 };
}

export function resolveRouted(model, messages, attachments, lookup) {
  if (!isRouter(model)) return { model, routed: null };
  const get = lookup || ((id) => db.models.byId(id));
  const seen = new Set([model.id]);
  let current = model;
  let hops = [];
  while (isRouter(current)) {
    const { rule, index } = chooseRoute(current, messages, attachments);
    const targetId = rule ? rule.modelId : (current.router_default || '');
    const next = targetId ? get(targetId) : null;
    if (!next || seen.has(next.id)) {
      return { model: null, routed: { hubId: model.id, hubName: model.name, error: next ? 'Routing loop detected.' : 'This router has no model to fall back on.', hops } };
    }
    seen.add(next.id);
    hops.push({
      from: current.id,
      to: next.id,
      toName: next.name,
      via: rule ? (rule.label || `${rule.match}: ${rule.value}`.slice(0, 60)) : 'default',
      ruleIndex: index,
    });
    current = next;
  }
  return { model: current, routed: { hubId: model.id, hubName: model.name, modelId: current.id, modelName: current.name, via: hops[hops.length - 1]?.via || 'default', hops } };
}
