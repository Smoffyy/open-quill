const THINKING = /think|reason|effort/i;

export function reasons(m) {
  return !!(m && (m.has_reasoning || m.effort_enabled || m.think_open || m.think_close
    || m.reasoning_collapsible === 0 || m.hide_thinking
    || (Array.isArray(m.kwargs) && m.kwargs.some(k => THINKING.test(k?.name || '')))));
}

export const BADGES = [
  { id: 'text', supported: () => true },
  { id: 'vision', supported: (m) => !!m.has_vision },
  { id: 'reasoning', supported: reasons }
];

export function sanitizeBadgesOff(raw) {
  const want = new Set(Array.isArray(raw) ? raw : []);
  return BADGES.filter(b => want.has(b.id)).map(b => b.id);
}

export function badgesOf(m) {
  if (!m || m.kind === 'router') return [];
  const off = new Set(sanitizeBadgesOff(m.badges_off));
  return BADGES.filter(b => b.supported(m) && !off.has(b.id)).map(b => b.id);
}
