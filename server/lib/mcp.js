import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db, getSetting, setSetting, uid } from '../db.js';
import { RAW_ARGS } from '../tools/args.js';
import { lineNames } from './secrets.js';

const PROTOCOL_VERSION = '2025-06-18';
const CALL_TIMEOUT = 30000;
const INIT_TIMEOUT = 15000;
const NOTIFY_TIMEOUT = 5000;
const RESULT_CAP = 60000;
const IMAGE_CAP = 4;
const IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = /^image\/(png|jpeg|gif|webp)$/i;
const TOOL_CAP = 100;
const LIST_CAP = 50;
const RESOURCE_SUFFIX = '__resource';
const PAGE_CAP = 10;
const LIST_CHANGED_DELAY = 500;
export const USER_SERVER_LIMIT = 10;
const STDIO_BUF_MAX = 32 * 1024 * 1024;
const PRIVATE_ENV = ['DB_ENCRYPTION_KEY'];
const CLIENT_INFO = { name: 'open-quill', version: '1.0.0' };
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'server';
}

// A server belongs either to the workspace (userId null, admin-managed) or to one user.
// Both stores hold the same shape and share every transport path below; what differs is
// where the list lives and what a user is allowed to configure.
export function list(userId = null) {
  const raw = userId ? (db.users.byId(userId) || {}).mcp_servers : getSetting('mcp_servers', []);
  return Array.isArray(raw) ? raw : [];
}
function save(arr, userId = null) {
  if (userId) db.users.update(userId, { mcp_servers: arr });
  else setSetting('mcp_servers', arr);
}
export function getEnabled(userId = null) {
  const workspace = list().filter(s => s.enabled);
  if (!userId) return workspace;
  return [...workspace, ...list(userId).filter(s => s.enabled)];
}
export function byId(id, userId = null) { return list(userId).find(s => s.id === id) || null; }

function parseHeaders(raw) {
  const out = {};
  for (const line of String(raw || '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function parseEnv(raw) {
  const out = {};
  for (const line of String(raw || '').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i <= 0) continue;
    const key = s.slice(0, i).trim();
    let value = s.slice(i + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
    if (ENV_KEY.test(key)) out[key] = value;
  }
  return out;
}

export function splitArgs(raw) {
  const text = String(raw || '').trim();
  if (text.startsWith('[')) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr) && arr.every(a => typeof a === 'string' || typeof a === 'number')) return arr.map(String);
    } catch {}
  }
  const out = [];
  let cur = '';
  let quote = '';
  let open = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
    } else if (ch === '"' || (ch === "'" && !cur && !open)) {
      quote = ch;
      open = true;
    } else if (/\s/.test(ch)) {
      if (cur || open) out.push(cur);
      cur = '';
      open = false;
    } else cur += ch;
  }
  if (cur || open) out.push(cur);
  return out;
}

function envValue(env, name) {
  const key = Object.keys(env).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? env[key] : '';
}

// npx, uvx and most MCP launchers are .cmd shims on Windows, which spawn cannot run
// without a shell; a bare "npx" therefore failed with ENOENT on every Windows host.
export function resolveCommand(command, env = process.env, platform = process.platform) {
  if (platform !== 'win32') return { file: command, shell: false };
  const exts = (envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase());
  const named = path.extname(command) ? [command] : exts.map(e => command + e);
  const dirs = /[\\/]/.test(command) ? [''] : envValue(env, 'PATH').split(';').filter(Boolean);
  for (const dir of dirs) {
    for (const name of named) {
      const full = dir ? path.join(dir, name) : name;
      try {
        if (fs.statSync(full).isFile()) return { file: full, shell: /\.(cmd|bat)$/i.test(full) };
      } catch {}
    }
  }
  return { file: command, shell: false };
}

