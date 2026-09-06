export const NAME_RE = /^[a-z][a-z0-9-]{1,60}$/;
export const NAME_MAX = 60;
export const DESC_MAX = 500;
export const CONTENT_MAX = 120000;

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function normalizeName(s) {
  return String(s ?? '').toLowerCase().trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX);
}

export function validName(s) {
  return NAME_RE.test(String(s ?? ''));
}

function unquote(v) {
  const s = String(v ?? '').trim();
  if (s.length > 1 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function parseSkillFile(text) {
  const src = String(text ?? '');
  const raw = src.charCodeAt(0) === 0xFEFF ? src.slice(1) : src;
  const m = FENCE.exec(raw);
  if (!m) return { name: '', description: '', body: raw.trim(), hasFrontmatter: false };
  const front = { __proto__: null };
  let key = '';
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) { key = kv[1].toLowerCase(); front[key] = unquote(kv[2]); continue; }
    if (key && /^\s+\S/.test(line)) front[key] = (front[key] + ' ' + line.trim()).trim();
  }
  return {
    name: normalizeName(front.name || ''),
    description: String(front.description || '').slice(0, DESC_MAX),
    body: raw.slice(m[0].length).trim(),
    hasFrontmatter: true
  };
}

export function buildSkillFile({ name, description, body }) {
  const desc = String(description ?? '').replace(/\r?\n/g, ' ').trim();
  return `---\nname: ${normalizeName(name)}\ndescription: ${desc}\n---\n\n${String(body ?? '').trim()}\n`;
}

export function skillLines(body) {
  const s = String(body ?? '').trim();
  return s ? s.split(/\r?\n/).length : 0;
}

export function validate(input, taken = []) {
  const name = normalizeName(input?.name);
  if (!validName(name)) return { error: 'Skill name must be 2-60 characters: lowercase letters, digits and hyphens.' };
  if (taken.includes(name)) return { error: `A skill named "${name}" already exists.` };
  const body = String(input?.body ?? '').trim();
  if (!body) return { error: 'Skill instructions are required.' };
  return {
    name,
    description: String(input?.description ?? '').replace(/\r?\n/g, ' ').trim().slice(0, DESC_MAX),
    body: body.slice(0, CONTENT_MAX),
    enabled: input?.enabled !== false
  };
}
