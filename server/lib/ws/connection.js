import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { db, uid, now, getSetting } from '../../db.js';
import { sessionFromRequest } from '../../auth.js';
import { buildMessages, streamCompletion, canPrefill, refusePrefill } from '../../llm/index.js';
import * as websearch from '../websearch.js';
import * as sandbox from '../../sandbox.js';
import { UPLOADS } from '../uploads.js';
import { ensureChain, activePath } from '../tree.js';
import { resolveModel } from '../models.js';
import { applyKwargs } from '../kwargs.js';
import { budgetStatus, recordUsage } from '../budget.js';
import { runQueued } from '../queue.js';
import { styleTextFor, CUT_NOTE } from '../convo.js';
import { resumeTurn, createStitcher, isPrefillRefusal } from '../resume.js';
import { systemPrompt } from '../systemprompt.js';
import { cleanClient, rememberClient } from '../memberctx.js';

import { clients, requestedKwargs } from './broadcast.js';
import { runCompletion } from './turn.js';
import * as live from './live.js';
import { isRouter, resolveRouted } from '../router.js';
import { sameOrigin } from '../origin.js';
import { sandboxCap } from '../workspacefiles.js';
import { liveVersion } from '../releases.js';
import { setPresence, presenceList, broadcastPresence } from './presence.js';

// A frame this large is already far beyond any real composer paste; the cap exists so a
// hostile client cannot make the server buffer an arbitrary amount before we ever look
// at the payload. MAX_CONTENT then bounds what actually reaches a database row.
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_CONTENT = 1_000_000;
const MAX_ATTACHMENTS = 20;
const MAX_INCOGNITO_TURNS = 40;

function textField(v, cap = MAX_CONTENT) {
  return typeof v === 'string' ? v.slice(0, cap) : '';
}

function sanitizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const url = textField(a.url, 512);
    if (!url) continue;
    out.push({ url, name: textField(a.name, 256), type: textField(a.type, 128), size: Number(a.size) || 0 });
    if (out.length >= MAX_ATTACHMENTS) break;
  }
  return out;
}