export function shellQuote(arg) {
  const s = String(arg);
  if (s && /^[\w\-.,:/\\@=+]+$/.test(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function validate(b, existingId, userId = null) {
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) return { error: 'Server name is required.' };
  let slug = slugify(b.slug || name);
  // Tool names are mcp_<slug>_<tool>, and a user's servers share one namespace with the
  // workspace ones, so a collision across the two stores would hide a tool entirely.
  const taken = userId ? [...list(), ...list(userId)] : list();
  if (taken.some(s => s.slug === slug && s.id !== existingId)) slug = slug.slice(0, 20) + '_' + Math.random().toString(36).slice(2, 5);
  const transport = b.transport === 'http' ? 'http' : 'stdio';
  // stdio spawns a process on the host. That is an admin power, never a user one.
  if (userId && transport !== 'http') return { error: 'You can only add HTTP servers. Ask an admin to add a local command server.' };
  const out = {
    name, slug, transport,
    command: String(b.command || '').trim().slice(0, 500),
    args: String(b.args || '').trim().slice(0, 1000),
    env: userId ? '' : String(b.env || '').slice(0, 4000),
    url: String(b.url || '').trim().slice(0, 500),
    headers: String(b.headers || '').slice(0, 2000),
    enabled: b.enabled !== false
  };
  if (transport === 'stdio' && !out.command) return { error: 'A command is required for stdio servers.' };
  if (transport === 'http' && !/^https?:\/\//.test(out.url)) return { error: 'A valid http(s) URL is required for HTTP servers.' };
  return out;
}

export function create(b, userId = null) {
  if (userId && list(userId).length >= USER_SERVER_LIMIT) return { error: 'You have reached the connector limit.' };
  const v = validate(b, undefined, userId);
  if (v.error) return v;
  const server = { id: uid(), ...v, tools: [], status: 'new', error: '', created_at: Date.now() };
  save([...list(userId), server], userId);
  return { server };
}

// Header and environment values never reach the browser, so a form that was not
// touched sends them back empty or not at all. Only a string the caller actually
// sent replaces what is stored.
export function publicServer(s) {
  if (!s) return s;
  const { headers, env, ...rest } = s;
  return { ...rest, headers: '', env: '', headerNames: lineNames(headers, ':'), envNames: lineNames(env, '=') };
}

export function update(id, b, userId = null) {
  const cur = byId(id, userId);
  if (!cur) return { error: 'Server not found.' };
  const given = Object.fromEntries(Object.entries(b || {}).filter(([k, v]) => v !== undefined && !((k === 'headers' || k === 'env') && typeof v !== 'string')));
  const v = validate({ ...cur, ...given }, id, userId);
  if (v.error) return v;
  const moved = ['transport', 'command', 'args', 'env', 'url', 'headers'].some(k => (cur[k] || '') !== (v[k] || ''));
  const server = { ...cur, ...v, ...(moved ? { http_mode: '', status: 'new', error: '' } : {}) };
  save(list(userId).map(s => s.id === id ? server : s), userId);
  disconnect(id);
  return { server };
}

export function remove(id, userId = null) {
  if (userId && !byId(id, userId)) return { error: 'Server not found.' };
  disconnect(id);
  save(list(userId).filter(s => s.id !== id), userId);
  return { ok: true };
}

function patchServer(id, patch, userId = null) {
  save(list(userId).map(s => s.id === id ? { ...s, ...patch } : s), userId);
}

const stdioClients = new Map();
const httpSessions = new Map();
const sseClients = new Map();
const listTimers = new Map();

function killTree(proc, sync = false) {
  if (!proc || proc.exitCode != null) return;
  if (process.platform === 'win32' && proc.pid) {
    const args = ['/pid', String(proc.pid), '/T', '/F'];
    try {
      if (sync) spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
      else spawn('taskkill', args, { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    } catch {}
    return;
  }
  try { proc.kill(); } catch {}
}

function disconnect(id, sync = false) {
  const c = stdioClients.get(id);
  if (c) {
    killTree(c.proc, sync);
    stdioClients.delete(id);
  }
  const session = httpSessions.get(id);
  if (session?.sessionId && session.url && !sync) {
    fetch(session.url, { method: 'DELETE', headers: session.headers, signal: AbortSignal.timeout(NOTIFY_TIMEOUT) }).catch(() => {});
  }
  httpSessions.delete(id);
  const sse = sseClients.get(id);
  if (sse) {
    try { sse.client?.ctl.abort(); } catch {}
    sseClients.delete(id);
  }
}

function scheduleRefresh(id, userId) {
  clearTimeout(listTimers.get(id));
  const timer = setTimeout(() => { listTimers.delete(id); refreshTools(id, userId).catch(() => {}); }, LIST_CHANGED_DELAY);
  if (typeof timer.unref === 'function') timer.unref();
  listTimers.set(id, timer);
}

function answerServer(msg, write) {
  if (msg.method === 'ping') write({ jsonrpc: '2.0', id: msg.id, result: {} });
  else write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
}

function stdioClient(server) {
  const existing = stdioClients.get(server.id);
  if (existing && existing.proc.exitCode == null) return existing;
  stdioClients.delete(server.id);
  const env = { ...process.env, ...parseEnv(server.env) };
  for (const k of PRIVATE_ENV) delete env[k];
  const args = splitArgs(server.args);
  const run = resolveCommand(server.command, env);
  const proc = run.shell
    ? spawn([run.file, ...args].map(shellQuote).join(' '), { stdio: ['pipe', 'pipe', 'pipe'], env, shell: true, windowsHide: true })
    : spawn(run.file, args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
  const client = { proc, seq: 0, pending: new Map(), buf: '', ready: null, stderr: '' };
  const write = (obj) => { try { proc.stdin.write(JSON.stringify(obj) + '\n'); } catch {} };
  proc.stderr.on('data', (chunk) => { client.stderr = (client.stderr + chunk.toString('utf8')).slice(-4000); });
  proc.stdout.on('data', (chunk) => {
    client.buf += chunk.toString('utf8');
    if (client.buf.length > STDIO_BUF_MAX) {
      client.buf = '';
      fail(new Error('MCP server sent a message larger than the limit.'));
      killTree(proc);
      return;
    }
    let idx;
    while ((idx = client.buf.indexOf('\n')) !== -1) {
      const line = client.buf.slice(0, idx).trim();
      client.buf = client.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.method && msg.id != null) { answerServer(msg, write); continue; }
      if (msg.method === 'notifications/tools/list_changed') { scheduleRefresh(server.id, null); continue; }
      if (msg.id != null && client.pending.has(msg.id)) {
        const { resolve, reject, timer } = client.pending.get(msg.id);
        client.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message || 'MCP error'));
        else resolve(msg.result);
      }
    }
  });
  const fail = (err) => {
    for (const { reject, timer } of client.pending.values()) { clearTimeout(timer); reject(err); }
    client.pending.clear();
    if (stdioClients.get(server.id) === client) stdioClients.delete(server.id);
  };
  proc.stdin.on('error', () => {});
  proc.on('error', (e) => fail(new Error(e?.code === 'ENOENT'
    ? `Could not start the MCP server: "${server.command}" was not found. Install it, or give the full path to the program.`
    : `Could not start the MCP server: ${e?.message || e}`)));
  proc.on('exit', (code) => {
    const detail = client.stderr.trim().slice(-500);
    const missing = run.shell && /is not recognized as an internal or external command/i.test(detail);
    fail(new Error(missing
      ? `Could not start the MCP server: "${server.command}" was not found. Install it, or give the full path to the program.`
      : 'MCP server process exited' + (code != null ? ` (code ${code})` : '') + '.' + (detail ? ' ' + detail : '')));
  });
  client.write = write;
  stdioClients.set(server.id, client);
  return client;
}

function stdioRequest(client, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (client.proc.exitCode != null) { reject(new Error('MCP server process exited.')); return; }
    const id = ++client.seq;
    const timer = setTimeout(() => { client.pending.delete(id); reject(new Error(`MCP request timed out after ${Math.round(timeoutMs / 1000)}s.`)); }, timeoutMs);
    client.pending.set(id, { resolve, reject, timer });
    try { client.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n'); }
    catch (e) { client.pending.delete(id); clearTimeout(timer); reject(e); }
  });
}

async function stdioEnsureReady(server) {
  const client = stdioClient(server);
  if (!client.ready) {
    client.ready = (async () => {
      await stdioRequest(client, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, INIT_TIMEOUT);
      client.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
    })().catch(e => { client.ready = null; throw e; });
  }
  await client.ready;
  return client;
}

export function parseSse(text) {
  const events = [];
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    let event = 'message';
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return events;
}

export function pickResponse(text, contentType, id) {
  if ((contentType || '').includes('text/event-stream')) {
    const msgs = [];
    for (const e of parseSse(text)) { try { msgs.push(JSON.parse(e.data)); } catch {} }
    return msgs.find(m => m && m.id != null && String(m.id) === String(id) && !m.method)
      || msgs.find(m => m && m.error && m.id == null)
      || null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

function httpHeaders(server, session) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (session?.protocolVersion) headers['MCP-Protocol-Version'] = session.protocolVersion;
  if (session?.sessionId) headers['Mcp-Session-Id'] = session.sessionId;
  return { ...headers, ...parseHeaders(server.headers) };
}

function plainBody(text) {
  const raw = String(text || '').trim();
  const flat = /<html|<!doctype/i.test(raw) ? raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ') : raw;
  return flat.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function httpFailure(status, text) {
  const body = plainBody(text);
  const lead = status === 401 || status === 403
    ? 'The MCP server refused the credentials. Check the headers'
    : status === 404 ? 'Nothing answers MCP at this URL. Check the path (often /mcp or /sse)'
      : status === 405 ? 'This URL does not accept MCP requests'
        : 'The MCP server returned an error';
  return Object.assign(new Error(`MCP HTTP ${status}: ${lead}.${body ? ' ' + body : ''}`), { status });
}

let httpSeq = 0;

async function httpRequest(server, method, params, session, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const id = ++httpSeq;
  try {
    const res = await fetch(server.url, {
      method: 'POST', headers: httpHeaders(server, session), signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} })
    });
    const newSession = res.headers.get('mcp-session-id') || session?.sessionId || null;
    const text = await res.text();
    if (!res.ok) throw httpFailure(res.status, text);
    const msg = pickResponse(text, res.headers.get('content-type'), id);
    if (!msg) throw new Error('MCP server returned an unreadable response.');
    if (msg.error) throw Object.assign(new Error(msg.error.message || 'MCP error'), { rpc: true });
    return { result: msg.result, sessionId: newSession };
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`MCP request timed out after ${Math.round(timeoutMs / 1000)}s.`, { cause: e });
    throw e;
  } finally { clearTimeout(timer); }
}

