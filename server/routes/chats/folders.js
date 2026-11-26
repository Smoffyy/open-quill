import { db, uid, now } from '../../db.js';
import { authMiddleware } from '../../auth.js';
import { requirePermission } from '../../lib/authz/middleware.js';

const MAX_FOLDERS = 50;
const MAX_NAME = 80;
const DEFAULT_NAME = 'New folder';

const cleanName = (value) => String(value ?? '').trim().slice(0, MAX_NAME) || DEFAULT_NAME;

const mine = (userId) => db.folders.where('user_id', userId)
  .sort((a, b) => (a.sort_order - b.sort_order) || (a.created_at - b.created_at));

const view = (f, counts) => ({ id: f.id, name: f.name, sortOrder: f.sort_order || 0, chatCount: counts.get(f.id) || 0 });

const owned = (req) => {
  const f = db.folders.byId(req.params.id);
  return f && f.user_id === req.user.id ? f : null;
};

export default function registerFolderRoutes(app) {
  app.get('/api/folders', authMiddleware, (req, res) => {
    const counts = db.chats.folderCounts(req.user.id);
    res.json(mine(req.user.id).map(f => view(f, counts)));
  });

  app.post('/api/folders', authMiddleware, requirePermission('chats.edit'), (req, res) => {
    const list = mine(req.user.id);
    if (list.length >= MAX_FOLDERS) return res.status(400).json({ error: `You can have at most ${MAX_FOLDERS} folders.` });
    const order = list.reduce((top, f) => Math.max(top, f.sort_order || 0), -1) + 1;
    const f = db.folders.insert({ id: uid(), user_id: req.user.id, name: cleanName(req.body?.name), sort_order: order, created_at: now() });
    res.json(view(f, new Map()));
  });

  app.put('/api/folders/order', authMiddleware, requirePermission('chats.edit'), (req, res) => {
    const list = mine(req.user.id);
    const known = new Set(list.map(f => f.id));
    const asked = Array.isArray(req.body?.ids) ? req.body.ids.filter(id => known.has(id)) : [];
    const ids = [...new Set(asked)];
    const rest = list.map(f => f.id).filter(id => !ids.includes(id));
    db.folders.reorder([...ids, ...rest]);
    res.json({ ok: true });
  });

  app.patch('/api/folders/:id', authMiddleware, requirePermission('chats.edit'), (req, res) => {
    const f = owned(req);
    if (!f) return res.status(404).json({ error: 'Folder not found.' });
    if ('name' in (req.body || {})) db.folders.update(f.id, { name: cleanName(req.body.name) });
    res.json({ ok: true });
  });

  app.delete('/api/folders/:id', authMiddleware, requirePermission('chats.edit'), (req, res) => {
    const f = owned(req);
    if (f) {
      for (const c of db.chats.where('folder_id', f.id)) {
        if (c.user_id === req.user.id) db.chats.update(c.id, { folder_id: null });
      }
      db.folders.removeById(f.id);
    }
    res.json({ ok: true });
  });
}