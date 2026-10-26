import path from 'path';
import multer from 'multer';
import { db, now } from '../db.js';
import { authMiddleware } from '../auth.js';
import * as sandbox from '../sandbox.js';
import { workspaceFor } from '../lib/projectfiles.js';
import { sandboxCap, attachName, cleanPath, createEmpty, renameTo, fileInfo, sendDownload, restoreVersion, saveText, freePath } from '../lib/workspacefiles.js';
import { workspaceOfProject } from '../lib/projectfiles.js';
import { listArtifacts } from '../lib/artifacts.js';
import { activeTurn } from '../lib/ws/live.js';

const wsOf = (c) => workspaceFor(c);
const artOf = (c) => sandbox.artifactKey(c.id);
const fileUpload = multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8', limits: { fileSize: 100 * 1024 * 1024 } });
const BUSY = 'Wait for the reply to finish before changing files.';

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
    const chats = db.chats.listByUser(req.user.id)
      .filter(c => !c.archived)
      .slice(0, LIBRARY_SCAN);
    const items = [];
    const seen = new Set();
    let scanned = 0;
    const projects = new Map(db.projects.byUser(req.user.id).map(p => [p.id, p.name]));
    const collect = (key, c, source) => {
      let files;
      try { files = sandbox.list(key); } catch { return; }
      if (!Array.isArray(files)) return;
      const label = source === 'project' ? (projects.get(c.project_id) || '') : (c.title || '');
      for (const f of files) {
        if (items.length >= limit) return;
        if (q && f.path.toLowerCase().indexOf(q) === -1 && label.toLowerCase().indexOf(q) === -1) continue;
        let preview = '';
        if (f.size > 0 && f.size < 512 * 1024) {
          try {
            if (sandbox.isText(f.path)) preview = sandbox.readHead(key, f.path, PREVIEW_CHARS * 4).slice(0, PREVIEW_CHARS);
          } catch { preview = ''; }
        }
        items.push({
          preview,
          id: key + ':' + f.path,
          chatId: c.id,
          chatTitle: label,
          source,
          projectId: c.project_id || null,
          path: f.path,
          name: f.path.split('/').pop(),
          ext: f.ext || '',
          size: f.size || 0,
          v: f.v || 1,
          updated_at: c.updated_at || 0
        });
      }
    };
    for (const c of chats) {
      if (items.length >= limit) break;
      scanned++;
      if (c.mode === 'code') {
        collect(wsOf(c), c, 'code');
        continue;
      }
      collect(artOf(c), c, 'chat');
      if (c.project_id && !seen.has(c.project_id)) {
        seen.add(c.project_id);
        collect(workspaceOfProject(c.project_id), c, 'project');
      }
    }
    res.json({ artifacts: items, scanned, more: chats.length > scanned });
  });

  app.get('/api/chats/:id/artifacts', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    res.json({ files: listArtifacts(c.id) });
  });

  app.get('/api/chats/:id/artifacts/file', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    const r = fileInfo(artOf(c), String(req.query.path || ''), parseInt(req.query.v), `/api/chats/${c.id}/artifacts`);
    res.status(r.status).json(r.body);
  });

  app.get('/api/chats/:id/artifacts/download', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    sendDownload(res, artOf(c), String(req.query.path || ''), parseInt(req.query.v));
  });

  app.get('/api/chats/:id/artifacts/zip', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${attachName((c.title || 'artifacts').replace(/[^a-zA-Z0-9_-]/g, '_'))}.zip"`);
    res.send(sandbox.zipAll(artOf(c)));
  });

  app.put('/api/chats/:id/artifacts/file', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    if (activeTurn(c.id)) return res.status(409).json({ error: 'Wait for the reply to finish before editing artifacts.' });
    const r = saveText(artOf(c), String(req.body?.path || ''), req.body?.text, req.body?.v, sandboxCap(req.user));
    res.status(r.status).json(r.body);
  });

  app.post('/api/chats/:id/artifacts/restore', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    if (activeTurn(c.id)) return res.status(409).json({ error: BUSY });
    const r = restoreVersion(artOf(c), String(req.body?.path || ''), parseInt(req.body?.v));
    res.status(r.status).json(r.body);
  });

  app.delete('/api/chats/:id/artifacts', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    if (activeTurn(c.id)) return res.status(409).json({ error: BUSY });
    const rel = String(req.query.path || '');
    if (rel && listArtifacts(c.id).some(f => f.path === rel)) sandbox.deleteFile(artOf(c), rel);
    res.json({ files: listArtifacts(c.id) });
  });

  app.post('/api/chats/:id/artifacts/save', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    const projectId = String(req.body?.projectId || c.project_id || '');
    const p = projectId ? db.projects.byId(projectId) : null;
    if (!p || p.user_id !== req.user.id) return res.status(400).json({ error: 'Choose a project to save it to.' });
    const rel = String(req.body?.path || '');
    if (!listArtifacts(c.id).some(f => f.path === rel)) return res.status(404).json({ error: 'not found' });
    const ws = workspaceOfProject(p.id);
    const dest = freePath(ws, rel);
    const r = sandbox.importBuffer(ws, dest, sandbox.readBuffer(artOf(c), rel), sandboxCap(req.user));
    if (!r.ok) return res.status(400).json({ error: r.error });
    db.projects.update(p.id, { updated_at: now() });
    res.json({ ok: true, projectId: p.id, projectName: p.name, path: dest });
  });

  app.get('/api/chats/:id/files', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    res.json({ files: sandbox.list(wsOf(c)) });
  });

  app.post('/api/chats/:id/files', authMiddleware, fileUpload.single('file'), (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    if (activeTurn(c.id)) return res.status(409).json({ error: BUSY });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    const ws = wsOf(c);
    const p = cleanPath(ws, req.body?.path || path.basename(String(req.file.originalname || 'file')));
    if (!p.ok) return res.status(400).json({ error: p.error });
    const r = sandbox.importBuffer(ws, p.rel, req.file.buffer, sandboxCap(req.user));
    if (!r.ok) return res.status(400).json({ error: r.error });
    db.chats.update(c.id, { updated_at: now() });
    res.json({ path: p.rel, files: sandbox.list(ws) });
  });

  app.post('/api/chats/:id/files/new', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    if (activeTurn(c.id)) return res.status(409).json({ error: BUSY });
    const ws = wsOf(c);
    const r = createEmpty(ws, req.body?.path);
    res.status(r.status).json(r.status === 200 ? { ...r.body, files: sandbox.list(ws) } : r.body);
  });

  app.post('/api/chats/:id/files/rename', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    if (activeTurn(c.id)) return res.status(409).json({ error: BUSY });
    const ws = wsOf(c);
    const r = renameTo(ws, String(req.body?.path || ''), req.body?.to);
    res.status(r.status).json(r.status === 200 ? { ...r.body, files: sandbox.list(ws) } : r.body);
  });

  app.delete('/api/chats/:id/files', authMiddleware, (req, res) => {
    const c = ownChat(req, res); if (!c) return;
    if (activeTurn(c.id)) return res.status(409).json({ error: BUSY });
    const ws = wsOf(c);
    const rel = String(req.query.path || '');
    if (rel) sandbox.deleteFile(ws, rel);
    res.json({ files: sandbox.list(ws) });
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