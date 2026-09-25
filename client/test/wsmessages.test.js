import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchWs, handlers } from '../src/lib/wsmessages.js';

function wsCtx(activeKey = 'c1') {
  const recs = new Map();
  const calls = [];
  const log = (name) => (...a) => { calls.push([name, ...a]); };
  const ctx = {
    activeKey: () => activeKey,
    calls,
    recs,
    refs: {
      activeIdRef: { current: activeKey },
      currentIdRef: { current: 'model-1' },
      ledgerOpenRef: { current: false },
      compareRef: { current: null },
      nextTurnPending: { current: false },
      refreshSeq: { current: 0 }
    },
    mirror: {
      recFor: (id) => {
        if (!recs.has(id)) recs.set(id, { content: '', reasoning: '', liveCalls: [] });
        return recs.get(id);
      },
      peek: (id) => recs.get(id),
      dropRec: (id) => { recs.delete(id); calls.push(['dropRec', id]); },
      syncBusy: log('syncBusy'),
      resumeRec: (id, patch) => { recs.set(id, patch); calls.push(['resumeRec', id]); }
    },
    stream: {
      donePending: { current: false },
      setQueued: log('setQueued'),
      begin: log('begin'),
      clear: log('clear'),
      markDone: () => { calls.push(['markDone']); return true; },
      pushContent: (full, delta) => { calls.push(['pushContent', full]); return /\[\[OQ[RT]:/.test(delta); },
      pushReasoning: log('pushReasoning'),
      setSegments: log('setSegments')
    },
    meta: {
      setPromptTokens: log('setPromptTokens'), setRoute: log('setRoute'), setStatus: log('setStatus'),
      setTelemetry: log('setTelemetry'), setSteers: log('setSteers'), reset: log('metaReset')
    },
    tools: {
      fileRef: { current: null }, clearFile: log('clearFile'), clear: log('toolsClear'),
      setRows: log('setRows'), setCall: log('setCall'), apply: () => null, appendToFile: log('appendToFile')
    },
    set: {
      files: log('setFiles'), pendingFiles: log('setPendingFiles'), chats: log('setChats'),
      errors: log('setErrors'), compacting: log('setCompacting'), hasSummary: log('setHasSummary'),
      ended: log('setEnded'), endedReason: log('setEndedReason'), canContinue: log('setCanContinue')
    },
    actions: {
      finalize: log('finalize'), finalizeBackground: log('finalizeBackground'), syncView: log('syncView'),
      loadModels: log('loadModels'), loadAppConfig: log('loadAppConfig'), loadBudget: log('loadBudget'),
      loadLedger: log('loadLedger'), taskStarted: log('taskStarted')
    }
  };
  return ctx;
}

const did = (ctx, name) => ctx.calls.some(c => c[0] === name);

test('dispatchWs reports an unknown frame rather than silently dropping it', () => {
  const ctx = wsCtx();
  assert.equal(dispatchWs({ type: 'content', chatId: 'c1', text: 'hi' }, ctx), true);
  assert.equal(dispatchWs({ type: 'not_a_real_frame' }, ctx), false);
  assert.equal(dispatchWs(null, ctx), false);
  assert.equal(dispatchWs({}, ctx), false);
  for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(dispatchWs({ type }, ctx), false, 'inherited key ' + type + ' is not a frame');
  }
});

test('every frame the server can send has a handler', () => {
  // Kept in step with server/lib/ws: adding a frame type there without one here
  // is exactly the bug this catches.
  const SENT = ['session_revoked', 'config', 'resume', 'files', 'tool_live', 'tool_live_delta',
    'tool_exec', 'tool', 'compacting', 'compacted', 'ctx_rolling', 'title', 'chat_ended',
    'routed', 'queued', 'status', 'prompt_size', 'telemetry', 'steered', 'start',
    'reasoning', 'content', 'error', 'done', 'task_started'];
  for (const type of SENT) assert.ok(handlers[type], 'no handler for ' + type);
});

test('a frame for a background chat updates the mirror but never the view', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c2', text: 'hello' }, ctx);
  assert.equal(ctx.recs.get('c2').content, 'hello', 'the mirror accumulated it');
  assert.equal(did(ctx, 'pushContent'), false, 'but the visible stream was untouched');
});

