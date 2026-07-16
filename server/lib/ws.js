import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { db, uid, now, getSetting } from '../db.js';
import { sessionFromRequest } from '../auth.js';
import { buildMessages, streamCompletion, generateTitle } from '../llm.js';
import { buildTools, toCall, livePreview } from '../tools.js';
import * as websearch from '../websearch.js';
import * as sandbox from '../sandbox.js';
import * as membank from '../membank.js';
import * as skillsys from '../skillsys.js';
import * as mcp from '../mcp.js';
import * as projectfiles from '../projectfiles.js';
import { stripToolSyntax } from './history.js';
import { UPLOADS } from './uploads.js';
import { ensureChain, activePath } from './tree.js';
import { resolveModel, applyEffort, roleLimit, modelCtx } from './models.js';
import { budgetStatus } from './budget.js';
import { runQueued } from './queue.js';
import { maybeUpdateMemory } from './memory.js';
import {
  chatHistory, estimateTokens, calibratedTokens, updateCalib, truncateForRollingCtx,
  rollingCtxFor, compactStep, compactThreshold, promptVars, instrFor, styleTextFor
} from './convo.js';
import {
  sandboxPromptFor, cleanCall, resultPayload, formatToolResult,
  runChatSearchTool, formatChatSearchResult, chatSearchPayload,
  endChatPromptFor, longConvoReminderFor, CHAT_SEARCH_PROMPT
} from './prompts.js';

export const clients = new Map(); // ws -> {userId, abort}

export function broadcastConfig() {
  const msg = JSON.stringify({ type: 'config' });
  for (const ws of clients.keys()) if (ws.readyState === 1) ws.send(msg);
}

// notify only admin sessions to refresh their draft view (live editing)
export function broadcastAdminConfig() {
  const msg = JSON.stringify({ type: 'config' });
  for (const [ws, st] of clients.entries()) if (ws.readyState === 1 && st.isAdmin) ws.send(msg);
}

