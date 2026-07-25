import multer from 'multer';
import { db, uid, now } from '../db.js';
import { authMiddleware } from '../auth.js';
import * as projectfiles from '../projectfiles.js';

function projectView(p) {
  const chats = db.chats.byUser(p.user_id).filter(c => c.project_id === p.id);
  return { id: p.id, name: p.name, description: p.description || '', instructions: p.instructions || '', starred: !!p.starred, updated_at: p.updated_at, created_at: p.created_at, chatCount: chats.length };
}

const projectUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

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

  app.get('/api/projects/:id/files', authMiddleware, (req, res) => {
    const pr = db.projects.byId(req.params.id);
    if (!pr || pr.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    res.json({ files: projectfiles.list(pr.id) });
  });

  app.post('/api/projects/:id/files', authMiddleware, projectUpload.single('file'), (req, res) => {
    const pr = db.projects.byId(req.params.id);
    if (!pr || pr.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    const r = projectfiles.saveUpload(pr.id, req.file.originalname, req.file.buffer);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ file: r.file, files: projectfiles.list(pr.id) });
  });

  app.delete('/api/projects/:id/files/:name', authMiddleware, (req, res) => {
    const pr = db.projects.byId(req.params.id);
    if (!pr || pr.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    projectfiles.remove(pr.id, req.params.name);
    res.json({ files: projectfiles.list(pr.id) });
  });

  app.delete('/api/projects/:id', authMiddleware, (req, res) => {
    try { projectfiles.removeAll(req.params.id); } catch {}
    const p = db.projects.byId(req.params.id);
    if (p && p.user_id === req.user.id) {
      for (const c of db.chats.byUser(req.user.id)) { if (c.project_id === p.id) db.chats.update(c.id, { project_id: null }); }
      db.projects.remove(x => x.id === p.id);
    }
    res.json({ ok: true });
  });
}
