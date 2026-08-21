import fs from 'fs';
import path from 'path';
import { META_DIR, safeId } from './paths.js';


function metaPath(chatId) { return path.join(META_DIR, safeId(chatId) + '.json'); }

const META_CACHE_MAX = 32;
const metaCache = new Map();
function readMeta(chatId) {
  const key = safeId(chatId);
  const hit = metaCache.get(key);
  if (hit) return hit;
  let m;
  try { m = JSON.parse(fs.readFileSync(metaPath(chatId), 'utf8')); } catch { m = {}; }
  if (!m || typeof m !== 'object') m = {};
  metaCache.set(key, m);
  if (metaCache.size > META_CACHE_MAX) metaCache.delete(metaCache.keys().next().value);
  return m;
}
function writeMeta(chatId, m) {
  const key = safeId(chatId);
  metaCache.delete(key);
  metaCache.set(key, m);
  try { fs.mkdirSync(META_DIR, { recursive: true }); fs.writeFileSync(metaPath(chatId), JSON.stringify(m)); } catch {}
}
function forgetMeta(chatId) { metaCache.delete(safeId(chatId)); }

export function versionOf(chatId, rel) { return readMeta(chatId).files?.[rel]?.v || 1; }
function bumpVersion(chatId, rel) {
  const m = readMeta(chatId);
  if (!m.files) m.files = {};
  const v = (m.files[rel]?.v || 0) + 1;
  m.files[rel] = { v, at: Date.now() };
  writeMeta(chatId, m);
  return v;
}
function dropVersion(chatId, rel) {
  const m = readMeta(chatId);
  if (m.files) delete m.files[rel];
  writeMeta(chatId, m);
  try { fs.rmSync(histDir(chatId, rel), { recursive: true, force: true }); } catch {}
}
function moveVersion(chatId, from, to) {
  const m = readMeta(chatId);
  if (m.files && m.files[from]) { m.files[to] = m.files[from]; delete m.files[from]; writeMeta(chatId, m); }
  try { const a = histDir(chatId, from), b = histDir(chatId, to); if (fs.existsSync(a)) fs.renameSync(a, b); } catch {}
}
function getCwd(chatId) { const c = readMeta(chatId).cwd; return typeof c === 'string' ? c : ''; }
function setCwd(chatId, rel) { const m = readMeta(chatId); m.cwd = rel || ''; writeMeta(chatId, m); }

function histRoot(chatId) { return path.join(META_DIR, safeId(chatId) + '.hist'); }
function histDir(chatId, rel) { return path.join(histRoot(chatId), Buffer.from(rel).toString('base64url')); }
function saveSnapshot(chatId, rel, v, content) { try { const d = histDir(chatId, rel); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'v' + v), content ?? '', 'utf8'); } catch {} }
export function listVersions(chatId, rel) { try { return fs.readdirSync(histDir(chatId, rel)).filter(f => /^v\d+$/.test(f)).map(f => parseInt(f.slice(1))).sort((a, b) => a - b); } catch { return []; } }
export function readVersion(chatId, rel, v) { try { return fs.readFileSync(path.join(histDir(chatId, rel), 'v' + v), 'utf8'); } catch { return null; } }

export { metaPath, saveSnapshot, bumpVersion, dropVersion, moveVersion, getCwd, setCwd, forgetMeta, readMeta, writeMeta, histRoot };
