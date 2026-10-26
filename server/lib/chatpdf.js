import { readFileSync } from 'fs';
import { createRequire } from 'module';
import PDFDocument from 'pdfkit';
import * as fontkit from 'fontkit';

const INK = '#1d1d1b';
const MUTED = '#6b6a66';
const ACCENT = '#2a78d6';
const RULE = '#d9d8d3';
const HEADING_SIZES = [16, 14, 12.5, 11.5, 11, 11];

const FONT_FILES = {
  regular: '@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf',
  bold: '@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf',
  italic: '@expo-google-fonts/noto-sans/400Regular_Italic/NotoSans_400Regular_Italic.ttf',
  mono: '@expo-google-fonts/noto-sans-mono/400Regular/NotoSansMono_400Regular.ttf',
  cjk: '@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf',
  korean: '@expo-google-fonts/noto-sans-kr/400Regular/NotoSansKR_400Regular.ttf',
  symbols: '@expo-google-fonts/noto-sans-symbols-2/400Regular/NotoSansSymbols2_400Regular.ttf',
  emoji: '@expo-google-fonts/noto-emoji/400Regular/NotoEmoji_400Regular.ttf'
};
const FALLBACK = ['cjk', 'korean', 'symbols', 'emoji'];
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;

let fonts = null;

function loadFonts() {
  if (fonts) return fonts;
  const require = createRequire(import.meta.url);
  fonts = {};
  for (const [name, file] of Object.entries(FONT_FILES)) {
    const data = readFileSync(require.resolve(file));
    fonts[name] = { data, face: fontkit.create(data) };
  }
  return fonts;
}

export function pipeChatPdf(out, { title, summary, messages }) {
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: title || 'Conversation' } });
  for (const [name, font] of Object.entries(loadFonts())) doc.registerFont(name, font.data);
  doc.pipe(out);
  doc.fontSize(20);
  write(doc, [{ text: title || 'Conversation', style: 'bold', color: INK }]);
  doc.fontSize(9);
  write(doc, [{ text: 'Exported ' + new Date().toLocaleDateString('en', { dateStyle: 'long' }), style: 'regular', color: MUTED }]);
  if (summary) {
    doc.moveDown(1).fontSize(9.5);
    write(doc, [{ text: 'Summary of earlier conversation: ', style: 'bold', color: MUTED }, ...inline(summary, 'italic', MUTED)]);
  }
  for (const m of messages) {
    doc.moveDown(1.2).fontSize(10);
    write(doc, [{ text: m.role === 'user' ? 'You' : 'Assistant', style: 'bold', color: m.role === 'user' ? INK : ACCENT }]);
    if ((m.attachments || []).length) {
      doc.moveDown(0.2).fontSize(9);
      write(doc, [{ text: m.attachments.map(a => `(attachment: ${a.name})`).join('  '), style: 'italic', color: MUTED }]);
    }
    writeBody(doc, m.content || '');
  }
  doc.end();
}

function writeBody(doc, text) {
  let last = 0;
  for (const match of text.matchAll(/```[^\n]*\n([\s\S]*?)(?:```|$)/g)) {
    writeProse(doc, text.slice(last, match.index));
    writeCode(doc, match[1]);
    last = match.index + match[0].length;
  }
  writeProse(doc, text.slice(last));
}

function writeProse(doc, text) {
  const lines = text.trim().split('\n').map(line => line.trimEnd());
  if (!lines[0]) return;
  doc.moveDown(0.3);
  lines.forEach((line, i) => {
    if (!line.trim()) doc.moveDown(0.4);
    else writeLine(doc, line, isTableDivider(lines[i + 1] || ''));
  });
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
}

function writeLine(doc, line, tableHeader) {
  let m;
  if ((m = line.match(/^\s*(#{1,6})\s+(.*)/))) {
    doc.moveDown(0.4).fontSize(HEADING_SIZES[m[1].length - 1]);
    return write(doc, inline(m[2], 'bold'));
  }
  if (isTableDivider(line)) return;
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return writeRule(doc);
  doc.fontSize(10.5);
  if ((m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/))) {
    const marker = /\d/.test(m[2]) ? m[2] : '•';
    const indent = 14 * (1 + Math.floor(m[1].length / 2));
    return write(doc, [{ text: marker + ' ', style: 'regular', color: INK }, ...inline(m[3])], { indent });
  }
  if ((m = line.match(/^\s*>\s?(.*)/))) return write(doc, inline(m[1], 'italic', MUTED), { indent: 14 });
  if (line.trim().startsWith('|')) {
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    return write(doc, inline(cells.join('  |  '), tableHeader ? 'bold' : 'regular'));
  }
  write(doc, inline(line));
}

function writeCode(doc, code) {
  const body = code.replace(/\n+$/, '').replace(/\t/g, '    ');
  if (!body.trim()) return;
  doc.moveDown(0.4).fontSize(9);
  write(doc, [{ text: body, style: 'mono', color: INK }], { indent: 12, lineGap: 1 });
  doc.moveDown(0.2);
}

function writeRule(doc) {
  const y = doc.moveDown(0.5).y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.moveDown(0.5);
}

const INLINE = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*(?=\S)(.+?)(?<=\S)\*|(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)|~~(.+?)~~/g;

function inline(text, style = 'regular', color = INK) {
  const segments = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), style, color });
    if (m[1] || m[2]) segments.push({ text: m[1] || m[2], style: 'bold', color });
    else if (m[3]) segments.push({ text: m[3], style: 'mono', color });
    else if (m[4]) segments.push({ text: m[4], style, color: ACCENT, link: /^(https?:|mailto:)/i.test(m[5]) ? m[5] : null });
    else if (m[8]) segments.push({ text: m[8], style, color });
    else segments.push({ text: m[6] || m[7], style: 'italic', color });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), style, color });
  return segments;
}

function fontFor(style, char) {
  const code = char.codePointAt(0);
  if (fonts[style].face.hasGlyphForCodePoint(code)) return style;
  return FALLBACK.find(name => fonts[name].face.hasGlyphForCodePoint(code)) || style;
}

function runs(text, style) {
  const out = [];
  for (const char of text) {
    const last = out.at(-1);
    const font = last && /\p{M}|‍|️/u.test(char) ? last.font : fontFor(style, char);
    if (last && last.font === font) last.text += char;
    else out.push({ font, text: char });
  }
  return out;
}

function write(doc, segments, { indent = 0, lineGap = 2 } = {}) {
  const pieces = segments.flatMap(seg => runs(seg.text.replace(SKIN_TONE, ''), seg.style).map(run => ({ ...run, color: seg.color, link: seg.link || null })));
  if (!pieces.length) return;
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right - indent;
  doc.x = left + indent;
  pieces.forEach((piece, i) => {
    doc.font(piece.font).fillColor(piece.color).text(piece.text, { width, lineGap, link: piece.link, continued: i < pieces.length - 1 });
  });
  doc.x = left;
}