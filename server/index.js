import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { db, uid, now, getSetting, setSetting } from './db.js';
import { hash, check, sign, publicUser, authMiddleware, adminOnly, userFromRequest, parseCookies, createSession, revokeSession, revokeOtherSessions, sessionFromRequest } from './auth.js';
import { buildMessages, streamCompletion, generateTitle, summarizeConversation, oneShot, stripThink } from './llm.js';
import { getProviders, resolveProvider, providerSpec, typesForClient, PROVIDER_TYPES } from './providers.js';
import { matchPreset, presetList, setCustomPresets, getCustomPresets } from './pricing.js';
import { randomSecret, verifyTotp, otpauthUri, makeRecoveryCodes, hashRecovery } from './totp.js';
import * as websearch from './websearch.js';
import * as sandbox from './sandbox.js';
import * as toolproto from './toolproto.js';
import * as membank from './membank.js';
import * as customtools from './customtools.js';
import * as customfns from './functions.js';

function stripToolSyntax(text) {
  let s = String(text || '');
  const { calls, live } = toolproto.scanTools(s);
  for (let i = calls.length - 1; i >= 0; i--) s = s.slice(0, calls[i].start) + s.slice(calls[i].end);
  if (live && live.start != null) {
    const after = toolproto.scanTools(s).live;
    if (after && after.start != null) {
      const oi = s.indexOf('[[OQR:', after.start);
      s = s.slice(0, after.start) + (oi === -1 ? '' : s.slice(oi));
    }
  }
  return s.replace(/\[\[OQR:[A-Za-z0-9+/=]+\]\]/g, '').replace(/```tool[\s\S]*?```/g, '');
}

function compactAssistant(text, eofCloses) {
  const s = String(text || '');
  const { calls } = toolproto.scanTools(s, { eofCloses });
  if (!calls.length) return s;
  let out = '', cursor = 0;
  for (const { call, start, end } of calls) {
    out += s.slice(cursor, start);
    const ref = call.path || call.cmd || call.query || call.name || '';
    out += `[${call.tool}${ref ? ' ' + ref : ''}]`;
    cursor = end;
  }
  out += s.slice(cursor);
  return out;
}

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

const UPLOADS = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
app.use('/uploads', (req, res, next) => { res.setHeader('Content-Security-Policy', "script-src 'none'; object-src 'none'"); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); }, express.static(UPLOADS));

const setCookie = (res, token) =>
  res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);

const AUDIT_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;
function clientIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '').trim().slice(0, 64);
}
function logAudit(req, action, target = {}) {
  try {
    db.audit.insert({
      id: uid(), ts: now(), actor_id: req.user?.id || null,
      actor_email: req.user?.email || 'system', action,
      target_type: target.type || null, target_id: target.id || null,
      meta: target.meta || null, ip: clientIp(req)
    });
  } catch {}
}
function pruneAudit() {
  try { db.audit.prune(now() - AUDIT_RETENTION_MS); } catch {}
}

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
app.post('/api/auth/login', async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (loginLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const email = (req.body.email || '').trim().toLowerCase();
  const pw = req.body.password || '';
  if (!email || pw.length < 4) return res.status(400).json({ error: 'Invalid email or password (min 4 chars).' });
  let u = db.users.find(x => x.email === email);
  if (u) {
    if (!(await check(pw, u.password_hash))) { noteLoginFail(ip); return res.status(401).json({ error: 'Incorrect password.' }); }
    loginFails.delete(ip);
    if (u.totp_enabled && u.totp_secret) {
      const code = String(req.body.code || '').trim();
      const recovery = String(req.body.recovery || '').trim();
      if (!code && !recovery) return res.status(401).json({ error: 'two-factor required', twoFactor: true });
      let ok = false;
      if (code) ok = verifyTotp(u.totp_secret, code);
      if (!ok && recovery) {
        const h = hashRecovery(recovery);
        const left = (u.recovery_codes || []).filter(c => c !== h);
        if (left.length !== (u.recovery_codes || []).length) { ok = true; db.users.update(u.id, { recovery_codes: left }); }
      }
      if (!ok) { noteLoginFail(ip); return res.status(401).json({ error: 'Invalid two-factor code.', twoFactor: true }); }
    }
  } else {
    const isFirst = db.users.count() === 0;
    u = db.users.insert({ id: uid(), email, password_hash: await hash(pw), display_name: '', is_admin: isFirst ? 1 : 0, is_owner: isFirst ? 1 : 0, prefs: {}, created_at: now() });
  }
  const sid = createSession(u, req);
  setCookie(res, sign(u, sid));
  res.json({ user: publicUser(u) });
});

app.post('/api/auth/logout', (req, res) => {
  const r = sessionFromRequest(req);
  if (r?.sessionId) revokeSession(r.sessionId);
  setCookie(res, '');
  res.json({ ok: true });
});
app.get('/api/me', authMiddleware, (req, res) => res.json({ user: publicUser(req.user) }));
app.patch('/api/me', authMiddleware, (req, res) => {
  const patch = {};
  if ('prefs' in req.body) patch.prefs = req.body.prefs;
  if ('displayName' in req.body) patch.display_name = req.body.displayName;
  if ('instructions' in req.body) patch.instructions = String(req.body.instructions || '').slice(0, 8000);
  db.users.update(req.user.id, patch);
  res.json({ user: publicUser(db.users.byId(req.user.id)) });
});
app.put('/api/me/personas', authMiddleware, (req, res) => {
  const list = (Array.isArray(req.body.personas) ? req.body.personas : [])
    .map(p => ({
      id: String(p.id || uid()).slice(0, 40),
      name: String(p.name || '').trim().slice(0, 60),
      modelId: p.modelId ? String(p.modelId).slice(0, 40) : null,
      instructions: String(p.instructions || '').trim().slice(0, 8000)
    }))
    .filter(p => p.name).slice(0, 50);
  db.users.update(req.user.id, { personas: list });
  res.json({ personas: list });
});
app.put('/api/me/prompts', authMiddleware, (req, res) => {
  const list = (Array.isArray(req.body.prompts) ? req.body.prompts : [])
    .map(p => ({ id: String(p.id || uid()).slice(0, 40), title: String(p.title || '').trim().slice(0, 80), text: String(p.text || '').trim().slice(0, 8000) }))
    .filter(p => p.title && p.text).slice(0, 50);
  db.users.update(req.user.id, { saved_prompts: list });
  res.json({ savedPrompts: list });
});
app.get('/api/me/usage', authMiddleware, (req, res) => {
  const windows = { '7': 7, '30': 30, '90': 90 };
  const days = windows[String(req.query.days)] || null;
  const since = days ? now() - days * 24 * 60 * 60 * 1000 : 0;
  const rows = db.usage.byUser(req.user.id).filter(r => (r.created_at || 0) >= since);
  const byModel = new Map();
  const byDay = new Map();
  let tp = 0, tc = 0, tcost = 0, priced = 0;
  for (const r of rows) {
    const p = r.prompt || 0, c = r.completion || 0, cost = r.cost || 0;
    tp += p; tc += c; tcost += cost;
    const hasPrice = (r.cost_in != null && r.cost_in !== 0) || (r.cost_out != null && r.cost_out !== 0) || cost > 0;
    if (hasPrice) priced++;
    const key = r.model_id || 'unknown';
    const e = byModel.get(key) || { modelId: key, modelName: r.model_name || 'Unknown', prompt: 0, completion: 0, cost: 0, count: 0, priced: false };
    e.prompt += p; e.completion += c; e.cost += cost; e.count++;
    if (hasPrice) e.priced = true;
    if (r.model_name) e.modelName = r.model_name;
    byModel.set(key, e);
    const dayKey = new Date(r.created_at || 0).toISOString().slice(0, 10);
    const d = byDay.get(dayKey) || { day: dayKey, prompt: 0, completion: 0, cost: 0 };
    d.prompt += p; d.completion += c; d.cost += cost;
    byDay.set(dayKey, d);
  }
  const models = [...byModel.values()].sort((a, b) => (b.prompt + b.completion) - (a.prompt + a.completion));
  const daily = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-30);
  res.json({
    totals: { prompt: tp, completion: tc, total: tp + tc, cost: tcost, generations: rows.length, costKnown: priced === rows.length },
    models, daily, window: days || 'all'
  });
});
app.get('/api/me/sessions', authMiddleware, (req, res) => {
  const list = db.sessions.byUser(req.user.id).map(s => ({
    id: s.id, current: s.id === req.sessionId, ip: s.ip || '', userAgent: s.user_agent || '',
    lastSeen: s.last_seen || 0, createdAt: s.created_at || 0
  }));
  res.json({ sessions: list });
});
app.delete('/api/me/sessions/:id', authMiddleware, (req, res) => {
  const s = db.sessions.byId(req.params.id);
  if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
  revokeSession(s.id);
  killSessionSockets(s.id);
  res.json({ ok: true });
});
app.delete('/api/me/sessions', authMiddleware, (req, res) => {
  const others = db.sessions.byUser(req.user.id).filter(s => s.id !== req.sessionId);
  revokeOtherSessions(req.user.id, req.sessionId);
  for (const s of others) killSessionSockets(s.id);
  res.json({ ok: true, revoked: others.length });
});
function monthStartMs() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
function monthSpend(userId) {
  const since = monthStartMs();
  let cost = 0;
  for (const r of db.usage.byUser(userId)) if ((r.created_at || 0) >= since) cost += r.cost || 0;
  return cost;
}
function budgetConfig() {
  return {
    user: Number(getSetting('budget_user', 0)) || 0,
    admin: Number(getSetting('budget_admin', 0)) || 0,
    warnFraction: Math.min(0.99, Math.max(0.1, Number(getSetting('budget_warn_fraction', 0.8)) || 0.8)),
    enforce: getSetting('budget_enforce', '0') === '1'
  };
}
function budgetFor(user) {
  if (user.budget != null && Number(user.budget) >= 0) return Number(user.budget);
  const cfg = budgetConfig();
  return user.is_admin ? cfg.admin : cfg.user;
}
function budgetStatus(user) {
  const cap = budgetFor(user);
  const cfg = budgetConfig();
  const spent = monthSpend(user.id);
  if (!cap) return { cap: 0, spent, fraction: 0, state: 'none', enforce: false };
  const fraction = spent / cap;
  let state = 'ok';
  if (fraction >= 1) state = 'over';
  else if (fraction >= cfg.warnFraction) state = 'warn';
  return { cap, spent, fraction, state, enforce: cfg.enforce };
}
app.get('/api/me/budget', authMiddleware, (req, res) => res.json(budgetStatus(req.user)));

