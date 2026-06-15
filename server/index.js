import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { db, uid, now, getSetting, setSetting } from './db.js';
import { hash, check, sign, publicUser, authMiddleware, adminOnly, userFromRequest, parseCookies } from './auth.js';
import { buildMessages, streamCompletion, generateTitle, summarizeConversation } from './llm.js';
import * as sandbox from './sandbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
// single source of truth — bump the version in the root package.json
const APP_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
})();
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(parseCookies);

const UPLOADS = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
app.use('/uploads', (req, res, next) => { res.setHeader('Content-Security-Policy', "script-src 'none'; object-src 'none'"); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); }, express.static(UPLOADS));

const setCookie = (res, token) =>
  res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);

// ---------- auth ----------
app.post('/api/auth/check-email', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  res.json({ exists: !!db.users.find(u => u.email === email) });
});

const loginFails = new Map();
function loginLimited(ip) {
  const rec = loginFails.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.t > 10 * 60 * 1000) { loginFails.delete(ip); return false; }
  return rec.n >= 8;
}
function noteLoginFail(ip) {
  const rec = loginFails.get(ip);
  if (rec && Date.now() - rec.t < 10 * 60 * 1000) { rec.n++; rec.t = Date.now(); }
  else loginFails.set(ip, { n: 1, t: Date.now() });
  if (loginFails.size > 5000) loginFails.clear();
}
app.post('/api/auth/login', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (loginLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const email = (req.body.email || '').trim().toLowerCase();
  const pw = req.body.password || '';
  if (!email || pw.length < 4) return res.status(400).json({ error: 'Invalid email or password (min 4 chars).' });
  let u = db.users.find(x => x.email === email);
  if (u) {
    if (!check(pw, u.password_hash)) { noteLoginFail(ip); return res.status(401).json({ error: 'Incorrect password.' }); }
    loginFails.delete(ip);
  } else {
    const isFirst = db.users.count() === 0;
    u = db.users.insert({ id: uid(), email, password_hash: hash(pw), display_name: '', is_admin: isFirst ? 1 : 0, is_owner: isFirst ? 1 : 0, prefs: {}, created_at: now() });
  }
  setCookie(res, sign(u));
  res.json({ user: publicUser(u) });
});

app.post('/api/auth/logout', (req, res) => { setCookie(res, ''); res.json({ ok: true }); });
app.get('/api/me', authMiddleware, (req, res) => res.json({ user: publicUser(req.user) }));
app.patch('/api/me', authMiddleware, (req, res) => {
  const patch = {};
  if ('prefs' in req.body) patch.prefs = req.body.prefs;
  if ('displayName' in req.body) patch.display_name = req.body.displayName;
  db.users.update(req.user.id, patch);
  res.json({ user: publicUser(db.users.byId(req.user.id)) });
});
app.delete('/api/me/chats', authMiddleware, (req, res) => {
  const myChats = db.chats.filter(c => c.user_id === req.user.id);
  for (const c of myChats) { try { sandbox.remove(c.id); } catch {} }
  const chatIds = new Set(myChats.map(c => c.id));
  db.messages.remove(m => chatIds.has(m.chat_id));
  db.chats.remove(c => c.user_id === req.user.id);
  res.json({ ok: true, deleted: myChats.length });
});
app.delete('/api/me', authMiddleware, (req, res) => {
  const u = req.user;
  if (u.is_owner) return res.status(403).json({ error: 'The owner account cannot be deleted.' });
  const myChats = db.chats.filter(c => c.user_id === u.id);
  for (const c of myChats) { try { sandbox.remove(c.id); } catch {} }
  const chatIds = new Set(myChats.map(c => c.id));
  db.messages.remove(m => chatIds.has(m.chat_id));
  db.chats.remove(c => c.user_id === u.id);
  db.users.remove(x => x.id === u.id);
  setCookie(res, '');
  res.json({ ok: true });
});

// ---------- chats ----------
app.get('/api/chats', authMiddleware, (req, res) => {
  const list = db.chats.filter(c => c.user_id === req.user.id)
    .sort((a, b) => b.updated_at - a.updated_at)
    .map(c => ({ id: c.id, title: c.title, updated_at: c.updated_at, starred: !!c.starred, folderId: c.folder_id || null }));
  res.json(list);
});

// ---------- folders ----------
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
  const all = db.chats.filter(c => c.user_id === req.user.id).sort((a, b) => b.updated_at - a.updated_at);
  const page = all.slice(offset, offset + limit).map(c => {
    const msgs = sortedMsgs(c.id);
    let preview = '';
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user' && typeof msgs[i].content === 'string' && msgs[i].content.trim()) { preview = msgs[i].content.slice(0, 220); break; }
    }
    return { id: c.id, title: c.title, updated_at: c.updated_at, starred: !!c.starred, preview };
  });
  res.json({ chats: page, total: all.length, offset, hasMore: offset + page.length < all.length });
});
app.post('/api/chats', authMiddleware, (req, res) => {
  const t = now();
  const c = db.chats.insert({ id: uid(), user_id: req.user.id, title: 'New chat', starred: 0, sandbox: 0, created_at: t, updated_at: t });
  res.json({ id: c.id, title: c.title, updated_at: c.updated_at, starred: false });
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
      id: m.id, role: m.role, content: m.content, reasoning: m.reasoning, model_id: m.model_id, attachments: m.attachments || [],
      parentId: m.parent_id ?? null, branchIndex: sibs.findIndex(s => s.id === m.id), branchCount: sibs.length,
      siblings: sibs.map(s => s.id)
    };
  });
  res.json({ chat: { id: c.id, title: c.title, starred: !!c.starred, sandbox: !!c.sandbox, summary: c.summary || '', hasSummary: !!c.summary }, messages });
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
    if ('sandbox' in req.body) patch.sandbox = req.body.sandbox ? 1 : 0;
    if ('folderId' in req.body) {
      const fid = req.body.folderId;
      if (fid === null || fid === '') patch.folder_id = null;
      else { const f = db.folders.byId(fid); if (f && f.user_id === req.user.id) patch.folder_id = fid; }
    }
    db.chats.update(c.id, patch);
  }
  res.json({ ok: true });
});

