import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3-multiple-ciphers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, 'data.db');
const KEYFILE = path.join(DATA_DIR, '.dbkey');

function loadKey() {
  const env = process.env.DB_ENCRYPTION_KEY;
  if (env && env.trim()) return env.trim();
  try {
    const k = fs.readFileSync(KEYFILE, 'utf8').trim();
    if (k) return k;
  } catch {}
  const k = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(KEYFILE, k, { mode: 0o600 });
  try { fs.chmodSync(KEYFILE, 0o600); } catch {}
  return k;
}

const KEY = loadKey();
const existed = fs.existsSync(FILE);
const sdb = new Database(FILE);
try { fs.chmodSync(FILE, 0o600); } catch {}
sdb.pragma(`cipher='sqlcipher'`);
sdb.pragma(`key="x'${KEY}'"`);

try {
  sdb.prepare('SELECT count(*) FROM sqlite_master').get();
} catch (e) {
  throw new Error(`[db] Cannot open encrypted database (${e.message}). The encryption key does not match this data.db. Set DB_ENCRYPTION_KEY or restore the original server/.dbkey.`);
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

export const uid = () => crypto.randomUUID();
let lastTs = 0;
export const now = () => { const t = Date.now(); lastTs = t > lastTs ? t : lastTs + 1; return lastTs; };

const MIRROR = {
  users: { email: o => o.email ?? null, created_at: o => o.created_at ?? 0 },
  folders: { user_id: o => o.user_id ?? null, sort_order: o => o.sort_order ?? 0, created_at: o => o.created_at ?? 0 },
  chats: { user_id: o => o.user_id ?? null, folder_id: o => o.folder_id ?? null, updated_at: o => o.updated_at ?? 0 },
  messages: { chat_id: o => o.chat_id ?? null, parent_id: o => o.parent_id ?? null, created_at: o => o.created_at ?? 0 },
  models: { sort_order: o => o.sort_order ?? 0, enabled: o => o.enabled ?? 0 },
  usage: { user_id: o => o.user_id ?? null, model_id: o => o.model_id ?? null, created_at: o => o.created_at ?? 0 }
};

function collection(table) {
  const cols = Object.keys(MIRROR[table]);
  const mirror = MIRROR[table];
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

  const api = {
    all: () => allStmt.all().map(r => JSON.parse(r.data)),
    filter: fn => allStmt.all().map(r => JSON.parse(r.data)).filter(fn),
    find: fn => allStmt.all().map(r => JSON.parse(r.data)).find(fn),
    byId: id => parse(getStmt.get(id)),
    insert: obj => { insStmt.run(obj.id, ...rowVals(obj)); return obj; },
    update: (id, patch) => {
      const cur = parse(getStmt.get(id));
      if (!cur) return undefined;
      Object.assign(cur, patch);
      updStmt.run(...rowVals(cur), id);
      return cur;
    },
    remove: fn => {
      const rows = allStmt.all().map(r => JSON.parse(r.data)).filter(fn);
      const tx = sdb.transaction(list => { for (const r of list) delStmt.run(r.id); });
      tx(rows);
    },
    count: fn => fn ? api.filter(fn).length : cntStmt.get().n
  };
  return api;
}

const messagesCol = collection('messages');
const byChatStmt = sdb.prepare('SELECT data FROM messages WHERE chat_id=? ORDER BY created_at');
messagesCol.byChat = chatId => byChatStmt.all(chatId).map(r => JSON.parse(r.data));

const chatsCol = collection('chats');
const byUserStmt = sdb.prepare('SELECT data FROM chats WHERE user_id=?');
chatsCol.byUser = userId => byUserStmt.all(userId).map(r => JSON.parse(r.data));

const usageCol = collection('usage');
const usageByUserStmt = sdb.prepare('SELECT data FROM usage WHERE user_id=?');
usageCol.byUser = userId => usageByUserStmt.all(userId).map(r => JSON.parse(r.data));

export const db = {
  users: collection('users'),
  chats: chatsCol,
  messages: messagesCol,
  models: collection('models'),
  folders: collection('folders'),
  usage: usageCol
};

const sGet = sdb.prepare('SELECT value FROM settings WHERE key=?');
const sSet = sdb.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

export function getSetting(key, fallback = null) {
  const r = sGet.get(key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}
export function setSetting(key, value) { sSet.run(key, JSON.stringify(value)); }

function checkpoint() { try { sdb.pragma('wal_checkpoint(TRUNCATE)'); } catch {} }
process.on('exit', checkpoint);
process.on('SIGINT', () => { checkpoint(); process.exit(0); });
process.on('SIGTERM', () => { checkpoint(); process.exit(0); });

if (!getSetting('seeded')) {
  setSetting('api_base_url', 'http://localhost:1234/v1');
  setSetting('api_key', 'lm-studio');
  const pid = uid();
  setSetting('providers', [{ id: pid, name: 'LM Studio', type: 'lmstudio', base_url: 'http://localhost:1234/v1', api_key: 'lm-studio' }]);
  db.models.insert({
    id: uid(), display_name: 'Quillku 1', description: 'Fastest for quick answers',
    internal_name: 'local-model', system_prompt: 'You are a helpful assistant.', provider_id: pid,
    has_reasoning: 0, reasoning_token: '', non_reasoning_token: '',
    in_more_models: 0, more_models_label: 'More models',
    static_icon: '', generating_icon: '', thinking_icon: '', icon_position: 'below', sort_order: 0, enabled: 1
  });
  setSetting('seeded', '1');
}

export default db;
