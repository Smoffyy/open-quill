import { db, uid, now } from '../../db.js';
import { authMiddleware } from '../../auth.js';

export default function registerFolderRoutes(app) {
  app.get('/api/folders', authMiddleware, (req, res) => {
    const list = db.folders.where('user_id', req.user.id)
      .sort((a, b) => (a.sort_order - b.sort_order) || (a.created_at - b.created_at))
      .map(f => ({ id: f.id, name: f.name, collapsed: !!f.collapsed, sortOrder: f.sort_order || 0 }));
    res.json(list);
  });
  app.post('/api/folders', authMiddleware, (req, res) => {
    const t = now();
    const mine = db.folders.where('user_id', req.user.id);
    const maxOrder = mine.reduce((m, f) => Math.max(m, f.sort_order || 0), -1);
    const name = String(req.body?.name || 'New folder').slice(0, 80).trim() || 'New folder';
    const f = db.folders.insert({ id: uid(), user_id: req.user.id, name, collapsed: 0, sort_order: maxOrder + 1, created_at: t });
    res.json({ id: f.id, name: f.name, collapsed: false, sortOrder: f.sort_order });
  });
  app.patch('/api/folders/:id', authMiddleware, (req, res) => {
    const f = db.folders.byId(req.params.id);
    if (!f || f.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const patch = {};
    if ('name' in req.body) patch.name = String(req.body.name || '').slice(0, 80).trim() || 'New folder';
    if ('collapsed' in req.body) patch.collapsed = req.body.collapsed ? 1 : 0;
    if ('sortOrder' in req.body) patch.sort_order = parseInt(req.body.sortOrder) || 0;
    db.folders.update(f.id, patch);
    res.json({ ok: true });
  });
  app.delete('/api/folders/:id', authMiddleware, (req, res) => {
    const f = db.folders.byId(req.params.id);
    if (f && f.user_id === req.user.id) {
      // chats in this folder fall back to the default (no folder)
      for (const c of db.chats.where('folder_id', f.id)) { if (c.user_id === req.user.id) db.chats.update(c.id, { folder_id: null }); }
      db.folders.removeById(f.id);
    }
    res.json({ ok: true });
  });
}
