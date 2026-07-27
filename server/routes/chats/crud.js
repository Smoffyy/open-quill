import { db, uid, now } from '../../db.js';
import { authMiddleware } from '../../auth.js';
import * as sandbox from '../../sandbox.js';
import { purgeUploads } from '../../lib/uploads.js';

export default function registerCrudRoutes(app) {
  app.post('/api/chats', authMiddleware, (req, res) => {
    const t = now();
    let projectId = null;
    if (req.body?.projectId) { const p = db.projects.byId(req.body.projectId); if (p && p.user_id === req.user.id) projectId = p.id; }
    const c = db.chats.insert({ id: uid(), user_id: req.user.id, project_id: projectId, title: 'New chat', starred: 0, sandbox: 0, created_at: t, updated_at: t });
    res.json({ id: c.id, title: c.title, updated_at: c.updated_at, starred: false, projectId });
  });

  app.delete('/api/chats/:id', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (c && c.user_id === req.user.id) {
      purgeUploads(c.id);
      db.messages.removeWhere('chat_id', c.id);
      db.chats.removeById(c.id);
      sandbox.remove(c.id);
    }
    res.json({ ok: true });
  });

  app.patch('/api/chats/:id', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (c && c.user_id === req.user.id) {
      const patch = {};
      if ('title' in req.body) patch.title = req.body.title || 'New chat';
      if ('starred' in req.body) patch.starred = req.body.starred ? 1 : 0;
      if ('archived' in req.body) patch.archived = req.body.archived ? 1 : 0;
      if (req.user.is_admin && 'genParams' in req.body) {
        const g = req.body.genParams && typeof req.body.genParams === 'object' ? req.body.genParams : {};
        const out = {};
        for (const k of ['temperature', 'top_p', 'top_k', 'min_p', 'max_tokens', 'frequency_penalty', 'presence_penalty', 'repeat_penalty']) {
          const n = Number(g[k]);
          if (g[k] !== '' && g[k] != null && Number.isFinite(n)) out[k] = n;
        }
        patch.gen_params = Object.keys(out).length ? out : null;
      }
      if (req.user.is_admin && 'systemOverride' in req.body) patch.system_override = String(req.body.systemOverride || '').slice(0, 24000);
      if ('sandbox' in req.body) patch.sandbox = req.body.sandbox ? 1 : 0;
      if ('instructions' in req.body) patch.instructions = String(req.body.instructions || '').slice(0, 8000);
      if ('folderId' in req.body) {
        const fid = req.body.folderId;
        if (fid === null || fid === '') patch.folder_id = null;
        else { const f = db.folders.byId(fid); if (f && f.user_id === req.user.id) patch.folder_id = fid; }
      }
      if ('projectId' in req.body) {
        const pid = req.body.projectId;
        if (pid === null || pid === '') patch.project_id = null;
        else { const p = db.projects.byId(pid); if (p && p.user_id === req.user.id) patch.project_id = pid; }
      }
      db.chats.update(c.id, patch);
    }
    res.json({ ok: true });
  });

  app.get('/api/chats/:id/pins', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    res.json({ pins: Array.isArray(c.pinned_files) ? c.pinned_files : [] });
  });
  app.post('/api/chats/:id/pins', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const a = req.body || {};
    if (!a.url || !a.name) return res.status(400).json({ error: 'name and url required' });
    const pins = Array.isArray(c.pinned_files) ? c.pinned_files.slice() : [];
    if (!pins.some(p => p.url === a.url)) pins.push({ name: String(a.name), url: String(a.url), type: a.type ? String(a.type) : '' });
    db.chats.update(c.id, { pinned_files: pins });
    res.json({ pins });
  });
  app.delete('/api/chats/:id/pins', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const url = (req.body && req.body.url) || '';
    const pins = (Array.isArray(c.pinned_files) ? c.pinned_files : []).filter(p => p.url !== url);
    db.chats.update(c.id, { pinned_files: pins });
    res.json({ pins });
  });
}
