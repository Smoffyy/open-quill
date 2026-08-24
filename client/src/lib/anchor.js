import { useState, useEffect, useLayoutEffect } from 'react';

export const MENU_EDGE = 8;
export const MENU_GAP = 6;

// A scroll anywhere else means the anchor has moved, so the menu closes rather than trying
// to follow it. A scroll *inside* the menu is the opposite: once the height is capped the
// menu is its own scroll container, and closing on that made the cap unusable — the list
// vanished the moment you tried to reach the items it had scrolled out of view. The scroll
// listener is capture-phase on window, so it sees those inner scrolls too and must skip them.
export function scrollInsideMenu(menu, target) {
  if (!menu || !target) return false;
  if (menu === target) return true;
  return typeof menu.contains === 'function' && menu.contains(target);
}

export function useAnchoredMenu(open, setOpen, btnRef, menuRef, opts) {
  const align = (opts && opts.align) || 'right';
  const minW = (opts && opts.minWidth) || 0;
  const gap = (opts && typeof opts.gap === 'number') ? opts.gap : MENU_GAP;
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const away = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = (e) => { if (!scrollInsideMenu(menuRef.current, e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    const mw = Math.max(minW, menu ? menu.offsetWidth : 200);
    const nat = menu ? menu.scrollHeight + (menu.offsetHeight - menu.clientHeight) : 220;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const below = vh - r.bottom - gap - MENU_EDGE;
    const above = r.top - gap - MENU_EDGE;
    const up = nat > below && above > below;
    const maxH = Math.min(nat, Math.max(120, up ? above : below));
    const top = up ? Math.max(MENU_EDGE, r.top - gap - maxH) : Math.min(r.bottom + gap, vh - MENU_EDGE - maxH);
    const want = align === 'left' ? r.left : r.right - mw;
    const left = Math.min(Math.max(MENU_EDGE, want), Math.max(MENU_EDGE, vw - MENU_EDGE - mw));
    setPos({ top: Math.round(top), left: Math.round(left), maxH: nat > maxH ? Math.round(maxH) : 0, minW: mw });
  }, [open]);
  return pos;
}

export function menuStyleOf(pos, extra) {
  return {
    position: 'fixed',
    top: pos ? pos.top : -9999,
    left: pos ? pos.left : -9999,
    right: 'auto',
    bottom: 'auto',
    maxHeight: pos && pos.maxH ? pos.maxH : undefined,
    overflow: pos && pos.maxH ? 'hidden auto' : undefined,
    visibility: pos ? 'visible' : 'hidden',
    zIndex: 200,
    ...extra
  };
}
