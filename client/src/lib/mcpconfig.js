const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function joinArgs(list) {
  const args = (Array.isArray(list) ? list : []).map(String);
  if (args.some(a => a.includes('"'))) return JSON.stringify(args);
  return args.map(a => (a === '' || /\s|'/.test(a) ? '"' + a + '"' : a)).join(' ');
}

export function nameFrom(key, entry) {
  if (key) return String(key);
  const pkg = (Array.isArray(entry?.args) ? entry.args : []).find(a => /^@?[\w.-]+\/[\w.-]+|^[\w.-]+-mcp|^mcp-/.test(String(a)));
  if (pkg) return String(pkg).split('/').pop().replace(/@[\w.-]+$/, '').replace(/^((server|mcp)-)+/, '').replace(/(-(server|mcp))+$/, '') || 'server';
  try { if (entry?.url) return new URL(entry.url).hostname.split('.')[0]; } catch {}
  return 'server';
}

const lines = (obj, sep) => (isObj(obj) ? Object.entries(obj).map(([k, v]) => k + sep + String(v ?? '')).join('\n') : '');

export function serverFrom(key, entry) {
  if (!isObj(entry)) return null;
  const url = entry.url || entry.serverUrl || entry.httpUrl || '';
  const name = String(entry.name || nameFrom(key, entry)).slice(0, 60);
  if (url) {
    return { name, transport: 'http', url: String(url), headers: lines(entry.headers, ': '), command: '', args: '', env: '', enabled: entry.disabled !== true };
  }
  if (!entry.command) return null;
  let command = String(entry.command);
  let args = Array.isArray(entry.args) ? entry.args.map(String) : (typeof entry.args === 'string' ? entry.args.split(/\s+/).filter(Boolean) : []);
  if (/^cmd(\.exe)?$/i.test(command) && /^\/c$/i.test(args[0] || '') && args[1]) {
    command = args[1];
    args = args.slice(2);
  }
  return { name, transport: 'stdio', command, args: joinArgs(args), env: lines(entry.env, '='), url: '', headers: '', enabled: entry.disabled !== true };
}

export function parseMcpConfig(text) {
  const raw = String(text || '').trim();
  if (!raw) return { servers: [], error: '' };
  let json;
  try { json = JSON.parse(raw.startsWith('"') ? '{' + raw + '}' : raw); }
  catch { return { servers: [], error: 'not-json' }; }
  if (!isObj(json)) return { servers: [], error: 'no-servers' };
  const map = isObj(json.mcpServers) ? json.mcpServers
    : isObj(json.servers) ? json.servers
      : isObj(json.mcp?.servers) ? json.mcp.servers
        : null;
  let servers;
  if (map) servers = Object.entries(map).map(([k, v]) => serverFrom(k, v));
  else if (json.command || json.url || json.serverUrl) servers = [serverFrom('', json)];
  else servers = Object.entries(json).map(([k, v]) => serverFrom(k, v));
  servers = servers.filter(Boolean);
  return { servers, error: servers.length ? '' : 'no-servers' };
}