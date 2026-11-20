import { db, uid, now, getSetting, setSetting } from '../db.js';
import { hash, check, sign, publicUser, authMiddleware, authAccount, sessionFromRequest, createSession, revokeSession, revokeOtherSessions, sessionMaxAgeSeconds, sessionTtlDays } from '../auth.js';
import { requirePermission } from '../lib/authz/middleware.js';
import { can, isActive, roleOf } from '../lib/authz/effective.js';
import { isLastOwner } from '../lib/authz/rules.js';
import { PENDING, USER, OWNER } from '../lib/authz/roles.js';
import { signupPolicy, domainAllowed, setupTokenMatches } from '../lib/identity/signup.js';
import { oneShot, stripThink } from '../llm/index.js';
import { randomSecret } from '../lib/totp.js';
import { hasTotp, startEnrollment, confirmEnrollment, regenerateCodes, removeFactors, verifySecondFactor, issueChallenge, readChallenge, spendChallenge, CHALLENGE_SECONDS } from '../lib/identity/mfa.js';
import { mfaRequired } from '../lib/authz/effective.js';
import { broadcastToUser } from '../lib/ws/broadcast.js';
import { logAudit, clientIp } from '../lib/audit.js';
import { plainSnippet } from '../lib/history.js';
import { purgeUserChats, purgeUser } from '../lib/purge.js';
import { resolveModelOrDefault } from '../lib/models.js';
import { budgetStatus } from '../lib/budget.js';
import { presetId } from '../lib/presets.js';
import { memoriesOf, changeMemory, setMemories } from '../lib/memory.js';
import { killSessionSockets, closeUserSockets } from '../lib/ws/index.js';
import { cleanStyles, prefsFit } from '../lib/profile.js';

import { isHttps } from '../lib/origin.js';

// Secure is set only over TLS: forcing it on a plain-http install would make the browser
// drop the cookie and lock everyone out of a normal localhost deployment.
const setCookie = (req, res, token) =>
  res.setHeader('Set-Cookie', [
    `token=${token}`, 'HttpOnly', 'Path=/',
    `Max-Age=${token ? sessionMaxAgeSeconds() : 0}`,
    'SameSite=Lax',
    ...(isHttps(req) ? ['Secure'] : [])
  ].join('; '));

const MFA_COOKIE = 'oq_mfa';
const challengeCookie = (req, res, value) =>
  res.append('Set-Cookie', [
    `${MFA_COOKIE}=${value}`, 'HttpOnly', 'Path=/api/auth',
    `Max-Age=${value ? CHALLENGE_SECONDS : 0}`,
    'SameSite=Strict',
    ...(isHttps(req) ? ['Secure'] : [])
  ].join('; '));

const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_MAX = 8;
const FAIL_MAX_KEYS = 5000;
const loginFails = new Map();

function pruneLoginFails(cutoff) {
  for (const [k, v] of loginFails) if (v.t < cutoff) loginFails.delete(k);
}
function loginLimited(key) {
  const rec = loginFails.get(key);
  if (!rec) return false;
  if (Date.now() - rec.t > FAIL_WINDOW_MS) { loginFails.delete(key); return false; }
  return rec.n >= FAIL_MAX;
}
function noteLoginFail(key) {
  const t = Date.now();
  const rec = loginFails.get(key);
  if (rec && t - rec.t < FAIL_WINDOW_MS) { rec.n++; rec.t = t; }
  else loginFails.set(key, { n: 1, t });
  // Drop only what has aged out. Clearing the whole map, as this used to, let an
  // attacker wipe every other address's counter by making 5000 junk attempts.
  if (loginFails.size > FAIL_MAX_KEYS) {
    pruneLoginFails(t - FAIL_WINDOW_MS);
    if (loginFails.size > FAIL_MAX_KEYS) loginFails.delete(loginFails.keys().next().value);
  }
}

// Keyed per address AND per account: one address cannot spray a whole user list, and a
// botnet cannot grind a single account from many addresses. Registration uses its own
// account namespace, or repeatedly re-registering a known address would lock its owner
// out of signing in. passwordMatches always pays for one argon2 verify, even when the
// address is unknown: returning early there answers in a fraction of the time and is an
// account-existence oracle however carefully the error text is worded.
const limitKeys = (req, email) => [`ip:${clientIp(req)}`, ...(email ? [`user:${email}`] : [])];
const registerKeys = (req, email) => [`ip:${clientIp(req)}`, ...(email ? [`reg:${email}`] : [])];
const anyLimited = (keys) => keys.some(loginLimited);
const TOO_MANY = 'Too many attempts. Try again in a few minutes.';