test('the same frame for the active chat does reach the view', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c1', text: 'hello' }, ctx);
  assert.equal(ctx.recs.get('c1').content, 'hello');
  assert.equal(did(ctx, 'pushContent'), true);
});

test('content carrying a tool marker retires the live tool rows', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c1', text: '\n\n[[OQR:eyJ9]]\n' }, ctx);
  assert.equal(did(ctx, 'setCall'), true);
  assert.equal(did(ctx, 'setRows'), true);
});

test('ordinary content leaves the live tool rows alone', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c1', text: 'just prose' }, ctx);
  assert.equal(did(ctx, 'setCall'), false);
});

test('a new turn commits a previous one whose reveal had not caught up', () => {
  const ctx = wsCtx('c1');
  ctx.stream.donePending.current = true;
  ctx.refs.nextTurnPending.current = true;
  dispatchWs({ type: 'start', chatId: 'c1', messageId: 'a1' }, ctx);
  assert.equal(did(ctx, 'finalize'), true, 'the stranded turn was committed');
  assert.equal(ctx.refs.nextTurnPending.current, false, 'and it does not also trigger the queue');
  assert.equal(did(ctx, 'begin'), true);
});

test('a new turn with nothing pending does not commit anything', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'start', chatId: 'c1', messageId: 'a1' }, ctx);
  assert.equal(did(ctx, 'finalize'), false);
  assert.equal(did(ctx, 'begin'), true);
});

test('start resets the record so a retry does not inherit the last attempt', () => {
  const ctx = wsCtx('c1');
  const rec = ctx.mirror.recFor('c1');
  rec.content = 'old'; rec.reasoning = 'old'; rec.done = true; rec.steers = ['x'];
  dispatchWs({ type: 'start', chatId: 'c1', messageId: 'a2' }, ctx);
  assert.equal(rec.content, '');
  assert.equal(rec.reasoning, '');
  assert.equal(rec.done, false);
  assert.deepEqual(rec.steers, []);
  assert.equal(rec.assistantId, 'a2');
});

test('an error after text has streamed keeps the text instead of discarding it', () => {
  const ctx = wsCtx('c1');
  ctx.mirror.recFor('c1').content = 'half a reply';
  dispatchWs({ type: 'error', chatId: 'c1', error: 'boom' }, ctx);
  assert.equal(did(ctx, 'finalize'), true, 'committed');
  assert.equal(did(ctx, 'clear'), false, 'not thrown away');
  assert.equal(did(ctx, 'setErrors'), true);
});

test('an error before any text clears the stream instead of committing nothing', () => {
  const ctx = wsCtx('c1');
  ctx.mirror.recFor('c1');
  dispatchWs({ type: 'error', chatId: 'c1', error: 'boom' }, ctx);
  assert.equal(did(ctx, 'finalize'), false);
  assert.equal(did(ctx, 'clear'), true);
  assert.equal(did(ctx, 'dropRec'), true);
});

test('an error in a background chat is finalized there, not on screen', () => {
  const ctx = wsCtx('c1');
  ctx.mirror.recFor('c2').content = 'text';
  dispatchWs({ type: 'error', chatId: 'c2', error: 'boom' }, ctx);
  assert.equal(did(ctx, 'finalizeBackground'), true);
  assert.equal(did(ctx, 'finalize'), false);
});

test('done on a background chat finalizes it without touching the view', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'done', chatId: 'c2', messageId: 'a1' }, ctx);
  assert.equal(did(ctx, 'finalizeBackground'), true);
  assert.equal(did(ctx, 'setCanContinue'), false);
  assert.equal(did(ctx, 'syncBusy'), true, 'the sidebar busy dot still updates');
});

test('done records the message id a pending model comparison was waiting for', () => {
  const ctx = wsCtx('c1');
  ctx.refs.compareRef.current = { chatId: 'c1', messageId: null, remaining: ['m2'] };
  dispatchWs({ type: 'done', chatId: 'c1', messageId: 'a9' }, ctx);
  assert.equal(ctx.refs.compareRef.current.messageId, 'a9');
  assert.equal(ctx.refs.nextTurnPending.current, true);
});

