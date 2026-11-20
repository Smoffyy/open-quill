import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const SERVER_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB_NAME = 'oqheadertest';
const DB_DIR = path.join(SERVER_ROOT, 'data', 'databases', DB_NAME);
const SECRET = 'header-test-secret-0123456789abcdef-0123';
const SETUP_TOKEN = 'header-setup-token';
let PORT = 0;
let ORIGIN = '';
let child = null;
let ownerCookie = '';

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

function request(method, pathname, { headers = {}, body, localAddress } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const all = { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', ...headers, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: pathname, headers: all, localAddress }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const proxied = (email, extra = {}) => ({ 'X-Forwarded-Email': email, 'X-OpenQuill-Proxy-Secret': SECRET, ...extra });
const tokenOf = (res) => (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).find(c => c.startsWith('token='));

function opens(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Origin: ORIGIN, ...headers } });
    const done = (ok) => { try { ws.terminate(); } catch {} resolve(ok); };
    ws.on('open', () => done(true));
    ws.on('unexpected-response', () => done(false));
    ws.on('error', () => done(false));
  });
}

before(async () => {
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  PORT = await freePort();
  ORIGIN = `http://127.0.0.1:${PORT}`;
  child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env, OPEN_QUILL_DB: DB_NAME, PORT: String(PORT), HOST: '127.0.0.1', OPEN_QUILL_SETUP_TOKEN: SETUP_TOKEN,
      TRUSTED_HEADER_AUTH: 'on', TRUSTED_HEADER_PROXIES: '127.0.0.1', TRUSTED_HEADER_SECRET: SECRET,
      TRUSTED_HEADER_EMAIL: 'X-Forwarded-Email', TRUSTED_HEADER_NAME: 'X-Forwarded-User', TRUSTED_HEADER_GROUPS: 'X-Forwarded-Groups',
      TRUSTED_HEADER_PROVISION: 'user', TRUSTED_HEADER_LINK: 'off'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + log)), 30000);
    const watch = (buf) => { log += buf; if (log.includes('running on')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
  });
  const owner = await request('POST', '/api/auth/register', { body: { email: 'owner@header.test', password: 'header-owner-password', setupToken: SETUP_TOKEN } });
  assert.equal(owner.status, 200);
  ownerCookie = tokenOf(owner);
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise(r => { child.once('exit', r); });
    child.kill();
    await Promise.race([gone, new Promise(r => { setTimeout(r, 5000); })]);
  }
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('a trusted proxy signs people in by header, and nothing else can', async () => {
  assert.equal((await request('GET', '/api/me', { headers: { 'X-Forwarded-Email': 'ann@header.test' } })).status, 401, 'no secret, no sign-in');
  assert.equal((await request('GET', '/api/me', { headers: proxied('ann@header.test', { 'X-OpenQuill-Proxy-Secret': SECRET.slice(0, -1) + 'x' }) })).status, 401, 'a wrong secret is ignored');
  const fromElsewhere = await request('GET', '/api/me', { headers: proxied('ann@header.test'), localAddress: '127.0.0.2' });
  assert.equal(fromElsewhere.status, 401, 'the right secret from an untrusted peer is ignored');

  const first = await request('GET', '/api/me', { headers: proxied('Ann@Header.test', { 'X-Forwarded-User': 'Ann', 'X-Forwarded-Groups': 'Ops, Research' }) });
  assert.equal(first.status, 200);
  assert.equal(first.json.user.email, 'ann@header.test');
  assert.equal(first.json.user.role, 'user', 'provisioned as the environment says');
  assert.equal(first.json.user.gate, null);
  const token = tokenOf(first);
  assert.ok(token);

  assert.equal((await request('GET', '/api/me', { headers: { Cookie: token } })).status, 401, 'the cookie is bound to the header');
  assert.equal((await request('GET', '/api/me', { headers: { Cookie: token, ...proxied('ann@header.test') } })).json.user.email, 'ann@header.test');
  const other = await request('GET', '/api/me', { headers: { Cookie: token, ...proxied('bob@header.test') } });
  assert.equal(other.json.user.email, 'bob@header.test', 'the header decides, not a cookie for someone else');

  assert.equal((await request('GET', '/api/me', { headers: proxied('owner@header.test') })).status, 401, 'an existing account is not taken over without linking turned on');

  assert.equal(await opens({ Cookie: token }), false, 'the socket refuses the cookie alone');
  assert.equal(await opens({ Cookie: token, ...proxied('ann@header.test') }), true);

  const groups = (await request('GET', '/api/admin/groups', { headers: { Cookie: ownerCookie } })).json.groups.filter(g => g.source === 'header');
  assert.deepEqual(groups.map(g => g.name).sort(), ['Ops', 'Research'], 'the groups header becomes directory groups');
  const refused = (await request('GET', '/api/admin/audit?action=auth.header_refused', { headers: { Cookie: ownerCookie } })).json;
  assert.ok(JSON.stringify(refused).includes('auth.header_refused'), 'refused attempts are recorded');
});