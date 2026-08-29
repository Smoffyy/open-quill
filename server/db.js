import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { DATA_ROOT, dataPath } from './lib/dataroot.js';
import { BRAND_ICON, BRAND_GENERATING, BRAND_THINKING, BRAND_ICON_FIELDS, remapBrandPath } from './lib/brand.js';

const DATA_DIR = DATA_ROOT;
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = dataPath('data.db');
const KEYFILE = dataPath('.dbkey');

const HEX_KEY = /^[0-9a-fA-F]{64}$/;

function loadKey() {
  const env = process.env.DB_ENCRYPTION_KEY;
  if (env && env.trim()) return env.trim();
  try {
    const k = fs.readFileSync(KEYFILE, 'utf8').trim();
    if (k) return k;
  } catch (e) { if (e?.code !== 'ENOENT') throw e; }
  const k = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(KEYFILE, k, { mode: 0o600 });
  try { fs.chmodSync(KEYFILE, 0o600); } catch {}
  return k;
}

// The key ends up inside a PRAGMA string, so it is never interpolated raw. 64 hex
// characters are the raw-key blob literal SQLCipher wants (what this server generates);
// anything else is treated as a passphrase with its quotes doubled, so a stray ' in
// DB_ENCRYPTION_KEY cannot close the literal and be parsed as SQL.
function keyPragma(key) {
  if (HEX_KEY.test(key)) return `key="x'${key.toLowerCase()}'"`;
  return `key='${key.replace(/'/g, "''")}'`;
}

const KEY = loadKey();
const sdb = new Database(FILE);
try { fs.chmodSync(FILE, 0o600); } catch {}
sdb.pragma(`cipher='sqlcipher'`);
sdb.pragma(keyPragma(KEY));

try {
  sdb.prepare('SELECT count(*) FROM sqlite_master').get();
} catch (e) {
  throw new Error(`[db] Cannot open encrypted database (${e.message}). The encryption key does not match this data.db. Set DB_ENCRYPTION_KEY or restore the original server/.dbkey.`, { cause: e });
}

sdb.pragma('journal_mode = WAL');
sdb.pragma('synchronous = NORMAL');
sdb.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT, created_at INTEGER, data TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY, user_id TEXT, sort_order INTEGER, created_at INTEGER, data TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id, sort_order);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, user_id TEXT, folder_id TEXT, updated_at INTEGER, data TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, chat_id TEXT, parent_id TEXT, created_at INTEGER, data TEXT NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY, sort_order INTEGER, enabled INTEGER, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_models_sort ON models(sort_order);
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY, user_id TEXT, model_id TEXT, created_at INTEGER, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id, created_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
`;

if (sdb.pragma('user_version', { simple: true }) === 0) {
  sdb.exec(SCHEMA);
  sdb.pragma('user_version = 1');
}

if (sdb.pragma('user_version', { simple: true }) < 2) {
  sdb.exec(`CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, user_id TEXT, model_id TEXT, created_at INTEGER, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id, created_at);`);
  sdb.pragma('user_version = 2');
}

if (sdb.pragma('user_version', { simple: true }) < 3) {
  sdb.exec(`CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, owner_id TEXT, created_at INTEGER, updated_at INTEGER, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_spaces_owner ON spaces(owner_id);
CREATE TABLE IF NOT EXISTS space_messages (id TEXT PRIMARY KEY, space_id TEXT, created_at INTEGER, data TEXT NOT NULL, FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_space_messages_space ON space_messages(space_id, created_at);`);
  sdb.pragma('user_version = 3');
}

if (sdb.pragma('user_version', { simple: true }) < 4) {
  sdb.exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT, last_seen INTEGER, created_at INTEGER, data TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, last_seen);`);
  sdb.pragma('user_version = 4');
}

if (sdb.pragma('user_version', { simple: true }) < 5) {
  sdb.exec(`CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, ts INTEGER, actor_id TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);`);
  sdb.pragma('user_version = 5');
}