async function reauth(req, res, password, wrong = 'Password is incorrect.') {
  const key = `acct:${req.user.id}`;
  if (loginLimited(key)) { res.status(429).json({ error: TOO_MANY }); return false; }
  if (await check(String(password || ''), req.user.password_hash)) return true;
  noteLoginFail(key);
  res.status(401).json({ error: wrong });
  return false;
}

let decoyHash = null;
async function passwordMatches(pw, stored) {
  if (stored) return check(pw, stored);
  if (!decoyHash) decoyHash = await hash(randomSecret());
  await check(pw, decoyHash);
  return false;
}

export const USAGE_WINDOWS = new Set([7, 30, 90]);

const DEFAULT_STYLE_GEN_PROMPT ='You create writing-style instructions for an AI assistant. The user will provide a sample of writing they like. Analyze its tone, sentence structure, vocabulary, formality, formatting habits, and personality, then output ONLY a concise instruction paragraph (under 120 words) telling an assistant how to write in that style. Do not mention the sample, do not add a preamble, output only the instruction text.';

export default function registerAuthRoutes(app) {
  app.get('/api/auth/context', (req, res) => {
    res.json({
      firstRun: db.users.count() === 0,
      signup: signupPolicy(),
      appName: getSetting('app_name', 'open-quill'),
      appIcon: getSetting('app_icon', ''),
      appFont: getSetting('app_font', 'literata'),
      uiPreset: presetId(getSetting('ui_preset', '')),
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 320);
    const pw = String(req.body?.password || '');
    const keys = limitKeys(req, email);
    if (anyLimited(keys)) return res.status(429).json({ error: TOO_MANY });
    if (!email || !pw) return res.status(400).json({ error: 'Enter your email and password.' });
    const u = db.users.byEmail(email);
    if (!(await passwordMatches(pw, u?.password_hash))) {
      keys.forEach(noteLoginFail);
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    if (!isActive(u)) return res.status(403).json({ error: 'This account is disabled. Contact your administrator.' });
    // The counter is cleared only once the whole login succeeds, so a stolen password
    // still cannot be used to grind second-factor codes without limit.
    if (hasTotp(u.id)) {
      challengeCookie(req, res, issueChallenge(u, 'password'));
      return res.json({ mfa: { methods: ['totp', 'recovery'] } });
    }
    keys.forEach(k => loginFails.delete(k));
    const sid = createSession(u, req);
    setCookie(req, res, sign(u, sid));
    logAudit(req, 'auth.login', { type: 'user', id: u.id });
    res.json({ user: publicUser(u) });
  });

  app.post('/api/auth/mfa', (req, res) => {
    const found = readChallenge(req.cookies?.[MFA_COOKIE]);
    if (!found) {
      challengeCookie(req, res, '');
      return res.status(401).json({ error: 'Your sign-in expired. Enter your email and password again.', restart: true });
    }
    const { user: u, challenge } = found;
    const keys = [...limitKeys(req, u.email), `acct:${u.id}`];
    if (anyLimited(keys)) return res.status(429).json({ error: TOO_MANY });
    if (!isActive(u)) {
      challengeCookie(req, res, '');
      return res.status(403).json({ error: 'This account is disabled. Contact your administrator.' });
    }
    const via = verifySecondFactor(u.id, { code: String(req.body?.code || '').trim(), recovery: String(req.body?.recovery || '').trim() });
    if (!via) {
      keys.forEach(noteLoginFail);
      logAudit(req, 'auth.mfa_fail', { type: 'user', id: u.id });
      return res.status(401).json({ error: 'That code is not valid. Check your authenticator and try again.' });
    }
    spendChallenge(challenge);
    keys.forEach(k => loginFails.delete(k));
    const sid = createSession(u, req, challenge.method, via);
    setCookie(req, res, sign(u, sid));
    challengeCookie(req, res, '');
    logAudit(req, 'auth.login', { type: 'user', id: u.id, meta: { mfa: via } });
    res.json({ user: publicUser(u) });
  });

  app.post('/api/auth/register', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 320);
    const pw = String(req.body?.password || '');
    const keys = registerKeys(req, email);
    if (anyLimited(keys)) return res.status(429).json({ error: TOO_MANY });
    if (!/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (pw.length > 1024) return res.status(400).json({ error: 'That password is too long.' });
    const refused = () => {
      if (db.users.count() === 0) {
        if (setupTokenMatches(req.body?.setupToken)) return null;
        keys.forEach(noteLoginFail);
        return res.status(403).json({ error: 'Enter the setup token shown in the server console.', setup: true });
      }
      if (signupPolicy() === 'closed') return res.status(403).json({ error: 'New accounts are turned off on this server.' });
      if (!domainAllowed(email)) return res.status(403).json({ error: 'Sign-up is limited to approved email domains.' });
      if (db.users.byEmail(email)) { keys.forEach(noteLoginFail); return res.status(409).json({ error: 'An account with that email already exists.' }); }
      return null;
    };
    if (refused()) return;
    const passwordHash = await hash(pw);
    if (refused()) return;
    const owner = db.users.count() === 0;
    const role = owner ? OWNER : signupPolicy() === 'approval' ? PENDING : USER;
    const u = db.users.insert({ id: uid(), email, password_hash: passwordHash, display_name: '', role, status: 'active', source: 'local', prefs: {}, created_at: now() });
    if (owner) setSetting('setup_complete', '0');
    logAudit(req, 'user.register', { type: 'user', id: u.id, meta: { email, role } });
    const sid = createSession(u, req);
    setCookie(req, res, sign(u, sid));
    res.json({ user: publicUser(u) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const r = sessionFromRequest(req);
    if (r?.sessionId) revokeSession(r.sessionId);
    setCookie(req, res, '');
    res.json({ ok: true });
  });

  app.get('/api/me', authAccount, (req, res) => res.json({ user: publicUser(req.user) }));
  app.patch('/api/me', authAccount, (req, res) => {
    const b = req.body || {};
    const patch = {};
    // prefs is a free-form client bag, so it is bounded rather than schema-checked: the
    // whole user row is one JSON blob, and an unbounded object here would grow it without
    // limit and be re-parsed on every single authenticated request.
    if ('prefs' in b) {
      if (b.prefs !== null && (typeof b.prefs !== 'object' || Array.isArray(b.prefs))) {
        return res.status(400).json({ error: 'prefs must be an object.' });
      }
      const prefs = b.prefs || {};
      if (!prefsFit(prefs)) return res.status(413).json({ error: 'Settings are too large to save.' });
      patch.prefs = prefs;
    }
    if ('displayName' in b) patch.display_name = String(b.displayName ?? '').slice(0, 80);
    if ('instructions' in b) patch.instructions = String(b.instructions ?? '').slice(0, 8000);
    if (!Object.keys(patch).length) return res.json({ user: publicUser(req.user) });
    const saved = db.users.update(req.user.id, patch);
    res.json({ user: publicUser(saved || req.user) });
  });

  app.put('/api/me/styles', authMiddleware, (req, res) => {
    const list = cleanStyles(req.body.styles);
    db.users.update(req.user.id, { styles: list });
    res.json({ styles: list });
  });

  app.post('/api/styles/generate', authMiddleware, requirePermission('chats.create'), async (req, res) => {
    const sample = String(req.body?.sample || '').slice(0, 12000);
    if (!sample.trim()) return res.status(400).json({ error: 'A writing sample is required.' });
    const model = resolveModelOrDefault(String(req.body?.modelId || ''), req.user);
    if (!model) return res.status(400).json({ error: 'No model available to generate the style.' });
    try {
      const raw = await oneShot(model, [{ role: 'system', content: DEFAULT_STYLE_GEN_PROMPT }, { role: 'user', content: sample }]);
      const text = stripThink(model, raw || '').trim().slice(0, 4000);
      if (!text) return res.status(502).json({ error: 'The model returned an empty style.' });
      res.json({ prompt: text });
    } catch (e) { res.status(502).json({ error: 'Could not reach the model to generate the style.' }); }
  });

  const bodyText = (req) => (typeof req.body?.text === 'string' ? req.body.text : '');
  app.get('/api/me/memories', authMiddleware, requirePermission('tools.memory'), (req, res) => {
    res.json({ memories: memoriesOf(req.user.id) });
  });
  app.post('/api/me/memories', authMiddleware, requirePermission('tools.memory'), (req, res) => {
    const r = changeMemory(req.user.id, { action: 'add', text: bodyText(req), source: 'user' });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ memory: r.item, memories: memoriesOf(req.user.id) });
  });
  app.put('/api/me/memories/:id', authMiddleware, requirePermission('tools.memory'), (req, res) => {
    const r = changeMemory(req.user.id, { action: 'update', id: req.params.id, text: bodyText(req), source: 'user' });
    if (!r.ok) return res.status(/^No memory/.test(r.error) ? 404 : 400).json({ error: r.error });
    res.json({ memory: r.item, memories: memoriesOf(req.user.id) });
  });
  app.delete('/api/me/memories/:id', authMiddleware, requirePermission('tools.memory'), (req, res) => {
    const r = changeMemory(req.user.id, { action: 'delete', id: req.params.id });
    if (!r.ok) return res.status(404).json({ error: r.error });
    res.json({ memories: memoriesOf(req.user.id) });
  });
  app.delete('/api/me/memories', authMiddleware, requirePermission('tools.memory'), (req, res) => {
    setMemories(req.user.id, []);
    res.json({ memories: [] });
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
        rating, comment, snippet: plainSnippet(m.content)
      });
    }
    res.json({ ok: true, rating });
  });

  app.get('/api/me/usage', authMiddleware, (req, res) => {
    const days = USAGE_WINDOWS.has(Number(req.query.days)) ? Number(req.query.days) : null;
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

  app.get('/api/me/sessions', authAccount, (req, res) => {
    const list = db.sessions.byUser(req.user.id).map(s => ({
      id: s.id, current: s.id === req.sessionId, ip: s.ip || '', userAgent: s.user_agent || '',
      lastSeen: s.last_seen || 0, createdAt: s.created_at || 0
    }));
    res.json({ sessions: list, idleDays: sessionTtlDays() });
  });
  app.delete('/api/me/sessions/:id', authAccount, (req, res) => {
    const s = db.sessions.byId(req.params.id);
    if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    revokeSession(s.id);
    killSessionSockets(s.id);
    res.json({ ok: true });
  });
  app.delete('/api/me/sessions', authAccount, (req, res) => {
    const others = db.sessions.byUser(req.user.id).filter(s => s.id !== req.sessionId);
    revokeOtherSessions(req.user.id, req.sessionId);
    for (const s of others) killSessionSockets(s.id);
    res.json({ ok: true, revoked: others.length });
  });

  app.get('/api/me/budget', authMiddleware, (req, res) => res.json(budgetStatus(req.user)));

  app.post('/api/me/password', authAccount, async (req, res) => {
    const current = String(req.body?.current || '');
    const next = String(req.body?.next || '');
    if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    if (!(await reauth(req, res, current, 'Current password is incorrect.'))) return;
    db.users.update(req.user.id, { password_hash: await hash(next) });
    const others = db.sessions.byUser(req.user.id).filter(s => s.id !== req.sessionId);
    revokeOtherSessions(req.user.id, req.sessionId);
    for (const s of others) killSessionSockets(s.id);
    logAudit(req, 'account.password_change', { type: 'user', id: req.user.id });
    res.json({ ok: true });
  });

  app.post('/api/me/2fa/setup', authAccount, async (req, res) => {
    if (hasTotp(req.user.id)) return res.status(400).json({ error: 'Two-factor is already enabled.' });
    res.json(await startEnrollment(req.user));
  });
  app.post('/api/me/2fa/enable', authAccount, (req, res) => {
    const key = `acct:${req.user.id}`;
    if (hasTotp(req.user.id)) return res.status(400).json({ error: 'Two-factor is already enabled.' });
    if (loginLimited(key)) return res.status(429).json({ error: TOO_MANY });
    const r = confirmEnrollment(req.user.id, String(req.body?.code || '').trim());
    if (r.error) {
      if (r.status === 401) noteLoginFail(key);
      return res.status(r.status).json({ error: r.error });
    }
    db.sessions.update(req.sessionId, { mfa: 'totp', mfa_at: now() });
    logAudit(req, 'account.2fa_enable', { type: 'user', id: req.user.id });
    broadcastToUser(req.user.id, { type: 'account' });
    res.json({ ok: true, recoveryCodes: r.recoveryCodes, user: publicUser(db.users.byId(req.user.id)) });
  });
  app.post('/api/me/2fa/disable', authAccount, async (req, res) => {
    if (!hasTotp(req.user.id)) return res.json({ ok: true });
    if (mfaRequired(req.user)) return res.status(403).json({ error: 'Your organization requires two-factor authentication.' });
    if (!(await reauth(req, res, req.body?.password))) return;
    removeFactors(req.user.id);
    logAudit(req, 'account.2fa_disable', { type: 'user', id: req.user.id });
    res.json({ ok: true });
  });
  app.post('/api/me/2fa/recovery', authAccount, async (req, res) => {
    if (!hasTotp(req.user.id)) return res.status(400).json({ error: 'Two-factor is not enabled.' });
    if (!(await reauth(req, res, req.body?.password))) return;
    const codes = regenerateCodes(req.user.id);
    logAudit(req, 'account.2fa_recovery', { type: 'user', id: req.user.id });
    res.json({ ok: true, recoveryCodes: codes });
  });

  app.delete('/api/me/chats', authMiddleware, requirePermission('chats.delete'), (req, res) => {
    res.json({ ok: true, deleted: purgeUserChats(req.user.id) });
  });

  app.delete('/api/me', authAccount, async (req, res) => {
    const u = req.user;
    if (roleOf(u) !== PENDING && !can(u, 'account.delete')) return res.status(403).json({ error: 'Your organization does not allow deleting your own account.' });
    if (isLastOwner(u)) return res.status(403).json({ error: 'Make someone else an owner before deleting this account.' });
    if (!(await reauth(req, res, req.body?.password))) return;
    closeUserSockets(u.id);
    purgeUser(u.id);
    logAudit(req, 'account.delete', { type: 'user', id: u.id, meta: { email: u.email } });
    setCookie(req, res, '');
    res.json({ ok: true });
  });
}