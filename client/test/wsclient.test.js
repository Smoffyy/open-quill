import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocketClient, retryDelay, socketUrl, RETRY_BASE, RETRY_MAX } from '../src/lib/wsclient.js';

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

test('socket client: an unexpected drop reconnects with backoff', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api });
  c.connect();
  made[0].open();
  assert.equal(c.isOpen(), true);
  made[0].close();
  assert.equal(timers.pending(), 1, 'a retry is queued');
  timers.runAll();
  assert.equal(made.length, 2, 'it opened a fresh socket');
});

test('socket client: close() stays closed and never reconnects', () => {
  // The regression this guards: close() used to hang up the socket and let its
  // own onclose queue a retry, so every remount left a live socket nobody owned.
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api });
  c.connect();
  made[0].open();
  c.close();
  assert.equal(timers.pending(), 0, 'no retry was queued');
  timers.runAll();
  assert.equal(made.length, 1, 'no second socket was ever created');
  assert.equal(c.isOpen(), false);
});

test('socket client: a close while still connecting hangs up rather than leaking', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api });
  c.connect();
  c.close();
  made[0].open();
  assert.equal(made[0].readyState, 3, 'the late open closed itself');
  assert.equal(timers.pending(), 0);
});

test('socket client: frames stop being delivered once closed', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const seen = [];
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api, onMessage: (m) => seen.push(m) });
  c.connect();
  made[0].open();
  made[0].recv('{"type":"a"}');
  c.close();
  made[0].recv('{"type":"b"}');
  assert.deepEqual(seen, [{ type: 'a' }]);
});

test('socket client: an unparseable frame is dropped, not thrown', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const seen = [];
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api, onMessage: (m) => seen.push(m) });
  c.connect();
  made[0].open();
  made[0].recv('not json');
  made[0].recv('{"ok":1}');
  assert.deepEqual(seen, [{ ok: 1 }]);
});

test('socket client: shouldReconnect false skips the retry but keeps the client usable', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  let live = false;
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api, shouldReconnect: () => live });
  c.connect();
  made[0].open();
  made[0].close();
  timers.runAll();
  assert.equal(made.length, 1, 'signed out, so no reconnect');
  live = true;
  c.connect();
  assert.equal(made.length, 2);
});

test('socket client: connect() is idempotent while a socket is live', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api });
  c.connect();
  c.connect();
  made[0].open();
  c.connect();
  assert.equal(made.length, 1);
});

test('socket client: send reports failure and reopens a dead socket', () => {
  const { made, FakeWS } = fakeSockets();
  const timers = fakeTimers();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS, timers: timers.api, shouldReconnect: () => true });
  c.connect();
  made[0].open();
  assert.equal(c.send({ a: 1 }), true);
  assert.deepEqual(made[0].sent, ['{"a":1}']);
  made[0].close();
  assert.equal(c.send({ b: 2 }), false, 'nothing to send on');
});

test('retryDelay backs off geometrically and then holds at the ceiling', () => {
  assert.equal(retryDelay(0), RETRY_BASE);
  assert.equal(retryDelay(1), RETRY_BASE * 2);
  assert.ok(retryDelay(20) === RETRY_MAX);
});

test('socketUrl upgrades to wss on a secure page', () => {
  assert.equal(socketUrl({ protocol: 'http:', host: 'localhost:5173' }), 'ws://localhost:5173/ws');
  assert.equal(socketUrl({ protocol: 'https:', host: 'x.dev' }), 'wss://x.dev/ws');
});

test('socket client: the DEFAULT timers reconnect for real', async () => {
  // Guards a browser-only failure node cannot see directly: `{ set: setTimeout }`
  // detaches the timer from `window` and throws "Illegal invocation" on call, which
  // silently disables every reconnect. Exercising the default path keeps the
  // wrappers in place.
  const { made, FakeWS } = fakeSockets();
  const c = createSocketClient({ url: 'ws://x/ws', WebSocketImpl: FakeWS });
  c.connect();
  made[0].open();
  made[0].close();
  await new Promise(r => { setTimeout(r, RETRY_BASE + 250); });
  assert.equal(made.length, 2, 'the real timer fired and reopened the socket');
  c.close();
});