app.post('/api/me/password', authMiddleware, async (req, res) => {
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');
  if (next.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters.' });
  if (!(await check(current, req.user.password_hash))) return res.status(401).json({ error: 'Current password is incorrect.' });
  db.users.update(req.user.id, { password_hash: await hash(next) });
  revokeOtherSessions(req.user.id, req.sessionId);
  logAudit(req, 'account.password_change', { type: 'user', id: req.user.id });
  res.json({ ok: true });
});

app.post('/api/me/2fa/setup', authMiddleware, (req, res) => {
  if (req.user.totp_enabled) return res.status(400).json({ error: 'Two-factor is already enabled.' });
  const secret = randomSecret();
  db.users.update(req.user.id, { totp_pending: secret });
  const appName = getSetting('app_name', 'open-quill') || 'open-quill';
  res.json({ secret, otpauth: otpauthUri(secret, req.user.email, appName) });
});
app.post('/api/me/2fa/enable', authMiddleware, (req, res) => {
  const u = db.users.byId(req.user.id);
  if (u.totp_enabled) return res.status(400).json({ error: 'Two-factor is already enabled.' });
  if (!u.totp_pending) return res.status(400).json({ error: 'Start setup first.' });
  if (!verifyTotp(u.totp_pending, String(req.body?.code || '').trim())) return res.status(401).json({ error: 'That code is not valid. Check your authenticator and try again.' });
  const codes = makeRecoveryCodes();
  db.users.update(u.id, { totp_secret: u.totp_pending, totp_enabled: 1, totp_pending: null, recovery_codes: codes.map(hashRecovery) });
  logAudit(req, 'account.2fa_enable', { type: 'user', id: u.id });
  res.json({ ok: true, recoveryCodes: codes });
});
app.post('/api/me/2fa/disable', authMiddleware, async (req, res) => {
  const u = db.users.byId(req.user.id);
  if (!u.totp_enabled) return res.json({ ok: true });
  if (!(await check(String(req.body?.password || ''), u.password_hash))) return res.status(401).json({ error: 'Password is incorrect.' });
  db.users.update(u.id, { totp_secret: null, totp_enabled: 0, totp_pending: null, recovery_codes: [] });
  logAudit(req, 'account.2fa_disable', { type: 'user', id: u.id });
  res.json({ ok: true });
});
app.post('/api/me/2fa/recovery', authMiddleware, async (req, res) => {
  const u = db.users.byId(req.user.id);
  if (!u.totp_enabled) return res.status(400).json({ error: 'Two-factor is not enabled.' });
  if (!(await check(String(req.body?.password || ''), u.password_hash))) return res.status(401).json({ error: 'Password is incorrect.' });
  const codes = makeRecoveryCodes();
  db.users.update(u.id, { recovery_codes: codes.map(hashRecovery) });
  logAudit(req, 'account.2fa_recovery', { type: 'user', id: u.id });
  res.json({ ok: true, recoveryCodes: codes });
});

app.delete('/api/me/chats', authMiddleware, (req, res) => {
  const myChats = db.chats.filter(c => c.user_id === req.user.id);
  for (const c of myChats) { try { sandbox.remove(c.id); } catch {} }
  const chatIds = new Set(myChats.map(c => c.id));
  purgeUploads(chatIds);
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
  purgeUploads(chatIds);
  db.messages.remove(m => chatIds.has(m.chat_id));
  db.chats.remove(c => c.user_id === u.id);
  removeUserFromSpaces(u.id);
  db.sessions.remove(s => s.user_id === u.id);
  db.users.remove(x => x.id === u.id);
  setCookie(res, '');
  res.json({ ok: true });
});

app.get('/api/users/search', authMiddleware, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const out = db.users.filter(u => u.id !== req.user.id && ((u.email || '').toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q)))
    .slice(0, 10)
    .map(u => ({ id: u.id, email: u.email, displayName: u.display_name || u.email.split('@')[0] }));
  res.json(out);
});

// ---------- chats ----------
app.get('/api/chats', authMiddleware, (req, res) => {
  const list = db.chats.byUser(req.user.id)
    .sort((a, b) => b.updated_at - a.updated_at)
    .map(c => ({ id: c.id, title: c.title, updated_at: c.updated_at, starred: !!c.starred, folderId: c.folder_id || null, projectId: c.project_id || null }));
  res.json(list);
});

// ---------- projects ----------
function projectView(p) {
  const chats = db.chats.filter(c => c.user_id === p.user_id && c.project_id === p.id);
  return { id: p.id, name: p.name, description: p.description || '', instructions: p.instructions || '', starred: !!p.starred, updated_at: p.updated_at, created_at: p.created_at, chatCount: chats.length };
}
app.get('/api/projects', authMiddleware, (req, res) => {
  res.json(db.projects.byUser(req.user.id).map(projectView));
});
app.post('/api/projects', authMiddleware, (req, res) => {
  const t = now();
  const name = String(req.body?.name || 'New project').slice(0, 120).trim() || 'New project';
  const description = String(req.body?.description || '').slice(0, 2000);
  const p = db.projects.insert({ id: uid(), user_id: req.user.id, name, description, instructions: '', starred: 0, created_at: t, updated_at: t });
  res.json(projectView(p));
});
app.get('/api/projects/:id', authMiddleware, (req, res) => {
  const p = db.projects.byId(req.params.id);
  if (!p || p.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
  const chats = db.chats.filter(c => c.user_id === req.user.id && c.project_id === p.id)
    .sort((a, b) => b.updated_at - a.updated_at)
    .map(c => ({ id: c.id, title: c.title, updated_at: c.updated_at, starred: !!c.starred }));
  res.json({ ...projectView(p), chats });
});
app.patch('/api/projects/:id', authMiddleware, (req, res) => {
  const p = db.projects.byId(req.params.id);
  if (!p || p.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
  const patch = { updated_at: now() };
  if ('name' in req.body) patch.name = String(req.body.name || '').slice(0, 120).trim() || 'New project';
  if ('description' in req.body) patch.description = String(req.body.description || '').slice(0, 2000);
  if ('instructions' in req.body) patch.instructions = String(req.body.instructions || '').slice(0, 8000);
  if ('starred' in req.body) patch.starred = req.body.starred ? 1 : 0;
  db.projects.update(p.id, patch);
  res.json(projectView(db.projects.byId(p.id)));
});
app.delete('/api/projects/:id', authMiddleware, (req, res) => {
  const p = db.projects.byId(req.params.id);
  if (p && p.user_id === req.user.id) {
    for (const c of db.chats.filter(c => c.user_id === req.user.id && c.project_id === p.id)) db.chats.update(c.id, { project_id: null });
    db.projects.remove(x => x.id === p.id);
  }
  res.json({ ok: true });
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
  const all = db.chats.byUser(req.user.id).sort((a, b) => b.updated_at - a.updated_at);
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
    type: 'open-quill-chats-export', version: 1, exportedAt: new Date().toISOString(),
    chats: myChats.map(c => ({
      title: c.title, starred: !!c.starred, folderName: c.folder_id ? (folderName.get(c.folder_id) || null) : null,
      summary: c.summary || '',
      messages: activePath(c.id).map(m => ({ role: m.role, content: m.content || '', reasoning: m.reasoning || '', created_at: m.created_at }))
    }))
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
  if (!bundle || !bundle.length) return res.status(400).json({ error: 'Nothing to import — pick a valid open-quill export file.' });
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
    const chat = db.chats.insert({ id: uid(), user_id: req.user.id, folder_id: folderId, title: String(c.title || 'Imported chat').slice(0, 120) || 'Imported chat', starred: c.starred ? 1 : 0, sandbox: 0, summary: String(c.summary || ''), created_at: t, updated_at: t });
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
      id: m.id, role: m.role, content: m.content, reasoning: m.reasoning, model_id: m.model_id, attachments: m.attachments || [], created_at: m.created_at, pinned: !!m.pinned,
      parentId: m.parent_id ?? null, branchIndex: sibs.findIndex(s => s.id === m.id), branchCount: sibs.length,
      siblings: sibs.map(s => s.id)
    };
  });
  res.json({ chat: { id: c.id, title: c.title, starred: !!c.starred, sandbox: !!c.sandbox, summary: c.summary || '', hasSummary: !!c.summary, projectId: c.project_id || null, instructions: c.instructions || '', pinnedFiles: Array.isArray(c.pinned_files) ? c.pinned_files : [] }, messages });
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
  const used = estimateTokens(convo);
  const limit = (model.enable_summaries && model.num_ctx) ? model.num_ctx : (model.num_ctx || 0);
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  res.json({ used, limit, pct, hasSummary: !!c.summary, compacts: model.enable_summaries ? compactThreshold(model) : 0 });
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
    reasoningCollapsible: m.reasoning_collapsible !== 0,
    staticIcon: m.static_icon, generatingIcon: m.generating_icon, thinkingIcon: m.thinking_icon, generatingAnim: m.generating_anim || 'spin', thinkingAnim: m.thinking_anim || 'pulse',
    iconPosition: m.icon_position || 'below', hasVision: !!m.has_vision, iconSize: m.icon_size || 0, showName: !!m.show_name,
    sandboxAuto: !!m.sandbox_auto, sandboxAllowed: m.sandbox_allowed !== 0, dropdownIcon: m.dropdown_icon !== 0, isDefault: !!m.is_default, agentSteps: m.agent_steps || 0,
    webSearchAuto: !!m.web_search_auto, webSearchAllowed: m.web_search_allowed !== 0, toolsAuto: !!m.tools_auto, toolsAllowed: m.tools_allowed !== 0,
    enableSummaries: !!m.enable_summaries, numCtx: m.num_ctx || 0, summaryPadding: m.summary_padding || 0.125, recentWindow: m.recent_window || 4,
    unavailable: !!m.unavailable, unavailableReason: m.unavailable_reason || '',
    bgEnabled: !!m.bg_enabled, bgImage: m.bg_image || '',
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
    const prov = req.query.provider ? resolveProvider(req.query.provider) : getProviders()[0];
    const { spec, base, key } = providerSpec(prov);
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    let ids = [];
    if (spec.protocol === 'ollama') {
      const r = await fetch(base.replace(/\/v1$/, '') + '/api/tags', { headers });
      if (!r.ok) return res.status(502).json({ error: `Backend returned ${r.status}.` });
      const j = await r.json().catch(() => ({}));
      ids = (Array.isArray(j?.models) ? j.models : []).map(x => x?.name || x?.model).filter(Boolean);
    } else {
      const r = await fetch(base + '/models', { headers });
      if (!r.ok) return res.status(502).json({ error: `Backend returned ${r.status}.` });
      const j = await r.json().catch(() => ({}));
      const raw = Array.isArray(j?.data) ? j.data : (Array.isArray(j?.models) ? j.models : []);
      ids = raw.map(x => (typeof x === 'string' ? x : (x?.id || x?.name))).filter(Boolean);
    }
    ids = [...new Set(ids)];
    const existing = new Set(db.models.all().map(m => (m.internal_name || '').toLowerCase()));
    res.json({ models: ids.map(id => ({ id, added: existing.has(String(id).toLowerCase()) })) });
  } catch {
    res.status(502).json({ error: 'Could not reach the backend. Check the Connection settings.' });
  }
});

