import { getSetting, setSetting, uid } from '../db.js';
import { normalizeName, validName, DESC_MAX, CONTENT_MAX } from './skillfile.js';

export const DEFAULT_INTRO = 'You have access to admin-provided skills: reusable instruction files with best practices, workflows, and domain knowledge. When a task matches a skill\u2019s description, load that skill with `skill_view` BEFORE doing the work and follow its instructions. Loading a relevant skill is not optional \u2014 it encodes requirements you must respect.';

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

export function promptFor(extra = []) {
  const skills = [...getEnabled(), ...extra];
  if (!skills.length) return '';
  let p = '## Skills\n' + DEFAULT_INTRO + '\n\nAvailable skills:\n';
  for (const s of skills) {
    const lines = (s.content || '').split('\n').length;
    p += `- ${s.name}${s.description ? ` \u2014 ${s.description}` : ''} (${lines} lines)\n`;
  }
  p += '\nUse the `skill_view` function to load a skill by `name` before starting a matching task.';
  return p;
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
