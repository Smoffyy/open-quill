import { db, uid, now, tx, getSetting, setSetting, delSetting, settingsVersion } from '../db.js';
import { draftGet, draftSet, draftKeys } from './draft.js';
import { STAGED_KEYS, SECRET_KEYS } from './settingfields.js';
import { readStore, writeStore, writeLiveStore, THEME_STORE_KEY } from './theme.js';
import { invalidateModelShapes } from './models.js';
import { draftFeatures, syncAllModels } from './systemprompt.js';
import { diffState, applyState, expandKeys, touchedModelIds } from './changes.js';
import { broadcastConfig, broadcastAdmins } from './ws/broadcast.js';

const KEEP_RELEASES = 50;
const MAX_NOTE = 500;
const MAX_AUTHORS = 6;

let head;

const fail = (status, message) => Object.assign(new Error(message), { status });

const nameOf = (u) => (u ? (u.display_name || String(u.email || '').split('@')[0] || '') : '');

function headRelease() {
  if (head === undefined) head = db.releases.head();
  return head;
}

export function liveVersion() {
  return headRelease()?.version || 0;
}

function liveModels() {
  const snap = getSetting('published_models', null);
  return Array.isArray(snap) ? snap : db.models.all();
}

function settingKeys() {
  return [...new Set([...STAGED_KEYS, ...draftKeys()])].filter(k => k !== THEME_STORE_KEY);
}

const withoutHistory = (store) => ({ ...store, themes: store.themes.map(({ history, ...t }) => t) });

export function readState(side) {
  const draft = side === 'draft';
  const read = draft ? draftGet : getSetting;
  return {
    models: draft ? db.models.all() : liveModels(),
    settings: Object.fromEntries(settingKeys().map(k => [k, read(k, null)])),
    themes: readStore(draft)
  };
}

const settingIds = (keys) => keys.filter(k => k.startsWith('setting:')).map(k => k.slice('setting:'.length));
const touchesThemes = (keys) => keys.some(k => k.startsWith('theme'));

function writeLive(next, keys) {
  if (keys.some(k => k.startsWith('model'))) {
    setSetting('published_models', next.models);
    invalidateModelShapes();
  }
  for (const id of settingIds(keys)) {
    const v = next.settings[id];
    if (v == null) delSetting(id);
    else setSetting(id, v);
  }
  if (touchesThemes(keys)) writeLiveStore(next.themes);
}

function writeDraft(next, keys, { models = true } = {}) {
  if (models) {
    const rows = new Map(next.models.map(m => [m.id, m]));
    for (const id of touchedModelIds(keys, next.models, db.models.all())) {
      if (db.models.byId(id)) db.models.removeById(id);
      const row = rows.get(id);
      if (row) db.models.insert(row);
    }
  }
  for (const id of settingIds(keys)) draftSet(id, next.settings[id] ?? null);
  if (touchesThemes(keys)) writeStore(next.themes);
}

function labelFor(c, live, draft) {
  if (c.scope === 'model') {
    if (!c.target) return '';
    const m = draft.models.find(x => x.id === c.target) || live.models.find(x => x.id === c.target);
    return m ? (m.display_name || m.internal_name || '') : '';
  }
  if (c.scope === 'theme') {
    const t = draft.themes.themes.find(x => x.id === c.target) || live.themes.themes.find(x => x.id === c.target);
    return t ? t.name : '';
  }
  return c.target || '';
}

function themeName(id, live, draft) {
  const t = draft.themes.themes.find(x => x.id === id) || live.themes.themes.find(x => x.id === id);
  return t ? t.name : id;
}

const matchesChange = (editKey, changeKey) => editKey === changeKey || editKey.startsWith(changeKey + ':');

