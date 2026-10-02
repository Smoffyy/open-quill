import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { resolveSection, DEFAULT_SECTION } from './nav.jsx';
import { useCatalog } from './state/useCatalog.js';
import { useWorkspace, promptFeaturesOf } from './state/useWorkspace.js';
import { useMembers } from './state/useMembers.js';
import { createHistory, historyKey } from './state/history.js';
import { isMacPlatform } from '../../lib/keybinds.js';
import { isTypingTarget } from '../../lib/keyboard.js';
import { usePresence } from './state/usePresence.js';
import { useChanges } from '../../lib/useChanges.js';
import { toast } from '../../lib/toast.js';
import { t } from '../../i18n.jsx';

const Ctx = createContext(null);
export const useAdmin = () => useContext(Ctx);

const TAB_KEY = 'oq-admin-section';

export function useUndoKeys(rootRef) {
  const { undo, redo } = useAdmin();
  useEffect(() => {
    const onKey = (e) => {
      const action = e.defaultPrevented ? null : historyKey(e, isMacPlatform());
      if (!action) return;
      const el = document.activeElement;
      if (isTypingTarget(el)) return;
      const owner = el?.closest?.('[role="dialog"]');
      if (owner && owner !== rootRef.current) return;
      e.preventDefault();
      if (action === 'undo') undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, rootRef]);
}

function firstSection() {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    if (raw) return resolveSection(raw);
  } catch {}
  return DEFAULT_SECTION;
}

export function AdminProvider({ user, onClose, fixedSection, children }) {
  const [section, setSectionRaw] = useState(() => fixedSection || firstSection());
  const [ask, setAsk] = useState(null);
  const scrollMem = useRef(new Map());

  const setSection = useCallback((id) => setSectionRaw(resolveSection(id)), []);
  useEffect(() => { if (!fixedSection) try { localStorage.setItem(TAB_KEY, section); } catch {} }, [section, fixedSection]);

  const confirm = useCallback((spec) => setAsk(spec), []);

  const history = useRef(null);
  if (!history.current) history.current = createHistory();

  const workspace = useWorkspace({ history: history.current });
  const features = useRef(null);
  features.current = promptFeaturesOf(workspace.settings);
  const changes = useChanges();
  const catalog = useCatalog({ confirm, features, history: history.current, changes });
  const members = useMembers({ confirm });
  const [reviewing, setReviewing] = useState(false);

  const { setSelection, selection, unsaved: catalogUnsaved } = catalog;
  const { unsaved: workspaceUnsaved } = workspace;

  useEffect(() => {
    const warn = (e) => {
      if (!catalogUnsaved() && !workspaceUnsaved()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [catalogUnsaved, workspaceUnsaved]);
  const focusModel = section === 'models' && selection.length === 1 ? selection[0] : '';
  const present = usePresence(user?.id, section, focusModel);

  const undo = useCallback(() => {
    if (history.current.undo()) toast(t('Change undone'));
  }, []);

  const redo = useCallback(() => {
    if (history.current.redo()) toast(t('Change redone'));
  }, []);

  // Opening a model is always "show the models page with this one open", so the
  // finder, the overview and every list action go through one call.
  const openModel = useCallback((id) => {
    setSelection([id]);
    setSection('models');
  }, [setSelection, setSection]);

  // Each section keeps its own scroll offset, so flipping between them does not
  // dump the admin back at the top of a long page.
  const keepScroll = useCallback((key, el) => {
    if (!el || !key) return undefined;
    let settling = true;
    el.scrollTop = scrollMem.current.get(key) || 0;
    const raf = requestAnimationFrame(() => { settling = false; });
    const onScroll = () => { if (!settling) scrollMem.current.set(key, el.scrollTop); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  const value = {
    user, onClose,
    section, setSection, openModel, undo, redo,
    ask, setAsk, confirm,
    keepScroll, reviewing, setReviewing, present,
    catalog, workspace, members, changes
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}