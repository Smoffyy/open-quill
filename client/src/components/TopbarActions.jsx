import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Dots } from './icons.jsx';
import { t } from '../i18n.jsx';
import { useAnchoredMenu, menuStyleOf } from '../lib/anchor.js';

function MoreMenu({ btnRef, items, onClose }) {
  const menuRef = useRef(null);
  const pos = useAnchoredMenu(true, onClose, btnRef, menuRef, { align: 'right', gap: 6, minWidth: 232 });
  return createPortal(
    <div className="popover tb-more" ref={menuRef} role="menu" style={menuStyleOf(pos, { width: 232 })}>
      {items.map(it => (
        <button key={it.id} role="menuitem" className={it.active ? 'on' : undefined} disabled={it.disabled}
          onClick={() => { onClose(); it.onClick(); }}>
          {it.icon}
          <span className="tb-more-label">{it.label}</span>
          {it.badge ? <span className="tb-more-badge">{it.badge}</span> : null}
        </button>
      ))}
    </div>, document.body);
}

// The topbar keeps one always-visible button (incognito) and folds the rest into a single
// menu, so the greeting and a live chat show the same two controls at the same size.
export default function TopbarActions({ leading, items, className }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const list = (items || []).filter(Boolean);
  return (
    <div className={'topbar-actions' + (className ? ' ' + className : '')}>
      {leading}
      {list.length > 0 && (
        <button ref={btnRef} className={'paper-btn' + (open ? ' active' : '')} onClick={() => setOpen(o => !o)}
          title={t('More')} aria-label={t('More')} aria-haspopup="menu" aria-expanded={open}>
          <Dots />
        </button>
      )}
      {open && list.length > 0 && <MoreMenu btnRef={btnRef} items={list} onClose={() => setOpen(false)} />}
    </div>
  );
}
