import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SANDBOX_ROOT = path.join(__dirname, 'sandbox');
const META_DIR = path.join(SANDBOX_ROOT, '.meta');
function metaPath(chatId) { return path.join(META_DIR, String(chatId).replace(/[^a-zA-Z0-9_-]/g, '') + '.json'); }
function readMeta(chatId) { try { return JSON.parse(fs.readFileSync(metaPath(chatId), 'utf8')); } catch { return {}; } }
function writeMeta(chatId, m) { try { fs.mkdirSync(META_DIR, { recursive: true }); fs.writeFileSync(metaPath(chatId), JSON.stringify(m)); } catch {} }
export function versionOf(chatId, rel) { return readMeta(chatId)[rel]?.v || 1; }
function bumpVersion(chatId, rel) { const m = readMeta(chatId); m[rel] = { v: (m[rel]?.v || 0) + 1, at: Date.now() }; writeMeta(chatId, m); }
function dropVersion(chatId, rel) { const m = readMeta(chatId); delete m[rel]; writeMeta(chatId, m); try { fs.rmSync(histDir(chatId, rel), { recursive: true, force: true }); } catch {} }
function histRoot(chatId) { return path.join(META_DIR, String(chatId).replace(/[^a-zA-Z0-9_-]/g, '') + '.hist'); }
function histDir(chatId, rel) { return path.join(histRoot(chatId), Buffer.from(rel).toString('base64url')); }
function saveSnapshot(chatId, rel, v, content) { try { const d = histDir(chatId, rel); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'v' + v), content ?? '', 'utf8'); } catch {} }
export function listVersions(chatId, rel) { try { return fs.readdirSync(histDir(chatId, rel)).filter(f => /^v\d+$/.test(f)).map(f => parseInt(f.slice(1))).sort((a, b) => a - b); } catch { return []; } }
export function readVersion(chatId, rel, v) { try { return fs.readFileSync(path.join(histDir(chatId, rel), 'v' + v), 'utf8'); } catch { return null; } }
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'js', 'jsx', 'ts', 'tsx', 'py', 'lua', 'html', 'htm', 'css', 'scss', 'xml', 'yml', 'yaml', 'sh', 'bash', 'c', 'cpp', 'h', 'hpp', 'java', 'rb', 'go', 'rs', 'php', 'sql', 'ini', 'cfg', 'toml', 'log', 'glsl', 'vert', 'frag', 'svg', 'gitignore', 'env', 'kt', 'swift', 'dart', 'r', 'm', 'vue', 'svelte' ]);

export function dirFor(chatId) {
  const d = path.join(SANDBOX_ROOT, String(chatId).replace(/[^a-zA-Z0-9_-]/g, ''));
  return d;
}
function resolveSafe(chatId, rel) {
  const root = dirFor(chatId);
  const p = path.resolve(root, rel || '');
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Path escapes sandbox');
  return p;
}
export function extOf(name) { const e = path.extname(name || '').slice(1).toLowerCase(); return e; }
export function isText(name) { return TEXT_EXT.has(extOf(name)); }

export function list(chatId) {
  const root = dirFor(chatId);
  const meta = readMeta(chatId);
  const out = [];
  const walk = (dir, base) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = base ? base + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else { let size = 0; try { size = fs.statSync(path.join(dir, e.name)).size; } catch {} out.push({ path: rel, ext: extOf(e.name), size, v: meta[rel]?.v || 1 }); }
    }
  };
  walk(root, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
export function remove(chatId) { try { fs.rmSync(dirFor(chatId), { recursive: true, force: true }); } catch {} try { fs.rmSync(metaPath(chatId), { force: true }); } catch {} try { fs.rmSync(histRoot(chatId), { recursive: true, force: true }); } catch {} }

export function createFile(chatId, rel, content) {
  const p = resolveSafe(chatId, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content ?? '', 'utf8');
  bumpVersion(chatId, rel);
  const v = versionOf(chatId, rel);
  if (isText(rel)) saveSnapshot(chatId, rel, v, content ?? '');
  return { ok: true, path: rel, bytes: Buffer.byteLength(content ?? ''), v };
}
export function strReplace(chatId, rel, oldStr, newStr) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `File not found: ${rel}` };
  const text = fs.readFileSync(p, 'utf8');
  const idx = text.indexOf(oldStr ?? '');
  if (idx === -1) return { ok: false, error: 'old_str not found in file' };
  if (text.indexOf(oldStr, idx + 1) !== -1) return { ok: false, error: 'old_str is not unique; include more surrounding context' };
  const next = text.slice(0, idx) + (newStr ?? '') + text.slice(idx + oldStr.length);
  fs.writeFileSync(p, next, 'utf8');
  bumpVersion(chatId, rel);
  const v = versionOf(chatId, rel);
  saveSnapshot(chatId, rel, v, next);
  return { ok: true, path: rel, v };
}
export function view(chatId, rel, start, end) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `File not found: ${rel}` };
  if (!isText(rel)) return { ok: true, path: rel, content: '[binary file]' };
  const all = fs.readFileSync(p, 'utf8').split('\n');
  let s = 1, e = all.length;
  if (Number.isInteger(start)) s = Math.max(1, start);
  if (Number.isInteger(end)) e = Math.min(all.length, end);
  let body = all.slice(s - 1, e).map((l, i) => `${s + i}\t${l}`).join('\n');
  let note = '';
  if (body.length > 8000) { body = body.slice(0, 8000); note = `\n... [truncated at 8000 chars; file has ${all.length} lines total — call view again with start/end to page through it]`; }
  else if (s > 1 || e < all.length) { note = `\n[showing lines ${s}-${e} of ${all.length}]`; }
  return { ok: true, path: rel, content: body + note, lines: all.length };
}
export function deleteFile(chatId, rel) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `File not found: ${rel}` };
  fs.rmSync(p, { recursive: true, force: true });
  dropVersion(chatId, rel);
  return { ok: true, path: rel };
}
export function renameFile(chatId, rel, newRel) {
  const src = resolveSafe(chatId, rel);
  const dst = resolveSafe(chatId, newRel || '');
  if (!fs.existsSync(src)) return { ok: false, error: `File not found: ${rel}` };
  if (!newRel) return { ok: false, error: 'new_path required' };
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  const m = readMeta(chatId);
  if (m[rel]) { m[newRel] = m[rel]; delete m[rel]; writeMeta(chatId, m); }
  try { const a = histDir(chatId, rel), b = histDir(chatId, newRel); if (fs.existsSync(a)) fs.renameSync(a, b); } catch {}
  return { ok: true, path: newRel, from: rel };
}
export function search(chatId, query, filter) {
  if (!query) return { ok: false, error: 'query required' };
  const q = String(query).toLowerCase();
  const out = [];
  for (const f of list(chatId)) {
    if (f.ext === 'zip' || !isText(f.path)) continue;
    if (filter && !f.path.toLowerCase().includes(String(filter).toLowerCase())) continue;
    const txt = readText(chatId, f.path); if (txt == null) continue;
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) { out.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, 200) }); if (out.length >= 80) break; }
    }
    if (out.length >= 80) break;
  }
  return { ok: true, matches: out, count: out.length };
}
export function readBuffer(chatId, rel) { return fs.readFileSync(resolveSafe(chatId, rel)); }
export function readText(chatId, rel) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

