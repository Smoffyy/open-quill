import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { META_DIR, safeId } from './paths.js';


function metaPath(chatId) { return path.join(META_DIR, safeId(chatId) + '.json'); }

const META_CACHE_MAX = 32;
const HISTORY_KEEP = 50;
const HIST_NAME_MAX = 200;
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
  return bumpVersions(chatId, [rel]).get(rel);
}
function bumpVersions(chatId, rels) {
  const m = readMeta(chatId);
  if (!m.files) m.files = {};
  const at = Date.now();
  const out = new Map();
  for (const rel of rels) {
    const v = (m.files[rel]?.v || 0) + 1;
    m.files[rel] = { v, at };
    out.set(rel, v);
  }
  if (out.size) writeMeta(chatId, m);
  return out;
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
function histDir(chatId, rel) {
  const name = Buffer.from(rel).toString('base64url');
  return path.join(histRoot(chatId), name.length > HIST_NAME_MAX ? 'h-' + crypto.createHash('sha256').update(rel).digest('hex') : name);
}
function saveSnapshot(chatId, rel, v, content) {
  try {
    const d = histDir(chatId, rel);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'v' + v), content ?? '', 'utf8');
    if (v > HISTORY_KEEP) {
      for (const f of fs.readdirSync(d)) {
        const n = /^v(\d+)$/.exec(f);
        if (n && Number(n[1]) <= v - HISTORY_KEEP) fs.rmSync(path.join(d, f), { force: true });
      }
    }
  } catch {}
}
export function listVersions(chatId, rel) { try { return fs.readdirSync(histDir(chatId, rel)).filter(f => /^v\d+$/.test(f)).map(f => parseInt(f.slice(1))).sort((a, b) => a - b); } catch { return []; } }
export function readVersion(chatId, rel, v) { try { return fs.readFileSync(path.join(histDir(chatId, rel), 'v' + v), 'utf8'); } catch { return null; } }

export { metaPath, saveSnapshot, bumpVersion, bumpVersions, dropVersion, moveVersion, getCwd, setCwd, forgetMeta, readMeta, writeMeta, histRoot };