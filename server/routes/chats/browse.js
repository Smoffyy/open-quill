import { db } from '../../db.js';
import { authMiddleware } from '../../auth.js';

const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 60;
const MAX_RESULTS = 40;

function snippetAround(text, at, len) {
  const from = Math.max(0, at - SNIPPET_BEFORE);
  return (from > 0 ? '…' : '') + text.slice(from, at + len + SNIPPET_AFTER).trim();
}

export default function registerBrowseRoutes(app) {
  app.get('/api/chats', authMiddleware, (req, res) => {
    const list = db.chats.byUser(req.user.id)
      .sort((a, b) => b.updated_at - a.updated_at)
      .map(c => ({ id: c.id, title: c.title, updated_at: c.updated_at, starred: !!c.starred, archived: !!c.archived, folderId: c.folder_id || null, projectId: c.project_id || null, ended: !!c.ended }));
    res.json(list);
  });

  app.get('/api/chats-overview', authMiddleware, (req, res) => {
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit) || 18));
    const wantArchived = req.query.archived === '1';
    const all = db.chats.byUser(req.user.id).filter(c => !!c.archived === wantArchived).sort((a, b) => b.updated_at - a.updated_at);
    const page = all.slice(offset, offset + limit).map(c => ({
      id: c.id, title: c.title, updated_at: c.updated_at, starred: !!c.starred,
      archived: !!c.archived, ended: !!c.ended,
      preview: db.messages.lastUserText(c.id).slice(0, 220)
    }));
    res.json({ chats: page, total: all.length, offset, hasMore: offset + page.length < all.length });
  });

  app.get('/api/search', authMiddleware, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json({ results: [] });
    const chats = db.chats.byUser(req.user.id);
    const byId = new Map(chats.map(c => [c.id, c]));

    // One pass over the user's messages, keeping the earliest hit per chat, which is what
    // the old per-chat scan surfaced. Title matches win and need no message at all.
    const hits = new Map();
    for (const row of db.messages.searchForUser(req.user.id, q)) {
      if (hits.has(row.chatId) || !byId.has(row.chatId)) continue;
      const at = row.content.toLowerCase().indexOf(q);
      if (at === -1) continue;
      hits.set(row.chatId, snippetAround(row.content, at, q.length));
    }

    const results = [];
    for (const c of chats) {
      const titleHit = (c.title || '').toLowerCase().includes(q);
      const snippet = titleHit ? '' : hits.get(c.id);
      if (!titleHit && snippet === undefined) continue;
      results.push({ id: c.id, title: c.title, updated_at: c.updated_at, snippet: snippet || (c.title || ''), starred: !!c.starred });
    }
    results.sort((a, b) => b.updated_at - a.updated_at);
    res.json({ results: results.slice(0, MAX_RESULTS) });
  });
}
