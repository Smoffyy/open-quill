import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.dirname(__dirname);
const REPO_ROOT = path.dirname(SERVER_ROOT);
export const DATA_BASE = path.join(SERVER_ROOT, 'data');
export const DATABASES_DIR = path.join(DATA_BASE, 'databases');
const ENV_CANDIDATES = [path.join(REPO_ROOT, '.env'), path.join(SERVER_ROOT, '.env')];

const DEFAULT_NAME = 'default';
const RESERVED = new Set([DEFAULT_NAME, 'databases']);
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

// The .env written on first run is a copy of .env.example, which is the one place these
// options are documented. This used to be a second copy of that text inline, and the two
// drifted the first time an option was added — a fresh install got a config file missing
// the newest setting. The inline text below is only a floor for the case where
// .env.example is absent, and deliberately carries nothing but the selector.
const ENV_FALLBACK = `# OPEN_QUILL_DB selects the database to load at startup. Each database is
# completely isolated (users, chats, files, models, memory, etc.).
# Change this value and restart the server to switch databases.
OPEN_QUILL_DB=default
`;

function envTemplate() {
  try {
    const text = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
    if (text.includes('OPEN_QUILL_DB')) return text;
  } catch {}
  return ENV_FALLBACK;
}

function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function resolveEnv() {
  const existing = ENV_CANDIDATES.filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
  let primary = existing[0];
  if (!primary) {
    primary = ENV_CANDIDATES[0];
    try {
      fs.mkdirSync(path.dirname(primary), { recursive: true });
      fs.writeFileSync(primary, envTemplate(), { flag: 'wx' });
    } catch {}
  }
  let parsed = {};
  try { parsed = parseEnv(fs.readFileSync(primary, 'utf8')); } catch {}
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return { primary, ignored: existing.filter(f => f !== primary) };
}

const ENV_RESOLUTION = resolveEnv();
export const ENV_FILE = ENV_RESOLUTION.primary;

export function sanitizeDbName(value) {
  const cleaned = String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  return cleaned || DEFAULT_NAME;
}

export function validateDbName(value) {
  const name = String(value == null ? '' : value).trim().toLowerCase();
  if (!name) return { ok: false, error: 'A database name is required.' };
  if (!NAME_RE.test(name)) return { ok: false, error: 'Use 1 to 40 characters: lowercase letters, numbers, dashes or underscores, starting with a letter or number.' };
  if (RESERVED.has(name)) return { ok: false, error: `"${name}" is a reserved name.` };
  return { ok: true, name };
}

export function rootForName(name) {
  const n = sanitizeDbName(name);
  return n === DEFAULT_NAME ? DATA_BASE : path.join(DATABASES_DIR, n);
}

function envSelectedName() {
  const raw = process.env.OPEN_QUILL_DB ?? process.env.DB_NAME ?? DEFAULT_NAME;
  return sanitizeDbName(raw);
}

export const DB_NAME = envSelectedName();
export const DATA_ROOT = rootForName(DB_NAME);

try { fs.mkdirSync(DATA_ROOT, { recursive: true }); } catch {}

try {
  console.log(`[db] active database "${DB_NAME}" -> ${DATA_ROOT}`);
  console.log(`[db] database selector: ${ENV_FILE} (edit OPEN_QUILL_DB, then restart to switch)`);
  for (const f of ENV_RESOLUTION.ignored) console.warn(`[db] ignoring ${f} because ${ENV_FILE} takes precedence`);
} catch {}

export function dataPath(...segments) {
  return path.join(DATA_ROOT, ...segments);
}

export function pendingDbName() {
  let text;
  try { text = fs.readFileSync(ENV_FILE, 'utf8'); } catch { return DB_NAME; }
  const parsed = parseEnv(text);
  const raw = parsed.OPEN_QUILL_DB ?? parsed.DB_NAME;
  return raw == null ? DB_NAME : sanitizeDbName(raw);
}

function dirSize(dir, skipChild) {
  let total = 0;
  let budget = 200000;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    if (--budget < 0) break;
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (cur === dir && skipChild && ent.name === skipChild) continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) { stack.push(full); continue; }
      try { total += fs.statSync(full).size; } catch {}
    }
  }
  return total;
}

function describe(name) {
  const n = sanitizeDbName(name);
  const root = rootForName(n);
  const dbFile = path.join(root, 'data.db');
  return {
    name: n,
    active: n === DB_NAME,
    pending: n === pendingDbName(),
    initialized: fs.existsSync(dbFile),
    sizeBytes: dirSize(root, n === DEFAULT_NAME ? 'databases' : null)
  };
}

export function listDatabases() {
  const names = new Set([DEFAULT_NAME, DB_NAME, pendingDbName()]);
  try {
    for (const ent of fs.readdirSync(DATABASES_DIR, { withFileTypes: true })) {
      if (ent.isDirectory() && !ent.name.startsWith('.')) names.add(sanitizeDbName(ent.name));
    }
  } catch {}
  const list = [...names].map(describe);
  list.sort((a, b) => a.name === DEFAULT_NAME ? -1 : b.name === DEFAULT_NAME ? 1 : a.name.localeCompare(b.name));
  return list;
}

export function createDatabase(name) {
  const v = validateDbName(name);
  if (!v.ok) return { ok: false, error: v.error };
  const root = path.join(DATABASES_DIR, v.name);
  if (fs.existsSync(root)) return { ok: false, error: 'A database with that name already exists.' };
  try { fs.mkdirSync(root, { recursive: true }); } catch (e) { return { ok: false, error: 'Could not create the database folder.' }; }
  return { ok: true, database: describe(v.name) };
}

export function setPendingDatabase(name) {
  const n = sanitizeDbName(name);
  if (n !== DEFAULT_NAME) {
    const v = validateDbName(n);
    if (!v.ok) return { ok: false, error: v.error };
    if (!fs.existsSync(path.join(DATABASES_DIR, n))) return { ok: false, error: 'That database does not exist yet.' };
  }
  let text;
  try { text = fs.readFileSync(ENV_FILE, 'utf8'); } catch { text = envTemplate(); }
  const lines = text.split(/\r?\n/);
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*OPEN_QUILL_DB\s*=/.test(lines[i]) && !lines[i].trim().startsWith('#')) {
      lines[i] = `OPEN_QUILL_DB=${n}`;
      replaced = true;
    }
  }
  if (!replaced) {
    if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, `OPEN_QUILL_DB=${n}`);
    else lines.push(`OPEN_QUILL_DB=${n}`);
  }
  try { fs.writeFileSync(ENV_FILE, lines.join('\n')); } catch { return { ok: false, error: 'Could not write the .env file.' }; }
  return { ok: true, pending: n, active: DB_NAME, requiresRestart: n !== DB_NAME };
}

export function deleteDatabase(name) {
  const n = sanitizeDbName(name);
  if (n === DEFAULT_NAME) return { ok: false, error: 'The default database cannot be deleted.' };
  if (n === DB_NAME) return { ok: false, error: 'The active database cannot be deleted. Switch to another database and restart first.' };
  if (n === pendingDbName()) return { ok: false, error: 'This database is set to load on the next restart. Choose a different one first.' };
  const root = path.join(DATABASES_DIR, n);
  if (!fs.existsSync(root)) return { ok: false, error: 'That database does not exist.' };
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { return { ok: false, error: 'Could not delete the database folder.' }; }
  return { ok: true };
}

export function activeInfo() {
  return { active: DB_NAME, pending: pendingDbName(), envFile: ENV_FILE, requiresRestart: pendingDbName() !== DB_NAME };
}
