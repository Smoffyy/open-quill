// The socket's lifecycle, with no React in it: open, reconnect with backoff, and
// a close that stays closed. It lives apart from the hook so the reconnect rules
// can be tested against a fake WebSocket instead of only being reasoned about.
// The bug that prompted this (an intentional close still scheduling a reconnect,
// leaking a live socket on every remount) was invisible from the hook's surface.

export const RETRY_BASE = 1500;
export const RETRY_MAX = 15000;

export function retryDelay(attempt) {
  return Math.min(RETRY_MAX, RETRY_BASE * Math.pow(2, attempt));
}

export function socketUrl(loc) {
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

const OPEN = 1;
const CLOSING = 2;

/**
 * @param opts.url          resolved lazily so a reconnect follows the live location
 * @param opts.onMessage    called with each parsed frame; unparseable frames are dropped
 * @param opts.shouldReconnect  consulted when a retry is due; falsy result skips it
 * @param opts.WebSocketImpl / opts.timers  injected by the tests
 */
export function createSocketClient(opts = {}) {
  const makeUrl = typeof opts.url === 'function' ? opts.url : () => opts.url;
  const WS = opts.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  // Wrapped, not referenced. `{ set: setTimeout }` detaches the browser's timer
  // from `window` and calling it throws "Illegal invocation", which would silently
  // kill every reconnect, and the failure only shows up once a socket drops.
  const timers = opts.timers || {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id)
  };

  let sock = null;
  let timer = null;
  let attempt = 0;
  // Set by close(): the socket's own onclose then knows the hangup was ours and
  // does not queue a reconnect. Cleared by the next explicit connect().
  let closed = false;

  const clearTimer = () => { if (timer !== null) { timers.clear(timer); timer = null; } };

  function connect() {
    if (sock && (sock.readyState === 0 || sock.readyState === OPEN)) return;
    if (!WS) return;
    closed = false;
    clearTimer();
    const s = new WS(makeUrl());
    sock = s;
    s.onopen = () => {
      // A close that landed while this one was still connecting: hang it up
      // rather than leaving an owner-less socket open.
      if (closed) { try { s.close(); } catch {} return; }
      attempt = 0;
    };
    s.onmessage = (ev) => {
      if (closed) return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (opts.onMessage) opts.onMessage(m);
    };
    s.onerror = () => { try { s.close(); } catch {} };
    s.onclose = () => {
      if (sock === s) sock = null;
      if (closed) return;
      const wait = retryDelay(attempt++);
      clearTimer();
      timer = timers.set(() => {
        timer = null;
        if (!opts.shouldReconnect || opts.shouldReconnect()) connect();
      }, wait);
    };
  }

  function send(obj) {
    if (!sock || sock.readyState !== OPEN) {
      // Gone or going: start a new one so the next attempt has somewhere to land.
      if (!sock || sock.readyState >= CLOSING) connect();
      return false;
    }
    try { sock.send(JSON.stringify(obj)); return true; }
    catch { return false; }
  }

  function close() {
    closed = true;
    clearTimer();
    const s = sock;
    sock = null;
    try { if (s) s.close(); } catch {}
  }

  return {
    connect,
    send,
    close,
    isOpen: () => !!sock && sock.readyState === OPEN,
    // For the tests and for anyone debugging a stuck reconnect.
    stats: () => ({ attempt, pending: timer !== null, closed })
  };
}