app.post('/api/admin/models', authMiddleware, adminOnly, (req, res) => {
  const max = db.models.all().reduce((a, m) => Math.max(a, m.sort_order || 0), 0);
  const b = req.body;
  const preset = matchPreset(b.internal_name || '');
  const m = db.models.insert({
    id: uid(), display_name: b.display_name || 'New model', description: b.description || '',
    internal_name: b.internal_name || 'local-model', system_prompt: b.system_prompt || '',
    provider_id: b.provider_id || (getProviders()[0]?.id || null), max_tokens: parseInt(b.max_tokens) || null,
    has_reasoning: b.has_reasoning ? 1 : 0, reasoning_token: b.reasoning_token || '', non_reasoning_token: b.non_reasoning_token || '',
    reasoning_collapsible: b.reasoning_collapsible === false ? 0 : 1, icon_size: parseInt(b.icon_size) || 0,
    has_vision: b.has_vision ? 1 : 0,
    think_open: b.think_open || '', think_close: b.think_close || '',
    sandbox_auto: b.sandbox_auto ? 1 : 0, sandbox_allowed: b.sandbox_allowed === false ? 0 : 1, dropdown_icon: b.dropdown_icon === false ? 0 : 1, is_default: 0, agent_steps: Number.isInteger(b.agent_steps) ? Math.max(0, b.agent_steps) : 0,
    web_search_auto: b.web_search_auto ? 1 : 0, web_search_allowed: b.web_search_allowed === false ? 0 : 1, tools_auto: b.tools_auto ? 1 : 0, tools_allowed: b.tools_allowed === false ? 0 : 1,
    enable_summaries: b.enable_summaries ? 1 : 0, num_ctx: parseInt(b.num_ctx) || 0, summary_padding: typeof b.summary_padding === "number" ? b.summary_padding : 0.125, recent_window: parseInt(b.recent_window) > 0 ? parseInt(b.recent_window) : 4,
    in_more_models: b.in_more_models ? 1 : 0, more_models_label: b.more_models_label || 'More models',
    unavailable: b.unavailable ? 1 : 0, unavailable_reason: b.unavailable_reason || '',
    bg_enabled: b.bg_enabled ? 1 : 0, bg_image: b.bg_image || '',
    cap_vision: b.cap_vision ? 1 : 0, cap_reasoning: b.cap_reasoning ? 1 : 0, cap_text: b.cap_text ? 1 : 0, cap_compact: b.cap_compact ? 1 : 0,
    static_icon: b.static_icon || '', generating_icon: b.generating_icon || '', thinking_icon: b.thinking_icon || '',
    icon_position: b.icon_position || 'below',
    temperature: null, top_p: null, presence_penalty: null, frequency_penalty: null, repetition_penalty: null, min_p: null, top_k: null, seed: null,
    cost_in: preset ? preset.in : null, cost_out: preset ? preset.out : null,
    sort_order: max + 1, enabled: 1
  });
  logAudit(req, 'model.create', { type: 'model', id: m.id, meta: { displayName: m.display_name, internalName: m.internal_name } });
  broadcastAdminConfig();
  res.json({ id: m.id });
});

app.patch('/api/admin/models/:id', authMiddleware, adminOnly, (req, res) => {
  const cur = db.models.byId(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const str = ['display_name', 'description', 'internal_name', 'system_prompt', 'reasoning_token', 'non_reasoning_token', 'more_models_label', 'static_icon', 'generating_icon', 'thinking_icon', 'icon_position', 'think_open', 'think_close', 'generating_anim', 'thinking_anim', 'unavailable_reason', 'provider_id', 'bg_image'];
  const bool = ['has_reasoning', 'has_vision', 'in_more_models', 'enabled', 'sandbox_auto', 'sandbox_allowed', 'dropdown_icon', 'is_default', 'enable_summaries', 'unavailable', 'cap_vision', 'cap_reasoning', 'cap_text', 'cap_compact', 'reasoning_collapsible', 'bg_enabled', 'web_search_auto', 'web_search_allowed', 'tools_auto', 'tools_allowed', 'show_name'];
  const patch = {};
  for (const k of str) if (k in req.body) patch[k] = req.body[k];
  for (const k of bool) if (k in req.body) patch[k] = req.body[k] ? 1 : 0;
  if ('agent_steps' in req.body) patch.agent_steps = Math.max(0, parseInt(req.body.agent_steps) || 0);
  if ('num_ctx' in req.body) patch.num_ctx = Math.max(0, parseInt(req.body.num_ctx) || 0);
  if ('recent_window' in req.body) patch.recent_window = Math.max(1, parseInt(req.body.recent_window) || 4);
  if ('icon_size' in req.body) patch.icon_size = Math.max(0, Math.min(80, parseInt(req.body.icon_size) || 0));
  if ('summary_padding' in req.body) patch.summary_padding = Math.max(0.03, Math.min(0.6, parseFloat(req.body.summary_padding) || 0.125));
  const numF = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'min_p', 'cost_in', 'cost_out'];
  const numI = ['top_k', 'seed', 'max_tokens'];
  for (const k of numF) if (k in req.body) { const v = req.body[k]; patch[k] = (v === '' || v == null || isNaN(Number(v))) ? null : Number(v); }
  for (const k of numI) if (k in req.body) { const v = req.body[k]; patch[k] = (v === '' || v == null || isNaN(parseInt(v))) ? null : parseInt(v); }
  if ('internal_name' in patch && !('cost_in' in req.body) && !('cost_out' in req.body) && cur.cost_in == null && cur.cost_out == null) {
    const preset = matchPreset(patch.internal_name);
    if (preset) { patch.cost_in = preset.in; patch.cost_out = preset.out; }
  }
  // only one model can be the login default
  if (patch.is_default === 1) for (const other of db.models.all()) if (other.id !== cur.id && other.is_default) db.models.update(other.id, { is_default: 0 });
  db.models.update(cur.id, patch);
  logAudit(req, 'model.update', { type: 'model', id: cur.id, meta: { fields: Object.keys(patch) } });
  broadcastAdminConfig();
  res.json({ ok: true });
});

app.get('/api/admin/pricing/preset', authMiddleware, adminOnly, (req, res) => {
  res.json({ preset: matchPreset(req.query.name || '') });
});
app.get('/api/admin/pricing/presets', authMiddleware, adminOnly, (req, res) => {
  res.json({ presets: presetList(), custom: getCustomPresets() });
});
app.post('/api/admin/pricing/presets', authMiddleware, adminOnly, (req, res) => {
  const b = req.body || {};
  const match = String(b.match || '').trim();
  const ci = Number(b.in), co = Number(b.out);
  if (!match || !Number.isFinite(ci) || !Number.isFinite(co) || ci < 0 || co < 0) return res.status(400).json({ error: 'Provide a model name fragment and non-negative input/output prices.' });
  const list = getCustomPresets().filter(p => p.match !== match.toLowerCase());
  list.push({ match, label: String(b.label || match).trim() || match, in: ci, out: co });
  setSetting('custom_presets', list);
  setCustomPresets(list);
  logAudit(req, 'pricing.preset_set', { meta: { match } });
  res.json({ custom: getCustomPresets() });
});
app.delete('/api/admin/pricing/presets/:match', authMiddleware, adminOnly, (req, res) => {
  const target = decodeURIComponent(req.params.match).toLowerCase();
  const list = getCustomPresets().filter(p => p.match !== target);
  setSetting('custom_presets', list);
  setCustomPresets(list);
  logAudit(req, 'pricing.preset_delete', { meta: { match: target } });
  res.json({ custom: getCustomPresets() });
});