async function httpNotify(server, method, session) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT);
  try {
    await fetch(server.url, { method: 'POST', headers: httpHeaders(server, session), signal: controller.signal, body: JSON.stringify({ jsonrpc: '2.0', method, params: {} }) });
  } catch {} finally { clearTimeout(timer); }
}

async function httpEnsureSession(server) {
  const cached = httpSessions.get(server.id);
  if (cached) return cached;
  const { result, sessionId } = await httpRequest(server, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, null, INIT_TIMEOUT);
  const negotiated = typeof result?.protocolVersion === 'string' && result.protocolVersion ? result.protocolVersion : PROTOCOL_VERSION;
  const session = { sessionId, protocolVersion: negotiated, url: server.url };
  session.headers = httpHeaders(server, session);
  await httpNotify(server, 'notifications/initialized', session);
  httpSessions.set(server.id, session);
  return session;
}

// The HTTP+SSE transport from protocol revision 2024-11-05: a long-lived GET stream that
// names a POST endpoint and carries every response. Superseded by streamable HTTP, but
// still what many hosted servers speak, so it is tried when streamable HTTP is refused.
async function sseOpen(server, userId) {
  const ctl = new AbortController();
  const client = { ctl, endpoint: '', pending: new Map(), seq: 0, closed: false };
  const fail = (err) => {
    client.closed = true;
    for (const { reject, timer } of client.pending.values()) { clearTimeout(timer); reject(err); }
    client.pending.clear();
    if (sseClients.get(server.id)?.client === client) sseClients.delete(server.id);
  };
  const timer = setTimeout(() => ctl.abort(), INIT_TIMEOUT);
  let res;
  try {
    res = await fetch(server.url, { headers: { Accept: 'text/event-stream', ...parseHeaders(server.headers) }, signal: ctl.signal });
  } catch (e) {
    clearTimeout(timer);
    throw e?.name === 'AbortError' ? new Error('MCP server did not open an event stream in time.') : e;
  }
  if (!res.ok) { clearTimeout(timer); throw httpFailure(res.status, await res.text().catch(() => '')); }
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) { clearTimeout(timer); ctl.abort(); throw new Error('MCP server did not answer with an event stream.'); }
  let found;
  const endpoint = new Promise((resolve) => { found = resolve; });
  (async () => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const cut = buf.lastIndexOf('\n\n');
        if (cut === -1) continue;
        const ready = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        for (const e of parseSse(ready)) {
          if (e.event === 'endpoint') {
            client.endpoint = new URL(e.data.trim(), server.url).href;
            found();
            continue;
          }
          let msg;
          try { msg = JSON.parse(e.data); } catch { continue; }
          if (msg.method && msg.id != null) {
            answerServer(msg, (reply) => { fetch(client.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...parseHeaders(server.headers) }, body: JSON.stringify(reply) }).catch(() => {}); });
          } else if (msg.method === 'notifications/tools/list_changed') scheduleRefresh(server.id, userId);
          else if (msg.id != null && client.pending.has(msg.id)) {
            const p = client.pending.get(msg.id);
            client.pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'));
            else p.resolve(msg.result);
          }
        }
      }
      fail(new Error('The MCP event stream closed.'));
    } catch (e) {
      fail(e?.name === 'AbortError' ? new Error('The MCP connection was closed.') : e);
    }
  })();
  await Promise.race([endpoint, new Promise((_, reject) => { ctl.signal.addEventListener('abort', () => reject(new Error('MCP server opened an event stream but never named its message endpoint.')), { once: true }); })]);
  clearTimeout(timer);
  return client;
}

