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

const SERVER_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB_NAME = 'oqhttptest';
const DB_DIR = path.join(SERVER_ROOT, 'data', 'databases', DB_NAME);
const EMAIL = 'integration@test.local';
const PASSWORD = 'integration-password';
const START_TIMEOUT_MS = 30000;

let child = null;
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
    req.setTimeout(15000, () => req.destroy(new Error(`timed out: ${method} ${pathname}`)));
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
function exchange(headers, send, { frames = 1, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers });
    const got = [];
    const finish = (fn, arg) => { clearTimeout(timer); try { ws.terminate(); } catch {} fn(arg); };
    const timer = setTimeout(() => finish(resolve, got), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify(send)));
    ws.on('message', (raw) => {
      try { got.push(JSON.parse(raw)); } catch { return; }
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
      env: { ...process.env, OPEN_QUILL_DB: DB_NAME, PORT: String(PORT), HOST: '127.0.0.1' },
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

before(async () => {
  removeDb();
  PORT = await freePort();
  ORIGIN = `http://127.0.0.1:${PORT}`;
  child = await startServer();

  // The first account created on a fresh database becomes owner+admin.
  const res = await request('POST', '/api/auth/register', {
    origin: ORIGIN, secFetchSite: 'same-origin', body: { email: EMAIL, password: PASSWORD }
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

test('the app answers and serves its policy header', async () => {
  const root = await request('GET', '/');
  assert.equal(root.status, 200);
  assert.ok(root.headers['content-security-policy'], 'app HTML carries the local-only policy');
  assert.equal(root.headers['x-content-type-options'], 'nosniff');

  const ctx = await request('GET', '/api/auth/context');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.headers['cache-control'], 'no-store', 'authenticated JSON must not be cached');
  assert.equal(ctx.json.firstRun, false);
  // deliberately limited to branding plus the two booleans the sign-in screen needs
  assert.deepEqual(Object.keys(ctx.json).sort(), ['allowSignups', 'appFont', 'appIcon', 'appName', 'firstRun', 'uiPreset']);
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
    ws.on('message', (raw) => { clearTimeout(timer); try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
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
test('a write with no body is a clean no-op, not a 500', async () => {
  const chat = await browser('POST', '/api/chats', { body: {} });
  assert.equal(chat.status, 200);

  const bodyless = [
    ['PATCH', '/api/me'],
    ['PUT', '/api/me/styles'],
    ['PUT', '/api/me/personas'],
    ['PUT', '/api/me/prompts'],
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
  assert.equal(back.json.apiKey.length, 500, 'capped at the boundary');
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

test('uploads are served defensively and misses are honest', async () => {
  const missing = await request('GET', '/uploads/does-not-exist.html', { cookie });
  assert.equal(missing.status, 404, 'a missing upload is not the app HTML with a 200');
  assert.match(missing.headers['content-type'] || '', /json/);

  const uploadsDir = path.join(SERVER_ROOT, 'data', 'databases', DB_NAME, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, 'probe.html'), '<script>alert(1)</script>');
  fs.writeFileSync(path.join(uploadsDir, 'probe.png'), 'not really a png');

  const page = await request('GET', '/uploads/probe.html', { cookie });
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-disposition'], 'attachment', 'html downloads, it does not become a live document');
  assert.match(page.headers['content-security-policy'] || '', /default-src 'none'/);
  assert.match(page.headers['content-security-policy'] || '', /sandbox/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');

  const img = await request('GET', '/uploads/probe.png', { cookie });
  assert.equal(img.status, 200);
  assert.equal(img.headers['content-disposition'], undefined, 'images still render in place');
});

test('uploads need a session, except the icon the sign-in screen shows', async () => {
  const uploadsDir = path.join(SERVER_ROOT, 'data', 'databases', DB_NAME, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, 'attachment.png'), 'someone else’s file');
  fs.writeFileSync(path.join(uploadsDir, 'brand.png'), 'the app icon');

  // Attachments are other people's conversations. Knowing the URL is not authorisation,
  // and 404 rather than 401 so a signed-out caller cannot even confirm the file exists.
  const anon = await request('GET', '/uploads/attachment.png');
  assert.equal(anon.status, 404);
  assert.equal((await request('GET', '/uploads/attachment.png', { cookie })).status, 200, 'a member still sees it');

  // The sign-in screen shows the app icon to someone who by definition has no session.
  assert.equal((await request('GET', '/uploads/brand.png')).status, 404, 'not public until it is the icon');
  const set = await browser('PATCH', '/api/admin/app-config', { body: { appIcon: '/uploads/brand.png' } });
  assert.equal(set.status, 200);
  assert.equal((await request('GET', '/uploads/brand.png')).status, 200, 'now the login screen can load it');
  assert.equal((await request('GET', '/uploads/attachment.png')).status, 404, 'and only that one file');

  // the exemption follows the setting rather than being latched on first use
  await browser('PATCH', '/api/admin/app-config', { body: { appIcon: '' } });
  assert.equal((await request('GET', '/uploads/brand.png')).status, 404, 'unset the icon and it is private again');
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
  assert.equal((await request('GET', '/api/release/icon')).status, 401);

  const rel = await browser('GET', '/api/release');
  assert.equal(rel.status, 200);
  assert.equal(typeof rel.json.version, 'string');
  assert.equal(typeof rel.json.codename, 'string');
  assert.equal(typeof rel.json.notes, 'string');
  assert.equal(typeof rel.json.hasIcon, 'boolean');

  // the notes are the reason this moved off /api/app-config, which every page load fetches
  const cfg = await browser('GET', '/api/app-config');
  assert.equal(cfg.status, 200);
  assert.ok(!('uiVersionDesc' in cfg.json), 'release notes no longer ride along on every config fetch');
  assert.ok(!('uiVersionIcon' in cfg.json), 'nor does the icon path');

  const icon = await browser('GET', '/api/release/icon');
  assert.equal(icon.status, rel.json.hasIcon ? 200 : 404);
  if (rel.json.hasIcon) {
    assert.match(icon.headers['content-type'] || '', /^image\//, 'served as an image');
    assert.equal(icon.headers['x-content-type-options'], 'nosniff');
  }
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

  assert.equal((await browser('POST', `/api/tasks/${id}/run`)).status, 200);
  assert.equal((await browser('DELETE', `/api/tasks/${id}`)).status, 200);
  assert.equal((await browser('GET', '/api/tasks')).json.tasks.length, 0);
  assert.equal((await browser('PATCH', '/api/tasks/nope', { body: {} })).status, 404, 'an unknown id is a miss, not a crash');
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
