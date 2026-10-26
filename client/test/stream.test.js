import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealChunk, revealPeriod, hasMarker } from '../src/lib/turnstream.js';
import { resolveReveal, revealSpeedMs, REVEAL_STYLES } from '../src/lib/reveal.js';
import { LAYOUTS } from '../src/lib/layout.js';
import { isFileWrite, fileFrom, mergeCall, supersededFile } from '../src/lib/livetools.js';
import { dispatchWs, handlers } from '../src/lib/wsmessages.js';
import { createSocketClient, retryDelay, socketUrl, RETRY_BASE, RETRY_MAX } from '../src/lib/wsclient.js';
import { newerVersion, syncDelay, draftReloads, SYNC_JITTER_MS } from '../src/lib/configsync.js';
import { createLru } from '../src/lib/lru.js';

test('revealChunk catches up fast on a big backlog, eases into a readable pace and shows everything with animation off', () => {
  assert.equal(revealChunk(3000, false), 1000, 'a third while far behind');
  assert.equal(revealChunk(600, false), 100, 'a sixth in the middle band');
  assert.equal(revealChunk(90, false), 10, 'a ninth once close');
  assert.equal(revealChunk(5000, true), 5000);
  assert.equal(revealChunk(1, true), 1);
});

test('revealChunk always advances without overshooting, so the reveal converges', () => {
  for (const remaining of [1, 2, 3, 5, 17, 240, 241, 1200, 1201]) {
    const n = revealChunk(remaining, false);
    assert.ok(n >= 1 && n <= remaining, `remaining=${remaining} advanced by ${n}`);
  }
  let shown = 0;
  let ticks = 0;
  while (shown < 5000 && ticks < 1000) { shown += revealChunk(5000 - shown, false); ticks++; }
  assert.equal(shown, 5000);
  assert.ok(ticks < 100, `converged in ${ticks} ticks`);
});

test('revealPeriod stays inside the band where it reads as typing', () => {
  assert.equal(revealPeriod(0), 8, 'never a zero-delay interval');
  assert.equal(revealPeriod(-5), 8);
  assert.equal(revealPeriod(40), 40);
  assert.equal(revealPeriod(5000), 100);
  assert.equal(revealPeriod(undefined), 8);
});

test('hasMarker spots the transcript markers that must not be drawn a character at a time', () => {
  assert.equal(hasMarker('text [[OQR:abc]] more'), true);
  assert.equal(hasMarker('\n\n[[OQT:0]]\n'), true);
  assert.equal(hasMarker('ordinary prose'), false);
  assert.equal(hasMarker(''), false);
});

test('resolveReveal prefers the named style and falls back to the legacy booleans', () => {
  assert.equal(resolveReveal({ revealStyle: 'instant' }, LAYOUTS.card), 'instant');
  assert.equal(resolveReveal({ revealStyle: 'modern' }, LAYOUTS.card), 'modern');
  assert.equal(resolveReveal({ revealStyle: 'legacy' }, LAYOUTS.card), 'legacy');
  assert.equal(resolveReveal({ revealStyle: 'typewriter' }, LAYOUTS.card), 'modern');
  assert.equal(resolveReveal({}, LAYOUTS.card), 'modern');
  assert.equal(resolveReveal(null, LAYOUTS.card), 'modern');
  assert.equal(resolveReveal({ typewriter: false }, LAYOUTS.card), 'instant');
  assert.equal(resolveReveal({ animations: false }, LAYOUTS.card), 'instant');
  assert.equal(resolveReveal({ typewriter: false, revealStyle: 'legacy' }, LAYOUTS.card), 'legacy');
});

test('a retired or unknown style resolves to the default reveal, never to nothing', () => {
  for (const v of ['fade', 'glide', 'blur', 'sparkle', '', 0, {}]) {
    assert.equal(resolveReveal({ revealStyle: v }, LAYOUTS.card), 'modern', String(v));
  }
  assert.equal(resolveReveal({ revealStyle: 'fade', typewriter: false }, LAYOUTS.card), 'instant');
});

