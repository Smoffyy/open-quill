import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpConfig, joinArgs, nameFrom } from '../src/lib/mcpconfig.js';

test('a Claude Desktop style block becomes one server per entry', () => {
  const { servers, error } = parseMcpConfig(JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\My Docs'] },
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' } },
      remote: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } },
      off: { command: 'uvx', args: ['mcp-server-fetch'], disabled: true }
    }
  }));
  assert.equal(error, '');
  assert.deepEqual(servers.map(s => [s.name, s.transport]), [['filesystem', 'stdio'], ['github', 'stdio'], ['remote', 'http'], ['off', 'stdio']]);
  assert.equal(servers[0].args, '-y @modelcontextprotocol/server-filesystem "C:\\My Docs"', 'an argument with a space stays one argument');
  assert.equal(servers[1].env, 'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x');
  assert.equal(servers[2].headers, 'Authorization: Bearer t');
  assert.equal(servers[3].enabled, false);
});

test('other client formats and bare entries are understood too', () => {
  assert.equal(parseMcpConfig('{"servers":{"docs":{"type":"sse","url":"http://h/sse"}}}').servers[0].url, 'http://h/sse', 'VS Code');
  assert.equal(parseMcpConfig('{"docs":{"serverUrl":"https://h/mcp"}}').servers[0].url, 'https://h/mcp', 'Windsurf');
  assert.equal(parseMcpConfig('"fetch": {"command": "uvx", "args": ["mcp-server-fetch"]}').servers[0].name, 'fetch', 'a pasted entry without braces');
  const one = parseMcpConfig('{"command":"npx","args":["-y","@acme/server-weather"]}').servers[0];
  assert.equal(one.name, 'weather', 'a nameless entry is named after its package');
  const win = parseMcpConfig('{"mcpServers":{"x":{"command":"cmd","args":["/c","npx","-y","pkg"]}}}').servers[0];
  assert.deepEqual([win.command, win.args], ['npx', '-y pkg'], 'the Windows cmd /c wrapper is unwrapped');
});

test('a paste that is not a config says why', () => {
  assert.equal(parseMcpConfig('').error, '');
  assert.equal(parseMcpConfig('{ "mcpServers": ').error, 'not-json');
  assert.equal(parseMcpConfig('{"hello":"world"}').error, 'no-servers');
  assert.equal(parseMcpConfig('[1,2]').error, 'no-servers');
});

test('arguments are joined so the server splits them back the same way', () => {
  assert.equal(joinArgs(['a', 'b c', '']), 'a "b c" ""');
  assert.equal(joinArgs(['say "hi"']), '["say \\"hi\\""]', 'a quote inside an argument falls back to a JSON list');
  assert.equal(nameFrom('', { url: 'https://tools.example.com/mcp' }), 'tools');
  assert.equal(nameFrom('', { args: ['mcp-server-fetch'] }), 'fetch');
});
