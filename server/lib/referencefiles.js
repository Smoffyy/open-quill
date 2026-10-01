import fs from 'fs';
import path from 'path';
import { getSetting, setSetting } from '../db.js';
import { dataPath } from './dataroot.js';
import { looksTextual, extractDocument, isRtf } from './extract.js';


export const MEMBANK_ROOT = dataPath('membank');
const CACHE_DIR = path.join(MEMBANK_ROOT, '.extracted');
const LEGACY_CACHE_DIR = path.join(MEMBANK_ROOT, '.cache');
const RESERVED = new Set([path.basename(CACHE_DIR), path.basename(LEGACY_CACHE_DIR)]);
fs.mkdirSync(CACHE_DIR, { recursive: true });
try { fs.rmSync(LEGACY_CACHE_DIR, { recursive: true, force: true }); } catch {}

const TEXT_CAP = 200000;
const HEAD_BYTES = 4096;

function safe(name) {
  const base = path.basename(String(name || ''));
  if (!base || base === '.' || base === '..' || RESERVED.has(base)) return null;
  const p = path.join(MEMBANK_ROOT, base);
  if (!p.startsWith(MEMBANK_ROOT + path.sep)) return null;
  return { base, p };
}
function ext(name) { return path.extname(name).toLowerCase(); }
function cachePathFor(base) { return path.join(CACHE_DIR, base + '.txt'); }

const rawTextCache = new Map();
function rawIsText(p) {
  let st;
  try { st = fs.statSync(p); } catch { return false; }
  if (!st.size) return true;
  const key = p + ':' + st.mtimeMs + ':' + st.size;
  const hit = rawTextCache.get(key);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    const fd = fs.openSync(p, 'r');
    const head = Buffer.alloc(Math.min(HEAD_BYTES, st.size));
    try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
    ok = looksTextual(head) && !isRtf(head);
  } catch {}
  rawTextCache.set(key, ok);
  if (rawTextCache.size > 500) rawTextCache.delete(rawTextCache.keys().next().value);
  return ok;
}

async function buildCache(base) {
  const s = safe(base);
  if (!s) return null;
  let buffer; try { buffer = fs.readFileSync(s.p); } catch { return null; }
  let text = '';
  try { text = await extractDocument(buffer, s.base); }
  catch (e) { console.warn('[reference files] could not extract text from', s.base, '-', e?.message || e); }
  try { fs.writeFileSync(cachePathFor(s.base), text); } catch {}
  return text;
}
function cacheFresh(base) {
  const s = safe(base); if (!s) return false;
  try {
    const src = fs.statSync(s.p), cc = fs.statSync(cachePathFor(s.base));
    return cc.mtimeMs >= src.mtimeMs;
  } catch { return false; }
}

function sourceOf(base) {
  const s = safe(base); if (!s) return null;
  if (rawIsText(s.p)) return s.p;
  const c = cachePathFor(s.base);
  try { return cacheFresh(base) && fs.statSync(c).size > 0 ? c : null; } catch { return null; }
}
function isReadable(base) { return !!sourceOf(base); }

export async function ensureIndexedAll() {
  for (const f of rawList()) {
    const s = safe(f.name);
    if (s && !rawIsText(s.p) && !cacheFresh(f.name)) { try { await buildCache(f.name); } catch {} }
  }
}

function readableTextSync(base) {
  const src = sourceOf(base);
  if (!src) return null;
  try { return fs.readFileSync(src, 'utf8'); } catch { return null; }
}

const lineCache = new Map();
function countLines(base) {
  const src = sourceOf(base);
  if (!src) return 0;
  let stamp;
  try { const st = fs.statSync(src); stamp = st.mtimeMs + ':' + st.size; } catch { return 0; }
  const hit = lineCache.get(src);
  if (hit && hit.stamp === stamp) return hit.lines;
  const t = readableTextSync(base);
  const lines = t == null ? 0 : (t.length ? t.split('\n').length : 0);
  lineCache.set(src, { stamp, lines });
  if (lineCache.size > 500) lineCache.delete(lineCache.keys().next().value);
  return lines;
}


