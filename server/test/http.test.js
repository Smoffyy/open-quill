// Integration tests: the real server, started the way it starts in production.
//
// These exist because of a regression that 128 unit tests could not see. The CSRF guard
// compared the Origin header against the Host header, which is correct until something
// proxies — and Vite's dev proxy rewrites Host while forwarding Origin untouched. Every
// state-changing request from the real UI was refused, so under `npm run dev` nothing
// could be sent, nothing could be logged out, and the websocket never opened. The app
// rendered perfectly and every button did nothing.
//
// Nothing in a unit test starts a server, so nothing caught it. These do: the assertions
// below use the exact header shapes a browser produces, direct and behind a dev proxy.
//
// The server runs as a child process against a throwaway database, so this exercises the
// real entry point — middleware order, static mounting, websocket attach and all.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { presetById } from '../lib/presets.js';

const SERVER_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB_NAME = 'oqhttptest';
const DB_DIR = path.join(SERVER_ROOT, 'data', 'databases', DB_NAME);
const EMAIL = 'integration@test.local';
const PASSWORD = 'integration-password';
const START_TIMEOUT_MS = 30000;
const SETUP_TOKEN = 'integration-setup-token';

let child = null;
let readyMs = 0;
let PORT = 0;
let ORIGIN = '';
let cookie = '';

// The shape Vite's dev proxy produces: it rewrites Host to the backend and forwards the
// browser's Origin unchanged, so the two disagree. This is the regression.
const DEV_PROXY_ORIGIN = 'http://localhost:5173';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function request(method, pathname, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  let payload;
  if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  } else if (opts.raw !== undefined) {
    payload = opts.raw;
    headers['Content-Length'] = payload.length;
  }
  // Origin and Sec-Fetch-Site are forbidden header names in a browser, which is the point:
  // only the browser may set them. node:http lets us reproduce exactly what it would send.
  if (opts.origin !== undefined) headers.Origin = opts.origin;
  if (opts.secFetchSite !== undefined) headers['Sec-Fetch-Site'] = opts.secFetchSite;
  if (opts.cookie) headers.Cookie = opts.cookie;

  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(opts.timeoutMs || 15000, () => req.destroy(new Error(`timed out: ${method} ${pathname}`)));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

// A request shaped the way a browser on this origin would send it.
const browser = (method, pathname, opts = {}) =>
  request(method, pathname, { origin: ORIGIN, secFetchSite: 'same-origin', cookie, ...opts });

function handshake(headers, pathname = '/ws') {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${pathname}`, { headers });
    const done = (result) => { clearTimeout(timer); try { ws.terminate(); } catch {} resolve(result); };
    const timer = setTimeout(() => done({ open: false, status: 0, error: 'timeout' }), 8000);
    ws.on('open', () => done({ open: true, status: 101 }));
    ws.on('unexpected-response', (_req, res) => done({ open: false, status: res.statusCode }));
    ws.on('error', (e) => done({ open: false, status: 0, error: e.message }));
  });
}

// Opens a socket and resolves with the frames it receives after `send`.
const SESSION_FRAMES = new Set(['hello', 'presence']);

function exchange(headers, send, { frames = 1, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers });
    const got = [];
    const finish = (fn, arg) => { clearTimeout(timer); try { ws.terminate(); } catch {} fn(arg); };
    const timer = setTimeout(() => finish(resolve, got), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify(send)));
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (SESSION_FRAMES.has(m?.type)) return;
      got.push(m);
      if (got.length >= frames) finish(resolve, got);
    });
    ws.on('error', (e) => finish(reject, e));
    ws.on('unexpected-response', (_q, res) => finish(reject, new Error('handshake ' + res.statusCode)));
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['index.js'], {
      cwd: SERVER_ROOT,
      env: { ...process.env, OPEN_QUILL_DB: DB_NAME, PORT: String(PORT), HOST: '127.0.0.1', OPEN_QUILL_SETUP_TOKEN: SETUP_TOKEN },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error(`server did not start within ${START_TIMEOUT_MS}ms:\n${log}`));
    }, START_TIMEOUT_MS);
    const watch = (buf) => {
      log += buf.toString();
      if (log.includes('running on')) { clearTimeout(timer); resolve(proc); }
    };
    proc.stdout.on('data', watch);
    proc.stderr.on('data', watch);
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${log}`)); });
  });
}

// Windows keeps the database file locked until the child has actually gone, and kill() only
// asks. Wait for the exit, then retry the removal rather than racing it.
function removeDb() {
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

// Listening is not the same as answering: anything that blocks the event loop during
// startup leaves the port open and every request queued behind it. Wait for a real
// response, and remember how long it took so the test below can hold that line.
async function waitForReady() {
  const started = Date.now();
  const deadline = started + START_TIMEOUT_MS;
  for (;;) {
    try {
      const res = await request('GET', '/api/auth/context', { timeoutMs: 2000 });
      if (res.status === 200) return Date.now() - started;
    } catch {}
    if (Date.now() >= deadline) throw new Error(`server listened but never answered within ${START_TIMEOUT_MS}ms`);
    await new Promise(r => { setTimeout(r, 50); });
  }
}

before(async () => {
  removeDb();
  PORT = await freePort();
  ORIGIN = `http://127.0.0.1:${PORT}`;
  child = await startServer();
  readyMs = await waitForReady();

  // The first account created on a fresh database becomes the owner, and only with the
  // setup token the server prints while no owner exists.
  const blind = await request('POST', '/api/auth/register', {
    origin: ORIGIN, secFetchSite: 'same-origin', body: { email: EMAIL, password: PASSWORD }
  });
  assert.equal(blind.status, 403, 'the first account needs the setup token');
  assert.equal(blind.json.setup, true);
  const res = await request('POST', '/api/auth/register', {
    origin: ORIGIN, secFetchSite: 'same-origin', body: { email: EMAIL, password: PASSWORD, setupToken: SETUP_TOKEN }
  });
  assert.equal(res.status, 200, `registration failed: ${res.text}`);
  cookie = String(res.headers['set-cookie']?.[0] || '').split(';')[0];
  assert.match(cookie, /^token=\S+/, 'registration must return a session cookie');
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise(r => { child.once('exit', r); });
    try { child.kill(); } catch {}
    await Promise.race([gone, new Promise(r => { setTimeout(r, 5000); })]);
  }
  removeDb();
});

// The regression this guards: host detection ran synchronously on the main thread right
// after listen, so a machine with a full toolchain installed could not answer anything for
// as long as it took to spawn every probe. CI has more runtimes than a laptop and blew past
// the 15s request timeout. Detection now runs in a worker, so this should be immediate.
test('the server answers as soon as it is listening', () => {
  assert.ok(readyMs < 10000, `server took ${readyMs}ms to answer its first request; startup must not block the event loop`);
});

test('the app answers and serves its policy header', async () => {
  const root = await request('GET', '/');
  assert.equal(root.status, 200);
  const csp = root.headers['content-security-policy'];
  assert.ok(csp, 'app HTML carries the local-only policy');
  assert.match(csp, /(^|; )default-src 'self'(;|$)/);
  assert.match(csp, /(^|; )connect-src [^;]*'self'/);
  assert.equal(root.headers['x-content-type-options'], 'nosniff');
  assert.equal(root.headers['referrer-policy'], 'same-origin');

  const ctx = await request('GET', '/api/auth/context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.headers['content-security-policy'], undefined, 'the policy is for documents, not the JSON API');
  assert.equal(ctx.headers['cache-control'], 'no-store', 'authenticated JSON must not be cached');
  assert.equal(ctx.json.firstRun, false);
  // deliberately limited to branding plus what the sign-in screen needs
  assert.deepEqual(Object.keys(ctx.json).sort(), ['appFont', 'appIcon', 'appName', 'firstRun', 'signup', 'uiPreset']);
});

test('a browser on this origin can complete the whole sign-in loop', async () => {
  // This is the loop that silently broke: every step here is a state-changing request.
  assert.equal((await request('GET', '/api/me')).status, 401, 'no cookie, no session');
  assert.equal((await browser('GET', '/api/me')).status, 200);

  const wrong = await browser('POST', '/api/auth/login', { body: { email: EMAIL, password: 'not-it' } });
  assert.equal(wrong.status, 401);
  assert.match(wrong.json.error, /Incorrect email or password/, 'must not say which half was wrong');

  const login = await browser('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  assert.equal(login.status, 200);
  const fresh = String(login.headers['set-cookie']?.[0] || '').split(';')[0];

  // logout is the request the user reported as dead, and it must actually revoke
  assert.equal((await browser('POST', '/api/auth/logout', { cookie: fresh })).status, 200);
  assert.equal((await browser('GET', '/api/me', { cookie: fresh })).status, 401, 'the revoked session is gone');
  assert.equal((await browser('GET', '/api/me')).status, 200, 'other sessions survive');
});

test('signing in never creates an account', async () => {
  const res = await browser('POST', '/api/auth/login', { body: { email: 'ghost@test.local', password: PASSWORD } });
  assert.equal(res.status, 401);
  const dup = await browser('POST', '/api/auth/register', { body: { email: EMAIL, password: PASSWORD } });
  assert.equal(dup.status, 409, 'registering an existing email is a conflict, not a second account');
});

test('writes behind a dev proxy are allowed', async () => {
  // THE regression. The proxy rewrites Host to this server while forwarding the browser's
  // Origin, so Origin and Host disagree and comparing them refuses the request.
  const viaProxy = await request('POST', '/api/chats', {
    origin: DEV_PROXY_ORIGIN, secFetchSite: 'same-origin', cookie, body: {}
  });
  assert.equal(viaProxy.status, 200, 'Sec-Fetch-Site is what makes this work');

  // and the same shape from a browser too old to send that header, over loopback
  const oldBrowser = await request('POST', '/api/chats', { origin: DEV_PROXY_ORIGIN, cookie, body: {} });
  assert.equal(oldBrowser.status, 200, 'loopback-to-loopback fallback');
});

test('writes from another site are refused', async () => {
  const shapes = [
    { label: 'declared cross-site', origin: 'https://evil.example', secFetchSite: 'cross-site' },
    { label: 'origin only', origin: 'https://evil.example' },
    { label: 'sandboxed iframe', origin: 'null' },
    { label: 'lookalike host', origin: `http://127.0.0.1.evil.example` }
  ];
  for (const { label, ...headers } of shapes) {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const res = await request(method, '/api/me', { ...headers, cookie, body: { displayName: 'pwned' } });
      assert.equal(res.status, 403, `${method} ${label} must be refused`);
    }
  }
  // the forged writes changed nothing
  assert.notEqual((await browser('GET', '/api/me')).json.user.displayName, 'pwned');

  // reads are not state-changing and must keep working
  assert.equal((await request('GET', '/api/me', { origin: 'https://evil.example', cookie })).status, 200);
  // and a non-browser caller, which cannot be driven by a hostile page, is unaffected
  assert.equal((await request('GET', '/api/auth/context')).status, 200);
});

test('the websocket refuses connections it should', async () => {
  assert.equal((await handshake({ Cookie: cookie, Origin: ORIGIN })).open, true, 'the real UI connects');
  assert.equal((await handshake({ Cookie: cookie, Origin: DEV_PROXY_ORIGIN, 'Sec-Fetch-Site': 'same-origin' })).open, true, 'behind a dev proxy');
  assert.equal((await handshake({ Cookie: cookie, Origin: DEV_PROXY_ORIGIN })).open, true, 'dev proxy, no Sec-Fetch-Site');

  // Cross-site websocket hijacking: SameSite does not reliably cover the handshake, so
  // without the origin check a hostile page could open this and read the whole stream.
  assert.equal((await handshake({ Cookie: cookie, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await handshake({ Cookie: cookie, Origin: 'null' })).status, 403);
  assert.equal((await handshake({ Origin: ORIGIN })).status, 401, 'no session');
  assert.equal((await handshake({ Cookie: cookie, Origin: ORIGIN }, '/notws')).status, 400, 'only /ws is a socket');
});

test('a message sent on the socket is answered', async () => {
  // The user-visible symptom of the regression was a send button that did nothing, so
  // assert the pipeline replies rather than just that the socket opened.
  const frames = await exchange({ Cookie: cookie, Origin: ORIGIN }, { type: 'chat', chatId: 'no-such-chat', modelId: 'no-such-model', content: 'hello' });
  assert.ok(frames.length, 'the server answered');
  assert.equal(frames[0].type, 'error');
  assert.match(frames[0].error, /Invalid chat or model/);
});

test('malformed frames do not take the socket down', async () => {
  const junk = ['not json', '123', 'null', '[]', JSON.stringify({ type: 'stop', chatId: { evil: true } }), JSON.stringify({ noType: 1 })];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: cookie, Origin: ORIGIN } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  for (const j of junk) ws.send(j);
  // a well-formed frame still gets a reply afterwards
  const reply = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 6000);
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { m = null; }
      if (SESSION_FRAMES.has(m?.type)) return;
      clearTimeout(timer);
      resolve(m);
    });
    ws.send(JSON.stringify({ type: 'chat', chatId: 'no-such-chat', modelId: 'x' }));
  });
  try { ws.terminate(); } catch {}
  assert.equal(reply?.type, 'error', 'the handler survived the junk');
  assert.equal((await request('GET', '/api/auth/context')).status, 200, 'and so did the server');
});

test('profile input is validated rather than stored as sent', async () => {
  const tooBig = await browser('PATCH', '/api/me', { body: { prefs: { blob: 'x'.repeat(300000) } } });
  assert.equal(tooBig.status, 413);

  const wrongShape = await browser('PATCH', '/api/me', { body: { prefs: [1, 2] } });
  assert.equal(wrongShape.status, 400);

  const coerced = await browser('PATCH', '/api/me', { body: { displayName: { nested: 'object' } } });
  assert.equal(coerced.status, 200);
  assert.equal(typeof coerced.json.user.displayName, 'string', 'never stored as the object it arrived as');

  const ok = await browser('PATCH', '/api/me', { body: { displayName: 'Integration', prefs: { theme: 'dark' } } });
  assert.equal(ok.json.user.displayName, 'Integration');
  assert.deepEqual(ok.json.user.prefs, { theme: 'dark' });
});

