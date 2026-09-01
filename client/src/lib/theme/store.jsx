import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../../api.js';
import { docToCss, injectCss, clearCss } from './css.js';
import { emptyDoc, migrateDoc, fillPlaceholders, CONTENT_INDEX } from './schema.js';

const Ctx = createContext(null);
export const useTheme = () => useContext(Ctx);

const SAVE_DELAY = 500;
const HISTORY_LIMIT = 100;
const BUILD_KEY = 'oq-build-mode';
const HISTORY_KEY = 'oq-build-history';
// Entering build mode reloads the page, so history that only lived in memory
// disappeared exactly when an admin was most likely to want it. It is written to
// storage instead, capped so a large theme cannot wedge the quota.
const PERSIST_LIMIT = 30;
// How many themes keep their history. Switching theme to compare two designs
// is normal, and losing the undo stack for doing it is not acceptable.
const PERSIST_THEMES = 4;
const PERSIST_MAX_BYTES = 2000000;
// A drag fires a change per pixel. Edits to the same property inside this window
// collapse into one undo step, so undo returns the slider to where it started
// rather than walking it back a notch at a time.
const COALESCE_MS = 1200;
// Writing history means serialising every document on both stacks. Doing that on
// each change made a drag cost about a second a frame, so it runs on an idle
// timer instead: the in-memory stacks are what undo reads, and storage only has
// to be right by the time the page is reloaded.
const PERSIST_DELAY = 400;

/* Build mode lives entirely in the admin's own session. The draft it edits is
   staged server-side like every other admin change, so a member keeps rendering
   the published document until somebody presses Publish. */

function readBuildFlag() {
  try { return localStorage.getItem(BUILD_KEY) === '1'; } catch { return false; }
}

/* History and the session baseline are kept per theme, so switching themes and
   coming back returns the undo stack and the session baseline that belong to it
   rather than an empty one. Both live out here as plain functions: storage is
   I/O, not component state. */
function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null');
    if (raw && raw.themes) return raw;
    // One theme per key was the old shape; keep whatever it held.
    if (raw && raw.themeId) {
      return { themes: { [raw.themeId]: { past: raw.past || [], future: raw.future || [], baseline: raw.baseline || null, at: Date.now() } } };
    }
  } catch { /* unreadable history is simply no history */ }
  return { themes: {} };
}

// Oldest first, so trimming always gives up the least recently edited theme.
function byAge(themes) {
  return Object.keys(themes).sort((a, b) => (themes[a].at || 0) - (themes[b].at || 0));
}

function writeHistory(themeId, past, future, baselineDoc) {
  try {
    if (!themeId) return;
    const all = readAll();
    all.themes[themeId] = {
      past: past.slice(-PERSIST_LIMIT),
      future: future.slice(-PERSIST_LIMIT),
      baseline: baselineDoc || null,
      at: Date.now()
    };
    for (const id of byAge(all.themes).slice(0, -PERSIST_THEMES)) delete all.themes[id];
    let payload = JSON.stringify(all);
    while (payload.length > PERSIST_MAX_BYTES && Object.keys(all.themes).length > 1) {
      delete all.themes[byAge(all.themes).find(id => id !== themeId)];
      payload = JSON.stringify(all);
    }
    if (payload.length > PERSIST_MAX_BYTES) return;
    localStorage.setItem(HISTORY_KEY, payload);
  } catch { /* a full or blocked quota is not worth failing an edit over */ }
}

function readHistory(themeId) {
  const saved = readAll().themes[themeId];
  if (saved) {
    return {
      past: (saved.past || []).map(migrateDoc),
      future: (saved.future || []).map(migrateDoc),
      baseline: saved.baseline ? migrateDoc(saved.baseline) : null
    };
  }
  return { past: [], future: [], baseline: null };
}

