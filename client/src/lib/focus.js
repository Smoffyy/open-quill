import { useEffect, useRef } from 'react';
import { useLayer } from './dismiss.js';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',');

function visible(el) {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

export function focusablesIn(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(visible);
}

const FIELDS = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])';

export function focusFirstIn(root, fallback, preferField = false) {
  const list = focusablesIn(root);
  const field = preferField ? list.find(el => el.matches(FIELDS)) : null;
  const target = field || list[0] || fallback || root;
  if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
}

export function useFocusTrap(ref, onClose, options) {
  const opts = options || {};
  const closeRef = useRef(onClose);
  const returnRef = useRef(null);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useLayer(true, (e) => { if (opts.escape !== false) closeRef.current?.(e); }, { modal: true });
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    returnRef.current = document.activeElement;
    if (opts.autoFocus !== false) {
      const seed = opts.initial && opts.initial.current ? opts.initial.current : null;
      if (seed && typeof seed.focus === 'function') seed.focus({ preventScroll: true });
      else focusFirstIn(root, root, !!opts.field);
    }
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const list = focusablesIn(root);
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) { e.preventDefault(); first.focus({ preventScroll: true }); return; }
      if (active === root) { e.preventDefault(); (e.shiftKey ? last : first).focus({ preventScroll: true }); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus({ preventScroll: true }); }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      const back = returnRef.current;
      if (back && document.body.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
    };
  }, [ref, opts.autoFocus, opts.field, opts.initial]);
}