function describe(changes, live, draft) {
  const edits = db.draftEdits.all();
  const users = new Map();
  const person = (id) => {
    if (!users.has(id)) {
      const u = db.users.byId(id);
      users.set(id, u ? { id, name: nameOf(u) } : null);
    }
    return users.get(id);
  };
  return changes.map(c => {
    const mine = edits.filter(e => matchesChange(e.id, c.key));
    const ids = [];
    for (const e of mine.sort((a, b) => b.updated_at - a.updated_at)) for (const id of e.users || []) if (!ids.includes(id)) ids.push(id);
    const at = mine.reduce((n, e) => Math.max(n, e.updated_at || 0), 0) || null;
    const named = c.key === 'themes:active' ? { before: themeName(c.before, live, draft), after: themeName(c.after, live, draft) } : {};
    return { ...c, ...named, label: labelFor(c, live, draft), authors: ids.slice(0, MAX_AUTHORS).map(person).filter(Boolean), at };
  });
}

function compute(live, draft) {
  return describe(diffState(live, draft, { secret: SECRET_KEYS }), live, draft);
}

let memo = { stamp: '', value: null };

export function pendingChanges() {
  const stamp = [db.models.version(), settingsVersion(), db.draftEdits.version(), liveVersion()].join(':');
  if (memo.stamp === stamp) return memo.value;
  const live = readState('live');
  const draft = readState('draft');
  const changes = compute(live, draft);
  const changed = [...new Set(changes.filter(c => c.scope === 'model' && c.target).map(c => c.target))];
  const liveById = new Map(live.models.map(m => [m.id, m]));
  const rel = headRelease();
  const value = {
    version: liveVersion(),
    publishedAt: rel?.created_at || null,
    publishedBy: rel?.author || '',
    changes,
    models: {
      changed,
      live: Object.fromEntries(changed.map(id => [id, liveById.get(id) || null])),
      order: [...live.models].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(m => m.id)
    }
  };
  memo = { stamp, value };
  return value;
}

const slim = ({ authors, ...c }) => ({ ...c, authors: (authors || []).map(a => a.name) });

function record({ user, note, changes, snapshot, kind, from = null }) {
  const version = liveVersion() + 1;
  const rel = {
    id: uid(), version, created_at: now(), kind, from,
    author_id: user?.id || null, author: nameOf(user),
    note: String(note || '').trim().slice(0, MAX_NOTE),
    changes: changes.map(slim),
    snapshot: { ...snapshot, themes: withoutHistory(snapshot.themes) }
  };
  db.releases.insert(rel);
  head = rel;
  if (version > KEEP_RELEASES) db.releases.pruneThrough(version - KEEP_RELEASES);
  return rel;
}

export function ensureInitialRelease() {
  if (headRelease()) return head;
  if (!Array.isArray(getSetting('published_models', null))) setSetting('published_models', db.models.all());
  let rel;
  tx(() => { rel = record({ user: null, note: '', changes: [], snapshot: readState('live'), kind: 'initial' }); });
  return rel;
}

export function noteEdits(user, keys) {
  if (!user?.id || !keys?.length) return;
  const at = now();
  tx(() => {
    for (const key of new Set(keys)) {
      const cur = db.draftEdits.byId(key);
      const users = [user.id, ...(cur?.users || []).filter(id => id !== user.id)].slice(0, MAX_AUTHORS);
      if (cur) db.draftEdits.update(key, { users, updated_at: at });
      else db.draftEdits.insert({ id: key, users, updated_at: at });
    }
  });
}

function pruneEdits(changes) {
  const stale = db.draftEdits.all().filter(e => !changes.some(c => matchesChange(e.id, c.key))).map(e => e.id);
  if (stale.length) db.draftEdits.removeByIds(stale);
}

const remaining = () => diffState(readState('live'), readState('draft'));

function settle(rel) {
  broadcastConfig(rel.version);
  broadcastAdmins({ type: 'admin_draft', scope: 'release', version: rel.version });
}

export function publish(user, { keys = null, note = '', base = null } = {}) {
  ensureInitialRelease();
  if (base != null && Number(base) !== liveVersion()) {
    throw fail(409, 'Someone published while you were reviewing. Look over the list again before publishing.');
  }
  const live = readState('live');
  const draft = readState('draft');
  const all = compute(live, draft);
  const chosen = expandKeys(all, Array.isArray(keys) ? keys : all.map(c => c.key), 'publish');
  if (!chosen.length) throw fail(400, 'There is nothing to publish.');
  const next = applyState(live, draft, chosen);
  let rel;
  tx(() => {
    writeLive(next, chosen);
    writeDraft(draft, chosen, { models: false });
    rel = record({ user, note, changes: all.filter(c => chosen.includes(c.key)), snapshot: next, kind: 'publish' });
    pruneEdits(remaining());
  });
  settle(rel);
  return rel;
}