// ---------- sandbox / artifacts ----------
function ownChat(req, res) {
  const c = db.chats.byId(req.params.id);
  if (!c || c.user_id !== req.user.id) { res.status(404).json({ error: 'not found' }); return null; }
  return c;
}
app.get('/api/chats/:id/files', authMiddleware, (req, res) => {
  const c = ownChat(req, res); if (!c) return;
  res.json({ files: sandbox.list(c.id) });
});
app.get('/api/chats/:id/file', authMiddleware, (req, res) => {
  const c = ownChat(req, res); if (!c) return;
  const rel = req.query.path || '';
  const files = sandbox.list(c.id);
  if (!files.find(f => f.path === rel)) return res.status(404).json({ error: 'not found' });
  if (sandbox.isText(rel)) {
    const versions = sandbox.listVersions(c.id, rel);
    const current = sandbox.versionOf(c.id, rel);
    const vq = parseInt(req.query.v);
    const viewing = vq && versions.includes(vq) ? vq : current;
    const text = viewing === current ? sandbox.readText(c.id, rel) : sandbox.readVersion(c.id, rel, viewing);
    return res.json({ path: rel, ext: sandbox.extOf(rel), text, v: current, viewing, versions });
  }
  res.json({ path: rel, ext: sandbox.extOf(rel), binary: true, downloadUrl: `/api/chats/${c.id}/download?path=${encodeURIComponent(rel)}` });
});
app.get('/api/chats/:id/download', authMiddleware, (req, res) => {
  const c = ownChat(req, res); if (!c) return;
  const rel = req.query.path || '';
  const files = sandbox.list(c.id);
  if (!files.find(f => f.path === rel)) return res.status(404).json({ error: 'not found' });
  const name = rel.split('/').pop();
  const vq = parseInt(req.query.v);
  const versions = sandbox.isText(rel) ? sandbox.listVersions(c.id, rel) : [];
  if (vq && versions.includes(vq) && vq !== sandbox.versionOf(c.id, rel)) {
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.send(sandbox.readVersion(c.id, rel, vq) ?? '');
  }
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(sandbox.readBuffer(c.id, rel));
});
app.get('/api/chats/:id/zip', authMiddleware, (req, res) => {
  const c = ownChat(req, res); if (!c) return;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${(c.title || 'sandbox').replace(/[^a-zA-Z0-9_-]/g, '_')}.zip"`);
  res.send(sandbox.zipAll(c.id));
});

// ---------- models (public sanitized) ----------
function shapePublic(m) {
  return {
    id: m.id, displayName: m.display_name, description: m.description,
    hasReasoning: !!m.has_reasoning, inMoreModels: !!m.in_more_models, moreModelsLabel: m.more_models_label,
    useThinkingIcon: m.use_thinking_icon !== 0, reasoningCollapsible: m.reasoning_collapsible !== 0,
    staticIcon: m.static_icon, generatingIcon: m.generating_icon, thinkingIcon: m.thinking_icon, generatingAnim: m.generating_anim || 'spin', thinkingAnim: m.thinking_anim || 'pulse',
    iconPosition: m.icon_position || 'below', hasVision: !!m.has_vision,
    sandboxAuto: !!m.sandbox_auto, sandboxAllowed: m.sandbox_allowed !== 0, dropdownIcon: m.dropdown_icon !== 0, isDefault: !!m.is_default, agentSteps: m.agent_steps || 10,
    enableSummaries: !!m.enable_summaries, numCtx: m.num_ctx || 0, summaryPadding: m.summary_padding || 0.125,
    unavailable: !!m.unavailable, unavailableReason: m.unavailable_reason || '',
    capVision: !!m.cap_vision, capReasoning: !!m.cap_reasoning, capText: !!m.cap_text, capCompact: !!m.cap_compact
  };
}
function draftModels() {
  return db.models.filter(m => m.enabled).sort((a, b) => a.sort_order - b.sort_order).map(shapePublic);
}
function publicModels() {
  const snap = getSetting('published_models', null);
  if (!Array.isArray(snap)) return draftModels();
  return snap.filter(m => m.enabled).sort((a, b) => a.sort_order - b.sort_order).map(shapePublic);
}
app.get('/api/models', authMiddleware, (req, res) => res.json(req.user.is_admin ? draftModels() : publicModels()));

// ---------- admin ----------
app.get('/api/admin/models', authMiddleware, adminOnly, (req, res) =>
  res.json(db.models.all().sort((a, b) => a.sort_order - b.sort_order)));

