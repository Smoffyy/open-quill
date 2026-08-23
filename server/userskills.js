import { db, uid, now } from './db.js';
import { normalizeName, validate, buildSkillFile, parseSkillFile, skillLines } from './lib/skillfile.js';

export const SKILL_LIMIT = 200;

export function list(userId) {
  return db.skills.byUser(userId);
}

export function enabledFor(userId) {
  return list(userId).filter(s => s.enabled);
}

export function byId(userId, id) {
  const s = db.skills.byId(id);
  return s && s.user_id === userId ? s : undefined;
}

export function create(userId, input) {
  const rows = list(userId);
  if (rows.length >= SKILL_LIMIT) return { error: 'You have reached the skill limit.' };
  const v = validate(input, rows.map(s => s.name));
  if (v.error) return v;
  const at = now();
  const skill = db.skills.insert({
    id: uid(),
    user_id: userId,
    name: v.name,
    description: v.description,
    body: v.body,
    enabled: v.enabled,
    source: typeof input?.source === 'string' ? input.source.slice(0, 40) : 'custom',
    created_at: at,
    updated_at: at
  });
  return { skill };
}

export function update(userId, id, patch) {
  const cur = byId(userId, id);
  if (!cur) return { error: 'Skill not found.' };
  if (Object.keys(patch || {}).length === 1 && 'enabled' in patch) {
    return { skill: db.skills.update(id, { enabled: patch.enabled !== false, updated_at: now() }) };
  }
  const merged = { ...cur, ...patch };
  const taken = list(userId).filter(s => s.id !== id).map(s => s.name);
  const v = validate(merged, taken);
  if (v.error) return v;
  return { skill: db.skills.update(id, { ...v, updated_at: now() }) };
}

export function remove(userId, id) {
  const cur = byId(userId, id);
  if (!cur) return { error: 'Skill not found.' };
  db.skills.removeById(id);
  return { ok: true };
}

export function fromFile(text, fallbackName) {
  const parsed = parseSkillFile(text);
  return {
    name: parsed.name || normalizeName(fallbackName || ''),
    description: parsed.description,
    body: parsed.body
  };
}

export function view(s, author) {
  return {
    id: s.id,
    name: s.name,
    description: s.description || '',
    body: s.body || '',
    file: buildSkillFile(s),
    lines: skillLines(s.body),
    enabled: s.enabled !== false,
    source: s.source || 'custom',
    scope: 'user',
    author: author || '',
    editable: true,
    created_at: s.created_at,
    updated_at: s.updated_at
  };
}
