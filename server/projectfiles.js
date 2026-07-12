import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'data', 'projectfiles');

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'xml', 'yaml', 'yml', 'log', 'ini', 'toml', 'sh', 'bat', 'sql', 'java', 'c', 'cpp', 'h', 'rs', 'go', 'rb', 'php']);
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES = 40;

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

function dirFor(projectId) {
  const safe = String(projectId || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!safe) return null;
  return path.join(ROOT, safe);
}
function safeName(name) {
  const base = path.basename(String(name || '')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  return base && !base.startsWith('.') ? base : null;
}
function extOf(name) { return (name.split('.').pop() || '').toLowerCase(); }
function cachePath(dir, name) { return path.join(dir, '.cache-' + name + '.txt'); }

export function list(projectId) {
  const dir = dirFor(projectId);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      let st; try { st = fs.statSync(path.join(dir, f)); } catch { return null; }
      return st && st.isFile() ? { name: f, size: st.size, mtime: st.mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveUpload(projectId, originalName, buffer) {
  const dir = dirFor(projectId);
  const name = safeName(originalName);
  if (!dir || !name) return { error: 'Invalid file name.' };
  const ext = extOf(name);
  if (ext !== 'pdf' && !TEXT_EXT.has(ext)) return { error: `Unsupported file type ".${ext}". Upload PDFs or plain-text files.` };
  if (buffer.length > MAX_FILE) return { error: 'File is too large (max 25 MB).' };
  if (list(projectId).length >= MAX_FILES) return { error: `A project can hold at most ${MAX_FILES} files.` };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buffer);
  try { fs.rmSync(cachePath(dir, name), { force: true }); } catch {}
  return { file: { name, size: buffer.length } };
}

export function remove(projectId, name) {
  const dir = dirFor(projectId);
  const n = safeName(name);
  if (!dir || !n) return { error: 'Invalid file.' };
  try { fs.rmSync(path.join(dir, n), { force: true }); } catch {}
  try { fs.rmSync(cachePath(dir, n), { force: true }); } catch {}
  return { ok: true };
}

export function removeAll(projectId) {
  const dir = dirFor(projectId);
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  return { ok: true };
}

async function textOf(projectId, name) {
  const dir = dirFor(projectId);
  const n = safeName(name);
  if (!dir || !n) return null;
  const p = path.join(dir, n);
  if (!fs.existsSync(p)) return null;
  if (extOf(n) === 'pdf') {
    const cp = cachePath(dir, n);
    try {
      if (fs.existsSync(cp) && fs.statSync(cp).mtimeMs >= fs.statSync(p).mtimeMs) return fs.readFileSync(cp, 'utf8');
    } catch {}
    let text;
    try { text = await extractPdf(fs.readFileSync(p)); }
    catch (e) { text = `[Could not extract text from this PDF: ${e.message}]`; }
    try { fs.writeFileSync(cachePath(dir, n), text); } catch {}
    return text;
  }
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

export function promptFor(projectId, projectName) {
  const files = list(projectId);
  if (!files.length) return '';
  let p = `## Project files\nThe user attached reference documents to this project ("${(projectName || 'Project').slice(0, 80)}"). Consult them with the tools below whenever they could be relevant \u2014 they are the authoritative source for questions about their contents.\n\nFiles:\n`;
  for (const f of files) p += `- ${f.name} (${f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB'})\n`;
  p += '\nUse `pf_search` to find passages across all project files, and `pf_view` to read a specific file (optionally a line range).';
  return p;
}

export async function execTool(projectId, call) {
  if (call.tool === 'pf_search') {
    const q = String(call.query || '').trim().toLowerCase();
    if (!q) return { ok: false, error: 'Empty query.' };
    const hits = [];
    for (const f of list(projectId)) {
      const text = await textOf(projectId, f.name);
      if (!text) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && hits.length < 30; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          hits.push({ file: f.name, line: i + 1, text: lines[i].trim().slice(0, 300) });
        }
      }
      if (hits.length >= 30) break;
    }
    return { ok: true, query: call.query, count: hits.length, hits };
  }
  if (call.tool === 'pf_view') {
    const text = await textOf(projectId, call.name);
    if (text == null) return { ok: false, error: `No project file named "${call.name}".` };
    const lines = text.split('\n');
    const from = Math.max(1, parseInt(call.from) || 1);
    const count = Math.min(400, Math.max(1, parseInt(call.lines) || 200));
    const slice = lines.slice(from - 1, from - 1 + count);
    return { ok: true, name: safeName(call.name), total: lines.length, from, to: from - 1 + slice.length, text: slice.join('\n').slice(0, 60000) };
  }
  return { ok: false, error: 'Unknown project-file tool.' };
}

export function formatResult(call, r) {
  if (!r.ok) return `${call.tool} \u2192 ERROR: ${r.error}`;
  if (call.tool === 'pf_search') {
    return `pf_search "${call.query}" \u2192 ${r.count} hit(s)` + (r.hits.length ? '\n' + r.hits.map(h => `${h.file}:${h.line}: ${h.text}`).join('\n') : '');
  }
  return `pf_view ${r.name} (lines ${r.from}-${r.to} of ${r.total}) \u2192\n${r.text}`;
}

export function resultPayload(call, r) {
  const o = { ok: !!r.ok };
  if (r.error) o.error = r.error;
  if (r.count != null) o.count = r.count;
  if (r.name) { o.name = r.name; o.total = r.total; }
  return o;
}