app.get('/api/admin/discover-models', authMiddleware, adminOnly, async (req, res) => {
  try {
    const base = (getSetting('api_base_url') || 'http://localhost:1234/v1').replace(/\/$/, '');
    const key = getSetting('api_key') || '';
    const r = await fetch(base + '/models', { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    if (!r.ok) return res.status(502).json({ error: `Backend returned ${r.status}.` });
    const j = await r.json().catch(() => ({}));
    const raw = Array.isArray(j?.data) ? j.data : (Array.isArray(j?.models) ? j.models : []);
    const ids = [...new Set(raw.map(x => (typeof x === 'string' ? x : (x?.id || x?.name))).filter(Boolean))];
    const existing = new Set(db.models.all().map(m => (m.internal_name || '').toLowerCase()));
    res.json({ models: ids.map(id => ({ id, added: existing.has(String(id).toLowerCase()) })) });
  } catch {
    res.status(502).json({ error: 'Could not reach the backend. Check the Connection settings.' });
  }
});

app.post('/api/admin/models', authMiddleware, adminOnly, (req, res) => {
  const max = db.models.all().reduce((a, m) => Math.max(a, m.sort_order || 0), 0);
  const b = req.body;
  const m = db.models.insert({
    id: uid(), display_name: b.display_name || 'New model', description: b.description || '',
    internal_name: b.internal_name || 'local-model', system_prompt: b.system_prompt || '',
    has_reasoning: b.has_reasoning ? 1 : 0, reasoning_token: b.reasoning_token || '', non_reasoning_token: b.non_reasoning_token || '',
    use_thinking_icon: b.use_thinking_icon === false ? 0 : 1, reasoning_collapsible: b.reasoning_collapsible === false ? 0 : 1,
    has_vision: b.has_vision ? 1 : 0,
    think_open: b.think_open || '', think_close: b.think_close || '',
    sandbox_auto: b.sandbox_auto ? 1 : 0, sandbox_allowed: b.sandbox_allowed === false ? 0 : 1, dropdown_icon: b.dropdown_icon === false ? 0 : 1, is_default: 0, agent_steps: Number.isInteger(b.agent_steps) ? b.agent_steps : 10,
    enable_summaries: b.enable_summaries ? 1 : 0, num_ctx: parseInt(b.num_ctx) || 0, summary_padding: typeof b.summary_padding === 'number' ? b.summary_padding : 0.125,
    in_more_models: b.in_more_models ? 1 : 0, more_models_label: b.more_models_label || 'More models',
    unavailable: b.unavailable ? 1 : 0, unavailable_reason: b.unavailable_reason || '',
    cap_vision: b.cap_vision ? 1 : 0, cap_reasoning: b.cap_reasoning ? 1 : 0, cap_text: b.cap_text ? 1 : 0, cap_compact: b.cap_compact ? 1 : 0,
    static_icon: b.static_icon || '', generating_icon: b.generating_icon || '', thinking_icon: b.thinking_icon || '',
    icon_position: b.icon_position || 'below',
    temperature: null, top_p: null, presence_penalty: null, frequency_penalty: null, repetition_penalty: null, min_p: null, top_k: null, seed: null,
    sort_order: max + 1, enabled: 1
  });
  broadcastAdminConfig();
  res.json({ id: m.id });
});

app.patch('/api/admin/models/:id', authMiddleware, adminOnly, (req, res) => {
  const cur = db.models.byId(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const str = ['display_name', 'description', 'internal_name', 'system_prompt', 'reasoning_token', 'non_reasoning_token', 'more_models_label', 'static_icon', 'generating_icon', 'thinking_icon', 'icon_position', 'think_open', 'think_close', 'generating_anim', 'thinking_anim', 'unavailable_reason'];
  const bool = ['has_reasoning', 'has_vision', 'in_more_models', 'enabled', 'sandbox_auto', 'sandbox_allowed', 'dropdown_icon', 'is_default', 'enable_summaries', 'unavailable', 'cap_vision', 'cap_reasoning', 'cap_text', 'cap_compact', 'use_thinking_icon', 'reasoning_collapsible'];
  const patch = {};
  for (const k of str) if (k in req.body) patch[k] = req.body[k];
  for (const k of bool) if (k in req.body) patch[k] = req.body[k] ? 1 : 0;
  if ('agent_steps' in req.body) patch.agent_steps = Math.max(1, parseInt(req.body.agent_steps) || 10);
  if ('num_ctx' in req.body) patch.num_ctx = Math.max(0, parseInt(req.body.num_ctx) || 0);
  if ('summary_padding' in req.body) patch.summary_padding = Math.max(0.03, Math.min(0.6, parseFloat(req.body.summary_padding) || 0.125));
  const numF = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'min_p'];
  const numI = ['top_k', 'seed'];
  for (const k of numF) if (k in req.body) { const v = req.body[k]; patch[k] = (v === '' || v == null || isNaN(Number(v))) ? null : Number(v); }
  for (const k of numI) if (k in req.body) { const v = req.body[k]; patch[k] = (v === '' || v == null || isNaN(parseInt(v))) ? null : parseInt(v); }
  // only one model can be the login default
  if (patch.is_default === 1) for (const other of db.models.all()) if (other.id !== cur.id && other.is_default) db.models.update(other.id, { is_default: 0 });
  db.models.update(cur.id, patch);
  broadcastAdminConfig();
  res.json({ ok: true });
});

app.delete('/api/admin/models/:id', authMiddleware, adminOnly, (req, res) => {
  db.models.remove(m => m.id === req.params.id);
  broadcastAdminConfig();
  res.json({ ok: true });
});

app.get('/api/admin/detect-ctx', authMiddleware, adminOnly, async (req, res) => {
  const internal = req.query.model || '';
  const base = (getSetting('api_base_url') || 'http://localhost:1234/v1').replace(/\/$/, '');
  const root = base.replace(/\/v1$/, '');
  try {
    const r = await fetch(root + '/api/v0/models', { headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) return res.json({ numCtx: 0, ok: false });
    const json = await r.json();
    const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    const hit = list.find(m => (m.id || m.key) === internal) || list.find(m => (m.id || '').includes(internal));
    const ctx = hit ? (hit.max_context_length || hit.loaded_context_length || hit.context_length || 0) : 0;
    res.json({ numCtx: parseInt(ctx) || 0, ok: !!ctx });
  } catch { res.json({ numCtx: 0, ok: false }); }
});

app.post('/api/admin/models/reorder', authMiddleware, adminOnly, (req, res) => {
  (req.body.ids || []).forEach((id, i) => db.models.update(id, { sort_order: i }));
  broadcastAdminConfig();
  res.json({ ok: true });
});

// publish the current draft (full model rows) to all clients
app.post('/api/admin/models/publish', authMiddleware, adminOnly, (req, res) => {
  const snapshot = db.models.all().map(m => ({ ...m }));
  setSetting('published_models', snapshot);
  setSetting('published_at', now());
  broadcastConfig();
  res.json({ ok: true, count: snapshot.length, publishedAt: getSetting('published_at') });
});

// has the draft diverged from what is published?
app.get('/api/admin/models/publish-state', authMiddleware, adminOnly, (req, res) => {
  const snap = getSetting('published_models', null);
  const draft = db.models.all().map(m => ({ ...m }));
  const dirty = JSON.stringify(snap) !== JSON.stringify(snap === null ? null : draft);
  res.json({ published: Array.isArray(snap), dirty: snap === null ? true : dirty, publishedAt: getSetting('published_at', null) });
});

// resolve the model used to RUN a completion: admins use live draft, clients use the published snapshot
function resolveModel(modelId, isAdmin) {
  if (isAdmin) return db.models.byId(modelId);
  const snap = getSetting('published_models', null);
  if (!Array.isArray(snap)) return db.models.byId(modelId);
  return snap.find(m => m.id === modelId) || null;
}

function roleLimit(key, isAdmin, fallback) {
  const v = getSetting(key + (isAdmin ? '_admin' : '_user'));
  if (v != null) return Number(v);
  return Number(getSetting(key, String(fallback)));
}
app.get('/api/admin/settings', authMiddleware, adminOnly, (req, res) =>
  res.json({
    apiBaseUrl: getSetting('api_base_url'), apiKey: getSetting('api_key'),
    uploadLimitAdminMb: roleLimit('upload_limit_mb', true, 8),
    uploadLimitUserMb: roleLimit('upload_limit_mb', false, 8),
    sandboxLimitAdminMb: roleLimit('sandbox_limit_mb', true, 1024),
    sandboxLimitUserMb: roleLimit('sandbox_limit_mb', false, 256),
    modelQueue: getSetting('model_queue', '0') === '1'
  }));
app.patch('/api/admin/settings', authMiddleware, adminOnly, (req, res) => {
  if ('apiBaseUrl' in req.body) setSetting('api_base_url', req.body.apiBaseUrl);
  if ('apiKey' in req.body) setSetting('api_key', req.body.apiKey);
  const lim = (k, v, def) => { const n = Number(v); setSetting(k, String(Number.isFinite(n) && n >= 0 ? n : def)); };
  if ('uploadLimitAdminMb' in req.body) lim('upload_limit_mb_admin', req.body.uploadLimitAdminMb, 8);
  if ('uploadLimitUserMb' in req.body) lim('upload_limit_mb_user', req.body.uploadLimitUserMb, 8);
  if ('sandboxLimitAdminMb' in req.body) lim('sandbox_limit_mb_admin', req.body.sandboxLimitAdminMb, 1024);
  if ('sandboxLimitUserMb' in req.body) lim('sandbox_limit_mb_user', req.body.sandboxLimitUserMb, 256);
  if ('modelQueue' in req.body) setSetting('model_queue', req.body.modelQueue ? '1' : '0');
  res.json({ ok: true });
});

let activeModel = null;
let activeCount = 0;
let waiters = [];
function acquireModel(modelId, onWait) {
  if (activeModel === null || activeModel === modelId) {
    if (activeModel === null) activeModel = modelId;
    activeCount++;
    return Promise.resolve();
  }
  onWait();
  return new Promise(resolve => waiters.push({ modelId, resolve }));
}
function releaseModel() {
  activeCount--;
  if (activeCount > 0) return;
  if (!waiters.length) { activeModel = null; return; }
  const next = waiters[0].modelId;
  activeModel = next; activeCount = 0;
  const stay = [];
  for (const w of waiters) { if (w.modelId === next) { activeCount++; w.resolve(); } else stay.push(w); }
  waiters = stay;
}
async function runQueued(enabled, modelId, onWait, fn) {
  if (!enabled) return fn();
  await acquireModel(modelId, onWait);
  try { return await fn(); }
  finally { releaseModel(); }
}

const diskStore = multer.diskStorage({
  destination: UPLOADS,
  filename: (_r, file, cb) => cb(null, uid() + path.extname(file.originalname || '.bin'))
});
const upload = multer({ storage: diskStore, limits: { fileSize: 8 * 1024 * 1024 } });
app.post('/api/admin/upload', authMiddleware, adminOnly, upload.single('file'), (req, res) =>
  res.json({ url: `/uploads/${req.file.filename}` }));
app.post('/api/upload', authMiddleware, (req, res) => {
  const mb = roleLimit('upload_limit_mb', !!req.user.is_admin, 8) || 8;
  const mw = multer({ storage: diskStore, limits: { fileSize: Math.max(1, mb) * 1024 * 1024 } }).array('files', 10);
  mw(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `That file is too large (max ${mb} MB).` : 'Upload failed.' });
    res.json({ files: (req.files || []).map(f => ({ url: `/uploads/${f.filename}`, name: f.originalname, type: f.mimetype, size: f.size })) });
  });
});

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.lua', '.html', '.css', '.xml', '.yml', '.yaml', '.sh', '.c', '.cpp', '.h', '.java', '.rb', '.go', '.rs', '.php', '.sql', '.ini', '.cfg', '.log']);
function isTextLike(a) {
  if (a?.type && (a.type.startsWith('text/') || a.type === 'application/json')) return true;
  return TEXT_EXT.has(path.extname(a?.name || '').toLowerCase());
}
function readUploadText(url) {
  try {
    const p = path.join(UPLOADS, path.basename(url || ''));
    if (!p.startsWith(UPLOADS)) return '';
    let t = fs.readFileSync(p, 'utf8');
    if (t.length > 20000) t = t.slice(0, 20000) + '\n... [truncated]';
    return t;
  } catch { return ''; }
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
function readImageDataUri(a) {
  try {
    const p = path.join(UPLOADS, path.basename(a.url || ''));
    if (!p.startsWith(UPLOADS)) return null;
    const mime = a.type && a.type.startsWith('image/') ? a.type : (MIME[path.extname(a.name || '').toLowerCase()] || 'image/png');
    return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
  } catch { return null; }
}

// ---------- admin: users ----------
app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  res.json(db.users.all().sort((a, b) => a.created_at - b.created_at).map(u => ({
    id: u.id, email: u.email, displayName: u.display_name || u.email.split('@')[0],
    isAdmin: !!u.is_admin, isOwner: !!u.is_owner, createdAt: u.created_at
  })));
});
app.patch('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
  const u = db.users.byId(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  if (u.is_owner) return res.status(403).json({ error: 'The top admin cannot be changed.' });
  if ('isAdmin' in req.body) db.users.update(u.id, { is_admin: req.body.isAdmin ? 1 : 0 });
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
  const u = db.users.byId(req.params.id);
  if (!u) return res.json({ ok: true });
  if (u.is_owner) return res.status(403).json({ error: 'The top admin cannot be removed.' });
  if (u.id === req.user.id) return res.status(403).json({ error: 'You cannot remove your own account here.' });
  const chatIds = new Set(db.chats.filter(c => c.user_id === u.id).map(c => c.id));
  db.messages.remove(m => chatIds.has(m.chat_id));
  db.chats.remove(c => c.user_id === u.id);
  db.users.remove(x => x.id === u.id);
  res.json({ ok: true });
});

