import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { resolveSection, DEFAULT_SECTION } from './nav.jsx';
import { useCatalog } from './state/useCatalog.js';
import { useWorkspace, promptFeaturesOf } from './state/useWorkspace.js';
import { useMembers } from './state/useMembers.js';
import { createHistory } from './state/history.js';
import { toast } from '../../lib/toast.js';
import { t } from '../../i18n.jsx';

const Ctx = createContext(null);
export const useAdmin = () => useContext(Ctx);

const TAB_KEY = 'oq-admin-section';

function firstSection() {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    if (raw) return resolveSection(raw);
  } catch {}
  return DEFAULT_SECTION;
}

export function AdminProvider({ user, onClose, children }) {
  const [section, setSectionRaw] = useState(firstSection);
  const [ask, setAsk] = useState(null);
  const scrollMem = useRef(new Map());

  const setSection = useCallback((id) => setSectionRaw(resolveSection(id)), []);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, section); } catch {} }, [section]);

  const confirm = useCallback((spec) => setAsk(spec), []);

  const history = useRef(null);
  if (!history.current) history.current = createHistory();

  const workspace = useWorkspace({ history: history.current });
  const features = useRef(null);
  features.current = promptFeaturesOf(workspace.settings);
  const catalog = useCatalog({ confirm, features, history: history.current });
  const members = useMembers({ confirm });

  const { setSelection, revert } = catalog;
  const { discard, reload: reloadWorkspace } = workspace;

  const undo = useCallback(() => {
    if (history.current.undo()) toast(t('Change undone'));
  }, []);

  const redo = useCallback(() => {
    if (history.current.redo()) toast(t('Change redone'));
  }, []);

  const revertAll = useCallback(() => confirm({
    title: t('Revert all changes'),
    message: t('This discards every unpublished change and restores what members are running now. This cannot be undone.'),
    confirm: t('Revert all changes'),
    onConfirm: async () => {
      discard();
      if (!(await revert())) return;
      await reloadWorkspace();
      history.current.clear();
    }
  }), [confirm, discard, revert, reloadWorkspace]);

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
    section, setSection, openModel, undo, redo, revertAll,
    ask, setAsk, confirm,
    keepScroll,
    catalog, workspace, members
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
