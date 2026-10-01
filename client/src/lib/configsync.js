export const SYNC_JITTER_MS = 1200;
export const DRAFT_SETTLE_MS = 250;

export function newerVersion(known, incoming) {
  const n = Number(incoming) || 0;
  return n > (Number(known) || 0) ? n : 0;
}

export function syncDelay(isAdmin, rand = Math.random) {
  return isAdmin ? 0 : Math.round(rand() * SYNC_JITTER_MS);
}

const RELOADS = {
  __proto__: null,
  models: ['models'],
  providers: ['models'],
  settings: ['config'],
  config: ['config'],
  theme: ['theme'],
  all: ['models', 'config', 'theme']
};

export function draftReloads(frame, ownTab) {
  const list = RELOADS[frame?.scope] || [];
  return frame?.tab && frame.tab === ownTab ? list.filter(r => r !== 'theme') : list;
}