test('the pill layout has no reveal, whatever the pref says', () => {
  for (const s of REVEAL_STYLES) assert.equal(resolveReveal({ revealStyle: s }, LAYOUTS.pill), 'instant');
});

test('revealSpeedMs clamps anything unreadable to the default interval', () => {
  assert.equal(revealSpeedMs(40), 40);
  assert.equal(revealSpeedMs('70'), 70);
  assert.equal(revealSpeedMs(0), 0);
  for (const v of [null, undefined, 'x', {}]) assert.equal(revealSpeedMs(v), 40, String(v));
  assert.equal(revealSpeedMs(-50), 0);
  assert.equal(revealSpeedMs(9999), 100);
});

test('isFileWrite only claims the tools that actually write a file', () => {
  assert.equal(isFileWrite({ tool: 'create_file', path: 'a.py' }), true);
  assert.equal(isFileWrite({ tool: 'str_replace', path: 'a.py' }), true);
  assert.equal(isFileWrite({ tool: 'artifact', path: 'plan.md' }), true, 'an artifact streams into its panel');
  assert.equal(isFileWrite({ tool: 'artifact_read', path: 'plan.md' }), false);
  assert.equal(isFileWrite({ tool: 'bash', path: 'a.py' }), false);
  assert.equal(isFileWrite({ tool: 'create_file' }), false, 'no path yet, nothing to preview');
  assert.equal(isFileWrite(null), false);
});

test('fileFrom normalises a partial live call into a preview record', () => {
  assert.deepEqual(fileFrom({ tool: 'create_file', path: 'a.py' }),
    { path: 'a.py', content: '', tool: 'create_file', oldStr: null });
  assert.deepEqual(fileFrom({ tool: 'str_replace', path: 'a.py', content: 'x', oldStr: 'y' }),
    { path: 'a.py', content: 'x', tool: 'str_replace', oldStr: 'y' });
});

test('mergeCall updates rows in place, keeps them in index order and clears on a null call', () => {
  let rows = mergeCall([], 0, { tool: 'create_file', path: 'a.py' });
  rows = mergeCall(rows, 1, { tool: 'create_file', path: 'b.py' });
  rows = mergeCall(rows, 0, { tool: 'create_file', path: 'a.py', content: 'more' });
  assert.equal(rows.length, 2, 'still two rows');
  assert.equal(rows[0].call.content, 'more');
  let mixed = mergeCall([], 2, { tool: 'bash' });
  mixed = mergeCall(mixed, 0, { tool: 'bash' });
  mixed = mergeCall(mixed, 1, { tool: 'bash' });
  assert.deepEqual(mixed.map(r => r.index), [0, 1, 2]);
  assert.deepEqual(mergeCall(mixed, 0, null), []);
  assert.deepEqual(mergeCall(mixed, undefined, { tool: 'bash' }), [], 'no index means no row');
});

test('supersededFile commits a finished create_file exactly once, and never a str_replace', () => {
  const prev = { tool: 'create_file', path: 'a.py', content: 'body' };
  assert.deepEqual(supersededFile(prev, { tool: 'create_file', path: 'b.py' }), { path: 'a.py', text: 'body' });
  assert.deepEqual(supersededFile(prev, null), { path: 'a.py', text: 'body' });
  assert.equal(supersededFile(prev, { tool: 'create_file', path: 'a.py', content: 'body+' }), null);
  assert.equal(supersededFile({ tool: 'str_replace', path: 'a.py', content: 'x' }, null), null);
  assert.deepEqual(supersededFile({ tool: 'artifact', path: 'plan.md', content: '# Plan' }, null), { path: 'plan.md', text: '# Plan' });
  assert.equal(supersededFile({ tool: 'artifact_edit', path: 'plan.md', content: 'x' }, null), null);
  assert.equal(supersededFile(null, null), null);
});