// store-only zip writer, no native deps
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export function zipBuffer(entries) { // entries: [{name, data:Buffer}]
  const local = [], central = []; let offset = 0;
  for (const f of entries) {
    const name = Buffer.from(f.name, 'utf8'), data = f.data, crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
export function bundleZip(chatId, name, paths) {
  const all = list(chatId);
  const picked = (paths && paths.length ? paths : all.map(f => f.path)).filter(p => p && !p.endsWith('.zip'));
  const entries = [];
  for (const rel of picked) { try { entries.push({ name: rel, data: readBuffer(chatId, rel) }); } catch {} }
  if (!entries.length) return { ok: false, error: 'No files to bundle' };
  const zipName = (name || 'bundle').replace(/[^a-zA-Z0-9_-]/g, '') + '.zip';
  const p = resolveSafe(chatId, zipName);
  fs.writeFileSync(p, zipBuffer(entries));
  return { ok: true, path: zipName, count: entries.length };
}
export function zipAll(chatId) {
  const entries = list(chatId).filter(f => f.ext !== 'zip').map(f => ({ name: f.path, data: readBuffer(chatId, f.path) }));
  return zipBuffer(entries);
}

// unzip via built-in zlib (handles store + deflate)
function unzipBuffer(buf) {
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('no end-of-central-directory (not a zip?)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data = null;
    try {
      if (method === 0) data = Buffer.from(comp);
      else if (method === 8) data = zlib.inflateRawSync(comp);
    } catch { data = null; }
    if (data && !name.endsWith('/')) out.push({ name, data });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
export function extractZip(chatId, rel, dest) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `File not found: ${rel}` };
  let entries;
  try { entries = unzipBuffer(fs.readFileSync(p)); } catch (e) { return { ok: false, error: 'Could not read zip: ' + e.message }; }
  if (!entries.length) return { ok: false, error: 'Zip is empty or uses an unsupported compression method.' };
  const base = String(dest || '').replace(/^\/+|\/+$/g, '');
  const created = [];
  for (const e of entries) {
    const rel2 = (base ? base + '/' : '') + e.name;
    try {
      const outP = resolveSafe(chatId, rel2);
      fs.mkdirSync(path.dirname(outP), { recursive: true });
      fs.writeFileSync(outP, e.data);
      bumpVersion(chatId, rel2);
      if (isText(rel2)) saveSnapshot(chatId, rel2, versionOf(chatId, rel2), e.data.toString('utf8'));
      created.push(rel2);
    } catch {}
  }
  return { ok: true, path: rel, count: created.length, files: created };
}
export function importBuffer(chatId, destRel, buffer) {
  try {
    const p = resolveSafe(chatId, destRel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buffer);
    bumpVersion(chatId, destRel);
    if (isText(destRel)) saveSnapshot(chatId, destRel, versionOf(chatId, destRel), buffer.toString('utf8'));
    return { ok: true, path: destRel };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

export function execTool(chatId, call) {
  try {
    switch (call.tool) {
      case 'create_file': return createFile(chatId, call.path, call.content);
      case 'str_replace': return strReplace(chatId, call.path, call.old_str, call.new_str);
      case 'view': return view(chatId, call.path, call.start, call.end);
      case 'list_files': return { ok: true, files: list(chatId) };
      case 'delete_file': return deleteFile(chatId, call.path);
      case 'rename_file': return renameFile(chatId, call.path, call.new_path || call.to);
      case 'search': return search(chatId, call.query, call.path);
      case 'extract_zip': return extractZip(chatId, call.path, call.dest);
      case 'bundle_zip': return bundleZip(chatId, call.name, call.paths);
      default: return { ok: false, error: `Unknown tool: ${call.tool}` };
    }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// pull ```tool JSON blocks out of the reply
export function parseToolCalls(text) {
  const calls = [];
  const re = /```tool\b\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1].trim();
    try { const obj = JSON.parse(body); if (obj && obj.tool) calls.push(obj); }
    catch { /* ignore malformed */ }
  }
  return calls;
}