export function initWs(server) {
  // The session cookie alone is not enough to authorise a socket: SameSite does not
  // reliably cover the websocket handshake in every browser, so a hostile page could
  // otherwise open an authenticated socket to this server and read the user's stream.
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: MAX_FRAME_BYTES,
    verifyClient: ({ req }, done) => {
      if (!sameOrigin(req)) return done(false, 403, 'Forbidden');
      if (!sessionFromRequest(req)) return done(false, 401, 'Unauthorized');
      done(true);
    }
  });

  wss.on('connection', (ws, req) => {
    const r = sessionFromRequest(req);
    let u = r?.user;
    if (!u) { ws.close(); return; }
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    clients.set(ws, { userId: u.id, sessionId: r.sessionId || null, isAdmin: !!u.is_admin, aborts: new Map(), steers: new Map(), stops: new Set() });
    const safeSend = (s) => { if (ws.readyState === 1) { try { ws.send(s); } catch {} } };
    const userId = u.id;
    const liveSend = (s) => live.sendLive(userId, s);
    const liveState = { aborts: live.aborts, steers: live.steers, stops: live.stops, interactive: true };
    const liveWs = { readyState: 1, send: liveSend };
    safeSend(JSON.stringify({ type: 'hello', configVersion: liveVersion() }));
    if (u.is_admin) safeSend(JSON.stringify({ type: 'presence', admins: presenceList() }));
    {
      const pending = live.snapshotsFor(u.id);
      if (pending.length) safeSend(JSON.stringify({ type: 'resume', turns: pending }));
    }

    ws.on('message', async (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      const state = clients.get(ws);
      if (!state) return;
      const fresh = db.users.byId(userId);
      if (!fresh) { ws.close(); return; }
      u = fresh;
      state.isAdmin = !!u.is_admin;
      const ownsChat = (chatId) => {
        if (typeof chatId !== 'string' || !chatId || chatId === 'incognito') return false;
        const c = db.chats.byId(chatId);
        return !!c && c.user_id === state.userId;
      };
      if (msg.type === 'presence') {
        setPresence(state, msg.at);
        return;
      }
      if (msg.type === 'stop') {
        const own = msg.chatId === 'incognito' ? state : (ownsChat(msg.chatId) && live.activeTurn(msg.chatId) ? liveState : null);
        if (!own) return;
        own.steers.delete(msg.chatId);
        // Recorded before aborting: the controller may already be spent (a stop
        // during tool execution), and the flag is what actually ends the loop.
        if (own.stops) own.stops.add(msg.chatId);
        const c = own.aborts.get(msg.chatId);
        if (c) { c.abort(); own.aborts.delete(msg.chatId); }
        return;
      }
      if (msg.type === 'answer') {
        if (!ownsChat(msg.chatId)) return;
        if (msg.skip === true) { live.answerQuestion(msg.chatId, { skipped: true }); return; }
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 4000) : '';
        if (text) live.answerQuestion(msg.chatId, { answer: text });
        return;
      }
      if (msg.type === 'steer') {
        const text = String(msg.text || '').trim().slice(0, 2000);
        const own = msg.chatId === 'incognito' ? state : (ownsChat(msg.chatId) ? liveState : null);
        const c = text && own ? own.aborts.get(msg.chatId) : null;
        if (!c) return;
        if (db.users.byId(state.userId)?.prefs?.steering !== true) return;
        const list = own.steers.get(msg.chatId) || [];
        if (list.length >= 6) return;
        list.push(text);
        own.steers.set(msg.chatId, list);
        c.abort();
        return;
      }
      const client = cleanClient(msg.client);
      rememberClient(u, client);
      if (msg.type === 'incognito') {
        try {
          const baseModel = resolveModel(msg.modelId, state.isAdmin);
          const model = applyKwargs(baseModel, requestedKwargs(msg), state.isAdmin);
          if (!model) { safeSend(JSON.stringify({ type: 'error', error: 'Invalid model.' })); safeSend(JSON.stringify({ type: 'done' })); return; }
          if (model.unavailable && !state.isAdmin) { safeSend(JSON.stringify({ type: 'error', error: (model.unavailable_reason || 'This model is currently unavailable.') })); safeSend(JSON.stringify({ type: 'done' })); return; }
          const ibs = budgetStatus(u);
          if (ibs.enforce && ibs.state === 'over') { safeSend(JSON.stringify({ type: 'error', chatId: 'incognito', error: 'You have reached your monthly usage budget. It resets at the start of next month.' })); safeSend(JSON.stringify({ type: 'done', chatId: 'incognito' })); return; }
          if (state.aborts.has('incognito')) { safeSend(JSON.stringify({ type: 'error', chatId: 'incognito', error: 'A reply is already being generated. Wait for it to finish, or stop it first.' })); safeSend(JSON.stringify({ type: 'done', chatId: 'incognito' })); return; }
          const turns = (Array.isArray(msg.messages) ? msg.messages : [])
            .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-MAX_INCOGNITO_TURNS);
          const resumeOf = msg.resume === true && turns.length && turns[turns.length - 1].role === 'assistant' ? turns.pop() : null;
          const history = turns.map(m => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT) + (m.role === 'assistant' && m.truncated === true ? '\n\n' + CUT_NOTE : '') }));
          if (!history.length || history[history.length - 1].role !== 'user' || (msg.resume === true && !resumeOf)) {
            safeSend(JSON.stringify({ type: 'error', error: 'Nothing to send.' })); safeSend(JSON.stringify({ type: 'done' })); return;
          }
          const base = buildMessages(model, history, !!msg.extended, systemPrompt(null, model, {}, { userId: u.id, client }).text);
          let partial = resumeOf ? resumeOf.content.slice(0, MAX_CONTENT) : '';
          let plan = resumeOf ? resumeTurn(partial, canPrefill(model)) : null;
          if (!plan) partial = '';
          const resumeId = typeof msg.messageId === 'string' && /^inc-[\w-]{1,64}$/.test(msg.messageId) ? msg.messageId : '';
          const assistantId = (resumeOf && resumeId) || ('inc-' + uid());
          const controller = new AbortController();
          state.aborts.set('incognito', controller);
          safeSend(JSON.stringify({ type: 'start', chatId: 'incognito', messageId: assistantId, ...(resumeOf ? { content: partial } : {}) }));
          let usage = null;
          let stitcher = createStitcher(partial, plan);
          const sendContent = (text) => { if (text) safeSend(JSON.stringify({ type: 'content', chatId: 'incognito', text })); };
          const flush = () => { if (stitcher) { sendContent(stitcher.flush()); stitcher = null; } };
          const run = () => streamCompletion({
            model, messages: plan ? base.concat(plan.messages) : base, signal: controller.signal,
            onEvent: (e) => {
              if (e.type === 'reasoning') safeSend(JSON.stringify({ type: 'reasoning', chatId: 'incognito', text: e.text }));
              else if (e.type === 'content') sendContent(stitcher ? stitcher.push(e.text) : e.text);
              else if (e.type === 'usage') usage = e.usage;
            }
          });
          try {
            try { await run(); }
            catch (err) {
              if (plan?.mode !== 'prefill' || !isPrefillRefusal(err)) throw err;
              refusePrefill(model);
              plan = resumeTurn(partial, false);
              stitcher = createStitcher(partial, plan);
              await run();
            }
          } catch (err) { if (err.name !== 'AbortError') safeSend(JSON.stringify({ type: 'error', chatId: 'incognito', error: String(err.message || err) })); }
          flush();
          recordUsage(u.id, model, usage);
          state.aborts.delete('incognito');
          if (state.stops) state.stops.delete('incognito');
          safeSend(JSON.stringify({ type: 'done', chatId: 'incognito', messageId: assistantId, stopped: controller.signal.aborted }));
        } catch (err) {
          state.aborts.delete('incognito');
          safeSend(JSON.stringify({ type: 'error', chatId: 'incognito', error: String(err.message || err) }));
          safeSend(JSON.stringify({ type: 'done', chatId: 'incognito' }));
        }
        return;
      }
      if (msg.type !== 'chat' && msg.type !== 'regenerate' && msg.type !== 'edit' && msg.type !== 'continue') return;
      if (typeof msg.chatId !== 'string' || !msg.chatId) return;
      const content = textField(msg.content);
      const attachments = sanitizeAttachments(msg.attachments);
      const messageId = typeof msg.messageId === 'string' ? msg.messageId : '';
      if (msg.type === 'chat' && !content.trim() && !attachments.length) {
        safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: 'Nothing to send.' }));
        safeSend(JSON.stringify({ type: 'done', chatId: msg.chatId }));
        return;
      }
      let ownsTurn = false;
      try {
        const chat = db.chats.byId(msg.chatId);
        const hubModel = resolveModel(msg.modelId, state.isAdmin);
        if (!chat || chat.user_id !== u.id || !hubModel) { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: 'Invalid chat or model.' })); return; }
        let routedInfo = null;
        let baseModel = hubModel;
        if (isRouter(hubModel)) {
          const probe = [{ role: 'user', content: msg.type === 'regenerate' || msg.type === 'continue' ? db.messages.lastUserText(chat.id) : content }];
          const r = resolveRouted(hubModel, probe, attachments, (id) => resolveModel(id, state.isAdmin));
          if (!r.model) { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: r.routed?.error || 'This router could not pick a model.' })); safeSend(JSON.stringify({ type: 'done', chatId: msg.chatId })); return; }
          baseModel = r.model;
          routedInfo = r.routed;
        }
        const model = applyKwargs(baseModel, requestedKwargs(msg), state.isAdmin);
        if (!model) { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: 'Invalid chat or model.' })); return; }
        if (model.unavailable && !state.isAdmin) { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: (model.unavailable_reason || 'This model is currently unavailable.') })); return; }
        if (chat.ended) { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: 'This conversation was ended by the assistant and can no longer be continued.' })); safeSend(JSON.stringify({ type: 'done', chatId: msg.chatId })); return; }
        const bs = budgetStatus(u);
        if (bs.enforce && bs.state === 'over') { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: 'You have reached your monthly usage budget. It resets at the start of next month.' })); safeSend(JSON.stringify({ type: 'done', chatId: msg.chatId })); return; }
        if (live.activeTurn(chat.id)) { safeSend(JSON.stringify({ type: 'error', chatId: chat.id, error: 'A reply is already being generated in this chat. Wait for it to finish, or stop it first.' })); safeSend(JSON.stringify({ type: 'done', chatId: chat.id })); return; }

        const sandboxLimit = sandboxCap(u);
        const codeMode = chat.mode === 'code';
        const sandboxOn = codeMode || !!chat.project_id;
        const webSearchOn = (codeMode || !!msg.webSearch) && websearch.webSearchAvailable() && model.web_search_allowed !== 0;
        ensureChain(chat.id);

        let resume = null;
        if (msg.type === 'continue') {
          resume = messageId ? db.messages.byId(messageId) : null;
          const leaf = (db.chats.byId(chat.id) || {}).active_leaf;
          if (!resume || resume.chat_id !== chat.id || resume.role !== 'assistant' || leaf !== resume.id) { safeSend(JSON.stringify({ type: 'error', chatId: chat.id, error: 'Only the latest reply can be continued.' })); safeSend(JSON.stringify({ type: 'done', chatId: chat.id })); return; }
        } else if (msg.type === 'regenerate') {
          const target = (messageId && db.messages.byId(messageId)) || activePath(chat.id).slice().reverse().find(m => m.role === 'assistant');
          if (!target || target.chat_id !== chat.id) { safeSend(JSON.stringify({ type: 'error', chatId: chat.id, error: 'Nothing to regenerate.' })); return; }
          const parent = target.role === 'assistant' ? (target.parent_id ?? null) : target.id;
          db.chats.update(chat.id, { active_leaf: parent });
        } else if (msg.type === 'edit') {
          const orig = messageId ? db.messages.byId(messageId) : null;
          if (!orig || orig.chat_id !== chat.id) { safeSend(JSON.stringify({ type: 'error', chatId: chat.id, error: 'Message not found.' })); return; }
          const umid = uid();
          const kept = orig.attachments || [];
          const seen = new Set(kept.map(a => a.url));
          const merged = kept.concat(attachments.filter(a => !seen.has(a.url))).slice(0, MAX_ATTACHMENTS);
          db.messages.insert({ id: umid, chat_id: chat.id, role: 'user', content, reasoning: '', model_id: null, attachments: merged, parent_id: orig.parent_id ?? null, created_at: now() });
          db.chats.update(chat.id, { active_leaf: umid });
        } else {
          const parent = (db.chats.byId(chat.id) || {}).active_leaf || null;
          const umid = uid();
          db.messages.insert({ id: umid, chat_id: chat.id, role: 'user', content, reasoning: '', model_id: null, attachments, parent_id: parent, created_at: now() });
          db.chats.update(chat.id, { active_leaf: umid });
          if (sandboxOn && attachments.length) {
            for (const a of attachments) {
              try {
                const fname = path.basename(a.url || '');
                const src = fname ? path.join(UPLOADS, fname) : '';
                if (src && fs.existsSync(src)) sandbox.importBuffer(sandbox.wsKey(chat), path.basename(a.name || fname || 'file'), fs.readFileSync(src), sandboxLimit);
                else console.warn('[sandbox import] upload not found for', a.name, '->', src);
              } catch (e) { console.warn('[sandbox import] failed for', a && a.name, e.message); }
            }
            safeSend(JSON.stringify({ type: 'files', chatId: chat.id, files: sandbox.list(sandbox.wsKey(chat)) }));
          }
        }

        if (routedInfo) safeSend(JSON.stringify({ type: 'routed', chatId: chat.id, ...routedInfo }));
        const queueOn = getSetting('model_queue', '0') === '1';
        const styleText = styleTextFor(u.id, msg.styleId);
        live.beginTurn(u.id, chat.id, model.id);
        ownsTurn = true;
        try {
          await runQueued(queueOn, model.id,
            () => { liveSend(JSON.stringify({ type: 'queued', chatId: chat.id })); },
            () => runCompletion(liveWs, liveState, liveSend, chat, model, !!msg.extended, sandboxOn, sandboxLimit, webSearchOn, !!msg.call, { styleText, client, resume, plan: codeMode && !!msg.plan }));
        } finally { live.endTurn(chat.id); }
      } catch (err) {
        console.error('[ws chat]', err);
        const send = ownsTurn ? liveSend : safeSend;
        send(JSON.stringify({ type: 'error', chatId: msg.chatId, error: String(err.message || err) }));
        send(JSON.stringify({ type: 'done', chatId: msg.chatId }));
      }
    });

    ws.on('error', () => {});
    ws.on('close', () => {
      const st = clients.get(ws);
      try {
        if (st) {
          st.steers.clear();
          for (const c of st.aborts.values()) c.abort();
          st.aborts.clear();
        }
      } catch {}
      clients.delete(ws);
      if (st?.presence) broadcastPresence();
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of clients.keys()) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { try { ws.terminate(); } catch {} }
    }
  }, 30000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}