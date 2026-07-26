import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { db, uid, now, getSetting } from '../../db.js';
import { sessionFromRequest } from '../../auth.js';
import { buildMessages, streamCompletion } from '../../llm/index.js';
import * as websearch from '../../websearch.js';
import * as sandbox from '../../sandbox.js';
import { UPLOADS } from '../uploads.js';
import { ensureChain, activePath } from '../tree.js';
import { resolveModel, roleLimit } from '../models.js';
import { applyKwargs } from '../kwargs.js';
import { budgetStatus } from '../budget.js';
import { runQueued } from '../queue.js';
import { maybeUpdateMemory } from '../memory.js';
import { promptVars, styleTextFor } from '../convo.js';

import { clients, requestedKwargs } from './broadcast.js';
import { runCompletion } from './turn.js';

export function initWs(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const r = sessionFromRequest(req);
    const u = r?.user;
    if (!u) { ws.close(); return; }
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    clients.set(ws, { userId: u.id, sessionId: r.sessionId || null, isAdmin: !!u.is_admin, aborts: new Map(), steers: new Map() });
    const safeSend = (s) => { if (ws.readyState === 1) { try { ws.send(s); } catch {} } };

    ws.on('message', async (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      const state = clients.get(ws);
      if (!state) return;
      if (msg.type === 'stop') { state.steers.delete(msg.chatId); const c = state.aborts.get(msg.chatId); if (c) { c.abort(); state.aborts.delete(msg.chatId); } return; }
      if (msg.type === 'steer') {
        const text = String(msg.text || '').trim().slice(0, 2000);
        const c = text ? state.aborts.get(msg.chatId) : null;
        if (!c) return;
        if (db.users.byId(state.userId)?.prefs?.steering !== true) return;
        const list = state.steers.get(msg.chatId) || [];
        if (list.length >= 6) return;
        list.push(text);
        state.steers.set(msg.chatId, list);
        c.abort();
        return;
      }
      if (msg.type === 'incognito') {
        try {
          const baseModel = resolveModel(msg.modelId, state.isAdmin);
          const model = applyKwargs(baseModel, requestedKwargs(msg), state.isAdmin);
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
        const baseModel = resolveModel(msg.modelId, state.isAdmin);
        const model = applyKwargs(baseModel, requestedKwargs(msg), state.isAdmin);
        if (!chat || chat.user_id !== u.id || !model) { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: 'Invalid chat or model.' })); return; }
        if (model.unavailable && !state.isAdmin) { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: (model.unavailable_reason || 'This model is currently unavailable.') })); return; }
        if (chat.ended) { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: 'This conversation was ended by the assistant and can no longer be continued.' })); safeSend(JSON.stringify({ type: 'done', chatId: msg.chatId })); return; }
        const bs = budgetStatus(u);
        if (bs.enforce && bs.state === 'over') { safeSend(JSON.stringify({ type: 'error', chatId: msg.chatId, error: 'You have reached your monthly usage budget. It resets at the start of next month.' })); safeSend(JSON.stringify({ type: 'done', chatId: msg.chatId })); return; }

        const sandboxCap = roleLimit('sandbox_limit_mb', !!u.is_admin, u.is_admin ? 1024 : 256) * 1024 * 1024;
        const userSandbox = !!msg.sandbox;
        if (!!chat.sandbox !== userSandbox) db.chats.update(chat.id, { sandbox: userSandbox ? 1 : 0 });
        const sandboxOn = userSandbox;
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
        const styleText = styleTextFor(u.id, msg.styleId);
        await runQueued(queueOn, model.id,
          () => { safeSend(JSON.stringify({ type: 'queued', chatId: chat.id })); },
          () => runCompletion(ws, state, safeSend, chat, model, !!msg.extended, sandboxOn, sandboxCap, webSearchOn, !!msg.call, styleText));
        maybeUpdateMemory(u.id, model);
      } catch (err) {
        if (msg && msg.chatId) state.aborts.delete(msg.chatId);
        safeSend(JSON.stringify({ type: 'error', chatId: msg && msg.chatId, error: String(err.message || err) }));
        safeSend(JSON.stringify({ type: 'done', chatId: msg && msg.chatId }));
      }
    });

    ws.on('error', () => {});
    ws.on('close', () => { const st = clients.get(ws); try { if (st) { st.steers.clear(); for (const c of st.aborts.values()) c.abort(); } } catch {} clients.delete(ws); });
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