// Express 5 leaves req.body undefined when nothing parsed one, and handlers read it directly.
test('an assistant message is edited in place; a user message is refused', async () => {
  const imported = await browser('POST', '/api/chats/import', {
    body: { title: 'edit target', messages: [{ role: 'user', content: 'the question' }, { role: 'assistant', content: 'the first answer' }] }
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.json.imported, 1);

  const list = await browser('GET', '/api/chats');
  const chats = Array.isArray(list.json) ? list.json : list.json.chats;
  const target = chats.find(c => c.title === 'edit target');
  assert.ok(target, 'imported chat should be listed');

  const before = await browser('GET', `/api/chats/${target.id}`);
  const user = before.json.messages.find(m => m.role === 'user');
  const assistant = before.json.messages.find(m => m.role === 'assistant');
  assert.ok(user && assistant);

  const ok = await browser('PATCH', `/api/chats/${target.id}/messages/${assistant.id}`, { body: { content: 'a corrected answer' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.content, 'a corrected answer');

  const after = await browser('GET', `/api/chats/${target.id}`);
  assert.equal(after.json.messages.find(m => m.id === assistant.id).content, 'a corrected answer');
  assert.equal(after.json.messages.length, before.json.messages.length, 'editing must not branch');

  const refused = await browser('PATCH', `/api/chats/${target.id}/messages/${user.id}`, { body: { content: 'rewritten' } });
  assert.equal(refused.status, 400, 'a user edit has to go through the ws edit frame so the turn reruns');
  const stillThere = await browser('GET', `/api/chats/${target.id}`);
  assert.equal(stillThere.json.messages.find(m => m.id === user.id).content, 'the question');

  for (const bad of [{ content: '' }, { content: '   ' }, { content: 42 }, { content: null }]) {
    const r = await browser('PATCH', `/api/chats/${target.id}/messages/${assistant.id}`, { body: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const unchanged = await browser('GET', `/api/chats/${target.id}`);
  assert.equal(unchanged.json.messages.find(m => m.id === assistant.id).content, 'a corrected answer');

  const missing = await browser('PATCH', `/api/chats/${target.id}/messages/nope`, { body: { content: 'x' } });
  assert.equal(missing.status, 404);
});

test('a write with no body is a clean no-op, not a 500', async () => {
  const chat = await browser('POST', '/api/chats', { body: {} });
  assert.equal(chat.status, 200);

  const bodyless = [
    ['PATCH', '/api/me'],
    ['PUT', '/api/me/styles'],
    ['PATCH', `/api/chats/${chat.json.id}`],
    ['POST', `/api/chats/${chat.json.id}/branch`],
    ['DELETE', `/api/chats/${chat.json.id}/pins`],
    ['PATCH', '/api/admin/settings'],
    ['PATCH', '/api/admin/app-config']
  ];
  for (const [method, url] of bodyless) {
    const res = await request(method, url, { origin: ORIGIN, secFetchSite: 'same-origin', cookie });
    assert.ok(res.status < 500, `${method} ${url} answered ${res.status}: ${res.text.slice(0, 200)}`);
  }

  assert.ok((await browser('PATCH', '/api/me', { body: {} })).status < 500);
  assert.equal((await browser('GET', '/api/me')).json.user.displayName, 'Integration');
});

test('admin settings and branding survive hostile input rather than 500', async () => {
  const hostile = await browser('PATCH', '/api/admin/settings', {
    body: {
      apiBaseUrl: { nested: 'object' },
      apiKey: 'k'.repeat(5000),
      webSearchCount: 9999,
      sessionTtlDays: 'not a number',
      voiceSttEngine: 'nonsense',
      modelQueue: 'truthy',
      notARealSetting: 'ignored'
    }
  });
  assert.equal(hostile.status, 200);

  const back = await browser('GET', '/api/admin/settings');
  assert.equal(back.status, 200);
  assert.equal(typeof back.json.apiBaseUrl, 'string', 'never stored as the object it arrived as');
  assert.equal(back.json.apiKey, '', 'a secret never leaves the server');
  assert.equal(back.json.apiKeySaved, true);
  assert.equal(back.json.apiKeyHint, '…kkkk');
  assert.equal(back.json.webSearchCount, 20, 'clamped, not stored raw');
  assert.equal(back.json.sessionTtlDays, 30, 'unparseable falls back to the default');
  assert.equal(back.json.voiceSttEngine, 'browser', 'an unknown enum value is refused');
  assert.equal(back.json.modelQueue, true);

  const branding = await browser('PATCH', '/api/admin/app-config', { body: { appName: 12345, disclaimer: { x: 1 } } });
  assert.equal(branding.status, 200, 'a non-string name must not throw on .trim()');
  const cfg = await browser('GET', '/api/app-config');
  assert.equal(typeof cfg.json.appName, 'string');

  await browser('PATCH', '/api/admin/settings', { body: { apiKey: '', apiBaseUrl: 'http://localhost:8080' } });
  await browser('PATCH', '/api/admin/app-config', { body: { appName: 'open-quill' } });
});

const uploadFile = async (call, name, type, body, route = '/api/upload') => {
  const boundary = 'oqfile' + Date.now() + Math.random().toString(36).slice(2);
  const field = route === '/api/upload' ? 'files' : 'file';
  const raw = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`, 'utf8'),
    Buffer.from(body), Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const res = await call('POST', route, { raw, headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } });
  assert.equal(res.status, 200, res.text);
  return route === '/api/upload' ? res.json.files[0].url : res.json.url;
};

test('uploads are served defensively and misses are honest', async () => {
  const missing = await request('GET', '/uploads/does-not-exist.html', { cookie });
  assert.equal(missing.status, 404, 'a missing upload is not the app HTML with a 200');
  assert.match(missing.headers['content-type'] || '', /json/);

  const page = await request('GET', await uploadFile(browser, 'probe.html', 'text/html', '<script>alert(1)</script>'), { cookie });
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-disposition'], 'attachment', 'html downloads, it does not become a live document');
  assert.match(page.headers['content-security-policy'] || '', /default-src 'none'/);
  assert.match(page.headers['content-security-policy'] || '', /sandbox/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');

  const img = await request('GET', await uploadFile(browser, 'probe.png', 'image/png', 'not really a png'), { cookie });
  assert.equal(img.status, 200);
  assert.equal(img.headers['content-disposition'], undefined, 'images still render in place');

  fs.writeFileSync(path.join(SERVER_ROOT, 'data', 'databases', DB_NAME, 'uploads', 'dropped.png'), 'put there by hand');
  assert.equal((await request('GET', '/uploads/dropped.png', { cookie })).status, 404, 'a file the app never took in is not served');
});

test('uploads need a session, except the icon the sign-in screen shows', async () => {
  const attachment = await uploadFile(browser, 'attachment.png', 'image/png', 'someone else’s file');
  const brand = await uploadFile(browser, 'brand.png', 'image/png', 'the app icon', '/api/admin/upload');

  // Attachments are other people's conversations. Knowing the URL is not authorisation,
  // and 404 rather than 401 so a signed-out caller cannot even confirm the file exists.
  const anon = await request('GET', attachment);
  assert.equal(anon.status, 404);
  assert.equal((await request('GET', attachment, { cookie })).status, 200, 'its owner still sees it');

  // The sign-in screen shows the app icon to someone who by definition has no session.
  assert.equal((await request('GET', brand)).status, 404, 'not public until it is the icon');
  const set = await browser('PATCH', '/api/admin/app-config', { body: { appIcon: brand } });
  assert.equal(set.status, 200);
  // An admin edit only stages the value, so the icon is not public on the strength
  // of a draft: it has to be published first.
  assert.equal((await request('GET', brand)).status, 404, 'a staged icon is still private');
  assert.equal((await browser('POST', '/api/admin/changes/publish', { body: {} })).status, 200);
  assert.equal((await request('GET', brand)).status, 200, 'now the login screen can load it');
  assert.equal((await request('GET', attachment)).status, 404, 'and only that one file');

  // the exemption follows the setting rather than being latched on first use
  await browser('PATCH', '/api/admin/app-config', { body: { appIcon: '' } });
  await browser('POST', '/api/admin/changes/publish', { body: {} });
  assert.equal((await request('GET', brand)).status, 404, 'unset the icon and it is private again');
});

test('a chat upload keeps its UTF-8 name and any format previews as the text the model reads', async () => {
  const boundary = 'oqattach' + Date.now();
  const part = (name, type, body) => Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`, 'utf8'),
    body, Buffer.from('\r\n')
  ]);
  const raw = Buffer.concat([
    part('résumé 履歴.rtf', 'application/rtf', Buffer.from('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}Hello\\par World}')),
    part('Main.hx', 'application/octet-stream', Buffer.from('class Main { static function main() {} }\n')),
    part('notes.txt', 'text/plain', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('wide text', 'utf16le')])),
    Buffer.from(`--${boundary}--\r\n`)
  ]);
  const up = await browser('POST', '/api/upload', { raw, headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } });
  assert.equal(up.status, 200);
  const [rtf, hx, wide] = up.json.files;
  assert.equal(rtf.name, 'résumé 履歴.rtf', 'a non-ASCII file name is not mangled into latin1');
  const text = async (f) => (await browser('GET', '/api/uploads/' + f.url.split('/').pop() + '/text')).json.text;
  assert.equal(await text(rtf), 'Hello\nWorld');
  assert.equal(await text(hx), 'class Main { static function main() {} }\n');
  assert.equal(await text(wide), 'wide text');
  assert.equal((await browser('GET', '/api/uploads/missing.pdf/text')).status, 404);
});

test('reference files read any text extension, convert documents and accept dotfile names', async () => {
  const boundary = 'oqref' + Date.now();
  const part = (name, body) => Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(body), Buffer.from('\r\n')]);
  const raw = Buffer.concat([
    part('Main.hx', 'class Main {}\nfunction a() {}\n'),
    part('brief.rtf', '{\\rtf1\\ansi First\\par Second}'),
    part('.editorconfig', 'root = true\n'),
    Buffer.from(`--${boundary}--\r\n`)
  ]);
  const up = await browser('POST', '/api/admin/membank', { raw, headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } });
  assert.equal(up.status, 200);
  assert.equal(up.json.saved, 3);
  const byName = Object.fromEntries(up.json.files.map(f => [f.name, f]));
  assert.equal(byName['Main.hx'].readable, true, 'an extension no list knows is still text');
  assert.equal(byName['Main.hx'].lines, 3);
  assert.equal(byName['brief.rtf'].readable, true);
  assert.equal(byName['brief.rtf'].lines, 2, 'RTF is counted as its converted text, not its markup');
  assert.equal(byName['.editorconfig'].readable, true);
  for (const name of Object.keys(byName)) await browser('DELETE', '/api/admin/membank/' + encodeURIComponent(name));
});

test('admin edits stage until they are published', async () => {
  // Staged: the panel reads its own draft back, but nothing live has moved yet.
  await browser('PATCH', '/api/admin/settings', { body: { voiceMicEnabled: true } });
  const staged = await browser('GET', '/api/admin/settings');
  assert.equal(staged.json.voiceMicEnabled, true, 'the panel sees its own draft');

  const state = await browser('GET', '/api/admin/changes');
  const mic = state.json.changes.find(c => c.key === 'setting:voice_mic_enabled');
  assert.ok(mic, 'the staged setting is listed as a pending change');
  assert.equal(mic.after, '1');
  assert.deepEqual(mic.authors.map(a => a.id), [(await browser('GET', '/api/me')).json.user.id], 'and attributed to the admin who made it');

  // The admin previews their own draft; the published value is what everyone else
  // reads, which the public app-icon test above exercises from a signed-out caller.
  await browser('PATCH', '/api/admin/app-config', { body: { appName: 'Staged Name' } });
  assert.equal((await browser('GET', '/api/app-config')).json.appName, 'Staged Name', 'an admin previews the draft');

  assert.equal((await browser('POST', '/api/admin/changes/publish', { body: {} })).status, 200);
  assert.equal((await browser('GET', '/api/admin/changes')).json.changes.length, 0, 'publishing clears the staging area');
  assert.equal((await browser('GET', '/api/app-config')).json.appName, 'Staged Name', 'and the value survives as the live one');
});

test('discarding drops every staged edit back to the published state', async () => {
  const kept = (await browser('POST', '/api/admin/models', { body: { display_name: 'Kept', internal_name: 'kept' } })).json.id;
  await browser('POST', '/api/admin/changes/publish', { body: {} });
  const before = (await browser('GET', '/api/admin/models')).json.find(m => m.id === kept);

  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: kept, description: 'edited' }] } });
  const added = (await browser('POST', '/api/admin/models', { body: { display_name: 'Added', internal_name: 'added' } })).json.id;
  await browser('PATCH', '/api/admin/app-config', { body: { appName: 'Reverted Name' } });
  assert.ok((await browser('GET', '/api/admin/changes')).json.changes.length > 0);

  assert.equal((await browser('POST', '/api/admin/changes/discard', { body: {} })).status, 200);
  const rows = (await browser('GET', '/api/admin/models')).json;
  assert.deepEqual(rows.find(m => m.id === kept), before, 'an edited row is restored exactly');
  assert.ok(!rows.some(m => m.id === added), 'a model created since publishing is gone');
  assert.notEqual((await browser('GET', '/api/app-config')).json.appName, 'Reverted Name', 'staged config is dropped');
  assert.equal((await browser('GET', '/api/admin/changes')).json.changes.length, 0, 'and nothing is left to publish');
});

test('the catalog edits, copies and removes models in batches', async () => {
  const a = (await browser('POST', '/api/admin/models', { body: { display_name: 'Batch A', internal_name: 'batch-a' } })).json.id;
  const b = (await browser('POST', '/api/admin/models', { body: { display_name: 'Batch B', internal_name: 'batch-b' } })).json.id;
  await browser('POST', '/api/admin/changes/publish', { body: {} });

  const edit = await browser('PATCH', '/api/admin/models', { body: { rows: [
    { id: a, system_prompt: 'Shared prompt', temperature: '0.4' },
    { id: b, system_prompt: 'Shared prompt', temperature: '' }
  ] } });
  assert.equal(edit.status, 200);
  const rows = (await browser('GET', '/api/admin/models')).json;
  const ra = rows.find(m => m.id === a), rb = rows.find(m => m.id === b);
  assert.equal(ra.system_prompt, 'Shared prompt');
  assert.equal(rb.system_prompt, 'Shared prompt');
  assert.equal(ra.temperature, 0.4, 'values are sanitized exactly as a single edit is');
  assert.equal(rb.temperature, null);

  const state = (await browser('GET', '/api/admin/changes')).json.models;
  assert.deepEqual([...state.changed].sort(), [a, b].sort(), 'only the edited rows are reported as unpublished');
  assert.match(state.live[a].system_prompt, /^<context>\n[\s\S]*<tools>\n<tool name="project">/, 'the published copy of each changed row comes along for diffing, with the blocks a new model starts with');
  assert.doesNotMatch(state.live[a].system_prompt, /<tool name="artifacts">/, 'artifacts start switched off');
  assert.ok(state.order.indexOf(a) < state.order.indexOf(b), 'and so does the published order');

  const missing = await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: a, description: 'x' }, { id: 'nope' }] } });
  assert.equal(missing.status, 404, 'an unknown id rejects the whole batch');
  assert.notEqual((await browser('GET', '/api/admin/models')).json.find(m => m.id === a).description, 'x', 'and nothing in it was applied');
  assert.equal((await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: a, is_default: true }, { id: b, is_default: true }] } })).status, 400);

  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: a, badges_off: ['text', 'nope'] }] } });
  let row = (await browser('GET', '/api/admin/models')).json.find(m => m.id === a);
  assert.deepEqual(row.badges_off, ['text'], 'unknown badge ids are dropped');
  assert.deepEqual((await browser('GET', '/api/models')).json.find(m => m.id === a).badges, ['code'], 'a switched-off badge leaves the picker');
  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: a, badges_off: null }] } });
  row = (await browser('GET', '/api/admin/models')).json.find(m => m.id === a);
  assert.equal('badges_off' in row, false, 'switching every badge back on leaves no field behind, so a revert matches the published row');
  assert.deepEqual((await browser('GET', '/api/models')).json.find(m => m.id === a).badges, ['text', 'code']);

  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: a, docs_notice: 'Heads up', docs_notice_url: 'javascript:alert(1)' }] } });
  assert.equal((await browser('GET', '/api/admin/models')).json.find(m => m.id === a).docs_notice_url, '', 'a script address never reaches the docs page');
  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: a, docs_notice_url: 'https://example.com/x' }] } });
  assert.equal((await browser('GET', '/api/admin/models')).json.find(m => m.id === a).docs_notice_url, 'https://example.com/x');

  await browser('PATCH', '/api/admin/settings', { body: { webSearchEnabled: true } });
  await browser('POST', '/api/admin/changes/publish', { body: {} });
  assert.deepEqual((await browser('GET', '/api/models')).json.find(m => m.id === a).badges, ['text', 'web', 'code'], 'switching web search on for the workspace refreshes the cached badges');
  await browser('PATCH', '/api/admin/settings', { body: { webSearchEnabled: false } });
  await browser('POST', '/api/admin/changes/publish', { body: {} });
  assert.deepEqual((await browser('GET', '/api/models')).json.find(m => m.id === a).badges, ['text', 'code']);

  const promptOf = async (id) => (await browser('GET', '/api/admin/models')).json.find(m => m.id === id).system_prompt;
  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: b, calculator_allowed: true }] } });
  assert.match(await promptOf(b), /^Shared prompt\n\n<tools>\n<tool name="calculator">\n/, 'turning a tool on writes its block into the system prompt');
  await browser('PATCH', '/api/admin/settings', { body: { chatSearchEnabled: true } });
  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: b, chat_search_allowed: true }] } });
  assert.match(await promptOf(b), /<tool name="chat_search">[\s\S]*<tool name="calculator">/, 'blocks keep a stable order');
  await browser('PATCH', '/api/admin/settings', { body: { chatSearchEnabled: false } });
  assert.doesNotMatch(await promptOf(b), /chat_search/, 'turning a workspace feature off removes its block from every model');
  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: b, calculator_allowed: false }] } });
  assert.equal(await promptOf(b), 'Shared prompt', 'and turning the last tool off leaves the prompt as it was');

  const copies = (await browser('POST', '/api/admin/models/duplicate', { body: { ids: [a] } })).json.ids;
  assert.equal(copies.length, 1);
  const order = (await browser('GET', '/api/admin/models')).json.map(m => m.id);
  assert.equal(order.indexOf(copies[0]), order.indexOf(a) + 1, 'a copy lands right after its source');
  const copy = (await browser('GET', '/api/admin/models')).json.find(m => m.id === copies[0]);
  assert.equal(copy.system_prompt, 'Shared prompt', 'and carries every field');
  assert.equal(copy.temperature, 0.4);

  assert.equal((await browser('POST', '/api/admin/models/remove', { body: { ids: [a, b, copies[0]] } })).json.count, 3);
  const left = (await browser('GET', '/api/admin/models')).json.map(m => m.id);
  assert.ok(![a, b, copies[0]].some(id => left.includes(id)));
  await browser('POST', '/api/admin/changes/publish', { body: {} });
});

