import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
import { unzipBuffer } from '../sandbox/zip.js';
import { isCfb, extractCfb } from './legacyoffice.js';

const pdfAssets = (() => {
  try {
    const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')).split(path.sep).join('/');
    return { cMapUrl: root + '/cmaps/', cMapPacked: true, standardFontDataUrl: root + '/standard_fonts/' };
  } catch { return {}; }
})();

let _pdfjs = null;
async function loadPdfjs() {
  if (!_pdfjs) _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjs;
}

export async function extractPdf(buffer) {
  const { getDocument } = await loadPdfjs();
  const doc = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, disableFontFace: true, ...pdfAssets }).promise;
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

// An extension list can only ever describe the formats someone thought of, which is
// how .toml, .kt, .swift and .vue ended up invisible to the model. Sniffing the bytes
// answers the question that actually matters: can this be shown as text at all.
const SAMPLE = 4096;

export function looksTextual(buf) {
  if (!buf || !buf.length) return false;
  const n = Math.min(buf.length, SAMPLE);
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return false;
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return false;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  if (ctrl / n > 0.05) return false;
  try {
    const dec = new TextDecoder('utf-8', { fatal: true });
    dec.decode(buf.subarray(0, n - (n === buf.length ? 0 : 4)));
    return true;
  } catch { return false; }
}

const MAX_CHARS = 4 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 400;

const ENTITIES = { __proto__: null, amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(n); } catch { return m; }
  });
}

function tidy(s) {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function markupText(xml, marks, drop = []) {
  let s = xml;
  for (const tag of drop) s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), '');
  s = s.replace(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g, (_m, close, tag, self) => (close || self) ? (marks[tag.toLowerCase()] || '') : '');
  return tidy(decodeEntities(s));
}

const DOCX_MARKS = { 'w:p': '\n', 'w:br': '\n', 'w:cr': '\n', 'w:tab': '\t', 'w:tc': '\t', 'w:tr': '\n' };
const PPTX_MARKS = { 'a:p': '\n', 'a:br': '\n', 'a:tab': '\t' };
const ODF_MARKS = { 'text:p': '\n', 'text:h': '\n', 'text:line-break': '\n', 'text:tab': '\t', 'text:s': ' ', 'table:table-cell': '\t', 'table:table-row': '\n', 'draw:page': '\n\n' };
const HTML_MARKS = { br: '\n', p: '\n', div: '\n', li: '\n', tr: '\n', td: '\t', th: '\t', h1: '\n', h2: '\n', h3: '\n', h4: '\n', h5: '\n', h6: '\n', section: '\n', article: '\n', blockquote: '\n', pre: '\n' };

function entryMap(buf) {
  const m = new Map();
  for (const e of unzipBuffer(buf)) m.set(e.name, e.data);
  return m;
}

const fileNumber = (p) => parseInt(p.match(/(\d+)\.xml$/)?.[1], 10) || 0;

function numbered(files, re) {
  return [...files.keys()].filter(n => re.test(n)).sort((a, b) => fileNumber(a) - fileNumber(b));
}

function docx(files) {
  return ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'].filter(p => files.has(p))
    .map(p => markupText(files.get(p).toString('utf8').replace(/<\/w:p>\s*<\/w:tc>/g, '</w:tc>'), DOCX_MARKS, ['w:instrText', 'w:delText']))
    .filter(Boolean).join('\n\n');
}

function pptx(files) {
  return numbered(files, /^ppt\/slides\/slide\d+\.xml$/).map((p, i) => {
    const body = markupText(files.get(p).toString('utf8'), PPTX_MARKS);
    const notesPath = `ppt/notesSlides/notesSlide${fileNumber(p)}.xml`;
    const notes = files.has(notesPath) ? markupText(files.get(notesPath).toString('utf8'), PPTX_MARKS).replace(/^\d+$/m, '').trim() : '';
    return `## Slide ${i + 1}\n${body}` + (notes ? `\n\nNotes:\n${notes}` : '');
  }).join('\n\n');
}