function rawList() {
  let names;
  try { names = fs.readdirSync(MEMBANK_ROOT); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (RESERVED.has(n)) continue;
    let st; try { st = fs.statSync(path.join(MEMBANK_ROOT, n)); } catch { continue; }
    if (!st.isFile()) continue;
    out.push({ name: n, size: st.size });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
function getMeta() { try { return getSetting('membank_meta', {}) || {}; } catch { return {}; } }
function setMeta(m) { try { setSetting('membank_meta', m || {}); } catch {} }

export function count() { return rawList().length; }

export function list() {
  const meta = getMeta();
  const files = rawList().map((f, i) => {
    const m = meta[f.name] || {};
    return { name: f.name, size: f.size, lines: countLines(f.name), readable: isReadable(f.name), folder: m.folder || '', order: Number.isFinite(m.order) ? m.order : i };
  });
  files.sort((a, b) => (a.folder || '').localeCompare(b.folder || '') || a.order - b.order || a.name.localeCompare(b.name));
  return files;
}

export function setFileMeta(name, patch) {
  const s = safe(name); if (!s) return { ok: false, error: 'Invalid file name.' };
  const meta = getMeta();
  const cur = meta[s.base] || {};
  if ('folder' in patch) cur.folder = String(patch.folder || '').trim().slice(0, 60);
  if ('order' in patch) cur.order = parseInt(patch.order) || 0;
  meta[s.base] = cur; setMeta(meta);
  return { ok: true };
}

export function reorder(items) {
  if (!Array.isArray(items)) return { ok: false, error: 'Invalid payload.' };
  const meta = getMeta();
  const present = new Set(rawList().map(f => f.name));
  items.forEach((it, i) => {
    const name = path.basename(String(it.name || ''));
    if (!present.has(name)) return;
    meta[name] = { folder: String(it.folder || '').trim().slice(0, 60), order: i };
  });
  setMeta(meta);
  return { ok: true, files: list() };
}

export async function saveUpload(originalName, buffer) {
  const s = safe(originalName);
  if (!s) throw new Error('Invalid file name.');
  fs.writeFileSync(s.p, buffer);
  if (!rawIsText(s.p)) { try { await buildCache(s.base); } catch {} }
  return { name: s.base, size: buffer.length, lines: countLines(s.base), readable: isReadable(s.base) };
}
export function remove(name) {
  const s = safe(name);
  if (!s) return false;
  try { fs.unlinkSync(s.p); } catch {}
  try { fs.unlinkSync(cachePathFor(s.base)); } catch {}
  const meta = getMeta(); if (meta[s.base]) { delete meta[s.base]; setMeta(meta); }
  return true;
}
export function rename(oldName, newName) {
  const a = safe(oldName), b = safe(newName);
  if (!a || !b) return { ok: false, error: 'Invalid file name.' };
  if (a.base === b.base) return { ok: true, name: b.base };
  if (!fs.existsSync(a.p)) return { ok: false, error: 'File not found.' };
  if (fs.existsSync(b.p)) return { ok: false, error: 'A file with that name already exists.' };
  try { fs.renameSync(a.p, b.p); } catch (e) { return { ok: false, error: e.message }; }
  try {
    const oc = cachePathFor(a.base);
    if (fs.existsSync(oc)) {
      if (ext(a.base) === ext(b.base)) fs.renameSync(oc, cachePathFor(b.base));
      else fs.unlinkSync(oc);
    }
  } catch {}
  const meta = getMeta(); if (meta[a.base]) { meta[b.base] = meta[a.base]; delete meta[a.base]; setMeta(meta); }
  return { ok: true, name: b.base };
}

export function filesText() {
  let p = '';
  let curFolder = null;
  for (const f of list()) {
    if ((f.folder || '') !== curFolder) { curFolder = f.folder || ''; if (curFolder) p += `[${curFolder}]\n`; }
    p += `- ${f.name}${f.readable ? ` (${f.lines} lines, ${f.size} bytes)` : ` (${f.size} bytes, not readable as text)`}\n`;
  }
  return p.trimEnd();
}

export function execTool(call) {
  if (call.tool === 'mb_view') {
    const s = safe(call.path);
    if (!s) return { ok: false, error: `No memory bank file named "${call.path}".` };
    if (!isReadable(call.path)) return { ok: false, error: `"${call.path}" has no readable text (it may be an image-only, password protected or unsupported file).` };
    const text = readableTextSync(call.path);
    if (text == null) return { ok: false, error: `Could not read "${call.path}". It may still be indexing, try again.` };
    const lines = text.split('\n');
    const start = Number.isInteger(call.start) ? call.start : null;
    const end = Number.isInteger(call.end) ? call.end : null;
    let body, from = 1;
    if (start != null || end != null) {
      const sN = Math.max(1, start || 1);
      const eN = Math.min(lines.length, end || lines.length);
      from = sN;
      body = lines.slice(sN - 1, eN).map((l, i) => `${sN + i}\t${l}`).join('\n');
    } else {
      body = lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
    }
    if (body.length > TEXT_CAP) body = body.slice(0, TEXT_CAP) + '\n... [truncated; request a smaller line range]';
    return { ok: true, path: call.path, from, total: lines.length, content: body };
  }
  if (call.tool === 'mb_search') {
    const q = String(call.query || '').trim();
    if (!q) return { ok: false, error: 'Empty query.' };
    const needle = q.toLowerCase();
    const matches = [];
    for (const f of rawList()) {
      if (!isReadable(f.name)) continue;
      const text = readableTextSync(f.name);
      if (text == null) continue;
      const ls = text.split('\n');
      for (let i = 0; i < ls.length; i++) {
        if (ls[i].toLowerCase().includes(needle)) {
          matches.push({ path: f.name, line: i + 1, text: ls[i].slice(0, 240) });
          if (matches.length >= 60) break;
        }
      }
      if (matches.length >= 60) break;
    }
    return { ok: true, query: q, count: matches.length, matches };
  }
  return { ok: false, error: 'Unknown memory bank tool.' };
}

export function formatResult(call, r) {
  if (!r.ok) return `${call.tool}${call.path ? ' ' + call.path : ''} → ERROR: ${r.error}`;
  if (call.tool === 'mb_view') return `mb_view ${call.path} →\n${r.content}`;
  return `mb_search "${call.query}" → ${r.count} match(es)` + (r.matches.length ? '\n' + r.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') : '');
}
export function resultPayload(call, r) {
  const o = { ok: !!r.ok };
  if (r.error) o.error = r.error;
  if (r.path != null) o.path = r.path;
  if (r.from != null) o.from = r.from;
  if (r.total != null) o.total = r.total;
  if (r.count != null) o.count = r.count;
  if (call.tool === 'mb_search' && Array.isArray(r.matches)) o.matches = r.matches.slice(0, 40);
  return o;
}
