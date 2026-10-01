import { db } from '../db.js';
import { authMiddleware } from '../auth.js';
import * as sandbox from '../sandbox.js';
import { workspaceFor } from '../lib/projectfiles.js';
import { sandboxCap, attachName, fileInfo, sendDownload, restoreVersion, saveText } from '../lib/workspacefiles.js';
import { activeTurn } from '../lib/ws/live.js';

const wsOf = (c) => workspaceFor(c);

function ownChat(req, res) {
  const c = db.chats.byId(req.params.id);
  if (!c || c.user_id !== req.user.id) { res.status(404).json({ error: 'not found' }); return null; }
  return c;
}

const LIBRARY_PAGE = 60;
const LIBRARY_SCAN = 400;
const PREVIEW_CHARS = 600;

export default function registerArtifactRoutes(app) {
  app.get('/api/artifacts', authMiddleware, (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 120).trim().toLowerCase();
    const limit = Math.min(LIBRARY_PAGE, Math.max(1, parseInt(req.query.limit, 10) || LIBRARY_PAGE));
    const chats = db.chats.byUser(req.user.id)
      .filter(c => !c.archived)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .slice(0, LIBRARY_SCAN);
    const items = [];
    const seen = new Set();
    let scanned = 0;
    for (const c of chats) {
      if (items.length >= limit) break;
      scanned++;
      const key = wsOf(c);
      if (seen.has(key)) continue;
      seen.add(key);
      let files;
      try { files = sandbox.list(wsOf(c)); } catch { continue; }
      if (!Array.isArray(files)) continue;
      for (const f of files) {
        if (q && f.path.toLowerCase().indexOf(q) === -1 && String(c.title || '').toLowerCase().indexOf(q) === -1) continue;
        let preview = '';
        if (f.size > 0 && f.size < 512 * 1024) {
          try {
            if (sandbox.isViewableText(wsOf(c), f.path)) preview = String(sandbox.readText(wsOf(c), f.path) || '').slice(0, PREVIEW_CHARS);
          } catch { preview = ''; }
        }
        items.push({
          preview,
          id: c.id + ':' + f.path,
          chatId: c.id,
          chatTitle: c.title || '',
          path: f.path,
          name: f.path.split('/').pop(),
          ext: f.ext || '',
          size: f.size || 0,
          v: f.v || 1,
          updated_at: c.updated_at || 0
        });
        if (items.length >= limit) break;
      }
    }
    res.json({ artifacts: items, scanned, more: chats.length > scanned });
  });

  app.get('/api/chats/:id/files', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    res.json({ files: sandbox.list(wsOf(c)) });
  });

  app.get('/api/chats/:id/file', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    const r = fileInfo(wsOf(c), String(req.query.path || ''), parseInt(req.query.v), `/api/chats/${c.id}`);
    res.status(r.status).json(r.body);
  });

  app.get('/api/chats/:id/download', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    sendDownload(res, wsOf(c), String(req.query.path || ''), parseInt(req.query.v));
  });

  app.put('/api/chats/:id/file', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    if (activeTurn(c.id)) return res.status(409).json({ error: 'Wait for the reply to finish before editing files.' });
    const r = saveText(wsOf(c), String(req.body?.path || ''), req.body?.text, req.body?.v, sandboxCap(req.user));
    res.status(r.status).json(r.body);
  });

  app.post('/api/chats/:id/restore', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    const r = restoreVersion(wsOf(c), String(req.body?.path || ''), parseInt(req.body?.v));
    res.status(r.status).json(r.body);
  });

  app.get('/api/chats/:id/zip', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${attachName((c.title || 'sandbox').replace(/[^a-zA-Z0-9_-]/g, '_'))}.zip"`);
    res.send(sandbox.zipAll(wsOf(c)));
  });
}
