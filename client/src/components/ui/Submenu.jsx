import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function Flyout({ anchorRef, className, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const pad = 8;
    const gap = 8;
    const row = anchorRef.current.getBoundingClientRect();
    const el = ref.current;
    const flip = row.right + gap + el.offsetWidth > window.innerWidth - pad;
    const left = Math.max(pad, flip ? row.left - gap - el.offsetWidth : row.right + gap);
    const top = Math.max(pad, Math.min(row.top - 4, window.innerHeight - pad - el.offsetHeight));
    setPos({ top, left });
  }, [anchorRef]);
  return createPortal(
    <div ref={ref} className={className} role="menu"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}>
      {children}
    </div>, document.body);
}

export function SubItem({ id, sub, wrapClass, flyoutClass, trigger, children }) {
  const rowRef = useRef(null);
  const enter = () => sub.hoverOpen(id);
  return (
    <div className={wrapClass} ref={rowRef} onMouseEnter={enter} onMouseLeave={sub.hoverClose}>
      {trigger({ open: sub.isOpen(id), onClick: () => sub.show(id) })}
      {sub.isOpen(id) && <Flyout anchorRef={rowRef} className={flyoutClass}>{children}</Flyout>}
    </div>
  );
}