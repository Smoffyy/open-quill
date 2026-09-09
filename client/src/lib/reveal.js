// How a streaming reply appears. Pure and import-free so it is unit-testable and
// so App.jsx and SettingsModal cannot disagree about the resolution rules.

export const REVEAL_STYLES = ['instant', 'modern', 'legacy'];

// The prefs before this was a single named style: `typewriter` (and before that
// `animations`) was a boolean, so off meant everything at once. On means the
// current animated reveal, not the one that happened to ship that year, which
// is also how the retired `typewriter` value lands on `modern` rather than on
// the style that inherited its behaviour.
export function legacyRevealStyle(prefs) {
  return (prefs?.typewriter ?? prefs?.animations) !== false ? 'modern' : 'instant';
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

// The interval the reveal loop in App.jsx waits between slices. Only `legacy`
// walks the text a slice at a time; the others hand over what has arrived.
export function revealSpeedMs(v) {
  const n = parseInt(v);
  return v == null || isNaN(n) ? 40 : Math.max(0, Math.min(100, n));
}
