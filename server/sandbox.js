import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { spawn, spawnSync } from 'child_process';
import { dataPath } from './lib/dataroot.js';
import { screenCommand, normalizeRel } from './lib/sandboxguard.js';
import { SANDBOX_TOOLS, resolveToolName, nearestTool } from './tools/aliases.js';

export { screenCommand, normalizeRel } from './lib/sandboxguard.js';

export const SANDBOX_ROOT = dataPath('sandbox');
const META_DIR = path.join(SANDBOX_ROOT, '.meta');

const safeId = (chatId) => String(chatId).replace(/[^a-zA-Z0-9_-]/g, '');
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

const TEXT_EXT = new Set(['txt', 'text', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'json5', 'jsonc', 'ndjson', 'js', 'cjs', 'mjs', 'jsx', 'ts', 'cts', 'mts', 'tsx', 'py', 'pyi', 'pyw', 'rb', 'lua', 'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl', 'xml', 'yml', 'yaml', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'hh', 'java', 'kt', 'kts', 'go', 'rs', 'php', 'sql', 'ini', 'cfg', 'conf', 'toml', 'properties', 'log', 'glsl', 'vert', 'frag', 'comp', 'wgsl', 'svg', 'gitignore', 'dockerignore', 'npmignore', 'editorconfig', 'env', 'swift', 'dart', 'r', 'jl', 'ex', 'exs', 'erl', 'hs', 'elm', 'clj', 'cljs', 'scala', 'groovy', 'gradle', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'proto', 'tf', 'tfvars', 'hcl', 'ipynb', 'm', 'mm', 'nim', 'zig', 'v', 'sol', 'cmake', 'lock', 'diff', 'patch']);
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' };

export function extOf(name) { return path.extname(name || '').slice(1).toLowerCase(); }
function baseLower(name) { return path.basename(String(name || '')).toLowerCase(); }
export function isText(name) {
  const b = baseLower(name);
  if (b === 'makefile' || b === 'dockerfile' || b === 'cmakelists.txt' || b.startsWith('.env') || b === 'license' || b === 'readme') return true;
  return TEXT_EXT.has(extOf(name));
}

export const IGNORED_DIRS = new Set([
  'node_modules', 'bower_components', 'jspm_packages', '.pnpm-store', '.yarn', '.npm',
  '.git', '.hg', '.svn', '.bzr',
  '__pycache__', '.venv', 'venv', 'env', 'virtualenv', '.tox', '.nox', '.eggs', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'site-packages', '.ipynb_checkpoints',
  'target', '.gradle', 'build', 'dist', 'out', 'bin', 'obj', 'Debug', 'Release',
  '.next', '.nuxt', '.svelte-kit', '.astro', '.turbo', '.parcel-cache', '.cache', '.vite', '.angular', '.output',
  'vendor', 'Pods', 'Carthage', 'DerivedData', '.swiftpm',
  '.dart_tool', '.pub-cache',
  'coverage', '.nyc_output',
  '.idea', '.vscode', '.vs',
  '.terraform', '.serverless',
  '.stack-work', 'dist-newstyle', '_build', 'deps'
]);

export function isIgnoredDir(name) {
  if (IGNORED_DIRS.has(name)) return true;
  return name.endsWith('.egg-info') || name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace') || /^cmake-build-/.test(name);
}

const gitignoreCache = new Map();
function gitignoreMatchers(chatId) {
  const gi = path.join(dirFor(chatId), '.gitignore');
  let mtime = 0;
  try { mtime = fs.statSync(gi).mtimeMs; } catch { mtime = 0; }
  const cached = gitignoreCache.get(chatId);
  if (cached && cached.mtime === mtime) return cached.m;
  const m = { names: new Set(), globs: [], negNames: new Set() };
  if (mtime) {
    let lines = [];
    try { lines = fs.readFileSync(gi, 'utf8').split(/\r?\n/); } catch {}
    for (let raw of lines) {
      let line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const neg = line.startsWith('!');
      if (neg) line = line.slice(1).trim();
      line = line.replace(/\/+$/, '').replace(/^\/+/, '');
      if (!line) continue;
      if (line.includes('/') || line.includes('**')) { if (!neg) m.globs.push(globToRe(line)); continue; }
      if (line.includes('*') || line.includes('?')) { if (neg) m.negNames.add(line); else m.globs.push(globToReBase(line)); continue; }
      if (neg) m.negNames.add(line); else m.names.add(line);
    }
  }
  gitignoreCache.set(chatId, { mtime, m });
  return m;
}

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') { if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else if ('\\^$+.()|{}[]'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '(?:/.*)?$');
}
function globToReBase(glob) {
  let re = '';
  for (const c of glob) {
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if ('\\^$+.()|{}[]'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return { base: new RegExp('^' + re + '$') };
}

export function isIgnoredRel(chatId, rel) {
  const parts = String(rel || '').split('/').filter(Boolean);
  if (!parts.length) return false;
  for (let i = 0; i < parts.length - 1; i++) if (isIgnoredDir(parts[i])) return true;
  const gi = gitignoreMatchers(chatId);
  const base = parts[parts.length - 1];
  if (gi.negNames.has(base)) return false;
  for (const seg of parts) if (gi.names.has(seg)) return true;
  for (const g of gi.globs) { if (g.base) { if (g.base.test(base)) return true; } else if (g.test(rel)) return true; }
  return false;
}
export function isIgnoredPath(rel) { return String(rel || '').split('/').slice(0, -1).some(isIgnoredDir); }

export function dirFor(chatId) { return path.join(SANDBOX_ROOT, safeId(chatId)); }
function resolveSafe(chatId, rel) {
  const root = dirFor(chatId);
  const norm = normalizeRel(rel, { allowEmpty: true });
  if (!norm.ok) throw new Error(norm.error);
  const p = path.resolve(root, norm.rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('That path leaves the workspace root. Use a path relative to the workspace, such as "src/app.py".');
  return p;
}
function relOf(chatId, abs) { return path.relative(dirFor(chatId), abs).split(path.sep).join('/'); }

function walkFiles(chatId, { includeIgnored = false, under = '' } = {}) {
  const root = dirFor(chatId);
  const start = under ? resolveSafe(chatId, under) : root;
  const out = [];
  const rels = [];
  let hidden = 0;
  const stack = [[start, under ? relOf(chatId, start) : '']];
  while (stack.length) {
    const [dir, prefix] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!includeIgnored && (isIgnoredDir(e.name) || isIgnoredRel(chatId, rel))) { hidden += countUnder(abs); continue; }
        stack.push([abs, rel]);
      } else {
        if (!includeIgnored && isIgnoredRel(chatId, rel)) { hidden++; continue; }
        out.push(abs);
        rels.push(rel);
      }
    }
  }
  return { files: out, rels, hidden };
}
function countUnder(dir) {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) { if (e.isDirectory()) stack.push(path.join(cur, e.name)); else n++; }
  }
  return n;
}

