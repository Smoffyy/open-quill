// MCP connector tests against a real stdio pipe and a real HTTP socket, running the
// shipped client. They hold two regressions: a mistyped stdio command used to wait out the
// 15s initialize timeout and blame a "timeout", and `notifications/initialized` had no
// timeout at all, so a silent HTTP server hung the connect request forever.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB_DIR = path.join(SERVER_ROOT, 'data', 'databases', 'oqmcptest');

// Kept in a temp file, not under test/: `node --test` runs every script in a directory
// named test, and this one blocks on stdin. MODE picks the failure to reproduce.
const FIXTURE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oq-mcp-')), 'stdio.mjs');
fs.writeFileSync(FIXTURE, String.raw`
const M = process.argv[2] || '', out = o => process.stdout.write(JSON.stringify(o) + '\n');
const die = (m, c) => { process.stderr.write(m + '\n'); process.exit(c); };
const tool = (name, extra) => ({ name, description: name, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, ...extra } });
const TOOLS = [tool('echo', { required: ['text'] }), tool('boom'), tool('big'), tool('x'.repeat(70))];
const RESULT = { boom: { content: [{ type: 'text', text: 'tool failed on purpose' }], isError: true }, big: { content: [{ type: 'text', text: 'x'.repeat(120000) }] } };
let buf = '';
process.stdin.on('data', c => {
  buf += c;
  for (let i; (i = buf.indexOf('\n')) !== -1;) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.method === 'initialize') {
      if (M === 'noinit') die('cannot start: missing API key', 2);
      out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} } } });
    } else if (m.method === 'tools/list') out({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
    else if (m.method === 'tools/call') {
      if (M === 'crash') die('fatal: upstream connection lost', 1);
      out({ jsonrpc: '2.0', id: m.id, result: RESULT[m.params.name] || { content: [{ type: 'text', text: 'echo:' + JSON.stringify(m.params.arguments || {}) }] } });
    } else if (!m.method.startsWith('notifications/')) out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
  }
});
`);

// Set before the graph that opens the database loads, so these never touch real data; each
process.env.OPEN_QUILL_DB = 'oqmcptest';
fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const { db, uid, setSetting, closeDb } = await import('../db.js');
const { installEgressGuard } = await import('../lib/egress.js');
const mcp = await import('../lib/mcp.js');

const NODE = process.execPath;
const TOKEN = 'Authorization: Bearer fixture-token';
let httpServer, httpPort, seen = [];
// Flipped on to swallow `notifications/initialized`, the shape that used to hang connect.
let mute = false;

function startHttp() {
  const sessions = new Set();
  httpServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.method === 'DELETE') {
        seen.push({ method: 'DELETE', session: req.headers['mcp-session-id'] || null });
        res.writeHead(200);
        res.end();
        return;
      }
      const m = JSON.parse(body || '{}');
      seen.push({ method: m.method, protocol: req.headers['mcp-protocol-version'] || null, session: req.headers['mcp-session-id'] || null, auth: req.headers.authorization || null });
      const send = (payload, sid) => {
        res.writeHead(200, { 'Content-Type': 'application/json', ...(sid ? { 'Mcp-Session-Id': sid } : {}) });
        res.end(JSON.stringify(payload));
      };
      const reply = (result) => send({ jsonrpc: '2.0', id: m.id, ...result });
      if (req.headers.authorization !== 'Bearer fixture-token') { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
      if (m.method === 'initialize') {
        const sid = 'sess-' + (sessions.size + 1);
        sessions.add(sid);
        return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }, sid);
      }
      if (m.method.startsWith('notifications/')) { if (!mute) { res.writeHead(202); res.end(); } return; }
      if (m.method === 'tools/list') return reply({ result: { tools: [{ name: 'ping', description: 'pong', inputSchema: { type: 'object', properties: {} } }, { name: 'fail', description: 'errors', inputSchema: { type: 'object', properties: {} } }] } });
      if (m.method === 'tools/call') {
        if (m.params.name === 'fail') return reply({ error: { code: -32000, message: 'the remote tool refused' } });
        return reply({ result: { content: [{ type: 'text', text: 'pong:' + JSON.stringify(m.params.arguments || {}) }] } });
      }
      reply({ error: { code: -32601, message: 'Method not found' } });
    });
  });
  return new Promise(r => { httpServer.listen(0, '127.0.0.1', () => { httpPort = httpServer.address().port; r(); }); });
}