test('parameter counts are stored in billions and the prompt preview reads the unsaved draft', async () => {
  const id = (await browser('POST', '/api/admin/models', { body: { display_name: 'Sized', internal_name: 'sized' } })).json.id;
  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id, docs_total_params: '2.4T', docs_moe: true, docs_active_params: 'A35B' }] } });
  const row = (await browser('GET', '/api/admin/models')).json.find(m => m.id === id);
  assert.equal(row.docs_total_params, 2400);
  assert.equal(row.docs_active_params, 35);
  assert.equal(row.docs_moe, 1);
  const saved = (await browser('POST', '/api/admin/models/prompt-values', { body: { id } })).json.values;
  assert.equal(saved.modelParameters, '2.4T parameters (mixture-of-experts, 35B active per token)');
  const draft = (await browser('POST', '/api/admin/models/prompt-values', { body: { id, model: { ...row, docs_moe: 0, docs_total_params: 'nope' } } })).json.values;
  assert.equal(draft.modelTotalParameters, '');
  assert.equal(draft.modelActiveParameters, '');
  assert.equal((await browser('GET', '/api/admin/models')).json.find(m => m.id === id).docs_total_params, 2400);
  assert.equal((await browser('POST', '/api/admin/models/prompt-values', { body: { id: 'nope' } })).status, 404);
  await browser('POST', '/api/admin/models/remove', { body: { ids: [id] } });
  await browser('POST', '/api/admin/changes/publish', { body: {} });
});