export function list(chatId, opts = {}) {
  const includeIgnored = !!(opts.includeIgnored || opts.all);
  const meta = readMeta(chatId).files || {};
  const { files, rels, hidden } = walkFiles(chatId, { includeIgnored, under: opts.under });
  const out = new Array(files.length);
  for (let i = 0; i < files.length; i++) {
    const rel = rels[i];
    let size = 0; try { size = fs.statSync(files[i]).size; } catch {}
    out[i] = { path: rel, ext: extOf(rel), size, v: meta[rel]?.v || 1 };
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return opts.withHidden ? { files: out, hidden } : out;
}

export function dirSize(chatId) {
  let total = 0;
  for (const abs of walkFiles(chatId, { includeIgnored: true }).files) { try { total += fs.statSync(abs).size; } catch {} }
  return total;
}
function capError(maxBytes) { return { ok: false, error: `Sandbox storage limit reached (${Math.round(maxBytes / 1048576)} MB). Delete files to free space.` }; }
function overCap(chatId, incomingBytes, maxBytes) { if (!maxBytes || maxBytes <= 0) return false; return dirSize(chatId) + incomingBytes > maxBytes; }

export function remove(chatId) {
  try { fs.rmSync(dirFor(chatId), { recursive: true, force: true }); } catch {}
  try { fs.rmSync(metaPath(chatId), { force: true }); } catch {}
  try { fs.rmSync(histRoot(chatId), { recursive: true, force: true }); } catch {}
  forgetMeta(chatId);
  gitignoreCache.delete(chatId);
}
export function clearAll(chatId) {
  const root = dirFor(chatId);
  let cleared = 0;
  try { for (const e of fs.readdirSync(root)) { fs.rmSync(path.join(root, e), { recursive: true, force: true }); cleared++; } } catch {}
  try { fs.rmSync(metaPath(chatId), { force: true }); } catch {}
  try { fs.rmSync(histRoot(chatId), { recursive: true, force: true }); } catch {}
  forgetMeta(chatId);
  gitignoreCache.delete(chatId);
  return { ok: true, cleared };
}

function lineDelta(prev, next) {
  const na = next == null ? [] : String(next).split('\n');
  if (prev == null) return { adds: (na.length === 1 && na[0] === '') ? 0 : na.length, dels: 0 };
  const pa = String(prev).split('\n');
  const count = new Map();
  for (const l of pa) count.set(l, (count.get(l) || 0) - 1);
  for (const l of na) count.set(l, (count.get(l) || 0) + 1);
  let adds = 0, dels = 0;
  for (const v of count.values()) { if (v > 0) adds += v; else if (v < 0) dels += -v; }
  return { adds, dels };
}

export function readText(chatId, rel) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return null;
  return fs.readFileSync(p, 'utf8');
}
export function readBuffer(chatId, rel) { return fs.readFileSync(resolveSafe(chatId, rel)); }

export function createFile(chatId, rel, content) {
  const p = resolveSafe(chatId, rel);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return { ok: false, error: `${rel} is a directory` };
  const prev = (fs.existsSync(p) && isText(rel)) ? fs.readFileSync(p, 'utf8') : null;
  const body = content ?? '';
  if (prev != null && prev === body) return { ok: true, path: rel, bytes: Buffer.byteLength(body), v: versionOf(chatId, rel), adds: 0, dels: 0, unchanged: true };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
  const v = bumpVersion(chatId, rel);
  if (isText(rel)) saveSnapshot(chatId, rel, v, body);
  const { adds, dels } = lineDelta(prev, body);
  return { ok: true, path: rel, bytes: Buffer.byteLength(body), v, adds, dels };
}

function countOccurrences(hay, needle) { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; }