function colIndex(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/)?.[0];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function csvCell(v) {
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function runText(xml) {
  let out = '';
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeEntities(out);
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

function xlsxSheets(files) {
  const rels = new Map();
  const relXml = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  for (const [tag] of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(tag, 'Id'), target = attr(tag, 'Target');
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  const book = files.get('xl/workbook.xml')?.toString('utf8') || '';
  const sheets = [...book.matchAll(/<sheet\b[^>]*>/g)]
    .map(([tag]) => ({ name: decodeEntities(attr(tag, 'name') || ''), path: rels.get(attr(tag, 'r:id')) }))
    .filter(s => s.path && files.has(s.path));
  return sheets.length ? sheets : numbered(files, /^xl\/worksheets\/sheet\d+\.xml$/).map((p, i) => ({ name: 'Sheet' + (i + 1), path: p }));
}

function xlsx(files) {
  const shared = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(runText(m[1]));
  return xlsxSheets(files).map(({ name, path: p }) => {
    const rows = [];
    for (const r of files.get(p).toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const inner = c[2] || '';
        const type = attr(c[1], 't');
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = '';
        if (type === 's') val = shared[parseInt(v, 10)] ?? '';
        else if (type === 'inlineStr') val = runText(inner);
        else if (type === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (v != null) val = decodeEntities(v);
        const at = colIndex(attr(c[1], 'r'));
        const idx = at >= 0 ? at : cells.length;
        while (cells.length < idx) cells.push('');
        cells[idx] = val;
      }
      if (cells.some(x => x !== '')) rows.push(cells.map(csvCell).join(','));
    }
    return `## Sheet: ${name}\n${rows.join('\n')}`;
  }).join('\n\n');
}

function odf(files) {
  const xml = files.get('content.xml')?.toString('utf8');
  if (!xml) return '';
  return markupText(xml.replace(/<\/text:p>\s*<\/table:table-cell>/g, '</table:table-cell>'), ODF_MARKS)
    .split('\n').map(l => l.replace(/\t+$/, '')).join('\n');
}

export function htmlText(html) {
  return markupText(String(html).replace(/<!--[\s\S]*?-->/g, ''), HTML_MARKS, ['head', 'script', 'style', 'noscript', 'svg']);
}

function epub(files) {
  const container = files.get('META-INF/container.xml')?.toString('utf8') || '';
  const opfPath = attr(container, 'full-path');
  const opf = opfPath && files.get(opfPath)?.toString('utf8');
  if (!opf) return '';
  const dir = path.posix.dirname(opfPath);
  const items = new Map();
  for (const [tag] of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = attr(tag, 'id'), href = attr(tag, 'href');
    if (id && href) { try { items.set(id, path.posix.join(dir, decodeURIComponent(href))); } catch {} }
  }
  return [...opf.matchAll(/<itemref\b[^>]*>/g)]
    .map(([tag]) => items.get(attr(tag, 'idref'))).filter(p => p && files.has(p))
    .map(p => htmlText(files.get(p).toString('utf8'))).filter(Boolean).join('\n\n');
}

const TAR_MAX_BYTES = 256 * 1024 * 1024;

function archive(entries) {
  const listing = entries.slice(0, MAX_ARCHIVE_ENTRIES).map(e => `${e.name} (${e.data.length} bytes)`);
  if (entries.length > MAX_ARCHIVE_ENTRIES) listing.push(`... and ${entries.length - MAX_ARCHIVE_ENTRIES} more`);
  let out = `Archive with ${entries.length} file(s):\n${listing.join('\n')}`;
  for (const e of entries) {
    if (out.length >= MAX_CHARS) break;
    const text = looksTextual(e.data) ? e.data.toString('utf8') : decodeText(e.data);
    if (text) out += `\n\n--- ${e.name} ---\n${text}`;
  }
  return out;
}

function tarEntries(buf) {
  const out = [];
  let longName = null;
  let total = 0;
  for (let off = 0; off + 512 <= buf.length;) {
    const head = buf.subarray(off, off + 512);
    if (head.every(b => b === 0)) break;
    const field = (at, n) => head.toString('utf8', at, at + n).replace(/\0[\s\S]*$/, '');
    const size = parseInt(field(124, 12).trim() || '0', 8) || 0;
    const type = head[156] ? String.fromCharCode(head[156]) : '0';
    const data = buf.subarray(off + 512, Math.min(buf.length, off + 512 + size));
    const prefix = field(345, 155);
    const name = longName || ((prefix ? prefix + '/' : '') + field(0, 100));
    longName = null;
    if (type === 'L') longName = data.toString('utf8').replace(/\0[\s\S]*$/, '');
    else if (type === 'x') longName = data.toString('utf8').match(/\d+ path=([^\n]*)\n/)?.[1] || null;
    else if ((type === '0' || type === '7') && !name.endsWith('/')) {
      total += data.length;
      if (total > TAR_MAX_BYTES) break;
      out.push({ name: name.replace(/^\.\//, ''), data });
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'mmathPr', 'pgdsctbl', 'revtbl', 'fldinst', 'filetbl', 'private', 'xe', 'tc', 'bkmkstart', 'bkmkend', 'nonshppict']);
const RTF_WORDS = { __proto__: null, par: '\n', line: '\n', sect: '\n\n', page: '\n\n', tab: '\t', cell: '\t', row: '\n', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ' };
const RTF_SYMBOLS = { __proto__: null, '~': ' ', '-': '', _: '-' };
const cp1252 = new TextDecoder('windows-1252');

export function rtfText(src) {
  let out = '';
  let skip = false, uc = 1, pending = 0, ignorable = false;
  const stack = [];
  const emit = (ch) => {
    if (pending > 0) { pending--; return; }
    if (!skip) out += ch;
  };
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '{') { stack.push({ skip, uc }); i++; continue; }
    if (c === '}') { const st = stack.pop(); if (st) ({ skip, uc } = st); pending = 0; i++; continue; }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (c !== '\\') { emit(c); i++; continue; }
    const next = src[i + 1];
    if (next === '\\' || next === '{' || next === '}') { emit(next); i += 2; continue; }
    if (next === '\'') {
      const byte = parseInt(src.substr(i + 2, 2), 16);
      if (!Number.isNaN(byte)) emit(cp1252.decode(Uint8Array.of(byte)));
      i += 4; continue;
    }
    if (next === '*') { ignorable = true; i += 2; continue; }
    const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i + 1, i + 48));
    if (!m) {
      if (next in RTF_SYMBOLS) emit(RTF_SYMBOLS[next]);
      i += 2; continue;
    }
    i += 1 + m[0].length;
    const word = m[1];
    const arg = m[2] != null ? parseInt(m[2], 10) : null;
    if (ignorable || RTF_SKIP.has(word)) { skip = true; ignorable = false; continue; }
    if (word === 'uc') { uc = arg ?? 1; continue; }
    if (word === 'u' && arg != null) {
      emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg));
      pending = uc;
      continue;
    }
    if (word in RTF_WORDS) emit(RTF_WORDS[word]);
  }
  return tidy(out);
}

function ctrlRatio(s) {
  if (!s.length) return 1;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32) || c === 0xfffd) n++;
  }
  return n / s.length;
}