if (sdb.pragma('user_version', { simple: true }) < 6) {
  sdb.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id TEXT, updated_at INTEGER, created_at INTEGER, data TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at);`);
  sdb.pragma('user_version = 6');
}

if (sdb.pragma('user_version', { simple: true }) < 7) {
  sdb.exec(`CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, ts INTEGER, user_id TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(ts);`);
  sdb.pragma('user_version = 7');
}

if (sdb.pragma('user_version', { simple: true }) < 8) {
  sdb.exec(`CREATE INDEX IF NOT EXISTS idx_usage_created ON usage(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(chat_id, parent_id);`);
  sdb.pragma('user_version = 8');
}

if (sdb.pragma('user_version', { simple: true }) < 9) {
  sdb.exec(`CREATE TABLE IF NOT EXISTS toolstats (id TEXT PRIMARY KEY, ts INTEGER, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_toolstats_ts ON toolstats(ts);`);
  sdb.pragma('user_version = 9');
}

if (sdb.pragma('user_version', { simple: true }) < 10) {
  sdb.exec(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id TEXT, next_run INTEGER, updated_at INTEGER, created_at INTEGER, data TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, next_run);`);
  sdb.pragma('user_version = 10');
}

if (sdb.pragma('user_version', { simple: true }) < 11) {
  sdb.exec(`CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, updated_at INTEGER, created_at INTEGER, data TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id, name);`);
  sdb.pragma('user_version = 11');
}

// Case-insensitive substring test done inside SQLite. SQLite's own LIKE and lower() fold
// ASCII only, so using them here would quietly stop matching "ДОМ" against "дом" the way
// the JavaScript scans these queries replaced always did. The needle is lowercased by the
// caller; only the haystack is folded per row.
sdb.function('oq_icontains', { deterministic: true }, (hay, needle) => {
  if (typeof hay !== 'string' || !hay || !needle) return 0;
  return hay.toLowerCase().includes(needle) ? 1 : 0;
});

export function tx(fn) { return sdb.transaction(fn)(); }

export const uid = () => crypto.randomUUID();
let lastTs = 0;
export const now = () => { const t = Date.now(); lastTs = t > lastTs ? t : lastTs + 1; return lastTs; };

const MIRROR = {
  users: { email: o => o.email ?? null, created_at: o => o.created_at ?? 0 },
  folders: { user_id: o => o.user_id ?? null, sort_order: o => o.sort_order ?? 0, created_at: o => o.created_at ?? 0 },
  chats: { user_id: o => o.user_id ?? null, folder_id: o => o.folder_id ?? null, updated_at: o => o.updated_at ?? 0 },
  messages: { chat_id: o => o.chat_id ?? null, parent_id: o => o.parent_id ?? null, created_at: o => o.created_at ?? 0 },
  models: { sort_order: o => o.sort_order ?? 0, enabled: o => o.enabled ?? 0 },
  usage: { user_id: o => o.user_id ?? null, model_id: o => o.model_id ?? null, created_at: o => o.created_at ?? 0 },
  spaces: { owner_id: o => o.owner_id ?? null, created_at: o => o.created_at ?? 0, updated_at: o => o.updated_at ?? 0 },
  space_messages: { space_id: o => o.space_id ?? null, created_at: o => o.created_at ?? 0 },
  sessions: { user_id: o => o.user_id ?? null, last_seen: o => o.last_seen ?? 0, created_at: o => o.created_at ?? 0 },
  audit: { ts: o => o.ts ?? 0, actor_id: o => o.actor_id ?? null },
  projects: { user_id: o => o.user_id ?? null, updated_at: o => o.updated_at ?? 0, created_at: o => o.created_at ?? 0 },
  feedback: { ts: o => o.ts ?? 0, user_id: o => o.user_id ?? null },
  toolstats: { ts: o => o.ts ?? 0 },
  tasks: { user_id: o => o.user_id ?? null, next_run: o => o.next_run ?? 0, updated_at: o => o.updated_at ?? 0, created_at: o => o.created_at ?? 0 },
  skills: { user_id: o => o.user_id ?? null, name: o => o.name ?? null, updated_at: o => o.updated_at ?? 0, created_at: o => o.created_at ?? 0 }
};