test('model folders persist on their own, empty or not', async () => {
  await browser('POST', '/api/admin/changes/publish', { body: {} });
  assert.deepEqual((await browser('GET', '/api/admin/models/folders')).json.folders, []);
  const put = await browser('PUT', '/api/admin/models/folders', { body: { folders: ['  Fast ', 'Archive', 'Fast', '', 7, 'x'.repeat(90)] } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json.folders, ['Archive', 'Fast', 'x'.repeat(60)], 'names are trimmed, capped, deduplicated and sorted');
  assert.deepEqual((await browser('GET', '/api/admin/models/folders')).json.folders, put.json.folders, 'and read back unchanged');
  assert.equal((await browser('GET', '/api/admin/changes')).json.changes.length, 0, 'an empty folder is not a catalog change');
  const added = await browser('POST', '/api/admin/models/folders/add', { body: { folders: ['Fast', 'Zeta'] } });
  assert.deepEqual(added.json.folders, ['Archive', 'Fast', 'x'.repeat(60), 'Zeta'], 'adding only ever unions, so it cannot bring back a folder another admin removed');
  await browser('PUT', '/api/admin/models/folders', { body: { folders: [] } });
});

test('a staged app-config edit can be taken back before it is published', async () => {
  const cfg = (await browser('GET', '/api/app-config')).json;
  const live = { appFont: cfg.appFont, appName: cfg.appName };

  await browser('PATCH', '/api/admin/app-config', { body: { appName: 'Typo Name', appFont: 'newsreader' } });
  const staged = (await browser('GET', '/api/app-config')).json;
  assert.equal(staged.appName, 'Typo Name', 'the admin previews the staged name');
  assert.equal(staged.appFont, 'newsreader', 'and the staged font');
  assert.ok((await browser('GET', '/api/admin/changes')).json.changes.some(c => c.key === 'setting:app_name'));

  await browser('PATCH', '/api/admin/app-config', { body: live });
  const back = (await browser('GET', '/api/app-config')).json;
  assert.equal(back.appName, live.appName, 'the name draft is gone, not still holding the edit');
  assert.equal(back.appFont, live.appFont, 'and so is the font draft');
});

test('the base layout follows the active theme and cannot be set on its own', async () => {
  const cfg = (await browser('GET', '/api/app-config')).json;
  const store = (await browser('GET', '/api/admin/themes')).json;
  const start = store.themes.find(t => t.id === store.activeId);
  const other = store.themes.find(t => t.basePreset !== start.basePreset);
  const layout = async () => (await browser('GET', '/api/app-config')).json;

  assert.equal(cfg.uiPreset, start.basePreset, 'the layout starts out as the active theme base');
  await browser('PATCH', '/api/admin/app-config', { body: { uiPreset: other.basePreset } });
  assert.equal((await layout()).uiPreset, start.basePreset, 'app-config no longer moves the layout');

  await browser('PATCH', '/api/admin/app-config', { body: { appFont: presetById(start.basePreset).font } });
  await browser('POST', `/api/admin/themes/${other.id}/activate`, { body: {} });
  let now = await layout();
  assert.equal(now.uiPreset, other.basePreset, 'activating a theme moves the layout to its base');
  assert.equal(now.appFont, presetById(other.basePreset).font, 'and an untouched font follows the layout');

  await browser('POST', `/api/admin/themes/${start.id}/activate`, { body: {} });
  await browser('PATCH', '/api/admin/app-config', { body: { appFont: 'newsreader' } });
  await browser('POST', `/api/admin/themes/${other.id}/activate`, { body: {} });
  now = await layout();
  assert.equal(now.uiPreset, other.basePreset);
  assert.equal(now.appFont, 'newsreader', 'a font the admin picked is kept');

  const copy = (await browser('POST', '/api/admin/themes', { body: { from: other.id } })).json.id;
  await browser('POST', `/api/admin/themes/${copy}/activate`, { body: {} });
  await browser('DELETE', `/api/admin/themes/${copy}`);
  const left = (await browser('GET', '/api/admin/themes')).json;
  const fallback = left.themes.find(t => t.id === left.activeId);
  assert.equal((await layout()).uiPreset, fallback.basePreset, 'deleting the active theme moves the layout to the theme that takes over');

  await browser('POST', `/api/admin/themes/${start.id}/activate`, { body: {} });
  await browser('PATCH', '/api/admin/app-config', { body: { appFont: cfg.appFont } });
  now = await layout();
  assert.equal(now.uiPreset, cfg.uiPreset);
  assert.equal(now.appFont, cfg.appFont);
});

test('a release can ship part of the draft, refuses a stale review and rolls back', async () => {
  await browser('POST', '/api/admin/changes/publish', { body: {} });
  const base = (await browser('GET', '/api/admin/changes')).json.version;

  await browser('PATCH', '/api/admin/app-config', { body: { appName: 'Ship Me', disclaimer: 'Hold me back' } });
  const listed = (await browser('GET', '/api/admin/changes')).json.changes.map(c => c.key).sort();
  assert.deepEqual(listed, ['setting:app_name', 'setting:disclaimer']);

  const stale = await browser('POST', '/api/admin/changes/publish', { body: { keys: ['setting:app_name'], base: base - 1 } });
  assert.equal(stale.status, 409, 'a publish reviewed against an older release is refused');

  const shipped = await browser('POST', '/api/admin/changes/publish', { body: { keys: ['setting:app_name'], note: 'Rename', base } });
  assert.equal(shipped.status, 200);
  assert.equal(shipped.json.version, base + 1);
  assert.deepEqual((await browser('GET', '/api/admin/changes')).json.changes.map(c => c.key), ['setting:disclaimer'], 'the unpicked change stays staged');

  const list = (await browser('GET', '/api/admin/releases')).json;
  assert.equal(list.version, base + 1);
  assert.equal(list.releases[0].note, 'Rename');
  assert.deepEqual(list.releases[0].changes.map(c => c.key), ['setting:app_name']);
  assert.equal('snapshot' in list.releases[0], false, 'the list never carries a snapshot');
  const detail = (await browser('GET', `/api/admin/releases/${base + 1}`)).json;
  assert.equal(detail.changes[0].after, 'Ship Me');

  const back = await browser('POST', `/api/admin/releases/${base}/restore`, { body: {} });
  assert.equal(back.status, 200);
  assert.equal(back.json.version, base + 2, 'a rollback is itself a new release');
  assert.equal((await browser('GET', '/api/admin/releases')).json.releases[0].kind, 'restore');
  const after = (await browser('GET', '/api/admin/changes')).json.changes.map(c => c.key);
  assert.deepEqual(after, ['setting:disclaimer'], 'work still in the draft survives a rollback, the rolled-back value does not reappear');

  assert.equal((await browser('POST', '/api/admin/changes/discard', { body: { keys: ['setting:disclaimer'] } })).status, 200);
  assert.equal((await browser('POST', '/api/admin/changes/publish', { body: {} })).status, 400, 'nothing left to publish');
  assert.equal((await browser('POST', '/api/admin/releases/999999/restore', { body: {} })).status, 404);
});

const joinAs = async (email) => {
  const res = await request('POST', '/api/auth/register', { origin: ORIGIN, secFetchSite: 'same-origin', body: { email, password: PASSWORD } });
  assert.equal(res.status, 200, res.text);
  const c = String(res.headers['set-cookie']?.[0] || '').split(';')[0];
  return { cookie: c, id: res.json.user.id, user: res.json.user };
};
const as = (who) => (method, url, opts = {}) => browser(method, url, { ...opts, cookie: who.cookie });

test('admins publish and manage the accounts below them, and only owners make admins', async () => {
  const adm = await joinAs('admin-role@example.com');
  const peer = await joinAs('admin-peer@example.com');
  const other = await joinAs('user-role@example.com');
  const owner = (await browser('GET', '/api/me')).json.user;

  assert.equal(other.user.role, 'user', 'an open sign-up starts as a user');
  assert.equal((await as(other)('GET', '/api/admin/users')).status, 403, 'a user cannot list accounts');
  assert.equal((await as(other)('PATCH', '/api/admin/app-config', { body: { disclaimer: 'x' } })).status, 403, 'nor stage admin edits');

  assert.equal((await browser('PATCH', `/api/admin/users/${adm.id}`, { body: { role: 'admin' } })).status, 200);
  assert.equal((await browser('PATCH', `/api/admin/users/${peer.id}`, { body: { role: 'admin' } })).status, 200);
  const me = (await as(adm)('GET', '/api/me')).json.user;
  assert.equal(me.role, 'admin');
  assert.ok(me.permissions.includes('admin.publish') && me.permissions.includes('admin.users'));
  assert.ok(!('isAdmin' in me) && !('canPublish' in me), 'the old flags are gone');

  assert.equal((await as(adm)('PATCH', `/api/admin/users/${other.id}`, { body: { role: 'admin' } })).status, 403, 'an admin cannot make admins');
  assert.equal((await as(adm)('PATCH', `/api/admin/users/${peer.id}`, { body: { role: 'user' } })).status, 403, 'nor demote another admin');
  assert.equal((await as(adm)('PATCH', `/api/admin/users/${adm.id}`, { body: { role: 'user' } })).status, 403, 'nor change their own role');
  assert.equal((await as(adm)('PATCH', `/api/admin/users/${owner.id}`, { body: { status: 'disabled' } })).status, 403, 'nor touch an owner');
  assert.equal((await as(adm)('DELETE', `/api/admin/users/${peer.id}`)).status, 403, 'nor remove a peer');
  assert.equal((await as(adm)('PATCH', `/api/admin/users/${other.id}`, { body: { role: 'nonsense' } })).status, 403, 'an unknown role is refused');

  const listed = (await as(adm)('GET', '/api/admin/users')).json.users;
  assert.equal(listed.find(u => u.id === other.id).manage, true);
  assert.deepEqual(listed.find(u => u.id === peer.id).assignable, [], 'a peer offers nothing to assign');

  await browser('POST', '/api/admin/changes/publish', { body: {} });
  await as(adm)('PATCH', '/api/admin/app-config', { body: { supportContact: 'help@example.com' } });
  assert.equal((await as(adm)('POST', '/api/admin/changes/publish', { body: {} })).status, 200, 'an admin publishes');

  assert.equal((await browser('PATCH', `/api/admin/users/${owner.id}`, { body: { role: 'admin' } })).status, 403, 'nobody changes their own role');
  assert.equal((await browser('PATCH', `/api/admin/users/${adm.id}`, { body: { role: 'owner' } })).status, 200, 'an owner can make another owner');
  assert.equal((await as(adm)('GET', '/api/me')).json.user.owner, true);
  assert.equal((await browser('PATCH', `/api/admin/users/${adm.id}`, { body: { role: 'admin' } })).status, 200, 'and owners can demote each other');
  const lastOwner = await browser('DELETE', '/api/me', { body: { password: PASSWORD } });
  assert.equal(lastOwner.status, 403, 'the last owner cannot delete their own account');

  assert.equal((await as(adm)('PATCH', `/api/admin/users/${other.id}/budget`, { body: { budget: 5 } })).status, 200);
  assert.equal((await as(adm)('PATCH', `/api/admin/users/${adm.id}/budget`, { body: { budget: 5 } })).status, 200, 'everyone with user management can set their own cap');

  for (const u of [adm, peer, other]) assert.equal((await browser('DELETE', `/api/admin/users/${u.id}`)).status, 200, 'the owner can remove anyone');
});

test('a pending account waits behind the gate, and a disabled one is signed out at once', async () => {
  assert.equal((await browser('PUT', '/api/admin/auth/signup', { body: { policy: 'approval' } })).status, 200);
  const pend = await joinAs('pending-gate@example.com');
  assert.equal(pend.user.role, 'pending');
  assert.equal(pend.user.gate, 'pending');
  assert.deepEqual(pend.user.permissions, []);

  const me = await as(pend)('GET', '/api/me');
  assert.equal(me.status, 200, 'a pending account can see itself');
  assert.equal((await as(pend)('GET', '/api/me/sessions')).status, 200, 'and its sessions');
  for (const [method, url] of [['GET', '/api/chats'], ['POST', '/api/chats'], ['GET', '/api/models'], ['GET', '/api/app-config'], ['GET', '/api/projects'], ['POST', '/api/upload']]) {
    const r = await as(pend)(method, url, { body: {} });
    assert.equal(r.status, 403, `${method} ${url} is gated`);
    assert.equal(r.json.gate, 'pending');
  }
  const ws = await handshake({ Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', Cookie: pend.cookie });
  assert.equal(ws.open, false, 'no socket while pending');

  assert.equal((await browser('PATCH', `/api/admin/users/${pend.id}`, { body: { role: 'user' } })).status, 200, 'approval');
  assert.equal((await as(pend)('GET', '/api/chats')).status, 200, 'approval takes effect on the next request');
  assert.equal((await handshake({ Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', Cookie: pend.cookie })).open, true);

  assert.equal((await browser('PATCH', `/api/admin/users/${pend.id}`, { body: { status: 'disabled' } })).status, 200);
  assert.equal((await as(pend)('GET', '/api/me')).status, 401, 'disabling ends every session at once');
  const login = await request('POST', '/api/auth/login', { origin: ORIGIN, secFetchSite: 'same-origin', body: { email: 'pending-gate@example.com', password: PASSWORD } });
  assert.equal(login.status, 403);
  assert.match(login.json.error, /disabled/);
  assert.equal((await browser('PATCH', `/api/admin/users/${pend.id}`, { body: { status: 'active' } })).status, 200);
  const back = await request('POST', '/api/auth/login', { origin: ORIGIN, secFetchSite: 'same-origin', body: { email: 'pending-gate@example.com', password: PASSWORD } });
  assert.equal(back.status, 200, 'enabling restores sign-in');

  assert.equal((await browser('PUT', '/api/admin/auth/signup', { body: { policy: 'closed' } })).status, 200);
  const closed = await request('POST', '/api/auth/register', { origin: ORIGIN, secFetchSite: 'same-origin', body: { email: 'closed@example.com', password: PASSWORD } });
  assert.equal(closed.status, 403);
  assert.equal((await browser('PUT', '/api/admin/auth/signup', { body: { policy: 'open', domains: ['allowed.test', 'not a domain'] } })).json.domains.length, 1);
  const outside = await request('POST', '/api/auth/register', { origin: ORIGIN, secFetchSite: 'same-origin', body: { email: 'x@elsewhere.test', password: PASSWORD } });
  assert.equal(outside.status, 403, 'a domain outside the list is refused');
  const inside = await joinAs('y@allowed.test');
  assert.equal((await as(inside)('PUT', '/api/admin/auth/signup', { body: { policy: 'open' } })).status, 403, 'only an owner sets the policy');
  assert.equal((await browser('PUT', '/api/admin/auth/signup', { body: { policy: 'nope' } })).status, 400);
  assert.equal((await browser('PUT', '/api/admin/auth/signup', { body: { policy: 'open', domains: [] } })).status, 200);

  for (const u of [pend, inside]) assert.equal((await browser('DELETE', `/api/admin/users/${u.id}`)).status, 200);
});

test('narrowing the User role takes a feature away on the next request and gives it back', async () => {
  const u = await joinAs('baseline@example.com');
  assert.equal((await as(u)('POST', '/api/chats', { body: { mode: 'code' } })).status, 200);
  const roles = (await browser('GET', '/api/admin/roles')).json.roles;
  const base = roles.find(r => r.id === 'user').permissions;
  assert.ok(!base.includes('chats.advanced') && !base.includes('admin.panel'), 'the default baseline is today’s member set');

  const narrowed = await browser('PUT', '/api/admin/roles/user-baseline', { body: { permissions: [...base.filter(p => p !== 'code.use' && p !== 'tasks.schedule'), 'admin.users'] } });
  assert.equal(narrowed.status, 200);
  assert.ok(!narrowed.json.roles.find(r => r.id === 'user').permissions.includes('admin.users'), 'admin permissions never enter the User role');
  assert.equal((await as(u)('POST', '/api/chats', { body: { mode: 'code' } })).status, 403);
  assert.equal((await as(u)('GET', '/api/tasks')).status, 403);
  assert.equal((await as(u)('POST', '/api/chats', { body: {} })).status, 200, 'everything else still works');
  assert.ok(!(await as(u)('GET', '/api/me')).json.user.permissions.includes('code.use'));
  assert.equal((await browser('POST', '/api/chats', { body: { mode: 'code' } })).status, 200, 'the owner keeps it');
  assert.equal((await as(u)('PUT', '/api/admin/roles/user-baseline', { body: { permissions: base } })).status, 403);

  assert.equal((await browser('PUT', '/api/admin/roles/user-baseline', { body: { permissions: base } })).status, 200);
  assert.equal((await as(u)('GET', '/api/tasks')).status, 200, 'restoring gives it back');
  assert.equal((await browser('DELETE', `/api/admin/users/${u.id}`)).status, 200);
});

const groupNamed = async (name, permissions) => {
  const made = await browser('POST', '/api/admin/groups', { body: { name } });
  assert.equal(made.status, 200, made.text);
  if (permissions) assert.equal((await browser('PATCH', `/api/admin/groups/${made.json.group.id}`, { body: { permissions } })).status, 200);
  return made.json.group.id;
};

test('groups grant everyday permissions to members and nested members, and nothing administrative', async () => {
  const u = await joinAs('grouped@example.com');
  const base = (await browser('GET', '/api/admin/roles')).json.roles.find(r => r.id === 'user').permissions;
  await browser('PUT', '/api/admin/roles/user-baseline', { body: { permissions: base.filter(p => p !== 'code.use') } });
  assert.equal((await as(u)('POST', '/api/chats', { body: { mode: 'code' } })).status, 403);

  assert.equal((await as(u)('POST', '/api/admin/groups', { body: { name: 'Mine' } })).status, 403, 'a user cannot make groups');
  assert.equal((await as(u)('GET', '/api/admin/groups')).status, 403, 'or list them');
  const coders = await groupNamed('Coders', ['code.use']);
  const team = await groupNamed('Team');
  assert.equal((await browser('POST', '/api/admin/groups', { body: { name: 'coders' } })).status, 409, 'names are unique regardless of case');
  assert.equal((await browser('PATCH', `/api/admin/groups/${coders}`, { body: { permissions: ['code.use', 'admin.users'] } })).status, 400, 'groups never carry admin permissions');
  assert.equal((await browser('PUT', `/api/admin/groups/${coders}/groups/${team}`)).status, 200, 'Team goes inside Coders');
  assert.equal((await browser('PUT', `/api/admin/groups/${team}/groups/${coders}`)).status, 409, 'and never the other way round as well');
  assert.equal((await browser('PUT', `/api/admin/groups/${team}/members`, { body: { add: [u.id] } })).status, 200);

  assert.equal((await as(u)('POST', '/api/chats', { body: { mode: 'code' } })).status, 200, 'inherited from Coders through Team');
  const access = (await browser('GET', `/api/admin/users/${u.id}/access`)).json;
  assert.deepEqual(access.permissions.find(p => p.id === 'code.use').sources[0].path.map(x => x.name), ['Team', 'Coders']);
  assert.deepEqual(access.direct, [team]);
  assert.ok(!(await as(u)('GET', '/api/me')).json.user.permissions.includes('admin.users'));

  assert.equal((await browser('PUT', `/api/admin/groups/${team}/members`, { body: { remove: [u.id] } })).status, 200);
  assert.equal((await as(u)('POST', '/api/chats', { body: { mode: 'code' } })).status, 403, 'leaving takes it away on the next request');

  for (const g of [team, coders]) assert.equal((await browser('DELETE', `/api/admin/groups/${g}`)).status, 200);
  await browser('PUT', '/api/admin/roles/user-baseline', { body: { permissions: base } });
  assert.equal((await browser('DELETE', `/api/admin/users/${u.id}`)).status, 200);
});

test('a model limited to a group is invisible and unusable to everyone else', async () => {
  const u = await joinAs('model-gated@example.com');
  const team = await groupNamed('Model team');
  const id = (await browser('POST', '/api/admin/models', { body: { display_name: 'Restricted', internal_name: 'restricted' } })).json.id;
  assert.equal((await browser('PATCH', `/api/admin/models/${id}`, { body: { enabled: true, access_groups: [team, 7, 'x'.repeat(200)] } })).status, 200);
  assert.deepEqual((await browser('GET', '/api/admin/models')).json.find(m => m.id === id).access_groups, [team], 'only plausible group ids are kept');
  assert.equal((await browser('POST', '/api/admin/changes/publish', { body: {} })).status, 200);

  assert.ok(!(await as(u)('GET', '/api/models')).json.some(m => m.id === id), 'hidden from the list');
  const chat = (await as(u)('POST', '/api/chats', { body: {} })).json.id;
  const frames = await exchange({ Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', Cookie: u.cookie }, { type: 'chat', chatId: chat, modelId: id, content: 'hello' });
  assert.equal(frames[0].type, 'error', 'and refused on the socket');

  await browser('PUT', `/api/admin/groups/${team}/members`, { body: { add: [u.id] } });
  await browser('PATCH', `/api/admin/groups/${team}`, { body: { defaultModelId: id } });
  const listed = (await as(u)('GET', '/api/models')).json;
  assert.ok(listed.some(m => m.id === id), 'joining the group opens it');
  assert.equal(listed.find(m => m.isDefault)?.id, id, 'and the group default becomes the default for new chats');

  await browser('POST', '/api/admin/models/remove', { body: { ids: [id] } });
  await browser('POST', '/api/admin/changes/publish', { body: {} });
  await browser('DELETE', `/api/admin/groups/${team}`);
  await browser('DELETE', `/api/admin/users/${u.id}`);
});

test('a workspace connector limited to a group is only listed for that group', async () => {
  const u = await joinAs('mcp-gated@example.com');
  const team = await groupNamed('Connector team');
  const created = await browser('POST', '/api/admin/mcp', { body: { name: 'Gated', transport: 'http', url: 'http://127.0.0.1:9/mcp', enabled: true, access_groups: [team] } });
  const id = created.json.server.id;
  assert.ok(!(await as(u)('GET', '/api/mcp')).json.servers.some(s => s.id === id));
  await browser('PUT', `/api/admin/groups/${team}/members`, { body: { add: [u.id] } });
  assert.ok((await as(u)('GET', '/api/mcp')).json.servers.some(s => s.id === id));
  await browser('DELETE', `/api/admin/mcp/${id}`);
  await browser('DELETE', `/api/admin/groups/${team}`);
  await browser('DELETE', `/api/admin/users/${u.id}`);
});

test('owners define custom roles, and a custom role manages only below its rank', async () => {
  const adm = await joinAs('role-admin@example.com');
  const lead = await joinAs('role-lead@example.com');
  const plain = await joinAs('role-plain@example.com');
  await browser('PATCH', `/api/admin/users/${adm.id}`, { body: { role: 'admin' } });

  assert.equal((await as(adm)('POST', '/api/admin/roles', { body: { name: 'Support', rank: 50, permissions: ['admin.panel'] } })).status, 403, 'admins do not define roles');
  assert.equal((await browser('POST', '/api/admin/roles', { body: { name: 'Admin', rank: 50 } })).status, 400, 'built-in names are taken');
  assert.equal((await browser('POST', '/api/admin/roles', { body: { name: 'Support', rank: 100 } })).status, 400, 'custom ranks stay below admin');
  const made = await browser('POST', '/api/admin/roles', { body: { name: 'Support', rank: 50, permissions: ['admin.panel', 'admin.users', 'nonsense'] } });
  assert.equal(made.status, 200, made.text);
  const support = made.json.role.id;
  assert.deepEqual(made.json.role.extras, ['admin.panel', 'admin.users']);

  assert.equal((await browser('PATCH', `/api/admin/users/${lead.id}`, { body: { role: support } })).status, 200);
  assert.equal((await as(lead)('GET', '/api/admin/users')).status, 200, 'the role opens user management');
  assert.equal((await as(lead)('PATCH', `/api/admin/users/${plain.id}`, { body: { role: 'pending' } })).status, 200, 'below its rank');
  assert.equal((await as(lead)('PATCH', `/api/admin/users/${adm.id}`, { body: { status: 'disabled' } })).status, 403, 'not above it');
  assert.equal((await as(lead)('PATCH', `/api/admin/users/${plain.id}`, { body: { role: support } })).status, 403, 'and never its own rank');
  assert.equal((await as(lead)('POST', '/api/admin/changes/publish', { body: {} })).status, 403, 'nothing it was not given');

  const removed = await browser('DELETE', `/api/admin/roles/${support}`);
  assert.equal(removed.json.moved, 1);
  assert.equal((await as(lead)('GET', '/api/me')).json.user.role, 'user', 'its holders fall back to user');
  assert.equal((await as(lead)('GET', '/api/admin/users')).status, 403);
  for (const x of [adm, lead, plain]) await browser('DELETE', `/api/admin/users/${x.id}`);
});

test('unknown routes answer in the right language', async () => {
  const api = await request('GET', '/api/not-a-real-endpoint');
  assert.equal(api.status, 404);
  assert.match(api.headers['content-type'] || '', /json/, 'an API miss is JSON, not an HTML error page');

  const spa = await request('GET', '/some/client/route');
  assert.equal(spa.status, 200);
  assert.match(spa.headers['content-type'] || '', /html/, 'client routes still reach the app');
});

test('release metadata is served to members only', async () => {
  assert.equal((await request('GET', '/api/release')).status, 401, 'no session, no release info');

  const rel = await browser('GET', '/api/release');
  assert.equal(rel.status, 200);
  assert.equal(typeof rel.json.version, 'string');
  assert.equal(typeof rel.json.codename, 'string');
  assert.ok(rel.json.line, 'the badge is told which release folder answered');
  assert.ok(rel.json.version.startsWith(rel.json.line), 'and that folder is one this version resolves to');
  assert.equal(typeof rel.json.notes, 'string');

  // the notes are the reason this moved off /api/app-config, which every page load fetches
  const cfg = await browser('GET', '/api/app-config');
  assert.equal(cfg.status, 200);
  assert.ok(!('uiVersionDesc' in cfg.json), 'release notes no longer ride along on every config fetch');
  assert.ok(!('uiVersionIcon' in cfg.json), 'nor does the icon path');
});

test('scheduled tasks round-trip and normalise a hostile schedule', async () => {
  assert.equal((await request('GET', '/api/tasks')).status, 401, 'tasks need a session');

  const empty = await browser('GET', '/api/tasks');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.tasks, []);

  const made = await browser('POST', '/api/tasks', {
    body: { title: '  Daily briefing  ', prompt: 'What needs my attention?', schedule: { kind: 'weekdays', hour: 99, minute: -1 } }
  });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.json.title, 'Daily briefing', 'the title is trimmed at the boundary');
  assert.deepEqual(made.json.schedule, { kind: 'weekdays', hour: 23, minute: 0 }, 'out-of-range fields are clamped, not stored');
  assert.ok(made.json.nextRun > Date.now(), 'an enabled task is scheduled forward');
  const id = made.json.id;

  const off = await browser('PATCH', `/api/tasks/${id}`, { body: { enabled: false } });
  assert.equal(off.status, 200);
  assert.equal(off.json.enabled, false);
  assert.equal(off.json.nextRun, 0, 'a disabled task stops being due');

  const junk = await browser('PATCH', `/api/tasks/${id}`, { body: { schedule: 'not-an-object', title: '' } });
  assert.equal(junk.status, 200, 'a nonsense schedule is normalised rather than rejected with a 500');
  assert.equal(junk.json.schedule.kind, 'daily');
  assert.equal(junk.json.title, 'New task');
  assert.equal(junk.json.webSearch, false, 'web search is off unless asked for');
  assert.equal(junk.json.reuseChat, false);

  const opts = await browser('PATCH', `/api/tasks/${id}`, {
    body: { webSearch: true, reuseChat: 'yes', enabled: true, schedule: { kind: 'weekly', days: [3, 1], hour: 7, minute: 15 } }
  });
  assert.equal(opts.json.webSearch, true);
  assert.equal(opts.json.reuseChat, false, 'only a real true turns an option on');
  assert.deepEqual(opts.json.schedule, { kind: 'weekly', hour: 7, minute: 15, days: [1, 3] });
  assert.ok([1, 3].includes(new Date(opts.json.nextRun).getDay()), 'the next run lands on a chosen day');
  assert.equal(opts.json.lastError, '');

  const interval = await browser('PATCH', `/api/tasks/${id}`, { body: { schedule: { kind: 'interval', everyMinutes: 120 } } });
  const renamed = await browser('PATCH', `/api/tasks/${id}`, { body: { title: 'Renamed', schedule: { kind: 'interval', everyMinutes: 120 }, enabled: true } });
  assert.equal(renamed.json.nextRun, interval.json.nextRun, 'saving without changing the schedule keeps the countdown');
  const retimed = await browser('PATCH', `/api/tasks/${id}`, { body: { schedule: { kind: 'interval', everyMinutes: 60 } } });
  assert.ok(retimed.json.nextRun < interval.json.nextRun, 'a new schedule moves the next run');

  const first = await browser('POST', `/api/tasks/${id}/run`);
  assert.equal(first.status, 200, first.text);

  await browser('PATCH', `/api/tasks/${id}`, { body: { reuseChat: true } });
  let again;
  for (let i = 0; i < 50; i++) {
    again = await browser('POST', `/api/tasks/${id}/run`);
    if (again.status === 200) break;
    await new Promise(r => { setTimeout(r, 100); });
  }
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.chatId, first.json.chatId, 'a task that keeps one chat runs in its last chat again');
  assert.equal((await browser('DELETE', `/api/tasks/${id}`)).status, 200);
  assert.equal((await browser('GET', '/api/tasks')).json.tasks.length, 0);
  assert.equal((await browser('PATCH', '/api/tasks/nope', { body: {} })).status, 404, 'an unknown id is a miss, not a crash');
});

test('a project file opens, saves as a new version, refuses a stale save and restores', async () => {
  const project = (await browser('POST', '/api/projects', { body: { name: 'Files probe' } })).json;
  const base = '/api/projects/' + project.id;
  const boundary = 'oqprobe' + Date.now();
  const raw = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.md"\r\nContent-Type: text/markdown\r\n\r\n# One\r\n--${boundary}--\r\n`);
  const up = await browser('POST', base + '/files', { raw, headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } });
  assert.equal(up.status, 200);

  const opened = await browser('GET', base + '/file?path=notes.md');
  assert.equal(opened.status, 200);
  assert.equal(opened.json.text, '# One');
  const saved = await browser('PUT', base + '/file', { body: { path: 'notes.md', text: '# Two', v: opened.json.v } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.v, opened.json.v + 1);
  assert.ok(saved.json.files.some(f => f.name === 'notes.md'), 'the project file list comes back in its own shape');

  const stale = await browser('PUT', base + '/file', { body: { path: 'notes.md', text: '# Lost', v: opened.json.v } });
  assert.equal(stale.status, 409, 'a save based on an older version is refused, not silently overwritten');
  assert.equal((await browser('PUT', base + '/file', { body: { path: 'missing.md', text: 'x' } })).status, 404, 'saving never creates a file');
  assert.equal((await browser('PUT', base + '/file', { body: { path: 'notes.md', text: 42 } })).status, 400);

  const restored = await browser('POST', base + '/restore', { body: { path: 'notes.md', v: opened.json.v } });
  assert.equal(restored.status, 200);
  assert.equal((await browser('GET', base + '/file?path=notes.md')).json.text, '# One');
  const dl = await browser('GET', base + '/download?path=notes.md');
  assert.equal(dl.text, '# One');
  assert.match(dl.headers['content-disposition'] || '', /attachment; filename="notes.md"/);

  assert.equal((await request('GET', base + '/file?path=notes.md')).status, 401);
  await browser('DELETE', base);
});

test('project files keep their folders, and can be created, renamed and zipped', async () => {
  const project = (await browser('POST', '/api/projects', { body: { name: 'Folder probe' } })).json;
  const base = '/api/projects/' + project.id;
  const boundary = 'oqfolder' + Date.now();
  const part = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const raw = Buffer.from(part('path', 'src/lib/app.py') + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="app.py"\r\nContent-Type: text/plain\r\n\r\nprint(1)\r\n--${boundary}--\r\n`);
  const up = await browser('POST', base + '/files', { raw, headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } });
  assert.equal(up.status, 200);
  assert.ok(up.json.files.some(f => f.name === 'src/lib/app.py'), 'the folder path survives the upload');
  const hostile = Buffer.from(part('path', '../../escape.txt') + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.txt"\r\n\r\nx\r\n--${boundary}--\r\n`);
  assert.equal((await browser('POST', base + '/files', { raw: hostile, headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } })).status, 400);

  const made = await browser('POST', base + '/files/new', { body: { path: 'docs/notes.md' } });
  assert.equal(made.status, 200);
  assert.equal(made.json.path, 'docs/notes.md');
  assert.equal((await browser('POST', base + '/files/new', { body: { path: 'docs/notes.md' } })).status, 409);
  assert.equal((await browser('POST', base + '/files/new', { body: { path: '.env' } })).status, 400);

  const moved = await browser('POST', base + '/files/rename', { body: { path: 'docs/notes.md', to: 'README.md' } });
  assert.equal(moved.status, 200);
  assert.ok(moved.json.files.some(f => f.name === 'README.md') && !moved.json.files.some(f => f.name === 'docs/notes.md'));
  assert.equal((await browser('POST', base + '/files/rename', { body: { path: 'README.md', to: 'src/lib/app.py' } })).status, 409);

  const zip = await browser('GET', base + '/zip');
  assert.equal(zip.status, 200);
  assert.match(zip.headers['content-type'] || '', /zip/);
  await browser('DELETE', base);
});

test('a dismissed plan is stored on the chat, and saving a missing chat file is refused', async () => {
  const { id } = (await browser('POST', '/api/chats', { body: {} })).json;
  assert.ok(id);
  assert.equal((await browser('POST', `/api/chats/${id}/plan/dismiss`, { body: { messageId: 'm1', n: 0 } })).status, 400);
  assert.equal((await browser('POST', `/api/chats/${id}/plan/dismiss`, { body: { messageId: 'm1', n: 2 } })).status, 200);
  assert.deepEqual((await browser('GET', `/api/chats/${id}`)).json.chat.planDismissed, { msg: 'm1', n: 2 });
  assert.equal((await browser('PUT', `/api/chats/${id}/file`, { body: { path: 'none.txt', text: 'x' } })).status, 404);
  await browser('DELETE', `/api/chats/${id}`);
});

test('the artifacts library answers for a member and refuses a stranger', async () => {
  assert.equal((await request('GET', '/api/artifacts')).status, 401);
  const res = await browser('GET', '/api/artifacts');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.artifacts), 'always an array, even with no chats');
  const capped = await browser('GET', '/api/artifacts?limit=9999&q=' + encodeURIComponent('x'.repeat(500)));
  assert.equal(capped.status, 200, 'an oversized limit and query are clamped at the boundary');
});

test('skills round-trip, reject a bad name and stay scoped to their owner', async () => {
  assert.equal((await request('GET', '/api/skills')).status, 401, 'skills need a session');

  const empty = await browser('GET', '/api/skills');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.skills.filter(s => s.scope === 'user'), []);

  const made = await browser('POST', '/api/skills', {
    body: { name: '  Brand Voice!  ', description: 'Keeps drafts in my voice', body: '# Brand voice\n\nUse this when writing.' }
  });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.json.name, 'brand-voice', 'the name is normalised at the boundary');
  assert.equal(made.json.enabled, true);
  assert.equal(made.json.editable, true);
  assert.match(made.json.file, /^---\nname: brand-voice\n/, 'the SKILL.md is rebuilt from the stored fields');
  const id = made.json.id;

  assert.equal((await browser('POST', '/api/skills', { body: { name: 'brand voice', body: 'x' } })).status, 400,
    'a duplicate name is refused rather than shadowing the first');
  assert.equal((await browser('POST', '/api/skills', { body: { name: 'a', body: 'x' } })).status, 400,
    'a one-character name is refused');
  assert.equal((await browser('POST', '/api/skills', { body: { name: 'ok-name', body: '  ' } })).status, 400,
    'empty instructions are refused');

  const uploaded = await browser('POST', '/api/skills', {
    body: { file: '---\nname: from-file\ndescription: Parsed out of the upload\n---\n\n# From file\n' }
  });
  assert.equal(uploaded.status, 200, uploaded.text);
  assert.equal(uploaded.json.name, 'from-file');
  assert.equal(uploaded.json.description, 'Parsed out of the upload', 'frontmatter wins over anything the client sends');

  const off = await browser('PATCH', `/api/skills/${id}`, { body: { enabled: false } });
  assert.equal(off.status, 200);
  assert.equal(off.json.enabled, false);
  assert.equal(off.json.name, 'brand-voice', 'an enable-only patch does not revalidate the name');

  assert.equal((await browser('PATCH', '/api/skills/nope', { body: { enabled: false } })).status, 404,
    'an unknown id is a miss, not a crash');
  assert.equal((await browser('DELETE', '/api/skills/nope')).status, 404);

  assert.equal((await browser('DELETE', `/api/skills/${id}`)).status, 200);
  assert.equal((await browser('DELETE', `/api/skills/${uploaded.json.id}`)).status, 200);
  const after = await browser('GET', '/api/skills');
  assert.equal(after.json.skills.filter(s => s.scope === 'user').length, 0);
});

test('memories round-trip and reject bad input', async () => {
  assert.equal((await request('GET', '/api/me/memories')).status, 401, 'memories need a session');

  const empty = await browser('GET', '/api/me/memories');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.memories, []);

  const made = await browser('POST', '/api/me/memories', { body: { text: '  Works   in Python ' } });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.json.memory.text, 'Works in Python', 'whitespace is collapsed at the boundary');
  assert.equal(made.json.memory.source, 'user');
  const id = made.json.memory.id;

  const again = await browser('POST', '/api/me/memories', { body: { text: 'works in python' } });
  assert.equal(again.json.memories.length, 1, 'a duplicate is not stored twice');
  assert.equal((await browser('POST', '/api/me/memories', { body: { text: '   ' } })).status, 400);
  assert.equal((await browser('POST', '/api/me/memories', { body: { text: { $gt: '' } } })).status, 400);

  const edited = await browser('PUT', `/api/me/memories/${id}`, { body: { text: 'Works in Rust' } });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.json.memories[0].text, 'Works in Rust');
  assert.equal((await browser('PUT', '/api/me/memories/nope12', { body: { text: 'x' } })).status, 404);
  assert.equal((await browser('DELETE', '/api/me/memories/nope12')).status, 404);

  assert.equal((await browser('DELETE', `/api/me/memories/${id}`)).status, 200);
  await browser('POST', '/api/me/memories', { body: { text: 'Lives in Oslo' } });
  assert.equal((await browser('DELETE', '/api/me/memories')).status, 200);
  assert.deepEqual((await browser('GET', '/api/me/memories')).json.memories, []);
});

