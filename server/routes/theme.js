import { uid } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { logAudit } from '../lib/audit.js';
import { draftGet, draftSet } from '../lib/draft.js';
import { staged } from '../lib/releases.js';
import { readStore, writeStore, themeForClient, sanitizeDoc, docDiffCount, emptyDoc, seedDocFor, pushHistory, THEME_SCHEMA } from '../lib/theme.js';
import { isPreset, presetId, presetById } from '../lib/presets.js';
import { appConfig, configChanges } from '../lib/appconfig.js';

const name = (v, fallback) => String(v ?? '').slice(0, 80).trim() || fallback;

// Selecting a theme also moves the base preset, because the preset stylesheet is
// the layer the builder paints on top of. Leaving them out of step would show a
// half-applied design.
function syncPreset(req, preset) {
  const next = presetId(preset);
  if (draftGet('ui_preset', '') === next) return [];
  const was = appConfig(true);
  const prev = presetId(draftGet('ui_preset', ''));
  draftSet('ui_preset', next);
  const keys = ['setting:ui_preset'];
  const font = draftGet('app_font', '');
  if (prev !== next && (!font || font === presetById(prev).font)) {
    draftSet('app_font', presetById(next).font);
    keys.push('setting:app_font');
  }
  staged(req, 'config', { values: configChanges(was) });
  return keys;
}

function find(store, id) {
  return store.themes.find(t => t.id === id) || null;
}

