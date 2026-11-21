import { STORE_KEY } from './playground.js';

const OWNER_KEY = 'oq-owner';
const DRAFT_PREFIX = 'oq-draft-';

export function isPrivateKey(key) {
  return key.startsWith(DRAFT_PREFIX) || key === STORE_KEY;
}

export function clearPrivateStorage(store = globalThis.localStorage) {
  try {
    for (const key of Object.keys(store)) if (isPrivateKey(key)) store.removeItem(key);
    store.removeItem(OWNER_KEY);
  } catch {}
}

export function claimStorage(userId, store = globalThis.localStorage) {
  try {
    const owner = store.getItem(OWNER_KEY);
    if (owner && owner !== userId) clearPrivateStorage(store);
    store.setItem(OWNER_KEY, userId);
  } catch {}
}