import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const SUBMENU_CLOSE_DELAY = 160;

export function useSubmenus(opts = {}) {
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
    hoverOpen: (id) => {
      clear();
      setOpen(id);
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
  }), [open, closeDelay, clear]);
}
