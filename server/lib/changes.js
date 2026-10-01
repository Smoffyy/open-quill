import { docDiffCount } from './theme.js';

const MODEL_SKIP = new Set(['id', 'sort_order']);
const THEME_FIELDS = ['name', 'basePreset', 'doc'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const byOrder = (rows) => [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

function parseKey(key) {
  const [head, id = null, field = null] = String(key).split(':');
  return { head, id, field };
}

export function modelChanges(live, draft) {
  const out = [];
  const was = new Map(live.map(m => [m.id, m]));
  const now = new Map(draft.map(m => [m.id, m]));
  for (const m of byOrder(draft)) {
    const prev = was.get(m.id);
    if (!prev) {
      out.push({ key: 'model:' + m.id, scope: 'model', target: m.id, field: null, kind: 'create', before: null, after: m });
      continue;
    }
    const fields = [...new Set([...Object.keys(prev), ...Object.keys(m)])].sort();
    for (const f of fields) {
      if (MODEL_SKIP.has(f) || same(prev[f], m[f])) continue;
      out.push({ key: `model:${m.id}:${f}`, scope: 'model', target: m.id, field: f, kind: 'update', before: prev[f] ?? null, after: m[f] ?? null });
    }
  }
  for (const m of byOrder(live)) {
    if (!now.has(m.id)) out.push({ key: 'model:' + m.id, scope: 'model', target: m.id, field: null, kind: 'delete', before: m, after: null });
  }
  const a = byOrder(live).map(m => m.id).filter(id => now.has(id));
  const b = byOrder(draft).map(m => m.id).filter(id => was.has(id));
  if (a.some((id, i) => id !== b[i])) {
    out.push({ key: 'models:order', scope: 'model', target: null, field: 'order', kind: 'order', before: a, after: b });
  }
  return out;
}

export function settingChanges(live, draft, secret = new Set()) {
  const keys = [...new Set([...Object.keys(live), ...Object.keys(draft)])].sort();
  const out = [];
  for (const k of keys) {
    if (same(live[k], draft[k])) continue;
    const hide = secret.has(k);
    out.push({
      key: 'setting:' + k, scope: 'setting', target: k, field: null, kind: 'update',
      before: hide ? null : live[k] ?? null, after: hide ? null : draft[k] ?? null, ...(hide ? { secret: true } : {})
    });
  }
  return out;
}

const themeHead = (t) => ({ name: t.name, basePreset: t.basePreset });

export function themeChanges(live, draft) {
  const out = [];
  const was = new Map(live.themes.map(t => [t.id, t]));
  const now = new Map(draft.themes.map(t => [t.id, t]));
  for (const t of draft.themes) {
    const prev = was.get(t.id);
    if (!prev) {
      out.push({ key: 'theme:' + t.id, scope: 'theme', target: t.id, field: null, kind: 'create', before: null, after: themeHead(t), count: docDiffCount({}, t.doc) });
      continue;
    }
    for (const f of THEME_FIELDS) {
      if (same(prev[f], t[f])) continue;
      out.push(f === 'doc'
        ? { key: `theme:${t.id}:doc`, scope: 'theme', target: t.id, field: 'doc', kind: 'update', before: null, after: null, count: docDiffCount(prev.doc, t.doc) }
        : { key: `theme:${t.id}:${f}`, scope: 'theme', target: t.id, field: f, kind: 'update', before: prev[f] ?? null, after: t[f] ?? null });
    }
  }
  for (const t of live.themes) {
    if (!now.has(t.id)) out.push({ key: 'theme:' + t.id, scope: 'theme', target: t.id, field: null, kind: 'delete', before: themeHead(t), after: null });
  }
  if (live.activeId !== draft.activeId) {
    out.push({ key: 'themes:active', scope: 'theme', target: draft.activeId, field: 'active', kind: 'update', before: live.activeId, after: draft.activeId });
  }
  return out;
}

export function diffState(live, draft, { secret } = {}) {
  return [
    ...modelChanges(live.models, draft.models),
    ...settingChanges(live.settings, draft.settings, secret),
    ...themeChanges(live.themes, draft.themes)
  ];
}

export function applyModels(base, src, keys) {
  const from = new Map(src.map(m => [m.id, m]));
  let rows = base.map(m => ({ ...m }));
  const at = new Map(rows.map(m => [m.id, m]));
  for (const key of keys) {
    const { head, id, field } = parseKey(key);
    if (head === 'models' && id === 'order') {
      for (const m of rows) if (from.has(m.id)) m.sort_order = from.get(m.id).sort_order;
      continue;
    }
    if (head !== 'model' || !id) continue;
    const s = from.get(id);
    const b = at.get(id);
    if (!field) {
      if (s && !b) {
        const row = { ...s };
        rows.push(row);
        at.set(id, row);
      } else if (!s && b) {
        rows = rows.filter(m => m.id !== id);
        at.delete(id);
      }
      continue;
    }
    if (!s || !b) continue;
    if (s[field] === undefined) delete b[field];
    else b[field] = s[field];
  }
  return byOrder(rows);
}

export function applySettings(base, src, keys) {
  const out = { ...base };
  for (const key of keys) {
    const { head, id } = parseKey(key);
    if (head === 'setting' && id) out[id] = src[id] ?? null;
  }
  return out;
}

export function applyThemes(base, src, keys) {
  const from = new Map(src.themes.map(t => [t.id, t]));
  const out = { ...base, themes: base.themes.map(t => ({ ...t })) };
  for (const key of keys) {
    const { head, id, field } = parseKey(key);
    if (head === 'themes' && id === 'active') { out.activeId = src.activeId; continue; }
    if (head !== 'theme' || !id) continue;
    const s = from.get(id);
    const b = out.themes.find(t => t.id === id);
    if (!field) {
      if (s && !b) out.themes.push({ ...s });
      else if (!s && b) out.themes = out.themes.filter(t => t.id !== id);
      continue;
    }
    if (s && b) b[field] = s[field];
  }
  if (!out.themes.some(t => t.id === out.activeId)) {
    out.activeId = out.themes.some(t => t.id === base.activeId) ? base.activeId : out.themes[0]?.id;
  }
  return out;
}

export function applyState(base, src, keys) {
  return {
    models: applyModels(base.models, src.models, keys),
    settings: applySettings(base.settings, src.settings, keys),
    themes: applyThemes(base.themes, src.themes, keys)
  };
}

export function expandKeys(changes, picked, mode = 'publish') {
  const have = new Map(changes.map(c => [c.key, c]));
  const out = new Set();
  const queue = [];
  const add = (k) => {
    if (!have.has(k) || out.has(k)) return;
    out.add(k);
    queue.push(k);
  };
  for (const k of picked) add(k);
  while (queue.length) {
    const c = have.get(queue.shift());
    if (c.scope === 'model' && c.field === 'is_default') {
      for (const d of changes) if (d.scope === 'model' && d.field === 'is_default') add(d.key);
    }
    if (mode === 'publish' && c.scope === 'model' && c.kind === 'create') add('models:order');
    if (c.key === 'themes:active') {
      add('setting:ui_preset');
      add('theme:' + c.target);
    }
    if (c.key === 'setting:ui_preset') add('themes:active');
    if (c.scope === 'theme' && c.field === 'basePreset') add('setting:ui_preset');
  }
  return [...out];
}

export function touchedModelIds(keys, ...states) {
  const ids = new Set();
  for (const key of keys) {
    const { head, id } = parseKey(key);
    if (head === 'model' && id) ids.add(id);
    if (head === 'models') for (const rows of states) for (const m of rows) ids.add(m.id);
  }
  return ids;
}