// ---------- app customization ----------
function detectVersionIcon() {
  const dirs = [path.join(__dirname, '..', 'client', 'public'), path.join(__dirname, '..', 'client', 'dist')];
  for (const d of dirs) {
    try {
      const f = fs.readdirSync(d).find(n => /-ui-version/i.test(n) && /\.(png|svg|jpe?g|gif|webp)$/i.test(n));
      if (f) return '/' + f;
    } catch {}
  }
  return '';
}
function readVersionText() {
  const dirs = [path.join(__dirname, '..', 'client', 'public'), path.join(__dirname, '..', 'client', 'dist')];
  for (const d of dirs) {
    try {
      const files = fs.readdirSync(d);
      const f = files.find(n => /^ui-version(-text)?\.md$/i.test(n)) || files.find(n => /^ui-version-text\.txt$/i.test(n));
      if (f) { const t = fs.readFileSync(path.join(d, f), 'utf8'); if (t.trim()) return t; }
    } catch {}
  }
  return '';
}
function safeParse(v, fallback) { try { const p = JSON.parse(v); return p == null ? fallback : p; } catch { return fallback; } }
function appConfig() {
  return {
    appName: getSetting('app_name', 'open-quill'),
    disclaimer: getSetting('disclaimer', 'Assistants can make mistakes, double-check responses.'),
    greetings: (() => { const g = safeParse(getSetting('greetings', '[]'), []); return Array.isArray(g) && g.length ? g : ['How can I help you?', 'What are we building today?', 'Where should we start?']; })(),
    appIcon: getSetting('app_icon', ''),
    quickPrompts: (() => { const q = safeParse(getSetting('quick_prompts', '[]'), []); return Array.isArray(q) && q.length ? q : [{ icon: 'file', label: 'Summarize', prompt: 'Summarize the following text for me:' }, { icon: 'code', label: 'Write code', prompt: 'Help me write a small program. Ask me what it should do first.' }, { icon: 'bulb', label: 'Brainstorm', prompt: 'Help me brainstorm ideas about a topic. Ask me for the topic.' }]; })(),
    version: APP_VERSION,
    uiVersion: APP_VERSION,
    uiVersionDesc: readVersionText(),
    uiVersionIcon: detectVersionIcon()
  };
}
app.get('/api/app-config', authMiddleware, (req, res) => res.json(appConfig()));
app.patch('/api/admin/app-config', authMiddleware, adminOnly, (req, res) => {
  const b = req.body;
  if ('appName' in b) setSetting('app_name', (b.appName || 'open-quill').trim());
  if ('disclaimer' in b) setSetting('disclaimer', b.disclaimer || '');
  if ('greetings' in b) {
    const list = (Array.isArray(b.greetings) ? b.greetings : []).map(g => String(g).trim()).filter(Boolean);
    setSetting('greetings', JSON.stringify(list.length ? list : ['How can I help you?']));
  }
  if ('quickPrompts' in b) {
    const QP_ICONS = ['none', 'bulb', 'pencil', 'code', 'coffee', 'learn', 'sparkles', 'search', 'chat', 'file', 'star'];
    const list = (Array.isArray(b.quickPrompts) ? b.quickPrompts : [])
      .map(q => ({ label: String(q.label || '').trim().slice(0, 40), icon: QP_ICONS.includes(String(q.icon || '').trim()) ? String(q.icon).trim() : 'none', prompt: String(q.prompt || '').trim() }))
      .filter(q => q.label && q.prompt).slice(0, 8);
    setSetting('quick_prompts', JSON.stringify(list));
  }
  if ('appIcon' in b) setSetting('app_icon', b.appIcon || '');
  broadcastConfig();
  res.json({ ok: true });
});

