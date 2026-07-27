import { db, uid, now, tx } from '../../db.js';
import { authMiddleware } from '../../auth.js';
import * as sandbox from '../../sandbox.js';
import { stripToolSyntax } from '../../lib/history.js';
import { ensureChain, childrenOf, activePath, leafUnder } from '../../lib/tree.js';

export default function registerMessageRoutes(app) {
  app.get('/api/chats/:id', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const path = activePath(c.id);
    const modelById = new Map(db.models.all().map(x => [x.id, x]));
    const legacyName = new Map();
    for (const m of path) {
      if (m.role !== 'assistant' || !m.model_id || m.model_name || modelById.has(m.model_id) || legacyName.has(m.model_id)) continue;
      legacyName.set(m.model_id, db.usage.nameForModel(m.model_id));
    }
    const messages = path.map(m => {
      const sibs = childrenOf(c.id, m.parent_id ?? null);
      const mm = m.model_id ? modelById.get(m.model_id) : null;
      return {
        id: m.id, role: m.role, content: m.content, reasoning: m.reasoning, model_id: m.model_id, attachments: m.attachments || [], created_at: m.created_at, pinned: !!m.pinned, excluded: !!m.excluded, steers: Array.isArray(m.steers) ? m.steers : null, feedback: m.feedback || 0,
        model_name: m.model_name || mm?.display_name || legacyName.get(m.model_id) || '', model_icon: m.model_icon || mm?.static_icon || '',
        extended: !!m.extended, reasoningEffort: m.reasoning_effort || null, kwargValues: m.kwarg_values || null,
        parentId: m.parent_id ?? null, branchIndex: sibs.findIndex(s => s.id === m.id), branchCount: sibs.length,
        siblings: sibs.map(s => s.id)
      };
    });
    res.json({ chat: { id: c.id, title: c.title, starred: !!c.starred, sandbox: !!c.sandbox, summary: c.summary || '', hasSummary: !!c.summary, projectId: c.project_id || null, instructions: c.instructions || '', pinnedFiles: Array.isArray(c.pinned_files) ? c.pinned_files : [], ended: !!c.ended, endedReason: c.ended_reason || '', genParams: c.gen_params || null, systemOverride: c.system_override || '' }, messages });
  });

  app.get('/api/chats/:id/siblings/:mid', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const m = db.messages.byId(req.params.mid);
    if (!m || m.chat_id !== c.id) return res.status(404).json({ error: 'message not found' });
    const sibs = childrenOf(c.id, m.parent_id ?? null);
    const nameById = new Map(db.models.all().map(x => [x.id, x.display_name || '']));
    res.json({
      activeId: m.id,
      siblings: sibs.map((s, i) => ({
        id: s.id, index: i, role: s.role, content: stripToolSyntax(s.content || ''), reasoning: s.reasoning || '',
        modelId: s.model_id || null, modelName: nameById.get(s.model_id) || '', created_at: s.created_at
      }))
    });
  });

  app.post('/api/chats/:id/branch', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    ensureChain(c.id);
    const start = db.messages.byId(req.body.messageId);
    if (!start || start.chat_id !== c.id) return res.status(404).json({ error: 'message not found' });
    db.chats.update(c.id, { active_leaf: leafUnder(c.id, start.id) });
    res.json({ ok: true });
  });

  app.post('/api/chats/:id/fork', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    if (c.ended) return res.status(403).json({ error: 'This conversation was ended by the assistant and cannot be continued or branched.' });
    ensureChain(c.id);
    const path = activePath(c.id);
    if (!path.length) return res.status(400).json({ error: 'empty chat' });
    const cutId = req.body.messageId;
    let cut = cutId ? path.findIndex(m => m.id === cutId) : path.length - 1;
    if (cut < 0) return res.status(404).json({ error: 'message not found' });
    const slice = path.slice(0, cut + 1);
    const t = now();
    const nc = db.chats.insert({
      id: uid(), user_id: req.user.id, project_id: c.project_id || null, folder_id: c.folder_id || null,
      title: (c.title ? c.title + ' (fork)' : 'Forked chat').slice(0, 120), starred: 0, sandbox: c.sandbox ? 1 : 0,
      summary: '', summary_upto: 0, created_at: t, updated_at: t
    });
    let prev = null, ts = t, leaf = null;
    tx(() => {
      for (const m of slice) {
        const nid = uid();
        const copy = { ...m, id: nid, chat_id: nc.id, parent_id: prev, created_at: ts++ };
        delete copy.active_leaf;
        db.messages.insert(copy);
        prev = nid; leaf = nid;
      }
    });
    db.chats.update(nc.id, { active_leaf: leaf });
    res.json({ id: nc.id, title: nc.title });
  });

  app.patch('/api/chats/:id/messages/:mid', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const m = db.messages.byId(req.params.mid);
    if (!m || m.chat_id !== c.id) return res.status(404).json({ error: 'message not found' });
    const patch = {};
    if ('pinned' in req.body) patch.pinned = req.body.pinned ? 1 : 0;
    if ('excluded' in req.body) patch.excluded = req.body.excluded ? 1 : 0;
    const saved = db.messages.update(m.id, patch);
    res.json({ ok: true, pinned: !!(saved || m).pinned, excluded: !!(saved || m).excluded });
  });

  app.delete('/api/chats/:id/messages/:mid', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    ensureChain(c.id);
    const m = db.messages.byId(req.params.mid);
    if (!m || m.chat_id !== c.id) return res.status(404).json({ error: 'message not found' });
    const cascade = req.query.cascade === '1';
    const removed = new Set([m.id]);
    if (cascade) {
      let frontier = [m.id];
      while (frontier.length) {
        const next = [];
        for (const pid of frontier) for (const kid of childrenOf(c.id, pid)) if (!removed.has(kid.id)) { removed.add(kid.id); next.push(kid.id); }
        frontier = next;
      }
    } else {
      for (const kid of childrenOf(c.id, m.id)) db.messages.update(kid.id, { parent_id: m.parent_id ?? null });
    }
    db.messages.removeByIds(removed);
    const fresh = db.chats.byId(c.id);
    if (removed.has(fresh.active_leaf)) {
      const anchor = m.parent_id ?? null;
      const roots = childrenOf(c.id, null);
      db.chats.update(c.id, { active_leaf: anchor ? leafUnder(c.id, anchor) : (roots.length ? leafUnder(c.id, roots[roots.length - 1].id) : null) });
    }
    res.json({ ok: true, removed: removed.size });
  });
}
