import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const DELAY = 350;
const GRACE = 400;
const GAP = 5.3;
const EDGE = 8;

let lastClosed = 0;

export default function Tip({ label, keys, side, tone, disabled, toggle, children }) {
  const hostRef = useRef(null);
  const tipRef = useRef(null);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState(null);

  const closeAll = useCallback(() => {
    clearTimeout(timer.current);
    if (open) lastClosed = Date.now();
    setOpen(false);
    setPinned(false);
    setPos(null);
  }, [open]);

  const closeHover = useCallback(() => {
    if (pinned) return;
    clearTimeout(timer.current);
    if (open) lastClosed = Date.now();
    setOpen(false);
    setPos(null);
  }, [open, pinned]);

  const show = useCallback(() => {
    if (disabled || !label) return;
    clearTimeout(timer.current);
    const wait = Date.now() - lastClosed < GRACE ? 0 : DELAY;
    timer.current = setTimeout(() => setOpen(true), wait);
  }, [disabled, label]);

  const handleToggleClick = useCallback(() => {
    if (pinned) {
      closeAll();
    } else {
      clearTimeout(timer.current);
      setOpen(true);
      setPinned(true);
    }
  }, [pinned, closeAll]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e) => {
      if (e.target && hostRef.current?.contains(e.target)) return;
      closeAll();
    };
    const onDismiss = () => closeAll();
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    document.addEventListener('mousedown', onOutside);
    return () => {
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [open, closeAll]);

  useEffect(() => {
    if (!open) return;
    const anchor = hostRef.current?.firstElementChild;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const below = side !== 'top' && a.bottom + GAP + h + EDGE <= window.innerHeight;
    const top = below ? a.bottom + GAP : Math.max(EDGE, a.top - GAP - h);
    let left = a.left + a.width / 2 - w / 2;
    left = Math.min(Math.max(EDGE, left), window.innerWidth - w - EDGE);
    setPos({ top, left });
  }, [open, side]);

  return (
    <span className={'tip-host' + (pinned ? ' tip-pinned' : '')} ref={hostRef}
      onMouseEnter={show} onMouseLeave={toggle ? closeHover : closeAll}
      onPointerDownCapture={(e) => { if (toggle && hostRef.current?.contains(e.target)) return; closeAll(); }}
      onClick={toggle ? handleToggleClick : undefined}
      onFocusCapture={(e) => { if (e.target.matches?.(':focus-visible')) show(); }}
      onBlurCapture={closeAll}
      onKeyDown={(e) => { if (e.key === 'Escape') closeAll(); }}>
      {children}
      {open && label && createPortal(
        <div className={'tip' + (tone ? ' tip-' + tone : '')} role="tooltip" ref={tipRef}
          style={pos ? { top: pos.top, left: pos.left } : { opacity: 0, top: 0, left: 0 }}>
          <span className="tip-label">{label}</span>
          {keys && <span className="tip-keys">{keys}</span>}
        </div>, document.body)}
    </span>
  );
}