app.get('/api/admin/usage', authMiddleware, adminOnly, (req, res) => {
  const windows = { '7': 7, '30': 30, '90': 90 };
  const days = windows[String(req.query.days)] || 30;
  const since = now() - days * 24 * 60 * 60 * 1000;
  const nameById = new Map(db.users.all().map(u => [u.id, u.display_name || u.email]));
  const byUser = new Map(), byModel = new Map(), byDay = new Map();
  let tp = 0, tc = 0, tcost = 0, gens = 0;
  for (const r of db.usage.all()) {
    if ((r.created_at || 0) < since) continue;
    gens++; const p = r.prompt || 0, c = r.completion || 0, cost = r.cost || 0;
    tp += p; tc += c; tcost += cost;
    const uk = r.user_id || 'unknown';
    const ue = byUser.get(uk) || { userId: uk, name: nameById.get(uk) || 'Unknown', prompt: 0, completion: 0, cost: 0, count: 0 };
    ue.prompt += p; ue.completion += c; ue.cost += cost; ue.count++; byUser.set(uk, ue);
    const mk = r.model_id || 'unknown';
    const me = byModel.get(mk) || { modelId: mk, name: r.model_name || 'Unknown', prompt: 0, completion: 0, cost: 0, count: 0 };
    me.prompt += p; me.completion += c; me.cost += cost; me.count++; if (r.model_name) me.name = r.model_name; byModel.set(mk, me);
    const dk = new Date(r.created_at || 0).toISOString().slice(0, 10);
    const de = byDay.get(dk) || { day: dk, prompt: 0, completion: 0, cost: 0 };
    de.prompt += p; de.completion += c; de.cost += cost; byDay.set(dk, de);
  }
  res.json({
    totals: { prompt: tp, completion: tc, total: tp + tc, cost: tcost, generations: gens, users: byUser.size },
    users: [...byUser.values()].sort((a, b) => b.cost - a.cost || (b.prompt + b.completion) - (a.prompt + a.completion)),
    models: [...byModel.values()].sort((a, b) => (b.prompt + b.completion) - (a.prompt + a.completion)),
    daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-90),
    window: days
  });
});
app.patch('/api/admin/users/:id/budget', authMiddleware, adminOnly, (req, res) => {
  const u = db.users.byId(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  const v = req.body?.budget;
  const patch = (v === null || v === '' || v === undefined) ? { budget: null } : { budget: Math.max(0, Number(v) || 0) };
  db.users.update(u.id, patch);
  logAudit(req, 'user.budget', { type: 'user', id: u.id, meta: { budget: patch.budget } });
  res.json({ ok: true, budget: patch.budget });
});

app.delete('/api/admin/models/:id', authMiddleware, adminOnly, (req, res) => {
  const m = db.models.byId(req.params.id);
  db.models.remove(x => x.id === req.params.id);
  logAudit(req, 'model.delete', { type: 'model', id: req.params.id, meta: { displayName: m?.display_name } });
  broadcastAdminConfig();
  res.json({ ok: true });
});

app.get('/api/admin/detect-ctx', authMiddleware, adminOnly, async (req, res) => {
  const internal = req.query.model || '';
  const prov = req.query.provider ? resolveProvider(req.query.provider) : getProviders()[0];
  const { spec, base, key } = providerSpec(prov);
  const headers = { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const root = base.replace(/\/v1$/, '');
  try {
    if (spec.protocol === 'ollama') {
      const r = await fetch(root + '/api/show', { method: 'POST', headers, body: JSON.stringify({ model: internal }) });
      if (!r.ok) return res.json({ numCtx: 0, ok: false });
      const json = await r.json();
      const info = json.model_info || {};
      const ctxKey = Object.keys(info).find(k => k.endsWith('.context_length'));
      const ctx = ctxKey ? info[ctxKey] : 0;
      return res.json({ numCtx: parseInt(ctx) || 0, ok: !!ctx });
    }
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
  logAudit(req, 'models.publish', { meta: { count: snapshot.length } });
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
    modelQueue: getSetting('model_queue', '0') === '1',
    membankEnabled: getSetting('membank_enabled', '0') === '1',
    membankHideTools: getSetting('membank_hide_tools', '0') === '1',
    membankPrompt: getSetting('membank_prompt', membank.DEFAULT_PROMPT),
    webSearchEnabled: getSetting('web_search_enabled', '0') === '1',
    webSearchEngine: getSetting('web_search_engine', 'searxng'),
    searxngUrl: getSetting('searxng_url', ''),
    webSearchCount: parseInt(getSetting('web_search_count', '5')) || 5,
    webSearchDomains: (() => { try { const d = JSON.parse(getSetting('web_search_domains', '[]')); return Array.isArray(d) ? d.join('\n') : ''; } catch { return ''; } })(),
    webSearchPrompt: getSetting('web_search_prompt', websearch.DEFAULT_WS_PROMPT),
    budgetUser: Number(getSetting('budget_user', 0)) || 0,
    budgetAdmin: Number(getSetting('budget_admin', 0)) || 0,
    budgetWarnFraction: Number(getSetting('budget_warn_fraction', 0.8)) || 0.8,
    budgetEnforce: getSetting('budget_enforce', '0') === '1',
    sessionTtlDays: Number(getSetting('session_ttl_days', 30)) || 30,
    maxSessions: Number(getSetting('max_sessions', 0)) || 0
  }));
app.patch('/api/admin/settings', authMiddleware, adminOnly, (req, res) => {
  if ('apiBaseUrl' in req.body) setSetting('api_base_url', req.body.apiBaseUrl);
  if ('apiKey' in req.body) setSetting('api_key', req.body.apiKey);
  if ('webSearchEnabled' in req.body) setSetting('web_search_enabled', req.body.webSearchEnabled ? '1' : '0');
  if ('webSearchEngine' in req.body) setSetting('web_search_engine', req.body.webSearchEngine || 'searxng');
  if ('searxngUrl' in req.body) setSetting('searxng_url', (req.body.searxngUrl || '').trim());
  if ('webSearchCount' in req.body) { const n = parseInt(req.body.webSearchCount); setSetting('web_search_count', String(Number.isFinite(n) && n > 0 ? Math.min(20, n) : 5)); }
  if ('webSearchDomains' in req.body) { const list = String(req.body.webSearchDomains || '').split(/[\n,]+/).map(s => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()).filter(Boolean); setSetting('web_search_domains', JSON.stringify(list)); }
  if ('webSearchPrompt' in req.body) setSetting('web_search_prompt', req.body.webSearchPrompt || '');
  const lim = (k, v, def) => { const n = Number(v); setSetting(k, String(Number.isFinite(n) && n >= 0 ? n : def)); };
  if ('uploadLimitAdminMb' in req.body) lim('upload_limit_mb_admin', req.body.uploadLimitAdminMb, 8);
  if ('uploadLimitUserMb' in req.body) lim('upload_limit_mb_user', req.body.uploadLimitUserMb, 8);
  if ('sandboxLimitAdminMb' in req.body) lim('sandbox_limit_mb_admin', req.body.sandboxLimitAdminMb, 1024);
  if ('sandboxLimitUserMb' in req.body) lim('sandbox_limit_mb_user', req.body.sandboxLimitUserMb, 256);
  if ('modelQueue' in req.body) setSetting('model_queue', req.body.modelQueue ? '1' : '0');
  if ('membankEnabled' in req.body) setSetting('membank_enabled', req.body.membankEnabled ? '1' : '0');
  if ('membankHideTools' in req.body) setSetting('membank_hide_tools', req.body.membankHideTools ? '1' : '0');
  if ('membankPrompt' in req.body) setSetting('membank_prompt', String(req.body.membankPrompt || ''));
  if ('budgetUser' in req.body) lim('budget_user', req.body.budgetUser, 0);
  if ('budgetAdmin' in req.body) lim('budget_admin', req.body.budgetAdmin, 0);
  if ('budgetWarnFraction' in req.body) { const n = Number(req.body.budgetWarnFraction); setSetting('budget_warn_fraction', String(Number.isFinite(n) ? Math.min(0.99, Math.max(0.1, n)) : 0.8)); }
  if ('budgetEnforce' in req.body) setSetting('budget_enforce', req.body.budgetEnforce ? '1' : '0');
  if ('sessionTtlDays' in req.body) { const n = parseInt(req.body.sessionTtlDays); setSetting('session_ttl_days', String(Number.isFinite(n) && n > 0 ? Math.min(365, n) : 30)); }
  if ('maxSessions' in req.body) { const n = parseInt(req.body.maxSessions); setSetting('max_sessions', String(Number.isFinite(n) && n >= 0 ? Math.min(50, n) : 0)); }
  logAudit(req, 'settings.update', { meta: { fields: Object.keys(req.body || {}) } });
  res.json({ ok: true });
});

app.get('/api/admin/provider-types', authMiddleware, adminOnly, (req, res) => res.json(typesForClient()));
app.get('/api/admin/providers', authMiddleware, adminOnly, (req, res) => res.json({ providers: getProviders(), types: typesForClient() }));
app.post('/api/admin/providers', authMiddleware, adminOnly, (req, res) => {
  const b = req.body || {};
  const type = PROVIDER_TYPES[b.type] ? b.type : 'lmstudio';
  const prov = { id: uid(), name: (b.name || PROVIDER_TYPES[type].label).trim(), type, base_url: (b.base_url || '').trim() || PROVIDER_TYPES[type].defaultBaseUrl, api_key: b.api_key || '' };
  setSetting('providers', [...getProviders(), prov]);
  logAudit(req, 'provider.create', { type: 'provider', id: prov.id, meta: { name: prov.name, type: prov.type } });
  res.json({ id: prov.id });
});
app.patch('/api/admin/providers/:id', authMiddleware, adminOnly, (req, res) => {
  const b = req.body || {};
  const list = getProviders();
  const i = list.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'not found' });
  const p = { ...list[i] };
  if ('name' in b) p.name = (b.name || '').trim() || p.name;
  if ('type' in b && PROVIDER_TYPES[b.type]) p.type = b.type;
  if ('base_url' in b) p.base_url = (b.base_url || '').trim() || PROVIDER_TYPES[p.type].defaultBaseUrl;
  if ('api_key' in b) p.api_key = b.api_key || '';
  list[i] = p;
  setSetting('providers', list);
  logAudit(req, 'provider.update', { type: 'provider', id: p.id, meta: { name: p.name } });
  res.json({ ok: true });
});
app.delete('/api/admin/providers/:id', authMiddleware, adminOnly, (req, res) => {
  const list = getProviders();
  if (list.length <= 1) return res.status(400).json({ error: 'At least one provider is required.' });
  const next = list.filter(p => p.id !== req.params.id);
  const fallback = next[0].id;
  for (const m of db.models.all()) if (m.provider_id === req.params.id) db.models.update(m.id, { provider_id: fallback });
  setSetting('providers', next);
  logAudit(req, 'provider.delete', { type: 'provider', id: req.params.id });
  broadcastAdminConfig();
  res.json({ ok: true });
});

