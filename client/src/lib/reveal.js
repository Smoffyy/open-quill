// How a streaming reply appears. Pure and import-free so it is unit-testable and
// so App.jsx and SettingsModal cannot disagree about the resolution rules.

export const REVEAL_STYLES = ['instant', 'typewriter'];

// The legacy prefs, before this was a single named style: `typewriter` (and
// before that `animations`) was a boolean, so off meant everything at once.
export function legacyRevealStyle(prefs) {
  return (prefs?.typewriter ?? prefs?.animations) !== false ? 'typewriter' : 'instant';
}

// The OpenAI preset renders tokens exactly as the server sends them, matching
// chatgpt.com, so it has no reveal of any kind.
//
// Anything unrecognised falls through to the legacy read, which means a style
// that is later retired resolves to the default reveal rather than silently to
// `instant`. That is what makes adding and removing a style safe: the only
// place to touch is REVEAL_STYLES plus the branch that consumes it.
export function resolveReveal(prefs, preset) {
  if (preset === 'openai') return 'instant';
  const v = prefs?.revealStyle;
  if (REVEAL_STYLES.indexOf(v) !== -1) return v;
  return legacyRevealStyle(prefs);
}

// The interval the reveal loop in App.jsx waits between slices.
export function revealSpeedMs(v) {
  const n = parseInt(v);
  return v == null || isNaN(n) ? 40 : Math.max(0, Math.min(100, n));
}
