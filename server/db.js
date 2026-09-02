import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { DATA_ROOT, dataPath } from './lib/dataroot.js';
import { migrate } from './db/schema.js';
import { makeCollection, bumpTable } from './db/collection.js';
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

migrate(sdb);

const collection = (table) => makeCollection(sdb, table);

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
const USAGE_SUMS = `
  COUNT(*) AS count,
  COALESCE(SUM(json_extract(data,'$.prompt')), 0) AS prompt,
  COALESCE(SUM(json_extract(data,'$.completion')), 0) AS completion,
  COALESCE(SUM(json_extract(data,'$.cost')), 0) AS cost`;
const usageTotalsStmt = sdb.prepare(`
  SELECT ${USAGE_SUMS}, COUNT(DISTINCT COALESCE(user_id, 'unknown')) AS users
  FROM usage WHERE created_at >= ?`);
const usageByUserAggStmt = sdb.prepare(`
  SELECT user_id, ${USAGE_SUMS}
  FROM usage WHERE created_at >= ? GROUP BY user_id`);
const usageByModelAggStmt = sdb.prepare(`
  SELECT model_id, ${USAGE_SUMS},
    MAX(json_extract(data,'$.model_name')) AS model_name
  FROM usage WHERE created_at >= ? GROUP BY model_id`);
const usageByDayAggStmt = sdb.prepare(`
  SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, ${USAGE_SUMS}
  FROM usage WHERE created_at >= ? GROUP BY day ORDER BY day`);
usageCol.report = (since) => {
  const from = since || 0;
  const t = usageTotalsStmt.get(from) || {};
  const num = (v) => Number(v) || 0;
  return {
    totals: { count: num(t.count), prompt: num(t.prompt), completion: num(t.completion), cost: num(t.cost), users: num(t.users) },
    byUser: usageByUserAggStmt.all(from).map(r => ({ userId: r.user_id || 'unknown', count: num(r.count), prompt: num(r.prompt), completion: num(r.completion), cost: num(r.cost) })),
    byModel: usageByModelAggStmt.all(from).map(r => ({ modelId: r.model_id || 'unknown', name: r.model_name || '', count: num(r.count), prompt: num(r.prompt), completion: num(r.completion), cost: num(r.cost) })),
    byDay: usageByDayAggStmt.all(from).map(r => ({ day: r.day, prompt: num(r.prompt), completion: num(r.completion), cost: num(r.cost) }))
  };
};
usageCol.spendSinceByUser = (since) => {
  const out = new Map();
  try { for (const r of usageSpendAllStmt.all(since)) out.set(r.user_id, Number(r.cost) || 0); } catch {}
  return out;
};

const spacesCol = collection('spaces');
const spacesByMemberStmt = sdb.prepare(`
  SELECT DISTINCT s.data AS data, s.updated_at AS updated_at
  FROM spaces s, json_each(json_extract(s.data,'$.members')) m
  WHERE json_type(s.data,'$.members') = 'array'
    AND json_extract(m.value,'$.userId') IS ?
  ORDER BY s.updated_at DESC`);
spacesCol.byMember = userId =>
  spacesByMemberStmt.all(userId ?? null).map(r => JSON.parse(r.data));

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
  spaces: spacesCol,
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
  setSetting('api_base_url', 'http://localhost:9931');
  setSetting('api_key', '');
  const pid = uid();
  setSetting('providers', [{ id: pid, name: 'llama.cpp', type: 'llamacpp', base_url: 'http://localhost:9931', api_key: '' }]);
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
