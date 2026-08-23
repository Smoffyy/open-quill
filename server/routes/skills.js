import { getSetting } from '../db.js';
import { authMiddleware } from '../auth.js';
import * as userskills from '../userskills.js';
import * as skillsys from '../skillsys.js';
import { buildSkillFile, skillLines, CONTENT_MAX } from '../lib/skillfile.js';

const WORKSPACE = 'Workspace';

function workspaceView() {
  return skillsys.list().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description || '',
    body: s.content || '',
    file: buildSkillFile({ name: s.name, description: s.description, body: s.content }),
    lines: skillLines(s.content),
    enabled: s.enabled !== false,
    source: 'workspace',
    scope: 'workspace',
    author: getSetting('app_name', '') || WORKSPACE,
    editable: false,
    created_at: s.created_at || 0,
    updated_at: s.updated_at || 0
  }));
}

export default function registerSkillRoutes(app) {
  app.get('/api/skills', authMiddleware, (req, res) => {
    const author = req.user.display_name || req.user.email || '';
    const mine = userskills.list(req.user.id).map(s => userskills.view(s, author));
    res.json({ skills: [...workspaceView(), ...mine] });
  });

  app.post('/api/skills', authMiddleware, (req, res) => {
    const b = req.body || {};
    const input = typeof b.file === 'string'
      ? { ...userskills.fromFile(String(b.file).slice(0, CONTENT_MAX), b.name), enabled: b.enabled, source: b.source }
      : b;
    const r = userskills.create(req.user.id, input);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(userskills.view(r.skill, req.user.display_name || req.user.email || ''));
  });

  app.patch('/api/skills/:id', authMiddleware, (req, res) => {
    const b = req.body || {};
    const patch = typeof b.file === 'string'
      ? userskills.fromFile(String(b.file).slice(0, CONTENT_MAX), b.name)
      : {};
    for (const k of ['name', 'description', 'body', 'enabled']) if (k in b) patch[k] = b[k];
    const r = userskills.update(req.user.id, req.params.id, patch);
    if (r.error) return res.status(r.error === 'Skill not found.' ? 404 : 400).json({ error: r.error });
    res.json(userskills.view(r.skill, req.user.display_name || req.user.email || ''));
  });

  app.delete('/api/skills/:id', authMiddleware, (req, res) => {
    const r = userskills.remove(req.user.id, req.params.id);
    if (r.error) return res.status(404).json({ error: r.error });
    res.json({ ok: true });
  });
}