// ---------- custom tools (live data tools for LLMs) ----------
app.get('/api/admin/tools', authMiddleware, adminOnly, (req, res) => res.json({ tools: customtools.list() }));
app.post('/api/admin/tools', authMiddleware, adminOnly, (req, res) => {
  const r = customtools.create(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  logAudit(req, 'tool.create', { type: 'tool', id: r.tool.id, meta: { name: r.tool.name } });
  res.json({ tool: r.tool });
});
app.patch('/api/admin/tools/:id', authMiddleware, adminOnly, (req, res) => {
  const r = customtools.update(req.params.id, req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  logAudit(req, 'tool.update', { type: 'tool', id: req.params.id });
  res.json({ tool: r.tool });
});
app.delete('/api/admin/tools/:id', authMiddleware, adminOnly, (req, res) => {
  customtools.remove(req.params.id);
  logAudit(req, 'tool.delete', { type: 'tool', id: req.params.id });
  res.json({ ok: true });
});
app.post('/api/admin/tools/:id/test', authMiddleware, adminOnly, async (req, res) => {
  const tool = customtools.list().find(t => t.id === req.params.id);
  if (!tool) return res.status(404).json({ error: 'not found' });
  const call = { tool: tool.name, ...(req.body?.args || {}) };
  const r = await customtools.execTool(call);
  res.json(r);
});

// ---------- custom functions (UI extensions) ----------
app.get('/api/admin/functions', authMiddleware, adminOnly, (req, res) => res.json({ functions: customfns.list() }));
app.post('/api/admin/functions', authMiddleware, adminOnly, (req, res) => {
  const r = customfns.create(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  logAudit(req, 'function.create', { type: 'function', id: r.fn.id, meta: { label: r.fn.label } });
  broadcastAdminConfig();
  res.json({ fn: r.fn });
});
app.patch('/api/admin/functions/:id', authMiddleware, adminOnly, (req, res) => {
  const r = customfns.update(req.params.id, req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  logAudit(req, 'function.update', { type: 'function', id: req.params.id });
  broadcastAdminConfig();
  res.json({ fn: r.fn });
});
app.delete('/api/admin/functions/:id', authMiddleware, adminOnly, (req, res) => {
  customfns.remove(req.params.id);
  logAudit(req, 'function.delete', { type: 'function', id: req.params.id });
  broadcastAdminConfig();
  res.json({ ok: true });
});


let activeCount = 0;
let waiters = [];
let activeModel = null;
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
const membankUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.get('/api/admin/membank', authMiddleware, adminOnly, async (req, res) => {
  try { await membank.ensureIndexedAll(); } catch {}
  res.json({ files: membank.list(), enabled: getSetting('membank_enabled', '0') === '1' });
});
app.post('/api/admin/membank', authMiddleware, adminOnly, membankUpload.array('files', 20), async (req, res) => {
  let saved = 0;
  for (const f of (req.files || [])) { try { await membank.saveUpload(f.originalname, f.buffer); saved++; } catch {} }
  res.json({ files: membank.list(), saved });
});
app.delete('/api/admin/membank/:name', authMiddleware, adminOnly, (req, res) => {
  membank.remove(req.params.name);
  res.json({ files: membank.list() });
});
app.patch('/api/admin/membank/:name', authMiddleware, adminOnly, (req, res) => {
  if ('folder' in req.body && !('name' in req.body)) {
    membank.setFileMeta(req.params.name, { folder: req.body.folder });
    return res.json({ files: membank.list() });
  }
  const r = membank.rename(req.params.name, req.body.name);
  if (!r.ok) return res.status(400).json({ error: r.error });
  if ('folder' in req.body) membank.setFileMeta(req.body.name, { folder: req.body.folder });
  res.json({ files: membank.list() });
});
app.put('/api/admin/membank/order', authMiddleware, adminOnly, (req, res) => {
  const r = membank.reorder(req.body.items);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ files: r.files });
});
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

function purgeUploads(chatIds) {
  const ids = chatIds instanceof Set ? chatIds : new Set([chatIds]);
  const seen = new Set();
  for (const cid of ids) {
    for (const m of db.messages.byChat(cid)) {
      for (const a of (m.attachments || [])) {
        const fname = path.basename(a?.url || '');
        if (!fname || seen.has(fname)) continue;
        seen.add(fname);
        const p = path.join(UPLOADS, fname);
        if (p.startsWith(UPLOADS)) { try { fs.unlinkSync(p); } catch {} }
      }
    }
  }
}

// ---------- admin: users ----------
app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  const since = monthStartMs();
  res.json(db.users.all().sort((a, b) => a.created_at - b.created_at).map(u => ({
    id: u.id, email: u.email, displayName: u.display_name || u.email.split('@')[0],
    isAdmin: !!u.is_admin, isOwner: !!u.is_owner, createdAt: u.created_at,
    twoFactor: !!u.totp_enabled, budget: u.budget == null ? null : Number(u.budget),
    monthSpend: db.usage.byUser(u.id).reduce((s, r) => s + ((r.created_at || 0) >= since ? (r.cost || 0) : 0), 0)
  })));
});
app.patch('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
  const u = db.users.byId(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  if (u.is_owner) return res.status(403).json({ error: 'The top admin cannot be changed.' });
  if ('isAdmin' in req.body) db.users.update(u.id, { is_admin: req.body.isAdmin ? 1 : 0 });
  logAudit(req, 'user.role', { type: 'user', id: u.id, meta: { email: u.email, isAdmin: !!req.body.isAdmin } });
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', authMiddleware, adminOnly, (req, res) => {
  const u = db.users.byId(req.params.id);
  if (!u) return res.json({ ok: true });
  if (u.is_owner) return res.status(403).json({ error: 'The top admin cannot be removed.' });
  if (u.id === req.user.id) return res.status(403).json({ error: 'You cannot remove your own account here.' });
  const myChats = db.chats.filter(c => c.user_id === u.id);
  for (const c of myChats) { try { sandbox.remove(c.id); } catch {} }
  const chatIds = new Set(myChats.map(c => c.id));
  purgeUploads(chatIds);
  db.messages.remove(m => chatIds.has(m.chat_id));
  db.chats.remove(c => c.user_id === u.id);
  removeUserFromSpaces(u.id);
  db.sessions.remove(s => s.user_id === u.id);
  db.users.remove(x => x.id === u.id);
  logAudit(req, 'user.delete', { type: 'user', id: u.id, meta: { email: u.email } });
  res.json({ ok: true });
});