test('the prompt a chat sends is the model prompt with its blocks filled in', async () => {
  const id = (await browser('POST', '/api/admin/models', { body: { display_name: 'Blocks', internal_name: 'blocks', system_prompt: 'Base for {{currentUser}}.' } })).json.id;
  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id, artifacts_allowed: false, memory_allowed: true, calculator_allowed: true }] } });
  await browser('PATCH', '/api/me', { body: { instructions: 'Answer tersely.', prefs: { memoryEnabled: true } } });
  await browser('POST', '/api/me/memories', { body: { text: 'Uses Rust' } });
  const chat = (await browser('POST', '/api/chats', { body: {} })).json;

  const sent = (await browser('GET', `/api/chats/${chat.id}/prompt?modelId=${id}`)).json;
  const system = sent.raw.find(m => m.role === 'system').content;
  assert.match(system, /^Base for [^{}\n]+\.\n\n<context>\n<section name="user_instructions">\n[^\n]+\nAnswer tersely\.\n<\/section>/);
  assert.match(system, /<section name="user_memory">\n[^\n]+\n- \[[a-z0-9]+\] Uses Rust\n<\/section>/);
  assert.match(system, /<tools>\n<tool name="memory">\nUser Memory: True\n/);
  assert.match(system, /<tool name="calculator">/);
  assert.doesNotMatch(system, /\{\{|<section name="chat_instructions">|<tool name="sandbox">/, 'empty sections, off tools and raw variables are left out');
  assert.deepEqual(sent.sections.map(s => s.name), ['Model system prompt', 'Context: user_instructions', 'Context: user_memory', 'Tool: memory', 'Tool: calculator']);

  await browser('PATCH', '/api/me', { body: { prefs: { memoryEnabled: false } } });
  const off = (await browser('GET', `/api/chats/${chat.id}/prompt?modelId=${id}`)).json.raw.find(m => m.role === 'system').content;
  assert.match(off, /User Memory: False/);
  assert.doesNotMatch(off, /Uses Rust/, 'memories are not shown while memory is off');

  await browser('DELETE', '/api/me/memories');
  await browser('PATCH', '/api/me', { body: { instructions: '', prefs: {} } });
  await browser('POST', '/api/admin/models/remove', { body: { ids: [id] } });
});

test('consult settings are admin-only, sanitised and add their block', async () => {
  const asker = (await browser('POST', '/api/admin/models', { body: { display_name: 'Asker', internal_name: 'asker' } })).json.id;
  const helper = (await browser('POST', '/api/admin/models', { body: { display_name: 'Helper', internal_name: 'helper', description: 'Sees images' } })).json.id;
  await browser('PATCH', '/api/admin/models', { body: { rows: [{ id: asker, consult_allowed: true, consult_models: [helper, helper, 7, ''], consult_images: true }] } });
  const row = (await browser('GET', '/api/admin/models')).json.find(m => m.id === asker);
  assert.deepEqual(row.consult_models, [helper], 'ids are deduplicated and non-strings dropped');
  assert.match(row.system_prompt, /<tool name="consult_model">[\s\S]*\{\{consultModels\}\}/);
  assert.equal((await request('PATCH', '/api/admin/models', { origin: ORIGIN, secFetchSite: 'same-origin', body: { rows: [{ id: asker, consult_models: [] }] } })).status, 401, 'nobody without a session can change them');
  await browser('POST', '/api/admin/changes/publish', { body: {} });
  const pub = (await browser('GET', '/api/models')).json.find(m => m.id === asker);
  assert.equal(JSON.stringify(pub).includes('consult'), false, 'the member-facing catalog never carries the consult settings');

  const chat = (await browser('POST', '/api/chats', { body: {} })).json;
  const system = (await browser('GET', `/api/chats/${chat.id}/prompt?modelId=${asker}`)).json.raw.find(m => m.role === 'system').content;
  assert.match(system, /<tool name="consult_model">[\s\S]*Models you can consult:\n- Helper: Sees images\n<\/tool>/);

  await browser('POST', '/api/admin/models/remove', { body: { ids: [asker, helper] } });
  await browser('POST', '/api/admin/changes/publish', { body: {} });
});

function chatTurn(send, { timeoutMs = 20000, onFrame = null, session = cookie } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: session, Origin: ORIGIN } });
    const got = [];
    const finish = (fn, arg) => { clearTimeout(timer); try { ws.terminate(); } catch {} fn(arg); };
    const timer = setTimeout(() => finish(reject, new Error('no done frame: ' + JSON.stringify(got.slice(-5)))), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify(send)));
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (SESSION_FRAMES.has(m?.type)) return;
      got.push(m);
      if (onFrame) onFrame(m, ws);
      if (m.type === 'done' && m.chatId === send.chatId) finish(resolve, got);
    });
    ws.on('error', (e) => finish(reject, e));
  });
}

async function connection(type, base_url, api_key) {
  const id = (await browser('POST', '/api/admin/providers', { body: { type } })).json.id;
  const res = await browser('PATCH', `/api/admin/providers/${id}`, { body: { base_url, api_key } });
  assert.equal(res.status, 200);
  return id;
}

const lastAssistant = (saved) => [...(saved.messages || [])].reverse().find(m => m.role === 'assistant');

test('switching a connection type moves an untouched address to the new default', async () => {
  const id = (await browser('POST', '/api/admin/providers', { body: { type: 'llamacpp' } })).json.id;
  await browser('PATCH', `/api/admin/providers/${id}`, { body: { type: 'anthropic' } });
  let p = (await browser('GET', '/api/admin/providers')).json.providers.find(x => x.id === id);
  assert.equal(p.base_url, 'https://api.anthropic.com');
  await browser('PATCH', `/api/admin/providers/${id}`, { body: { base_url: 'https://proxy.example/anthropic' } });
  await browser('PATCH', `/api/admin/providers/${id}`, { body: { type: 'openai' } });
  p = (await browser('GET', '/api/admin/providers')).json.providers.find(x => x.id === id);
  assert.equal(p.base_url, 'https://proxy.example/anthropic', 'an address someone typed is never replaced');
  assert.equal(p.has_key, false);
  await browser('PATCH', `/api/admin/providers/${id}`, { body: { api_key: 'sk-ant-secret-value-1234' } });
  const raw = (await browser('GET', '/api/admin/providers')).text;
  assert.doesNotMatch(raw, /sk-ant-secret/, 'a saved key never travels back to the browser');
  p = JSON.parse(raw).providers.find(x => x.id === id);
  assert.deepEqual([p.has_key, p.key_hint, 'api_key' in p], [true, '…1234', false]);
  await browser('DELETE', `/api/admin/providers/${id}`);
});

test('a Claude model runs a full chat turn with thinking and a tool round trip', async () => {
  const { mockAnthropic } = await import('./mockapis.js');
  const mock = await mockAnthropic({
    key: 'sk-ant-e2e',
    models: [{ id: 'claude-opus-5-5', max_input_tokens: 1000000, max_tokens: 128000 }],
    respond: (body) => {
      if (!body.stream) return { text: 'Multiplying numbers' };
      const results = body.messages.flatMap(m => (Array.isArray(m.content) ? m.content : [])).filter(b => b.type === 'tool_result');
      if (!results.length) return { thinking: 'I should use the calculator.', text: 'Let me check.', tools: [{ id: 'toolu_e2e', name: 'calculator', input: { expression: '17*23' } }] };
      return { thinking: 'The tool said 391.', text: 'The product is 391.' };
    }
  });
  try {
    const provider_id = await connection('anthropic', mock.url, 'sk-ant-e2e');
    const found = (await browser('GET', `/api/admin/discover-models?provider=${provider_id}`)).json;
    assert.deepEqual(found.models.map(m => m.id), ['claude-opus-5-5']);
    const model = (await browser('POST', '/api/admin/models', { body: { display_name: 'Claude', internal_name: 'claude-opus-5-5', provider_id, has_reasoning: true, calculator_allowed: true, artifacts_allowed: false } })).json.id;
    const chat = (await browser('POST', '/api/chats', { body: {} })).json;
    const frames = await chatTurn({ type: 'chat', chatId: chat.id, modelId: model, content: 'What is 17*23?' });
    assert.equal(frames.find(f => f.type === 'error'), undefined, JSON.stringify(frames.find(f => f.type === 'error')));
    for (const r of mock.requests) assert.equal(r.rejected, undefined, r.rejected);
    const turns = mock.requests.filter(r => r.body.stream);
    assert.equal(turns.length, 2);
    assert.match(turns[0].body.system.map(b => b.text).join('\n'), /<tool name="calculator">/);
    assert.deepEqual(turns[0].body.tools.map(t => t.name), ['calculator']);
    const replay = turns[1].body.messages;
    assert.equal(replay.at(-2).content[0].type, 'thinking', 'the signed thinking block goes back with the tool call');
    assert.match(replay.at(-1).content[0].content, /391/);
    assert.ok(frames.some(f => f.type === 'reasoning'), 'thinking reaches the browser');
    assert.match(lastAssistant((await browser('GET', `/api/chats/${chat.id}`)).json).content, /The product is 391\./);

    const pg = await browser('POST', '/api/admin/playground/stream', { body: { modelId: model, source: 'draft', messages: [{ role: 'user', content: 'What is 17*23?' }] } });
    assert.equal(pg.status, 200);
    assert.match(pg.text, /"type":"start"/);
    assert.doesNotMatch(pg.text, /"type":"error"/, pg.text);
    await browser('POST', '/api/admin/models/remove', { body: { ids: [model] } });
    await browser('DELETE', `/api/admin/providers/${provider_id}`);
  } finally {
    await mock.close();
  }
});