test('done does not overwrite a comparison id that is already set', () => {
  const ctx = wsCtx('c1');
  ctx.refs.compareRef.current = { chatId: 'c1', messageId: 'first', remaining: [] };
  dispatchWs({ type: 'done', chatId: 'c1', messageId: 'a9' }, ctx);
  assert.equal(ctx.refs.compareRef.current.messageId, 'first');
});

test('reasoning segments accumulate per index, not into one blob', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'reasoning', chatId: 'c1', seg: 0, text: 'aa' }, ctx);
  dispatchWs({ type: 'reasoning', chatId: 'c1', seg: 1, text: 'bb' }, ctx);
  dispatchWs({ type: 'reasoning', chatId: 'c1', seg: 0, text: 'cc' }, ctx);
  assert.deepEqual(ctx.recs.get('c1').reasonSegs, ['aacc', 'bb']);
});

test('unsegmented reasoning marks the turn as thinking only while no text has arrived', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'reasoning', chatId: 'c1', text: 'hmm' }, ctx);
  assert.equal(ctx.recs.get('c1').phase, 'thinking');
  ctx.recs.get('c1').content = 'answer';
  dispatchWs({ type: 'reasoning', chatId: 'c1', text: ' more' }, ctx);
  assert.equal(ctx.recs.get('c1').reasoning, 'hmm more');
});

test('status of generating clears the prefill readout rather than showing a phase', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'status', chatId: 'c1', phase: 'prefill', pct: 40 }, ctx);
  assert.equal(ctx.recs.get('c1').status.pct, 40);
  dispatchWs({ type: 'status', chatId: 'c1', phase: 'generating' }, ctx);
  assert.equal(ctx.recs.get('c1').status, null);
});

test('resume rebuilds every turn and only syncs the view when one is on screen', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'resume', turns: [{ chatId: 'c2', content: 'x' }] }, ctx);
  assert.equal(did(ctx, 'resumeRec'), true);
  assert.equal(did(ctx, 'syncView'), false, 'nothing resumed for the chat on screen');
  const ctx2 = wsCtx('c1');
  dispatchWs({ type: 'resume', turns: [{ chatId: 'c1', content: 'x', promptTokens: 42 }] }, ctx2);
  assert.equal(did(ctx2, 'syncView'), true);
  assert.equal(did(ctx2, 'setPromptTokens'), true);
});

test('resume ignores a malformed turn instead of throwing away the batch', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'resume', turns: [null, { chatId: null }, { chatId: 'c1', content: 'ok' }] }, ctx);
  assert.equal(ctx.calls.filter(c => c[0] === 'resumeRec').length, 1);
});

test('a files frame for another chat is ignored', () => {
  const ctx = wsCtx('c1');
  ctx.refs.activeIdRef.current = 'c1';
  dispatchWs({ type: 'files', chatId: 'c2', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'setFiles'), false);
  dispatchWs({ type: 'files', chatId: 'c1', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'setFiles'), true);
});

test('a file that has landed on disk retires its live preview', () => {
  const ctx = wsCtx('c1');
  ctx.tools.fileRef.current = { path: 'a.py' };
  dispatchWs({ type: 'files', chatId: 'c1', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'clearFile'), true);
});

test('a preview of a file that has not landed yet is left running', () => {
  const ctx = wsCtx('c1');
  ctx.tools.fileRef.current = { path: 'b.py' };
  dispatchWs({ type: 'files', chatId: 'c1', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'clearFile'), false);
});

test('chat_ended marks the sidebar row even when the chat is not on screen', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'chat_ended', chatId: 'c2', reason: 'done here' }, ctx);
  assert.equal(did(ctx, 'setChats'), true);
  assert.equal(did(ctx, 'setEnded'), false, 'but the banner is only for the open chat');
});

test('task_started inserts a chat the sidebar has never seen, once', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'task_started', chatId: 'c9', title: 'Daily briefing' }, ctx);
  assert.equal(did(ctx, 'taskStarted'), true);
  const updater = ctx.calls.find(c => c[0] === 'setChats')[1];
  const inserted = updater([{ id: 'c1', title: 'Other chat' }]);
  assert.equal(inserted.length, 2);
  assert.equal(inserted[0].id, 'c9');
  assert.equal(inserted[0].title, 'Daily briefing');
  // A duplicate frame for a chat already in the list must not add a second row.
  assert.deepEqual(updater(inserted), inserted);
});
