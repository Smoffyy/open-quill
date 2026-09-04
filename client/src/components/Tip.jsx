import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const DELAY = 350;
const GRACE = 400;
const GAP = 5.3;
const EDGE = 8;

let lastClosed = 0;

export default function Tip({ label, keys, side, tone, disabled, children }) {
  const hostRef = useRef(null);
  const tipRef = useRef(null);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);

  const close = useCallback(() => {
    clearTimeout(timer.current);
    if (open) lastClosed = Date.now();
    setOpen(false);
    setPos(null);
  }, [open]);

  const show = useCallback(() => {
    if (disabled || !label) return;
    clearTimeout(timer.current);
    const wait = Date.now() - lastClosed < GRACE ? 0 : DELAY;
    timer.current = setTimeout(() => setOpen(true), wait);
  }, [disabled, label]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => close();
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    document.addEventListener('mousedown', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('mousedown', dismiss);
    };
  }, [open, close]);

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
    <span className="tip-host" ref={hostRef}
      onMouseEnter={show} onMouseLeave={close}
      onPointerDownCapture={close}
      onFocusCapture={(e) => { if (e.target.matches?.(':focus-visible')) show(); }}
      onBlurCapture={close}
      onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
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
