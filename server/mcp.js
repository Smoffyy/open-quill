import { spawn } from 'child_process';
import { db, getSetting, setSetting, uid } from './db.js';

const PROTOCOL_VERSION = '2025-06-18';
const CALL_TIMEOUT = 30000;
const INIT_TIMEOUT = 15000;
const NOTIFY_TIMEOUT = 5000;
const RESULT_CAP = 60000;
export const USER_SERVER_LIMIT = 10;

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

export function update(id, b, userId = null) {
  const cur = byId(id, userId);
  if (!cur) return { error: 'Server not found.' };
  const v = validate({ ...cur, ...b }, id, userId);
  if (v.error) return v;
  const server = { ...cur, ...v };
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

function disconnect(id) {
  const c = stdioClients.get(id);
  if (c) {
    try { c.proc.kill(); } catch {}
    stdioClients.delete(id);
  }
  httpSessions.delete(id);
}

function stdioClient(server) {
  const existing = stdioClients.get(server.id);
  if (existing && existing.proc.exitCode == null) return existing;
  stdioClients.delete(server.id);
  const args = server.args ? server.args.split(/\s+/).filter(Boolean) : [];
  const proc = spawn(server.command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  const client = { proc, seq: 0, pending: new Map(), buf: '', ready: null, stderr: '' };
  proc.stderr.on('data', (chunk) => { client.stderr = (client.stderr + chunk.toString('utf8')).slice(-4000); });
  proc.stdout.on('data', (chunk) => {
    client.buf += chunk.toString('utf8');
    let idx;
    while ((idx = client.buf.indexOf('\n')) !== -1) {
      const line = client.buf.slice(0, idx).trim();
      client.buf = client.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
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
    ? `Could not start the MCP server: "${server.command}" was not found.`
    : `Could not start the MCP server: ${e?.message || e}`)));
  proc.on('exit', () => {
    const detail = client.stderr.trim().slice(-500);
    fail(new Error('MCP server process exited.' + (detail ? ' ' + detail : '')));
  });
  stdioClients.set(server.id, client);
  return client;
}

function stdioRequest(client, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (client.proc.exitCode != null) { reject(new Error('MCP server process exited.')); return; }
    const id = ++client.seq;
    const timer = setTimeout(() => { client.pending.delete(id); reject(new Error('MCP request timed out.')); }, timeoutMs);
    client.pending.set(id, { resolve, reject, timer });
    try { client.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n'); }
    catch (e) { client.pending.delete(id); clearTimeout(timer); reject(e); }
  });
}

function stdioNotify(client, method, params) {
  try { client.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n'); } catch {}
}

async function stdioEnsureReady(server) {
  const client = stdioClient(server);
  if (!client.ready) {
    client.ready = (async () => {
      await stdioRequest(client, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'open-quill', version: '1.0.0' }
      }, INIT_TIMEOUT);
      stdioNotify(client, 'notifications/initialized');
    })().catch(e => { client.ready = null; throw e; });
  }
  await client.ready;
  return client;
}

const httpSessions = new Map();

function parseHttpBody(text, contentType) {
  if ((contentType || '').includes('text/event-stream')) {
    const events = [];
    for (const block of text.split(/\n\n/)) {
      const dataLines = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim());
      if (!dataLines.length) continue;
      try { events.push(JSON.parse(dataLines.join('\n'))); } catch {}
    }
    return events.find(e => e && e.id != null) || events[events.length - 1] || null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

function httpHeaders(server, session) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (session?.protocolVersion) headers['MCP-Protocol-Version'] = session.protocolVersion;
  if (session?.sessionId) headers['Mcp-Session-Id'] = session.sessionId;
  return { ...headers, ...parseHeaders(server.headers) };
}

async function httpRequest(server, method, params, session, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(server.url, {
      method: 'POST', headers: httpHeaders(server, session), signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.floor(Math.random() * 1000), method, params: params || {} })
    });
    const newSession = res.headers.get('mcp-session-id') || session?.sessionId || null;
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
    const msg = parseHttpBody(text, res.headers.get('content-type'));
    if (!msg) throw new Error('MCP server returned an unreadable response.');
    if (msg.error) throw new Error(msg.error.message || 'MCP error');
    return { result: msg.result, sessionId: newSession };
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('MCP request timed out.', { cause: e });
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
  const { result, sessionId } = await httpRequest(server, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'open-quill', version: '1.0.0' }
  }, null, INIT_TIMEOUT);
  const negotiated = typeof result?.protocolVersion === 'string' && result.protocolVersion ? result.protocolVersion : PROTOCOL_VERSION;
  const session = { sessionId, protocolVersion: negotiated };
  await httpNotify(server, 'notifications/initialized', session);
  httpSessions.set(server.id, session);
  return session;
}