// ---------- docs (credits / changelog) ----------
const DOCS = { credits: 'CREDITS.md', changelog: 'CHANGELOG.md', license: 'LICENSE' };
app.get('/api/docs/:name', authMiddleware, (req, res) => {
  const file = DOCS[req.params.name];
  if (!file) return res.status(404).json({ error: 'not found' });
  let content;
  try { content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); }
  catch { content = `# ${req.params.name}\n\n_Create \`${file}\` in the project root to populate this._`; }
  res.json({ content });
});

// ---------- static client ----------
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ---------- websocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> {userId, abort}

function broadcastConfig() {
  const msg = JSON.stringify({ type: 'config' });
  for (const ws of clients.keys()) if (ws.readyState === 1) ws.send(msg);
}
// notify only admin sessions to refresh their draft view (live editing)
function broadcastAdminConfig() {
  const msg = JSON.stringify({ type: 'config' });
  for (const [ws, st] of clients.entries()) if (ws.readyState === 1 && st.isAdmin) ws.send(msg);
}

let SKILLS_CACHE = null;
function sandboxPromptFor(chatId) {
  if (SKILLS_CACHE === null) {
    try { SKILLS_CACHE = fs.readFileSync(path.join(__dirname, 'skills', 'sandbox.md'), 'utf8'); }
    catch { SKILLS_CACHE = ''; }
  }
  let p = SKILLS_CACHE;
  const files = sandbox.list(chatId);
  if (!files.length) return p + '\n\n## Current sandbox\nThe sandbox is empty.';
  p += '\n\n## Current sandbox files\nThese are the LATEST versions on disk. Always edit these directly — never assume older content. The version number (vN) increases each time a file changes.\n';
  for (const f of files) p += `- ${f.path} (v${f.v}, ${f.size} bytes)\n`;
  p += '\n## Latest file contents\n';
  let budget = 40000;
  for (const f of files) {
    if (f.ext === 'zip' || !sandbox.isText(f.path)) continue;
    const txt = sandbox.readText(chatId, f.path) || '';
    if (txt.length > 8000 || txt.length > budget) {
      p += `\n### ${f.path} (v${f.v}) — ${f.size} bytes, too large to inline; use the view tool to read it.\n`;
      continue;
    }
    p += `\n### ${f.path} (v${f.v})\n\`\`\`${f.ext || ''}\n${txt}\n\`\`\`\n`;
    budget -= txt.length;
  }
  p += '\n---\nREMINDER: The sandbox is ON. Build directly with tool calls — use `create_file`/`str_replace` for any file or script. Do NOT paste full file contents into the chat; the user reads them in the artifacts panel.';
  return p;
}
function formatToolResult(call, r) {
  const head = `${call.tool}${call.path ? ' ' + call.path : ''}`;
  if (!r.ok) return `${head} → ERROR: ${r.error}`;
  switch (call.tool) {
    case 'create_file': return `${head} → created (v${r.v}, ${r.bytes} bytes)`;
    case 'str_replace': return `${head} → edited (now v${r.v})`;
    case 'view': return `${head} →\n${r.content}`;
    case 'list_files': return `list_files →\n${(r.files || []).map(f => `${f.path} (${f.size}b)`).join('\n') || '(empty)'}`;
    case 'delete_file': return `${head} → deleted`;
    case 'rename_file': return `${head} → renamed to ${r.path}`;
    case 'search': return `search "${call.query}" → ${r.count} match(es)` + (r.matches.length ? '\n' + r.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') : '');
    case 'extract_zip': return `extract_zip ${call.path} → ${r.count} file(s)` + (r.files && r.files.length ? ':\n' + r.files.join('\n') : '');
    case 'bundle_zip': return `bundle_zip ${r.path} → created (${r.count} files)`;
    default: return `${head} → ok`;
  }
}

// ---- conversation tree (branching) ----
function sortedMsgs(chatId) { return db.messages.filter(m => m.chat_id === chatId).sort((a, b) => a.created_at - b.created_at); }
function ensureChain(chatId) {
  const all = sortedMsgs(chatId);
  let prev = null;
  for (const m of all) { if (m.parent_id === undefined) db.messages.update(m.id, { parent_id: prev }); prev = m.id; }
  const chat = db.chats.byId(chatId);
  if (chat && !chat.active_leaf && all.length) db.chats.update(chatId, { active_leaf: all[all.length - 1].id });
}
function childrenOf(chatId, parentId) { return sortedMsgs(chatId).filter(m => (m.parent_id ?? null) === (parentId ?? null)); }
function activePath(chatId) {
  ensureChain(chatId);
  const chat = db.chats.byId(chatId);
  const all = sortedMsgs(chatId);
  const byId = new Map(all.map(m => [m.id, m]));
  let leaf = chat?.active_leaf;
  if (!leaf || !byId.has(leaf)) leaf = all.length ? all[all.length - 1].id : null;
  const path = []; const seen = new Set(); let cur = leaf;
  while (cur && byId.has(cur) && !seen.has(cur)) { seen.add(cur); path.push(byId.get(cur)); cur = byId.get(cur).parent_id; }
  return path.reverse();
}
function leafUnder(chatId, messageId) {
  let cur = db.messages.byId(messageId);
  while (cur) { const kids = childrenOf(chatId, cur.id); if (!kids.length) break; cur = kids[kids.length - 1]; }
  return cur ? cur.id : messageId;
}

// history for the active branch, minus whatever the summary already covers
function chatHistory(chat, model) {
  const fresh = db.chats.byId(chat.id) || chat;
  const upto = fresh.summary && fresh.summary_upto ? fresh.summary_upto : 0;
  let rows = activePath(chat.id);
  if (upto) rows = rows.filter(m => m.created_at > upto);
  return rows.map(m => {
    let text = m.content || '';
    const atts = m.attachments || [];
    const images = [];
    if (atts.length) {
      const notes = [];
      for (const a of atts) {
        const isImage = a.type && a.type.startsWith('image/');
        if (isImage && model.has_vision) { const uri = readImageDataUri(a); if (uri) images.push(uri); }
        else if (isTextLike(a)) notes.push(`--- Attached file: ${a.name} ---\n${readUploadText(a.url)}`);
        else notes.push(`[Attached ${isImage ? 'image' : 'file'}: ${a.name}]`);
      }
      if (notes.length) text = (text ? text + '\n\n' : '') + notes.join('\n\n');
    }
    if (images.length) {
      const parts = [];
      if (text) parts.push({ type: 'text', text });
      for (const url of images) parts.push({ type: 'image_url', image_url: { url } });
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: text };
  });
}

function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) for (const p of m.content) chars += p.type === 'text' ? (p.text || '').length : 1000 * 3.5;
  }
  return Math.ceil(chars / 3.5);
}

