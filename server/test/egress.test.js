import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB_DIR = path.join(SERVER_ROOT, 'data', 'databases', 'oqegresstest');

process.env.OPEN_QUILL_DB = 'oqegresstest';
fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const { setSetting, closeDb } = await import('../db.js');
const { installEgressGuard, connectLookup } = await import('../lib/egress.js');

let server, base, hits = [];

before(async () => {
  installEgressGuard();
  setSetting('egress_local_only', '1');
  setSetting('egress_allowlist', '[]');
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      hits.push({ url: req.url, method: req.method, auth: req.headers.authorization || '', body, host: req.headers.host });
      const port = server.address().port;
      if (req.url === '/to-public') { res.writeHead(302, { location: 'http://8.8.8.8:9/' }); return res.end(); }
      if (req.url === '/to-local') { res.writeHead(307, { location: '/final' }); return res.end(); }
      if (req.url === '/see-other') { res.writeHead(303, { location: '/final' }); return res.end(); }
      if (req.url === '/cross') { res.writeHead(302, { location: `http://localhost:${port}/final` }); return res.end(); }
      if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
  });
  await new Promise(r => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => { server.close(r); });
  closeDb();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('a redirect to a public address is refused before it connects', async () => {
  await assert.rejects(fetch(base + '/to-public'), e => e.code === 'EGRESS_BLOCKED' && e.host === '8.8.8.8');
});

test('a redirect within the private network is followed and keeps the body on 307', async () => {
  hits = [];
  const res = await fetch(base + '/to-local', { method: 'POST', body: 'payload' });
  assert.equal(await res.text(), 'ok');
  assert.deepEqual(hits.map(h => [h.url, h.method, h.body]), [['/to-local', 'POST', 'payload'], ['/final', 'POST', 'payload']]);
});

test('303 turns a POST into a GET without a body', async () => {
  hits = [];
  await (await fetch(base + '/see-other', { method: 'POST', body: 'payload' })).text();
  assert.deepEqual(hits.map(h => [h.url, h.method, h.body]), [['/see-other', 'POST', 'payload'], ['/final', 'GET', '']]);
});

test('credentials are dropped when a redirect changes origin', async () => {
  hits = [];
  await (await fetch(base + '/cross', { headers: { authorization: 'Bearer secret' } })).text();
  assert.equal(hits[0].auth, 'Bearer secret');
  assert.equal(hits[1].auth, '');
  assert.match(hits[1].host, /^localhost:/);
});

test('a redirect loop stops', async () => {
  await assert.rejects(fetch(base + '/loop'), /too many redirects/);
});

test('manual redirects are handed back to the caller untouched', async () => {
  const res = await fetch(base + '/to-public', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'http://8.8.8.8:9/');
});

test('the connect-time lookup passes private names and answers in the shape asked for', async () => {
  const one = await new Promise((resolve, reject) => { connectLookup('localhost', {}, (e, address, family) => (e ? reject(e) : resolve({ address, family }))); });
  assert.ok(one.address && one.family);
  const all = await new Promise((resolve, reject) => { connectLookup('localhost', { all: true }, (e, list) => (e ? reject(e) : resolve(list))); });
  assert.ok(Array.isArray(all) && all.length);
});