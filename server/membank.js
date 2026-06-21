import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MEMBANK_ROOT = path.join(__dirname, 'data', 'membank');
const CACHE_DIR = path.join(MEMBANK_ROOT, '.cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const TEXT_CAP = 200000;
const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.lua', '.html', '.htm', '.css', '.xml', '.yml', '.yaml', '.sh', '.c', '.cpp', '.h', '.hpp', '.java', '.rb', '.go', '.rs', '.php', '.sql', '.ini', '.cfg', '.conf', '.log', '.rst', '.toml', '.env', '.gitignore']);

export const DEFAULT_PROMPT = 'The admin has provided reference files below. Treat their contents as trusted, authoritative context. When a question relates to them, READ the relevant file (or just the needed lines) before answering instead of guessing or searching the web.';

function safe(name) {
  const base = path.basename(String(name || ''));
  if (!base || base === '.' || base === '..' || base.startsWith('.')) return null;
  const p = path.join(MEMBANK_ROOT, base);
  if (!p.startsWith(MEMBANK_ROOT + path.sep)) return null;
  return { base, p };
}
function ext(name) { return path.extname(name).toLowerCase(); }
function isPdf(name) { return ext(name) === '.pdf'; }
function isReadable(name) { return isPdf(name) || TEXT_EXT.has(ext(name)); }
function cachePathFor(base) { return path.join(CACHE_DIR, base + '.txt'); }

let _pdfjs = null;
async function loadPdfjs() {
  if (!_pdfjs) _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjs;
}
async function extractPdf(buffer) {
  const { getDocument } = await loadPdfjs();
  const doc = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, disableFontFace: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let buf = '';
    for (const it of tc.items) { buf += it.str || ''; buf += it.hasEOL ? '\n' : ' '; }
    pages.push(buf.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
    try { page.cleanup(); } catch {}
  }
  try { await doc.destroy(); } catch {}
  return pages.join('\n\n');
}

async function buildCache(base) {
  const s = safe(base);
  if (!s) return null;
  let buffer; try { buffer = fs.readFileSync(s.p); } catch { return null; }
  let text;
  try { text = await extractPdf(buffer); }
  catch (e) { text = `[Could not extract text from this PDF: ${e.message}]`; }
  try { fs.writeFileSync(cachePathFor(s.base), text); } catch {}
  return text;
}
function cacheFresh(base) {
  const s = safe(base); if (!s) return false;
  const c = cachePathFor(s.base);
  try {
    const src = fs.statSync(s.p), cc = fs.statSync(c);
    return cc.mtimeMs >= src.mtimeMs;
  } catch { return false; }
}

export async function ensureIndexedAll() {
  for (const f of rawList()) {
    if (isPdf(f.name) && !cacheFresh(f.name)) { try { await buildCache(f.name); } catch {} }
  }
}

function readableTextSync(base) {
  const s = safe(base); if (!s) return null;
  if (isPdf(base)) { try { return fs.readFileSync(cachePathFor(s.base), 'utf8'); } catch { return null; } }
  if (TEXT_EXT.has(ext(base))) { try { return fs.readFileSync(s.p, 'utf8'); } catch { return null; } }
  return null;
}
function countLines(base) {
  const t = readableTextSync(base);
  if (t == null) return 0;
  return t.length ? t.split('\n').length : 0;
}

function rawList() {
  let names = [];
  try { names = fs.readdirSync(MEMBANK_ROOT); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (n.startsWith('.')) continue;
    let st; try { st = fs.statSync(path.join(MEMBANK_ROOT, n)); } catch { continue; }
    if (!st.isFile()) continue;
    out.push({ name: n, size: st.size });
  }
  return out;
}
export function list() {
  return rawList().map(f => ({ name: f.name, size: f.size, lines: countLines(f.name), readable: isReadable(f.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveUpload(originalName, buffer) {
  const s = safe(originalName);
  if (!s) throw new Error('Invalid file name.');
  fs.writeFileSync(s.p, buffer);
  if (isPdf(s.base)) { try { await buildCache(s.base); } catch {} }
  return { name: s.base, size: buffer.length, lines: countLines(s.base), readable: isReadable(s.base) };
}
export function remove(name) {
  const s = safe(name);
  if (!s) return false;
  try { fs.unlinkSync(s.p); } catch {}
  try { fs.unlinkSync(cachePathFor(s.base)); } catch {}
  return true;
}

export function promptFor(introOverride) {
  const files = list();
  if (!files.length) return '';
  const intro = (introOverride && String(introOverride).trim()) || DEFAULT_PROMPT;
  let p = '## Memory Bank\n' + intro + '\n\nAvailable files:\n';
  for (const f of files) p += `- ${f.name}${f.readable ? ` (${f.lines} lines, ${f.size} bytes)` : ` (${f.size} bytes, not readable as text)`}\n`;
  p += '\nTools (emit using the |TOOL| line protocol, same as other tools):\n';
  p += '- mb_view — read a memory bank file. Provide `path` (the file name). Optionally provide `start` and `end` line numbers (1-indexed, inclusive) to read only a slice, which keeps context small.\n';
  p += '- mb_search — search across all memory bank files for a term. Provide `query`.\n\n';
  p += 'Example:\n|TOOL| mb_view\npath: policies.md\nstart: 1\nend: 40\n|/TOOL|\n\nRead only what you need. Do not paste entire large files if a line range suffices.';
  return p;
}

export function execTool(call) {
  if (call.tool === 'mb_view') {
    const s = safe(call.path);
    if (!s) return { ok: false, error: `No memory bank file named "${call.path}".` };
    if (!isReadable(call.path)) return { ok: false, error: `"${call.path}" is not a readable text or PDF file.` };
    const text = readableTextSync(call.path);
    if (text == null) return { ok: false, error: `Could not read "${call.path}". It may still be indexing — try again.` };
    const lines = text.split('\n');
    let start = Number.isInteger(call.start) ? call.start : null;
    let end = Number.isInteger(call.end) ? call.end : null;
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
    for (const f of list()) {
      if (!f.readable) continue;
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