function sseRequest(server, client, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (client.closed) { reject(new Error('The MCP connection was closed.')); return; }
    const id = ++client.seq;
    const timer = setTimeout(() => { client.pending.delete(id); reject(new Error(`MCP request timed out after ${Math.round(timeoutMs / 1000)}s.`)); }, timeoutMs);
    client.pending.set(id, { resolve, reject, timer });
    fetch(client.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...parseHeaders(server.headers) },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} })
    }).then(async (res) => {
      if (!res.ok) {
        const p = client.pending.get(id);
        if (p) { client.pending.delete(id); clearTimeout(p.timer); p.reject(httpFailure(res.status, await res.text().catch(() => ''))); }
      }
    }).catch((e) => {
      const p = client.pending.get(id);
      if (p) { client.pending.delete(id); clearTimeout(p.timer); p.reject(e); }
    });
  });
}

async function sseEnsureReady(server, userId) {
  const cur = sseClients.get(server.id);
  if (cur && !cur.client?.closed) return cur.ready;
  const entry = { client: null, ready: null };
  entry.ready = (async () => {
    const client = await sseOpen(server, userId);
    entry.client = client;
    await sseRequest(server, client, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: CLIENT_INFO }, INIT_TIMEOUT);
    fetch(client.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...parseHeaders(server.headers) }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).catch(() => {});
    return client;
  })();
  sseClients.set(server.id, entry);
  entry.ready.catch(() => {
    try { entry.client?.ctl.abort(); } catch {}
    if (sseClients.get(server.id) === entry) sseClients.delete(server.id);
  });
  return entry.ready;
}