export function strReplace(chatId, rel, oldStr, newStr, replaceAll = false) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `File not found: ${rel}. Create it with create_file first.` };
  if (fs.statSync(p).isDirectory()) return { ok: false, error: `${rel} is a directory` };
  if (oldStr == null || oldStr === '') return { ok: false, error: 'old_str is empty; provide the exact text to replace, or use create_file to write a new file.' };
  const repl = newStr ?? '';
  if (oldStr === repl) return { ok: false, error: 'old_str and new_str are identical; nothing to change.' };
  const text = fs.readFileSync(p, 'utf8');
  const hits = countOccurrences(text, oldStr);
  if (hits === 0) return { ok: false, error: 'old_str was not found. View the file and copy the exact text; whitespace and indentation must match.' };
  if (hits > 1 && !replaceAll) return { ok: false, error: `old_str is not unique (${hits} matches). Add surrounding lines to make it unique, or pass replace_all: true to change every occurrence.` };
  const next = replaceAll ? text.split(oldStr).join(repl) : (() => { const i = text.indexOf(oldStr); return text.slice(0, i) + repl + text.slice(i + oldStr.length); })();
  fs.writeFileSync(p, next, 'utf8');
  const v = bumpVersion(chatId, rel);
  saveSnapshot(chatId, rel, v, next);
  const { adds, dels } = lineDelta(text, next);
  return { ok: true, path: rel, v, adds, dels, replaced: replaceAll ? hits : 1 };
}

export function insertLines(chatId, rel, atLine, content) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `File not found: ${rel}` };
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split('\n');
  const insert = String(content ?? '').split('\n');
  const at = Number.isInteger(atLine) ? Math.max(0, Math.min(lines.length, atLine)) : lines.length;
  lines.splice(at, 0, ...insert);
  const next = lines.join('\n');
  fs.writeFileSync(p, next, 'utf8');
  const v = bumpVersion(chatId, rel);
  saveSnapshot(chatId, rel, v, next);
  return { ok: true, path: rel, v, adds: insert.length, dels: 0 };
}

function treeString(chatId, under, includeIgnored, cap = 400) {
  const root = dirFor(chatId);
  const start = under ? resolveSafe(chatId, under) : root;
  const lines = [];
  let shown = 0, hidden = 0;
  const walk = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (shown >= cap) return;
      const abs = path.join(dir, e.name);
      const rel = relOf(chatId, abs);
      if (e.isDirectory()) {
        if (!includeIgnored && (isIgnoredDir(e.name) || isIgnoredRel(chatId, rel))) { hidden++; lines.push(`${prefix}${e.name}/  (ignored)`); continue; }
        lines.push(`${prefix}${e.name}/`); shown++;
        walk(abs, prefix + '  ');
      } else {
        if (!includeIgnored && isIgnoredRel(chatId, rel)) { hidden++; continue; }
        let size = 0; try { size = fs.statSync(abs).size; } catch {}
        lines.push(`${prefix}${e.name}  (${size}b)`); shown++;
      }
    }
  };
  walk(start, '');
  let out = lines.join('\n') || '(empty)';
  if (shown >= cap) out += `\n… (truncated at ${cap} entries; use find or view a subdirectory)`;
  return { text: out, shown, hidden };
}

