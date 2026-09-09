import path from 'path';
import { dataPath } from '../lib/dataroot.js';
import { normalizeRel } from '../lib/sandboxguard.js';

export const SANDBOX_ROOT = dataPath('sandbox');
export const META_DIR = path.join(SANDBOX_ROOT, '.meta');

export const safeId = (chatId) => String(chatId).replace(/[^a-zA-Z0-9_-]/g, '');

const PROJECT_PREFIX = 'p-';

export function projectKey(projectId) { return PROJECT_PREFIX + safeId(projectId); }
export function isProjectKey(key) { return String(key || '').startsWith(PROJECT_PREFIX); }

export function wsKey(chat) {
  if (!chat) return '';
  if (typeof chat === 'string') return safeId(chat);
  return chat.project_id ? projectKey(chat.project_id) : safeId(chat.id);
}

export function dirFor(chatId) { return path.join(SANDBOX_ROOT, safeId(chatId)); }

export function resolveSafe(chatId, rel) {
  const root = dirFor(chatId);
  const norm = normalizeRel(rel, { allowEmpty: true });
  if (!norm.ok) throw new Error(norm.error);
  const p = path.resolve(root, norm.rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('That path leaves the workspace root. Use a path relative to the workspace, such as "src/app.py".');
  return p;
}

export function relOf(chatId, abs) { return path.relative(dirFor(chatId), abs).split(path.sep).join('/'); }
