import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSetting, setSetting } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import { appConfig } from '../lib/appconfig.js';
import { broadcastConfig } from '../lib/ws/index.js';
import { egressLog, clearEgressLog } from '../lib/egress.js';
import { releaseInfo, releaseIconPath } from '../lib/release.js';

const APP_FONTS = new Set(['newsreader', 'sourceserif', 'sans']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = { __proto__: null, credits: 'CREDITS.md', changelog: 'CHANGELOG.md', license: 'LICENSE' };
const ICON_TYPES = { __proto__: null, '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

const text = (v, cap) => String(v ?? '').slice(0, cap);

export default function registerMiscRoutes(app) {
  app.get('/api/app-config', authMiddleware, (req, res) => res.json(appConfig()));

  app.patch('/api/admin/app-config', authMiddleware, adminOnly, (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    let changed = false;
    const put = (key, value) => {
      if (getSetting(key, null) === value) return false;
      setSetting(key, value);
      changed = true;
      return true;
    };
    if ('appName' in b) put('app_name', text(b.appName, 120).trim() || 'open-quill');
    if ('disclaimer' in b) put('disclaimer', text(b.disclaimer, 500));
    if ('greetings' in b) {
      const list = (Array.isArray(b.greetings) ? b.greetings : []).map(g => text(g, 200).trim()).filter(Boolean).slice(0, 40);
      put('greetings', JSON.stringify(list.length ? list : ['How can I help you?']));
    }
    if ('quickPrompts' in b) {
      const QP_ICONS = ['none', 'bulb', 'pencil', 'code', 'coffee', 'learn', 'sparkles', 'search', 'chat', 'file', 'star'];
      const list = (Array.isArray(b.quickPrompts) ? b.quickPrompts : [])
        .map(q => ({ label: text(q?.label, 40).trim(), icon: QP_ICONS.includes(text(q?.icon, 20).trim()) ? text(q.icon, 20).trim() : 'none', prompt: text(q?.prompt, 4000).trim() }))
        .filter(q => q.label && q.prompt).slice(0, 8);
      put('quick_prompts', JSON.stringify(list));
    }
    if ('allowSignups' in b && put('allow_signups', b.allowSignups ? '1' : '0')) {
      logAudit(req, 'auth.signups', { meta: { allowed: !!b.allowSignups } });
    }
    if ('localOnly' in b && put('local_only', b.localOnly ? '1' : '0')) {
      logAudit(req, 'security.localOnly', { meta: { enabled: !!b.localOnly } });
    }
    if ('egressLocalOnly' in b && put('egress_local_only', b.egressLocalOnly ? '1' : '0')) {
      logAudit(req, 'security.egress', { meta: { localOnly: !!b.egressLocalOnly } });
    }
    if ('egressAllowWebSearch' in b && put('egress_allow_websearch', b.egressAllowWebSearch ? '1' : '0')) {
      logAudit(req, 'security.egressWebSearch', { meta: { allowed: !!b.egressAllowWebSearch } });
    }
    if ('egressAllowlist' in b) {
      const list = (Array.isArray(b.egressAllowlist) ? b.egressAllowlist : [])
        .map(h => String(h).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0])
        .filter(h => h && /^[a-z0-9.*_-]+$/.test(h))
        .slice(0, 100);
      if (put('egress_allowlist', JSON.stringify([...new Set(list)]))) {
        logAudit(req, 'security.egressAllowlist', { meta: { count: list.length } });
      }
    }
    if ('modelDocs' in b && put('model_docs_enabled', b.modelDocs ? '1' : '0')) {
      logAudit(req, 'branding.modelDocs', { meta: { on: !!b.modelDocs } });
    }
    if ('appIcon' in b) put('app_icon', text(b.appIcon, 1024));
    if ('appFont' in b) put('app_font', APP_FONTS.has(b.appFont) ? b.appFont : 'newsreader');
    if ('uiPreset' in b) {
      const next = b.uiPreset === 'openai' ? 'openai' : 'anthropic';
      const prev = getSetting('ui_preset', '');
      if (put('ui_preset', next)) {
        if (prev !== next && !('appFont' in b)) put('app_font', next === 'openai' ? 'sans' : 'newsreader');
        logAudit(req, 'branding.preset', { meta: { preset: next } });
      }
    }
    if (changed) broadcastConfig();
    res.json({ ok: true });
  });

  app.get('/api/admin/egress-log', authMiddleware, adminOnly, (req, res) => res.json(egressLog()));
  app.delete('/api/admin/egress-log', authMiddleware, adminOnly, (req, res) => { clearEgressLog(); res.json({ ok: true }); });

  app.get('/api/release', authMiddleware, (req, res) => res.json(releaseInfo()));

  app.get('/api/release/icon', authMiddleware, (req, res) => {
    const file = releaseIconPath();
    if (!file) return res.status(404).json({ error: 'not found' });
    res.setHeader('Content-Type', ICON_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(file);
  });

  app.get('/api/docs/:name', authMiddleware, (req, res) => {
    const file = DOCS[req.params.name];
    if (!file) return res.status(404).json({ error: 'not found' });
    let content;
    try { content = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8'); }
    catch { content = `# ${req.params.name}\n\n_Create \`${file}\` in the project root to populate this._`; }
    res.json({ content });
  });
}