// once we get near the context limit, fold older turns into chat.summary
// one summarization pass over older persisted turns; returns true if it compacted
async function compactStep(ws, chat, model) {
  const fresh = db.chats.byId(chat.id);
  const upto = fresh.summary && fresh.summary_upto ? fresh.summary_upto : 0;
  const after = activePath(chat.id).filter(m => m.created_at > upto);
  if (after.length <= 1) return false; // only the newest message remains; can't compact further
  const toSummarize = after.slice(0, after.length - 1); // keep newest message verbatim
  const marker = toSummarize[toSummarize.length - 1].created_at;
  try { ws.send(JSON.stringify({ type: 'compacting' })); } catch {}
  const summary = await summarizeConversation(model, fresh.summary, toSummarize);
  db.chats.update(chat.id, { summary, summary_upto: marker });
  try { ws.send(JSON.stringify({ type: 'compacted' })); } catch {}
  return !!summary;
}
function compactThreshold(model) {
  if (!model.enable_summaries || !model.num_ctx) return Infinity;
  const padding = Math.max(0.03, Math.min(0.6, model.summary_padding || 0.125));
  return Math.floor(model.num_ctx * (1 - padding));
}
function promptVars(userId) {
  const u = userId ? db.users.byId(userId) : null;
  const name = u ? (u.display_name || (u.email ? u.email.split('@')[0] : '') || 'User') : 'User';
  const now = new Date();
  let dt;
  try { dt = now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }); }
  catch { dt = now.toString(); }
  return { currentUser: name, currentDateTime: dt };
}
async function maybeCompact(ws, chat, model, extended, sandboxOn) {
  const threshold = compactThreshold(model);
  if (threshold === Infinity) return;
  let guard = 0;
  while (guard++ < 3) {
    const fresh = db.chats.byId(chat.id);
    const sandboxP = sandboxOn ? sandboxPromptFor(chat.id) : null;
    const convo = buildMessages(model, chatHistory(chat, model), extended, sandboxP, fresh.summary, promptVars(chat.user_id));
    if (estimateTokens(convo) < threshold) return;
    if (!(await compactStep(ws, chat, model))) return;
  }
}

