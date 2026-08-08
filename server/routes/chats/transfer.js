import { db, uid, now, tx } from '../../db.js';
import { authMiddleware } from '../../auth.js';
import * as sandbox from '../../sandbox.js';
import { activePath } from '../../lib/tree.js';

export default function registerTransferRoutes(app) {
  app.get('/api/chats/export-all', authMiddleware, (req, res) => {
    const myChats = db.chats.oldestByUser(req.user.id);
    const out = {
      type: 'open-quill-chats-export', version: 2, exportedAt: new Date().toISOString(),
      chats: myChats.map(c => ({
        title: c.title, starred: !!c.starred, archived: !!c.archived,
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
      : (Array.isArray(body.messages) ? [{ title: body.title, starred: false, summary: body.summary || '', messages: body.messages }] : null);
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
    let imported = 0;
    for (const c of bundle.slice(0, 500)) {
      if (!c || !Array.isArray(c.messages) || !c.messages.length) continue;
      const t = now();
      const chat = db.chats.insert({ id: uid(), user_id: req.user.id, title: String(c.title || 'Imported chat').slice(0, 120) || 'Imported chat', starred: c.starred ? 1 : 0, archived: c.archived ? 1 : 0, sandbox: 0, summary: String(c.summary || ''), created_at: t, updated_at: t });
      let parent = null;
      tx(() => {
        for (const m of c.messages.slice(0, 2000)) {
          if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
          const mid = uid();
          db.messages.insert({ id: mid, chat_id: chat.id, role: m.role, content: m.content, reasoning: m.reasoning || '', model_id: null, attachments: [], parent_id: parent, created_at: now() });
          parent = mid;
        }
      });
      if (parent) { db.chats.update(chat.id, { active_leaf: parent, updated_at: now() }); imported++; }
      else db.chats.removeById(chat.id);
    }
    res.json({ ok: true, imported });
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
}
