import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { db, uid } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

export const diskStore = multer.diskStorage({
  destination: UPLOADS,
  filename: (_r, file, cb) => cb(null, uid() + path.extname(file.originalname || '.bin'))
});

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.lua', '.html', '.css', '.xml', '.yml', '.yaml', '.sh', '.c', '.cpp', '.h', '.java', '.rb', '.go', '.rs', '.php', '.sql', '.ini', '.cfg', '.log']);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };

export function isTextLike(a) {
  if (a?.type && (a.type.startsWith('text/') || a.type === 'application/json')) return true;
  return TEXT_EXT.has(path.extname(a?.name || '').toLowerCase());
}

export function readUploadText(url) {
  try {
    const p = path.join(UPLOADS, path.basename(url || ''));
    if (!p.startsWith(UPLOADS)) return '';
    let t = fs.readFileSync(p, 'utf8');
    if (t.length > 20000) t = t.slice(0, 20000) + '\n... [truncated]';
    return t;
  } catch { return ''; }
}

export function readImageDataUri(a) {
  try {
    const p = path.join(UPLOADS, path.basename(a.url || ''));
    if (!p.startsWith(UPLOADS)) return null;
    const mime = a.type && a.type.startsWith('image/') ? a.type : (MIME[path.extname(a.name || '').toLowerCase()] || 'image/png');
    return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
  } catch { return null; }
}

export function purgeUploads(chatIds) {
  const ids = chatIds instanceof Set ? chatIds : new Set([chatIds]);
  const seen = new Set();
  for (const cid of ids) {
    for (const m of db.messages.byChat(cid)) {
      for (const a of (m.attachments || [])) {
        const fname = path.basename(a?.url || '');
        if (!fname || seen.has(fname)) continue;
        seen.add(fname);
        const p = path.join(UPLOADS, fname);
        if (p.startsWith(UPLOADS)) { try { fs.unlinkSync(p); } catch {} }
      }
    }
  }
}
