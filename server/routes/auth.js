import { db, uid, now, getSetting } from '../db.js';
import { hash, check, sign, publicUser, authMiddleware, sessionFromRequest, createSession, revokeSession, revokeOtherSessions, sessionMaxAgeSeconds } from '../auth.js';
import { oneShot, stripThink } from '../llm/index.js';
import { randomSecret, verifyTotp, otpauthUri, makeRecoveryCodes, hashRecovery } from '../totp.js';
import * as sandbox from '../sandbox.js';
import { logAudit } from '../lib/audit.js';
import { purgeUploads } from '../lib/uploads.js';
import { resolveModelOrDefault } from '../lib/models.js';
import { budgetStatus } from '../lib/budget.js';
import { updateUserMemory } from '../lib/memory.js';
import { killSessionSockets } from '../lib/ws/index.js';
import { removeUserFromSpaces } from '../lib/spaces.js';

const setCookie = (res, token) =>
  res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Path=/; Max-Age=${token ? sessionMaxAgeSeconds() : 0}; SameSite=Lax`);

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

const DEFAULT_STYLE_GEN_PROMPT = 'You create writing-style instructions for an AI assistant. The user will provide a sample of writing they like. Analyze its tone, sentence structure, vocabulary, formality, formatting habits, and personality, then output ONLY a concise instruction paragraph (under 120 words) telling an assistant how to write in that style. Do not mention the sample, do not add a preamble, output only the instruction text.';
const DEFAULT_IMPROVE_PROMPT = 'You are a prompt engineer. The user will give you a draft prompt they intend to send to an AI assistant. Rewrite it to be clearer, more specific, and more likely to get an excellent result: state the goal explicitly, add helpful structure, specify the desired format or constraints when they are implied, and remove ambiguity. Preserve the user\u2019s intent, language, and any concrete details exactly. Output ONLY the improved prompt text, with no preamble, quotes, or explanation.';

export default function registerAuthRoutes(app) {
  app.get('/api/auth/context', (req, res) => {
    res.json({
      firstRun: db.users.count() === 0,
      allowSignups: getSetting('allow_signups', '1') === '1',
      appName: getSetting('app_name', 'open-quill'),
      appIcon: getSetting('app_icon', ''),
      appFont: getSetting('app_font', 'serif'),
      uiPreset: getSetting('ui_preset', '') === 'openai' ? 'openai' : 'anthropic',
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const ip = req.socket.remoteAddress || '';
    if (loginLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    const email = (req.body.email || '').trim().toLowerCase();
    const pw = req.body.password || '';
    if (!email || !pw) return res.status(400).json({ error: 'Enter your email and password.' });
    const u = db.users.byEmail(email);
    if (!u) { noteLoginFail(ip); return res.status(401).json({ error: 'Incorrect email or password.' }); }
    if (!(await check(pw, u.password_hash))) { noteLoginFail(ip); return res.status(401).json({ error: 'Incorrect email or password.' }); }
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
    const sid = createSession(u, req);
    setCookie(res, sign(u, sid));
    res.json({ user: publicUser(u) });
  });

  app.post('/api/auth/register', async (req, res) => {
    const ip = req.socket.remoteAddress || '';
    if (loginLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    const email = (req.body.email || '').trim().toLowerCase();
    const pw = req.body.password || '';
    if (!/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const isFirst = db.users.count() === 0;
    if (!isFirst && getSetting('allow_signups', '1') !== '1') {
      return res.status(403).json({ error: 'New accounts are turned off on this server.' });
    }
    if (db.users.byEmail(email)) { noteLoginFail(ip); return res.status(409).json({ error: 'An account with that email already exists.' }); }
    const u = db.users.insert({ id: uid(), email, password_hash: await hash(pw), display_name: '', is_admin: isFirst ? 1 : 0, is_owner: isFirst ? 1 : 0, prefs: {}, created_at: now() });
    logAudit(req, 'user.register', { email, owner: isFirst });
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

  app.put('/api/me/styles', authMiddleware, (req, res) => {
    const list = (Array.isArray(req.body.styles) ? req.body.styles : [])
      .map(x => ({
        id: String(x.id || uid()).slice(0, 40),
        name: String(x.name || '').trim().slice(0, 50),
        prompt: String(x.prompt || '').trim().slice(0, 4000)
      }))
      .filter(x => x.name && x.prompt).slice(0, 30);
    db.users.update(req.user.id, { styles: list });
    res.json({ styles: list });
  });

  app.post('/api/styles/generate', authMiddleware, async (req, res) => {
    const sample = String(req.body?.sample || '').slice(0, 12000);
    if (!sample.trim()) return res.status(400).json({ error: 'A writing sample is required.' });
    const model = resolveModelOrDefault(String(req.body?.modelId || ''), !!req.user.is_admin);
    if (!model) return res.status(400).json({ error: 'No model available to generate the style.' });
    try {
      const raw = await oneShot(model, [{ role: 'system', content: DEFAULT_STYLE_GEN_PROMPT }, { role: 'user', content: sample }]);
      const text = stripThink(model, raw || '').trim().slice(0, 4000);
      if (!text) return res.status(502).json({ error: 'The model returned an empty style.' });
      res.json({ prompt: text });
    } catch (e) { res.status(502).json({ error: 'Could not reach the model to generate the style.' }); }
  });

  app.get('/api/me/memory', authMiddleware, (req, res) => {
    const u = db.users.byId(req.user.id);
    res.json({ memory: u?.memory || '', updatedAt: u?.memory_updated_at || 0 });
  });
  app.put('/api/me/memory', authMiddleware, (req, res) => {
    const memory = String(req.body?.memory || '').slice(0, 6000);
    db.users.update(req.user.id, { memory, memory_updated_at: Date.now() });
    res.json({ memory });
  });
  app.delete('/api/me/memory', authMiddleware, (req, res) => {
    db.users.update(req.user.id, { memory: '', memory_updated_at: 0 });
    res.json({ ok: true });
  });
  app.post('/api/me/memory/refresh', authMiddleware, async (req, res) => {
    if (getSetting('memory_enabled', '0') !== '1') return res.status(403).json({ error: 'Memory is disabled by the admin.' });
    const model = resolveModelOrDefault(String(req.body?.modelId || ''), !!req.user.is_admin);
    if (!model) return res.status(400).json({ error: 'No model available to update memory.' });
    try {
      const memory = await updateUserMemory(req.user.id, model);
      if (memory == null) return res.status(502).json({ error: 'The model returned nothing. Try again.' });
      res.json({ memory, updatedAt: Date.now() });
    } catch { res.status(502).json({ error: 'Could not reach the model to update memory.' }); }
  });

  app.post('/api/improve-prompt', authMiddleware, async (req, res) => {
    const text = String(req.body?.text || '').slice(0, 16000);
    if (!text.trim()) return res.status(400).json({ error: 'Nothing to improve.' });
    const model = resolveModelOrDefault(String(req.body?.modelId || ''), !!req.user.is_admin);
    if (!model) return res.status(400).json({ error: 'No model available.' });
    try {
      const raw = await oneShot(model, [{ role: 'system', content: DEFAULT_IMPROVE_PROMPT }, { role: 'user', content: text }]);
      const out = stripThink(model, raw || '').trim();
      if (!out) return res.status(502).json({ error: 'The model returned an empty prompt.' });
      res.json({ text: out.slice(0, 24000) });
    } catch { res.status(502).json({ error: 'Could not reach the model.' }); }
  });

  app.post('/api/messages/:id/feedback', authMiddleware, (req, res) => {
    const m = db.messages.byId(req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    const chat = db.chats.byId(m.chat_id);
    if (!chat || chat.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const rating = req.body?.rating === 1 ? 1 : req.body?.rating === -1 ? -1 : 0;
    const comment = String(req.body?.comment || '').trim().slice(0, 1000);
    db.messages.update(m.id, { feedback: rating });
    db.feedback.removeByIds(db.feedback.byMessage(m.id).filter(f => f.user_id === req.user.id).map(f => f.id));
    if (rating !== 0) {
      db.feedback.insert({
        id: uid(), ts: Date.now(), user_id: req.user.id, kind: 'rating',
        message_id: m.id, chat_id: chat.id, model_id: m.model_id || null,
        rating, comment, snippet: String(m.content || '').slice(0, 400)
      });
    }
    res.json({ ok: true, rating });
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
    const rows = since ? db.usage.byUserSince(req.user.id, since) : db.usage.byUser(req.user.id);
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
    const myChats = db.chats.byUser(req.user.id);
    for (const c of myChats) { try { sandbox.remove(c.id); } catch {} }
    const chatIds = new Set(myChats.map(c => c.id));
    purgeUploads(chatIds);
    for (const id of chatIds) db.messages.removeWhere('chat_id', id);
    db.chats.removeWhere('user_id', req.user.id);
    res.json({ ok: true, deleted: myChats.length });
  });

  app.delete('/api/me', authMiddleware, (req, res) => {
    const u = req.user;
    if (u.is_owner) return res.status(403).json({ error: 'The owner account cannot be deleted.' });
    const myChats = db.chats.byUser(u.id);
    for (const c of myChats) { try { sandbox.remove(c.id); } catch {} }
    const chatIds = new Set(myChats.map(c => c.id));
    purgeUploads(chatIds);
    for (const id of chatIds) db.messages.removeWhere('chat_id', id);
    db.chats.removeWhere('user_id', u.id);
    removeUserFromSpaces(u.id);
    db.sessions.removeWhere('user_id', u.id);
    db.users.removeById(u.id);
    setCookie(res, '');
    res.json({ ok: true });
  });

  app.get('/api/users/search', authMiddleware, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json([]);
    const out = db.users.filter(u => u.id !== req.user.id && ((u.email || '').toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q)))
      .slice(0, 10)
      .map(u => ({ id: u.id, email: u.email, displayName: u.display_name || (u.email || '').split('@')[0] }));
    res.json(out);
  });
}