function wsCtx(activeKey = 'c1') {
  const recs = new Map();
  const calls = [];
  const log = (name) => (...a) => { calls.push([name, ...a]); };
  return {
    activeKey: () => activeKey,
    calls,
    recs,
    refs: {
      activeIdRef: { current: activeKey },
      currentIdRef: { current: 'model-1' },
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
      keys: () => [...recs.keys()],
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
      taskStarted: log('taskStarted'), setAsk: log('setAsk'), contextChanged: log('contextChanged'),
      syncConfig: log('syncConfig'), adminDraft: log('adminDraft'), presence: log('presence'),
      settleStale: log('settleStale')
    }
  };
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
  const SENT = ['session_revoked', 'config', 'resume', 'files', 'tool_live', 'tool_live_delta',
    'tool_exec', 'tool', 'compacting', 'compacted', 'ctx_rolling', 'title', 'chat_ended',
    'routed', 'queued', 'status', 'prompt_size', 'telemetry', 'steered', 'start',
    'reasoning', 'content', 'rewrite', 'error', 'done', 'task_started', 'hello', 'admin_draft', 'presence', 'folded'];
  for (const type of SENT) assert.ok(handlers[type], 'no handler for ' + type);
});

test('content for a background chat updates the mirror only, for the active chat the view too', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c2', text: 'hello' }, ctx);
  assert.equal(ctx.recs.get('c2').content, 'hello', 'the mirror accumulated it');
  assert.equal(did(ctx, 'pushContent'), false, 'but the visible stream was untouched');
  dispatchWs({ type: 'content', chatId: 'c1', text: 'hello' }, ctx);
  assert.equal(ctx.recs.get('c1').content, 'hello');
  assert.equal(did(ctx, 'pushContent'), true);
});

test('only content carrying a tool marker retires the live tool rows', () => {
  const plain = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c1', text: 'just prose' }, plain);
  assert.equal(did(plain, 'setCall'), false);
  const marked = wsCtx('c1');
  dispatchWs({ type: 'content', chatId: 'c1', text: '\n\n[[OQR:eyJ9]]\n' }, marked);
  assert.equal(did(marked, 'setCall'), true);
  assert.equal(did(marked, 'setRows'), true);
});

test('a new turn commits a previous one only if its reveal had not caught up', () => {
  const idle = wsCtx('c1');
  dispatchWs({ type: 'start', chatId: 'c1', messageId: 'a1' }, idle);
  assert.equal(did(idle, 'finalize'), false);
  assert.equal(did(idle, 'begin'), true);
  const ctx = wsCtx('c1');
  ctx.stream.donePending.current = true;
  ctx.refs.nextTurnPending.current = true;
  dispatchWs({ type: 'start', chatId: 'c1', messageId: 'a1' }, ctx);
  assert.equal(did(ctx, 'finalize'), true, 'the stranded turn was committed');
  assert.equal(ctx.refs.nextTurnPending.current, false, 'and it does not also trigger the queue');
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

test('a continued reply starts from the text already written', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'start', chatId: 'c1', messageId: 'a1', content: 'Half a sen', reasoning: 'plan', reasonSegs: ['s0'] }, ctx);
  const rec = ctx.recs.get('c1');
  assert.equal(rec.content, 'Half a sen');
  assert.equal(rec.reasoning, 'plan');
  assert.deepEqual(rec.reasonSegs, ['s0']);
  const begin = ctx.calls.find(c => c[0] === 'begin')[1];
  assert.deepEqual([begin.messageId, begin.content, begin.reasoning, begin.segs], ['a1', 'Half a sen', 'plan', ['s0']]);
  dispatchWs({ type: 'content', chatId: 'c1', text: 'tence.' }, ctx);
  assert.equal(rec.content, 'Half a sentence.');
});

