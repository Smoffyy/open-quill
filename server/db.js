import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(FILE)) return null;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    const backup = FILE + '.corrupt.' + Date.now();
    try { fs.copyFileSync(FILE, backup); } catch {}
    console.error(`[db] data.json is unreadable (${e.message}). Backed up to ${backup} and starting fresh.`);
    return null;
  }
}
const data = loadData() || { users: [], chats: [], messages: [], models: [], folders: [], settings: {} };
for (const k of ['users', 'chats', 'messages', 'models', 'folders']) data[k] ||= [];
data.settings ||= {};

let saveTimer = null;
function writeNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, FILE);
  } catch (e) { console.error('[db] write failed:', e.message); }
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 80);
}
let flushed = false;
function flushOnExit() { if (flushed) return; flushed = true; if (saveTimer) writeNow(); }
process.on('exit', flushOnExit);
process.on('SIGINT', () => { flushOnExit(); process.exit(0); });
process.on('SIGTERM', () => { flushOnExit(); process.exit(0); });

export const uid = () => crypto.randomUUID();
let lastTs = 0;
export const now = () => { const t = Date.now(); lastTs = t > lastTs ? t : lastTs + 1; return lastTs; };

// generic collection wrapper
function collection(arr) {
  const idx = new Map(arr.map(r => [r.id, r]));
  return {
    all: () => arr.slice(),
    filter: (fn) => arr.filter(fn),
    find: (fn) => arr.find(fn),
    byId: (id) => idx.get(id),
    insert: (obj) => { arr.push(obj); idx.set(obj.id, obj); persist(); return obj; },
    update: (id, patch) => { const r = idx.get(id); if (r) { Object.assign(r, patch); persist(); } return r; },
    remove: (fn) => { for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) { idx.delete(arr[i].id); arr.splice(i, 1); } persist(); },
    count: (fn) => fn ? arr.filter(fn).length : arr.length
  };
}

export const db = {
  users: collection(data.users),
  chats: collection(data.chats),
  messages: collection(data.messages),
  models: collection(data.models),
  folders: collection(data.folders)
};

export function getSetting(key, fallback = null) {
  return key in data.settings ? data.settings[key] : fallback;
}
export function setSetting(key, value) { data.settings[key] = value; persist(); }

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

if (!getSetting('providers_migrated')) {
  if (!Array.isArray(getSetting('providers', null))) {
    const pid = uid();
    setSetting('providers', [{ id: pid, name: 'Default', type: 'lmstudio', base_url: getSetting('api_base_url') || 'http://localhost:1234/v1', api_key: getSetting('api_key') || '' }]);
    for (const m of db.models.all()) if (!m.provider_id) db.models.update(m.id, { provider_id: pid });
  }
  setSetting('providers_migrated', '1');
}

// one-time: rename the original default model on existing installs
if (!getSetting('renamed_default')) {
  const old = db.models.find(m => m.display_name === 'Haiku 4.5' && m.internal_name === 'local-model');
  if (old) db.models.update(old.id, { display_name: 'Quillku 1' });
  setSetting('renamed_default', '1');
}

// one-time: mark the earliest user as the permanent top admin (owner)
if (db.users.count() > 0 && !db.users.find(u => u.is_owner)) {
  const first = db.users.all().sort((a, b) => a.created_at - b.created_at)[0];
  if (first) db.users.update(first.id, { is_owner: 1, is_admin: 1 });
}

export default db;
