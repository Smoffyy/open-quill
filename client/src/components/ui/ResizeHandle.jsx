import { useRef, useEffect } from 'react';
import Tip from './Tip.jsx';
import { t } from '../../i18n.jsx';

const DRAG_THRESHOLD = 3;
const HIDE_DELAY = 400;

export function storedWidth(key, clamp) {
  try {
    const n = parseInt(localStorage.getItem(key), 10);
    if (Number.isFinite(n)) return clamp(n);
  } catch { }
  return null;
}

export default function ResizeHandle({ targetRef, clamp, storageKey, edge = 'right', className, label, hideLabel, onCommit, onHide }) {
  const drag = useRef(null);
  const tap = useRef(0);
  const dir = edge === 'right' ? 1 : -1;

  useEffect(() => () => {
    clearTimeout(tap.current);
    document.body.classList.remove('resizing-x');
  }, []);

  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      const el = targetRef.current;
      if (!d || !el) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      d.moved = true;
      el.style.width = clamp(d.w + dx * dir) + 'px';
    };
    const up = (e) => {
      const el = targetRef.current;
      const d = drag.current;
      if (!d || !el) return;
      drag.current = null;
      el.style.transition = '';
      document.body.classList.remove('resizing-x');
      d.handle.classList.remove('dragging');
      if (!d.moved) {
        if (e.type === 'pointerup' && onHide) tap.current = setTimeout(onHide, HIDE_DELAY);
        return;
      }
      const w = Math.round(el.getBoundingClientRect().width);
      try { localStorage.setItem(storageKey, String(w)); } catch { }
      if (onCommit) onCommit(w);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [targetRef, clamp, dir, storageKey, onCommit, onHide]);

  const start = (e) => {
    const el = targetRef.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    clearTimeout(tap.current);
    drag.current = { x: e.clientX, w: el.getBoundingClientRect().width, moved: false, handle: e.currentTarget };
    el.style.transition = 'none';
    e.currentTarget.classList.add('dragging');
    document.body.classList.add('resizing-x');
  };

  const setWidth = (w) => {
    const el = targetRef.current;
    if (!el) return;
    if (w == null) {
      el.style.width = '';
      try { localStorage.removeItem(storageKey); } catch { }
    } else {
      el.style.width = w + 'px';
      try { localStorage.setItem(storageKey, String(w)); } catch { }
    }
    if (onCommit) onCommit(w);
  };

  const reset = () => {
    clearTimeout(tap.current);
    setWidth(null);
  };

  const nudge = (e) => {
    const el = targetRef.current;
    if (e.key === 'Enter' && onHide) { e.preventDefault(); onHide(); return; }
    if (!el || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const step = (e.shiftKey ? 32 : 8) * dir;
    setWidth(clamp(Math.round(el.getBoundingClientRect().width) + (e.key === 'ArrowRight' ? step : -step)));
  };

  return (
    <Tip label={hideLabel} keys={t('Drag to resize')}>
      <div className={'resize-handle ' + className} role="separator" aria-orientation="vertical" aria-label={label}
        tabIndex={0} onPointerDown={start} onDoubleClick={reset} onKeyDown={nudge}>
        <span className="resize-handle-grip" aria-hidden="true" />
      </div>
    </Tip>
  );
}