const stdio = (mode = '') => mcp.create({ name: 'Fixture ' + (mode || 'ok'), transport: 'stdio', command: NODE, args: FIXTURE + (mode ? ' ' + mode : '') }).server;
const remote = (name, headers, userId) => mcp.create({ name, transport: 'http', url: `http://127.0.0.1:${httpPort}/mcp`, headers }, userId);
const user = (email) => { const id = uid(); db.users.insert({ id, email, created_at: Date.now() }); return id; };

before(async () => {
  // The guard the real entry point installs; without it the public-url test below would
  // only be measuring whether DNS happened to resolve.
  installEgressGuard();
  await startHttp();
  setSetting('mcp_servers', []);
  setSetting('egress_local_only', '1');
});

after(async () => {
  mcp.shutdown();
  await new Promise(r => { httpServer.close(r); });
  fs.rmSync(path.dirname(FIXTURE), { recursive: true, force: true });
  closeDb();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('a server is validated before anything is spawned', () => {
  assert.equal(mcp.create({ transport: 'stdio', command: NODE }).error, 'Server name is required.');
  assert.equal(mcp.create({ name: 'x', transport: 'stdio' }).error, 'A command is required for stdio servers.');
  assert.equal(mcp.create({ name: 'x', transport: 'http', url: 'ftp://host/mcp' }).error, 'A valid http(s) URL is required for HTTP servers.');
});

test('slugs are derived, capped and kept unique', () => {
  assert.equal(mcp.slugify('My Cool Server!'), 'my_cool_server');
  assert.equal(mcp.slugify('---'), 'server');
  assert.ok(mcp.slugify('a'.repeat(90)).length <= 24);
  const a = stdio(), b = stdio();
  assert.notEqual(a.slug, b.slug);
  mcp.remove(a.id);
  mcp.remove(b.id);
});

test('a stdio server connects, advertises its tools and runs them', async () => {
  const sv = stdio();
  const refreshed = await mcp.refreshTools(sv.id);
  assert.equal(refreshed.error, undefined, String(refreshed.error));
  assert.equal(refreshed.server.status, 'connected');

  const names = mcp.toolSchemas().map(s => s.function.name);
  assert.ok(names.includes(`mcp_${sv.slug}_echo`), names.join(','));
  // Advertised names are capped at 64 characters, so a long one must still resolve back
  // or the model is handed a name it cannot call.
  assert.ok(names.every(n => n.length <= 64));
  for (const n of names) assert.equal(mcp.isMcpTool(n), true, `${n} is advertised but does not resolve`);
  const echo = mcp.toolSchemas().find(s => s.function.name === `mcp_${sv.slug}_echo`);
  assert.deepEqual(echo.function.parameters.required, ['text']);
  assert.match(echo.function.description, /^\[MCP: Fixture ok\]/);
  assert.match(mcp.toolsText(), new RegExp(`Fixture ok: mcp_${sv.slug}_echo`));

  const ok = await mcp.execTool({ tool: `mcp_${sv.slug}_echo`, text: 'hi' });
  assert.equal(ok.ok, true, ok.error);
  // `tool` is this app's routing key, not one of the server's arguments.
  assert.equal(ok.content, 'echo:{"text":"hi"}');
  assert.deepEqual(Object.keys(mcp.resultPayload({}, ok)).sort(), ['chars', 'ok', 'server']);

  const failed = await mcp.execTool({ tool: `mcp_${sv.slug}_boom` });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'tool failed on purpose');
  assert.match(mcp.formatResult({ tool: 'boom' }, failed), /ERROR: tool failed on purpose/);

  const big = await mcp.execTool({ tool: `mcp_${sv.slug}_big` });
  assert.ok(big.content.length < 61000 && big.content.endsWith('... [truncated]'), 'length ' + big.content.length);

  const unknown = await mcp.execTool({ tool: `mcp_${sv.slug}_nope` });
  assert.equal(unknown.error, 'Unknown MCP tool.');

  mcp.update(sv.id, { enabled: false });
  assert.equal(mcp.toolSchemas().some(s => s.function.name.startsWith(`mcp_${sv.slug}_`)), false);
  assert.equal(mcp.isMcpTool(`mcp_${sv.slug}_echo`), false);
  mcp.remove(sv.id);
});

test('a stdio server that cannot start or dies says so, fast', async () => {
  // spawn reports ENOENT through 'error' and never emits 'exit'. Swallowing that left
  // every request to wait out the 15s initialize timeout for what is really a typo.
  const missing = mcp.create({ name: 'Missing', transport: 'stdio', command: 'oq-not-a-real-binary-xyz' }).server;
  let started = Date.now();
  assert.match((await mcp.refreshTools(missing.id)).server.error, /was not found/);
  assert.ok(Date.now() - started < 5000, 'took ' + (Date.now() - started) + 'ms');
  mcp.remove(missing.id);

  const noinit = stdio('noinit');
  assert.match((await mcp.refreshTools(noinit.id)).server.error, /exited.*missing API key/is);
  mcp.remove(noinit.id);

  const crash = stdio('crash');
  await mcp.refreshTools(crash.id);
  started = Date.now();
  const out = await mcp.execTool({ tool: `mcp_${crash.slug}_echo`, text: 'x' });
  assert.equal(out.ok, false);
  assert.match(out.error, /exited/i);
  assert.ok(Date.now() - started < 5000, 'took ' + (Date.now() - started) + 'ms');
  mcp.remove(crash.id);
});

test('an http server connects with its configured headers and reuses the session', async () => {
  seen = [];
  const sv = remote('Fixture Http', TOKEN).server;
  const refreshed = await mcp.refreshTools(sv.id);
  assert.equal(refreshed.error, undefined, String(refreshed.error));
  assert.deepEqual(refreshed.server.tools.map(t => t.name).sort(), ['fail', 'ping']);

  const ok = await mcp.execTool({ tool: `mcp_${sv.slug}_ping`, note: 'hello' });
  assert.equal(ok.content, 'pong:{"note":"hello"}');
  const failed = await mcp.execTool({ tool: `mcp_${sv.slug}_fail` });
  assert.equal(failed.error, 'the remote tool refused');

  assert.equal((await mcp.execTool({ tool: `mcp_${sv.slug}_ping` })).ok, true, 'a tool error does not cost the session');
  assert.equal(seen.filter(r => r.method === 'initialize').length, 1, 'initialize runs once, not per call');
  assert.ok(seen.every(r => r.auth === 'Bearer fixture-token'), 'every request carries the configured header');
  // Required from revision 2025-06-18 on, and it must be the version the server
  // negotiated rather than the one this client asked for.
  assert.equal(seen[0].protocol, null, 'initialize has nothing to echo yet');
  assert.ok(seen.slice(1).every(r => r.protocol === '2025-06-18' && r.session), JSON.stringify(seen));
  const session = seen[1].session;
  mcp.remove(sv.id);
  await new Promise(r => { setTimeout(r, 100); });
  assert.deepEqual(seen.filter(r => r.method === 'DELETE').map(r => r.session), [session], 'removing a server ends its session');
});

test('a rejected header and a public url are both refused with a reason', async () => {
  const bad = remote('Bad Header', 'Authorization: Bearer wrong').server;
  assert.match((await mcp.refreshTools(bad.id)).server.error, /401/);
  mcp.remove(bad.id);

  const public_ = mcp.create({ name: 'Remote', transport: 'http', url: 'https://mcp.example.com/mcp' }).server;
  assert.match((await mcp.refreshTools(public_.id)).server.error, /Blocked outbound/);
  mcp.remove(public_.id);
});

test('a server that never answers the initialized notification still connects', async () => {
  mute = true;
  const sv = remote('Silent', TOKEN).server;
  const started = Date.now();
  try {
    const refreshed = await mcp.refreshTools(sv.id);
    assert.equal(refreshed.server.status, 'connected', String(refreshed.error));
    const ms = Date.now() - started;
    assert.ok(ms >= 4000, 'the notification really did go unanswered (' + ms + 'ms)');
    assert.ok(ms < 20000, 'connecting is bounded by the notification timeout (' + ms + 'ms)');
  } finally {
    mute = false;
    mcp.remove(sv.id);
  }
});

// A user's own connectors sit beside the workspace ones in one tool namespace, but a user
// may only point at an HTTP endpoint: stdio would let anyone run a command on the host.
test('a user may only add an http server', () => {
  const u = user('stdio@test.local');
  assert.match(mcp.create({ name: 'Sneaky', transport: 'stdio', command: NODE, args: FIXTURE }, u).error, /only add HTTP servers/);
  assert.equal(mcp.list(u).length, 0);
});

test('a user server is private to its owner and merges with the workspace ones', async () => {
  const alice = user('alice@test.local'), bob = user('bob@test.local');
  const shared = stdio();
  await mcp.refreshTools(shared.id);
  const own = remote('Alice Http', TOKEN, alice).server;
  assert.equal((await mcp.refreshTools(own.id, alice)).server.status, 'connected');

  assert.equal(mcp.list(alice).length, 1);
  assert.equal(mcp.list(bob).length, 0);
  assert.equal(mcp.list().some(x => x.id === own.id), false, 'a user server never joins the workspace list');

  const hers = mcp.toolSchemas(alice).map(x => x.function.name);
  assert.ok(hers.includes(`mcp_${own.slug}_ping`), hers.join(','));
  assert.ok(hers.includes(`mcp_${shared.slug}_echo`), 'workspace tools still reach her');
  for (const scope of [bob, null]) {
    assert.equal(mcp.toolSchemas(scope).some(x => x.function.name.startsWith(`mcp_${own.slug}_`)), false);
  }
  assert.equal(mcp.isMcpTool(`mcp_${own.slug}_ping`, alice), true);
  assert.equal(mcp.isMcpTool(`mcp_${own.slug}_ping`, bob), false);

  assert.equal((await mcp.execTool({ tool: `mcp_${own.slug}_ping`, note: 'mine' }, alice)).ok, true);
  assert.equal((await mcp.execTool({ tool: `mcp_${own.slug}_ping` }, bob)).error, 'Unknown MCP tool.');

  mcp.remove(shared.id);
  mcp.remove(own.id, alice);
});

test('a user cannot touch another user or the workspace through the user api', async () => {
  const alice = user('owner@test.local'), mallory = user('mallory@test.local');
  const workspace = stdio();
  const own = remote('Owned', '', alice).server;

  assert.match(mcp.update(own.id, { name: 'Taken' }, mallory).error, /not found/i);
  assert.match(mcp.remove(own.id, mallory).error, /not found/i);
  assert.match(mcp.update(workspace.id, { name: 'Taken' }, alice).error, /not found/i);
  assert.match((await mcp.refreshTools(workspace.id, alice)).error, /not found/i);
  assert.equal(mcp.byId(own.id, alice).name, 'Owned');
  assert.equal(mcp.list().some(x => x.id === workspace.id), true);

  mcp.remove(workspace.id);
  mcp.remove(own.id, alice);
});

test('a user slug never collides with a workspace slug', () => {
  const u = user('slug@test.local');
  const workspace = remote('Shared Name').server;
  const own = remote('Shared Name', '', u).server;
  assert.notEqual(own.slug, workspace.slug);
  mcp.remove(workspace.id);
  mcp.remove(own.id, u);
});

test('a user cannot add more servers than the limit', () => {
  const u = user('limit@test.local');
  for (let i = 0; i < mcp.USER_SERVER_LIMIT; i++) assert.equal(remote('Server ' + i, '', u).error, undefined);
  assert.match(remote('One too many', '', u).error, /limit/i);
  assert.equal(mcp.list(u).length, mcp.USER_SERVER_LIMIT);
});

const RICH = path.join(path.dirname(FIXTURE), 'rich.mjs');
fs.writeFileSync(RICH, String.raw`
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
const schema = { type: 'object', properties: { file: { $ref: '#/$defs/path' } }, $defs: { path: { type: 'string' } }, required: ['file'] };
const tool = (name, inputSchema) => ({ name, description: name, inputSchema: inputSchema || { type: 'object', properties: {} } });
let added = false;
const waiting = new Map();
let buf = '';
process.stdin.on('data', c => {
  buf += c;
  for (let i; (i = buf.indexOf('\n')) !== -1;) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (!m.method && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); continue; }
    if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: { listChanged: true } } } });
    else if (m.method === 'tools/list') {
      const page = m.params && m.params.cursor === 'p2'
        ? { tools: [tool('structured'), tool('argv'), tool('env'), ...(added ? [tool('added')] : [])] }
        : { tools: [tool('files.read', schema), tool('echo_raw')], nextCursor: 'p2' };
      out({ jsonrpc: '2.0', id: m.id, result: page });
    } else if (m.method === 'tools/call') {
      const reply = (result) => {
        out({ jsonrpc: '2.0', id: m.id, result });
        if (!added) { added = true; out({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }); }
      };
      const name = m.params.name;
      if (name === 'files.read') {
        waiting.set('srv-1', (r) => reply({ content: [{ type: 'text', text: r.result ? 'pinged back' : 'ping failed' }] }));
        out({ jsonrpc: '2.0', id: 'srv-1', method: 'ping' });
      } else if (name === 'structured') reply({ content: [], structuredContent: { temp: 21 } });
      else if (name === 'argv') reply({ content: [{ type: 'text', text: JSON.stringify(process.argv.slice(2)) }] });
      else if (name === 'env') reply({ content: [{ type: 'text', text: String(process.env.OQ_FIXTURE_VALUE) + '|' + String(process.env.DB_ENCRYPTION_KEY) }] });
      else reply({ content: [{ type: 'text', text: JSON.stringify(m.params.arguments || {}) }] });
    } else if (!m.method.startsWith('notifications/')) out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
  }
});
`);

const richServer = (extra = {}) => mcp.create({ name: 'Rich', transport: 'stdio', command: NODE, args: `"${RICH}" "two words" plain`, ...extra }).server;

test('arguments, environment lines and Windows commands are read the way people write them', () => {
  assert.deepEqual(mcp.splitArgs(`-y "C:\\My Docs" 'single quoted' x"y z" ""`), ['-y', 'C:\\My Docs', 'single quoted', 'xy z', '']);
  assert.deepEqual(mcp.splitArgs(`O'Brien it's`), ["O'Brien", "it's"], 'an apostrophe inside a word is not a quote');
  assert.deepEqual(mcp.splitArgs('["a b", "c"]'), ['a b', 'c']);
  assert.deepEqual(mcp.parseEnv('A=1\n# note\n bad line\nB="two words"\n1X=no\nC=x=y'), { A: '1', B: 'two words', C: 'x=y' });
  assert.equal(mcp.shellQuote('plain-arg'), 'plain-arg');
  assert.equal(mcp.shellQuote('two words'), '"two words"');
  assert.equal(mcp.shellQuote('say "x"'), '"say ""x"""');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-path-'));
  fs.writeFileSync(path.join(dir, 'npx.cmd'), '');
  fs.writeFileSync(path.join(dir, 'uvx.exe'), '');
  const env = { Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.deepEqual(mcp.resolveCommand('npx', env, 'win32'), { file: path.join(dir, 'npx.cmd'), shell: true }, 'a .cmd shim runs through the shell');
  assert.deepEqual(mcp.resolveCommand('uvx', env, 'win32'), { file: path.join(dir, 'uvx.exe'), shell: false });
  assert.deepEqual(mcp.resolveCommand('missing', env, 'win32'), { file: 'missing', shell: false });
  assert.deepEqual(mcp.resolveCommand('npx', env, 'linux'), { file: 'npx', shell: false });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an event stream answer is matched to the request that asked for it', () => {
  const sse = [
    'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
    'event: message\ndata: {"jsonrpc":"2.0","id":7,"method":"sampling/createMessage","params":{}}',
    'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"ok":true}}'
  ].join('\n\n') + '\n\n';
  assert.deepEqual(mcp.pickResponse(sse, 'text/event-stream', 3), { jsonrpc: '2.0', id: 3, result: { ok: true } });
  assert.equal(mcp.pickResponse(sse, 'text/event-stream', 9), null);
  assert.deepEqual(mcp.guessUrls('http://h:1'), ['http://h:1/mcp', 'http://h:1/sse']);
  assert.deepEqual(mcp.guessUrls('http://h:1/custom'), []);
});

test('a richer stdio server: paging, odd names, server pings, structured results and live tool changes', async () => {
  const sv = richServer({ env: 'OQ_FIXTURE_VALUE=from config' });
  try {
    const refreshed = await mcp.refreshTools(sv.id);
    assert.equal(refreshed.error, undefined, String(refreshed.error));
    assert.deepEqual(refreshed.server.tools.map(t => t.name), ['files.read', 'echo_raw', 'structured', 'argv', 'env'], 'every page of tools is read');

    const schemas = mcp.toolSchemas().filter(s => s.function.name.startsWith(`mcp_${sv.slug}_`));
    assert.ok(schemas.every(s => /^[A-Za-z0-9_-]{1,64}$/.test(s.function.name)), 'every advertised name is one a provider accepts');
    const read = schemas.find(s => s.function.description.includes('files.read'));
    assert.deepEqual(read.function.parameters.$defs, { path: { type: 'string' } }, 'a $ref keeps what it points at');
    assert.equal(mcp.isMcpTool(read.function.name), true);

    const pinged = await mcp.execTool({ tool: read.function.name, file: 'a.txt' });
    assert.equal(pinged.content, 'pinged back', 'a ping from the server is answered mid-call');

    const { toCall } = await import('../tools/args.js');
    const raw = await mcp.execTool(toCall(`mcp_${sv.slug}_echo_raw`, '{"tool":"hammer","n":2}'));
    assert.equal(raw.content, '{"tool":"hammer","n":2}', 'an argument named tool reaches the server');

    assert.equal((await mcp.execTool({ tool: `mcp_${sv.slug}_structured` })).content, '{\n  "temp": 21\n}');
    assert.equal((await mcp.execTool({ tool: `mcp_${sv.slug}_argv` })).content, '["two words","plain"]', 'a quoted argument stays whole');
    assert.equal((await mcp.execTool({ tool: `mcp_${sv.slug}_env` })).content, 'from config|undefined', 'configured env arrives and the database key does not');

    const deadline = Date.now() + 5000;
    while (!mcp.byId(sv.id).tools.some(t => t.name === 'added') && Date.now() < deadline) await new Promise(r => { setTimeout(r, 50); });
    assert.ok(mcp.byId(sv.id).tools.some(t => t.name === 'added'), 'a tools/list_changed notification refreshes the list');
  } finally {
    mcp.remove(sv.id);
  }
});

test('renaming keeps a connection, changing how it connects resets it', async () => {
  const sv = richServer();
  try {
    assert.equal((await mcp.refreshTools(sv.id)).server.status, 'connected');
    mcp.update(sv.id, { name: 'Renamed' });
    assert.equal(mcp.byId(sv.id).status, 'connected');
    mcp.update(sv.id, { args: `"${RICH}"` });
    assert.equal(mcp.byId(sv.id).status, 'new');
  } finally {
    mcp.remove(sv.id);
  }
});

test('a Windows .cmd launcher found on PATH starts', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-shim-'));
  fs.writeFileSync(path.join(dir, 'oq-fake-mcp.cmd'), `@echo off\r\n"${NODE}" "${RICH}" %*\r\n`);
  const sv = mcp.create({ name: 'Shim', transport: 'stdio', command: 'oq-fake-mcp', args: '"with space"', env: `PATH=${dir};${process.env.PATH}` }).server;
  try {
    const refreshed = await mcp.refreshTools(sv.id);
    assert.equal(refreshed.error, undefined, String(refreshed.error));
    assert.equal((await mcp.execTool({ tool: `mcp_${sv.slug}_argv` })).content, '["with space"]');
  } finally {
    mcp.remove(sv.id);
    await new Promise(r => { setTimeout(r, 300); });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('a legacy SSE server is found from its bare address and works', async () => {
  const streams = new Set();
  let stream = null;
  const legacy = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('event: endpoint\ndata: /messages?sessionId=abc\n\n');
      stream = res;
      streams.add(res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/messages') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        res.writeHead(202);
        res.end('Accepted');
        const m = JSON.parse(body);
        if (m.id == null) return;
        const result = m.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} } }
          : m.method === 'tools/list' ? { tools: [{ name: 'legacy_echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }
            : { content: [{ type: 'text', text: 'legacy:' + JSON.stringify(m.params.arguments) }] };
        stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`);
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html><html><head><title>Error</title></head><body><pre>Cannot POST ' + url.pathname + '</pre></body></html>');
  });
  const port = await new Promise(r => { legacy.listen(0, '127.0.0.1', () => r(legacy.address().port)); });
  const sv = mcp.create({ name: 'Legacy', transport: 'http', url: `http://127.0.0.1:${port}` }).server;
  const wrong = mcp.create({ name: 'Wrong path', transport: 'http', url: `http://127.0.0.1:${port}/nothing` }).server;
  try {
    const refreshed = await mcp.refreshTools(sv.id);
    assert.equal(refreshed.error, undefined, String(refreshed.error));
    assert.equal(mcp.byId(sv.id).url, `http://127.0.0.1:${port}/sse`, 'the working address is saved');
    assert.deepEqual(refreshed.server.tools.map(t => t.name), ['legacy_echo']);
    assert.equal((await mcp.execTool({ tool: `mcp_${sv.slug}_legacy_echo`, text: 'hi' })).content, 'legacy:{"text":"hi"}');

    const failed = await mcp.refreshTools(wrong.id);
    assert.match(failed.server.error, /^MCP HTTP 404: Nothing answers MCP at this URL/);
    assert.doesNotMatch(failed.server.error, /<|DOCTYPE/, 'an HTML error page is reduced to its text');
  } finally {
    mcp.remove(sv.id);
    mcp.remove(wrong.id);
    for (const s of streams) s.destroy();
    legacy.closeAllConnections?.();
    await new Promise(r => { legacy.close(r); });
  }
});