function legacyUrl(url) {
  try { return /\/sse\/?$/.test(new URL(url).pathname); } catch { return false; }
}

export function guessUrls(url) {
  try {
    const u = new URL(url);
    if (u.pathname !== '/' && u.pathname !== '') return [];
    return ['/mcp', '/sse'].map(p => new URL(p, u).href);
  } catch { return []; }
}

async function discover(server, userId, err) {
  for (const url of guessUrls(server.url)) {
    const probe = { ...server, url, http_mode: '' };
    try {
      await refreshWith(probe, userId);
      disconnect(server.id);
      patchServer(server.id, { url, http_mode: '' }, userId);
      return true;
    } catch {
      disconnect(server.id);
    }
  }
  throw err;
}

async function rpc(server, method, params, timeoutMs = CALL_TIMEOUT, userId = null) {
  if (server.transport === 'stdio') {
    const client = await stdioEnsureReady(server);
    return stdioRequest(client, method, params, timeoutMs);
  }
  if (server.http_mode === 'sse' || legacyUrl(server.url)) {
    const client = await sseEnsureReady(server, userId);
    return sseRequest(server, client, method, params, timeoutMs);
  }
  const attempt = async () => {
    const session = await httpEnsureSession(server);
    return (await httpRequest(server, method, params, session, timeoutMs)).result;
  };
  try { return await attempt(); }
  catch (e) {
    if (e?.rpc) throw e;
    const expired = e?.status === 404 && httpSessions.get(server.id)?.sessionId;
    const fresh = !httpSessions.get(server.id);
    httpSessions.delete(server.id);
    if (fresh && (e?.status === 404 || e?.status === 405 || e?.status === 400)) {
      try {
        const client = await sseEnsureReady(server, userId);
        patchServer(server.id, { http_mode: 'sse' }, userId);
        return await sseRequest(server, client, method, params, timeoutMs);
      } catch { throw e; }
    }
    if (!expired) throw e;
  }
  try { return await attempt(); }
  catch (e) {
    httpSessions.delete(server.id);
    throw e;
  }
}

