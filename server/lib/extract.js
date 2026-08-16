import path from 'path';
import { createRequire } from 'module';

const pdfAssets = (() => {
  try {
    const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
    return { cMapUrl: path.join(root, 'cmaps') + path.sep, cMapPacked: true, standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep };
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

const ZIP_TEXT = { __proto__: null, '.docx': 'word/document.xml', '.pptx': 'ppt/slides/slide1.xml', '.xlsx': 'xl/sharedStrings.xml' };

export function isZipOfficeDoc(name) {
  return !!ZIP_TEXT[path.extname(String(name || '')).toLowerCase()];
}
