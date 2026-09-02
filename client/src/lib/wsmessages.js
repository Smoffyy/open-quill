import { voiceEmit } from '../voice.js';
import { EMPTY_CALLS, mergeCall } from './livetools.js';

// The server's stream, one handler per frame type. This was a 165-line if-chain
// inside App, closing implicitly over every variable in the component; which
// frame touched which piece of state could only be worked out by reading all of
// it. Each handler now names exactly what it needs through `ctx`, and the two
// rules that govern the whole protocol are stated once, here:
//
//  1. A frame for a chat that is not on screen still updates the mirror. That is
//     what lets a reply carry on in a background chat and be picked up intact.
//  2. Only a frame for the *active* key touches the view. `activeKey()` is the
//     active chat id, or the literal 'incognito'.
//
// `ctx` groups: refs, mirror (the per-chat generation records), stream (the
// in-flight assistant message), meta (telemetry and friends), tools (live tool
// rows), set (plain setters), actions (things that go and do something) and
// text (translated strings). Translation stays in App: node --test cannot parse
// the .jsx that t() lives in, and this module has to stay testable.

const isActive = (ctx, chatId) => chatId === ctx.activeKey();

export const handlers = {
  session_revoked() {
    location.href = '/';
  },

  config(m, ctx) {
    ctx.actions.loadModels();
    ctx.actions.loadAppConfig();
    try { window.dispatchEvent(new CustomEvent('oq-config')); } catch {}
  },

  // Sent on connect: every turn this user has running, so a reload picks them up.
  resume(m, ctx) {
    const list = Array.isArray(m.turns) ? m.turns : [];
    for (const turn of list) {
      if (!turn || !turn.chatId) continue;
      ctx.mirror.resumeRec(turn.chatId, {
        content: turn.content || '',
        reasoning: turn.reasoning || '',
        phase: turn.phase === 'queued' ? 'queued' : (turn.phase === 'thinking' ? 'thinking' : 'generating'),
        assistantId: turn.messageId || null,
        model_id: turn.modelId || ctx.refs.currentIdRef.current,
        live: turn.live || null,
        steers: Array.isArray(turn.steers) ? turn.steers : [],
        status: turn.status || null,
        promptTokens: turn.promptTokens || 0
      });
      if (isActive(ctx, turn.chatId) && turn.promptTokens > 0) ctx.meta.setPromptTokens(turn.promptTokens);
    }
    ctx.mirror.syncBusy();
    if (list.some(turn => turn && isActive(ctx, turn.chatId))) ctx.actions.syncView();
  },

  // The workspace file list for this chat. Anything that has landed on disk is
  // no longer "pending", and the preview of a file that just landed retires.
  files(m, ctx) {
    if (m.chatId && m.chatId !== ctx.refs.activeIdRef.current) return;
    const files = m.files || [];
    ctx.set.files(files);
    const landed = new Set(files.map(f => f.path));
    ctx.set.pendingFiles(p => {
      const stale = Object.keys(p).filter(k => landed.has(k));
      if (!stale.length) return p;
      const next = { ...p };
      for (const k of stale) delete next[k];
      return next;
    });
    const preview = ctx.tools.fileRef.current;
    if (preview && preview.path && landed.has(preview.path)) ctx.tools.clearFile();
  },

  tool_live(m, ctx) {
    const rec = ctx.mirror.recFor(m.chatId);
    rec.live = m.live || null;
    rec.liveCalls = mergeCall(rec.liveCalls, m.index, m.live);
    if (!isActive(ctx, m.chatId)) return;
    ctx.tools.setRows(rec.liveCalls);
    const finished = ctx.tools.apply(m.live);
    // A create_file that has been superseded is complete; hold its text until the
    // server's `files` frame confirms it, so the list never blinks empty.
    if (finished) {
      ctx.set.pendingFiles(p => (p[finished.path] === finished.text ? p : { ...p, [finished.path]: finished.text }));
    }
  },

  tool_live_delta(m, ctx) {
    const rec = ctx.mirror.recFor(m.chatId);
    if (rec.live && rec.live.tool) rec.live = { ...rec.live, content: (rec.live.content || '') + m.text };
    if (!isActive(ctx, m.chatId)) return;
    ctx.tools.appendToFile(m.text);
  },

  // Execution is sequential and the finished calls are already committed to the
  // transcript, so exactly one row is in flight here.
  tool_exec(m, ctx) {
    const rec = ctx.mirror.recFor(m.chatId);
    rec.live = m.call || null;
    rec.liveCalls = m.call && m.call.tool ? [{ index: 0, call: m.call }] : [];
    if (!isActive(ctx, m.chatId)) return;
    ctx.tools.setRows(rec.liveCalls);
    if (m.call && m.call.tool) ctx.tools.setCall(m.call);
  },

  // The result is already in the content stream as a marker; nothing to do.
  tool() {},

  compacting(m, ctx) {
    if (isActive(ctx, m.chatId)) ctx.set.compacting(true);
  },

  compacted(m, ctx) {
    if (!isActive(ctx, m.chatId)) return;
    ctx.set.compacting(false);
    ctx.set.hasSummary(true);
  },

  ctx_rolling(m, ctx) {
    if (!isActive(ctx, m.chatId)) return;
    ctx.actions.notifyContextTrimmed(m.limit || 0);
  },

  title(m, ctx) {
    ctx.set.chats(cs => cs.map(c => c.id === m.chatId ? { ...c, title: m.title } : c));
  },

  chat_ended(m, ctx) {
    ctx.set.chats(cs => cs.map(c => c.id === m.chatId ? { ...c, ended: true } : c));
    if (!isActive(ctx, m.chatId)) return;
    ctx.set.ended(true);
    ctx.set.endedReason(m.reason || '');
  },

  routed(m, ctx) {
    if (isActive(ctx, m.chatId)) ctx.meta.setRoute({ hubName: m.hubName, modelName: m.modelName, via: m.via });
  },

  queued(m, ctx) {
    ctx.mirror.recFor(m.chatId).phase = 'queued';
    if (isActive(ctx, m.chatId)) ctx.stream.setQueued(true);
  },

  status(m, ctx) {
    const rec = ctx.mirror.recFor(m.chatId);
    rec.status = m.phase === 'generating'
      ? null
      : { phase: m.phase, processed: m.processed, total: m.total, cache: m.cache, pct: m.pct, ms: m.ms };
    if (isActive(ctx, m.chatId)) ctx.meta.setStatus(rec.status);
  },

  prompt_size(m, ctx) {
    if (isActive(ctx, m.chatId)) ctx.meta.setPromptTokens(m.tokens || 0);
  },

  telemetry(m, ctx) {
    if (!isActive(ctx, m.chatId)) return;
    ctx.meta.setTelemetry({
      tps: m.tps, promptTps: m.promptTps, promptTokens: m.promptTokens,
      genTokens: m.genTokens, ctx: m.ctx, exact: !!m.exact
    });
  },

  steered(m, ctx) {
    const rec = ctx.mirror.recFor(m.chatId);
    rec.steers = [...(rec.steers || []), ...(m.notes || [])];
    if (isActive(ctx, m.chatId)) ctx.meta.setSteers(rec.steers);
  },

  start(m, ctx) {
    voiceEmit({ type: 'start', chatId: m.chatId });
    // A previous turn whose `done` arrived but whose text had not finished
    // revealing must be committed before this one takes the stage, or it is lost.
    if (isActive(ctx, m.chatId) && ctx.stream.donePending.current) {
      ctx.refs.nextTurnPending.current = false;
      ctx.actions.finalize();
    }
    const rec = ctx.mirror.recFor(m.chatId);
    rec.content = ''; rec.reasoning = ''; rec.phase = 'generating';
    rec.done = false; rec.error = false;
    rec.assistantId = m.messageId; rec.live = null; rec.steers = []; rec.status = null;
    if (!isActive(ctx, m.chatId)) return;
    ctx.meta.reset();
    ctx.refs.refreshSeq.current++;
    ctx.set.compacting(false);
    ctx.tools.clear();
    ctx.stream.begin({ messageId: m.messageId, modelId: rec.model_id || ctx.refs.currentIdRef.current });
  },

  reasoning(m, ctx) {
    const rec = ctx.mirror.recFor(m.chatId);
    // A model that interleaves thinking with output sends numbered segments, so
    // each block can be shown against the part of the reply it produced.
    if (m.seg != null) {
      if (!rec.reasonSegs) rec.reasonSegs = [];
      rec.reasonSegs[m.seg] = (rec.reasonSegs[m.seg] || '') + m.text;
      if (isActive(ctx, m.chatId)) ctx.stream.setSegments(rec.reasonSegs.slice());
      return;
    }
    rec.reasoning += m.text;
    if (!rec.content) rec.phase = 'thinking';
    if (isActive(ctx, m.chatId)) ctx.stream.pushReasoning(rec.reasoning);
  },

  content(m, ctx) {
    voiceEmit({ type: 'content', chatId: m.chatId, text: m.text });
    const rec = ctx.mirror.recFor(m.chatId);
    rec.content += m.text;
    rec.phase = 'generating';
    if (!isActive(ctx, m.chatId)) return;
    // pushContent reports back when the text carried a tool-result marker, which
    // means the live rows that were drawing that call are finished with.
    if (ctx.stream.pushContent(rec.content, m.text)) {
      ctx.tools.setCall(null);
      ctx.tools.setRows(EMPTY_CALLS);
    }
  },

  error(m, ctx) {
    voiceEmit({ type: 'error', chatId: m.chatId });
    const rec = ctx.mirror.peek(m.chatId);
    const hadContent = !!(rec && rec.content);
    if (isActive(ctx, m.chatId)) {
      // Text already streamed is the user's to keep, so it is committed rather
      // than thrown away with the error.
      if (hadContent) { ctx.stream.markDone(); ctx.actions.finalize(); }
      else {
        ctx.mirror.dropRec(m.chatId);
        ctx.stream.clear();
        ctx.tools.clear();
      }
    } else if (hadContent) {
      ctx.actions.finalizeBackground(m.chatId);
    } else {
      ctx.mirror.dropRec(m.chatId);
    }
    ctx.set.errors(prev => ({ ...prev, [m.chatId]: String(m.error || ctx.text.modelError) }));
  },

  done(m, ctx) {
    voiceEmit({ type: 'done', chatId: m.chatId });
    ctx.mirror.recFor(m.chatId).done = true;
    ctx.mirror.syncBusy();
    ctx.actions.loadBudget();
    if (!isActive(ctx, m.chatId)) { ctx.actions.finalizeBackground(m.chatId); return; }
    ctx.set.pendingFiles(p => (Object.keys(p).length ? {} : p));
    if (ctx.refs.ledgerOpenRef.current) ctx.actions.loadLedger();
    ctx.set.canContinue(!!m.truncated);
    // A model comparison fires several regenerations off one message; the first
    // `done` is where its id becomes known.
    const cmp = ctx.refs.compareRef.current;
    if (cmp && cmp.chatId === m.chatId && !cmp.messageId && m.messageId) cmp.messageId = m.messageId;
    ctx.refs.nextTurnPending.current = true;
    if (ctx.stream.markDone()) ctx.actions.finalize();
  }
};

// Space frames are broadcast to a panel that may not be mounted, so they go out
// as a DOM event rather than through App's state.
export function isSpaceFrame(type) {
  return typeof type === 'string' && type.startsWith('space_');
}

const SPACE_REFRESH = new Set(['space_invite', 'space_updated', 'space_removed', 'space_deleted']);

export function handleSpaceFrame(m, ctx) {
  try { window.dispatchEvent(new CustomEvent('oq-space', { detail: m })); } catch {}
  if (SPACE_REFRESH.has(m.type)) ctx.actions.refreshSpacesPending();
}

// Returns whether the frame was recognised, which the tests assert on so an
// unhandled type cannot be added without noticing.
export function dispatchWs(m, ctx) {
  if (!m || typeof m.type !== 'string') return false;
  if (isSpaceFrame(m.type)) { handleSpaceFrame(m, ctx); return true; }
  const fn = handlers[m.type];
  if (!fn) return false;
  fn(m, ctx);
  return true;
}