export function decodeText(buf) {
  if (!buf || buf.length < 2) return '';
  let enc = null, body = buf;
  if (buf[0] === 0xff && buf[1] === 0xfe) { enc = 'utf-16le'; body = buf.subarray(2); }
  else if (buf[0] === 0xfe && buf[1] === 0xff) { enc = 'utf-16be'; body = buf.subarray(2); }
  else {
    const n = Math.min(buf.length, SAMPLE) & ~1;
    let evenZero = 0, oddZero = 0;
    for (let i = 0; i < n; i += 2) { if (!buf[i]) evenZero++; if (!buf[i + 1]) oddZero++; }
    const half = n / 2 || 1;
    if (oddZero / half > 0.3 && evenZero / half < 0.05) enc = 'utf-16le';
    else if (evenZero / half > 0.3 && oddZero / half < 0.05) enc = 'utf-16be';
    else if (!evenZero && !oddZero && !buf.subarray(0, SAMPLE).includes(0)) enc = 'windows-1252';
  }
  if (!enc) return '';
  const text = new TextDecoder(enc).decode(body);
  return ctrlRatio(text.slice(0, SAMPLE)) <= 0.05 ? text : '';
}

const ZIP_FORMATS = {
  __proto__: null,
  '.docx': docx, '.docm': docx, '.dotx': docx, '.dotm': docx,
  '.pptx': pptx, '.pptm': pptx, '.ppsx': pptx, '.potx': pptx,
  '.xlsx': xlsx, '.xlsm': xlsx, '.xltx': xlsx, '.xltm': xlsx,
  '.odt': odf, '.ods': odf, '.odp': odf, '.odg': odf, '.ott': odf, '.ots': odf, '.otp': odf,
  '.epub': epub
};

const ZIP_MARKERS = [
  ['word/document.xml', docx],
  ['xl/workbook.xml', xlsx],
  ['ppt/presentation.xml', pptx],
  ['META-INF/container.xml', epub],
  ['content.xml', odf]
];

function zipDocument(buf, ext) {
  const files = entryMap(buf);
  const fmt = ZIP_FORMATS[ext] || ZIP_MARKERS.find(([marker]) => files.has(marker))?.[1];
  return fmt ? fmt(files) : archive([...files].map(([name, data]) => ({ name, data })));
}

const LEGACY_DOCS = new Set(['.pdf', '.doc', '.dot', '.xls', '.xlt', '.ppt', '.pps', '.pot', '.msg', '.rtf']);

export function isDocumentName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return !!ZIP_FORMATS[ext] || LEGACY_DOCS.has(ext);
}

const isZip = (b) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isPdf = (b) => b.length > 3 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
const isTar = (b) => b.length >= 512 && b.toString('latin1', 257, 262) === 'ustar';
export const isRtf = (b) => b.length >= 5 && b.toString('latin1', 0, 5) === '{\\rtf';

function gunzipName(name) {
  const s = String(name || '');
  if (/\.tgz$/i.test(s)) return s.slice(0, -4) + '.tar';
  return s.replace(/\.(gz|gzip)$/i, '');
}

export async function extractDocument(buf, name, depth = 0) {
  if (!buf || !buf.length) return '';
  let text;
  if (isPdf(buf)) text = await extractPdf(buf);
  else if (isZip(buf)) text = zipDocument(buf, path.extname(String(name || '')).toLowerCase());
  else if (isCfb(buf)) text = extractCfb(buf, htmlText);
  else if (isRtf(buf)) text = rtfText(buf.toString('latin1'));
  else if (isTar(buf)) text = archive(tarEntries(buf));
  else if (isGzip(buf)) {
    if (depth > 2) return '';
    let out;
    try { out = zlib.gunzipSync(buf, { maxOutputLength: TAR_MAX_BYTES }); } catch { return ''; }
    text = looksTextual(out) ? out.toString('utf8') : await extractDocument(out, gunzipName(name), depth + 1);
  } else text = decodeText(buf);
  text = String(text || '');
  if (!text.trim()) return '';
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '\n\n[Truncated: the extracted text was longer than this.]' : text;
}