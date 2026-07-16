import { db, uid, now, getSetting } from '../db.js';
import { authMiddleware } from '../auth.js';
import { buildMessages } from '../llm.js';
import * as sandbox from '../sandbox.js';
import * as membank from '../membank.js';
import * as websearch from '../websearch.js';
import { purgeUploads } from '../lib/uploads.js';
import { stripToolSyntax } from '../lib/history.js';
import { sortedMsgs, ensureChain, childrenOf, activePath, leafUnder } from '../lib/tree.js';
import { modelCtx } from '../lib/models.js';
import { chatHistory, estimateTokens, calibratedTokens, tokenCalib, compactThreshold, rollingCtxFor, promptVars, instrFor } from '../lib/convo.js';

export default function registerChatRoutes(app) {
  app.get('/api/chats', authMiddleware, (req, res) => {
    const list = db.chats.byUser(req.user.id)
      .sort((a, b) => b.updated_at - a.updated_at)
      .map(c => ({ id: c.id, title: c.title, updated_at: c.updated_at, starred: !!c.starred, archived: !!c.archived, folderId: c.folder_id || null, projectId: c.project_id || null, ended: !!c.ended }));
    res.json(list);
  });

  app.get('/api/folders', authMiddleware, (req, res) => {
    const list = db.folders.filter(f => f.user_id === req.user.id)
      .sort((a, b) => (a.sort_order - b.sort_order) || (a.created_at - b.created_at))
      .map(f => ({ id: f.id, name: f.name, collapsed: !!f.collapsed, sortOrder: f.sort_order || 0 }));
    res.json(list);
  });
  app.post('/api/folders', authMiddleware, (req, res) => {
    const t = now();
    const mine = db.folders.filter(f => f.user_id === req.user.id);
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
      for (const c of db.chats.filter(c => c.user_id === req.user.id && c.folder_id === f.id)) db.chats.update(c.id, { folder_id: null });
      db.folders.remove(x => x.id === f.id);
    }
    res.json({ ok: true });
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

  app.post('/api/chats', authMiddleware, (req, res) => {
    const t = now();
    let projectId = null;
    if (req.body?.projectId) { const p = db.projects.byId(req.body.projectId); if (p && p.user_id === req.user.id) projectId = p.id; }
    const c = db.chats.insert({ id: uid(), user_id: req.user.id, project_id: projectId, title: 'New chat', starred: 0, sandbox: 0, created_at: t, updated_at: t });
    res.json({ id: c.id, title: c.title, updated_at: c.updated_at, starred: false, projectId });
  });

  app.get('/api/chats/export-all', authMiddleware, (req, res) => {
    const myChats = db.chats.filter(c => c.user_id === req.user.id).sort((a, b) => a.updated_at - b.updated_at);
    const myFolders = db.folders.filter(f => f.user_id === req.user.id);
    const folderName = new Map(myFolders.map(f => [f.id, f.name]));
    const out = {
      type: 'open-quill-chats-export', version: 2, exportedAt: new Date().toISOString(),
      chats: myChats.map(c => ({
        title: c.title, starred: !!c.starred, archived: !!c.archived, folderName: c.folder_id ? (folderName.get(c.folder_id) || null) : null,
        summary: c.summary || '',
        messages: activePath(c.id).map(m => ({ role: m.role, content: m.content || '', reasoning: m.reasoning || '', created_at: m.created_at }))
      })),
      profile: (() => {
        const u = db.users.byId(req.user.id) || {};
        return {
          instructions: u.instructions || '', memory: u.memory || '',
          styles: Array.isArray(u.styles) ? u.styles : [],
          personas: Array.isArray(u.personas) ? u.personas : [],
          savedPrompts: Array.isArray(u.saved_prompts) ? u.saved_prompts : [],
          prefs: u.prefs && typeof u.prefs === 'object' ? u.prefs : {}
        };
      })()
    };
    const safeName = 'open-quill-chats-' + new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
    res.send(JSON.stringify(out, null, 2));
  });

  app.post('/api/chats/import', authMiddleware, (req, res) => {
    const body = req.body || {};
    const bundle = Array.isArray(body.chats) ? body.chats
      : (Array.isArray(body.messages) ? [{ title: body.title, starred: false, folderName: null, summary: body.summary || '', messages: body.messages }] : null);
    if ((!bundle || !bundle.length) && !body.profile) return res.status(400).json({ error: 'Nothing to import, pick a valid open-quill export file.' });
    if (body.profile && typeof body.profile === 'object') {
      const u = db.users.byId(req.user.id) || {};
      const pf = body.profile;
      const patch = {};
      if (typeof pf.instructions === 'string' && pf.instructions.trim() && !(u.instructions || '').trim()) patch.instructions = pf.instructions.slice(0, 8000);
      if (typeof pf.memory === 'string' && pf.memory.trim() && !(u.memory || '').trim()) patch.memory = pf.memory.slice(0, 6000);
      const mergeById = (mine, theirs, cap) => {
        const out = Array.isArray(mine) ? [...mine] : [];
        const seen = new Set(out.map(x => x && x.id));
        for (const x of (Array.isArray(theirs) ? theirs : [])) {
          if (x && x.id && !seen.has(x.id) && out.length < cap) { out.push(x); seen.add(x.id); }
        }
        return out;
      };
      patch.styles = mergeById(u.styles, pf.styles, 30);
      patch.personas = mergeById(u.personas, pf.personas, 50);
      patch.saved_prompts = mergeById(u.saved_prompts, pf.savedPrompts, 100);
      if (pf.prefs && typeof pf.prefs === 'object') patch.prefs = { ...pf.prefs, ...(u.prefs || {}) };
      db.users.update(req.user.id, patch);
    }
    if (!bundle || !bundle.length) return res.json({ imported: 0, profile: true });
    const mineFolders = db.folders.filter(f => f.user_id === req.user.id);
    const folderCache = new Map(mineFolders.map(f => [f.name, f.id]));
    let maxOrder = mineFolders.reduce((m, f) => Math.max(m, f.sort_order || 0), -1);
    let imported = 0;
    for (const c of bundle.slice(0, 500)) {
      if (!c || !Array.isArray(c.messages) || !c.messages.length) continue;
      let folderId = null;
      if (c.folderName) {
        if (!folderCache.has(c.folderName)) {
          const nf = db.folders.insert({ id: uid(), user_id: req.user.id, name: String(c.folderName).slice(0, 80), collapsed: 0, sort_order: ++maxOrder, created_at: now() });
          folderCache.set(c.folderName, nf.id);
        }
        folderId = folderCache.get(c.folderName);
      }
      const t = now();
      const chat = db.chats.insert({ id: uid(), user_id: req.user.id, folder_id: folderId, title: String(c.title || 'Imported chat').slice(0, 120) || 'Imported chat', starred: c.starred ? 1 : 0, archived: c.archived ? 1 : 0, sandbox: 0, summary: String(c.summary || ''), created_at: t, updated_at: t });
      let parent = null;
      for (const m of c.messages.slice(0, 2000)) {
        if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
        const mid = uid();
        db.messages.insert({ id: mid, chat_id: chat.id, role: m.role, content: m.content, reasoning: m.reasoning || '', model_id: null, attachments: [], parent_id: parent, created_at: now() });
        parent = mid;
      }
      if (parent) { db.chats.update(chat.id, { active_leaf: parent, updated_at: now() }); imported++; }
      else db.chats.remove(x => x.id === chat.id);
    }
    res.json({ ok: true, imported });
  });

  app.get('/api/chats/:id', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const path = activePath(c.id);
    const kidsByParent = new Map();
    for (const m of sortedMsgs(c.id)) { const p = m.parent_id ?? null; if (!kidsByParent.has(p)) kidsByParent.set(p, []); kidsByParent.get(p).push(m); }
    const messages = path.map(m => {
      const sibs = kidsByParent.get(m.parent_id ?? null) || [];
      return {
        id: m.id, role: m.role, content: m.content, reasoning: m.reasoning, model_id: m.model_id, attachments: m.attachments || [], created_at: m.created_at, pinned: !!m.pinned, feedback: m.feedback || 0,
        extended: !!m.extended, reasoningEffort: m.reasoning_effort || null,
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
    for (const m of slice) {
      const nid = uid();
      const copy = { ...m, id: nid, chat_id: nc.id, parent_id: prev, created_at: ts++ };
      delete copy.active_leaf;
      db.messages.insert(copy);
      prev = nid; leaf = nid;
    }
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
    db.messages.update(m.id, patch);
    res.json({ ok: true, pinned: !!patch.pinned });
  });

  app.get('/api/chats/:id/context', authMiddleware, async (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const model = db.models.byId(req.query.modelId) || db.models.all().find(m => m.enabled) || db.models.all()[0];
    if (!model) return res.json({ used: 0, limit: 0, pct: 0, hasSummary: !!c.summary, summaries: !!c.enable_summaries });
    const convo = buildMessages(model, await chatHistory(c, model), false, null, c.summary, promptVars(c.user_id), await instrFor(c));
    const used = calibratedTokens(c.id, convo);
    const ctx = await modelCtx(model);
    const limit = ctx || parseInt(model.num_ctx) || 0;
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const rolling = !!limit && (await rollingCtxFor(model)) > 0;
    res.json({ used, limit, pct, hasSummary: !!c.summary, measured: tokenCalib.has(c.id), compacts: model.enable_summaries ? compactThreshold(model, ctx) : 0, rolling });
  });

  app.get('/api/chats/:id/inspect', authMiddleware, async (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const model = db.models.byId(req.query.modelId) || db.models.all().find(m => m.enabled) || db.models.all()[0];
    if (!model) return res.json({ segments: [], totalTokens: 0 });
    const membankOn = getSetting('membank_enabled', '0') === '1' && membank.list().length > 0;
    const memP = membankOn ? membank.promptFor(getSetting('membank_prompt', '')) : '';
    const convo = buildMessages(model, await chatHistory(c, model), false, memP || null, c.summary, promptVars(c.user_id), await instrFor(c));
    const segments = convo.map((m, i) => {
      const txt = typeof m.content === 'string' ? m.content : (m.content || []).map(p => p.type === 'text' ? p.text : '[image]').join('\n');
      return { index: i, role: m.role, tokens: estimateTokens([m]), chars: txt.length, preview: txt.slice(0, 600), hasImages: Array.isArray(m.content) && m.content.some(p => p.type === 'image_url') };
    });
    const limit = (model.enable_summaries && model.num_ctx) ? model.num_ctx : (model.num_ctx || 0);
    const total = estimateTokens(convo);
    res.json({
      segments, totalTokens: total, limit, pct: limit ? Math.min(100, Math.round((total / limit) * 100)) : 0,
      flags: { memoryBank: membankOn, webSearch: websearch.webSearchAvailable(), summary: !!c.summary }
    });
  });

  app.get('/api/chats/:id/summary', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    res.json({ summary: c.summary || '', summaryUpto: c.summary_upto || 0 });
  });
  app.patch('/api/chats/:id/summary', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const patch = {};
    if ('summary' in req.body) patch.summary = String(req.body.summary || '');
    if ('clear' in req.body && req.body.clear) { patch.summary = ''; patch.summary_upto = 0; }
    db.chats.update(c.id, patch);
    res.json({ ok: true });
  });

  app.get('/api/chats/:id/export', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const path = activePath(c.id);
    const fmt = (req.query.format || 'md').toLowerCase();
    const safeName = (c.title || 'chat').replace(/[^a-z0-9-_ ]/gi, '').trim().slice(0, 60) || 'chat';
    if (fmt === 'json') {
      const out = { title: c.title, exportedAt: new Date().toISOString(), summary: c.summary || '', messages: path.map(m => ({ role: m.role, content: m.content, reasoning: m.reasoning || '', model_id: m.model_id, attachments: (m.attachments || []).map(a => ({ name: a.name, type: a.type })), created_at: m.created_at })) };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
      return res.send(JSON.stringify(out, null, 2));
    }
    const lines = [`# ${c.title || 'Conversation'}`, '', `_Exported ${new Date().toLocaleString()}_`, ''];
    if (c.summary) { lines.push('> **Summary of earlier conversation:**', '> ' + c.summary.replace(/\n/g, '\n> '), ''); }
    for (const m of path) {
      const who = m.role === 'user' ? '🧑 User' : '🤖 Assistant';
      lines.push(`## ${who}`, '');
      if ((m.attachments || []).length) lines.push(...m.attachments.map(a => `*(attachment: ${a.name})*`), '');
      lines.push(m.content || '', '');
    }
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.md"`);
    res.send(lines.join('\n'));
  });

  app.delete('/api/chats/:id', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (c && c.user_id === req.user.id) {
      purgeUploads(c.id);
      db.messages.remove(m => m.chat_id === c.id);
      db.chats.remove(x => x.id === c.id);
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
