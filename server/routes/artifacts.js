import { db } from '../db.js';
import { authMiddleware } from '../auth.js';
import * as sandbox from '../sandbox.js';

const attachName = (name) => String(name || 'file').replace(/[\r\n"\\]/g, '_');

function ownChat(req, res) {
  const c = db.chats.byId(req.params.id);
  if (!c || c.user_id !== req.user.id) { res.status(404).json({ error: 'not found' }); return null; }
  return c;
}

export default function registerArtifactRoutes(app) {
  app.get('/api/chats/:id/files', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    res.json({ files: sandbox.list(c.id) });
  });

  app.get('/api/chats/:id/file', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    const rel = req.query.path || '';
    const files = sandbox.list(c.id);
    if (!files.find(f => f.path === rel)) return res.status(404).json({ error: 'not found' });
    // Viewing sniffs the bytes as well as the extension, so a file with an
    // unknown or missing extension still opens instead of being a download-only
    // dead end. Versioning still keys off the extension list, so `versions` is
    // simply empty for those and the viewer shows the current text.
    if (sandbox.isViewableText(c.id, rel)) {
      const versions = sandbox.listVersions(c.id, rel);
      const current = sandbox.versionOf(c.id, rel);
      const vq = parseInt(req.query.v);
      const viewing = vq && versions.includes(vq) ? vq : current;
      const text = viewing === current ? sandbox.readText(c.id, rel) : sandbox.readVersion(c.id, rel, viewing);
      return res.json({ path: rel, ext: sandbox.extOf(rel), text, v: current, viewing, versions });
    }
    res.json({ path: rel, ext: sandbox.extOf(rel), binary: true, downloadUrl: `/api/chats/${c.id}/download?path=${encodeURIComponent(rel)}` });
  });

  app.get('/api/chats/:id/download', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    const rel = req.query.path || '';
    const files = sandbox.list(c.id);
    if (!files.find(f => f.path === rel)) return res.status(404).json({ error: 'not found' });
    const name = attachName(rel.split('/').pop());
    const vq = parseInt(req.query.v);
    const versions = sandbox.isText(rel) ? sandbox.listVersions(c.id, rel) : [];
    if (vq && versions.includes(vq) && vq !== sandbox.versionOf(c.id, rel)) {
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      return res.send(sandbox.readVersion(c.id, rel, vq) ?? '');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(sandbox.readBuffer(c.id, rel));
  });

  app.post('/api/chats/:id/restore', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    const rel = String(req.body?.path || '');
    const v = parseInt(req.body?.v);
    const files = sandbox.list(c.id);
    if (!files.find(f => f.path === rel)) return res.status(404).json({ error: 'not found' });
    if (!sandbox.isText(rel)) return res.status(400).json({ error: 'Only text files can be restored to an older version.' });
    const versions = sandbox.listVersions(c.id, rel);
    if (!Number.isFinite(v) || !versions.includes(v)) return res.status(400).json({ error: 'Unknown version.' });
    const content = sandbox.readVersion(c.id, rel, v);
    if (content == null) return res.status(404).json({ error: 'That version could not be read.' });
    const r = sandbox.createFile(c.id, rel, content);
    if (!r.ok) return res.status(400).json({ error: r.error || 'Restore failed.' });
    res.json({ ok: true, v: sandbox.versionOf(c.id, rel), restoredFrom: v, files: sandbox.list(c.id) });
  });

  app.get('/api/chats/:id/zip', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${attachName((c.title || 'sandbox').replace(/[^a-zA-Z0-9_-]/g, '_'))}.zip"`);
    res.send(sandbox.zipAll(c.id));
  });
}
