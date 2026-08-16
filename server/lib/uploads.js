import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { db, uid, getSetting } from '../db.js';
import { dataPath } from './dataroot.js';
import { looksTextual } from './extract.js';

export const UPLOADS = dataPath('uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

// The stored name is a fresh uuid plus a normalized extension; the user's own name is
// kept only in the message row. Anything that is not a short alphanumeric suffix is
// dropped rather than trusted, so an uploaded "x.php.html" or a name ending in a null
// byte cannot decide how this server later labels the file.
function safeExt(originalName) {
  const base = path.basename(String(originalName || ''));
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  const ext = base.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? '.' + ext : '';
}

export const diskStore = multer.diskStorage({
  destination: UPLOADS,
  filename: (_r, file, cb) => cb(null, uid() + safeExt(file.originalname))
});

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.lua', '.html', '.css', '.xml', '.yml', '.yaml', '.sh', '.c', '.cpp', '.h', '.java', '.rb', '.go', '.rs', '.php', '.sql', '.ini', '.cfg', '.log']);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };

// Only these are ever rendered in place by the app (avatars, backgrounds, image
// attachments, call audio). Everything else is served as a download, so an uploaded
// .html or .svg cannot be navigated to as a live same-origin document.
const INLINE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.svg', '.mp3', '.wav', '.ogg', '.m4a', '.webm', '.mp4']);

// Uploads are chat attachments — other people's conversations. They used to be readable
// by anyone who had the URL, with no session at all, which is a capability URL rather than
// access control and sits oddly beside an encrypted database and an egress guard.
//
// Exactly one upload has to stay public: the app icon, which the sign-in screen shows to
// someone who by definition has no session yet. It is matched against the current setting
// on every request, so changing the icon changes what is public with it.
export function isPublicUpload(reqPath) {
  const icon = String(getSetting('app_icon', '') || '');
  if (!icon.startsWith('/uploads/')) return false;
  const wanted = path.posix.basename(icon);
  return !!wanted && path.posix.basename(reqPath) === wanted;
}

export function uploadHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (!INLINE_EXT.has(path.extname(req.path).toLowerCase())) res.setHeader('Content-Disposition', 'attachment');
  next();
}

// The extension list is a fast path, not the rule. Anything not on it is decided by
// looking at the bytes, so a .toml/.kt/.vue/.env the list never heard of still reaches
// the model instead of arriving as a bare "[Attached file: x]" placeholder.
export function isTextLike(a) {
  if (a?.type && (a.type.startsWith('text/') || a.type === 'application/json')) return true;
  const ext = path.extname(a?.name || '').toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  if (ext === '.pdf') return hasSidecar(a?.url);
  if (a?.type && a.type.startsWith('image/')) return false;
  return sniffUpload(a?.url);
}

function uploadPath(url) {
  const p = path.join(UPLOADS, path.basename(url || ''));
  return p.startsWith(UPLOADS_PREFIX) ? p : null;
}

export function sidecarPath(url) {
  const p = uploadPath(url);
  return p ? p + '.txt' : null;
}

function hasSidecar(url) {
  const s = sidecarPath(url);
  try { return !!s && fs.statSync(s).size > 0; } catch { return false; }
}

const sniffCache = new Map();

function sniffUpload(url) {
  const p = uploadPath(url);
  if (!p) return false;
  try {
    const st = fs.statSync(p);
    const key = p + ':' + st.mtimeMs + ':' + st.size;
    const hit = sniffCache.get(key);
    if (hit !== undefined) return hit;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(Math.min(4096, st.size));
    try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    const ok = looksTextual(buf);
    sniffCache.set(key, ok);
    if (sniffCache.size > 256) sniffCache.delete(sniffCache.keys().next().value);
    return ok;
  } catch { return false; }
}

const READ_CACHE_MAX = 64;
const textCache = new Map();
const imageCache = new Map();

function cacheGet(store, key, mtime, size) {
  const hit = store.get(key);
  if (!hit || hit.mtime !== mtime || hit.size !== size) return undefined;
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

function cacheSet(store, key, mtime, size, value) {
  store.set(key, { mtime, size, value });
  if (store.size > READ_CACHE_MAX) store.delete(store.keys().next().value);
  return value;
}

const UPLOADS_PREFIX = UPLOADS + path.sep;

export function readUploadText(url) {
  try {
    const direct = path.join(UPLOADS, path.basename(url || ''));
    if (!direct.startsWith(UPLOADS_PREFIX)) return '';
    // A format we cannot read raw (PDF today) is extracted once at upload time into a
    // sidecar; preferring it here keeps this reader synchronous, which the whole
    // chatHistory -> buildMessages chain depends on.
    const side = direct + '.txt';
    const p = fs.existsSync(side) ? side : direct;
    const st = fs.statSync(p);
    const cached = cacheGet(textCache, p, st.mtimeMs, st.size);
    if (cached !== undefined) return cached;
    let t = fs.readFileSync(p, 'utf8');
    if (t.length > 20000) t = t.slice(0, 20000) + '\n... [truncated]';
    return cacheSet(textCache, p, st.mtimeMs, st.size, t);
  } catch { return ''; }
}

export function readImageDataUri(a) {
  try {
    const p = path.join(UPLOADS, path.basename(a.url || ''));
    if (!p.startsWith(UPLOADS_PREFIX)) return null;
    const mime = a.type && a.type.startsWith('image/') ? a.type : (MIME[path.extname(a.name || '').toLowerCase()] || 'image/png');
    const st = fs.statSync(p);
    const key = mime + '|' + p;
    const cached = cacheGet(imageCache, key, st.mtimeMs, st.size);
    if (cached !== undefined) return cached;
    return cacheSet(imageCache, key, st.mtimeMs, st.size, `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`);
  } catch { return null; }
}

// Deleting a chat's uploads is two phases on purpose. Fork and cherry-pick copy a message
// verbatim, attachments included, so the same /uploads file can be referenced from more
// than one chat; unlinking everything the deleted chat pointed at — which is what this
// used to do — silently broke the images in the copy. Collect the candidates first, let
// the caller delete the rows, then drop only what nothing references any more.
export function attachmentUrlsOf(chatIds) {
  const ids = chatIds instanceof Set ? chatIds : new Set([chatIds]);
  const urls = new Set();
  for (const cid of ids) {
    for (const m of db.messages.byChat(cid)) {
      for (const a of (m.attachments || [])) if (a?.url) urls.add(a.url);
    }
  }
  return urls;
}

export function purgeUnreferencedUploads(urls) {
  if (!urls || !urls.size) return 0;
  const stillUsed = db.messages.attachmentUrls();
  let removed = 0;
  for (const url of urls) {
    if (stillUsed.has(url)) continue;
    const fname = path.basename(url);
    if (!fname) continue;
    const p = path.join(UPLOADS, fname);
    if (!p.startsWith(UPLOADS_PREFIX)) continue;
    try { fs.unlinkSync(p); removed++; } catch {}
  }
  return removed;
}