test('rewrite replaces the text so far, as when a stopped file card is swapped for the finished one', () => {
  const ctx = wsCtx('c1');
  ctx.mirror.recFor('c1').content = 'Writing.[[OQR:c3RvcHBlZA==]]';
  dispatchWs({ type: 'rewrite', chatId: 'c1', content: 'Writing.[[OQR:ZG9uZQ==]]' }, ctx);
  assert.equal(ctx.recs.get('c1').content, 'Writing.[[OQR:ZG9uZQ==]]');
  assert.ok(ctx.calls.some(c => c[0] === 'pushContent' && c[1] === 'Writing.[[OQR:ZG9uZQ==]]'));
  dispatchWs({ type: 'rewrite', chatId: 'c1' }, ctx);
  assert.equal(ctx.recs.get('c1').content, 'Writing.[[OQR:ZG9uZQ==]]', 'a frame without content changes nothing');
});

test('an error keeps streamed text, clears an empty stream, and settles a background chat there', () => {
  const ctx = wsCtx('c1');
  ctx.mirror.recFor('c1').content = 'half a reply';
  dispatchWs({ type: 'error', chatId: 'c1', error: 'boom' }, ctx);
  assert.equal(did(ctx, 'finalize'), true, 'committed');
  assert.equal(did(ctx, 'clear'), false, 'not thrown away');
  assert.equal(did(ctx, 'setErrors'), true);
  const empty = wsCtx('c1');
  empty.mirror.recFor('c1');
  dispatchWs({ type: 'error', chatId: 'c1', error: 'boom' }, empty);
  assert.equal(did(empty, 'finalize'), false);
  assert.equal(did(empty, 'clear'), true);
  assert.equal(did(empty, 'dropRec'), true);
  const bg = wsCtx('c1');
  bg.mirror.recFor('c2').content = 'text';
  dispatchWs({ type: 'error', chatId: 'c2', error: 'boom' }, bg);
  assert.equal(did(bg, 'finalizeBackground'), true);
  assert.equal(did(bg, 'finalize'), false);
});

test('done on a background chat finalizes it without touching the view', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'done', chatId: 'c2', messageId: 'a1' }, ctx);
  assert.equal(did(ctx, 'finalizeBackground'), true);
  assert.equal(did(ctx, 'setCanContinue'), false);
  assert.equal(did(ctx, 'syncBusy'), true, 'the sidebar busy dot still updates');
});

test('done records the message id a pending comparison was waiting for, once', () => {
  const ctx = wsCtx('c1');
  ctx.refs.compareRef.current = { chatId: 'c1', messageId: null, remaining: ['m2'] };
  dispatchWs({ type: 'done', chatId: 'c1', messageId: 'a9' }, ctx);
  assert.equal(ctx.refs.compareRef.current.messageId, 'a9');
  assert.equal(ctx.refs.nextTurnPending.current, true);
  const set = wsCtx('c1');
  set.refs.compareRef.current = { chatId: 'c1', messageId: 'first', remaining: [] };
  dispatchWs({ type: 'done', chatId: 'c1', messageId: 'a9' }, set);
  assert.equal(set.refs.compareRef.current.messageId, 'first');
});

test('reasoning accumulates per segment, and unsegmented reasoning marks thinking until text arrives', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'reasoning', chatId: 'c1', seg: 0, text: 'aa' }, ctx);
  dispatchWs({ type: 'reasoning', chatId: 'c1', seg: 1, text: 'bb' }, ctx);
  dispatchWs({ type: 'reasoning', chatId: 'c1', seg: 0, text: 'cc' }, ctx);
  assert.deepEqual(ctx.recs.get('c1').reasonSegs, ['aacc', 'bb']);
  const flat = wsCtx('c1');
  dispatchWs({ type: 'reasoning', chatId: 'c1', text: 'hmm' }, flat);
  assert.equal(flat.recs.get('c1').phase, 'thinking');
  flat.recs.get('c1').content = 'answer';
  dispatchWs({ type: 'reasoning', chatId: 'c1', text: ' more' }, flat);
  assert.equal(flat.recs.get('c1').reasoning, 'hmm more');
});