async function refreshWith(server, userId) {
  const all = [];
  let cursor;
  for (let page = 0; page < PAGE_CAP; page++) {
    const result = await rpc(server, 'tools/list', cursor ? { cursor } : {}, CALL_TIMEOUT, userId);
    if (Array.isArray(result?.tools)) all.push(...result.tools);
    cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
    if (!cursor || all.length >= TOOL_CAP) break;
  }
  return all;
}

async function listOptional(server, method, key, userId) {
  const all = [];
  let cursor;
  try {
    for (let page = 0; page < PAGE_CAP; page++) {
      const result = await rpc(server, method, cursor ? { cursor } : {}, CALL_TIMEOUT, userId);
      if (Array.isArray(result?.[key])) all.push(...result[key]);
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
      if (!cursor || all.length >= LIST_CAP) break;
    }
  } catch {}
  return all.slice(0, LIST_CAP);
}

const text = (v, cap) => String(v ?? '').slice(0, cap);

function shapeResources(list) {
  return list.map(r => ({ uri: text(r?.uri, 500), name: text(r?.name || r?.title || r?.uri, 120), description: text(r?.description, 300), mimeType: text(r?.mimeType, 80) })).filter(r => r.uri);
}

function shapePrompts(list) {
  return list.map(p => ({
    name: text(p?.name, 120), title: text(p?.title || p?.name, 120), description: text(p?.description, 400),
    arguments: (Array.isArray(p?.arguments) ? p.arguments : []).slice(0, 10).map(a => ({ name: text(a?.name, 60), description: text(a?.description, 200), required: !!a?.required })).filter(a => a.name)
  })).filter(p => p.name);
}

export async function refreshTools(id, userId = null) {
  const server = byId(id, userId);
  if (!server) return { error: 'Server not found.' };
  try {
    let all;
    try { all = await refreshWith(server, userId); }
    catch (e) {
      if (server.transport !== 'http' || e?.status !== 404 || !guessUrls(server.url).length) throw e;
      await discover(server, userId, e);
      all = await refreshWith(byId(id, userId), userId);
    }
    const tools = all.slice(0, TOOL_CAP).map(t => ({
      name: String(t?.name || '').slice(0, 80),
      description: String(t?.description || t?.annotations?.title || '').slice(0, 800),
      inputSchema: t?.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }
    })).filter(t => t.name);
    const live = byId(id, userId);
    const resources = shapeResources(await listOptional(live, 'resources/list', 'resources', userId));
    const prompts = shapePrompts(await listOptional(live, 'prompts/list', 'prompts', userId));
    patchServer(id, { tools, resources, prompts, status: 'connected', error: '', refreshed_at: Date.now() }, userId);
    return { server: byId(id, userId) };
  } catch (e) {
    patchServer(id, { status: 'error', error: String(e.message || e).slice(0, 400) }, userId);
    return { server: byId(id, userId), error: String(e.message || e) };
  }
}

const SCHEMA_KEEP = ['$defs', 'definitions', 'additionalProperties', 'description'];

function sanitizeSchema(schema) {
  const s = schema && typeof schema === 'object' ? schema : {};
  const out = {
    type: 'object',
    properties: s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties) ? s.properties : {},
    required: Array.isArray(s.required) ? s.required.filter(r => typeof r === 'string') : []
  };
  for (const k of SCHEMA_KEEP) if (s[k] !== undefined) out[k] = s[k];
  return out;
}

// Function names are capped at 64 characters and may only hold letters, digits, _ and -.
// Truncating alone let two long tool names on one server collapse into the same string,
// and a dot or space in an MCP tool name made the provider refuse the whole request. A
// short digest of the original name keeps every advertised name valid and distinct.
export const MCP_NAME_MAX = 64;

function digest(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).slice(0, 4).padStart(4, '0');
}

export function mcpToolName(slug, toolName) {
  const raw = String(toolName || '');
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '_');
  const full = `mcp_${slug}_${safe}`;
  if (safe === raw && full.length <= MCP_NAME_MAX) return full;
  return full.slice(0, MCP_NAME_MAX - 5) + '_' + digest(`mcp_${slug}_${raw}`);
}

