import { authMiddleware } from '../auth.js';
import * as mcp from '../mcp.js';

// A user sees the workspace servers an admin configured (read-only, so they know what is
// already available and which slugs are taken) alongside their own, which they manage.
function workspaceView() {
  return mcp.list().filter(s => s.enabled).map(s => ({
    id: s.id, name: s.name, slug: s.slug, transport: s.transport,
    url: s.transport === 'http' ? s.url : '', command: s.command || '', args: s.args || '',
    tools: (s.tools || []).map(t => ({ name: t.name, description: t.description || '' })),
    status: s.status || 'new', enabled: true,
    scope: 'workspace', editable: false
  }));
}

function mine(s) {
  return { ...s, headers: undefined, hasHeaders: !!(s.headers || '').trim(), scope: 'user', editable: true };
}

export default function registerUserMcpRoutes(app) {
  app.get('/api/mcp', authMiddleware, (req, res) => {
    res.json({ servers: [...workspaceView(), ...mcp.list(req.user.id).map(mine)], limit: mcp.USER_SERVER_LIMIT });
  });

  app.post('/api/mcp', authMiddleware, async (req, res) => {
    const r = mcp.create({ ...(req.body || {}), transport: 'http' }, req.user.id);
    if (r.error) return res.status(400).json({ error: r.error });
    const refreshed = await mcp.refreshTools(r.server.id, req.user.id);
    res.json({ server: mine(refreshed.server || r.server), warning: refreshed.error || undefined });
  });

  app.patch('/api/mcp/:id', authMiddleware, (req, res) => {
    const r = mcp.update(req.params.id, { ...(req.body || {}), transport: 'http' }, req.user.id);
    if (r.error) return res.status(r.error === 'Server not found.' ? 404 : 400).json({ error: r.error });
    res.json({ server: mine(r.server) });
  });

  app.delete('/api/mcp/:id', authMiddleware, (req, res) => {
    const r = mcp.remove(req.params.id, req.user.id);
    if (r.error) return res.status(404).json({ error: r.error });
    res.json({ ok: true });
  });

  app.post('/api/mcp/:id/refresh', authMiddleware, async (req, res) => {
    const r = await mcp.refreshTools(req.params.id, req.user.id);
    if (!r.server) return res.status(404).json({ error: 'Server not found.' });
    res.json({ server: mine(r.server), error: r.error || undefined });
  });
}