test('status of generating clears the prefill readout rather than showing a phase', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'status', chatId: 'c1', phase: 'prefill', pct: 40 }, ctx);
  assert.equal(ctx.recs.get('c1').status.pct, 40);
  dispatchWs({ type: 'status', chatId: 'c1', phase: 'generating' }, ctx);
  assert.equal(ctx.recs.get('c1').status, null);
});

test('resume rebuilds every turn, skips malformed ones and only syncs the view when one is on screen', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'resume', turns: [{ chatId: 'c2', content: 'x' }] }, ctx);
  assert.equal(did(ctx, 'resumeRec'), true);
  assert.equal(did(ctx, 'syncView'), false, 'nothing resumed for the chat on screen');
  const on = wsCtx('c1');
  dispatchWs({ type: 'resume', turns: [null, { chatId: null }, { chatId: 'c1', content: 'x', promptTokens: 42 }] }, on);
  assert.equal(on.calls.filter(c => c[0] === 'resumeRec').length, 1);
  assert.equal(did(on, 'syncView'), true);
  assert.equal(did(on, 'setPromptTokens'), true);
});

test('resume settles a reply that ended while the socket was down, and leaves running and finished ones alone', () => {
  const ctx = wsCtx('c1');
  ctx.recs.set('c2', { content: 'partial', done: false });
  ctx.recs.set('c3', { content: 'running', done: false });
  ctx.recs.set('c4', { content: 'finished', done: true });
  ctx.recs.set('incognito', { content: 'private', done: false });
  dispatchWs({ type: 'resume', turns: [{ chatId: 'c3', content: 'running' }] }, ctx);
  const settled = ctx.calls.filter(([name]) => name === 'settleStale').map(([, id]) => id);
  assert.deepEqual(settled, ['c2']);
});

test('a files frame applies only to the open chat and retires a live preview once its file lands', () => {
  const ctx = wsCtx('c1');
  ctx.tools.fileRef.current = { path: 'b.py' };
  dispatchWs({ type: 'files', chatId: 'c2', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'setFiles'), false);
  dispatchWs({ type: 'files', chatId: 'c1', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'setFiles'), true);
  assert.equal(did(ctx, 'clearFile'), false, 'a preview of a file that has not landed keeps running');
  ctx.tools.fileRef.current = { path: 'a.py' };
  dispatchWs({ type: 'files', chatId: 'c1', files: [{ path: 'a.py' }] }, ctx);
  assert.equal(did(ctx, 'clearFile'), true);
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
  assert.deepEqual(updater(inserted), inserted);
});

test('a question the model is waiting on is tracked per chat until it is answered or the turn ends', () => {
  const ctx = wsCtx();
  const q = { question: 'Which parser?', options: ['clap', 'argh'], multiple: false };
  dispatchWs({ type: 'ask', chatId: 'c2', question: q }, ctx);
  assert.deepEqual(ctx.calls.find(c => c[0] === 'setAsk'), ['setAsk', 'c2', q], 'a background chat keeps its question too');
  ctx.calls.length = 0;
  dispatchWs({ type: 'asked', chatId: 'c2' }, ctx);
  assert.deepEqual(ctx.calls.find(c => c[0] === 'setAsk'), ['setAsk', 'c2', null]);
  ctx.calls.length = 0;
  dispatchWs({ type: 'done', chatId: 'c1' }, ctx);
  assert.deepEqual(ctx.calls.find(c => c[0] === 'setAsk'), ['setAsk', 'c1', null], 'a finished turn leaves no question behind');
  ctx.calls.length = 0;
  dispatchWs({ type: 'resume', turns: [{ chatId: 'c3', content: '', ask: q }] }, ctx);
  assert.deepEqual(ctx.calls.find(c => c[0] === 'setAsk'), ['setAsk', 'c3', q], 'a reload brings the open question back');
});

