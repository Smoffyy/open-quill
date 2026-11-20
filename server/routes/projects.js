import path from 'path';
import multer from 'multer';
import { db, uid, now } from '../db.js';
import { authMiddleware } from '../auth.js';
import { requirePermission } from '../lib/authz/middleware.js';
import { can } from '../lib/authz/effective.js';
import { access, atLeast, sharedWith, forgetResource } from '../lib/authz/acl.js';
import * as sandbox from '../sandbox.js';
import * as projectfiles from '../lib/projectfiles.js';
import { sandboxCap, attachName, cleanPath, createEmpty, renameTo, fileInfo, sendDownload, restoreVersion, saveText, copyFiles } from '../lib/workspacefiles.js';
import { NOTES_MAX } from '../lib/projecttools.js';

function projectAt(req, res, needed = 'view') {
  const r = access(req.user, 'project', req.params.id, needed);
  if (r.error) { res.status(r.status).json({ error: r.error }); return null; }
  return r;
}

const capFor = sandboxCap;

function projectView(p, counts, level = 'owner') {
  const view = {
    id: p.id, name: p.name, description: p.description || '', instructions: p.instructions || '', notes: p.notes || '',
    notesUpdatedAt: p.notes_updated_at || 0, starred: level === 'owner' && !!p.starred, updated_at: p.updated_at, created_at: p.created_at, chatCount: counts.get(p.id) || 0,
    access: level
  };
  if (level !== 'owner') {
    const o = db.users.byId(p.user_id);
    view.owner = o ? o.display_name || (o.email || '').split('@')[0] : '';
  }
  return view;
}

const PROJECT_LIMIT = 500;
const projectUpload = multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8', limits: { fileSize: 100 * 1024 * 1024 } });

