import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSetting, setSetting } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import { appConfig } from '../lib/appconfig.js';
import { broadcastConfig } from '../lib/ws/index.js';
import { egressLog, clearEgressLog } from '../lib/egress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = { __proto__: null, credits: 'CREDITS.md', changelog: 'CHANGELOG.md', license: 'LICENSE' };

const text = (v, cap) => String(v ?? '').slice(0, cap);

export default function registerMiscRoutes(app) {
  app.get('/api/app-config', authMiddleware, (req, res) => res.json(appConfig()));

  app.patch('/api/admin/app-config', authMiddleware, adminOnly, (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if ('appName' in b) setSetting('app_name', text(b.appName, 120).trim() || 'open-quill');
    if ('disclaimer' in b) setSetting('disclaimer', text(b.disclaimer, 500));
    if ('greetings' in b) {
      const list = (Array.isArray(b.greetings) ? b.greetings : []).map(g => text(g, 200).trim()).filter(Boolean).slice(0, 40);
      setSetting('greetings', JSON.stringify(list.length ? list : ['How can I help you?']));
    }
    if ('quickPrompts' in b) {
      const QP_ICONS = ['none', 'bulb', 'pencil', 'code', 'coffee', 'learn', 'sparkles', 'search', 'chat', 'file', 'star'];
      const list = (Array.isArray(b.quickPrompts) ? b.quickPrompts : [])
        .map(q => ({ label: text(q?.label, 40).trim(), icon: QP_ICONS.includes(text(q?.icon, 20).trim()) ? text(q.icon, 20).trim() : 'none', prompt: text(q?.prompt, 4000).trim() }))
        .filter(q => q.label && q.prompt).slice(0, 8);
      setSetting('quick_prompts', JSON.stringify(list));
    }
    if ('allowSignups' in b) {
      setSetting('allow_signups', b.allowSignups ? '1' : '0');
      logAudit(req, 'auth.signups', { meta: { allowed: !!b.allowSignups } });
      broadcastConfig();
    }
    if ('localOnly' in b) {
      setSetting('local_only', b.localOnly ? '1' : '0');
      logAudit(req, 'security.localOnly', { meta: { enabled: !!b.localOnly } });
      broadcastConfig();
    }
    if ('egressLocalOnly' in b) {
      setSetting('egress_local_only', b.egressLocalOnly ? '1' : '0');
      logAudit(req, 'security.egress', { meta: { localOnly: !!b.egressLocalOnly } });
      broadcastConfig();
    }
    if ('egressAllowWebSearch' in b) {
      setSetting('egress_allow_websearch', b.egressAllowWebSearch ? '1' : '0');
      logAudit(req, 'security.egressWebSearch', { meta: { allowed: !!b.egressAllowWebSearch } });
      broadcastConfig();
    }
    if ('egressAllowlist' in b) {
      const list = (Array.isArray(b.egressAllowlist) ? b.egressAllowlist : [])
        .map(h => String(h).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0])
        .filter(h => h && /^[a-z0-9.*_-]+$/.test(h))
        .slice(0, 100);
      setSetting('egress_allowlist', JSON.stringify([...new Set(list)]));
      logAudit(req, 'security.egressAllowlist', { meta: { count: list.length } });
      broadcastConfig();
    }
    if ('appIcon' in b) setSetting('app_icon', text(b.appIcon, 1024));
    if ('appFont' in b) setSetting('app_font', b.appFont === 'sans' ? 'sans' : 'serif');
    if ('uiPreset' in b) {
      const next = b.uiPreset === 'openai' ? 'openai' : 'anthropic';
      const prev = getSetting('ui_preset', '');
      setSetting('ui_preset', next);
      if (prev !== next && !('appFont' in b)) setSetting('app_font', next === 'openai' ? 'sans' : 'serif');
      logAudit(req, 'branding.preset', { meta: { preset: next } });
      broadcastConfig();
    }
    res.json({ ok: true });
  });

  app.get('/api/admin/egress-log', authMiddleware, adminOnly, (req, res) => res.json(egressLog()));
  app.delete('/api/admin/egress-log', authMiddleware, adminOnly, (req, res) => { clearEgressLog(); res.json({ ok: true }); });

  app.get('/api/docs/:name', authMiddleware, (req, res) => {
    const file = DOCS[req.params.name];
    if (!file) return res.status(404).json({ error: 'not found' });
    let content;
    try { content = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8'); }
    catch { content = `# ${req.params.name}\n\n_Create \`${file}\` in the project root to populate this._`; }
    res.json({ content });
  });
}
