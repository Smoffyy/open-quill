import { db, uid, now, getSetting } from '../../db.js';
import { buildMessages, streamCompletion, generateTitle, stripThink } from '../../llm/index.js';
import { buildTools, toCall, livePreview } from '../../tools/index.js';
import * as websearch from '../../websearch.js';
import * as sandbox from '../../sandbox.js';
import * as membank from '../../membank.js';
import * as skillsys from '../../skillsys.js';
import * as mcp from '../../mcp.js';
import * as projectfiles from '../../projectfiles.js';
import { stripToolSyntax } from '../history.js';
import { modelCtx } from '../models.js';
import {
  chatHistory, estimateTokens, makeTokenCounter, updateCalib, truncateForRollingCtx, rollingCtxFor,
  compactStep, compactThreshold, promptVars, instrFor, exactTokens, trimInTurn
} from '../convo.js';
import { isContextOverflowError } from '../llamacpp.js';
import {
  sandboxPromptFor, cleanCall, resultPayload, formatToolResult, runChatSearchTool,
  formatChatSearchResult, chatSearchPayload, endChatPromptFor, longConvoReminderFor,
  CHAT_SEARCH_PROMPT
} from '../prompts.js';

const MAX_STEERS = 6;
const TELEMETRY_MS = 220;

function openFence(text) {
  let open = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\t/g, '    ');
    const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!m) continue;
    const mark = m[1][0];
    const len = m[1].length;
    const rest = m[2].trim();
    if (open) { if (mark === open.mark && len >= open.len && rest === '') open = null; }
    else if (!(mark === '`' && rest.includes('`'))) open = { mark, len };
  }
  return open;
}

function seamFor(text) {
  const body = String(text || '');
  if (!body.trim()) return '';
  let out = body.endsWith('\n') ? '' : '\n';
  const fence = openFence(body);
  if (fence) out += fence.mark.repeat(fence.len) + '\n';
  if (!/\n[ \t]*\n$/.test(body + out)) out += '\n';
  return out;
}

function steerInstruction(notes, hadText, wasInBlock) {
  const list = notes.map(n => '- ' + n).join('\n');
  if (!hadText) return `Before you wrote anything, the user steered you with this:\n${list}\n\nWrite your reply applying that steer, and do not mention the interruption.`;
  return [
    `The user interrupted you mid-reply and steered you with this:`,
    list,
    '',
    'What you had already written is on their screen and cannot be taken back. It may have been cut off mid-word or mid-line.',
    wasInBlock
      ? 'You were inside a fenced code block when you were cut off; that block has already been closed for you, so do not write a closing fence.'
      : 'Your text has already been closed off cleanly.',
    'Carry on in a NEW markdown block, starting fresh. If you are writing code, open a new fenced block with the correct language tag. Never continue a sentence, a line of code, or a code block that was cut off.',
    'If the steer asks for a different approach or a rewrite, start that new version now; one short line naming the switch is fine. Otherwise pick up where the reply was going.',
    'Do not reproduce the earlier text, do not apologise, and do not comment on the interruption beyond that one line.'
  ].join('\n');
}

export async function maybeCompact(ws, chat, model, extended, sandboxOn) {
  const threshold = compactThreshold(model, await modelCtx(model));
  if (threshold === Infinity) return;
  let guard = 0;
  while (guard++ < 3) {
    const fresh = db.chats.byId(chat.id);
    const sandboxP = sandboxOn ? sandboxPromptFor(chat.id) : null;
    const convo = buildMessages(model, await chatHistory(chat, model), extended, sandboxP, fresh.summary, promptVars(chat.user_id), await instrFor(fresh));
    if ((await exactTokens(chat.id, model, convo)) < threshold) return;
    if (!(await compactStep(ws, chat, model))) return;
  }
}