export function ThemeProvider({ user, cfg, children }) {
  const isAdmin = !!user?.isAdmin;
  const [theme, setTheme] = useState(null);
  const [build, setBuild] = useState(() => readBuildFlag());
  const [asMember, setAsMember] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [live, setLive] = useState(null);
  const [previewBp, setPreviewBp] = useState('');

  // Undo and redo are stacks of whole documents. A document is small and every
  // edit is a whole-document replacement anyway, so snapshots are simpler and
  // safer here than replaying inverse operations.
  const past = useRef([]);
  const future = useRef([]);
  const timer = useRef(null);
  const savedDoc = useRef(null);
  const stroke = useRef({ key: '', at: 0 });
  const persistTimer = useRef(null);
  // The state updaters below stay pure; anything that needs the current theme
  // outside one reads it here instead.
  const themeRef = useRef(null);
  // What the document looked like when this build session began. "Revert" walks
  // all the way back to it in one step, which is a different question from undo.
  const baseline = useRef(null);
  const [depth, setDepth] = useState({ undo: 0, redo: 0, baseline: false });

  const buildOn = isAdmin && build;

  useEffect(() => { themeRef.current = theme; }, [theme]);

  const schedulePersistRef = useRef(null);
  schedulePersistRef.current = schedulePersist;

  // Republish the counters the toolbar renders from, and write history through.
  // Deliberately not memoized: it reads refs, so a cached copy would go stale.
  function schedulePersist(themeId) {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      writeHistory(themeId, past.current, future.current,
        baseline.current?.themeId === themeId ? baseline.current.doc : null);
    }, PERSIST_DELAY);
  }

  function settle(themeId) {
    setDepth({ undo: past.current.length, redo: future.current.length, baseline: !!baseline.current });
    schedulePersist(themeId);
  }

  const load = useCallback(async () => {
    try {
      const published = await api.get('/api/theme');
      setLive(published);
      if (!isAdmin) { setTheme(published); return; }
      const draft = await api.get('/api/admin/theme');
      setTheme(draft);
      savedDoc.current = JSON.stringify(migrateDoc(draft.doc));
      const saved = readHistory(draft.id);
      past.current = saved.past;
      future.current = saved.future;
      baseline.current = saved.baseline ? { themeId: draft.id, doc: saved.baseline } : null;
      setDepth({ undo: past.current.length, redo: future.current.length, baseline: !!baseline.current });
    } catch {
      setTheme({ id: '', name: '', basePreset: 'anthropic', doc: emptyDoc() });
    }
  }, [isAdmin]);

  useEffect(() => { if (user) load(); }, [user, load]);

  // The server fires this after a publish, so a member picks the new interface
  // up without reloading the page.
  useEffect(() => {
    const again = () => load();
    window.addEventListener('oq-config', again);
    return () => window.removeEventListener('oq-config', again);
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    try { localStorage.setItem(BUILD_KEY, build ? '1' : '0'); } catch {}
  }, [build, isAdmin]);

  // Leaving build mode should never leave the admin looking at a member view.
  useEffect(() => { if (!buildOn) setAsMember(false); }, [buildOn]);

  // The baseline is taken the first time a theme is in hand inside build mode,
  // not when the flag flips: entering reloads the page, so the document is not
  // loaded yet at that point.
  useEffect(() => {
    if (!buildOn || !theme?.id) return;
    if (baseline.current?.themeId === theme.id) return;
    baseline.current = { themeId: theme.id, doc: migrateDoc(theme.doc) };
    settle(theme.id);
  }, [buildOn, theme]);

  const shown = asMember && live ? live : theme;
  const doc = useMemo(() => migrateDoc(shown?.doc), [shown]);

  useEffect(() => {
    const css = docToCss(doc, buildOn ? previewBp : '');
    if (css.trim()) injectCss(css); else clearCss();
  }, [doc, previewBp, buildOn]);

  useEffect(() => () => clearCss(), []);

  useEffect(() => {
    const root = document.documentElement;
    if (buildOn) root.setAttribute('data-build', asMember ? 'preview' : 'on');
    else root.removeAttribute('data-build');
    return () => root.removeAttribute('data-build');
  }, [buildOn, asMember]);

  const flush = useCallback(async (next) => {
    if (!isAdmin || !next?.id) return;
    const json = JSON.stringify(next.doc);
    if (json === savedDoc.current) { setSaveState('idle'); return; }
    setSaveState('saving');
    try {
      await api.patch('/api/admin/themes/' + next.id, { doc: next.doc });
      savedDoc.current = json;
      setSaveState('saved');
    } catch { setSaveState('error'); }
  }, [isAdmin]);

  /* Every mutation goes through apply() or step(), and both land here. The
     history bookkeeping deliberately happens outside the state updater: React is
     free to re-invoke an updater, and pushing and popping in there recorded a
     drag once per notch instead of once. themeRef moves forward with the state
     so a burst of edits each build on the previous one, not on a stale render.

     `coalesce` names the thing being edited. While consecutive edits carry the
     same name and keep arriving, they extend the entry already on the stack
     instead of pushing new ones, so a slider drag is one undo rather than one
     per pixel. */
  const commit = useCallback((next) => {
    themeRef.current = next;
    setTheme(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), SAVE_DELAY);
    setDepth({ undo: past.current.length, redo: future.current.length, baseline: !!baseline.current });
    schedulePersistRef.current(next.id);
  }, [flush]);

  const apply = useCallback((mutate, { record = true, coalesce = '' } = {}) => {
    const cur = themeRef.current;
    if (!cur) return;
    const before = migrateDoc(cur.doc);
    const after = migrateDoc(mutate(structuredClone(before)));
    if (JSON.stringify(after) === JSON.stringify(before)) return;

    if (record) {
      const now = Date.now();
      const sameStroke = !!coalesce
        && stroke.current.key === coalesce
        && now - stroke.current.at < COALESCE_MS
        && past.current.length > 0;
      if (!sameStroke) past.current = [...past.current, before].slice(-HISTORY_LIMIT);
      stroke.current = { key: coalesce, at: coalesce ? now : 0 };
      future.current = [];
    }

    commit({ ...cur, doc: after });
  }, [commit]);

  const step = useCallback((from, to) => {
    const cur = themeRef.current;
    if (!cur || !from.current.length) return;
    const target = from.current[from.current.length - 1];
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, migrateDoc(cur.doc)].slice(-HISTORY_LIMIT);
    // A step always ends the stroke, or the next slider nudge would fold itself
    // into the entry that was just undone.
    stroke.current = { key: '', at: 0 };
    commit({ ...cur, doc: target });
  }, [commit]);

  // Called when a gesture genuinely finishes, so the next edit starts a new undo
  // entry no matter how quickly it arrives.
  const endStroke = useCallback(() => { stroke.current = { key: '', at: 0 }; }, []);

  // Releasing the pointer ends whatever was being dragged, slider or element,
  // so two separate drags of the same control never merge into one undo entry.
  useEffect(() => {
    if (!buildOn) return undefined;
    const end = () => { stroke.current = { key: '', at: 0 }; };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    return () => {
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
    };
  }, [buildOn]);

  const undo = useCallback(() => step(past, future), [step]);
  const redo = useCallback(() => step(future, past), [step]);

  const replaceDoc = useCallback((nextDoc) => {
    stroke.current = { key: '', at: 0 };
    apply(() => migrateDoc(nextDoc));
  }, [apply]);

  // Everything since build mode opened, in one step, recorded so it can itself
  // be undone.
  const revertSession = useCallback(() => {
    const target = baseline.current?.doc;
    if (!target) return;
    replaceDoc(target);
  }, [replaceDoc]);

  // After a publish there is nothing left to revert, so the session restarts
  // from what was just shipped.
  const markSessionBaseline = useCallback(() => {
    const cur = themeRef.current;
    if (!cur) return;
    baseline.current = { themeId: cur.id, doc: migrateDoc(cur.doc) };
    settle(cur.id);
  }, []);

  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(persistTimer.current); }, []);

  // Placeholders are resolved against whatever the app already knows, never
  // baked into the document.
  const vars = useMemo(() => ({
    'user.name': user?.displayName || user?.email?.split('@')[0] || '',
    'user.email': user?.email || '',
    'workspace.name': cfg?.appName || 'open-quill',
    'model.name': '',
    'conversation.title': '',
    currentDate: new Date().toLocaleDateString(),
    currentTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    version: cfg?.version || ''
  }), [user, cfg]);

  const text = useCallback((key, fallback) => {
    const raw = doc?.content?.[key];
    const v = raw != null && raw !== '' ? raw : null;
    if (v == null) return fallback;
    return fillPlaceholders(v, vars);
  }, [doc, vars]);

  const slotNodes = useCallback((slot) => (doc?.slots?.[slot] || []), [doc]);

  const value = {
    theme, live, doc, isAdmin,
    build: buildOn, setBuild, asMember, setAsMember,
    apply, replaceDoc, undo, redo, endStroke, depth, saveState,
    revertSession, markSessionBaseline,
    previewBp, setPreviewBp,
    reload: load, text, vars, slotNodes,
    contentIndex: CONTENT_INDEX
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Safe outside the provider (login screen, tests): falls back to the literal.
export function useThemeText(key, fallback) {
  const ctx = useContext(Ctx);
  return ctx ? ctx.text(key, fallback) : fallback;
}
