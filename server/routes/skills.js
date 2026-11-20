import { db, getSetting } from '../db.js';
import { authMiddleware } from '../auth.js';
import { requirePermission, DENIED } from '../lib/authz/middleware.js';
import { can } from '../lib/authz/effective.js';
import { access, atLeast, sharedWith, forgetResource } from '../lib/authz/acl.js';
import * as userskills from '../lib/userskills.js';
import * as workspaceSkills from '../lib/workspaceskills.js';
import { buildSkillFile, skillLines, CONTENT_MAX } from '../lib/skillfile.js';

const WORKSPACE = 'Workspace';

function workspaceView() {
  return workspaceSkills.list().map(s => ({
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

function viewFor(user, s, level) {
  const sharing = can(user, 'skills.share');
  if (level === 'owner') return { ...userskills.view(s, user.display_name || user.email || ''), canShare: sharing };
  const owner = db.users.byId(s.user_id);
  const enabled = !(user.skills_off || []).includes(s.id);
  return { ...userskills.view(s, owner ? owner.display_name || owner.email || '' : '', { access: level, enabled }), canShare: sharing && atLeast(level, 'manage') };
}

export default function registerSkillRoutes(app) {
  app.get('/api/skills', authMiddleware, (req, res) => {
    const mine = userskills.list(req.user.id).map(s => viewFor(req.user, s, 'owner'));
    const shared = [];
    for (const [id, level] of sharedWith(req.user, 'skill')) {
      const s = db.skills.byId(id);
      if (s && s.user_id !== req.user.id) shared.push(viewFor(req.user, s, level));
    }
    res.json({ skills: [...workspaceView(), ...mine, ...shared] });
  });

  app.post('/api/skills', authMiddleware, requirePermission('skills.create'), (req, res) => {
    const b = req.body || {};
    const input = typeof b.file === 'string'
      ? { ...userskills.fromFile(String(b.file).slice(0, CONTENT_MAX), b.name), enabled: b.enabled, source: b.source }
      : b;
    const r = userskills.create(req.user.id, input);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(viewFor(req.user, r.skill, 'owner'));
  });

  app.patch('/api/skills/:id', authMiddleware, (req, res) => {
    const b = req.body || {};
    const found = access(req.user, 'skill', req.params.id);
    if (found.error) return res.status(found.status).json({ error: found.error });
    const s = found.resource;
    if (found.level !== 'owner' && Object.keys(b).length === 1 && 'enabled' in b) {
      userskills.setSharedEnabled(req.user, s.id, b.enabled !== false);
      return res.json(viewFor(db.users.byId(req.user.id), s, found.level));
    }
    if (!can(req.user, 'skills.create')) return res.status(403).json({ error: DENIED });
    if (!atLeast(found.level, 'edit')) return res.status(403).json({ error: 'You can open this but not change it.' });
    const patch = typeof b.file === 'string'
      ? userskills.fromFile(String(b.file).slice(0, CONTENT_MAX), b.name)
      : {};
    for (const k of ['name', 'description', 'body', 'enabled']) if (k in b) patch[k] = b[k];
    if (found.level !== 'owner') delete patch.enabled;
    const r = userskills.update(s.user_id, s.id, patch);
    if (r.error) return res.status(r.error === 'Skill not found.' ? 404 : 400).json({ error: r.error });
    res.json(viewFor(req.user, r.skill, found.level));
  });

  app.delete('/api/skills/:id', authMiddleware, (req, res) => {
    const r = userskills.remove(req.user.id, req.params.id);
    if (r.error) return res.status(404).json({ error: r.error });
    forgetResource('skill', req.params.id);
    res.json({ ok: true });
  });
}