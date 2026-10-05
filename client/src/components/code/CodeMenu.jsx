import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredMenu, menuStyleOf } from '../../lib/anchor.js';
import { Check, Chevron } from '../ui/icons.jsx';

export default function CodeMenu({ open, setOpen, anchorRef, align = 'left', label, className = '', children }) {
  const menuRef = useRef(null);
  const pos = useAnchoredMenu(open, setOpen, anchorRef, menuRef, { align, gap: 4 });
  if (!open) return null;
  return createPortal(
    <div ref={menuRef} className={'cx-menu' + (className ? ' ' + className : '')} role="menu" aria-label={label} style={menuStyleOf(pos)}>
      {children}
    </div>,
    document.body
  );
}

export function MenuItem({ onClick, danger, disabled, kbd, checked, desc, sub, icon, children }) {
  return (
    <button type="button" role={checked == null ? 'menuitem' : 'menuitemradio'} aria-checked={checked == null ? undefined : !!checked}
      className={'cx-mi' + (danger ? ' danger' : '') + (desc ? ' two' : '')} disabled={disabled} onClick={onClick}>
      {icon && <span className="cx-mi-ic">{icon}</span>}
      <span className="cx-mi-main">
        <span className="cx-mi-label">{children}</span>
        {desc && <span className="cx-mi-desc">{desc}</span>}
      </span>
      {checked && <Check className="cx-mi-check" />}
      {kbd && <kbd className="cx-mi-kbd">{kbd}</kbd>}
      {sub && <Chevron className="cx-mi-sub" />}
    </button>
  );
}

export function MenuLabel({ children }) {
  return <div className="cx-mlabel">{children}</div>;
}

export function MenuSep() {
  return <div className="cx-msep" role="separator" />;
}