wss.on('connection', (ws, req) => {
  const u = userFromRequest(req);
  if (!u) { ws.close(); return; }
  clients.set(ws, { userId: u.id, isAdmin: !!u.is_admin, abort: null });
  const safeSend = (s) => { if (ws.readyState === 1) { try { ws.send(s); } catch {} } };

  async function runCompletion(ws, state, chat, model, extended, sandboxOn, sandboxCap = 0) {
    await maybeCompact(ws, chat, model, extended, sandboxOn);
    const history = chatHistory(chat, model);
    const chatRow = db.chats.byId(chat.id) || chat;
    const sandboxP = () => sandboxOn ? sandboxPromptFor(chat.id) : null;
    let base = buildMessages(model, history, extended, sandboxP(), chatRow.summary, promptVars(chat.user_id));
    let inTurn = []; // assistant/tool exchanges accumulated during this response
    const assistantId = uid();
    const assistantParent = (db.chats.byId(chat.id) || {}).active_leaf || null;
    let content = '', reasoning = '';
    const controller = new AbortController();
    state.abort = controller;
    safeSend(JSON.stringify({ type: 'start', messageId: assistantId }));

    const threshold = compactThreshold(model);
    const maxSteps = sandboxOn ? (model.agent_steps || 10) : 1;
    try {
      for (let step = 0; step < maxSteps; step++) {
        // running low on context mid-response? summarize older turns, then carry on where we left off
        if (threshold !== Infinity && inTurn.length && estimateTokens([...base, ...inTurn]) >= threshold) {
          if (await compactStep(ws, chat, model)) base = buildMessages(model, chatHistory(chat, model), extended, sandboxP(), (db.chats.byId(chat.id) || {}).summary, promptVars(chat.user_id));
        }
        const convo = [...base, ...inTurn];
        let stepText = '';
        let aborted = false;
        try {
          await streamCompletion({
            model, messages: convo, signal: controller.signal,
            onEvent: (e) => {
              if (e.type === 'reasoning') { reasoning += e.text; safeSend(JSON.stringify({ type: 'reasoning', text: e.text })); }
              else { content += e.text; stepText += e.text; safeSend(JSON.stringify({ type: 'content', text: e.text })); }
            }
          });
        } catch (err) {
          if (err.name === 'AbortError') aborted = true; else throw err;
        }
        if (!sandboxOn) break;
        const calls = sandbox.parseToolCalls(stepText);
        if (calls.length) {
          const results = [];
          for (const call of calls) {
            const r = sandbox.execTool(chat.id, call, sandboxCap);
            safeSend(JSON.stringify({ type: 'tool', tool: call.tool, path: r.path || call.path || null, ok: !!r.ok, error: r.error || null }));
            results.push(formatToolResult(call, r));
          }
          safeSend(JSON.stringify({ type: 'files', chatId: chat.id, files: sandbox.list(chat.id) }));
          if (!aborted) { content += '\n\n'; safeSend(JSON.stringify({ type: 'content', text: '\n\n' })); }
          inTurn = [...inTurn, { role: 'assistant', content: stepText }, { role: 'user', content: 'Tool results:\n' + results.join('\n\n') }];
        }
        if (aborted || !calls.length) break;
      }
    } catch (err) {
      if (err.name !== 'AbortError') safeSend(JSON.stringify({ type: 'error', error: String(err.message || err) }));
    }
    state.abort = null;

    db.messages.insert({ id: assistantId, chat_id: chat.id, role: 'assistant', content, reasoning, model_id: model.id, parent_id: assistantParent, created_at: now() });
    db.chats.update(chat.id, { updated_at: now(), active_leaf: assistantId });
    safeSend(JSON.stringify({ type: 'done', messageId: assistantId }));

    const fresh = db.chats.byId(chat.id);
    const lastUser = [...history].reverse().find(h => h.role === 'user');
    const lastUserText = lastUser && (Array.isArray(lastUser.content)
      ? (lastUser.content.find(p => p.type === 'text')?.text || 'Image')
      : lastUser.content);
    const cleanContent = content.replace(/```tool[\s\S]*?```/g, '').trim();
    if (cleanContent && fresh && fresh.title === 'New chat' && lastUserText) {
      const title = await generateTitle(model, lastUserText, cleanContent);
      db.chats.update(chat.id, { title });
      safeSend(JSON.stringify({ type: 'title', chatId: chat.id, title }));
    }
  }

  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const state = clients.get(ws);
    if (!state) return;
    if (msg.type === 'stop') { state.abort?.abort(); return; }
    if (msg.type === 'incognito') {
      try {
        const model = resolveModel(msg.modelId, state.isAdmin);
        if (!model) { safeSend(JSON.stringify({ type: 'error', error: 'Invalid model.' })); safeSend(JSON.stringify({ type: 'done' })); return; }
        if (model.unavailable && !state.isAdmin) { safeSend(JSON.stringify({ type: 'error', error: (model.unavailable_reason || 'This model is currently unavailable.') })); safeSend(JSON.stringify({ type: 'done' })); return; }
        const history = (Array.isArray(msg.messages) ? msg.messages : [])
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-40)
          .map(m => ({ role: m.role, content: m.content }));
        if (!history.length || history[history.length - 1].role !== 'user') {
          safeSend(JSON.stringify({ type: 'error', error: 'Nothing to send.' })); safeSend(JSON.stringify({ type: 'done' })); return;
        }
        const messages = buildMessages(model, history, !!msg.extended, null, null, promptVars(u.id));
        const assistantId = 'inc-' + uid();
        const controller = new AbortController();
        state.abort = controller;
        safeSend(JSON.stringify({ type: 'start', messageId: assistantId }));
        try {
          await streamCompletion({
            model, messages, signal: controller.signal,
            onEvent: (e) => {
              if (e.type === 'reasoning') safeSend(JSON.stringify({ type: 'reasoning', text: e.text }));
              else safeSend(JSON.stringify({ type: 'content', text: e.text }));
            }
          });
        } catch (err) { if (err.name !== 'AbortError') safeSend(JSON.stringify({ type: 'error', error: String(err.message || err) })); }
        state.abort = null;
        safeSend(JSON.stringify({ type: 'done', messageId: assistantId }));
      } catch (err) {
        state.abort = null;
        safeSend(JSON.stringify({ type: 'error', error: String(err.message || err) }));
        safeSend(JSON.stringify({ type: 'done' }));
      }
      return;
    }
    if (msg.type !== 'chat' && msg.type !== 'regenerate' && msg.type !== 'edit') return;
    try {
      const chat = db.chats.byId(msg.chatId);
      const model = resolveModel(msg.modelId, state.isAdmin);
      if (!chat || chat.user_id !== u.id || !model) { safeSend(JSON.stringify({ type: 'error', error: 'Invalid chat or model.' })); return; }
      if (model.unavailable && !state.isAdmin) { safeSend(JSON.stringify({ type: 'error', error: (model.unavailable_reason || 'This model is currently unavailable.') })); return; }

      const sandboxCap = roleLimit('sandbox_limit_mb', !!u.is_admin, u.is_admin ? 1024 : 256) * 1024 * 1024;
      const userSandbox = !!msg.sandbox;
      if (!!chat.sandbox !== userSandbox) db.chats.update(chat.id, { sandbox: userSandbox ? 1 : 0 });
      const hasFileAttach = Array.isArray(msg.attachments) && msg.attachments.some(a => !(a.type && a.type.startsWith('image/')));
      const sandboxOn = userSandbox || (hasFileAttach && model.sandbox_allowed !== 0);
      ensureChain(chat.id);

      if (msg.type === 'regenerate') {
        const target = db.messages.byId(msg.messageId) || activePath(chat.id).slice().reverse().find(m => m.role === 'assistant');
        if (!target) { safeSend(JSON.stringify({ type: 'error', error: 'Nothing to regenerate.' })); return; }
        const parent = target.role === 'assistant' ? (target.parent_id ?? null) : target.id;
        db.chats.update(chat.id, { active_leaf: parent });
      } else if (msg.type === 'edit') {
        const orig = db.messages.byId(msg.messageId);
        if (!orig || orig.chat_id !== chat.id) { safeSend(JSON.stringify({ type: 'error', error: 'Message not found.' })); return; }
        const umid = uid();
        db.messages.insert({ id: umid, chat_id: chat.id, role: 'user', content: msg.content || '', reasoning: '', model_id: null, attachments: orig.attachments || [], parent_id: orig.parent_id ?? null, created_at: now() });
        db.chats.update(chat.id, { active_leaf: umid });
      } else {
        const parent = (db.chats.byId(chat.id) || {}).active_leaf || null;
        const umid = uid();
        db.messages.insert({ id: umid, chat_id: chat.id, role: 'user', content: msg.content, reasoning: '', model_id: null, attachments: Array.isArray(msg.attachments) ? msg.attachments : [], parent_id: parent, created_at: now() });
        db.chats.update(chat.id, { active_leaf: umid });
        if (sandboxOn && Array.isArray(msg.attachments) && msg.attachments.length) {
          for (const a of msg.attachments) {
            try {
              const fname = path.basename(a.url || '');
              const src = fname ? path.join(UPLOADS, fname) : '';
              if (src && fs.existsSync(src)) sandbox.importBuffer(chat.id, path.basename(a.name || fname || 'file'), fs.readFileSync(src), sandboxCap);
              else console.warn('[sandbox import] upload not found for', a.name, '->', src);
            } catch (e) { console.warn('[sandbox import] failed for', a && a.name, e.message); }
          }
          safeSend(JSON.stringify({ type: 'files', chatId: chat.id, files: sandbox.list(chat.id) }));
        }
      }

      const queueOn = getSetting('model_queue', '0') === '1';
      await runQueued(queueOn, model.id,
        () => { safeSend(JSON.stringify({ type: 'queued', chatId: chat.id })); },
        () => runCompletion(ws, state, chat, model, !!msg.extended, sandboxOn, sandboxCap));
    } catch (err) {
      state.abort = null;
      safeSend(JSON.stringify({ type: 'error', error: String(err.message || err) }));
      safeSend(JSON.stringify({ type: 'done' }));
    }
  });

  ws.on('error', () => {});
  ws.on('close', () => { const st = clients.get(ws); try { st?.abort?.abort(); } catch {} clients.delete(ws); });
});

server.listen(PORT, () => console.log(`open-quill running on http://localhost:${PORT}`));