export function resourceToolName(slug) {
  return `mcp_${slug}${RESOURCE_SUFFIX}`;
}

function resourceSchema(server) {
  const list = (server.resources || []).map(r => `- ${r.name} (${r.uri})${r.description ? ': ' + r.description : ''}`).join('\n');
  return {
    type: 'function',
    function: {
      name: resourceToolName(server.slug),
      description: `[MCP: ${server.name}] Read one of this server's resources by its URI. Available resources:\n${list}`.slice(0, 2000),
      parameters: { type: 'object', properties: { uri: { type: 'string', description: 'The URI of the resource to read.' } }, required: ['uri'] }
    }
  };
}

export function toolSchemas(userId = null) {
  const out = [];
  for (const server of getEnabled(userId)) {
    if ((server.resources || []).length) out.push(resourceSchema(server));
    for (const t of (server.tools || [])) {
      out.push({
        type: 'function',
        function: {
          name: mcpToolName(server.slug, t.name),
          description: `[MCP: ${server.name}] ${t.description || ''}`.slice(0, 1000),
          parameters: sanitizeSchema(t.inputSchema)
        }
      });
    }
  }
  return out;
}

export function isMcpTool(name, userId = null) { return typeof name === 'string' && name.startsWith('mcp_') && !!resolveTool(name, userId); }

function resolveTool(name, userId = null) {
  for (const server of getEnabled(userId)) {
    if (name === resourceToolName(server.slug) && (server.resources || []).length) return { server, resource: true };
    const prefix = `mcp_${server.slug}_`;
    if (name.startsWith(prefix)) {
      const toolName = name.slice(prefix.length);
      // Matched through the same builder the schema used, so a name that had to be
      // shortened still resolves. The bare-name fallback covers a model that
      // answers with the tool's own name rather than the prefixed one.
      const t = (server.tools || []).find(x => mcpToolName(server.slug, x.name) === name || x.name === toolName);
      if (t) return { server, tool: t };
    }
  }
  return null;
}

export function toolsText(userId = null) {
  return getEnabled(userId)
    .filter(s => (s.tools || []).length)
    .map(s => `- ${s.name}: ${[...(s.tools || []).map(t => mcpToolName(s.slug, t.name)), ...((s.resources || []).length ? [resourceToolName(s.slug)] : [])].join(', ')}`)
    .join('\n');
}

function contentText(c) {
  if (!c || typeof c !== 'object') return '';
  if (c.type === 'text') return String(c.text || '');
  if (c.type === 'resource') return c.resource?.text ? String(c.resource.text) : `[resource ${c.resource?.uri || ''}]`.trim();
  if (c.type === 'resource_link') return `[${c.name || 'link'}: ${c.uri || ''}]`;
  if (c.type === 'image' || c.type === 'audio') return `[${c.type} content${c.mimeType ? ', ' + c.mimeType : ''}]`;
  return c.type ? `[${c.type} content]` : '';
}

export function imagesOf(content) {
  const out = [];
  for (const c of Array.isArray(content) ? content : []) {
    const mime = c?.type === 'image' ? c.mimeType : c?.type === 'resource' && c.resource?.blob ? c.resource.mimeType : '';
    const data = c?.type === 'image' ? c.data : c?.resource?.blob;
    if (!IMAGE_MIME.test(String(mime || '')) || typeof data !== 'string' || !data || data.length > IMAGE_BYTES) continue;
    out.push({ mime: String(mime).toLowerCase(), data });
    if (out.length >= IMAGE_CAP) break;
  }
  return out;
}

export function callArguments(call) {
  if (call && call[RAW_ARGS] && typeof call[RAW_ARGS] === 'object') return { ...call[RAW_ARGS] };
  const args = { ...call };
  delete args.tool;
  return args;
}

