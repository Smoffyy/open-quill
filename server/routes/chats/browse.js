import { db, uid, now, getSetting } from '../../db.js';
import { authMiddleware } from '../../auth.js';
import { buildMessages } from '../../llm/index.js';
import * as sandbox from '../../sandbox.js';
import * as membank from '../../membank.js';
import * as websearch from '../../websearch.js';
import { purgeUploads } from '../../lib/uploads.js';
import { stripToolSyntax } from '../../lib/history.js';
import { sortedMsgs, ensureChain, childrenOf, activePath, leafUnder } from '../../lib/tree.js';
import { modelCtx } from '../../lib/models.js';
import { chatHistory, estimateTokens, calibratedTokens, tokenCalib, compactThreshold, rollingCtxFor, promptVars, instrFor } from '../../lib/convo.js';

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
    const page = all.slice(offset, offset + limit).map(c => {
      const msgs = sortedMsgs(c.id);
      let preview = '';
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user' && typeof msgs[i].content === 'string' && msgs[i].content.trim()) { preview = msgs[i].content.slice(0, 220); break; }
      }
      return { id: c.id, title: c.title, updated_at: c.updated_at, starred: !!c.starred, archived: !!c.archived, ended: !!c.ended, preview };
    });
    res.json({ chats: page, total: all.length, offset, hasMore: offset + page.length < all.length });
  });

  app.get('/api/search', authMiddleware, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json({ results: [] });
    const chats = db.chats.byUser(req.user.id);
    const results = [];
    for (const c of chats) {
      let titleHit = (c.title || '').toLowerCase().includes(q);
      let snippet = '', matched = false;
      if (!titleHit) {
        const msgs = sortedMsgs(c.id);
        for (const m of msgs) {
          const text = typeof m.content === 'string' ? m.content : '';
          const i = text.toLowerCase().indexOf(q);
          if (i !== -1) { matched = true; const s = Math.max(0, i - 40); snippet = (s > 0 ? '…' : '') + text.slice(s, i + q.length + 60).trim(); break; }
        }
      }
      if (titleHit || matched) results.push({ id: c.id, title: c.title, updated_at: c.updated_at, snippet: snippet || (c.title || ''), starred: !!c.starred });
    }
    results.sort((a, b) => b.updated_at - a.updated_at);
    res.json({ results: results.slice(0, 40) });
  });
}