export function view(chatId, rel, start, end) {
  const p = resolveSafe(chatId, rel || '');
  if (!fs.existsSync(p)) return { ok: false, error: `Not found: ${rel}` };
  if (fs.statSync(p).isDirectory()) {
    const t = treeString(chatId, rel || '', false);
    return { ok: true, path: rel || '.', dir: true, content: t.text, hidden: t.hidden };
  }
  if (!isText(rel)) { let size = 0; try { size = fs.statSync(p).size; } catch {} return { ok: true, path: rel, content: `[binary file, ${size} bytes; not shown as text]`, binary: true }; }
  const all = fs.readFileSync(p, 'utf8').split('\n');
  let s = 1, e = all.length;
  if (Number.isInteger(start)) s = Math.max(1, start);
  if (Number.isInteger(end)) e = Math.min(all.length, end);
  if (s > e) s = e;
  const width = String(e).length;
  let body = all.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(width)}\t${l}`).join('\n');
  let note = '';
  if (body.length > 12000) {
    let cut = body.lastIndexOf('\n', 12000);
    if (cut < 1) cut = 12000;
    body = body.slice(0, cut);
    note = `\n... [truncated; the file has ${all.length} lines, page through it with start/end]`;
  } else if (s > 1 || e < all.length) note = `\n[lines ${s}-${e} of ${all.length}]`;
  return { ok: true, path: rel, content: body + note, lines: all.length };
}

export function deleteFile(chatId, rel) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `Not found: ${rel}` };
  const wasDir = fs.statSync(p).isDirectory();
  if (wasDir) for (const f of list(chatId, { all: true, under: rel })) dropVersion(chatId, f.path);
  fs.rmSync(p, { recursive: true, force: true });
  dropVersion(chatId, rel);
  return { ok: true, path: rel, dir: wasDir };
}

export function renameFile(chatId, rel, newRel) {
  if (!newRel) return { ok: false, error: 'new_path is required' };
  const src = resolveSafe(chatId, rel);
  const dst = resolveSafe(chatId, newRel);
  if (!fs.existsSync(src)) return { ok: false, error: `Not found: ${rel}` };
  const before = fs.statSync(src).isDirectory() ? list(chatId, { all: true, under: rel }).map(f => f.path) : null;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  if (before) for (const oldRel of before) moveVersion(chatId, oldRel, newRel + oldRel.slice(rel.length));
  else moveVersion(chatId, rel, newRel);
  return { ok: true, path: newRel, from: rel };
}

function dirEntrySize(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) total += dirEntrySize(path.join(p, e.name));
  return total;
}
export function copyFile(chatId, rel, newRel, maxBytes = 0) {
  if (!newRel) return { ok: false, error: 'new_path is required' };
  const src = resolveSafe(chatId, rel);
  if (!fs.existsSync(src)) return { ok: false, error: `Not found: ${rel}` };
  const dst = resolveSafe(chatId, newRel);
  let incoming = 0; try { incoming = dirEntrySize(src); } catch {}
  if (overCap(chatId, incoming, maxBytes)) return capError(maxBytes);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
  const created = [];
  const stamp = (r) => { const v = bumpVersion(chatId, r); if (isText(r)) { try { saveSnapshot(chatId, r, v, fs.readFileSync(resolveSafe(chatId, r), 'utf8')); } catch {} } created.push(r); };
  if (fs.statSync(dst).isDirectory()) { for (const f of list(chatId, { all: true })) if (f.path === newRel || f.path.startsWith(newRel + '/')) stamp(f.path); }
  else stamp(newRel);
  return { ok: true, path: newRel, from: rel, count: created.length };
}
export function makeDir(chatId, rel) {
  if (!rel) return { ok: false, error: 'path is required' };
  fs.mkdirSync(resolveSafe(chatId, rel), { recursive: true });
  return { ok: true, path: rel };
}

export function search(chatId, query, filter, useRegex = false) {
  if (!query) return { ok: false, error: 'query is required' };
  let re = null;
  if (useRegex) { try { re = new RegExp(query, 'i'); } catch (e) { return { ok: false, error: 'Invalid regex: ' + e.message }; } }
  const q = String(query).toLowerCase();
  const fre = filter && (filter.includes('*') || filter.includes('/') || filter.includes('?')) ? globToRe(filter) : null;
  const out = [];
  const CAP = 100;
  for (const f of list(chatId)) {
    if (f.ext === 'zip' || !isText(f.path)) continue;
    if (filter) { if (fre ? !fre.test(f.path) : !f.path.toLowerCase().includes(String(filter).toLowerCase())) continue; }
    const txt = readText(chatId, f.path); if (txt == null) continue;
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const hit = re ? re.test(lines[i]) : lines[i].toLowerCase().includes(q);
      if (hit) { out.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, 240) }); if (out.length >= CAP) break; }
    }
    if (out.length >= CAP) break;
  }
  return { ok: true, matches: out, count: out.length, truncated: out.length >= CAP };
}

export function findFiles(chatId, pattern, includeIgnored = false) {
  if (!pattern) return { ok: false, error: 'pattern is required' };
  const clean = String(pattern).replace(/^\.?\/+/, '');
  const re = globToRe(clean);
  const bare = !clean.includes('/') ? globToRe('**/' + clean) : null;
  const matches = [];
  for (const f of list(chatId, { all: includeIgnored })) {
    if (re.test(f.path) || (bare && bare.test(f.path))) matches.push({ path: f.path, size: f.size });
    if (matches.length >= 300) break;
  }
  return { ok: true, pattern, matches, count: matches.length };
}

const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export function zipBuffer(entries) {
  const local = [], central = []; let offset = 0;
  for (const f of entries) {
    const name = Buffer.from(f.name, 'utf8'), data = f.data, crc = crc32(data);
    let comp = data, method = 0;
    if (data.length > 64) { try { const d = zlib.deflateRawSync(data, { level: 6 }); if (d.length < data.length) { comp = d; method = 8; } } catch {} }
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
export function bundleZip(chatId, name, paths, includeIgnored = false) {
  const all = list(chatId, { all: includeIgnored });
  const picked = (paths && paths.length ? paths : all.map(f => f.path)).filter(p => p && !p.endsWith('.zip'));
  const entries = [];
  for (const rel of picked) { try { const abs = resolveSafe(chatId, rel); if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) entries.push({ name: rel, data: fs.readFileSync(abs) }); } catch {} }
  if (!entries.length) return { ok: false, error: 'No files to bundle.' };
  const zipName = (name || 'bundle').replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/\.zip$/i, '') + '.zip';
  fs.writeFileSync(resolveSafe(chatId, zipName), zipBuffer(entries));
  return { ok: true, path: zipName, count: entries.length };
}
export function zipAll(chatId) {
  const entries = list(chatId, { all: true }).filter(f => f.ext !== 'zip').map(f => ({ name: f.path, data: readBuffer(chatId, f.path) }));
  return zipBuffer(entries);
}

function unzipBuffer(buf) {
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
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
    try { if (method === 0) data = Buffer.from(comp); else if (method === 8) data = zlib.inflateRawSync(comp); } catch { data = null; }
    if (data && !name.endsWith('/') && !name.includes('..')) out.push({ name: name.replace(/\\/g, '/'), data });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
export function extractZip(chatId, rel, dest, budget = 0) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `Not found: ${rel}` };
  let entries;
  try { entries = unzipBuffer(fs.readFileSync(p)); } catch (e) { return { ok: false, error: 'Could not read the zip: ' + e.message }; }
  if (!entries.length) return { ok: false, error: 'Zip is empty or uses an unsupported compression method.' };
  const MAX_ENTRIES = 5000, MAX_TOTAL = budget > 0 ? Math.min(budget, 250 * 1024 * 1024) : 250 * 1024 * 1024;
  let total = 0, skipped = 0, deps = 0;
  const base = String(dest || '').replace(/^\/+|\/+$/g, '');
  const created = [];
  for (const e of entries) {
    if (created.length >= MAX_ENTRIES || total + e.data.length > MAX_TOTAL) { skipped++; continue; }
    const rel2 = (base ? base + '/' : '') + e.name;
    const isDep = rel2.split('/').slice(0, -1).some(isIgnoredDir);
    total += e.data.length;
    try {
      const outP = resolveSafe(chatId, rel2);
      fs.mkdirSync(path.dirname(outP), { recursive: true });
      fs.writeFileSync(outP, e.data);
      if (isDep) deps++;
      else { const v = bumpVersion(chatId, rel2); if (isText(rel2)) saveSnapshot(chatId, rel2, v, e.data.toString('utf8')); created.push(rel2); }
    } catch {}
  }
  gitignoreCache.delete(chatId);
  const notes = [];
  if (deps) notes.push(`${deps} file(s) in dependency/build folders extracted but hidden from listings`);
  if (skipped) notes.push(`${skipped} entries skipped (size/count limit)`);
  return { ok: true, path: rel, count: created.length, files: created.slice(0, 200), deps, ...(notes.length ? { note: notes.join('; ') } : {}) };
}
export function importBuffer(chatId, destRel, buffer, maxBytes = 0) {
  if (overCap(chatId, buffer.length, maxBytes)) return capError(maxBytes);
  try {
    const p = resolveSafe(chatId, destRel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buffer);
    const v = bumpVersion(chatId, destRel);
    if (isText(destRel)) saveSnapshot(chatId, destRel, v, buffer.toString('utf8'));
    return { ok: true, path: destRel };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

const OUT_CAP = 20000;
function capOut(s) { s = String(s ?? ''); return s.length > OUT_CAP ? s.slice(0, OUT_CAP) + `\n… [output truncated at ${OUT_CAP} characters]` : s; }

let SHELL_CACHE;
function pickShell() {
  if (SHELL_CACHE !== undefined) return SHELL_CACHE;
  if (process.platform === 'win32') { SHELL_CACHE = process.env.ComSpec || 'cmd.exe'; return SHELL_CACHE; }
  for (const s of ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/bin/sh', '/usr/bin/sh']) { try { if (fs.existsSync(s)) { SHELL_CACHE = s; return s; } } catch {} }
  SHELL_CACHE = '/bin/sh';
  return SHELL_CACHE;
}

function pathDirs() {
  const raw = process.env.PATH || process.env.Path || '';
  return raw.split(path.delimiter).filter(Boolean);
}

let PATH_EXTS = null;
function pathExts() {
  if (PATH_EXTS) return PATH_EXTS;
  if (process.platform !== 'win32') { PATH_EXTS = ['']; return PATH_EXTS; }
  PATH_EXTS = String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase());
  return PATH_EXTS;
}

function whichBin(name) {
  if (name.includes('/') || name.includes('\\')) { try { return fs.existsSync(name) ? name : null; } catch { return null; } }
  for (const dir of pathDirs()) {
    for (const ext of pathExts()) {
      const p = path.join(dir, name + ext);
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}

const RUNTIME_PROBES = [
  { name: 'node', args: ['-v'], label: 'Node.js', run: 'node script.js' },
  { name: 'npm', args: ['-v'], label: 'npm', run: 'npm install <pkg>' },
  { name: 'npx', args: ['-v'], label: 'npx' },
  { name: 'bun', args: ['-v'], label: 'Bun' },
  { name: 'deno', args: ['-V'], label: 'Deno' },
  { name: 'python', args: ['--version'], label: 'Python', run: 'python script.py' },
  { name: 'python3', args: ['--version'], label: 'Python 3', run: 'python3 script.py' },
  { name: 'pip', args: ['--version'], label: 'pip', run: 'pip install <pkg>' },
  { name: 'pip3', args: ['--version'], label: 'pip3' },
  { name: 'git', args: ['--version'], label: 'git' },
  { name: 'gcc', args: ['--version'], label: 'gcc' },
  { name: 'g++', args: ['--version'], label: 'g++' },
  { name: 'clang', args: ['--version'], label: 'clang' },
  { name: 'make', args: ['--version'], label: 'make' },
  { name: 'java', args: ['-version'], label: 'Java' },
  { name: 'javac', args: ['-version'], label: 'javac' },
  { name: 'go', args: ['version'], label: 'Go' },
  { name: 'rustc', args: ['--version'], label: 'Rust' },
  { name: 'cargo', args: ['--version'], label: 'cargo' },
  { name: 'dotnet', args: ['--version'], label: '.NET' },
  { name: 'php', args: ['--version'], label: 'PHP' },
  { name: 'ruby', args: ['--version'], label: 'Ruby' },
  { name: 'perl', args: ['--version'], label: 'Perl' }
];

const UTIL_PROBES = [
  'curl', 'wget', 'tar', 'zip', 'unzip', 'grep', 'sed', 'awk', 'jq',
  'cat', 'ls', 'head', 'tail', 'wc', 'touch', 'which', 'xargs', 'diff', 'patch', 'rsync'
];

const WIN_DIFFERENT = ['find', 'sort', 'more', 'echo'];

function cleanVersion(text) {
  const line = String(text || '').trim().split(/\r?\n/)[0] || '';
  const flat = line.replace(/\s+/g, ' ').trim();
  const m = flat.match(/(\d+(?:\.\d+)+(?:[._-][A-Za-z0-9.]+)?)/);
  if (m) return m[1].slice(0, 32);
  return flat.split(' ').slice(0, 3).join(' ').slice(0, 32);
}

let ENV_CACHE = null;
export function hostEnvInfo() {
  if (ENV_CACHE) return ENV_CACHE;
  const win = process.platform === 'win32';
  const osName = win ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  const shellPath = String(pickShell());
  const shellName = path.basename(shellPath);
  const probe = (bin, args) => {
    const found = whichBin(bin);
    if (!found) return null;
    const opts = { timeout: 8000, windowsHide: true, encoding: 'utf8' };
    try {
      const r = /\.(cmd|bat)$/i.test(found)
        ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${found}" ${args.join(' ')}"`], { ...opts, windowsVerbatimArguments: true })
        : spawnSync(found, args, opts);
      if (r.error) return null;
      const text = cleanVersion(r.stdout || r.stderr || '');
      if (!text || /[\\/]/.test(text)) return 'available';
      return text;
    } catch {}
    return null;
  };

  const runtimes = {};
  const interpreters = [];
  for (const p of RUNTIME_PROBES) {
    const v = probe(p.name, p.args);
    if (!v) continue;
    runtimes[p.name] = v;
    interpreters.push({ name: p.name, label: p.label, version: v, run: p.run || '' });
  }
  const utils = UTIL_PROBES.filter(u => !!whichBin(u));
  const missingUtils = UTIL_PROBES.filter(u => !utils.includes(u));

  const pythonCmd = runtimes.python ? 'python' : runtimes.python3 ? 'python3' : null;
  const pipCmd = runtimes.pip ? 'pip' : runtimes.pip3 ? 'pip3' : null;

  let osVersion = '';
  try { osVersion = `${os.release()}`; } catch {}

  ENV_CACHE = {
    osName,
    osVersion,
    arch: process.arch,
    shellName,
    shellPath,
    shellKind: win ? 'cmd' : 'posix',
    unix: !win,
    pathSep: '/',
    runtimes,
    interpreters,
    utils,
    missingUtils,
    winDifferent: win ? WIN_DIFFERENT : [],
    pythonCmd,
    pipCmd,
    hasNode: !!runtimes.node,
    names: interpreters.map(i => i.name)
  };
  return ENV_CACHE;
}

