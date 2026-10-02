import { uid } from '../db.js';

export const SOURCES = ['draft', 'live'];
export const MAX_TURNS = 200;
export const MAX_CONTENT = 100000;
export const SUITE_LIMITS = { sets: 40, cases: 100, name: 80, prompt: 8000, expect: 2000 };

const ROLES = { __proto__: null, user: 'user', assistant: 'assistant', system: 'system' };

export function sourceOf(raw) {
  return raw === 'live' ? 'live' : 'draft';
}

export function playgroundHistory(list) {
  const out = [];
  for (const m of (Array.isArray(list) ? list : []).slice(-MAX_TURNS)) {
    const role = ROLES[m?.role];
    if (!role || typeof m.content !== 'string') continue;
    const content = m.content.slice(0, MAX_CONTENT);
    if (!content.trim() && role !== 'assistant') continue;
    out.push({ role, content });
  }
  return out;
}

const text = (v, cap) => (typeof v === 'string' ? v.slice(0, cap) : '');
const idOf = (v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : uid());

export function sanitizeSuites(raw) {
  const out = [];
  const seen = new Set();
  for (const s of (Array.isArray(raw) ? raw : []).slice(0, SUITE_LIMITS.sets)) {
    if (!s || typeof s !== 'object') continue;
    let id = idOf(s.id);
    while (seen.has(id)) id = uid();
    seen.add(id);
    const cases = [];
    const caseIds = new Set();
    for (const c of (Array.isArray(s.cases) ? s.cases : []).slice(0, SUITE_LIMITS.cases)) {
      const prompt = text(c?.prompt, SUITE_LIMITS.prompt);
      if (!prompt.trim()) continue;
      let cid = idOf(c.id);
      while (caseIds.has(cid)) cid = uid();
      caseIds.add(cid);
      cases.push({ id: cid, prompt, expect: text(c.expect, SUITE_LIMITS.expect) });
    }
    out.push({ id, name: text(s.name, SUITE_LIMITS.name).trim() || 'Untitled set', cases });
  }
  return out;
}