app.get('/api/admin/audit', authMiddleware, adminOnly, (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 60));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const action = String(req.query.action || '').trim().toLowerCase();
  const actor = String(req.query.actor || '').trim().toLowerCase();
  const sinceDays = parseInt(req.query.days) || 0;
  const since = sinceDays > 0 ? now() - sinceDays * 24 * 60 * 60 * 1000 : 0;
  const match = r => (!action || (r.action || '').toLowerCase().includes(action))
    && (!actor || (r.actor_email || '').toLowerCase().includes(actor))
    && (!since || (r.ts || 0) >= since);
  const all = db.audit.recent(100000, 0).filter(match);
  const actions = [...new Set(db.audit.recent(100000, 0).map(r => r.action))].sort();
  const page = all.slice(offset, offset + limit).map(r => ({
    id: r.id, ts: r.ts, actorEmail: r.actor_email || 'system', action: r.action,
    targetType: r.target_type || null, targetId: r.target_id || null, meta: r.meta || null, ip: r.ip || ''
  }));
  res.json({ entries: page, total: all.length, offset, hasMore: offset + page.length < all.length, actions });
});
app.get('/api/admin/audit/export', authMiddleware, adminOnly, (req, res) => {
  const esc = v => { const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = ['timestamp,actor,action,target_type,target_id,ip,meta'];
  for (const r of db.audit.recent(100000, 0)) {
    lines.push([new Date(r.ts).toISOString(), r.actor_email || 'system', r.action, r.target_type || '', r.target_id || '', r.ip || '', r.meta].map(esc).join(','));
  }
  logAudit(req, 'audit.export', {});
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n'));
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
    quickPrompts: (() => { const q = safeParse(getSetting('quick_prompts', '[]'), []); return Array.isArray(q) && q.length ? q : [{ icon: 'sparkles', label: 'Ideas', prompt: 'Give me ideas on what I should do today.' }, { icon: 'pencil', label: 'Write', prompt: 'Write a one paragraph summary about how Large Language Models (LLMs) work.' }, { icon: 'code', label: 'Code', prompt: 'Write a Python function that checks whether a string is a palindrome.' }, { icon: 'learn', label: 'Learn', prompt: 'How far away is the sun from Earth?' }, { icon: 'coffee', label: 'Life stuff', prompt: 'Give me practical advice for a life problem.' }]; })(),
    version: APP_VERSION,
    uiVersion: APP_VERSION,
    webSearchAvailable: websearch.webSearchAvailable(),
    functions: customfns.publicList(),
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
function killSessionSockets(sessionId) {
  if (!sessionId) return;
  const msg = JSON.stringify({ type: 'session_revoked' });
  for (const [ws, st] of clients.entries()) {
    if (st.sessionId === sessionId) {
      try { for (const c of st.aborts.values()) c.abort(); } catch {}
      try { if (ws.readyState === 1) ws.send(msg); } catch {}
      try { ws.close(); } catch {}
    }
  }
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
  const LIST_CAP = 200, INLINE_CAP = 12;
  p += '\n\n## Current sandbox files\nThese are the LATEST versions on disk. Always edit these directly — never assume older content. The version number (vN) increases each time a file changes.\n';
  for (const f of files.slice(0, LIST_CAP)) p += `- ${f.path} (v${f.v}, ${f.size} bytes)\n`;
  if (files.length > LIST_CAP) p += `- … and ${files.length - LIST_CAP} more file(s). The list is truncated to protect context — use \`list_files\`, \`search\`, or \`view\` to inspect anything not shown here.\n`;
  p += '\n## Latest file contents (a sample; use `view` for anything not shown)\n';
  let budget = 40000, inlined = 0;
  for (const f of files) {
    if (inlined >= INLINE_CAP || budget <= 0) break;
    if (f.ext === 'zip' || !sandbox.isText(f.path)) continue;
    const txt = sandbox.readText(chatId, f.path) || '';
    if (txt.length > 8000 || txt.length > budget) {
      p += `\n### ${f.path} (v${f.v}) — ${f.size} bytes, too large to inline; use the view tool to read it.\n`;
      continue;
    }
    p += `\n### ${f.path} (v${f.v})\n\`\`\`${f.ext || ''}\n${txt}\n\`\`\`\n`;
    budget -= txt.length; inlined++;
  }
  p += '\n---\nREMINDER: The sandbox is ON and these files above are the current truth. Edit existing files with `str_replace` (never recreate them from scratch). For file operations use the dedicated tools — `copy_file`, `move_file`, `make_dir`, `delete_file`, `bundle_zip`, `extract_zip` — never shell commands like cp/rm/mkdir/zip, and never absolute paths like /tmp. Emit tool calls using the `|TOOL|` line protocol exactly as described above (never JSON, never code fences). Keep working through the task with tool calls until it is fully done; do not stop to ask permission, do not paste file contents or fake terminal output into the chat, and do not repeat a tool call that just failed — read the error and change approach.';
  return p;
}
function cleanCall(call) {
  const o = { tool: call.tool };
  if (call.path != null) o.path = call.path;
  if (call.tool === 'bash' || call.tool === 'run') o.cmd = call.cmd ?? call.command ?? '';
  if (call.new_path != null || call.to != null) o.new_path = call.new_path ?? call.to;
  if (call.query != null) o.query = call.query;
  if (call.name != null) o.name = call.name;
  if (call.dest != null) o.dest = call.dest;
  if (call.start != null) o.start = call.start;
  if (call.end != null) o.end = call.end;
  if (customtools.isCustom(call.tool)) for (const [k, v] of Object.entries(call)) if (k !== 'tool' && (typeof v === 'string' || typeof v === 'number')) o[k] = v;
  return o;
}
function resultPayload(call, r) {
  const o = { ok: !!r.ok };
  if (r.error) o.error = r.error;
  if (r.v != null) o.v = r.v;
  if (r.adds != null) o.adds = r.adds;
  if (r.dels != null) o.dels = r.dels;
  if (r.bytes != null) o.bytes = r.bytes;
  if (r.unchanged) o.unchanged = true;
  if (r.lines != null) o.lines = r.lines;
  if (r.count != null) o.count = r.count;
  if (r.cleared != null) o.cleared = r.cleared;
  if (r.path != null) o.path = r.path;
  if (r.from != null) o.from = r.from;
  if ((call.tool === 'bash' || call.tool === 'run')) { o.output = (r.output || '').slice(0, 8000); o.exit = r.exit ?? null; }
  if (call.tool === 'list_files' && Array.isArray(r.files)) o.files = r.files.slice(0, 100).map(f => ({ path: f.path, size: f.size }));
  if (call.tool === 'extract_zip' && Array.isArray(r.files)) o.files = r.files.slice(0, 60);
  if (call.tool === 'search' && Array.isArray(r.matches)) o.matches = r.matches.slice(0, 40);
  return o;
}
function formatToolResult(call, r) {
  const head = `${call.tool}${call.path ? ' ' + call.path : ''}`;
  if (!r.ok) return `${head} → ERROR: ${r.error}` + (r.output ? `\n${r.output}` : '');
  switch (call.tool) {
    case 'bash': case 'run': return `bash$ ${call.cmd ?? call.command ?? ''}\n${r.output || '(no output)'}\n(exit ${r.exit ?? 0})`;
    case 'create_file': return r.unchanged ? `${head} → unchanged (already v${r.v}, identical content — no write needed)` : `${head} → created (v${r.v}, ${r.bytes} bytes, +${r.adds ?? 0}/-${r.dels ?? 0})`;
    case 'str_replace': return `${head} → edited (now v${r.v}, +${r.adds ?? 0}/-${r.dels ?? 0})`;
    case 'view': return `${head} →\n${r.content}`;
    case 'list_files': return `list_files →\n${(r.files || []).map(f => `${f.path} (${f.size}b)`).join('\n') || '(empty)'}`;
    case 'delete_file': return `${head} → deleted`;
    case 'clear_sandbox': case 'delete_all': return `clear_sandbox → removed ${r.cleared} item(s); sandbox is now empty`;
    case 'rename_file': case 'move_file': return `${head} → moved to ${r.path}`;
    case 'copy_file': return `${head} → copied to ${r.path}${r.count > 1 ? ` (${r.count} files)` : ''}`;
    case 'make_dir': case 'mkdir': return `${head} → directory ready`;
    case 'search': return `search "${call.query}" → ${r.count} match(es)` + (r.matches.length ? '\n' + r.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') : '');
    case 'extract_zip': return `extract_zip ${call.path} → ${r.count} file(s)` + (r.files && r.files.length ? ':\n' + r.files.join('\n') : '');
    case 'bundle_zip': return `bundle_zip ${r.path} → created (${r.count} files)`;
    default: return `${head} → ok`;
  }
}

// ---- conversation tree (branching) ----
function sortedMsgs(chatId) { return db.messages.byChat(chatId); }
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
async function chatHistory(chat, model) {
  const fresh = db.chats.byId(chat.id) || chat;
  const upto = fresh.summary && fresh.summary_upto ? fresh.summary_upto : 0;
  let rows = activePath(chat.id);
  if (upto) rows = rows.filter(m => m.created_at > upto || m.pinned);
  return rows.map(m => {
    let text = stripToolSyntax(m.content || '').replace(/\n{3,}/g, '\n\n');
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

function estTextTokens(s) {
  if (!s) return 0;
  let cjk = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af)) cjk++; }
  return Math.ceil((s.length - cjk) / 3.6) + cjk;
}
function estimateTokens(messages) {
  let total = 0;
  for (const m of messages) {
    total += 4;
    if (typeof m.content === 'string') total += estTextTokens(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) total += p.type === 'text' ? estTextTokens(p.text || '') : 850;
  }
  return total;
}

// once we get near the context limit, fold older turns into chat.summary
// one summarization pass over older persisted turns; returns true if it compacted
async function compactStep(ws, chat, model) {
  const fresh = db.chats.byId(chat.id);
  const upto = fresh.summary && fresh.summary_upto ? fresh.summary_upto : 0;
  const recent = recentWindow(model);
  const after = activePath(chat.id).filter(m => m.created_at > upto);
  if (after.length <= recent + 1) return false;
  const cut = after.length - recent;
  const toSummarize = after.slice(0, cut).filter(m => !m.pinned);
  if (!toSummarize.length) return false;
  const marker = after[cut - 1].created_at;
  try { ws.send(JSON.stringify({ type: 'compacting', chatId: chat.id })); } catch {}
  const summary = await summarizeConversation(model, fresh.summary, toSummarize);
  db.chats.update(chat.id, { summary, summary_upto: marker });
  try { ws.send(JSON.stringify({ type: 'compacted', chatId: chat.id })); } catch {}
  return !!summary;
}
function recentWindow(model) {
  const n = parseInt(model && model.recent_window);
  return Number.isFinite(n) && n > 0 ? n : 4;
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
function userInstructions(userId) {
  const u = userId ? db.users.byId(userId) : null;
  return (u && u.instructions) ? u.instructions : '';
}
function combinedInstructions(chat) {
  const parts = [];
  const ui = userInstructions(chat && chat.user_id);
  if (ui && ui.trim()) parts.push(ui.trim());
  if (chat && chat.instructions && chat.instructions.trim()) parts.push(chat.instructions.trim());
  return parts.join('\n\n');
}
function lastUserQuery(chatId) {
  const rows = activePath(chatId);
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].role === 'user' && (rows[i].content || '').trim()) return stripToolSyntax(rows[i].content);
  return '';
}
async function pinnedFilesPrompt(chat, query) {
  const pins = Array.isArray(chat?.pinned_files) ? chat.pinned_files : [];
  if (!pins.length) return '';
  const blocks = [];
  for (const a of pins) {
    if (isTextLike(a)) blocks.push(`--- Pinned file: ${a.name} ---\n${readUploadText(a.url)}`);
    else blocks.push(`[Pinned file: ${a.name} (not readable as text)]`);
  }
  if (!blocks.length) return '';
  return 'The user has pinned the following file(s) to this conversation. Keep their contents available as context for every turn:\n\n' + blocks.join('\n\n');
}
async function instrFor(chat, query) {
  const base = combinedInstructions(chat);
  let pinned = '';
  try { pinned = await pinnedFilesPrompt(chat, query == null ? lastUserQuery(chat.id) : query); } catch { pinned = ''; }
  return pinned ? (base ? base + '\n\n' + pinned : pinned) : base;
}
async function maybeCompact(ws, chat, model, extended, sandboxOn) {
  const threshold = compactThreshold(model);
  if (threshold === Infinity) return;
  let guard = 0;
  while (guard++ < 3) {
    const fresh = db.chats.byId(chat.id);
    const sandboxP = sandboxOn ? sandboxPromptFor(chat.id) : null;
    const convo = buildMessages(model, await chatHistory(chat, model), extended, sandboxP, fresh.summary, promptVars(chat.user_id), await instrFor(fresh));
    if (estimateTokens(convo) < threshold) return;
    if (!(await compactStep(ws, chat, model))) return;
  }
}

wss.on('connection', (ws, req) => {
  const r = sessionFromRequest(req);
  const u = r?.user;
  if (!u) { ws.close(); return; }
  clients.set(ws, { userId: u.id, sessionId: r.sessionId || null, isAdmin: !!u.is_admin, aborts: new Map() });
  const safeSend = (s) => { if (ws.readyState === 1) { try { ws.send(s); } catch {} } };

  async function runCompletion(ws, state, chat, model, extended, sandboxOn, sandboxCap = 0, webSearchOn = false) {
    await maybeCompact(ws, chat, model, extended, sandboxOn);
    const history = await chatHistory(chat, model);
    const chatRow = db.chats.byId(chat.id) || chat;
    const membankOn = getSetting('membank_enabled', '0') === '1' && membank.list().length > 0;
    const membankHideTools = getSetting('membank_hide_tools', '0') === '1';
    if (membankOn) { try { await membank.ensureIndexedAll(); } catch {} }
    const customToolsList = (model.tools_allowed !== 0 && model.tools_auto) ? customtools.getEnabled() : [];
    const customToolsOn = customToolsList.length > 0;
    const customToolNames = new Set(customToolsList.map(t => t.name));
    const toolsOn = sandboxOn || webSearchOn || membankOn || customToolsOn;
    const toolsP = () => {
      const parts = [];
      if (sandboxOn) parts.push(sandboxPromptFor(chat.id));
      if (webSearchOn) { parts.push(websearch.webSearchConfig().prompt); parts.push(websearch.webSearchToolPrompt()); }
      if (membankOn) parts.push(membank.promptFor(getSetting('membank_prompt', '')));
      if (customToolsOn) parts.push(customtools.promptFor(customToolsList));
      return parts.filter(Boolean).join('\n\n') || null;
    };
    let base = buildMessages(model, history, extended, toolsP(), chatRow.summary, promptVars(chat.user_id), await instrFor(chatRow));
    let inTurn = []; // assistant/tool exchanges accumulated during this response
    const assistantId = uid();
    const assistantParent = (db.chats.byId(chat.id) || {}).active_leaf || null;
    let content = '', reasoning = '', usage = null;
    safeSend(JSON.stringify({ type: 'start', chatId: chat.id, messageId: assistantId }));

    const threshold = compactThreshold(model);
    const stepCap = (model.agent_steps && model.agent_steps > 0) ? model.agent_steps : 1000;
    const maxSteps = toolsOn ? stepCap : 1;
    try {
      for (let step = 0; step < maxSteps; step++) {
        // running low on context mid-response? summarize older turns, then carry on where we left off
        if (threshold !== Infinity && inTurn.length && estimateTokens([...base, ...inTurn]) >= threshold) {
          if (await compactStep(ws, chat, model)) base = buildMessages(model, await chatHistory(chat, model), extended, toolsP(), (db.chats.byId(chat.id) || {}).summary, promptVars(chat.user_id), await instrFor(db.chats.byId(chat.id) || chat));
        }
        const convo = [...base, ...inTurn];
        const controller = new AbortController();
        state.aborts.set(chat.id, controller);
        let stepText = '';
        let aborted = false;
        let toolStop = false;
        let execIndex = 0;
        let abortScanFrom = 0;
        const stepResults = [];
        const execPending = async (eofCloses) => {
          if (!toolsOn) return;
          const { calls } = toolproto.scanTools(stepText, { eofCloses });
          for (; execIndex < calls.length; execIndex++) {
            const call = calls[execIndex].call;
            if (!call || !call.tool) continue;
            let r, payload, formatted;
            if (call.tool === 'web_search') {
              if (!webSearchOn) continue;
              r = await websearch.runWebSearch(call);
              payload = websearch.webSearchResultPayload(call, r);
              formatted = websearch.formatWebSearchResult(call, r);
            } else if (call.tool === 'mb_view' || call.tool === 'mb_search') {
              if (!membankOn) continue;
              r = membank.execTool(call);
              payload = membank.resultPayload(call, r);
              formatted = membank.formatResult(call, r);
            } else if (customToolNames.has(call.tool)) {
              if (!customToolsOn) continue;
              r = await customtools.execTool(call);
              payload = customtools.resultPayload(call, r);
              formatted = customtools.formatResult(call, r);
            } else {
              if (!sandboxOn) continue;
              r = await sandbox.execTool(chat.id, call, sandboxCap);
              payload = resultPayload(call, r);
              formatted = formatToolResult(call, r);
            }
            stepResults.push({ call, r, formatted });
            const hideThis = (call.tool === 'mb_view' || call.tool === 'mb_search') && membankHideTools;
            if (!hideThis) {
              const block = '\n\n[[OQR:' + Buffer.from(JSON.stringify({ call: cleanCall(call), result: payload }), 'utf8').toString('base64') + ']]\n';
              content += block;
              safeSend(JSON.stringify({ type: 'content', chatId: chat.id, text: block }));
            }
            if (sandboxOn) safeSend(JSON.stringify({ type: 'files', chatId: chat.id, files: sandbox.list(chat.id) }));
          }
        };
        try {
          await streamCompletion({
            model, messages: convo, signal: controller.signal,
            onEvent: (e) => {
              if (e.type === 'usage') { if (!usage) usage = { prompt: 0, completion: 0, total: 0 }; usage.prompt += e.usage.prompt || 0; usage.completion += e.usage.completion || 0; usage.total += e.usage.total || 0; return; }
              if (e.type === 'reasoning') { reasoning += e.text; safeSend(JSON.stringify({ type: 'reasoning', chatId: chat.id, text: e.text })); }
              else {
                content += e.text; stepText += e.text;
                safeSend(JSON.stringify({ type: 'content', chatId: chat.id, text: e.text }));
                if (toolsOn && !toolStop) {
                  const tail = stepText.slice(Math.max(0, abortScanFrom - 16));
                  abortScanFrom = stepText.length;
                  if (/\/\s*\|?\s*tool\b/i.test(tail)) {
                    const { calls } = toolproto.scanTools(stepText);
                    if (calls.length) {
                      const last = calls[calls.length - 1].call;
                      if (last && (toolproto.READ_TOOLS.has(last.tool) || customToolNames.has(last.tool))) { toolStop = true; try { controller.abort(); } catch {} }
                    }
                  }
                }
              }
            }
          });
        } catch (err) {
          if (err.name === 'AbortError') aborted = true; else throw err;
        }
        const eof = !toolStop;
        try { await execPending(eof); } catch {}
        if (stepResults.length) {
          const results = stepResults.map(({ formatted }) => formatted);
          inTurn = [...inTurn, { role: 'assistant', content: compactAssistant(stepText, eof) }, { role: 'user', content: 'Tool results:\n' + results.join('\n\n') }];
        }
        if (!toolsOn) break;
        if (aborted && !toolStop) break;
        if (!stepResults.length) break;
      }
    } catch (err) {
      if (err.name !== 'AbortError') safeSend(JSON.stringify({ type: 'error', chatId: chat.id, error: String(err.message || err) }));
    }
    state.aborts.delete(chat.id);

    let usageRec = null;
    if (usage && (usage.prompt || usage.completion)) {
      const cost = (usage.prompt / 1e6) * (Number(model.cost_in) || 0) + (usage.completion / 1e6) * (Number(model.cost_out) || 0);
      usageRec = { prompt: usage.prompt, completion: usage.completion, total: usage.total || (usage.prompt + usage.completion), cost };
      db.usage.insert({ id: uid(), user_id: chat.user_id, model_id: model.id, model_name: model.display_name || '', prompt: usageRec.prompt, completion: usageRec.completion, total: usageRec.total, cost, cost_in: Number(model.cost_in) || 0, cost_out: Number(model.cost_out) || 0, created_at: now() });
    }
    db.messages.insert({ id: assistantId, chat_id: chat.id, role: 'assistant', content, reasoning, model_id: model.id, parent_id: assistantParent, usage: usageRec, created_at: now() });
    db.chats.update(chat.id, { updated_at: now(), active_leaf: assistantId });
    safeSend(JSON.stringify({ type: 'done', chatId: chat.id, messageId: assistantId }));

    const fresh = db.chats.byId(chat.id);
    const lastUser = [...history].reverse().find(h => h.role === 'user');
    const lastUserText = lastUser && (Array.isArray(lastUser.content)
      ? (lastUser.content.find(p => p.type === 'text')?.text || 'Image')
      : lastUser.content);
    const cleanContent = stripToolSyntax(content).trim();
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
    if (msg.type === 'stop') { const c = state.aborts.get(msg.chatId); if (c) { c.abort(); state.aborts.delete(msg.chatId); } return; }
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
        state.aborts.set('incognito', controller);
        safeSend(JSON.stringify({ type: 'start', chatId: 'incognito', messageId: assistantId }));
        try {
          await streamCompletion({
            model, messages, signal: controller.signal,
            onEvent: (e) => {
              if (e.type === 'usage') return;
              if (e.type === 'reasoning') safeSend(JSON.stringify({ type: 'reasoning', chatId: 'incognito', text: e.text }));
              else safeSend(JSON.stringify({ type: 'content', chatId: 'incognito', text: e.text }));
            }
          });
        } catch (err) { if (err.name !== 'AbortError') safeSend(JSON.stringify({ type: 'error', chatId: 'incognito', error: String(err.message || err) })); }
        state.aborts.delete('incognito');
        safeSend(JSON.stringify({ type: 'done', chatId: 'incognito', messageId: assistantId }));
      } catch (err) {
        state.aborts.delete('incognito');
        safeSend(JSON.stringify({ type: 'error', chatId: 'incognito', error: String(err.message || err) }));
        safeSend(JSON.stringify({ type: 'done', chatId: 'incognito' }));
      }
      return;
    }
    if (msg.type !== 'chat' && msg.type !== 'regenerate' && msg.type !== 'edit') return;
    try {
      const chat = db.chats.byId(msg.chatId);
      const model = resolveModel(msg.modelId, state.isAdmin);
      if (!chat || chat.user_id !== u.id || !model) { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: 'Invalid chat or model.' })); return; }
      if (model.unavailable && !state.isAdmin) { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: (model.unavailable_reason || 'This model is currently unavailable.') })); return; }
      const bs = budgetStatus(u);
      if (bs.enforce && bs.state === 'over') { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: 'You have reached your monthly usage budget. It resets at the start of next month.' })); safeSend(JSON.stringify({ type: 'done', chatId: msg.chatId })); return; }

      const sandboxCap = roleLimit('sandbox_limit_mb', !!u.is_admin, u.is_admin ? 1024 : 256) * 1024 * 1024;
      const userSandbox = !!msg.sandbox;
      if (!!chat.sandbox !== userSandbox) db.chats.update(chat.id, { sandbox: userSandbox ? 1 : 0 });
      const hasFileAttach = Array.isArray(msg.attachments) && msg.attachments.some(a => !(a.type && a.type.startsWith('image/')));
      const sandboxOn = userSandbox || (hasFileAttach && model.sandbox_allowed !== 0);
      const webSearchOn = !!msg.webSearch && websearch.webSearchAvailable() && model.web_search_allowed !== 0;
      ensureChain(chat.id);

      if (msg.type === 'regenerate') {
        const target = db.messages.byId(msg.messageId) || activePath(chat.id).slice().reverse().find(m => m.role === 'assistant');
        if (!target) { safeSend(JSON.stringify({ type: 'error', chatId: chat.id, error: 'Nothing to regenerate.' })); return; }
        const parent = target.role === 'assistant' ? (target.parent_id ?? null) : target.id;
        db.chats.update(chat.id, { active_leaf: parent });
      } else if (msg.type === 'edit') {
        const orig = db.messages.byId(msg.messageId);
        if (!orig || orig.chat_id !== chat.id) { safeSend(JSON.stringify({ type: 'error', chatId: chat.id, error: 'Message not found.' })); return; }
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
        () => runCompletion(ws, state, chat, model, !!msg.extended, sandboxOn, sandboxCap, webSearchOn));
    } catch (err) {
      if (msg && msg.chatId) state.aborts.delete(msg.chatId);
      safeSend(JSON.stringify({ type: 'error', chatId: msg && msg.chatId, error: String(err.message || err) }));
      safeSend(JSON.stringify({ type: 'done', chatId: msg && msg.chatId }));
    }
  });

  ws.on('error', () => {});
  ws.on('close', () => { const st = clients.get(ws); try { if (st) for (const c of st.aborts.values()) c.abort(); } catch {} clients.delete(ws); });
});

