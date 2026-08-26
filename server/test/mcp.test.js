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
// file gets its own process. Removed here, not in `after`: the connection stays open for
// the life of the process and Windows will not unlink a held file.
process.env.OPEN_QUILL_DB = 'oqmcptest';
fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const { db, uid, setSetting } = await import('../db.js');
const { installEgressGuard } = await import('../lib/egress.js');
const mcp = await import('../mcp.js');

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
  assert.match(mcp.promptFor(), new RegExp(`Fixture ok: mcp_${sv.slug}_echo`));

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

  assert.equal(seen.filter(r => r.method === 'initialize').length, 1, 'initialize runs once, not per call');
  assert.ok(seen.every(r => r.auth === 'Bearer fixture-token'), 'every request carries the configured header');
  // Required from revision 2025-06-18 on, and it must be the version the server
  // negotiated rather than the one this client asked for.
  assert.equal(seen[0].protocol, null, 'initialize has nothing to echo yet');
  assert.ok(seen.slice(1).every(r => r.protocol === '2025-06-18' && r.session), JSON.stringify(seen));
  mcp.remove(sv.id);
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
