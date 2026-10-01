import * as sandbox from '../sandbox.js';
import { roleLimit } from './models.js';

export const sandboxCap = (user) => roleLimit('sandbox_limit_mb', !!user.is_admin, user.is_admin ? 1024 : 256) * 1024 * 1024;

export const attachName = (name) => String(name || 'file').replace(/[\r\n"\\]/g, '_');

const exists = (ws, rel) => !!rel && sandbox.list(ws).some(f => f.path === rel);

const MAX_DEPTH = 12;
const MAX_SEGMENT = 120;
const MAX_PATH = 400;

export function cleanPath(ws, raw) {
  const segs = String(raw ?? '').replace(/\\/g, '/').split('/')
    .map(s => s.replace(/[\u0000-\u001f:*?"<>|]/g, '_').trim().slice(0, MAX_SEGMENT))
    .filter(s => s && s !== '.');
  if (!segs.length) return { ok: false, error: 'A file name is required.' };
  if (segs.length > MAX_DEPTH) return { ok: false, error: 'That path has too many folders.' };
  if (segs.some(s => s === '..' || s.startsWith('.'))) return { ok: false, error: 'Names may not start with a dot.' };
  const rel = segs.join('/');
  if (rel.length > MAX_PATH) return { ok: false, error: 'That path is too long.' };
  if (sandbox.isIgnoredRel(ws, rel)) return { ok: false, error: `${rel} is inside a folder the workspace ignores (dependencies or build output).` };
  const n = sandbox.normalizeRel(rel);
  return n.ok ? { ok: true, rel: n.rel } : { ok: false, error: n.error };
}

export function createEmpty(ws, raw) {
  const p = cleanPath(ws, raw);
  if (!p.ok) return { status: 400, body: { error: p.error } };
  if (exists(ws, p.rel)) return { status: 409, body: { error: `${p.rel} already exists.` } };
  const r = sandbox.createFile(ws, p.rel, '');
  if (!r.ok) return { status: 400, body: { error: r.error || 'Could not create the file.' } };
  return { status: 200, body: { ok: true, path: p.rel } };
}

export function renameTo(ws, rel, raw) {
  if (!exists(ws, rel)) return { status: 404, body: { error: 'not found' } };
  const p = cleanPath(ws, raw);
  if (!p.ok) return { status: 400, body: { error: p.error } };
  if (p.rel === rel) return { status: 200, body: { ok: true, path: rel } };
  if (exists(ws, p.rel)) return { status: 409, body: { error: `${p.rel} already exists.` } };
  const r = sandbox.renameFile(ws, rel, p.rel);
  if (!r.ok) return { status: 400, body: { error: r.error || 'Could not rename the file.' } };
  return { status: 200, body: { ok: true, path: p.rel } };
}

export function fileInfo(ws, rel, vq, downloadBase) {
  if (!exists(ws, rel)) return { status: 404, body: { error: 'not found' } };
  if (sandbox.isViewableText(ws, rel)) {
    const versions = sandbox.listVersions(ws, rel);
    const current = sandbox.versionOf(ws, rel);
    const viewing = vq && versions.includes(vq) ? vq : current;
    const text = viewing === current ? sandbox.readText(ws, rel) : sandbox.readVersion(ws, rel, viewing);
    return { status: 200, body: { path: rel, ext: sandbox.extOf(rel), text, v: current, viewing, versions } };
  }
  return { status: 200, body: { path: rel, ext: sandbox.extOf(rel), binary: true, downloadUrl: `${downloadBase}/download?path=${encodeURIComponent(rel)}` } };
}

export function sendDownload(res, ws, rel, vq) {
  if (!exists(ws, rel)) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Disposition', `attachment; filename="${attachName(rel.split('/').pop())}"`);
  const versions = sandbox.isText(rel) ? sandbox.listVersions(ws, rel) : [];
  if (vq && versions.includes(vq) && vq !== sandbox.versionOf(ws, rel)) return res.send(sandbox.readVersion(ws, rel, vq) ?? '');
  res.send(sandbox.readBuffer(ws, rel));
}

export function restoreVersion(ws, rel, v) {
  if (!exists(ws, rel)) return { status: 404, body: { error: 'not found' } };
  if (!sandbox.isText(rel)) return { status: 400, body: { error: 'Only text files can be restored to an older version.' } };
  if (!Number.isFinite(v) || !sandbox.listVersions(ws, rel).includes(v)) return { status: 400, body: { error: 'Unknown version.' } };
  const content = sandbox.readVersion(ws, rel, v);
  if (content == null) return { status: 404, body: { error: 'That version could not be read.' } };
  const r = sandbox.createFile(ws, rel, content);
  if (!r.ok) return { status: 400, body: { error: r.error || 'Restore failed.' } };
  return { status: 200, body: { ok: true, v: sandbox.versionOf(ws, rel), restoredFrom: v, files: sandbox.list(ws) } };
}

export function saveText(ws, rel, text, baseV, cap) {
  if (typeof text !== 'string') return { status: 400, body: { error: 'text must be a string.' } };
  if (!exists(ws, rel)) return { status: 404, body: { error: 'not found' } };
  if (!sandbox.isViewableText(ws, rel)) return { status: 400, body: { error: 'Only text files can be edited.' } };
  if (sandbox.isText(rel) && Number.isInteger(baseV) && baseV !== sandbox.versionOf(ws, rel)) {
    return { status: 409, body: { error: 'This file changed since you opened it. Reload it to see the latest version.' } };
  }
  if (cap > 0) {
    const size = sandbox.list(ws).find(f => f.path === rel)?.size || 0;
    if (sandbox.dirSize(ws) - size + Buffer.byteLength(text) > cap) {
      return { status: 400, body: { error: `Storage limit reached (${Math.round(cap / 1048576)} MB). Delete files to free space.` } };
    }
  }
  const r = sandbox.createFile(ws, rel, text);
  if (!r.ok) return { status: 400, body: { error: r.error || 'Save failed.' } };
  return { status: 200, body: { ok: true, v: sandbox.versionOf(ws, rel), files: sandbox.list(ws) } };
}
