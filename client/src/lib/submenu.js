import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const SUBMENU_CLOSE_DELAY = 160;

export function useSubmenus(opts = {}) {
  const openDelay = opts.openDelay ?? 0;
  const closeDelay = opts.closeDelay ?? SUBMENU_CLOSE_DELAY;
  const [open, setOpen] = useState(null);
  const timer = useRef(null);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  return useMemo(() => ({
    open,
    isOpen: (id) => open === id,
    show: (id) => {
      clear();
      setOpen(id);
    },
    hoverOpen: (id) => {
      clear();
      if (!openDelay || open !== null) {
        setOpen(id);
        return;
      }
      timer.current = setTimeout(() => setOpen(id), openDelay);
    },
    hoverClose: () => {
      clear();
      timer.current = setTimeout(() => setOpen(null), closeDelay);
    },
    toggle: (id) => {
      clear();
      setOpen(cur => (cur === id ? null : id));
    },
    closeAll: () => {
      clear();
      setOpen(null);
    }
  }), [open, openDelay, closeDelay, clear]);
}