test('a project chat reads its knowledge, keeps notes and writes an artifact that can be saved back', async () => {
  const { mockAnthropic } = await import('./mockapis.js');
  const steps = [
    { name: 'project_search', input: { query: 'budget' } },
    { name: 'project_notes', input: { action: 'append', text: 'The trip budget is 400 euros.' } },
    { name: 'artifact', input: { name: 'trip plan', content: '# Trip\n\nBudget: 400 euros.' } }
  ];
  const mock = await mockAnthropic({
    key: 'sk-ant-proj',
    models: [{ id: 'claude-opus-5-5', max_input_tokens: 1000000, max_tokens: 128000 }],
    respond: (body) => {
      if (!body.stream) return { text: 'Trip planning' };
      const done = body.messages.flatMap(m => (Array.isArray(m.content) ? m.content : [])).filter(b => b.type === 'tool_result').length;
      const step = steps[done];
      return step ? { text: 'Working.', tools: [{ id: 'toolu_p' + done, ...step }] } : { text: 'The plan is in the panel.' };
    }
  });
  try {
    const provider_id = await connection('anthropic', mock.url, 'sk-ant-proj');
    const model = (await browser('POST', '/api/admin/models', { body: { display_name: 'Planner', internal_name: 'claude-opus-5-5', provider_id, artifacts_allowed: true } })).json.id;
    const project = (await browser('POST', '/api/projects', { body: { name: 'Lisbon trip' } })).json;
    const boundary = 'oqknow' + Date.now();
    const raw = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="brief.md"\r\nContent-Type: text/markdown\r\n\r\nThe budget is 400 euros.\r\n--${boundary}--\r\n`);
    assert.equal((await browser('POST', `/api/projects/${project.id}/files`, { raw, headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } })).status, 200);
    const chat = (await browser('POST', '/api/chats', { body: { projectId: project.id } })).json;

    const frames = await chatTurn({ type: 'chat', chatId: chat.id, modelId: model, content: 'Plan the trip from the brief.' });
    assert.equal(frames.find(f => f.type === 'error'), undefined, JSON.stringify(frames.find(f => f.type === 'error')));
    const turns = mock.requests.filter(r => r.body.stream);
    const offered = turns[0].body.tools.map(t => t.name);
    for (const n of ['project_search', 'project_read', 'project_chats', 'project_notes', 'artifact']) assert.ok(offered.includes(n), n);
    for (const n of ['bash', 'create_file', 'str_replace', 'delete_file']) assert.ok(!offered.includes(n), 'a project chat cannot ' + n);
    assert.match(turns[0].body.system.map(b => b.text).join('\n'), /<tool name="project">[\s\S]*Lisbon trip[\s\S]*- brief\.md/);
    const results = turns.at(-1).body.messages.flatMap(m => (Array.isArray(m.content) ? m.content : [])).filter(b => b.type === 'tool_result');
    assert.match(results[0].content, /brief\.md:1: The budget is 400 euros\./, 'knowledge search finds the document');
    assert.ok(frames.some(f => f.type === 'files' && f.files.some(x => x.path === 'trip-plan.md')), 'the panel hears about the new artifact');
    const lastSystem = turns.at(-1).body.system.map(b => b.text).join('\n');
    assert.match(lastSystem, /### trip-plan\.md \(v1\)/, 'the step after a write already sees the artifact it wrote');
    assert.match(lastSystem, /The trip budget is 400 euros\./, 'and the notes it just added');

    const notes = (await browser('GET', `/api/projects/${project.id}`)).json.notes;
    assert.equal(notes, 'The trip budget is 400 euros.');
    const prompt = (await browser('GET', `/api/chats/${chat.id}/prompt?modelId=${model}`)).json.raw.find(m => m.role === 'system').content;
    assert.match(prompt, /<section name="project_notes">\n[^\n]+\nThe trip budget is 400 euros\.\n<\/section>/, 'the next turn sees the notes');
    assert.match(prompt, /### trip-plan\.md \(v1\)\n```md\n# Trip/, 'and the current artifact');

    const base = `/api/chats/${chat.id}/artifacts`;
    assert.deepEqual((await browser('GET', base)).json.files.map(f => f.path), ['trip-plan.md']);
    const opened = (await browser('GET', base + '/file?path=trip-plan.md')).json;
    assert.equal(opened.text, '# Trip\n\nBudget: 400 euros.');
    const edited = await browser('PUT', base + '/file', { body: { path: 'trip-plan.md', text: '# Trip\n\nBudget: 450 euros.', v: opened.v } });
    assert.equal(edited.json.v, 2, 'an edit by the member is a new version');
    const saved = (await browser('POST', base + '/save', { body: { path: 'trip-plan.md' } })).json;
    assert.deepEqual([saved.projectId, saved.path], [project.id, 'trip-plan.md']);
    const again = (await browser('POST', base + '/save', { body: { path: 'trip-plan.md' } })).json;
    assert.equal(again.path, 'trip-plan-2.md', 'saving twice never overwrites knowledge');
    const knowledge = (await browser('GET', `/api/projects/${project.id}/files`)).json.files.map(f => f.name).sort();
    assert.deepEqual(knowledge, ['brief.md', 'trip-plan-2.md', 'trip-plan.md']);

    const library = (await browser('GET', '/api/artifacts')).json.artifacts;
    assert.ok(library.some(a => a.chatId === chat.id && a.path === 'trip-plan.md'));
    assert.ok(!library.some(a => a.path === 'brief.md'), 'project knowledge is not an artifact');

    const code = (await browser('POST', `/api/projects/${project.id}/code`)).json;
    assert.equal(code.mode, 'code');
    assert.equal(code.copied, 3);
    assert.deepEqual((await browser('GET', `/api/chats/${code.id}/files`)).json.files.map(f => f.path).sort(), knowledge, 'Open in Code starts from a copy of the knowledge');
    assert.equal(code.originProjectId, project.id);
    assert.equal((await browser('GET', '/api/chats')).json.find(c => c.id === code.id).originProjectId, project.id, 'the session remembers its project');
    assert.deepEqual((await browser('GET', `/api/projects/${project.id}`)).json.sessions.map(s => s.id), [code.id], 'and the project lists it');
    assert.ok(!(await browser('GET', '/api/artifacts')).json.artifacts.some(a => a.chatId === code.id), 'session files are not artifacts');
    const back = (await browser('POST', `/api/chats/${code.id}/files/save`, { body: { path: 'brief.md' } })).json;
    assert.deepEqual([back.projectId, back.path], [project.id, 'brief-2.md'], 'a session file goes back to its project as a copy');
    assert.equal((await browser('POST', `/api/chats/${chat.id}/files/save`, { body: { path: 'trip-plan.md' } })).status, 404, 'only a Code session has workspace files to save');
    assert.equal((await browser('GET', '/api/chats-overview?mode=code')).json.chats.some(c => c.id === code.id), true, 'sessions have their own overview');

    const fork = (await browser('POST', `/api/chats/${chat.id}/fork`, { body: {} })).json;
    assert.deepEqual((await browser('GET', `/api/chats/${fork.id}/artifacts`)).json.files.map(f => f.path), ['trip-plan.md'], 'a fork keeps its artifacts');

    for (const id of [chat.id, fork.id, code.id]) await browser('DELETE', `/api/chats/${id}`);
    assert.equal((await browser('GET', base)).status, 404);
    await browser('DELETE', `/api/projects/${project.id}`);
    await browser('POST', '/api/admin/models/remove', { body: { ids: [model] } });
    await browser('DELETE', `/api/admin/providers/${provider_id}`);
  } finally {
    await mock.close();
  }
});

test('an OpenAI model is added with its reasoning control and runs a tool round trip on the Responses API', async () => {
  const { mockResponses } = await import('./mockapis.js');
  const mock = await mockResponses({
    key: 'sk-e2e',
    models: ['gpt-6-astra', 'gpt-4o'],
    efforts: { 'gpt-6-astra': ['low', 'medium', 'high', 'xhigh', 'max'] },
    rejects: { 'gpt-6-astra': { temperature: "Unsupported parameter: 'temperature' is not supported with this model." } },
    respond: (body) => {
      if (!body.stream) return { text: 'Multiplying numbers' };
      if (!body.input.some(it => it.type === 'function_call_output')) return { reasoning: 'Use the calculator.', tools: [{ id: 'call_e2e', name: 'calculator', input: { expression: '17*23' } }] };
      return { reasoning: 'It returned 391.', text: 'It is 391.' };
    }
  });
  try {
    const provider_id = await connection('openai', mock.url, 'sk-e2e');
    const found = (await browser('GET', `/api/admin/discover-models?provider=${provider_id}`)).json;
    assert.deepEqual(found.models.map(m => m.id), ['gpt-6-astra', 'gpt-4o']);
    const astra = found.models.find(m => m.id === 'gpt-6-astra');
    assert.deepEqual(astra.caps.efforts, ['low', 'medium', 'high', 'xhigh', 'max'], 'discovery reports what the picker will offer');
    assert.equal(astra.caps.vision, true);
    assert.equal(found.models.find(m => m.id === 'gpt-4o').caps.reasoning, false);

    const id = (await browser('POST', '/api/admin/models', { body: { display_name: 'Astra', internal_name: 'gpt-6-astra', provider_id, calculator_allowed: true, artifacts_allowed: false } })).json.id;
    const row = (await browser('GET', '/api/admin/models')).json.find(m => m.id === id);
    assert.equal(row.has_vision, 1);
    assert.equal(row.has_reasoning, 0, 'no prompt-token switch for a model whose effort is a request field');
    assert.deepEqual(row.kwargs.map(k => [k.name, k.target, k.default]), [['reasoning_effort', 'body', 'medium']]);
    await browser('PATCH', '/api/admin/models', { body: { rows: [{ id, temperature: 0.3 }] } });

    const chat = (await browser('POST', '/api/chats', { body: {} })).json;
    const frames = await chatTurn({ type: 'chat', chatId: chat.id, modelId: id, content: 'What is 17*23?', kwargValues: { effort: 'xhigh' } });
    assert.equal(frames.find(f => f.type === 'error'), undefined, JSON.stringify(frames.find(f => f.type === 'error')));
    assert.match(frames.filter(f => f.type === 'reasoning').map(f => f.text).join(''), /Use the calculator/, 'the reasoning summary streams to the member');
    const turns = mock.requests.filter(r => r.body.stream && !r.rejected);
    assert.equal(turns.length, 2);
    for (const t of turns) {
      assert.equal(t.body.store, false, 'nothing is kept on the provider side');
      assert.deepEqual(t.body.reasoning, { effort: 'xhigh', summary: 'auto' }, 'the member choice reaches the request');
      assert.deepEqual(t.body.include, ['reasoning.encrypted_content']);
      assert.equal(t.body.temperature, undefined, 'the refused temperature is dropped');
      assert.equal(t.body.tools[0].name, 'calculator');
    }
    const replay = turns[1].body.input;
    const at = replay.findIndex(it => it.type === 'reasoning');
    assert.ok(at >= 0 && mock.issued.has(replay[at].id), 'the encrypted reasoning of the tool step goes back');
    assert.equal(replay[at + 1].type, 'function_call');
    const output = replay.find(it => it.type === 'function_call_output');
    assert.equal(output.call_id, 'call_e2e');
    assert.match(output.output, /391/);
    assert.match(lastAssistant((await browser('GET', `/api/chats/${chat.id}`)).json).content, /It is 391\./);
    await browser('POST', '/api/admin/models/remove', { body: { ids: [id] } });
    await browser('DELETE', `/api/admin/providers/${provider_id}`);
  } finally {
    await mock.close();
  }
});

test('Gemini gets its thought signatures back and DeepSeek its reasoning, inside real tool turns', async () => {
  const { mockOpenAi } = await import('./mockapis.js');
  const respond = (body) => {
    if (!body.stream) return { text: 'Maths' };
    if (!body.messages.some(m => m.role === 'tool')) return { reasoning: 'Work it out with the tool.', tools: [{ id: 'call_g', name: 'calculator', input: { expression: '6*7' } }] };
    return { text: 'It is 42.' };
  };
  const cases = [
    ['gemini', 'gemini-3.1-pro-preview', { signatures: true }],
    ['deepseek', 'deepseek-v4-pro', { reasoningContent: true }]
  ];
  for (const [type, internal, rules] of cases) {
    const mock = await mockOpenAi({ key: 'k-' + type, models: [internal], respond, ...rules });
    try {
      const provider_id = await connection(type, mock.url, 'k-' + type);
      const id = (await browser('POST', '/api/admin/models', { body: { display_name: type, internal_name: internal, provider_id, calculator_allowed: true } })).json.id;
      const chat = (await browser('POST', '/api/chats', { body: {} })).json;
      const frames = await chatTurn({ type: 'chat', chatId: chat.id, modelId: id, content: 'What is 6*7?' });
      assert.equal(frames.find(f => f.type === 'error'), undefined, type + ': ' + JSON.stringify(frames.find(f => f.type === 'error')));
      const turns = mock.requests.filter(r => r.body.stream);
      assert.equal(turns.filter(r => r.rejected).length, 0, type + ': ' + turns.map(r => r.rejected).join(' | '));
      assert.equal(turns.length, 2, type);
      if (type === 'gemini') assert.equal(turns[0].body.reasoning_effort, 'high', 'the recommended effort is sent');
      if (type === 'deepseek') assert.deepEqual(turns[0].body.thinking, { type: 'enabled' }, 'the thinking switch is a nested field');
      assert.match(lastAssistant((await browser('GET', `/api/chats/${chat.id}`)).json).content, /It is 42\./, type);
      await browser('POST', '/api/admin/models/remove', { body: { ids: [id] } });
      await browser('DELETE', `/api/admin/providers/${provider_id}`);
    } finally {
      await mock.close();
    }
  }
});

test('a wrong key surfaces as a readable error in the chat', async () => {
  const { mockAnthropic } = await import('./mockapis.js');
  const mock = await mockAnthropic({ key: 'right', respond: () => ({ text: 'never' }) });
  try {
    const provider_id = await connection('anthropic', mock.url, 'wrong');
    const model = (await browser('POST', '/api/admin/models', { body: { display_name: 'k', internal_name: 'claude-opus-5-5', provider_id } })).json.id;
    const chat = (await browser('POST', '/api/chats', { body: {} })).json;
    const frames = await chatTurn({ type: 'chat', chatId: chat.id, modelId: model, content: 'hi' });
    assert.match(frames.find(f => f.type === 'error')?.error || '', /Anthropic rejected the API key/);
    await browser('POST', '/api/admin/models/remove', { body: { ids: [model] } });
    await browser('DELETE', `/api/admin/providers/${provider_id}`);
  } finally {
    await mock.close();
  }
});