const bumps = new Map();
function bumpTable(table) { bumps.set(table, (bumps.get(table) || 0) + 1); }

const isKey = id => typeof id === 'string' || typeof id === 'number';

function collection(table) {
  const cols = Object.keys(MIRROR[table]);
  const mirror = MIRROR[table];
  const bump = () => bumpTable(table);
  const colList = ['id', ...cols, 'data'];
  const insSql = `INSERT INTO ${table} (${colList.join(',')}) VALUES (${colList.map(() => '?').join(',')})`;
  const insStmt = sdb.prepare(insSql);
  const updSql = `UPDATE ${table} SET ${[...cols, 'data'].map(c => `${c}=?`).join(',')} WHERE id=?`;
  const updStmt = sdb.prepare(updSql);
  const getStmt = sdb.prepare(`SELECT data FROM ${table} WHERE id=?`);
  const allStmt = sdb.prepare(`SELECT data FROM ${table}`);
  const delStmt = sdb.prepare(`DELETE FROM ${table} WHERE id=?`);
  const cntStmt = sdb.prepare(`SELECT count(*) AS n FROM ${table}`);
  const parse = r => r ? JSON.parse(r.data) : undefined;
  const rowVals = o => [...cols.map(c => mirror[c](o)), JSON.stringify(o)];

  const whereStmts = new Map();
  const whereStmt = (col) => {
    if (!whereStmts.has(col)) whereStmts.set(col, sdb.prepare(`SELECT data FROM ${table} WHERE ${col} IS ?`));
    return whereStmts.get(col);
  };
  const countWhereStmts = new Map();
  const countWhereStmt = (col) => {
    if (!countWhereStmts.has(col)) countWhereStmts.set(col, sdb.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${col} IS ?`));
    return countWhereStmts.get(col);
  };
  const delWhereStmts = new Map();
  const delWhereStmt = (col) => {
    if (!delWhereStmts.has(col)) delWhereStmts.set(col, sdb.prepare(`DELETE FROM ${table} WHERE ${col} IS ?`));
    return delWhereStmts.get(col);
  };

  const api = {
    version: () => bumps.get(table) || 0,
    all: () => allStmt.all().map(r => JSON.parse(r.data)),
    filter: fn => allStmt.all().map(r => JSON.parse(r.data)).filter(fn),
    find: fn => allStmt.all().map(r => JSON.parse(r.data)).find(fn),
    // Ids arrive from request bodies and params. better-sqlite3 throws on a bound object
    // or array, which turned "look up this thing" into a 500 in every route that did not
    // coerce first; a non-primitive id simply matches nothing.
    byId: id => (isKey(id) ? parse(getStmt.get(id)) : undefined),
    where: (col, val) => (cols.includes(col) ? whereStmt(col).all(val ?? null).map(r => JSON.parse(r.data)) : api.filter(o => (o[col] ?? null) === (val ?? null))),
    countWhere: (col, val) => (cols.includes(col) ? countWhereStmt(col).get(val ?? null).n : api.filter(o => (o[col] ?? null) === (val ?? null)).length),
    removeWhere: (col, val) => { if (!cols.includes(col)) return api.remove(o => (o[col] ?? null) === (val ?? null)); delWhereStmt(col).run(val ?? null); bump(); },
    insert: obj => { insStmt.run(obj.id, ...rowVals(obj)); bump(); return obj; },
    update: (id, patch) => {
      if (!isKey(id)) return undefined;
      const cur = parse(getStmt.get(id));
      if (!cur) return undefined;
      Object.assign(cur, patch);
      updStmt.run(...rowVals(cur), id);
      bump();
      return cur;
    },
    removeById: id => { if (!isKey(id)) return; delStmt.run(id); bump(); },
    removeByIds: ids => {
      const list = (Array.isArray(ids) ? ids : [...ids]).filter(isKey);
      if (!list.length) return;
      const tx = sdb.transaction(rows => { for (const id of rows) delStmt.run(id); });
      tx(list);
      bump();
    },
    remove: fn => {
      const rows = allStmt.all().map(r => JSON.parse(r.data)).filter(fn);
      if (!rows.length) return;
      const tx = sdb.transaction(list => { for (const r of list) delStmt.run(r.id); });
      tx(rows);
      bump();
    },
    count: fn => fn ? api.filter(fn).length : cntStmt.get().n
  };
  return api;
}

const messagesCol = collection('messages');
const byChatStmt = sdb.prepare('SELECT data FROM messages WHERE chat_id=? ORDER BY created_at');
messagesCol.byChat = chatId => byChatStmt.all(chatId).map(r => JSON.parse(r.data));

// Search and preview read one extracted field per row instead of parsing the whole
// message. The scans these replaced built a full message graph for every chat the user
// owned, on every keystroke, and evicted the open chat's cached graph while doing it.
const searchStmt = sdb.prepare(`
  SELECT m.chat_id AS chatId, json_extract(m.data,'$.role') AS role, json_extract(m.data,'$.content') AS content
  FROM messages m JOIN chats c ON c.id = m.chat_id
  WHERE c.user_id = ?
    AND json_extract(m.data,'$.content') IS NOT NULL
    AND oq_icontains(json_extract(m.data,'$.content'), ?)
  ORDER BY m.created_at
  LIMIT ?`);
messagesCol.searchForUser = (userId, needle, limit = 5000) => searchStmt.all(userId, needle, limit);

const lastUserStmt = sdb.prepare(`
  SELECT json_extract(data,'$.content') AS content
  FROM messages
  WHERE chat_id = ? AND json_extract(data,'$.role') = 'user'
    AND json_extract(data,'$.content') IS NOT NULL
  ORDER BY created_at DESC LIMIT 1`);
messagesCol.lastUserText = chatId => lastUserStmt.get(chatId)?.content || '';

const attachUrlStmt = sdb.prepare(`
  SELECT DISTINCT json_extract(a.value,'$.url') AS url
  FROM messages m, json_each(json_extract(m.data,'$.attachments')) a
  WHERE json_type(m.data,'$.attachments') = 'array'`);
messagesCol.attachmentUrls = () => {
  const out = new Set();
  for (const r of attachUrlStmt.all()) if (r.url) out.add(r.url);
  return out;
};

const chatsCol = collection('chats');
const byUserStmt = sdb.prepare('SELECT data FROM chats WHERE user_id=?');
chatsCol.byUser = userId => byUserStmt.all(userId).map(r => JSON.parse(r.data));
const byUserRecentStmt = sdb.prepare('SELECT data FROM chats WHERE user_id=? ORDER BY updated_at DESC LIMIT ?');
chatsCol.recentByUser = (userId, limit) => byUserRecentStmt.all(userId, limit).map(r => JSON.parse(r.data));
const byUserOldestStmt = sdb.prepare('SELECT data FROM chats WHERE user_id=? ORDER BY updated_at ASC');
chatsCol.oldestByUser = userId => byUserOldestStmt.all(userId).map(r => JSON.parse(r.data));

const usersCol = collection('users');
const byEmailStmt = sdb.prepare('SELECT data FROM users WHERE email IS ?');
usersCol.byEmail = email => { const r = byEmailStmt.get(email ?? null); return r ? JSON.parse(r.data) : undefined; };
const userSearchStmt = sdb.prepare(`
  SELECT data FROM users
  WHERE id IS NOT ?
    AND (oq_icontains(email, ?) OR oq_icontains(json_extract(data,'$.display_name'), ?))
  ORDER BY created_at LIMIT ?`);
usersCol.search = (needle, excludeId, limit) =>
  userSearchStmt.all(excludeId ?? null, needle, needle, limit).map(r => JSON.parse(r.data));

const usageCol = collection('usage');
const usageByUserStmt = sdb.prepare('SELECT data FROM usage WHERE user_id=?');
usageCol.byUser = userId => usageByUserStmt.all(userId).map(r => JSON.parse(r.data));
const usageByUserSinceStmt = sdb.prepare('SELECT data FROM usage WHERE user_id=? AND created_at >= ?');
usageCol.byUserSince = (userId, since) => usageByUserSinceStmt.all(userId, since || 0).map(r => JSON.parse(r.data));
const usageSinceStmt = sdb.prepare('SELECT data FROM usage WHERE created_at >= ?');
usageCol.since = since => usageSinceStmt.all(since || 0).map(r => JSON.parse(r.data));
const usageNameStmt = sdb.prepare("SELECT json_extract(data,'$.model_name') AS name FROM usage WHERE model_id=? AND json_extract(data,'$.model_name') NOT IN ('', 'null') LIMIT 1");
usageCol.nameForModel = modelId => { const r = usageNameStmt.get(modelId); return (r && r.name) || ''; };
const usageSpendStmt = sdb.prepare("SELECT COALESCE(SUM(json_extract(data,'$.cost')), 0) AS cost FROM usage WHERE user_id=? AND created_at >= ?");
usageCol.spendSince = (userId, since) => { try { return Number(usageSpendStmt.get(userId, since)?.cost) || 0; } catch { return 0; } };
const usageSpendAllStmt = sdb.prepare("SELECT user_id, COALESCE(SUM(json_extract(data,'$.cost')), 0) AS cost FROM usage WHERE created_at >= ? GROUP BY user_id");
usageCol.spendSinceByUser = (since) => {
  const out = new Map();
  try { for (const r of usageSpendAllStmt.all(since)) out.set(r.user_id, Number(r.cost) || 0); } catch {}
  return out;
};

const spaceMessagesCol = collection('space_messages');
const spMsgBySpaceStmt = sdb.prepare('SELECT data FROM space_messages WHERE space_id=? ORDER BY created_at');
spaceMessagesCol.bySpace = spaceId => spMsgBySpaceStmt.all(spaceId).map(r => JSON.parse(r.data));

const sessionsCol = collection('sessions');
const sessionsByUserStmt = sdb.prepare('SELECT data FROM sessions WHERE user_id=? ORDER BY last_seen DESC');
sessionsCol.byUser = userId => sessionsByUserStmt.all(userId).map(r => JSON.parse(r.data));
const touchSessionStmt = sdb.prepare('UPDATE sessions SET last_seen=?, data=json_set(data,\'$.last_seen\',?) WHERE id=?');
sessionsCol.touch = (id, ts) => { try { touchSessionStmt.run(ts, ts, id); } catch {} };

const auditCol = collection('audit');
const auditRecentStmt = sdb.prepare('SELECT data FROM audit ORDER BY ts DESC LIMIT ? OFFSET ?');
auditCol.recent = (limit, offset) => auditRecentStmt.all(limit, offset).map(r => JSON.parse(r.data));
const auditPruneStmt = sdb.prepare('DELETE FROM audit WHERE ts < ?');
auditCol.prune = before => { try { return auditPruneStmt.run(before).changes; } catch { return 0; } };

// Filtering, counting and paging all happen in SQL. The admin panel used to pull every
// audit row into JavaScript — twice per request, once more for the export — and filter
// there, which grows without bound until the 120-day prune catches up.
const AUDIT_WHERE = `
  WHERE ts >= @since
    AND (@action = '' OR oq_icontains(json_extract(data,'$.action'), @action))
    AND (@actor  = '' OR oq_icontains(json_extract(data,'$.actor_email'), @actor))`;
const auditQueryStmt = sdb.prepare(`SELECT data FROM audit ${AUDIT_WHERE} ORDER BY ts DESC LIMIT @limit OFFSET @offset`);
const auditCountStmt = sdb.prepare(`SELECT count(*) AS n FROM audit ${AUDIT_WHERE}`);
const auditActionsStmt = sdb.prepare(`SELECT DISTINCT json_extract(data,'$.action') AS action FROM audit WHERE action IS NOT NULL ORDER BY action`);
const auditAllStmt = sdb.prepare('SELECT data FROM audit ORDER BY ts DESC');
auditCol.query = (f) => auditQueryStmt.all(f).map(r => JSON.parse(r.data));
auditCol.countMatching = (f) => auditCountStmt.get(f).n;
auditCol.actions = () => auditActionsStmt.all().map(r => r.action).filter(Boolean);
auditCol.stream = function* () { for (const r of auditAllStmt.iterate()) yield JSON.parse(r.data); };

const feedbackCol = collection('feedback');
const feedbackRecentStmt = sdb.prepare('SELECT data FROM feedback ORDER BY ts DESC LIMIT ? OFFSET ?');
feedbackCol.recent = (limit, offset) => feedbackRecentStmt.all(limit, offset).map(r => JSON.parse(r.data));
const feedbackByMsgStmt = sdb.prepare("SELECT data FROM feedback WHERE json_extract(data,'$.message_id')=?");
feedbackCol.byMessage = mid => feedbackByMsgStmt.all(mid).map(r => JSON.parse(r.data));

const IS_SAFETY = `(COALESCE(json_extract(data,'$.kind'),'') = 'safety')`;
const feedbackPageStmt = sdb.prepare(`SELECT data FROM feedback WHERE ${IS_SAFETY} = @safety ORDER BY ts DESC LIMIT @limit OFFSET @offset`);
const feedbackCountStmt = sdb.prepare(`SELECT count(*) AS n FROM feedback WHERE ${IS_SAFETY} = @safety`);
const feedbackRatingStmt = sdb.prepare(`SELECT json_extract(data,'$.rating') AS rating, count(*) AS n FROM feedback WHERE ${IS_SAFETY} = 0 GROUP BY rating`);
feedbackCol.pageByKind = (safety, limit, offset) =>
  feedbackPageStmt.all({ safety: safety ? 1 : 0, limit, offset }).map(r => JSON.parse(r.data));
feedbackCol.countByKind = safety => feedbackCountStmt.get({ safety: safety ? 1 : 0 }).n;
feedbackCol.ratingCounts = () => {
  const out = { up: 0, down: 0 };
  for (const r of feedbackRatingStmt.all()) {
    if (r.rating === 1) out.up = r.n;
    else if (r.rating === -1) out.down = r.n;
  }
  return out;
};
const feedbackDeleteSafetyStmt = sdb.prepare(`DELETE FROM feedback WHERE ${IS_SAFETY}`);
feedbackCol.clearSafety = () => { feedbackDeleteSafetyStmt.run(); bumpTable('feedback'); };

const toolStatsCol = collection('toolstats');
const toolStatsPruneStmt = sdb.prepare('DELETE FROM toolstats WHERE ts < ?');
toolStatsCol.prune = before => { try { return toolStatsPruneStmt.run(before).changes; } catch { return 0; } };
const toolStatsClearStmt = sdb.prepare('DELETE FROM toolstats');
toolStatsCol.clear = () => { try { toolStatsClearStmt.run(); } catch {} };

const projectsCol = collection('projects');
const projectsByUserStmt = sdb.prepare('SELECT data FROM projects WHERE user_id=? ORDER BY updated_at DESC');
projectsCol.byUser = userId => projectsByUserStmt.all(userId).map(r => JSON.parse(r.data));

const skillsCol = collection('skills');
const skillsByUserStmt = sdb.prepare('SELECT data FROM skills WHERE user_id=? ORDER BY name ASC');
const skillNameStmt = sdb.prepare('SELECT data FROM skills WHERE user_id=? AND name=? LIMIT 1');
skillsCol.byUser = userId => skillsByUserStmt.all(userId).map(r => JSON.parse(r.data));
skillsCol.byName = (userId, name) => { const r = skillNameStmt.get(userId, name); return r ? JSON.parse(r.data) : undefined; };

const tasksCol = collection('tasks');
const tasksByUserStmt = sdb.prepare('SELECT data FROM tasks WHERE user_id=? ORDER BY next_run>0 DESC, next_run ASC, created_at DESC');
const tasksDueStmt = sdb.prepare('SELECT data FROM tasks WHERE next_run>0 AND next_run<=? ORDER BY next_run ASC LIMIT ?');
tasksCol.byUser = userId => tasksByUserStmt.all(userId).map(r => JSON.parse(r.data));
tasksCol.due = (at, limit) => tasksDueStmt.all(at, limit || 20).map(r => JSON.parse(r.data));

export const db = {
  users: usersCol,
  chats: chatsCol,
  messages: messagesCol,
  models: collection('models'),
  folders: collection('folders'),
  usage: usageCol,
  spaces: collection('spaces'),
  spaceMessages: spaceMessagesCol,
  sessions: sessionsCol,
  audit: auditCol,
  projects: projectsCol,
  feedback: feedbackCol,
  toolStats: toolStatsCol,
  tasks: tasksCol,
  skills: skillsCol
};

const sGet = sdb.prepare('SELECT value FROM settings WHERE key=?');
const sSet = sdb.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
const sDel = sdb.prepare('DELETE FROM settings WHERE key=?');
const sKeys = sdb.prepare('SELECT key FROM settings WHERE key LIKE ?');

const settingsCache = new Map();

export function getSetting(key, fallback = null) {
  if (settingsCache.has(key)) {
    const hit = settingsCache.get(key);
    return hit === undefined ? fallback : hit;
  }
  const r = sGet.get(key);
  let val;
  if (!r) val = undefined;
  else { try { val = JSON.parse(r.value); } catch { val = undefined; } }
  settingsCache.set(key, val);
  return val === undefined ? fallback : val;
}

export function setSetting(key, value) {
  sSet.run(key, JSON.stringify(value));
  settingsCache.set(key, value);
}

export function delSetting(key) {
  sDel.run(key);
  settingsCache.delete(key);
}

export function settingKeysWithPrefix(prefix) {
  return sKeys.all(prefix + '%').map(r => r.key);
}

function checkpoint() { try { sdb.pragma('wal_checkpoint(TRUNCATE)'); } catch {} }
process.on('exit', checkpoint);
process.on('SIGINT', () => { checkpoint(); process.exit(0); });
process.on('SIGTERM', () => { checkpoint(); process.exit(0); });

if (!getSetting('seeded')) {
  setSetting('api_base_url', 'http://localhost:8080');
  setSetting('api_key', '');
  const pid = uid();
  setSetting('providers', [{ id: pid, name: 'llama.cpp', type: 'llamacpp', base_url: 'http://localhost:8080', api_key: '' }]);
  db.models.insert({
    id: uid(), display_name: 'Quillku 1', description: 'Fastest for quick answers',
    internal_name: 'local-model', system_prompt: 'You are a helpful assistant.', provider_id: pid,
    has_reasoning: 0, reasoning_token: '', non_reasoning_token: '',
    in_more_models: 0, more_models_label: 'More models',
    static_icon: BRAND_ICON, generating_icon: BRAND_GENERATING, thinking_icon: BRAND_THINKING, icon_position: 'below', sort_order: 0, enabled: 1
  });
  setSetting('seeded', '1');
}

if (!getSetting('brand_paths_v2')) {
  for (const m of db.models.all()) {
    const patch = {};
    for (const f of BRAND_ICON_FIELDS) {
      const next = remapBrandPath(m[f]);
      if (next !== m[f]) patch[f] = next;
    }
    if (Object.keys(patch).length) db.models.update(m.id, patch);
  }
  const icon = getSetting('app_icon', '');
  if (icon && remapBrandPath(icon) !== icon) setSetting('app_icon', remapBrandPath(icon));
  setSetting('brand_paths_v2', '1');
}

export default db;
