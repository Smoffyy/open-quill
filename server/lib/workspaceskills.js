import { getSetting, setSetting, uid } from '../db.js';
import { normalizeName, validName, DESC_MAX, CONTENT_MAX } from './skillfile.js';

export function list() {
  const raw = getSetting('skills_list', []);
  return Array.isArray(raw) ? raw : [];
}
function save(arr) { setSetting('skills_list', arr); }

export function getEnabled() { return list().filter(s => s.enabled); }

function validate(b, existingId) {
  const name = normalizeName(b.name);
  if (!validName(name)) return { error: 'Skill name must be 2-60 chars: lowercase letters, digits, hyphens.' };
  if (list().some(s => s.name === name && s.id !== existingId)) return { error: `A skill named "${name}" already exists.` };
  if (!String(b.content || '').trim()) return { error: 'Skill content is required.' };
  return {
    name,
    description: String(b.description || '').trim().slice(0, DESC_MAX),
    content: String(b.content).slice(0, CONTENT_MAX),
    enabled: b.enabled !== false
  };
}

export function create(b) {
  const v = validate(b);
  if (v.error) return v;
  const skill = { id: uid(), ...v, created_at: Date.now(), updated_at: Date.now() };
  save([...list(), skill]);
  return { skill };
}

export function update(id, b) {
  const cur = list().find(s => s.id === id);
  if (!cur) return { error: 'Skill not found.' };
  const merged = { ...cur, ...b };
  const v = validate(merged, id);
  if (v.error) return v;
  const skill = { ...cur, ...v, updated_at: Date.now() };
  save(list().map(s => s.id === id ? skill : s));
  return { skill };
}

export function remove(id) { save(list().filter(s => s.id !== id)); return { ok: true }; }

export function skillsText(extra = []) {
  return [...getEnabled(), ...extra].map(s => {
    const lines = (s.content || '').split('\n').length;
    return `- ${s.name}${s.description ? `: ${s.description}` : ''} (${lines} lines)`;
  }).join('\n');
}

export function execTool(call, extra = []) {
  if (call.tool !== 'skill_view') return { ok: false, error: 'Unknown skill tool.' };
  const name = normalizeName(call.name);
  const s = [...getEnabled(), ...extra].find(x => x.name === name);
  if (!s) return { ok: false, error: `No skill named "${call.name}".` };
  return { ok: true, name: s.name, content: s.content };
}

export function formatResult(call, r) {
  if (!r.ok) return `skill_view ${call.name || ''} \u2192 ERROR: ${r.error}`;
  return `skill_view ${r.name} \u2192\n${r.content}`;
}

export function resultPayload(call, r) {
  const o = { ok: !!r.ok };
  if (r.error) o.error = r.error;
  if (r.name) o.name = r.name;
  if (r.ok) o.lines = (r.content || '').split('\n').length;
  return o;
}