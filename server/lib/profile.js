import { uid } from '../db.js';

export const PREFS_MAX_BYTES = 256 * 1024;
export const STYLES_MAX = 30;
export const PERSONAS_MAX = 50;
export const PROMPTS_MAX = 50;

const items = (list) => (Array.isArray(list) ? list : []).filter(x => x && typeof x === 'object' && !Array.isArray(x));
const id = (v) => String(v || uid()).slice(0, 40);

export function cleanStyles(list) {
  return items(list)
    .map(x => ({ id: id(x.id), name: String(x.name || '').trim().slice(0, 50), prompt: String(x.prompt || '').trim().slice(0, 4000) }))
    .filter(x => x.name && x.prompt).slice(0, STYLES_MAX);
}

export function cleanPersonas(list) {
  return items(list)
    .map(p => ({
      id: id(p.id),
      name: String(p.name || '').trim().slice(0, 60),
      modelId: p.modelId ? String(p.modelId).slice(0, 40) : null,
      instructions: String(p.instructions || '').trim().slice(0, 8000)
    }))
    .filter(p => p.name).slice(0, PERSONAS_MAX);
}

export function cleanPrompts(list) {
  return items(list)
    .map(p => ({ id: id(p.id), title: String(p.title || '').trim().slice(0, 80), text: String(p.text || '').trim().slice(0, 8000) }))
    .filter(p => p.title && p.text).slice(0, PROMPTS_MAX);
}

export function prefsFit(prefs) {
  return !!prefs && typeof prefs === 'object' && !Array.isArray(prefs) && JSON.stringify(prefs).length <= PREFS_MAX_BYTES;
}
