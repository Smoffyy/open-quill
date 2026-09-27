const THINKING = /think|reason|effort/i;

export const LONG_CONTEXT = 100000;

export function reasons(m) {
  return !!(m && (m.has_reasoning || m.effort_enabled || m.think_open || m.think_close
    || m.reasoning_collapsible === 0 || m.hide_thinking
    || (Array.isArray(m.kwargs) && m.kwargs.some(k => THINKING.test(k?.name || '')))));
}

const answers = (m) => m.kind !== 'router';

export const BADGES = [
  { id: 'auto', supported: (m) => m.kind === 'router' },
  { id: 'text', supported: answers },
  { id: 'vision', supported: (m) => answers(m) && !!m.has_vision },
  { id: 'reasoning', supported: (m) => answers(m) && reasons(m) },
  { id: 'web', supported: (m, ctx) => answers(m) && !!ctx?.webSearch && m.web_search_allowed !== 0 },
  { id: 'code', supported: (m) => answers(m) && m.sandbox_allowed !== 0 },
  { id: 'long', supported: (m) => answers(m) && Number(m.num_ctx) >= LONG_CONTEXT }
];

export function sanitizeBadgesOff(raw) {
  const want = new Set(Array.isArray(raw) ? raw : []);
  return BADGES.filter(b => want.has(b.id)).map(b => b.id);
}

export function badgesOf(m, ctx = {}) {
  if (!m) return [];
  const off = new Set(sanitizeBadgesOff(m.badges_off));
  return BADGES.filter(b => b.supported(m, ctx) && !off.has(b.id)).map(b => b.id);
}