export function killSessionSockets(sessionId) {
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

export function broadcastToUser(userId, payload) {
  const msg = JSON.stringify(payload);
  for (const [sock, st] of clients.entries()) if (sock.readyState === 1 && st.userId === userId) sock.send(msg);
}

async function maybeCompact(ws, chat, model, extended, sandboxOn) {
  const threshold = compactThreshold(model, await modelCtx(model));
  if (threshold === Infinity) return;
  let guard = 0;
  while (guard++ < 3) {
    const fresh = db.chats.byId(chat.id);
    const sandboxP = sandboxOn ? sandboxPromptFor(chat.id) : null;
    const convo = buildMessages(model, await chatHistory(chat, model), extended, sandboxP, fresh.summary, promptVars(chat.user_id), await instrFor(fresh));
    if (calibratedTokens(chat.id, convo) < threshold) return;
    if (!(await compactStep(ws, chat, model))) return;
  }
}

export function initWs(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const r = sessionFromRequest(req);
    const u = r?.user;
    if (!u) { ws.close(); return; }
    clients.set(ws, { userId: u.id, sessionId: r.sessionId || null, isAdmin: !!u.is_admin, aborts: new Map() });
    const safeSend = (s) => { if (ws.readyState === 1) { try { ws.send(s); } catch {} } };

    async function runCompletion(ws, state, chat, model, extended, sandboxOn, sandboxCap = 0, webSearchOn = false, callMode = false, styleText = '') {
      if (callMode && (model.call_prompt || '').trim()) model = { ...model, system_prompt: model.call_prompt };
      {
        const cRow0 = db.chats.byId(chat.id) || chat;
        if (cRow0.gen_params && typeof cRow0.gen_params === 'object') model = { ...model, ...cRow0.gen_params };
        if ((cRow0.system_override || '').trim()) model = { ...model, system_prompt: cRow0.system_override };
      }
      await maybeCompact(ws, chat, model, extended, sandboxOn);
      const history = await chatHistory(chat, model);
      const chatRow = db.chats.byId(chat.id) || chat;
      const membankOn = getSetting('membank_enabled', '0') === '1' && membank.list().length > 0;
      const membankHideTools = getSetting('membank_hide_tools', '0') === '1';
      if (membankOn) { try { await membank.ensureIndexedAll(); } catch {} }
      const chatSearchOn = !!model.chat_search_allowed && getSetting('chat_search_enabled', '0') === '1';
      const skillsOn = !!model.skills_allowed && skillsys.getEnabled().length > 0;
      const mcpSchemas = model.mcp_allowed ? mcp.toolSchemas() : [];
      const mcpOn = mcpSchemas.length > 0;
      const endChatOn = !!model.end_chat_allowed;
      const projFilesOn = !!chatRow.project_id && projectfiles.list(chatRow.project_id).length > 0;
      const projRow = projFilesOn ? db.projects.byId(chatRow.project_id) : null;
      const longReminderOn = !!model.long_convo_reminder;
      let conversationEnded = false;
      const toolsOn = sandboxOn || webSearchOn || membankOn || chatSearchOn || skillsOn || mcpOn || endChatOn || projFilesOn;
      const withStyle = (instr) => {
        if (!styleText) return instr;
        const block = 'The user selected a response style for this conversation. Apply it consistently to every reply:\n' + styleText;
        return instr ? instr + '\n\n' + block : block;
      };
      const toolsP = () => {
        const parts = [];
        if (sandboxOn) parts.push(sandboxPromptFor(chat.id));
        if (webSearchOn) { parts.push(websearch.webSearchConfig().prompt); parts.push(websearch.webSearchToolPrompt()); }
        if (membankOn) parts.push(membank.promptFor(getSetting('membank_prompt', '')));
        if (chatSearchOn) parts.push(CHAT_SEARCH_PROMPT);
        if (skillsOn) parts.push(skillsys.promptFor());
        if (mcpOn) parts.push(mcp.promptFor());
        if (endChatOn) parts.push(endChatPromptFor(model));
        if (projFilesOn) parts.push(projectfiles.promptFor(chatRow.project_id, projRow ? projRow.name : ''));
        if (longReminderOn) parts.push(longConvoReminderFor(chat.id));
        return parts.filter(Boolean).join('\n\n') || null;
      };
      let base = buildMessages(model, history, extended, toolsP(), chatRow.summary, promptVars(chat.user_id), withStyle(await instrFor(chatRow)));
      let inTurn = []; // assistant/tool exchanges accumulated during this response
      const assistantId = uid();
      const assistantParent = (db.chats.byId(chat.id) || {}).active_leaf || null;
      let content = '', reasoning = '', usage = null;
      safeSend(JSON.stringify({ type: 'start', chatId: chat.id, messageId: assistantId }));

      const tools = toolsOn ? buildTools({ sandboxOn, webSearchOn, membankOn, chatSearchOn, skillsOn, mcpSchemas, endChatOn, projFilesOn }) : [];
      const runToolCall = async (call) => {
        if (call.tool === 'end_conversation') {
          if (!endChatOn) return null;
          const reason = String(call.reason || '').trim().slice(0, 500);
          db.chats.update(chat.id, { ended: 1, ended_at: now(), ended_reason: reason });
          conversationEnded = true;
          return { payload: { ok: true, ended: true }, formatted: 'end_conversation \u2192 The conversation has been permanently ended. Do not produce any further tool calls; finish your reply now.', hide: false };
        }
        if (call.tool === 'pf_search' || call.tool === 'pf_view') {
          if (!projFilesOn) return null;
          const r = await projectfiles.execTool(chatRow.project_id, call);
          return { payload: projectfiles.resultPayload(call, r), formatted: projectfiles.formatResult(call, r), hide: false };
        }
        if (call.tool === 'chat_search' || call.tool === 'chat_view') {
          if (!chatSearchOn) return null;
          const r = runChatSearchTool(chat.user_id, chat.id, call);
          return { payload: chatSearchPayload(call, r), formatted: formatChatSearchResult(call, r), hide: false };
        }
        if (call.tool === 'skill_view') {
          if (!skillsOn) return null;
          const r = skillsys.execTool(call);
          return { payload: skillsys.resultPayload(call, r), formatted: skillsys.formatResult(call, r), hide: false };
        }
        if (mcpOn && mcp.isMcpTool(call.tool)) {
          const r = await mcp.execTool(call);
          return { payload: mcp.resultPayload(call, r), formatted: mcp.formatResult(call, r), hide: false };
        }
        if (call.tool === 'web_search') {
          if (!webSearchOn) return null;
          const r = await websearch.runWebSearch(call);
          return { payload: websearch.webSearchResultPayload(call, r), formatted: websearch.formatWebSearchResult(call, r), hide: false };
        }
        if (call.tool === 'mb_view' || call.tool === 'mb_search') {
          if (!membankOn) return null;
          const r = membank.execTool(call);
          return { payload: membank.resultPayload(call, r), formatted: membank.formatResult(call, r), hide: membankHideTools };
        }
        if (!sandboxOn) return null;
        const r = await sandbox.execTool(chat.id, call, sandboxCap);
        return { payload: resultPayload(call, r), formatted: formatToolResult(call, r), hide: false };
      };

      const threshold = compactThreshold(model, await modelCtx(model));
      const rollCtx = await rollingCtxFor(model);
      let rollNotified = false;
      const stepCap = (model.agent_steps && model.agent_steps > 0) ? model.agent_steps : 1000;
      const maxSteps = toolsOn ? stepCap : 1;
      try {
        for (let step = 0; step < maxSteps; step++) {
          // running low on context mid-response? summarize older turns, then carry on where we left off
          if (threshold !== Infinity && inTurn.length && calibratedTokens(chat.id, [...base, ...inTurn]) >= threshold) {
            if (await compactStep(ws, chat, model)) base = buildMessages(model, await chatHistory(chat, model), extended, toolsP(), (db.chats.byId(chat.id) || {}).summary, promptVars(chat.user_id), withStyle(await instrFor(db.chats.byId(chat.id) || chat)));
          }
          let convo = [...base, ...inTurn];
          if (rollCtx) {
            const t = truncateForRollingCtx(chat.id, convo, rollCtx);
            if (t.dropped || t.trimmed) {
              convo = t.msgs;
              if (!rollNotified) {
                rollNotified = true;
                safeSend(JSON.stringify({ type: 'ctx_rolling', chatId: chat.id, dropped: t.dropped, trimmed: t.trimmed, limit: rollCtx }));
              }
            }
          }
          const stepEstimate = estimateTokens(convo);
          let stepPromptTokens = 0;
          const controller = new AbortController();
          state.aborts.set(chat.id, controller);
          let stepText = '';
          let aborted = false;
          let toolCalls = [];
          let liveSent = false;
          let liveState = { key: '', len: 0, lastAt: 0 };
          try {
            await streamCompletion({
              model, messages: convo, tools, signal: controller.signal,
              onEvent: (e) => {
                if (e.type === 'usage') { stepPromptTokens = e.usage.prompt || stepPromptTokens; if (!usage) usage = { prompt: 0, completion: 0, total: 0 }; usage.prompt += e.usage.prompt || 0; usage.completion += e.usage.completion || 0; usage.total += e.usage.total || 0; return; }
                if (e.type === 'reasoning') { reasoning += e.text; safeSend(JSON.stringify({ type: 'reasoning', chatId: chat.id, text: e.text })); return; }
                if (e.type === 'content') {
                  content += e.text; stepText += e.text;
                  safeSend(JSON.stringify({ type: 'content', chatId: chat.id, text: e.text }));
                  return;
                }
                if (e.type === 'tool_call_delta') {
                  const live = livePreview(e.name, e.argsText);
                  if (!live || !live.tool) return;
                  const isFile = (live.tool === 'create_file' || live.tool === 'str_replace') && live.path;
                  if (isFile) {
                    const key = e.index + ':' + live.tool + ':' + live.path + ':' + (live.oldStr || '');
                    if (key !== liveState.key) {
                      liveState = { key, len: (live.content || '').length, lastAt: Date.now() };
                      liveSent = true;
                      safeSend(JSON.stringify({ type: 'tool_live', chatId: chat.id, live }));
                    } else if ((live.content || '').length > liveState.len) {
                      const text = live.content.slice(liveState.len);
                      liveState.len = live.content.length;
                      liveSent = true;
                      safeSend(JSON.stringify({ type: 'tool_live_delta', chatId: chat.id, text }));
                    }
                  } else {
                    const key = e.index + ':' + JSON.stringify(live);
                    const t = Date.now();
                    if (key !== liveState.key && t - liveState.lastAt > 120) {
                      liveState = { key, len: 0, lastAt: t };
                      liveSent = true;
                      safeSend(JSON.stringify({ type: 'tool_live', chatId: chat.id, live }));
                    }
                  }
                  return;
                }
                if (e.type === 'tool_calls') { toolCalls = e.calls; }
              }
            });
          } catch (err) {
            if (err.name === 'AbortError') aborted = true; else throw err;
          }
          updateCalib(chat.id, stepPromptTokens, stepEstimate);
          if (aborted || !toolsOn || !toolCalls.length) {
            if (liveSent) safeSend(JSON.stringify({ type: 'tool_live', chatId: chat.id, live: null }));
            break;
          }
          const toolMsgs = [];
          for (const tc of toolCalls) {
            const call = toCall(tc.name, tc.argsText);
            if (conversationEnded) {
              toolMsgs.push({ role: 'tool', tool_call_id: tc.id, name: call.tool, content: `${call.tool} \u2192 ERROR: the conversation has been ended; no further tools may run.` });
              continue;
            }
            safeSend(JSON.stringify({ type: 'tool_exec', chatId: chat.id, call: cleanCall(call) }));
            let out;
            try { out = await runToolCall(call); }
            catch (e) { out = { payload: { ok: false, error: String(e.message || e).slice(0, 400) }, formatted: `${call.tool} → ERROR: ${String(e.message || e).slice(0, 400)}`, hide: false }; }
            if (!out) out = { payload: { ok: false, error: `Unknown or disabled tool: ${call.tool}` }, formatted: `${call.tool} → ERROR: this tool is not available.`, hide: false };
            if (!out.hide) {
              const block = '\n\n[[OQR:' + Buffer.from(JSON.stringify({ call: cleanCall(call), result: out.payload }), 'utf8').toString('base64') + ']]\n';
              content += block;
              safeSend(JSON.stringify({ type: 'content', chatId: chat.id, text: block }));
            }
            if (sandboxOn) safeSend(JSON.stringify({ type: 'files', chatId: chat.id, files: sandbox.list(chat.id) }));
            toolMsgs.push({ role: 'tool', tool_call_id: tc.id, name: call.tool, content: out.formatted });
          }
          safeSend(JSON.stringify({ type: 'tool_live', chatId: chat.id, live: null }));
          if (conversationEnded) {
            const endedChat = db.chats.byId(chat.id);
            safeSend(JSON.stringify({ type: 'chat_ended', chatId: chat.id, reason: (endedChat && endedChat.ended_reason) || '' }));
            break;
          }
          inTurn = [
            ...inTurn,
            { role: 'assistant', content: stepText, tool_calls: toolCalls.map(c => ({ id: c.id, name: c.name, argsText: c.argsText })) },
            ...toolMsgs
          ];
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
      db.messages.insert({ id: assistantId, chat_id: chat.id, role: 'assistant', content, reasoning, model_id: model.id, parent_id: assistantParent, usage: usageRec, extended: !!extended, reasoning_effort: model.reasoning_effort_level || null, created_at: now() });
      db.chats.update(chat.id, { updated_at: now(), active_leaf: assistantId });
      const truncated = !!(Number(model.max_tokens) > 0 && usage && usage.completion >= Number(model.max_tokens) - 2 && !conversationEnded);
      safeSend(JSON.stringify({ type: 'done', chatId: chat.id, messageId: assistantId, truncated }));

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
          const model = applyEffort(resolveModel(msg.modelId, state.isAdmin), msg.reasoningEffort);
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
        const model = applyEffort(resolveModel(msg.modelId, state.isAdmin), msg.reasoningEffort);
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
          () => runCompletion(ws, state, chat, model, !!msg.extended, sandboxOn, sandboxCap, webSearchOn, !!msg.call, styleText));
        maybeUpdateMemory(u.id, model);
      } catch (err) {
        if (msg && msg.chatId) state.aborts.delete(msg.chatId);
        safeSend(JSON.stringify({ type: 'error', chatId: msg && msg.chatId, error: String(err.message || err) }));
        safeSend(JSON.stringify({ type: 'done', chatId: msg && msg.chatId }));
      }
    });

    ws.on('error', () => {});
    ws.on('close', () => { const st = clients.get(ws); try { if (st) for (const c of st.aborts.values()) c.abort(); } catch {} clients.delete(ws); });
  });

  return wss;
}
