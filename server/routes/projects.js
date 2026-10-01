import path from 'path';
import multer from 'multer';
import { db, uid, now } from '../db.js';
import { authMiddleware } from '../auth.js';
import * as sandbox from '../sandbox.js';
import * as projectfiles from '../lib/projectfiles.js';
import { sandboxCap, attachName, cleanPath, createEmpty, renameTo, fileInfo, sendDownload, restoreVersion, saveText } from '../lib/workspacefiles.js';

function ownProject(req, res) {
  const p = db.projects.byId(req.params.id);
  if (!p || p.user_id !== req.user.id) { res.status(404).json({ error: 'not found' }); return null; }
  return p;
}

const capFor = sandboxCap;

function projectView(p) {
  const chats = db.chats.byUser(p.user_id).filter(c => c.project_id === p.id);
  return { id: p.id, name: p.name, description: p.description || '', instructions: p.instructions || '', starred: !!p.starred, updated_at: p.updated_at, created_at: p.created_at, chatCount: chats.length };
}

const projectUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

export default function registerProjectRoutes(app) {
  app.get('/api/projects', authMiddleware, (req, res) => {
    res.json(db.projects.byUser(req.user.id).map(projectView));
  });

  app.post('/api/projects', authMiddleware, (req, res) => {
    const t = now();
    const name = String(req.body?.name || 'New project').slice(0, 120).trim() || 'New project';
    const description = String(req.body?.description || '').slice(0, 2000);
    const p = db.projects.insert({ id: uid(), user_id: req.user.id, name, description, instructions: '', starred: 0, created_at: t, updated_at: t });
    res.json(projectView(p));
  });

  app.get('/api/projects/:id', authMiddleware, (req, res) => {
    const p = db.projects.byId(req.params.id);
    if (!p || p.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const chats = db.chats.byUser(req.user.id).filter(c => c.project_id === p.id)
      .sort((a, b) => b.updated_at - a.updated_at)
      .map(c => ({ id: c.id, title: c.title, updated_at: c.updated_at, starred: !!c.starred }));
    res.json({ ...projectView(p), chats });
  });

  app.patch('/api/projects/:id', authMiddleware, (req, res) => {
    const p = db.projects.byId(req.params.id);
    if (!p || p.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const patch = { updated_at: now() };
    if ('name' in req.body) patch.name = String(req.body.name || '').slice(0, 120).trim() || 'New project';
    if ('description' in req.body) patch.description = String(req.body.description || '').slice(0, 2000);
    if ('instructions' in req.body) patch.instructions = String(req.body.instructions || '').slice(0, 8000);
    if ('starred' in req.body) patch.starred = req.body.starred ? 1 : 0;
    db.projects.update(p.id, patch);
    res.json(projectView(db.projects.byId(p.id)));
  });

  const fileView = (ws) => sandbox.list(ws).map(f => ({ name: f.path, size: f.size, v: f.v }));

  app.get('/api/projects/:id/files', authMiddleware, (req, res) => {
    const pr = ownProject(req, res); if (!pr) return;
    res.json({ files: fileView(projectfiles.workspaceOfProject(pr.id)), cap: capFor(req.user) });
  });

  app.post('/api/projects/:id/files', authMiddleware, projectUpload.single('file'), (req, res) => {
    const pr = ownProject(req, res); if (!pr) return;
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    const ws = projectfiles.workspaceOfProject(pr.id);
    const p = cleanPath(ws, req.body?.path || path.basename(String(req.file.originalname || 'file')));
    if (!p.ok) return res.status(400).json({ error: p.error });
    const r = sandbox.importBuffer(ws, p.rel, req.file.buffer, capFor(req.user));
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ file: { name: p.rel, size: req.file.buffer.length }, files: fileView(ws), cap: capFor(req.user) });
  });

  app.post('/api/projects/:id/files/new', authMiddleware, (req, res) => {
    const pr = ownProject(req, res); if (!pr) return;
    const ws = projectfiles.workspaceOfProject(pr.id);
    const r = createEmpty(ws, req.body?.path);
    res.status(r.status).json(r.status === 200 ? { ...r.body, files: fileView(ws), cap: capFor(req.user) } : r.body);
  });

  app.post('/api/projects/:id/files/rename', authMiddleware, (req, res) => {
    const pr = ownProject(req, res); if (!pr) return;
    const ws = projectfiles.workspaceOfProject(pr.id);
    const r = renameTo(ws, String(req.body?.path || ''), req.body?.to);
    res.status(r.status).json(r.status === 200 ? { ...r.body, files: fileView(ws), cap: capFor(req.user) } : r.body);
  });

  app.get('/api/projects/:id/zip', authMiddleware, (req, res) => {
    const pr = ownProject(req, res); if (!pr) return;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${attachName(String(pr.name || 'project').replace(/[^a-zA-Z0-9_-]/g, '_'))}.zip"`);
    res.send(sandbox.zipAll(projectfiles.workspaceOfProject(pr.id)));
  });

  app.delete('/api/projects/:id/files', authMiddleware, (req, res) => {
    const pr = ownProject(req, res); if (!pr) return;
    const ws = projectfiles.workspaceOfProject(pr.id);
    const rel = String(req.query.path || '');
    if (rel) sandbox.deleteFile(ws, rel);
    res.json({ files: fileView(ws), cap: capFor(req.user) });
  });

  app.get('/api/projects/:id/file', authMiddleware, (req, res) => {
    const pr = ownProject(req, res); if (!pr) return;
    const r = fileInfo(projectfiles.workspaceOfProject(pr.id), String(req.query.path || ''), parseInt(req.query.v), `/api/projects/${pr.id}`);
    res.status(r.status).json(r.body);
  });

  app.put('/api/projects/:id/file', authMiddleware, (req, res) => {
    const pr = ownProject(req, res); if (!pr) return;
    const ws = projectfiles.workspaceOfProject(pr.id);
    const r = saveText(ws, String(req.body?.path || ''), req.body?.text, req.body?.v, capFor(req.user));
    if (r.status === 200) db.projects.update(pr.id, { updated_at: now() });
    res.status(r.status).json(r.status === 200 ? { ...r.body, files: fileView(ws), cap: capFor(req.user) } : r.body);
  });

  app.get('/api/projects/:id/download', authMiddleware, (req, res) => {
    const pr = ownProject(req, res); if (!pr) return;
    sendDownload(res, projectfiles.workspaceOfProject(pr.id), String(req.query.path || ''), parseInt(req.query.v));
  });

  app.post('/api/projects/:id/restore', authMiddleware, (req, res) => {
    const pr = ownProject(req, res); if (!pr) return;
    const ws = projectfiles.workspaceOfProject(pr.id);
    const r = restoreVersion(ws, String(req.body?.path || ''), parseInt(req.body?.v));
    res.status(r.status).json(r.status === 200 ? { ...r.body, files: fileView(ws), cap: capFor(req.user) } : r.body);
  });

  app.delete('/api/projects/:id', authMiddleware, (req, res) => {
    const p = db.projects.byId(req.params.id);
    if (!p || p.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    try { projectfiles.removeAll(p.id); } catch {}
    try { sandbox.remove(sandbox.projectKey(p.id)); } catch {}
    for (const c of db.chats.byUser(req.user.id)) { if (c.project_id === p.id) db.chats.update(c.id, { project_id: null }); }
    db.projects.removeById(p.id);
    res.json({ ok: true });
  });
}
