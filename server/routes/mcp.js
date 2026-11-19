import { authMiddleware } from '../auth.js';
import * as mcp from '../lib/mcp.js';
import { checkMemberUrl, memberPolicy } from '../lib/mcpnet.js';
import { rateLimiter, throttle } from '../lib/ratelimit.js';

const outbound = throttle(rateLimiter({ windowMs: 60000, max: 30 }), 'Too many connector requests. Wait a minute and try again.');

// A user sees the workspace servers an admin configured (read-only, so they know what is
// already available and which slugs are taken) alongside their own, which they manage.
function workspaceView() {
  return mcp.list().filter(s => s.enabled).map(s => ({
    id: s.id, name: s.name, slug: s.slug, transport: s.transport,
    url: s.transport === 'http' ? s.url : '', command: s.command || '', args: s.args || '',
    tools: mcp.publicTools(s).filter(t => t.mode !== 'off').map(t => ({ name: t.name, description: t.description || '', annotations: t.annotations || {}, mode: t.mode })),
    status: s.status || 'new', enabled: true,
    scope: 'workspace', editable: false
  }));
}

function mine(s) {
  return { ...mcp.publicServer(s), hasHeaders: !!(s.headers || '').trim(), scope: 'user', editable: true };
}

export default function registerUserMcpRoutes(app) {
  app.get('/api/mcp', authMiddleware, (req, res) => {
    const policy = memberPolicy();
    res.json({ servers: [...workspaceView(), ...mcp.list(req.user.id).map(mine)], limit: mcp.USER_SERVER_LIMIT, allowed: policy.allowed, hosts: policy.hosts });
  });

  app.post('/api/mcp', authMiddleware, outbound, async (req, res) => {
    const blocked = await checkMemberUrl(req.body?.url);
    if (blocked) return res.status(400).json({ error: blocked });
    const r = mcp.create({ ...(req.body || {}), transport: 'http' }, req.user.id);
    if (r.error) return res.status(400).json({ error: r.error });
    const refreshed = await mcp.refreshTools(r.server.id, req.user.id);
    res.json({ server: mine(refreshed.server || r.server), warning: refreshed.error || undefined });
  });

  app.patch('/api/mcp/:id', authMiddleware, outbound, async (req, res) => {
    if (req.body?.url !== undefined || req.body?.enabled) {
      const cur = mcp.byId(req.params.id, req.user.id);
      const blocked = cur && await checkMemberUrl(req.body?.url ?? cur.url);
      if (blocked) return res.status(400).json({ error: blocked });
    }
    const r = mcp.update(req.params.id, { ...(req.body || {}), transport: 'http' }, req.user.id);
    if (r.error) return res.status(r.error === 'Server not found.' ? 404 : 400).json({ error: r.error });
    if (!r.server.enabled) return res.json({ server: mine(r.server) });
    const refreshed = await mcp.refreshTools(r.server.id, req.user.id);
    res.json({ server: mine(refreshed.server || r.server), warning: refreshed.error || undefined });
  });

  app.delete('/api/mcp/:id', authMiddleware, (req, res) => {
    const r = mcp.remove(req.params.id, req.user.id);
    if (r.error) return res.status(404).json({ error: r.error });
    res.json({ ok: true });
  });

  app.get('/api/mcp/prompts', authMiddleware, (req, res) => {
    res.json({ prompts: mcp.listPrompts(req.user.id) });
  });

  app.post('/api/mcp/prompts/get', authMiddleware, outbound, async (req, res) => {
    const b = req.body || {};
    const r = await mcp.getPrompt(String(b.serverId || ''), String(b.name || ''), b.arguments && typeof b.arguments === 'object' ? b.arguments : {}, req.user.id);
    if (r.error) return res.status(r.error === 'Prompt not found.' ? 404 : 400).json({ error: r.error });
    res.json({ text: r.text });
  });

  app.put('/api/mcp/:id/tools', authMiddleware, (req, res) => {
    const r = mcp.setToolModes(req.params.id, req.body?.modes, req.user.id);
    if (r.error) return res.status(404).json({ error: r.error });
    res.json({ server: mine(r.server) });
  });

  app.post('/api/mcp/:id/try', authMiddleware, outbound, async (req, res) => {
    const r = await mcp.tryTool(req.params.id, String(req.body?.tool || ''), req.body?.args, req.user.id);
    if (r.error && r.ok === undefined) return res.status(404).json({ error: r.error });
    res.json({ result: { ok: r.ok, ms: r.ms, content: r.content || '', error: r.error || '', images: (r.images || []).length } });
  });

  app.post('/api/mcp/:id/refresh', authMiddleware, outbound, async (req, res) => {
    const r = await mcp.refreshTools(req.params.id, req.user.id);
    if (!r.server) return res.status(404).json({ error: 'Server not found.' });
    res.json({ server: mine(r.server), error: r.error || undefined });
  });
}