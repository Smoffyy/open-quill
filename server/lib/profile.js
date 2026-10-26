import { uid } from '../db.js';

export const PREFS_MAX_BYTES = 256 * 1024;
export const STYLES_MAX = 30;

const items = (list) => (Array.isArray(list) ? list : []).filter(x => x && typeof x === 'object' && !Array.isArray(x));
const id = (v) => String(v || uid()).slice(0, 40);

export function cleanStyles(list) {
  return items(list)
    .map(x => ({ id: id(x.id), name: String(x.name || '').trim().slice(0, 50), prompt: String(x.prompt || '').trim().slice(0, 4000) }))
    .filter(x => x.name && x.prompt).slice(0, STYLES_MAX);
}

export function prefsFit(prefs) {
  return !!prefs && typeof prefs === 'object' && !Array.isArray(prefs) && JSON.stringify(prefs).length <= PREFS_MAX_BYTES;
}