export async function runCompletion(ws, state, safeSend, chat, model, extended, sandboxOn, sandboxCap = 0, webSearchOn = false, callMode = false, styleText = '') {
  if (callMode && (model.call_prompt || '').trim()) model = { ...model, system_prompt: model.call_prompt };
  {
    const cRow0 = db.chats.byId(chat.id) || chat;
    if (cRow0.gen_params && typeof cRow0.gen_params === 'object') model = { ...model, ...cRow0.gen_params };
    if ((cRow0.system_override || '').trim()) model = { ...model, system_prompt: cRow0.system_override };
  }
  await maybeCompact(ws, chat, model, extended, sandboxOn);
  const history = await chatHistory(chat, model);
  const chatRow = db.chats.byId(chat.id) || chat;
  const rebuildBase = async () => {
    const row = db.chats.byId(chat.id);
    return buildMessages(model, await chatHistory(chat, model), extended, toolsP(), row ? row.summary : undefined, promptVars(chat.user_id), withStyle(await instrFor(row || chat)));
  };
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

  const ctxSize = await modelCtx(model);
  const threshold = compactThreshold(model, ctxSize);
  const rollCtx = await rollingCtxFor(model);
  let rollNotified = false;
  const stepCap = (model.agent_steps && model.agent_steps > 0) ? model.agent_steps : 1000;
  let maxSteps = toolsOn ? stepCap : 1;
  const callFails = new Map();
  let prevStepSig = '';
  let overflowRetried = false;
  const steerNotes = [];
  let steerBudget = MAX_STEERS;
  const takeSteers = () => {
    const list = state.steers && state.steers.get(chat.id);
    if (!list || !list.length) return null;
    const notes = list.splice(0, list.length);
    state.steers.delete(chat.id);
    return notes;
  };
  const applySteer = (notes, partial) => {
    steerNotes.push(...notes);
    const written = stripThink(model, String(partial || ''));
    const hadText = !!written.trim();
    const wasInBlock = hadText && !!openFence(content);
    if (hadText) {
      const seam = seamFor(content);
      if (seam) {
        content += seam;
        safeSend(JSON.stringify({ type: 'content', chatId: chat.id, text: seam }));
      }
    }
    const list = [...inTurn];
    if (hadText) list.push({ role: 'assistant', content: written + seamFor(written) });
    list.push({ role: 'user', content: steerInstruction(notes, hadText, wasInBlock) });
    inTurn = list;
    safeSend(JSON.stringify({ type: 'steered', chatId: chat.id, notes }));
  };
  try {
    for (let step = 0; step < maxSteps; step++) {
      // running low on context mid-response? summarize older turns, then carry on where we left off
      if (threshold !== Infinity && inTurn.length && (await exactTokens(chat.id, model, base.concat(inTurn))) >= threshold) {
        if (await compactStep(ws, chat, model)) base = await rebuildBase();
        if ((await exactTokens(chat.id, model, base.concat(inTurn))) >= threshold) {
          const t = trimInTurn(inTurn);
          if (t.trimmed) {
            inTurn = t.list;
            safeSend(JSON.stringify({ type: 'compacted', chatId: chat.id, trimmedTools: t.trimmed }));
          }
        }
      }
      let convo = base.concat(inTurn);
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
      let stepUsage = null;
      const controller = new AbortController();
      state.aborts.set(chat.id, controller);
      let stepText = '';
      const genTokens = makeTokenCounter();
      let aborted = false;
      let toolCalls = [];
      let liveSent = false;
      let liveState = { key: '', len: 0, lastAt: 0 };
      let genStart = 0;
      let exactTelemetry = false;
      let lastTelemetryAt = 0;
      let lastStatusAt = 0;
      let statusDone = false;
      const sendStatus = (st, force) => {
        if (statusDone && st.phase !== 'generating') return;
        const nowMs = Date.now();
        if (!force && nowMs - lastStatusAt < 200) return;
        lastStatusAt = nowMs;
        if (st.phase === 'generating') statusDone = true;
        safeSend(JSON.stringify({ type: 'status', chatId: chat.id, ...st }));
      };
      const sendTelemetry = (t) => {
        if (t.exact) exactTelemetry = true;
        const nowMs = Date.now();
        if (nowMs - lastTelemetryAt < TELEMETRY_MS) return;
        lastTelemetryAt = nowMs;
        safeSend(JSON.stringify({
          type: 'telemetry', chatId: chat.id,
          tps: Math.round((t.tps || 0) * 10) / 10,
          promptTps: Math.round((t.promptTps || 0) * 10) / 10,
          promptTokens: t.promptTokens || 0,
          genTokens: t.genTokens || 0,
          ctx: ctxSize || 0,
          exact: !!t.exact
        }));
      };
      try {
        sendStatus({ phase: 'prefill' }, true);
        await streamCompletion({
          model, messages: convo, tools, signal: controller.signal,
          onEvent: (e) => {
            if (e.type === 'usage') {
              stepPromptTokens = e.usage.prompt || stepPromptTokens;
              stepUsage = { prompt: e.usage.prompt || 0, completion: e.usage.completion || 0, total: e.usage.total || 0 };
              return;
            }
            if (e.type === 'prompt_progress') {
              const pp = e.progress || {};
              const total = Number(pp.total) || 0;
              const cache = Number(pp.cache) || 0;
              const processed = Number(pp.processed) || 0;
              const span = total - cache;
              const pct = span > 0 ? Math.max(0, Math.min(100, Math.round(((processed - cache) / span) * 100))) : (total > 0 ? 100 : 0);
              sendStatus({ phase: 'prefill', processed, total, cache, pct, ms: Number(pp.time_ms) || 0 });
              return;
            }
            if (e.type === 'timings') {
              const tm = e.timings || {};
              const gen = Number(tm.predicted_n) || 0;
              const pr = Number(tm.prompt_n) || 0;
              sendTelemetry({
                tps: Number(tm.predicted_per_second) || 0,
                promptTps: Number(tm.prompt_per_second) || 0,
                promptTokens: pr,
                genTokens: gen,
                exact: true
              });
              return;
            }
            if (e.type === 'reasoning') { if (!statusDone) sendStatus({ phase: 'generating' }, true); reasoning += e.text; safeSend(JSON.stringify({ type: 'reasoning', chatId: chat.id, text: e.text })); return; }
            if (e.type === 'content') {
              content += e.text; stepText += e.text;
              if (!genStart) { genStart = Date.now(); sendStatus({ phase: 'generating' }, true); }
              safeSend(JSON.stringify({ type: 'content', chatId: chat.id, text: e.text }));
              if (!exactTelemetry) {
                genTokens.add(e.text);
                const secs = (Date.now() - genStart) / 1000;
                const gen = genTokens.tokens;
                sendTelemetry({ tps: secs > 0.4 ? gen / secs : 0, promptTps: 0, promptTokens: stepPromptTokens || stepEstimate, genTokens: gen, exact: false });
              }
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
        if (err.name === 'AbortError') {
          const notes = takeSteers();
          if (notes && steerBudget > 0) {
            steerBudget--;
            maxSteps++;
            applySteer(notes, stepText);
            if (liveSent) safeSend(JSON.stringify({ type: 'tool_live', chatId: chat.id, live: null }));
            if (stepUsage) {
              if (!usage) usage = { prompt: 0, completion: 0, total: 0 };
              usage.prompt += stepUsage.prompt; usage.completion += stepUsage.completion;
              usage.total += stepUsage.total || (stepUsage.prompt + stepUsage.completion);
            }
            state.aborts.delete(chat.id);
            continue;
          }
          aborted = true;
        }
        else if (isContextOverflowError(err) && !overflowRetried) {
          overflowRetried = true;
          safeSend(JSON.stringify({ type: 'compacting', chatId: chat.id }));
          let freed = await compactStep(ws, chat, model);
          if (freed) base = await rebuildBase();
          const t = trimInTurn(inTurn, 1);
          if (t.trimmed) { inTurn = t.list; freed = true; }
          safeSend(JSON.stringify({ type: 'compacted', chatId: chat.id, trimmedTools: t.trimmed || 0 }));
          if (!freed) throw err;
          step--;
          continue;
        }
        else throw err;
      }
      updateCalib(chat.id, stepPromptTokens, stepEstimate);
      if (stepUsage) {
        if (!usage) usage = { prompt: 0, completion: 0, total: 0 };
        usage.prompt += stepUsage.prompt; usage.completion += stepUsage.completion;
        usage.total += stepUsage.total || (stepUsage.prompt + stepUsage.completion);
      }
      if (!aborted) {
        const notes = takeSteers();
        if (notes && steerBudget > 0) {
          steerBudget--;
          maxSteps++;
          applySteer(notes, toolCalls.length ? '' : stepText);
          if (liveSent) safeSend(JSON.stringify({ type: 'tool_live', chatId: chat.id, live: null }));
          continue;
        }
      }
      if (aborted || !toolsOn || !toolCalls.length) {
        if (liveSent) safeSend(JSON.stringify({ type: 'tool_live', chatId: chat.id, live: null }));
        break;
      }
      const toolMsgs = [];
      let stepOk = 0, stepFailed = 0;
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
        const failed = !out.payload || out.payload.ok === false;
        let formatted = out.formatted;
        const sig = call.tool + '|' + (tc.argsText || '');
        if (failed) {
          stepFailed++;
          const n = (callFails.get(sig) || 0) + 1; callFails.set(sig, n);
          if (n >= 2) formatted += `\n(NOTE: this identical call has failed ${n} times. Do not repeat it. Change the arguments or approach, or tell the user why it cannot be done.)`;
        } else { stepOk++; callFails.delete(sig); }
        if (!out.hide) {
          const block = '\n\n[[OQR:' + Buffer.from(JSON.stringify({ call: cleanCall(call), result: out.payload }), 'utf8').toString('base64') + ']]\n';
          content += block;
          safeSend(JSON.stringify({ type: 'content', chatId: chat.id, text: block }));
        }
        if (sandboxOn) safeSend(JSON.stringify({ type: 'files', chatId: chat.id, files: sandbox.list(chat.id) }));
        toolMsgs.push({ role: 'tool', tool_call_id: tc.id, name: call.tool, content: formatted });
      }
      safeSend(JSON.stringify({ type: 'tool_live', chatId: chat.id, live: null }));
      if (conversationEnded) {
        const endedChat = db.chats.byId(chat.id);
        safeSend(JSON.stringify({ type: 'chat_ended', chatId: chat.id, reason: (endedChat && endedChat.ended_reason) || '' }));
        break;
      }
      inTurn = [
        ...inTurn,
        { role: 'assistant', content: stripThink(model, stepText), tool_calls: toolCalls.map(c => ({ id: c.id, name: c.name, argsText: c.argsText })) },
        ...toolMsgs
      ];
      const stepSig = toolCalls.map(c => c.name + ':' + (c.argsText || '')).join('|');
      const loopStuck = stepOk === 0 && stepFailed > 0 && stepSig === prevStepSig;
      prevStepSig = stepSig;
      if (loopStuck) {
        const note = '\n\nI stopped because the last actions kept failing in the same way. Tell me how you would like to proceed.';
        content += note;
        safeSend(JSON.stringify({ type: 'content', chatId: chat.id, text: note }));
        break;
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') safeSend(JSON.stringify({ type: 'error', chatId: chat.id, error: String(err.message || err) }));
  }
  state.aborts.delete(chat.id);
  if (state.steers) state.steers.delete(chat.id);

  let usageRec = null;
  if (usage && (usage.prompt || usage.completion)) {
    const cost = (usage.prompt / 1e6) * (Number(model.cost_in) || 0) + (usage.completion / 1e6) * (Number(model.cost_out) || 0);
    usageRec = { prompt: usage.prompt, completion: usage.completion, total: usage.total || (usage.prompt + usage.completion), cost };
    db.usage.insert({ id: uid(), user_id: chat.user_id, model_id: model.id, model_name: model.display_name || '', prompt: usageRec.prompt, completion: usageRec.completion, total: usageRec.total, cost, cost_in: Number(model.cost_in) || 0, cost_out: Number(model.cost_out) || 0, created_at: now() });
  }
  const hasOutput = !!(content.trim() || reasoning.trim());
  if (hasOutput || usageRec) {
    db.messages.insert({ id: assistantId, chat_id: chat.id, role: 'assistant', content, reasoning, model_id: model.id, model_name: model.display_name || '', model_icon: model.static_icon || '', parent_id: assistantParent, usage: usageRec, extended: !!extended, reasoning_effort: model.reasoning_effort_level || null, kwarg_values: model.kwarg_values || null, steers: steerNotes.length ? steerNotes.slice(0, MAX_STEERS) : null, created_at: now() });
    db.chats.update(chat.id, { updated_at: now(), active_leaf: assistantId });
  } else {
    db.chats.update(chat.id, { updated_at: now() });
  }
  const truncated = !!(Number(model.max_tokens) > 0 && usage && usage.completion >= Number(model.max_tokens) - 2 && !conversationEnded);
  safeSend(JSON.stringify({ type: 'done', chatId: chat.id, messageId: (hasOutput || usageRec) ? assistantId : null, truncated }));

  const fresh = db.chats.byId(chat.id);
  let lastUser = null;
  for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'user') { lastUser = history[i]; break; }
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
