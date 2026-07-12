import { spawn } from 'child_process';
import { getSetting, setSetting, uid } from './db.js';

const PROTOCOL_VERSION = '2024-11-05';
const CALL_TIMEOUT = 30000;
const INIT_TIMEOUT = 15000;
const RESULT_CAP = 60000;

export function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'server';
}

export function list() {
  const raw = getSetting('mcp_servers', []);
  return Array.isArray(raw) ? raw : [];
}
function save(arr) { setSetting('mcp_servers', arr); }
export function getEnabled() { return list().filter(s => s.enabled); }
export function byId(id) { return list().find(s => s.id === id) || null; }

function parseHeaders(raw) {
  const out = {};
  for (const line of String(raw || '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function validate(b, existingId) {
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) return { error: 'Server name is required.' };
  let slug = slugify(b.slug || name);
  if (list().some(s => s.slug === slug && s.id !== existingId)) slug = slug.slice(0, 20) + '_' + Math.random().toString(36).slice(2, 5);
  const transport = b.transport === 'http' ? 'http' : 'stdio';
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

export function create(b) {
  const v = validate(b);
  if (v.error) return v;
  const server = { id: uid(), ...v, tools: [], status: 'new', error: '', created_at: Date.now() };
  save([...list(), server]);
  return { server };
}

export function update(id, b) {
  const cur = byId(id);
  if (!cur) return { error: 'Server not found.' };
  const v = validate({ ...cur, ...b }, id);
  if (v.error) return v;
  const server = { ...cur, ...v };
  save(list().map(s => s.id === id ? server : s));
  disconnect(id);
  return { server };
}

export function remove(id) {
  disconnect(id);
  save(list().filter(s => s.id !== id));
  return { ok: true };
}

function patchServer(id, patch) {
  save(list().map(s => s.id === id ? { ...s, ...patch } : s));
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
  const client = { proc, seq: 0, pending: new Map(), buf: '', ready: null };
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
  proc.on('error', () => {});
  proc.on('exit', () => {
    for (const { reject, timer } of client.pending.values()) { clearTimeout(timer); reject(new Error('MCP server process exited.')); }
    client.pending.clear();
    if (stdioClients.get(server.id) === client) stdioClients.delete(server.id);
  });
  stdioClients.set(server.id, client);
  return client;
}

function stdioRequest(client, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (client.proc.exitCode != null) return reject(new Error('MCP server process exited.'));
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

async function httpRequest(server, method, params, sessionId, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...parseHeaders(server.headers)
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const res = await fetch(server.url, {
      method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + Math.floor(Math.random() * 1000), method, params: params || {} })
    });
    const newSession = res.headers.get('mcp-session-id') || sessionId || null;
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
    const msg = parseHttpBody(text, res.headers.get('content-type'));
    if (!msg) throw new Error('MCP server returned an unreadable response.');
    if (msg.error) throw new Error(msg.error.message || 'MCP error');
    return { result: msg.result, sessionId: newSession };
  } finally { clearTimeout(timer); }
}

async function httpNotify(server, method, sessionId) {
  try {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...parseHeaders(server.headers) };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    await fetch(server.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method, params: {} }) });
  } catch {}
}

async function httpEnsureSession(server) {
  const cached = httpSessions.get(server.id);
  if (cached) return cached;
  const { result, sessionId } = await httpRequest(server, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'open-quill', version: '1.0.0' }
  }, null, INIT_TIMEOUT);
  void result;
  await httpNotify(server, 'notifications/initialized', sessionId);
  const session = { sessionId };
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
    const { result } = await httpRequest(server, method, params, session.sessionId, timeoutMs);
    return result;
  } catch (e) {
    httpSessions.delete(server.id);
    throw e;
  }
}

export async function refreshTools(id) {
  const server = byId(id);
  if (!server) return { error: 'Server not found.' };
  try {
    const result = await rpc(server, 'tools/list', {});
    const tools = (Array.isArray(result?.tools) ? result.tools : []).slice(0, 60).map(t => ({
      name: String(t.name || '').slice(0, 80),
      description: String(t.description || '').slice(0, 800),
      inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }
    })).filter(t => t.name);
    patchServer(id, { tools, status: 'connected', error: '', refreshed_at: Date.now() });
    return { server: byId(id) };
  } catch (e) {
    patchServer(id, { status: 'error', error: String(e.message || e).slice(0, 400) });
    return { server: byId(id), error: String(e.message || e) };
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

export function toolSchemas() {
  const out = [];
  for (const server of getEnabled()) {
    for (const t of (server.tools || [])) {
      out.push({
        type: 'function',
        function: {
          name: `mcp_${server.slug}_${t.name}`.slice(0, 64),
          description: `[MCP: ${server.name}] ${t.description || ''}`.slice(0, 1000),
          parameters: sanitizeSchema(t.inputSchema)
        }
      });
    }
  }
  return out;
}

export function isMcpTool(name) { return typeof name === 'string' && name.startsWith('mcp_') && !!resolveTool(name); }

function resolveTool(name) {
  for (const server of getEnabled()) {
    const prefix = `mcp_${server.slug}_`;
    if (name.startsWith(prefix)) {
      const toolName = name.slice(prefix.length);
      const t = (server.tools || []).find(x => `mcp_${server.slug}_${x.name}`.slice(0, 64) === name || x.name === toolName);
      if (t) return { server, tool: t };
    }
  }
  return null;
}

export function promptFor() {
  const servers = getEnabled().filter(s => (s.tools || []).length);
  if (!servers.length) return '';
  let p = '## MCP Connectors\nExternal tools are available through MCP servers connected by the admin. Their names are prefixed with `mcp_`. Call them like any other function when they fit the task.\n';
  for (const s of servers) p += `\n${s.name}: ${(s.tools || []).map(t => `mcp_${s.slug}_${t.name}`).join(', ')}`;
  return p;
}

export async function execTool(call) {
  const resolved = resolveTool(call.tool);
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