test('a Claude model calls an MCP tool an admin added, inside a real chat turn', async () => {
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-e2e-mcp-'));
  const fixture = path.join(dir, 'server.mjs');
  fs.writeFileSync(fixture, String.raw`
let buf = '';
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
process.stdin.on('data', c => {
  buf += c;
  for (let i; (i = buf.indexOf('\n')) !== -1;) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} } } });
    else if (m.method === 'tools/list') out({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'lookup.order', description: 'Find an order', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }] } });
    else if (m.method === 'tools/call') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'order ' + m.params.arguments.id + ' shipped on Tuesday' }] } });
  }
});
`);
  const added = await browser('POST', '/api/admin/mcp', { body: { name: 'Orders', transport: 'stdio', command: process.execPath, args: `"${fixture}"` } });
  assert.equal(added.status, 200, added.text);
  assert.equal(added.json.server.status, 'connected', added.json.warning);
  const server = added.json.server;
  const advertised = (body) => body.tools?.find(t => /Find an order/.test(t.description))?.name;
  let toolName = '';

  const { mockAnthropic } = await import('./mockapis.js');
  const mock = await mockAnthropic({
    key: 'sk-ant-mcp',
    respond: (body) => {
      if (!body.stream) return { text: 'Order status' };
      const done = body.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'));
      toolName = advertised(body) || toolName;
      return done ? { text: 'Your order shipped on Tuesday.' } : { tools: [{ id: 'toolu_mcp', name: toolName, input: { id: 'A-17' } }] };
    }
  });
  try {
    const provider_id = await connection('anthropic', mock.url, 'sk-ant-mcp');
    const model = (await browser('POST', '/api/admin/models', { body: { display_name: 'Claude MCP', internal_name: 'claude-opus-5-5', provider_id, mcp_allowed: true } })).json.id;
    const chat = (await browser('POST', '/api/chats', { body: {} })).json;
    const frames = await chatTurn({ type: 'chat', chatId: chat.id, modelId: model, content: 'Where is order A-17?' });
    assert.equal(frames.find(f => f.type === 'error'), undefined, JSON.stringify(frames.find(f => f.type === 'error')));
    for (const r of mock.requests) assert.equal(r.rejected, undefined, r.rejected);
    const first = mock.requests.find(r => r.body.stream);
    assert.match(toolName, new RegExp(`^mcp_${server.slug}_lookup_order_[a-z0-9]{4}$`), 'the dotted MCP name is offered under one the API accepts');
    assert.ok(first.body.tools.some(t => t.name === toolName));
    const result = mock.requests.filter(r => r.body.stream)[1].body.messages.at(-1).content[0];
    assert.match(result.content, /order A-17 shipped on Tuesday/);
    assert.match(lastAssistant((await browser('GET', `/api/chats/${chat.id}`)).json).content, /shipped on Tuesday/);
    await browser('POST', '/api/admin/models/remove', { body: { ids: [model] } });
    await browser('DELETE', `/api/admin/providers/${provider_id}`);
  } finally {
    await browser('DELETE', `/api/admin/mcp/${server.id}`);
    await mock.close();
    await new Promise(r => { setTimeout(r, 300); });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('settings secrets are saved but never read back', async () => {
  await browser('PATCH', '/api/admin/settings', { body: { voiceSttKey: 'stt-secret-value-9876' } });
  const raw = (await browser('GET', '/api/admin/settings')).text;
  assert.doesNotMatch(raw, /stt-secret-value/);
  const s = JSON.parse(raw);
  assert.deepEqual([s.voiceSttKey, s.voiceSttKeySaved, s.voiceSttKeyHint], ['', true, '…9876']);
  await browser('PATCH', '/api/admin/settings', { body: { voiceSttKey: null } });
  assert.equal((await browser('GET', '/api/admin/settings')).json.voiceSttKeySaved, false, 'removing is explicit');
  await browser('POST', '/api/admin/changes/discard', { body: {} });
});

test('MCP header and environment values stay on the server', async () => {
  const created = await browser('POST', '/api/admin/mcp', {
    body: { name: 'Secretive', transport: 'http', url: 'http://127.0.0.1:9/mcp', headers: 'Authorization: Bearer mcp-header-secret', enabled: false }
  });
  assert.doesNotMatch(created.text, /mcp-header-secret/);
  const id = created.json.server.id;
  const stdio = await browser('POST', '/api/admin/mcp', {
    body: { name: 'Env', transport: 'stdio', command: 'oq-not-a-real-binary-xyz', env: 'API_TOKEN=mcp-env-secret\nREGION=eu', enabled: false }
  });
  assert.doesNotMatch(stdio.text, /mcp-env-secret/);
  const list = (await browser('GET', '/api/admin/mcp')).text;
  assert.doesNotMatch(list, /mcp-header-secret|mcp-env-secret/);
  const servers = JSON.parse(list).servers;
  assert.deepEqual(servers.find(s => s.id === id).headerNames, ['Authorization']);
  assert.deepEqual(servers.find(s => s.id === stdio.json.server.id).envNames, ['API_TOKEN', 'REGION']);

  const renamed = await browser('PATCH', `/api/admin/mcp/${id}`, { body: { name: 'Renamed', headers: undefined } });
  assert.deepEqual(renamed.json.server.headerNames, ['Authorization'], 'an edit that does not send headers keeps them');
  const cleared = await browser('PATCH', `/api/admin/mcp/${id}`, { body: { headers: '' } });
  assert.deepEqual(cleared.json.server.headerNames, [], 'sending an empty value clears them');

  const member = await browser('GET', '/api/mcp');
  assert.doesNotMatch(member.text, /mcp-header-secret|mcp-env-secret/);
  await browser('DELETE', `/api/admin/mcp/${id}`);
  await browser('DELETE', `/api/admin/mcp/${stdio.json.server.id}`);
});

test('a code session keeps its mode and its workspace files can be managed from the panel', async () => {
  const made = (await browser('POST', '/api/chats', { body: { mode: 'code' } })).json;
  assert.equal(made.mode, 'code');
  const listed = (await browser('GET', '/api/chats')).json.find(c => c.id === made.id);
  assert.equal(listed.mode, 'code', 'the sidebar can tell a session from a chat');
  assert.equal((await browser('GET', '/api/chats/' + made.id)).json.chat.mode, 'code');
  assert.equal((await browser('GET', '/api/chats-overview')).json.chats.some(c => c.id === made.id), false, 'all chats lists chats only');
  const plain = (await browser('POST', '/api/chats', { body: {} })).json;
  assert.equal(plain.mode, 'chat');

  const base = '/api/chats/' + made.id;
  const created = await browser('POST', base + '/files/new', { body: { path: 'src/app.py' } });
  assert.equal(created.status, 200);
  assert.deepEqual(created.json.files.map(f => f.path), ['src/app.py']);
  assert.equal((await browser('POST', base + '/files/new', { body: { path: '../escape.txt' } })).status, 400);
  const renamed = await browser('POST', base + '/files/rename', { body: { path: 'src/app.py', to: 'src/main.py' } });
  assert.equal(renamed.json.path, 'src/main.py');

  const boundary = 'oqcode' + Date.now();
  const raw = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="data.csv"\r\nContent-Type: text/csv\r\n\r\na,b\n1,2\n\r\n--${boundary}--\r\n`);
  const up = await browser('POST', base + '/files', { raw, headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } });
  assert.equal(up.status, 200);
  assert.deepEqual(up.json.files.map(f => f.path).sort(), ['data.csv', 'src/main.py']);
  const gone = await browser('DELETE', base + '/files?path=' + encodeURIComponent('data.csv'));
  assert.deepEqual(gone.json.files.map(f => f.path), ['src/main.py']);
  await browser('PATCH', base, { body: { projectId: 'anything' } });
  assert.equal((await browser('GET', base)).json.chat.projectId, null, 'a session never joins a project and its workspace');
  await browser('DELETE', base);
  await browser('DELETE', '/api/chats/' + plain.id);
});

test('every response carries the isolation and permission headers', async () => {
  for (const pathname of ['/', '/api/auth/context']) {
    const res = await request('GET', pathname);
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
    assert.match(res.headers['permissions-policy'], /camera=\(\)/);
    assert.match(res.headers['permissions-policy'], /microphone=\(self\)/);
    assert.equal(res.headers['strict-transport-security'], undefined, 'HSTS only over TLS');
  }
  const proxied = await request('GET', '/api/auth/context', { headers: { 'x-forwarded-proto': 'https' } });
  assert.match(proxied.headers['strict-transport-security'], /max-age=\d+/);
});

test('deleting an account needs the password, and password checks are throttled per account', async () => {
  const res = await request('POST', '/api/auth/register', { origin: ORIGIN, secFetchSite: 'same-origin', body: { email: 'leaver@example.com', password: PASSWORD } });
  assert.equal(res.status, 200, res.text);
  const who = String(res.headers['set-cookie']?.[0] || '').split(';')[0];
  const as = (method, url, opts = {}) => browser(method, url, { ...opts, cookie: who });

  assert.equal((await as('DELETE', '/api/me')).status, 401);
  assert.equal((await as('DELETE', '/api/me', { body: { password: 'wrong' } })).status, 401);
  assert.equal((await as('GET', '/api/me')).status, 200, 'still there');
  for (let i = 0; i < 8; i++) await as('POST', '/api/me/password', { body: { current: 'wrong', next: 'another-password' } });
  const limited = await as('DELETE', '/api/me', { body: { password: PASSWORD } });
  assert.equal(limited.status, 429, 'the right password is refused once the account is throttled');
  assert.match(limited.json.error, /Too many attempts/);
});

test('an MCP tool that asks first waits for the member, and a refusal never reaches the server', async () => {
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-e2e-approve-'));
  const fixture = path.join(dir, 'server.mjs');
  const calls = path.join(dir, 'calls.log');
  fs.writeFileSync(fixture, String.raw`
import fs from 'node:fs';
let buf = '';
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
process.stdin.on('data', c => {
  buf += c;
  for (let i; (i = buf.indexOf('\n')) !== -1;) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} } } });
    else if (m.method === 'tools/list') out({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'delete_file', description: 'Delete a file', annotations: { destructiveHint: true }, inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }] } });
    else if (m.method === 'tools/call') { fs.appendFileSync(process.argv[2], m.params.arguments.path + '\n'); out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'deleted ' + m.params.arguments.path }] } }); }
  }
});
`);
  const added = await browser('POST', '/api/admin/mcp', { body: { name: 'Files', transport: 'stdio', command: process.execPath, args: `"${fixture}" "${calls}"` } });
  assert.equal(added.json.server.status, 'connected', added.json.warning);
  const server = added.json.server;
  assert.equal(server.tools[0].mode, 'ask');
  const toolName = `mcp_${server.slug}_delete_file`;

  const { mockAnthropic } = await import('./mockapis.js');
  const mock = await mockAnthropic({
    key: 'sk-ant-approve',
    respond: (body) => {
      if (!body.stream) return { text: 'Cleanup' };
      const last = body.messages.at(-1);
      const result = Array.isArray(last.content) && last.content.find(b => b.type === 'tool_result');
      return result ? { text: 'Result: ' + JSON.stringify(result.content) } : { tools: [{ id: 'toolu_del', name: toolName, input: { path: 'notes.txt' } }] };
    }
  });
  try {
    const provider_id = await connection('anthropic', mock.url, 'sk-ant-approve');
    const model = (await browser('POST', '/api/admin/models', { body: { display_name: 'Claude Approve', internal_name: 'claude-opus-5-5', provider_id, mcp_allowed: true } })).json.id;
    const chat = (await browser('POST', '/api/chats', { body: {} })).json;
    const answering = (text) => (m, ws) => {
      if (m.type === 'ask' && m.question?.approval) ws.send(JSON.stringify({ type: 'answer', chatId: chat.id, text }));
    };

    const denied = await chatTurn({ type: 'chat', chatId: chat.id, modelId: model, content: 'Delete notes.txt' }, { onFrame: answering('deny') });
    const ask = denied.find(f => f.type === 'ask');
    assert.equal(ask.question.approval.name, toolName);
    assert.match(ask.question.approval.args, /notes\.txt/);
    assert.ok(!fs.existsSync(calls), 'a refused call never reaches the server');
    assert.match(lastAssistant((await browser('GET', `/api/chats/${chat.id}`)).json).content, /declined/);

    await chatTurn({ type: 'chat', chatId: chat.id, modelId: model, content: 'Delete it, really' }, { onFrame: answering('allow_chat') });
    assert.equal(fs.readFileSync(calls, 'utf8').trim(), 'notes.txt');
    const again = await chatTurn({ type: 'chat', chatId: chat.id, modelId: model, content: 'And once more' });
    assert.equal(again.find(f => f.type === 'ask'), undefined, 'allowed for this chat, so it is not asked again');
    assert.equal(fs.readFileSync(calls, 'utf8').trim().split('\n').length, 2);

    const other = (await browser('POST', '/api/chats', { body: {} })).json;
    await browser('PATCH', `/api/chats/${other.id}`, { body: { mcpOff: [server.id] } });
    assert.deepEqual((await browser('GET', `/api/chats/${other.id}`)).json.chat.mcpOff, [server.id]);
    await chatTurn({ type: 'chat', chatId: other.id, modelId: model, content: 'Delete notes.txt' });
    const offered = mock.requests.filter(r => r.body.stream).at(-1).body.tools || [];
    assert.ok(!offered.some(t => t.name === toolName), 'a server switched off for a chat is not offered there');
    await browser('POST', '/api/admin/models/remove', { body: { ids: [model] } });
    await browser('DELETE', `/api/admin/providers/${provider_id}`);
  } finally {
    await browser('DELETE', `/api/admin/mcp/${server.id}`);
    await mock.close();
    await new Promise(r => { setTimeout(r, 300); });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a regression run grades both sides, and a sampled reply is checked and opens for review', async () => {
  const graded = (body) => {
    const user = body.messages.at(-1).content;
    const said = (Array.isArray(user) ? user.map(b => b.text || '').join('') : String(user)).match(/<reply_to_judge>\n([\s\S]*?)\n<\/reply_to_judge>/)?.[1] || '';
    if (/<criterion>[\s\S]*unresolved/.test(Array.isArray(user) ? user.map(b => b.text || '').join('') : String(user))) {
      return JSON.stringify({ verdict: 'fail', score: 20, explanation: 'It only promised to look later.', evidence: said.slice(0, 20) });
    }
    return JSON.stringify(/precise/.test(said) ? { verdict: 'pass', score: 90, explanation: 'Matches the reference.', evidence: 'precise' } : { verdict: 'fail', score: 30, explanation: 'Vague.', evidence: '' });
  };
  const { mockAnthropic } = await import('./mockapis.js');
  const mock = await mockAnthropic({
    key: 'sk-ant-eval',
    respond: (body) => {
      if (!body.stream && /careful evaluator/.test(JSON.stringify(body.system || ''))) return { text: graded(body) };
      if (!body.stream) return { text: 'Title' };
      return { text: body.model === 'claude-sonnet-5-5' ? 'A precise answer.' : 'I will look into it later.' };
    }
  });
  try {
    const provider_id = await connection('anthropic', mock.url, 'sk-ant-eval');
    const base = (await browser('POST', '/api/admin/models', { body: { display_name: 'Eval Base', internal_name: 'claude-opus-5-5', provider_id, cost_in: 1, cost_out: 2 } })).json.id;
    const cand = (await browser('POST', '/api/admin/models', { body: { display_name: 'Eval Candidate', internal_name: 'claude-sonnet-5-5', provider_id, cost_in: 1, cost_out: 2 } })).json.id;
    assert.equal((await browser('PUT', '/api/admin/evals/judge', { body: { modelId: cand } })).json.judge.modelId, cand);

    const made = await browser('POST', '/api/admin/evals', { body: { name: 'Support answers' } });
    assert.equal(made.status, 200, made.text);
    const cid = made.json.collection.id;
    await browser('POST', `/api/admin/evals/${cid}/cases`, { body: { messages: [{ role: 'user', content: 'How long do refunds take?' }], reference: 'Five business days.' } });
    const added = await browser('POST', `/api/admin/evals/${cid}/cases`, { body: { messages: [{ role: 'user', content: 'Can I change my plan?' }] } });
    assert.equal(added.json.collection.version, 2);

    const started = await browser('POST', `/api/admin/evals/${cid}/runs`, { body: { baseline: { source: 'draft', modelId: base }, candidate: { source: 'draft', modelId: cand } } });
    assert.equal(started.status, 202, started.text);
    assert.equal((await browser('POST', `/api/admin/evals/${cid}/runs`, { body: { baseline: { source: 'draft', modelId: base }, candidate: { source: 'draft', modelId: cand } } })).status, 409, 'one run per collection at a time');
    let run;
    for (let i = 0; i < 100; i++) {
      run = (await browser('GET', `/api/admin/evals/runs/${started.json.run.id}`)).json.run;
      if (run.status !== 'running') break;
      await new Promise(r => { setTimeout(r, 100); });
    }
    assert.equal(run.status, 'done');
    assert.equal(run.version, 2);
    assert.equal(run.summary.improved, 2);
    assert.equal(run.summary.baseline.score, 30);
    assert.equal(run.summary.candidate.score, 90);
    assert.ok(run.summary.candidate.cost > 0, 'cost comes from the model prices');
    assert.ok(Number.isFinite(run.summary.candidate.medianMs));
    assert.equal(run.results[0].cand.explanation, 'Matches the reference.');
    assert.equal((await browser('GET', `/api/admin/evals/${cid}`)).json.runs.length, 1);

    const settings = await browser('PUT', '/api/admin/quality/settings', { body: { enabled: true, sampleRate: 100, criteria: [{ kind: 'resolution' }] } });
    assert.equal(settings.json.settings.criteria[0].name, 'Leaves the request unresolved');
    const chat = (await browser('POST', '/api/chats', { body: {} })).json;
    assert.equal((await browser('GET', `/api/admin/review/chats/${chat.id}`)).status, 404, 'nothing flagged yet, so the chat stays private');
    await chatTurn({ type: 'chat', chatId: chat.id, modelId: base, content: 'Fix my invoice please' });
    let results;
    for (let i = 0; i < 100; i++) {
      results = (await browser('GET', '/api/admin/quality/results?verdict=fail')).json;
      if (results.total) break;
      await new Promise(r => { setTimeout(r, 100); });
    }
    const flagged = results.results[0];
    assert.equal(flagged.chat_id, chat.id);
    assert.equal(flagged.explanation, 'It only promised to look later.');
    assert.match(flagged.question, /Fix my invoice/);
    const report = (await browser('GET', '/api/admin/quality')).json.report;
    assert.ok(report.recurring.some(r => r.model === 'Eval Base' && r.n >= 1));

    const review = await browser('GET', `/api/admin/review/chats/${chat.id}?message=${flagged.message_id}`);
    assert.equal(review.status, 200);
    assert.equal(review.json.messages.at(-1).checks[0].verdict, 'fail');
    const audit = (await browser('GET', '/api/admin/audit?action=review.view')).json;
    assert.ok(JSON.stringify(audit).includes(chat.id), 'every view of a member chat is logged');

    const copied = await browser('POST', `/api/admin/evals/${cid}/from-message`, { body: { messageId: flagged.message_id, reference: 'Open the invoice and correct it.', kind: 'quality' } });
    assert.equal(copied.status, 200, copied.text);
    const kase = copied.json.collection.cases.at(-1);
    assert.equal(kase.source.kind, 'quality');
    assert.equal(kase.observed, 'I will look into it later.');

    assert.equal((await browser('GET', '/api/app-config')).json.reviewNotice, true, 'members are told review is on');
    await browser('PUT', '/api/admin/quality/settings', { body: { enabled: false } });
    await browser('DELETE', `/api/chats/${chat.id}`);
    assert.equal((await browser('GET', '/api/admin/quality/results')).json.results.filter(r => r.chat_id === chat.id).length, 0, 'deleting the chat removes its checks');
    await browser('DELETE', `/api/admin/evals/${cid}`);
    await browser('POST', '/api/admin/models/remove', { body: { ids: [base, cand] } });
    await browser('DELETE', `/api/admin/providers/${provider_id}`);
  } finally {
    await mock.close();
  }
});

test('sharing hands out exactly the granted level, and nobody reaches what was not shared with them', async () => {
  const { mockOpenAi } = await import('./mockapis.js');
  const mock = await mockOpenAi({ key: 'k-share', models: ['share-model'], respond: () => ({ text: 'Seen it.' }) });
  const ana = await joinAs('share-owner@example.com');
  const ben = await joinAs('share-reader@example.com');
  const cy = await joinAs('share-stranger@example.com');
  const A = as(ana), B = as(ben), C = as(cy);
  const share = (call, type, id, principalId, level, principalType = 'user') => call('PUT', `/api/shares/${type}/${id}`, { body: { principalType, principalId, level } });
  const unshare = (call, type, id, principalId, principalType = 'user') => call('DELETE', `/api/shares/${type}/${id}`, { body: { principalType, principalId } });
  let provider_id = null;
  let modelId = null;
  const groups = [];
  try {
    const project = (await A('POST', '/api/projects', { body: { name: 'Roadmap' } })).json;
    assert.equal((await A('POST', `/api/projects/${project.id}/files/new`, { body: { path: 'plan.md' } })).status, 200);
    assert.equal((await B('GET', `/api/projects/${project.id}`)).status, 404, 'an unshared project looks missing');
    assert.equal((await B('GET', `/api/projects/${project.id}/files`)).status, 404);
    assert.equal((await B('GET', `/api/shares/project/${project.id}`)).status, 404, 'and so does who has it');
    assert.equal((await B('GET', '/api/directory?q=share-owner')).json.people[0].id, ana.id, 'people can be found to share with');

    assert.equal((await share(A, 'project', project.id, ben.id, 'view')).status, 200);
    const seen = (await B('GET', `/api/projects/${project.id}`)).json;
    assert.equal(seen.access, 'view');
    assert.equal(seen.canShare, false);
    assert.ok((await B('GET', '/api/projects')).json.some(p => p.id === project.id && p.owner), 'it is listed with its owner');
    assert.equal((await B('GET', `/api/projects/${project.id}/file?path=plan.md`)).status, 200, 'a viewer reads the knowledge');
    assert.equal((await B('POST', `/api/projects/${project.id}/files/new`, { body: { path: 'mine.md' } })).status, 403, 'but cannot add to it');
    assert.equal((await B('PATCH', `/api/projects/${project.id}`, { body: { instructions: 'Be terse.' } })).status, 403);
    assert.equal((await share(B, 'project', project.id, cy.id, 'view')).status, 403, 'or share it on');
    assert.equal((await B('DELETE', `/api/projects/${project.id}`)).status, 403);
    assert.equal((await B('POST', '/api/chats', { body: { projectId: project.id } })).json.projectId, project.id, 'a viewer chats inside it');

    assert.equal((await share(A, 'project', project.id, ben.id, 'edit')).status, 200);
    assert.equal((await B('POST', `/api/projects/${project.id}/files/new`, { body: { path: 'mine.md' } })).status, 200, 'an editor adds files');
    assert.equal((await B('DELETE', `/api/projects/${project.id}`)).status, 403, 'only the owner deletes');
    const who = (await A('GET', `/api/shares/project/${project.id}`)).json;
    assert.deepEqual(who.people.map(p => [p.id, p.level]), [[ben.id, 'edit']]);
    assert.equal((await B('GET', `/api/shares/project/${project.id}`)).json.people.length, 0, 'only managers see everyone who has it');

    assert.equal((await unshare(A, 'project', project.id, ben.id)).status, 200);
    assert.equal((await B('GET', `/api/projects/${project.id}/files`)).status, 404, 'revoking applies on the next request');
    assert.equal((await B('POST', '/api/chats', { body: { projectId: project.id } })).json.projectId, null, 'and the project can no longer be picked');

    const outer = await groupNamed('Readers');
    const inner = await groupNamed('New readers');
    groups.push(outer, inner);
    assert.equal((await browser('PUT', `/api/admin/groups/${outer}/groups/${inner}`)).status, 200);
    assert.equal((await browser('PUT', `/api/admin/groups/${inner}/members`, { body: { add: [cy.id] } })).status, 200);
    assert.equal((await share(A, 'project', project.id, outer, 'view', 'group')).status, 200);
    assert.equal((await C('GET', `/api/projects/${project.id}`)).status, 200, 'shared through a nested group');
    const why = (await A('GET', `/api/shares/project/${project.id}`)).json.people.find(p => p.id === cy.id);
    assert.deepEqual(why.reasons[0].path.map(g => g.name), ['Readers', 'New readers']);
    assert.equal((await browser('PUT', `/api/admin/groups/${inner}/members`, { body: { remove: [cy.id] } })).status, 200);
    assert.equal((await C('GET', `/api/projects/${project.id}`)).status, 404, 'leaving the group ends it');

    provider_id = await connection('openrouter', mock.url, 'k-share');
    modelId = (await browser('POST', '/api/admin/models', { body: { display_name: 'Share', internal_name: 'share-model', provider_id } })).json.id;
    assert.equal((await browser('POST', '/api/admin/changes/publish', { body: {} })).status, 200);

    const notes = await uploadFile(A, 'notes.txt', 'text/plain', 'secret notes');
    const chat = (await A('POST', '/api/chats', { body: {} })).json;
    const sent = await chatTurn({ type: 'chat', chatId: chat.id, modelId, content: 'Read this', attachments: [{ url: notes, name: 'notes.txt', type: 'text/plain', size: 12 }] }, { session: ana.cookie });
    assert.equal(sent.find(f => f.type === 'error'), undefined, JSON.stringify(sent.find(f => f.type === 'error')));
    assert.ok(JSON.stringify(mock.requests.filter(r => r.body.stream).at(-1).body).includes('secret notes'), 'the owner attaches their own file');

    const theirs = (await B('POST', '/api/chats', { body: {} })).json;
    assert.equal((await B('POST', `/api/chats/${theirs.id}/pins`, { body: { url: notes, name: 'notes.txt' } })).status, 404, 'nobody pins a file they did not upload');
    await chatTurn({ type: 'chat', chatId: theirs.id, modelId, content: 'What does it say?', attachments: [{ url: notes, name: 'notes.txt', type: 'text/plain', size: 12 }] }, { session: ben.cookie });
    assert.ok(!JSON.stringify(mock.requests.filter(r => r.body.stream).at(-1).body).includes('secret notes'), 'a borrowed attachment never reaches the model');
    assert.deepEqual((await B('GET', `/api/chats/${theirs.id}`)).json.messages.find(m => m.role === 'user').attachments, [], 'and is not stored');
    assert.equal((await request('GET', notes, { cookie: ben.cookie })).status, 404, 'knowing the address is not access');
    assert.equal((await B('GET', `/api/uploads/${notes.split('/').pop()}/text`)).status, 404);

    assert.equal((await B('GET', `/api/chats/${chat.id}`)).status, 404);
    assert.equal((await share(B, 'chat', chat.id, ben.id, 'view')).status, 404, 'a stranger cannot share it to themselves');
    assert.equal((await share(A, 'chat', chat.id, ben.id, 'edit')).status, 400, 'chats are shared to read only');
    assert.equal((await share(A, 'chat', chat.id, ben.id, 'view')).status, 200);
    const read = (await B('GET', `/api/chats/${chat.id}`)).json;
    assert.equal(read.chat.access, 'view');
    assert.equal(read.messages.length, 2);
    assert.ok((await B('GET', '/api/shared/chats')).json.chats.some(c => c.id === chat.id));
    assert.equal((await request('GET', notes, { cookie: ben.cookie })).status, 200, 'a reader sees what the chat shows');
    assert.equal((await request('GET', notes, { cookie: cy.cookie })).status, 404, 'and nobody else does');

    await B('PATCH', `/api/chats/${chat.id}`, { body: { title: 'Taken over' } });
    await B('DELETE', `/api/chats/${chat.id}`);
    assert.equal((await B('POST', `/api/chats/${chat.id}/fork`, { body: {} })).status, 404);
    const hijack = await exchange({ Cookie: ben.cookie, Origin: ORIGIN }, { type: 'chat', chatId: chat.id, modelId, content: 'Mine now' });
    assert.equal(hijack[0]?.type, 'error', 'a reader cannot write to it');
    const intact = (await A('GET', `/api/chats/${chat.id}`)).json;
    assert.notEqual(intact.chat.title, 'Taken over');
    assert.equal(intact.messages.length, 2, 'the owner’s chat is untouched');

    const copy = await B('POST', `/api/chats/${chat.id}/copy`);
    assert.equal(copy.status, 200, copy.text);
    const mine = (await B('GET', `/api/chats/${copy.json.id}`)).json;
    assert.equal(mine.chat.access, 'owner');
    const copied = mine.messages.find(m => m.role === 'user').attachments[0].url;
    assert.notEqual(copied, notes, 'the copy owns its own file');
    assert.equal((await unshare(A, 'chat', chat.id, ben.id)).status, 200);
    assert.equal((await B('GET', `/api/chats/${chat.id}`)).status, 404, 'revoked at once');
    assert.equal((await request('GET', notes, { cookie: ben.cookie })).status, 404, 'with its attachment');
    assert.equal((await request('GET', copied, { cookie: ben.cookie })).status, 200, 'while the copy stays theirs');

    const skill = (await A('POST', '/api/skills', { body: { name: 'house-style', description: 'How we write', body: '# House style' } })).json;
    assert.equal((await share(A, 'skill', skill.id, ben.id, 'view')).status, 200);
    const listed = (await B('GET', '/api/skills')).json.skills.find(s => s.id === skill.id);
    assert.equal(listed.scope, 'shared');
    assert.equal(listed.editable, false);
    assert.equal(listed.enabled, true);
    assert.equal((await B('PATCH', `/api/skills/${skill.id}`, { body: { body: '# Mine now' } })).status, 403);
    assert.equal((await B('PATCH', `/api/skills/${skill.id}`, { body: { enabled: false } })).json.enabled, false, 'a reader switches it off for themselves');
    assert.equal((await A('GET', '/api/skills')).json.skills.find(s => s.id === skill.id).enabled, true, 'without touching the owner');
    assert.equal((await B('DELETE', `/api/skills/${skill.id}`)).status, 404);
    assert.equal((await share(A, 'skill', skill.id, ben.id, 'edit')).status, 200);
    assert.equal((await B('PATCH', `/api/skills/${skill.id}`, { body: { body: '# Written together' } })).status, 200, 'an editor edits it');
    assert.equal((await A('GET', '/api/skills')).json.skills.find(s => s.id === skill.id).body, '# Written together');

    assert.equal((await share(A, 'project', project.id, ben.id, 'view')).status, 200);
    assert.equal((await browser('DELETE', `/api/admin/users/${ana.id}`)).status, 200);
    assert.equal((await B('GET', `/api/projects/${project.id}`)).status, 404, 'removing the owner removes what they shared');
    assert.ok(!(await B('GET', '/api/skills')).json.skills.some(s => s.id === skill.id));
    assert.deepEqual((await B('GET', '/api/shared/chats')).json.chats, []);
  } finally {
    for (const g of groups) await browser('DELETE', `/api/admin/groups/${g}`);
    for (const who of [ana, ben, cy]) await browser('DELETE', `/api/admin/users/${who.id}`);
    if (modelId) {
      await browser('POST', '/api/admin/models/remove', { body: { ids: [modelId] } });
      await browser('POST', '/api/admin/changes/publish', { body: {} });
    }
    if (provider_id) await browser('DELETE', `/api/admin/providers/${provider_id}`);
    await mock.close();
  }
});

test('two-factor sign-in is a sealed challenge that cannot be skipped, replayed or reused', async () => {
  const { totpCode } = await import('../lib/totp.js');
  const cookieNamed = (res, name) => (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).find(c => c.startsWith(name + '='));
  const sam = await joinAs('mfa-user@example.com');
  const S = as(sam);
  const setup = (await S('POST', '/api/me/2fa/setup', { body: {} })).json;
  assert.match(setup.qr, /^<svg/);
  const enabled = await S('POST', '/api/me/2fa/enable', { body: { code: totpCode(setup.secret) } });
  assert.equal(enabled.status, 200, enabled.text);
  assert.equal(enabled.json.recoveryCodes.length, 10);
  assert.equal(enabled.json.user.twoFactor, true);

  const signIn = () => request('POST', '/api/auth/login', { origin: ORIGIN, secFetchSite: 'same-origin', body: { email: 'mfa-user@example.com', password: PASSWORD } });
  const first = await signIn();
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.mfa.methods, ['totp', 'recovery']);
  assert.equal(first.json.user, undefined, 'no account before the second step');
  assert.equal(cookieNamed(first, 'token'), undefined, 'and no session');
  const challenge = cookieNamed(first, 'oq_mfa');
  assert.ok(challenge);
  const finish = (cookieValue, body) => request('POST', '/api/auth/mfa', { origin: ORIGIN, secFetchSite: 'same-origin', cookie: cookieValue, body });

  assert.equal((await finish('', { code: totpCode(setup.secret, Date.now() + 30000) })).json.restart, true, 'no challenge, no second step');
  assert.equal((await finish(challenge, { code: '000000' })).status, 401);
  assert.equal((await finish(challenge, { code: totpCode(setup.secret) })).status, 401, 'the code used to enroll cannot be replayed');
  const done = await finish(challenge, { code: totpCode(setup.secret, Date.now() + 30000) });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.json.user.email, 'mfa-user@example.com');
  const session = cookieNamed(done, 'token');
  assert.ok(session);
  assert.equal((await request('GET', '/api/me', { cookie: session })).status, 200);
  assert.equal((await finish(challenge, { recovery: enabled.json.recoveryCodes[0] })).status, 401, 'a challenge opens one session');

  const again = cookieNamed(await signIn(), 'oq_mfa');
  assert.equal((await finish(again, { recovery: enabled.json.recoveryCodes[0] })).status, 200, 'a recovery code signs in');
  const third = cookieNamed(await signIn(), 'oq_mfa');
  assert.equal((await finish(third, { recovery: enabled.json.recoveryCodes[0] })).status, 401, 'once');

  assert.equal((await browser('PUT', '/api/admin/auth/mfa', { body: { policy: 'everyone' } })).status, 400, 'an owner without two-factor cannot require it');
  const mine = (await browser('POST', '/api/me/2fa/setup', { body: {} })).json;
  assert.equal((await browser('POST', '/api/me/2fa/enable', { body: { code: totpCode(mine.secret) } })).status, 200);
  try {
    assert.equal((await as(sam)('PUT', '/api/admin/auth/mfa', { body: { policy: 'everyone' } })).status, 403, 'only the owner sets the policy');
    const policy = await browser('PUT', '/api/admin/auth/mfa', { body: { policy: 'everyone' } });
    assert.equal(policy.status, 200, policy.text);
    const late = await joinAs('mfa-late@example.com');
    const L = as(late);
    const blocked = await L('GET', '/api/models');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.gate, 'mfa');
    assert.equal((await L('GET', '/api/me')).json.user.gate, 'mfa', 'the account can see why');
    const lateSetup = (await L('POST', '/api/me/2fa/setup', { body: {} })).json;
    assert.equal((await L('POST', '/api/me/2fa/enable', { body: { code: totpCode(lateSetup.secret) } })).status, 200, 'and enroll');
    assert.equal((await L('GET', '/api/models')).status, 200, 'which lifts the gate on the same session');
    assert.equal((await L('POST', '/api/me/2fa/disable', { body: { password: PASSWORD } })).status, 403, 'a required factor cannot be turned off');

    assert.equal((await S('POST', `/api/admin/users/${late.id}/mfa-reset`)).status, 403, 'a user cannot reset anyone');
    assert.equal((await browser('POST', `/api/admin/users/${late.id}/mfa-reset`)).status, 200);
    assert.equal((await L('GET', '/api/me')).status, 401, 'a reset ends the account’s sessions');
    assert.equal((await browser('DELETE', `/api/admin/users/${late.id}`)).status, 200);
  } finally {
    assert.equal((await browser('PUT', '/api/admin/auth/mfa', { body: { policy: 'optional' } })).status, 200);
    assert.equal((await browser('POST', '/api/me/2fa/disable', { body: { password: PASSWORD } })).status, 200);
    assert.equal((await browser('DELETE', `/api/admin/users/${sam.id}`)).status, 200);
  }
});