test('a stopped turn is committed at once, without waiting for the reveal to catch up', () => {
  const ctx = wsCtx('c1');
  ctx.stream.markDone = () => { ctx.calls.push(['markDone']); return false; };
  dispatchWs({ type: 'done', chatId: 'c1', messageId: 'a1', truncated: true, stopped: true }, ctx);
  assert.equal(did(ctx, 'finalize'), true);
  assert.equal(ctx.recs.get('c1').truncated, true, 'the committed message keeps its cut-off flag');
  const slow = wsCtx('c1');
  slow.stream.markDone = () => false;
  dispatchWs({ type: 'done', chatId: 'c1', messageId: 'a2' }, slow);
  assert.equal(did(slow, 'finalize'), false, 'a finished turn still waits for its reveal');
});

test('a config frame and the connect greeting both hand their version on', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'config', version: 7 }, ctx);
  dispatchWs({ type: 'hello', configVersion: 7 }, ctx);
  const calls = ctx.calls.filter(c => c[0] === 'syncConfig').map(c => c.slice(1));
  assert.deepEqual(calls, [[7, false], [7, true]]);
});

test('a background summary refreshes the context ring only for the chat on screen', () => {
  const ctx = wsCtx('c1');
  dispatchWs({ type: 'folded', chatId: 'c2' }, ctx);
  assert.equal(did(ctx, 'contextChanged'), false);
  dispatchWs({ type: 'folded', chatId: 'c1' }, ctx);
  assert.equal(did(ctx, 'contextChanged'), true);
});

function fakeSockets() {
  const made = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      made.push(this);
    }
    open() { this.readyState = 1; if (this.onopen) this.onopen(); }
    recv(data) { if (this.onmessage) this.onmessage({ data }); }
    send(s) { this.sent.push(s); }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
  }
  return { made, FakeWS };
}

function fakeTimers() {
  let seq = 0;
  const jobs = new Map();
  return {
    api: {
      set: (fn, ms) => { const id = ++seq; jobs.set(id, { fn, ms }); return id; },
      clear: (id) => { jobs.delete(id); }
    },
    pending: () => jobs.size,
    runAll: () => { const all = [...jobs.values()]; jobs.clear(); all.forEach(j => j.fn()); }
  };
}

function socketClient(opts = {}) {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const seen = [];
  const client = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api, onMessage: (m) => seen.push(m), ...opts });
  return { made, timers, seen, client };
}

test('socket client: an unexpected drop reconnects with backoff', () => {
  const { made, timers, client } = socketClient();
  client.connect();
  made[0].open();
  assert.equal(client.isOpen(), true);
  made[0].close();
  assert.equal(timers.pending(), 1, 'a retry is queued');
  timers.runAll();
  assert.equal(made.length, 2, 'it opened a fresh socket');
});

test('socket client: close() stays closed, even while still connecting', () => {
  const { made, timers, client } = socketClient();
  client.connect();
  made[0].open();
  client.close();
  assert.equal(timers.pending(), 0, 'no retry was queued');
  timers.runAll();
  assert.equal(made.length, 1, 'no second socket was ever created');
  assert.equal(client.isOpen(), false);
  const early = socketClient();
  early.client.connect();
  early.client.close();
  early.made[0].open();
  assert.equal(early.made[0].readyState, 3, 'the late open closed itself');
  assert.equal(early.timers.pending(), 0);
});

test('socket client: bad frames are dropped and nothing is delivered once closed', () => {
  const { made, seen, client } = socketClient();
  client.connect();
  made[0].open();
  made[0].recv('not json');
  made[0].recv('{"type":"a"}');
  client.close();
  made[0].recv('{"type":"b"}');
  assert.deepEqual(seen, [{ type: 'a' }]);
});

test('socket client: shouldReconnect false skips the retry but keeps the client usable', () => {
  let live = false;
  const { made, timers, client } = socketClient({ shouldReconnect: () => live });
  client.connect();
  made[0].open();
  made[0].close();
  timers.runAll();
  assert.equal(made.length, 1, 'signed out, so no reconnect');
  live = true;
  client.connect();
  assert.equal(made.length, 2);
});

