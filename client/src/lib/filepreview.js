import { extOf } from './files.js';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'gif', 'webp', 'bmp', 'avif', 'ico', 'svg', 'apng']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const MARKDOWN = new Set(['md', 'markdown', 'mdx']);
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml', 'image/apng']);

export function previewKind(name, type = '') {
  const ext = extOf(name);
  if (ext) {
    if (IMAGE.has(ext)) return 'image';
    if (AUDIO.has(ext)) return 'audio';
    if (VIDEO.has(ext)) return 'video';
    if (ext === 'pdf') return 'pdf';
    if (MARKDOWN.has(ext)) return 'markdown';
    return 'text';
  }
  const mime = String(type || '').toLowerCase();
  if (IMAGE_MIME.has(mime)) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return 'text';
}

export function isVisionImage(type) {
  return /^image\//i.test(type || '') && !/svg/i.test(type);
}

export function uploadFileOf(url) {
  const s = String(url || '');
  return s.startsWith('/uploads/') ? s.slice('/uploads/'.length).split(/[?#]/)[0] : '';
}

const subs = new Set();
export function subscribeFilePreview(fn) { subs.add(fn); return () => subs.delete(fn); }
export function openFilePreview(file) { subs.forEach(fn => fn(file)); }

const MODEL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function needsConversion(type) {
  const t = String(type || '').toLowerCase();
  return isVisionImage(t) && !MODEL_IMAGE_TYPES.has(t);
}