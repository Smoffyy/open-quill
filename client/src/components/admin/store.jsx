import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { resolveSection, DEFAULT_SECTION } from './nav.jsx';
import { useCatalog } from './state/useCatalog.js';
import { useWorkspace } from './state/useWorkspace.js';
import { useMembers } from './state/useMembers.js';

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

  const catalog = useCatalog({ confirm });
  const workspace = useWorkspace();
  const members = useMembers({ confirm });

  // Each section keeps its own scroll offset, so flipping between them does not
  // dump the admin back at the top of a long page.
  const keepScroll = useCallback((key, el) => {
    if (!el || !key) return undefined;
    let settling = true;
    el.scrollTop = scrollMem.current.get(key) || 0;
    requestAnimationFrame(() => { settling = false; });
    const onScroll = () => { if (!settling) scrollMem.current.set(key, el.scrollTop); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const value = {
    user, onClose,
    section, setSection,
    ask, setAsk, confirm,
    keepScroll,
    catalog, workspace, members
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