export async function execTool(call, userId = null) {
  const resolved = resolveTool(call.tool, userId);
  if (!resolved) return { ok: false, tool: call.tool, error: 'Unknown MCP tool.' };
  const { server, tool } = resolved;
  if (resolved.resource) return readResource(server, callArguments(call).uri, call.tool, userId);
  try {
    const result = await rpc(server, 'tools/call', { name: tool.name, arguments: callArguments(call) }, CALL_TIMEOUT, userId);
    let text = '';
    if (Array.isArray(result?.content)) text = result.content.map(contentText).filter(Boolean).join('\n');
    if (!text && result?.structuredContent !== undefined) text = JSON.stringify(result.structuredContent, null, 2);
    else if (!text && result != null && !Array.isArray(result?.content)) text = JSON.stringify(result);
    if (text.length > RESULT_CAP) text = text.slice(0, RESULT_CAP) + '\n... [truncated]';
    if (result?.isError) return { ok: false, tool: call.tool, server: server.name, error: text || 'The MCP tool reported an error.' };
    const images = imagesOf(result?.content);
    return { ok: true, tool: call.tool, server: server.name, content: text || '(empty result)', ...(images.length ? { images } : {}) };
  } catch (e) {
    return { ok: false, tool: call.tool, server: server.name, error: String(e.message || e).slice(0, 500) };
  }
}

async function readResource(server, uri, toolName, userId) {
  if (typeof uri !== 'string' || !uri) return { ok: false, tool: toolName, server: server.name, error: 'A resource uri is required.' };
  try {
    const result = await rpc(server, 'resources/read', { uri }, CALL_TIMEOUT, userId);
    const contents = Array.isArray(result?.contents) ? result.contents : [];
    let body = contents.map(c => (typeof c?.text === 'string' ? c.text : c?.blob ? `[${c.mimeType || 'binary'} content]` : '')).filter(Boolean).join('\n');
    if (body.length > RESULT_CAP) body = body.slice(0, RESULT_CAP) + '\n... [truncated]';
    const images = imagesOf(contents.map(c => ({ type: 'resource', resource: c })));
    return { ok: true, tool: toolName, server: server.name, content: body || '(empty resource)', ...(images.length ? { images } : {}) };
  } catch (e) {
    return { ok: false, tool: toolName, server: server.name, error: String(e.message || e).slice(0, 500) };
  }
}

export function listPrompts(userId = null) {
  return getEnabled(userId).flatMap(s => (s.prompts || []).map(p => ({ serverId: s.id, server: s.name, ...p })));
}

export async function getPrompt(serverId, name, args, userId = null) {
  const server = getEnabled(userId).find(s => s.id === serverId);
  const prompt = server && (server.prompts || []).find(p => p.name === name);
  if (!prompt) return { error: 'Prompt not found.' };
  const values = {};
  for (const a of prompt.arguments) {
    const v = typeof args?.[a.name] === 'string' ? args[a.name].slice(0, 4000) : '';
    if (a.required && !v.trim()) return { error: `"${a.name}" is required.` };
    if (v) values[a.name] = v;
  }
  try {
    const result = await rpc(server, 'prompts/get', { name, arguments: values }, CALL_TIMEOUT, userId);
    const parts = (Array.isArray(result?.messages) ? result.messages : []).map(m => {
      const c = m?.content;
      if (Array.isArray(c)) return c.map(contentText).filter(Boolean).join('\n');
      return contentText(c);
    }).filter(Boolean);
    return { text: parts.join('\n\n').slice(0, 40000) };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 400) };
  }
}

export function formatResult(call, r) {
  if (!r.ok) return `${call.tool} → ERROR: ${r.error}`;
  return `${call.tool} →\n${r.content}`;
}

export function resultPayload(call, r) {
  const o = { ok: !!r.ok, server: r.server || '' };
  if (r.error) o.error = r.error;
  if (r.ok) o.chars = (r.content || '').length;
  if (r.images?.length) o.images = r.images.length;
  return o;
}

// Tool messages carry text only on every protocol, so images a tool returned go to the
// model as one message straight after that step's results. Without image input the
// text placeholders stay, and nothing is sent.
export function imageMessage(found, vision) {
  if (!vision || !found.length) return null;
  return {
    role: 'user',
    content: [
      { type: 'text', text: 'Images returned by the tool calls above, in order: ' + found.map(f => f.tool).join(', ') + '.' },
      ...found.map(f => ({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.data}` } }))
    ]
  };
}

export function shutdown() {
  for (const t of listTimers.values()) clearTimeout(t);
  listTimers.clear();
  for (const id of new Set([...stdioClients.keys(), ...sseClients.keys()])) disconnect(id, true);
  httpSessions.clear();
}