export default function registerThemeRoutes(app) {
  // What a member renders: the published store's active theme.
  app.get('/api/theme', authMiddleware, (req, res) => res.json(themeForClient(false)));

  // What an admin renders while designing: their own staged copy.
  app.get('/api/admin/theme', authMiddleware, adminOnly, (req, res) => res.json(themeForClient(true)));

  app.get('/api/admin/themes', authMiddleware, adminOnly, (req, res) => {
    const store = readStore(true);
    const live = readStore(false);
    res.json({
      v: THEME_SCHEMA,
      activeId: store.activeId,
      publishedActiveId: live.activeId,
      themes: store.themes.map(t => {
        const published = find(live, t.id);
        return {
          id: t.id, name: t.name, basePreset: t.basePreset, builtin: t.builtin, note: t.note, blurb: t.blurb,
          createdAt: t.createdAt, updatedAt: t.updatedAt,
          published: !!published,
          dirty: !published || JSON.stringify(published.doc) !== JSON.stringify(t.doc),
          changed: docDiffCount(published ? published.doc : {}, t.doc),
          edits: Object.keys(t.doc.elements || {}).length + Object.keys(t.doc.tokens || {}).length,
          history: (t.history || []).map(h => ({ ts: h.ts, label: h.label }))
        };
      })
    });
  });

  app.post('/api/admin/themes', authMiddleware, adminOnly, (req, res) => {
    const b = req.body || {};
    const store = readStore(true);
    if (store.themes.length >= 40) return res.status(400).json({ error: 'Theme limit reached.' });
    const from = b.from ? find(store, String(b.from)) : null;
    const basePreset = isPreset(b.basePreset) ? b.basePreset : presetId(from?.basePreset);
    const theme = {
      id: uid(),
      name: name(b.name, from ? from.name + ' copy' : 'New theme'),
      basePreset,
      builtin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      doc: from ? sanitizeDoc({ ...from.doc, basePreset }) : (b.doc ? sanitizeDoc({ ...b.doc, basePreset }) : emptyDoc(basePreset)),
      history: []
    };
    store.themes.push(theme);
    writeStore(store);
    logAudit(req, 'theme.create', { type: 'theme', id: theme.id, meta: { name: theme.name, from: from?.id || null } });
    staged(req, 'theme', { keys: ['theme:' + theme.id] });
    res.json({ id: theme.id });
  });

  app.patch('/api/admin/themes/:id', authMiddleware, adminOnly, (req, res) => {
    const b = req.body || {};
    const store = readStore(true);
    const theme = find(store, req.params.id);
    if (!theme) return res.status(404).json({ error: 'not found' });
    const keys = [];
    if ('name' in b) {
      theme.name = name(b.name, theme.name);
      keys.push(`theme:${theme.id}:name`);
    }
    if ('basePreset' in b && isPreset(b.basePreset)) {
      theme.basePreset = b.basePreset;
      theme.doc = sanitizeDoc({ ...theme.doc, basePreset: b.basePreset });
      keys.push(`theme:${theme.id}:basePreset`, `theme:${theme.id}:doc`);
      if (store.activeId === theme.id) {
        keys.push(...syncPreset(req, b.basePreset));
      }
    }
    if ('doc' in b) {
      theme.doc = sanitizeDoc({ ...b.doc, basePreset: theme.basePreset });
      keys.push(`theme:${theme.id}:doc`);
    }
    theme.updatedAt = Date.now();
    writeStore(store);
    staged(req, 'theme', { keys });
    res.json({ ok: true, updatedAt: theme.updatedAt });
  });

  app.post('/api/admin/themes/:id/activate', authMiddleware, adminOnly, (req, res) => {
    const store = readStore(true);
    const theme = find(store, req.params.id);
    if (!theme) return res.status(404).json({ error: 'not found' });
    store.activeId = theme.id;
    writeStore(store);
    const keys = ['themes:active', ...syncPreset(req, theme.basePreset)];
    logAudit(req, 'theme.activate', { type: 'theme', id: theme.id, meta: { name: theme.name } });
    staged(req, 'theme', { keys });
    res.json({ ok: true });
  });

  app.delete('/api/admin/themes/:id', authMiddleware, adminOnly, (req, res) => {
    const store = readStore(true);
    const theme = find(store, req.params.id);
    if (!theme) return res.status(404).json({ error: 'not found' });
    if (theme.builtin) return res.status(400).json({ error: 'A built-in layout cannot be deleted. Reset it instead, or delete a copy of it.' });
    store.themes = store.themes.filter(t => t.id !== theme.id);
    const keys = ['theme:' + theme.id, 'themes:active'];
    if (store.activeId === theme.id) {
      store.activeId = store.themes[0].id;
      keys.push(...syncPreset(req, store.themes[0].basePreset));
    }
    writeStore(store);
    logAudit(req, 'theme.delete', { type: 'theme', id: theme.id, meta: { name: theme.name } });
    staged(req, 'theme', { keys });
    res.json({ ok: true });
  });

  // A snapshot is taken before every publish and every reset, which is what the
  // history list rolls back to.
  app.post('/api/admin/themes/:id/snapshot', authMiddleware, adminOnly, (req, res) => {
    const store = readStore(true);
    const theme = find(store, req.params.id);
    if (!theme) return res.status(404).json({ error: 'not found' });
    pushHistory(theme, req.body?.label);
    writeStore(store);
    res.json({ ok: true });
  });

  app.post('/api/admin/themes/:id/restore', authMiddleware, adminOnly, (req, res) => {
    const store = readStore(true);
    const theme = find(store, req.params.id);
    if (!theme) return res.status(404).json({ error: 'not found' });
    const i = Number(req.body?.index);
    const entry = (theme.history || [])[i];
    if (!entry) return res.status(404).json({ error: 'No such version.' });
    pushHistory(theme, 'before restore');
    theme.doc = sanitizeDoc({ ...entry.doc, basePreset: theme.basePreset });
    theme.updatedAt = Date.now();
    writeStore(store);
    logAudit(req, 'theme.restore', { type: 'theme', id: theme.id, meta: { index: i } });
    staged(req, 'theme', { keys: [`theme:${theme.id}:doc`] });
    res.json({ ok: true, doc: theme.doc });
  });

  // "Revert to what members are running" and "start over from the preset" are
  // the same operation with a different source document.
  app.post('/api/admin/themes/:id/reset', authMiddleware, adminOnly, (req, res) => {
    const store = readStore(true);
    const theme = find(store, req.params.id);
    if (!theme) return res.status(404).json({ error: 'not found' });
    const to = String(req.body?.to || 'preset');
    pushHistory(theme, 'before reset');
    if (to === 'published') {
      const live = find(readStore(false), theme.id);
      theme.doc = live ? sanitizeDoc(live.doc) : seedDocFor(theme);
    } else {
      theme.doc = seedDocFor(theme);
    }
    theme.updatedAt = Date.now();
    writeStore(store);
    logAudit(req, 'theme.reset', { type: 'theme', id: theme.id, meta: { to } });
    staged(req, 'theme', { keys: [`theme:${theme.id}:doc`] });
    res.json({ ok: true, doc: theme.doc });
  });

  app.get('/api/admin/themes/:id/export', authMiddleware, adminOnly, (req, res) => {
    const theme = find(readStore(true), req.params.id);
    if (!theme) return res.status(404).json({ error: 'not found' });
    res.json({ kind: 'open-quill-theme', v: THEME_SCHEMA, name: theme.name, basePreset: theme.basePreset, doc: theme.doc });
  });

  app.post('/api/admin/themes/import', authMiddleware, adminOnly, (req, res) => {
    const b = req.body || {};
    if (b.kind && b.kind !== 'open-quill-theme') return res.status(400).json({ error: 'That file is not a theme export.' });
    const store = readStore(true);
    if (store.themes.length >= 40) return res.status(400).json({ error: 'Theme limit reached.' });
    const basePreset = presetId(b.basePreset);
    const theme = {
      id: uid(),
      name: name(b.name, 'Imported theme'),
      basePreset,
      builtin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      doc: sanitizeDoc({ ...(b.doc || {}), basePreset }),
      history: []
    };
    store.themes.push(theme);
    writeStore(store);
    logAudit(req, 'theme.import', { type: 'theme', id: theme.id, meta: { name: theme.name } });
    staged(req, 'theme', { keys: ['theme:' + theme.id] });
    res.json({ id: theme.id, name: theme.name });
  });
}