test('socket client: connect() is idempotent and send reports a dead socket', () => {
  const { made, client } = socketClient({ shouldReconnect: () => true });
  client.connect();
  client.connect();
  made[0].open();
  client.connect();
  assert.equal(made.length, 1);
  assert.equal(client.send({ a: 1 }), true);
  assert.deepEqual(made[0].sent, ['{"a":1}']);
  made[0].close();
  assert.equal(client.send({ b: 2 }), false, 'nothing to send on');
});

test('retryDelay backs off to a ceiling and socketUrl upgrades to wss on a secure page', () => {
  assert.equal(retryDelay(0), RETRY_BASE);
  assert.equal(retryDelay(1), RETRY_BASE * 2);
  assert.equal(retryDelay(20), RETRY_MAX);
  assert.equal(socketUrl({ protocol: 'http:', host: 'localhost:5173' }), 'ws://localhost:5173/ws');
  assert.equal(socketUrl({ protocol: 'https:', host: 'x.dev' }), 'wss://x.dev/ws');
});

test('socket client: the default timers reconnect for real', async () => {
  const { made, FakeWS } = fakeSockets();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS });
  c.connect();
  made[0].open();
  made[0].close();
  await new Promise(r => { setTimeout(r, RETRY_BASE + 250); });
  assert.equal(made.length, 2, 'the real timer fired and reopened the socket');
  c.close();
});

test('only a newer release triggers a refetch', () => {
  assert.equal(newerVersion(4, 5), 5);
  assert.equal(newerVersion(5, 5), 0, 'the same release twice is one refetch');
  assert.equal(newerVersion(6, 5), 0, 'a late frame never rolls a client back');
  assert.equal(newerVersion(0, undefined), 0);
  assert.equal(newerVersion(undefined, '3'), 3);
});

test('members spread their refetch out, admins do not wait', () => {
  assert.equal(syncDelay(true, () => 0.99), 0);
  assert.equal(syncDelay(false, () => 0), 0);
  assert.equal(syncDelay(false, () => 1), SYNC_JITTER_MS);
  assert.ok(syncDelay(false) <= SYNC_JITTER_MS);
});

test('a draft frame reloads only what it touched, and never echoes a theme back to its own tab', () => {
  assert.deepEqual(draftReloads({ scope: 'models' }, 'me'), ['models']);
  assert.deepEqual(draftReloads({ scope: 'settings' }, 'me'), ['config']);
  assert.deepEqual(draftReloads({ scope: 'theme', tab: 'other' }, 'me'), ['theme']);
  assert.deepEqual(draftReloads({ scope: 'theme', tab: 'me' }, 'me'), []);
  assert.deepEqual(draftReloads({ scope: 'all' }, 'me'), ['models', 'config', 'theme']);
  assert.deepEqual(draftReloads({ scope: 'folders' }, 'me'), []);
  assert.deepEqual(draftReloads({ scope: '__proto__' }, 'me'), []);
});

test('lru evicts the least recently used, counting a re-set as fresh use', () => {
  const c = createLru(3);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  c.set('d', 4);
  assert.equal(c.has('a'), false, 'oldest went');
  assert.deepEqual(c.keys(), ['b', 'c', 'd']);
  assert.equal(c.size, 3);
  c.set('b', 9);
  c.set('e', 5);
  assert.equal(c.has('b'), true, 'b was touched, so c went instead');
  assert.equal(c.has('c'), false);
  assert.equal(c.get('b'), 9);
});

test('lru merge lets a chat arrive in pieces and overwrites only the keys it is given', () => {
  const c = createLru(3);
  c.merge('x', { chat: { id: 'x' } });
  c.merge('x', { messages: [1], files: ['a.py'] });
  c.merge('x', { messages: [1, 2] });
  assert.deepEqual(c.get('x'), { chat: { id: 'x' }, messages: [1, 2], files: ['a.py'] });
  c.set(null, 1); c.set('', 2); c.merge(undefined, { a: 1 });
  assert.equal(c.size, 1, 'a missing key is never cached');
});