// ---------- spaces ----------
function broadcastSpace(spaceId, payload, excludeUserId) {
  const space = db.spaces.byId(spaceId);
  if (!space) return;
  const ids = new Set((space.members || []).filter(m => m.status === 'accepted').map(m => m.userId));
  const msg = JSON.stringify(payload);
  for (const [sock, st] of clients.entries()) if (sock.readyState === 1 && ids.has(st.userId) && st.userId !== excludeUserId) sock.send(msg);
}
function broadcastToUser(userId, payload) {
  const msg = JSON.stringify(payload);
  for (const [sock, st] of clients.entries()) if (sock.readyState === 1 && st.userId === userId) sock.send(msg);
}
function isMember(space, userId) { return (space.members || []).some(m => m.userId === userId); }
function isAccepted(space, userId) { return (space.members || []).some(m => m.userId === userId && m.status === 'accepted'); }
function memberOf(space, userId) { return (space.members || []).find(m => m.userId === userId) || null; }
function canPost(space, userId) { const m = memberOf(space, userId); return !!m && m.status === 'accepted' && m.role !== 'viewer'; }
function removeUserFromSpaces(userId) {
  for (const s of db.spaces.filter(s => isMember(s, userId))) {
    let members = (s.members || []).filter(m => m.userId !== userId);
    let ownerId = s.owner_id;
    if (ownerId === userId) {
      const next = members.find(m => m.status === 'accepted');
      ownerId = next ? next.userId : null;
      if (next) members = members.map(m => m.userId === ownerId ? { ...m, role: 'owner' } : m);
    }
    if (!members.length || !ownerId) { db.spaceMessages.remove(m => m.space_id === s.id); db.spaces.remove(x => x.id === s.id); }
    else db.spaces.update(s.id, { members, owner_id: ownerId, updated_at: now() });
  }
}
function shapeSpace(s, userId) {
  const members = (s.members || []);
  const me = userId ? members.find(m => m.userId === userId) : null;
  return {
    id: s.id, name: s.name, ownerId: s.owner_id, modelId: s.model_id || null, systemPrompt: s.system_prompt || '',
    members: members.map(m => ({ userId: m.userId, displayName: m.displayName, email: m.email, role: m.role, status: m.status, invitedAt: m.invitedAt, respondedAt: m.respondedAt || null })),
    myStatus: me ? me.status : null, myRole: me ? me.role : null, updatedAt: s.updated_at, createdAt: s.created_at
  };
}
function shapeSpaceMsg(m) { return { id: m.id, spaceId: m.space_id, userId: m.user_id, authorName: m.author_name, role: m.role, content: m.content, createdAt: m.created_at }; }
function ownSpace(req, res, { requireOwner = false } = {}) {
  const s = db.spaces.byId(req.params.id);
  if (!s || !isMember(s, req.user.id)) { res.status(404).json({ error: 'not found' }); return null; }
  if (requireOwner && s.owner_id !== req.user.id && !req.user.is_admin) { res.status(403).json({ error: 'Only the space owner can do that.' }); return null; }
  return s;
}
const spaceCooldown = new Map();
async function spaceAssistantRespond(spaceId) {
  const space = db.spaces.byId(spaceId);
  if (!space) return;
  const last = spaceCooldown.get(spaceId) || 0;
  if (Date.now() - last < 1200) return;
  if (spaceCooldown.size > 1000) spaceCooldown.clear();
  spaceCooldown.set(spaceId, Date.now());
  const model = db.models.byId(space.model_id) || db.models.find(m => m.is_default) || db.models.all()[0];
  if (!model) return;
  broadcastSpace(spaceId, { type: 'space_typing', spaceId, typing: true });
  try {
    const history = db.spaceMessages.bySpace(spaceId).slice(-40);
    const aiName = (model.display_name || 'Assistant').toLowerCase();
    const lastMsg = history[history.length - 1];
    const lastText = (lastMsg?.content || '');
    const esc = aiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentioned = new RegExp(`@${esc}\\b`, 'i').test(lastText) || /@(assistant|ai|bot)\b/i.test(lastText);
    const addressed = lastMsg && lastMsg.role !== 'assistant'
      && (mentioned || new RegExp(`(^|\\b)${esc}\\b`, 'i').test(lastText) || /\?\s*$/.test(lastText.trim()));
    const sys = `You are the AI assistant taking part in a shared group chat space named "${space.name}" alongside multiple human users. Each human message below is prefixed with its sender's name so you can tell people apart; your own earlier replies are not prefixed. Speak naturally in first person, and only reply when you are directly addressed, asked something, or can clearly add value to the discussion. If the latest message is just people talking among themselves and doesn't call for your input, reply with exactly [[SPACE_SILENT]] and nothing else: no punctuation, no explanation, nothing before or after it.`
      + (addressed ? ' The latest message appears to address you directly, so a reply is expected unless it truly makes no sense.' : '')
      + (space.system_prompt && space.system_prompt.trim() ? `\n\nAdditional instructions from the space owner:\n${space.system_prompt.trim()}` : '');
    const convo = [{ role: 'system', content: sys }, ...history.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.role === 'assistant' ? m.content : `${m.author_name}: ${m.content}`
    }))];
    let raw = await oneShot(model, convo);
    raw = stripThink(model, raw || '').trim();
    if (!raw || /^\[\[SPACE_SILENT\]\]$/i.test(raw)) return;
    const t = now();
    const row = db.spaceMessages.insert({ id: uid(), space_id: spaceId, user_id: null, role: 'assistant', author_name: model.display_name || 'Assistant', content: raw, created_at: t });
    db.spaces.update(spaceId, { updated_at: t });
    broadcastSpace(spaceId, { type: 'space_message', spaceId, message: shapeSpaceMsg(row) });
  } catch {}
  finally { broadcastSpace(spaceId, { type: 'space_typing', spaceId, typing: false }); }
}