export function discard(user, { keys = null, onlyOwn = false } = {}) {
  const live = readState('live');
  const draft = readState('draft');
  const all = onlyOwn ? compute(live, draft) : diffState(live, draft);
  const chosen = expandKeys(all, Array.isArray(keys) ? keys : all.map(c => c.key), 'discard');
  if (!chosen.length) throw fail(400, 'There is nothing to discard.');
  if (onlyOwn) {
    const mine = (c) => c.authors.length > 0 && c.authors.every(a => a.id === user?.id);
    if (all.some(c => chosen.includes(c.key) && !mine(c))) throw fail(403, 'Editors can only discard their own changes. Ask a publisher or the owner to discard the rest.');
  }
  const next = applyState(draft, live, chosen);
  const before = draftFeatures();
  tx(() => {
    writeDraft(next, chosen);
    const after = draftFeatures();
    if (Object.keys(after).some(k => after[k] !== before[k])) syncAllModels(before, after);
    pruneEdits(remaining());
  });
  broadcastAdmins({ type: 'admin_draft', scope: 'all', by: user?.id || null });
  return { count: chosen.length };
}

function pendingRoots(changes) {
  const out = new Set();
  for (const c of changes) {
    out.add(c.key);
    if (c.field && c.target && (c.scope === 'model' || c.scope === 'theme') && c.key !== 'themes:active') out.add(c.scope + ':' + c.target);
  }
  return out;
}

export function restore(user, version, { note = '' } = {}) {
  ensureInitialRelease();
  const rel = db.releases.byVersion(version);
  if (!rel?.snapshot) throw fail(404, 'That release is no longer kept.');
  if (rel.version === liveVersion()) throw fail(400, 'Members are already running this release.');
  const live = readState('live');
  const draft = readState('draft');
  const pending = pendingRoots(diffState(live, draft));
  const target = {
    models: rel.snapshot.models || [],
    settings: { ...live.settings, ...(rel.snapshot.settings || {}) },
    themes: rel.snapshot.themes || live.themes
  };
  const changes = compute(live, target);
  if (!changes.length) throw fail(400, 'Members are already running this release.');
  const keys = changes.map(c => c.key);
  const nextLive = applyState(live, target, keys);
  const nextDraft = applyState(draft, target, keys.filter(k => !pending.has(k)));
  let out;
  tx(() => {
    writeLive(nextLive, keys);
    writeDraft(nextDraft, keys);
    out = record({ user, note, changes, snapshot: nextLive, kind: 'restore', from: rel.version });
    pruneEdits(remaining());
  });
  settle(out);
  return out;
}

export function releaseList(limit = 20, offset = 0) {
  ensureInitialRelease();
  const rows = db.releases.page(limit, offset).map(r => ({
    id: r.id, version: r.version, createdAt: r.created_at, kind: r.kind, from: r.from,
    author: r.author || '', note: r.note || '', count: (r.changes || []).length,
    changes: (r.changes || []).map(({ before, after, ...c }) => c)
  }));
  return { version: liveVersion(), total: db.releases.total(), releases: rows };
}

export function releaseDetail(version) {
  const r = db.releases.byVersion(version);
  if (!r) throw fail(404, 'That release is no longer kept.');
  return {
    id: r.id, version: r.version, createdAt: r.created_at, kind: r.kind, from: r.from,
    author: r.author || '', note: r.note || '', changes: r.changes || []
  };
}

export const tabOf = (req) => String(req?.get?.('x-oq-tab') || '').slice(0, 64);

export function staged(req, scope, { keys = [], ...data } = {}) {
  noteEdits(req.user, keys);
  broadcastAdmins({ type: 'admin_draft', scope, tab: tabOf(req), by: req.user?.id || null, ...data });
}