function missingCommandHint() {
  const env = hostEnvInfo();
  const have = env.interpreters.length ? env.interpreters.map(i => i.name).join(', ') : 'none';
  const parts = [`that program is not installed on this host (${env.osName}, ${env.shellName}).`];
  parts.push(`Commands available here: ${have}.`);
  if (env.utils.length) parts.push(`Utilities on PATH: ${env.utils.join(', ')}.`);
  if (env.missingUtils.length) parts.push(`NOT installed here: ${env.missingUtils.join(', ')}.`);
  if (!env.unix) parts.push('This is cmd.exe, not a Unix shell, so Unix flags such as `-p`, `-rf`, `-r`, `-la` fail even on commands that do exist.');
  if (env.pythonCmd && env.pythonCmd !== 'python3') parts.push(`Use \`${env.pythonCmd}\`, not \`python3\`.`);
  parts.push('For anything file-related use the file tools (view, list_files, find, search, create_file, str_replace, copy_file, move_file, make_dir, delete_file, extract_zip, bundle_zip) — they work identically on every OS. Do not retry the same command.');
  return parts.join(' ');
}

const CWD_MARK = '__OQ_CWD__';
function wrapCommand(base, cmd) {
  if (process.platform === 'win32') {
    return `cd /d "${base}" & ( ${cmd} ) & set "__oq_ec=!errorlevel!" & echo ${CWD_MARK}!CD!& exit /b !__oq_ec!`;
  }
  const quoted = "'" + String(base).replace(/'/g, `'\\''`) + "'";
  return `cd ${quoted} || exit 1\n${cmd}\n__oq_ec=$?\nprintf '\\n${CWD_MARK}%s\\n' "$PWD"\nexit $__oq_ec`;
}

const WIN_REWRITES = [
  [/^mkdir\s+-p\s+/i, 'mkdir '],
  [/^rm\s+-rf?\s+/i, 'rmdir /s /q '],
  [/^rm\s+-fr\s+/i, 'rmdir /s /q '],
  [/^rm\s+-f\s+/i, 'del /q /f '],
  [/^rm\s+/i, 'del /q '],
  [/^cp\s+-r\s+/i, 'xcopy /e /i /y '],
  [/^cp\s+/i, 'copy /y '],
  [/^mv\s+/i, 'move /y '],
  [/^cat\s+/i, 'type '],
  [/^ls\s+-[a-z]+\s*/i, 'dir '],
  [/^ls\s*$/i, 'dir'],
  [/^ls\s+/i, 'dir '],
  [/^which\s+/i, 'where '],
  [/^pwd\s*$/i, 'cd'],
  [/^python3(\s|$)/i, 'python$1'],
  [/^pip3(\s|$)/i, 'pip$1']
];

export function winTranslate(cmd) {
  const src = String(cmd == null ? '' : cmd);
  const notes = [];
  const parts = src.split(/(\s*&&\s*|\s*\|\|\s*|\s*;\s*|\s*\|\s*)/);
  const out = parts.map((seg, i) => {
    if (i % 2 === 1) return seg;
    const trimmed = seg.trim();
    if (!trimmed) return seg;
    for (const [re, rep] of WIN_REWRITES) {
      if (re.test(trimmed)) {
        const next = trimmed.replace(re, rep);
        if (next !== trimmed) notes.push(trimmed.split(/\s+/)[0] + ' -> ' + next.split(/\s+/)[0]);
        return seg.replace(trimmed, next);
      }
    }
    return seg;
  }).join('');
  return { cmd: out, notes };
}

export function bash(chatId, cmd, timeoutMs = 60000, workdir) {
  if (!cmd || !String(cmd).trim()) {
    return Promise.resolve({ ok: false, error: 'cmd is required. Pass the command line to run, for example {"cmd": "node app.js"}.', output: '' });
  }
  const root = dirFor(chatId);
  try { fs.mkdirSync(root, { recursive: true }); } catch {}
  let baseRel = getCwd(chatId);
  if (workdir != null && String(workdir).trim()) {
    const wd = normalizeRel(workdir, { allowEmpty: true, label: 'workdir' });
    if (!wd.ok) return Promise.resolve({ ok: false, error: wd.error, output: '' });
    baseRel = wd.rel;
  }
  let base;
  try { base = resolveSafe(chatId, baseRel); if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) { base = root; baseRel = ''; } }
  catch { base = root; baseRel = ''; }

  const screened = screenCommand(cmd, baseRel);
  if (!screened.ok) return Promise.resolve({ ok: false, error: screened.error, output: '', exit: null, cwd: baseRel, blocked: true });

  const win = process.platform === 'win32';
  const shell = pickShell();
  const xlat = win ? winTranslate(cmd) : { cmd: String(cmd), notes: [] };
  const wrapped = wrapCommand(base, xlat.cmd);

  return new Promise((resolve) => {
    let child;
    try {
      if (win) child = spawn(shell, ['/d', '/s', '/v:on', '/c', `"${wrapped}"`], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: true });
      else child = spawn(shell, ['-c', wrapped], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ ok: false, output: '', error: String(e.message || e), exit: null }); }

    const MAX = 12 * 1024 * 1024;
    let out = '', size = 0, killed = false, timedOut = false, settled = false;
    const grab = (b) => { if (killed) return; size += b.length; out += b.toString('utf8'); if (size > MAX) { killed = true; out = out.slice(0, MAX); try { child.kill('SIGKILL'); } catch {} } };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch {} }, timeoutMs);

    const finalize = (raw) => {
      let text = raw;
      const mi = text.lastIndexOf(CWD_MARK);
      if (mi !== -1) {
        const after = text.slice(mi + CWD_MARK.length);
        const nl = after.indexOf('\n');
        const cwdAbs = (nl === -1 ? after : after.slice(0, nl)).trim();
        text = text.slice(0, mi).replace(/\n$/, '');
        if (cwdAbs) { try { const r = relOf(chatId, path.resolve(cwdAbs)); if (!r.startsWith('..') && !path.isAbsolute(r)) setCwd(chatId, r); else setCwd(chatId, ''); } catch {} }
      } else if (workdir != null && String(workdir).trim()) { try { setCwd(chatId, relOf(chatId, base)); } catch {} }
      return text;
    };

    const done = (r) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); };
    child.on('error', (e) => done({ ok: false, output: capOut(finalize(out)), error: String(e.message || e), exit: null }));
    child.on('close', (code) => {
      const text = finalize(out);
      if (timedOut) return done({ ok: false, output: capOut(text), error: `Timed out after ${Math.round(timeoutMs / 1000)}s`, exit: null });
      if (killed) return done({ ok: false, output: capOut(text), error: `Output exceeded ${Math.round(MAX / 1048576)} MB; process killed.`, exit: null });
      const exit = typeof code === 'number' ? code : 1;
      const cwd = getCwd(chatId);
      const xnote = xlat.notes.length ? `\n\n[Adjusted for Windows: ${xlat.notes.join(', ')}. Unix flags like -p and -rf do not exist here; prefer the dedicated file tools.]` : '';
      if (exit === 0) return done({ ok: true, output: capOut(text) + xnote, exit: 0, cwd });
      let hinted = capOut(text) || `Exited with code ${exit}`;
      const notFound = /is not recognized as an internal or external command/i.test(hinted)
        || /: (?:command )?not found/i.test(hinted) || exit === 9009 || exit === 127;
      if (notFound) hinted += '\n\nHINT: ' + missingCommandHint();
      return done({ ok: false, output: hinted, exit, error: `Exited with code ${exit}`, cwd });
    });
  });
}

function parseIntOr(v) { const n = parseInt(v); return Number.isFinite(n) ? n : undefined; }

function asText(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : String(x))).join('\n');
  if (typeof v === 'object') { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
  return String(v);
}

function missingArg(tool, arg, how) {
  return { ok: false, error: `${tool} needs "${arg}". ${how} Send the call again with that argument included.` };
}

export function unknownToolError(name) {
  const guess = nearestTool(name);
  const list = SANDBOX_TOOLS.join(', ');
  return {
    ok: false,
    error: `There is no tool called "${name}".${guess ? ` Did you mean "${guess}"?` : ''} The tools you can call in this workspace are: ${list}. Use one of those exact names.`
  };
}

export async function execTool(chatId, call, maxBytes = 0) {
  try {
    const yes = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';
    const tool = resolveToolName(call.tool, true);
    if (!tool) return unknownToolError(call.tool);
    const rawRel = call.path ?? call.file ?? call.filename ?? call.file_path ?? call.filepath;
    let relArg = rawRel;
    if (rawRel != null && rawRel !== '') {
      const n = normalizeRel(rawRel, { allowEmpty: true });
      if (!n.ok) return { ok: false, error: n.error };
      relArg = n.rel;
    }
    const destOf = (v, label) => {
      if (v == null || v === '') return { ok: false, error: null };
      const n = normalizeRel(v, { label });
      return n.ok ? { ok: true, rel: n.rel } : { ok: false, error: n.error };
    };
    switch (tool) {
      case 'bash': {
        const t = parseInt(call.timeout_s ?? call.timeout);
        const ms = Number.isFinite(t) && t > 0 ? Math.min(t, 600) * 1000 : 60000;
        return await bash(chatId, call.cmd ?? call.command ?? call.script, ms, call.workdir ?? call.cwd);
      }
      case 'create_file': {
        if (relArg == null || relArg === '') return missingArg('create_file', 'path', 'It is the relative path of the file to write, e.g. "src/app.py".');
        const body = asText(call.content ?? call.text ?? call.file_text);
        if (body == null) return missingArg('create_file', 'content', 'It is the COMPLETE text of the file (use "" for an empty file). Never write a placeholder like "rest unchanged".');
        const sz = Buffer.byteLength(body, 'utf8');
        if (overCap(chatId, sz, maxBytes)) return capError(maxBytes);
        return createFile(chatId, relArg, body);
      }
      case 'str_replace': {
        if (relArg == null || relArg === '') return missingArg('str_replace', 'path', 'It is the relative path of the file to edit, e.g. "src/app.py".');
        const oldStr = asText(call.old_str ?? call.old_string ?? call.old ?? call.search);
        if (oldStr == null) return missingArg('str_replace', 'old_str', 'It is the exact text to find, copied character for character from the file (view it first).');
        const newStr = asText(call.new_str ?? call.new_string ?? call.new ?? call.replace ?? call.replacement);
        if (newStr == null) return missingArg('str_replace', 'new_str', 'It is the replacement text; pass an empty string "" to delete old_str.');
        return strReplace(chatId, relArg, oldStr, newStr, yes(call.replace_all));
      }
      case 'insert_lines': {
        if (relArg == null || relArg === '') return missingArg('insert_lines', 'path', 'It is the relative path of the file to edit.');
        const body = asText(call.content ?? call.text);
        if (body == null) return missingArg('insert_lines', 'content', 'It is the text to insert.');
        return insertLines(chatId, relArg, parseIntOr(call.line ?? call.at ?? call.insert_line), body);
      }
      case 'view': return view(chatId, relArg ?? '', parseIntOr(call.start ?? call.from), parseIntOr(call.end ?? call.to));
      case 'list_files': {
        let under = relArg ?? '';
        if (!under) {
          const alt = call.dir ?? call.directory ?? '';
          if (alt) {
            const n = normalizeRel(alt, { allowEmpty: true });
            if (!n.ok) return { ok: false, error: n.error };
            under = n.rel;
          }
        }
        const t = treeString(chatId, under, yes(call.all));
        return { ok: true, path: under || '.', tree: t.text, hidden: t.hidden, files: list(chatId, { all: yes(call.all), under }) };
      }
      case 'find': {
        const pattern = call.pattern ?? call.glob ?? call.query ?? relArg;
        if (!pattern) return missingArg('find', 'pattern', 'It is a glob such as "**/*.py" or "src/**/*.ts".');
        return findFiles(chatId, pattern, yes(call.all));
      }
      case 'search': {
        const query = call.query ?? call.pattern ?? call.text ?? call.q;
        if (!query) return missingArg('search', 'query', 'It is the text (or regex, with regex:true) to look for inside files.');
        return search(chatId, query, call.path ?? call.glob ?? call.filter, yes(call.regex));
      }
      case 'delete_file': {
        if (relArg == null || relArg === '') return missingArg('delete_file', 'path', 'It is the relative path of the file or folder to delete.');
        return deleteFile(chatId, relArg);
      }
      case 'clear_sandbox': return clearAll(chatId);
      case 'move_file': {
        if (relArg == null || relArg === '') return missingArg('move_file', 'path', 'It is the current relative path.');
        const to = destOf(call.new_path ?? call.to ?? call.destination ?? call.dest ?? call.target, 'new_path');
        if (to.error) return { ok: false, error: to.error };
        if (!to.ok) return missingArg('move_file', 'new_path', 'It is the new relative path.');
        return renameFile(chatId, relArg, to.rel);
      }
      case 'copy_file': {
        if (relArg == null || relArg === '') return missingArg('copy_file', 'path', 'It is the source relative path.');
        const to = destOf(call.new_path ?? call.to ?? call.destination ?? call.dest ?? call.target, 'new_path');
        if (to.error) return { ok: false, error: to.error };
        if (!to.ok) return missingArg('copy_file', 'new_path', 'It is the destination relative path.');
        return copyFile(chatId, relArg, to.rel, maxBytes);
      }
      case 'make_dir': {
        if (relArg == null || relArg === '') return missingArg('make_dir', 'path', 'It is the relative path of the folder to create, e.g. "src/utils".');
        return makeDir(chatId, relArg);
      }
      case 'extract_zip': {
        if (relArg == null || relArg === '') return missingArg('extract_zip', 'path', 'It is the relative path of a .zip already in your workspace.');
        if (overCap(chatId, 0, maxBytes)) return capError(maxBytes);
        return extractZip(chatId, relArg, call.dest ?? call.destination, maxBytes ? Math.max(0, maxBytes - dirSize(chatId)) : 0);
      }
      case 'bundle_zip': {
        const paths = Array.isArray(call.paths) ? call.paths : (typeof call.paths === 'string' && call.paths.trim() ? call.paths.split(/\s*,\s*/) : null);
        return bundleZip(chatId, call.name ?? call.zip_name, paths, yes(call.all));
      }
      default: return unknownToolError(call.tool);
    }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