app.get('/api/spaces', authMiddleware, (req, res) => {
  const mine = db.spaces.filter(s => isMember(s, req.user.id)).sort((a, b) => b.updated_at - a.updated_at);
  res.json(mine.map(s => shapeSpace(s, req.user.id)));
});
app.post('/api/spaces', authMiddleware, (req, res) => {
  const name = String(req.body?.name || 'New space').slice(0, 80).trim() || 'New space';
  const t = now();
  const me = { userId: req.user.id, displayName: req.user.display_name || req.user.email.split('@')[0], email: req.user.email, role: 'owner', status: 'accepted', invitedAt: t, respondedAt: t };
  const defaultModel = db.models.find(m => m.is_default) || db.models.all()[0];
  const s = db.spaces.insert({ id: uid(), owner_id: req.user.id, name, system_prompt: '', model_id: (db.models.byId(req.body?.modelId) || defaultModel)?.id || null, members: [me], created_at: t, updated_at: t });
  res.json(shapeSpace(s, req.user.id));
});
app.get('/api/spaces/:id', authMiddleware, (req, res) => {
  const s = ownSpace(req, res); if (!s) return;
  res.json(shapeSpace(s, req.user.id));
});
app.patch('/api/spaces/:id', authMiddleware, (req, res) => {
  const s = ownSpace(req, res, { requireOwner: true }); if (!s) return;
  const patch = { updated_at: now() };
  if ('name' in req.body) patch.name = String(req.body.name || 'New space').slice(0, 80).trim() || 'New space';
  if ('systemPrompt' in req.body) patch.system_prompt = String(req.body.systemPrompt || '').slice(0, 4000);
  if ('modelId' in req.body) { const m = db.models.byId(req.body.modelId); if (m) patch.model_id = m.id; }
  const updated = db.spaces.update(s.id, patch);
  broadcastSpace(s.id, { type: 'space_updated', spaceId: s.id, space: shapeSpace(updated, null) });
  res.json(shapeSpace(updated, req.user.id));
});
app.delete('/api/spaces/:id', authMiddleware, (req, res) => {
  const s = ownSpace(req, res, { requireOwner: true }); if (!s) return;
  db.spaceMessages.remove(m => m.space_id === s.id);
  db.spaces.remove(x => x.id === s.id);
  broadcastSpace(s.id, { type: 'space_deleted', spaceId: s.id });
  res.json({ ok: true });
});
app.post('/api/spaces/:id/invite', authMiddleware, (req, res) => {
  const s = ownSpace(req, res, { requireOwner: true }); if (!s) return;
  const target = db.users.byId(req.body?.userId);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You are already in this space.' });
  const members = [...(s.members || [])];
  const existing = members.find(m => m.userId === target.id);
  const t = now();
  if (existing) {
    if (existing.status === 'declined') {
      existing.status = 'invited'; existing.invitedAt = t; existing.respondedAt = null;
    } else {
      return res.status(400).json({ error: 'That user is already invited or a member.' });
    }
  } else {
    if (members.length >= 25) return res.status(400).json({ error: 'A space can have at most 25 members.' });
    members.push({ userId: target.id, displayName: target.display_name || target.email.split('@')[0], email: target.email, role: 'member', status: 'invited', invitedAt: t, respondedAt: null });
  }
  const updated = db.spaces.update(s.id, { members, updated_at: t });
  broadcastToUser(target.id, { type: 'space_invite', space: shapeSpace(updated, target.id) });
  res.json(shapeSpace(updated, req.user.id));
});
app.post('/api/spaces/:id/respond', authMiddleware, (req, res) => {
  const s = db.spaces.byId(req.params.id);
  if (!s || !isMember(s, req.user.id)) return res.status(404).json({ error: 'not found' });
  const accept = !!req.body?.accept;
  const t = now();
  const members = (s.members || []).map(m => m.userId === req.user.id ? { ...m, status: accept ? 'accepted' : 'declined', respondedAt: t } : m);
  const updated = db.spaces.update(s.id, { members, updated_at: t });
  broadcastSpace(s.id, { type: 'space_updated', spaceId: s.id, space: shapeSpace(updated, null) });
  res.json(shapeSpace(updated, req.user.id));
});
app.post('/api/spaces/:id/leave', authMiddleware, (req, res) => {
  const s = db.spaces.byId(req.params.id);
  if (!s || !isMember(s, req.user.id)) return res.status(404).json({ error: 'not found' });
  removeUserFromSpaces(req.user.id);
  res.json({ ok: true });
});
app.delete('/api/spaces/:id/members/:userId', authMiddleware, (req, res) => {
  const s = ownSpace(req, res, { requireOwner: true }); if (!s) return;
  if (req.params.userId === s.owner_id) return res.status(400).json({ error: 'The owner cannot be removed — transfer or delete the space instead.' });
  const members = (s.members || []).filter(m => m.userId !== req.params.userId);
  const updated = db.spaces.update(s.id, { members, updated_at: now() });
  broadcastSpace(s.id, { type: 'space_updated', spaceId: s.id, space: shapeSpace(updated, null) });
  broadcastToUser(req.params.userId, { type: 'space_removed', spaceId: s.id });
  res.json(shapeSpace(updated, req.user.id));
});
app.patch('/api/spaces/:id/members/:userId', authMiddleware, (req, res) => {
  const s = ownSpace(req, res, { requireOwner: true }); if (!s) return;
  if (req.params.userId === s.owner_id) return res.status(400).json({ error: 'The owner role cannot be changed here.' });
  const role = ['editor', 'viewer'].includes(req.body?.role) ? req.body.role : null;
  if (!role) return res.status(400).json({ error: 'Role must be editor or viewer.' });
  const members = (s.members || []).map(m => m.userId === req.params.userId ? { ...m, role } : m);
  if (!members.some(m => m.userId === req.params.userId)) return res.status(404).json({ error: 'Member not found.' });
  const updated = db.spaces.update(s.id, { members, updated_at: now() });
  broadcastSpace(s.id, { type: 'space_updated', spaceId: s.id, space: shapeSpace(updated, null) });
  res.json(shapeSpace(updated, req.user.id));
});
app.post('/api/spaces/:id/typing', authMiddleware, (req, res) => {
  const s = db.spaces.byId(req.params.id);
  if (!s || !isAccepted(s, req.user.id)) return res.status(404).json({ error: 'not found' });
  const me = memberOf(s, req.user.id);
  broadcastSpace(s.id, { type: 'space_user_typing', spaceId: s.id, userId: req.user.id, name: me?.displayName || req.user.email.split('@')[0], typing: !!req.body?.typing }, req.user.id);
  res.json({ ok: true });
});
app.get('/api/spaces/:id/messages', authMiddleware, (req, res) => {
  const s = db.spaces.byId(req.params.id);
  if (!s || !isAccepted(s, req.user.id)) return res.status(404).json({ error: 'not found' });
  res.json(db.spaceMessages.bySpace(s.id).map(shapeSpaceMsg));
});
app.post('/api/spaces/:id/messages', authMiddleware, (req, res) => {
  const s = db.spaces.byId(req.params.id);
  if (!s || !isAccepted(s, req.user.id)) return res.status(404).json({ error: 'not found' });
  if (!canPost(s, req.user.id)) return res.status(403).json({ error: 'You have view-only access to this space.' });
  const content = String(req.body?.content || '').slice(0, 8000).trim();
  if (!content) return res.status(400).json({ error: 'Empty message.' });
  const me = (s.members || []).find(m => m.userId === req.user.id);
  const t = now();
  const row = db.spaceMessages.insert({ id: uid(), space_id: s.id, user_id: req.user.id, role: 'user', author_name: me?.displayName || req.user.email, content, created_at: t });
  db.spaces.update(s.id, { updated_at: t });
  broadcastSpace(s.id, { type: 'space_message', spaceId: s.id, message: shapeSpaceMsg(row) });
  res.json(shapeSpaceMsg(row));
  spaceAssistantRespond(s.id).catch(() => {});
});

server.listen(PORT, () => console.log(`open-quill running on http://localhost:${PORT}`));
try { setCustomPresets(getSetting('custom_presets', [])); } catch {}
pruneAudit();
setInterval(pruneAudit, 24 * 60 * 60 * 1000).unref();