async function rpc(server, method, params, timeoutMs = CALL_TIMEOUT) {
  if (server.transport === 'stdio') {
    const client = await stdioEnsureReady(server);
    return stdioRequest(client, method, params, timeoutMs);
  }
  try {
    const session = await httpEnsureSession(server);
    const { result } = await httpRequest(server, method, params, session, timeoutMs);
    return result;
  } catch (e) {
    httpSessions.delete(server.id);
    throw e;
  }
}

export async function refreshTools(id, userId = null) {
  const server = byId(id, userId);
  if (!server) return { error: 'Server not found.' };
  try {
    const result = await rpc(server, 'tools/list', {});
    const tools = (Array.isArray(result?.tools) ? result.tools : []).slice(0, 60).map(t => ({
      name: String(t.name || '').slice(0, 80),
      description: String(t.description || '').slice(0, 800),
      inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }
    })).filter(t => t.name);
    patchServer(id, { tools, status: 'connected', error: '', refreshed_at: Date.now() }, userId);
    return { server: byId(id, userId) };
  } catch (e) {
    patchServer(id, { status: 'error', error: String(e.message || e).slice(0, 400) }, userId);
    return { server: byId(id, userId), error: String(e.message || e) };
  }
}

function sanitizeSchema(schema) {
  const s = schema && typeof schema === 'object' ? schema : {};
  return {
    type: 'object',
    properties: s.properties && typeof s.properties === 'object' ? s.properties : {},
    required: Array.isArray(s.required) ? s.required : []
  };
}

// Function names are capped at 64 characters. Truncating alone let two long tool
// names on one server collapse into the same string: the model was handed two
// identical function names and every call resolved to whichever came first, so
// the other tool was silently unreachable. A short digest of the full name keeps
// them distinct within the cap.
export const MCP_NAME_MAX = 64;

function digest(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).slice(0, 4).padStart(4, '0');
}

export function mcpToolName(slug, toolName) {
  const full = `mcp_${slug}_${toolName}`;
  if (full.length <= MCP_NAME_MAX) return full;
  return full.slice(0, MCP_NAME_MAX - 5) + '_' + digest(full);
}

export function toolSchemas(userId = null) {
  const out = [];
  for (const server of getEnabled(userId)) {
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

export function promptFor(userId = null) {
  const servers = getEnabled(userId).filter(s => (s.tools || []).length);
  if (!servers.length) return '';
  let p = '## MCP Connectors\nExternal tools are available through MCP servers connected by the admin. Their names are prefixed with `mcp_`. Call them like any other function when they fit the task.\n';
  // Through the same builder as the schema: the prompt used to spell out the full
  // name while the schema carried a shortened one, so the model was told to call
  // something that did not exist.
  for (const s of servers) p += `\n${s.name}: ${(s.tools || []).map(t => mcpToolName(s.slug, t.name)).join(', ')}`;
  return p;
}

export async function execTool(call, userId = null) {
  const resolved = resolveTool(call.tool, userId);
  if (!resolved) return { ok: false, tool: call.tool, error: 'Unknown MCP tool.' };
  const { server, tool } = resolved;
  const args = { ...call };
  delete args.tool;
  try {
    const result = await rpc(server, 'tools/call', { name: tool.name, arguments: args });
    let text = '';
    if (Array.isArray(result?.content)) {
      text = result.content.map(c => {
        if (c?.type === 'text') return String(c.text || '');
        if (c?.type === 'resource' && c.resource?.text) return String(c.resource.text);
        return c?.type ? `[${c.type} content]` : '';
      }).filter(Boolean).join('\n');
    } else if (result != null) {
      text = JSON.stringify(result);
    }
    if (text.length > RESULT_CAP) text = text.slice(0, RESULT_CAP) + '\n... [truncated]';
    if (result?.isError) return { ok: false, tool: call.tool, server: server.name, error: text || 'The MCP tool reported an error.' };
    return { ok: true, tool: call.tool, server: server.name, content: text || '(empty result)' };
  } catch (e) {
    return { ok: false, tool: call.tool, server: server.name, error: String(e.message || e).slice(0, 500) };
  }
}

export function formatResult(call, r) {
  if (!r.ok) return `${call.tool} \u2192 ERROR: ${r.error}`;
  return `${call.tool} \u2192\n${r.content}`;
}

export function resultPayload(call, r) {
  const o = { ok: !!r.ok, server: r.server || '' };
  if (r.error) o.error = r.error;
  if (r.ok) o.chars = (r.content || '').length;
  return o;
}

export function shutdown() {
  for (const id of [...stdioClients.keys()]) disconnect(id);
}