export default function registerProjectRoutes(app) {
  app.get('/api/projects', authMiddleware, (req, res) => {
    const counts = db.chats.projectCounts(req.user.id);
    const own = db.projects.byUser(req.user.id).map(p => projectView(p, counts));
    const shared = [];
    for (const [id, level] of sharedWith(req.user, 'project')) {
      const p = db.projects.byId(id);
      if (p && p.user_id !== req.user.id) shared.push(projectView(p, counts, level));
    }
    res.json([...own, ...shared]);
  });

  app.post('/api/projects', authMiddleware, requirePermission('projects.create'), (req, res) => {
    if (db.projects.countWhere('user_id', req.user.id) >= PROJECT_LIMIT) return res.status(400).json({ error: 'You have reached the project limit.' });
    const t = now();
    const name = String(req.body?.name || 'New project').slice(0, 120).trim() || 'New project';
    const description = String(req.body?.description || '').slice(0, 2000);
    const p = db.projects.insert({ id: uid(), user_id: req.user.id, name, description, instructions: '', starred: 0, created_at: t, updated_at: t });
    res.json(projectView(p, new Map()));
  });

  app.get('/api/projects/:id', authMiddleware, (req, res) => {
    const r = projectAt(req, res); if (!r) return;
    const p = r.resource;
    const row = c => ({ id: c.id, title: c.title, updated_at: c.updated_at, starred: !!c.starred });
    const all = db.chats.listByUser(req.user.id);
    const chats = all.filter(c => c.project_id === p.id).map(row);
    const sessions = all.filter(c => c.mode === 'code' && c.origin_project_id === p.id && !c.archived).map(row);
    const canShare = atLeast(r.level, 'manage') && can(req.user, 'projects.share');
    res.json({ ...projectView(p, db.chats.projectCounts(req.user.id), r.level), canShare, chats, sessions });
  });

  app.patch('/api/projects/:id', authMiddleware, (req, res) => {
    const r = projectAt(req, res); if (!r) return;
    const p = r.resource;
    const editing = ['name', 'description', 'instructions', 'notes'].some(k => k in req.body);
    if (editing && !atLeast(r.level, 'edit')) return res.status(403).json({ error: 'You can open this but not change it.' });
    const patch = editing ? { updated_at: now() } : {};
    if ('name' in req.body) patch.name = String(req.body.name || '').slice(0, 120).trim() || 'New project';
    if ('description' in req.body) patch.description = String(req.body.description || '').slice(0, 2000);
    if ('instructions' in req.body) patch.instructions = String(req.body.instructions || '').slice(0, 8000);
    if ('notes' in req.body) { patch.notes = String(req.body.notes || '').slice(0, NOTES_MAX); patch.notes_updated_at = patch.updated_at; }
    if ('starred' in req.body && r.level === 'owner') patch.starred = req.body.starred ? 1 : 0;
    if (Object.keys(patch).length) db.projects.update(p.id, patch);
    res.json(projectView(db.projects.byId(p.id), db.chats.projectCounts(req.user.id), r.level));
  });

  const fileView = (ws) => sandbox.list(ws).map(f => ({ name: f.path, size: f.size, v: f.v }));

  app.get('/api/projects/:id/files', authMiddleware, (req, res) => {
    const pr = projectAt(req, res)?.resource; if (!pr) return;
    res.json({ files: fileView(projectfiles.workspaceOfProject(pr.id)), cap: capFor(req.user) });
  });

  app.post('/api/projects/:id/files', authMiddleware, requirePermission('uploads.create'), projectUpload.single('file'), (req, res) => {
    const pr = projectAt(req, res, 'edit')?.resource; if (!pr) return;
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    const ws = projectfiles.workspaceOfProject(pr.id);
    const p = cleanPath(ws, req.body?.path || path.basename(String(req.file.originalname || 'file')));
    if (!p.ok) return res.status(400).json({ error: p.error });
    const r = sandbox.importBuffer(ws, p.rel, req.file.buffer, capFor(req.user));
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ file: { name: p.rel, size: req.file.buffer.length }, files: fileView(ws), cap: capFor(req.user) });
  });

  app.post('/api/projects/:id/files/new', authMiddleware, (req, res) => {
    const pr = projectAt(req, res, 'edit')?.resource; if (!pr) return;
    const ws = projectfiles.workspaceOfProject(pr.id);
    const r = createEmpty(ws, req.body?.path);
    res.status(r.status).json(r.status === 200 ? { ...r.body, files: fileView(ws), cap: capFor(req.user) } : r.body);
  });

  app.post('/api/projects/:id/files/rename', authMiddleware, (req, res) => {
    const pr = projectAt(req, res, 'edit')?.resource; if (!pr) return;
    const ws = projectfiles.workspaceOfProject(pr.id);
    const r = renameTo(ws, String(req.body?.path || ''), req.body?.to);
    res.status(r.status).json(r.status === 200 ? { ...r.body, files: fileView(ws), cap: capFor(req.user) } : r.body);
  });

  app.get('/api/projects/:id/zip', authMiddleware, (req, res) => {
    const pr = projectAt(req, res)?.resource; if (!pr) return;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${attachName(String(pr.name || 'project').replace(/[^a-zA-Z0-9_-]/g, '_'))}.zip"`);
    res.send(sandbox.zipAll(projectfiles.workspaceOfProject(pr.id)));
  });

  app.delete('/api/projects/:id/files', authMiddleware, (req, res) => {
    const pr = projectAt(req, res, 'edit')?.resource; if (!pr) return;
    const ws = projectfiles.workspaceOfProject(pr.id);
    const rel = String(req.query.path || '');
    if (rel) sandbox.deleteFile(ws, rel);
    res.json({ files: fileView(ws), cap: capFor(req.user) });
  });

  app.get('/api/projects/:id/file', authMiddleware, (req, res) => {
    const pr = projectAt(req, res)?.resource; if (!pr) return;
    const r = fileInfo(projectfiles.workspaceOfProject(pr.id), String(req.query.path || ''), parseInt(req.query.v), `/api/projects/${pr.id}`);
    res.status(r.status).json(r.body);
  });

  app.put('/api/projects/:id/file', authMiddleware, (req, res) => {
    const pr = projectAt(req, res, 'edit')?.resource; if (!pr) return;
    const ws = projectfiles.workspaceOfProject(pr.id);
    const r = saveText(ws, String(req.body?.path || ''), req.body?.text, req.body?.v, capFor(req.user));
    if (r.status === 200) db.projects.update(pr.id, { updated_at: now() });
    res.status(r.status).json(r.status === 200 ? { ...r.body, files: fileView(ws), cap: capFor(req.user) } : r.body);
  });

  app.get('/api/projects/:id/download', authMiddleware, (req, res) => {
    const pr = projectAt(req, res)?.resource; if (!pr) return;
    sendDownload(res, projectfiles.workspaceOfProject(pr.id), String(req.query.path || ''), parseInt(req.query.v));
  });

  app.post('/api/projects/:id/restore', authMiddleware, (req, res) => {
    const pr = projectAt(req, res, 'edit')?.resource; if (!pr) return;
    const ws = projectfiles.workspaceOfProject(pr.id);
    const r = restoreVersion(ws, String(req.body?.path || ''), parseInt(req.body?.v));
    res.status(r.status).json(r.status === 200 ? { ...r.body, files: fileView(ws), cap: capFor(req.user) } : r.body);
  });

  app.post('/api/projects/:id/code', authMiddleware, requirePermission('code.use', 'chats.create'), (req, res) => {
    const pr = projectAt(req, res)?.resource; if (!pr) return;
    const t = now();
    const chat = db.chats.insert({ id: uid(), user_id: req.user.id, project_id: null, title: String(pr.name || 'Project').slice(0, 120), starred: 0, sandbox: 0, mode: 'code', origin_project_id: pr.id, created_at: t, updated_at: t });
    const copied = copyFiles(projectfiles.workspaceOfProject(pr.id), sandbox.wsKey(chat), capFor(req.user));
    res.json({ id: chat.id, title: chat.title, mode: 'code', originProjectId: pr.id, updated_at: t, copied });
  });

  app.delete('/api/projects/:id', authMiddleware, (req, res) => {
    const r = projectAt(req, res); if (!r) return;
    if (r.level !== 'owner') return res.status(403).json({ error: 'Only the owner can delete this project.' });
    const p = r.resource;
    try { projectfiles.removeAll(p.id); } catch {}
    try { sandbox.remove(sandbox.projectKey(p.id)); } catch {}
    for (const c of db.chats.byProject(p.id)) {
      if (c.project_id === p.id) db.chats.update(c.id, { project_id: null });
      else if (c.origin_project_id === p.id) db.chats.update(c.id, { origin_project_id: null });
    }
    db.projects.removeById(p.id);
    forgetResource('project', p.id);
    res.json({ ok: true });
  });
}