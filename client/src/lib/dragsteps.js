import { useRef, useState } from 'react';

export const DRAG_SLOP = 3;
export const STRETCH_PX = 5;
export const STRETCH_PULL = 26;
export const SQUASH_GIVE = 0.45;

export function clampPx(x, min, max) {
  if (!(max > min)) return min;
  return Math.min(max, Math.max(min, x));
}

export function knobRaw(clientX, rect, inset, knob) {
  return clientX - rect.left - inset - knob / 2;
}

export function knobTravel(rect, inset, knob) {
  return Math.max(0, rect.width - inset * 2 - knob);
}

export function knobAt(clientX, rect, inset, knob) {
  return clampPx(knobRaw(clientX, rect, inset, knob), 0, knobTravel(rect, inset, knob));
}

export function overshoot(raw, min, max) {
  if (raw < min) return raw - min;
  if (raw > max) return raw - max;
  return 0;
}

export function stretchFor(over, width, maxPx = STRETCH_PX, pull = STRETCH_PULL) {
  const d = Math.abs(over);
  if (!(d > 0) || !(width > 0)) return 1;
  return 1 + (maxPx / width) * (1 - Math.exp(-d / pull));
}

export function stretchOrigin(over) {
  return over > 0 ? 'right center' : 'left center';
}

export function squashFor(stretch, give = SQUASH_GIVE) {
  if (!(stretch > 1)) return 1;
  return 1 / Math.pow(stretch, give);
}

export function nearestIndex(stops, x) {
  if (!Array.isArray(stops) || !stops.length) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const d = Math.abs(x - (stops[i].x + stops[i].w / 2));
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function measureStops(el, selector) {
  if (!el) return [];
  return [...el.querySelectorAll(selector)].map(n => ({ x: n.offsetLeft, w: n.offsetWidth }));
}

export function usePointerDrag({ onTrack, onEnd, disabled }) {
  const live = useRef(false);
  const from = useRef(0);
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);

  const finish = (e) => {
    if (!live.current) return;
    live.current = false;
    setDragging(false);
    if (onEnd) onEnd(moved.current, e);
  };

  return {
    dragging,
    bind: {
      onPointerDown: (e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        live.current = true;
        from.current = e.clientX;
        moved.current = false;
        setDragging(true);
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture unavailable */ }
        if (onTrack) onTrack(e, false);
      },
      onPointerMove: (e) => {
        if (!live.current) return;
        if (Math.abs(e.clientX - from.current) > DRAG_SLOP) moved.current = true;
        if (onTrack) onTrack(e, true);
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onClick: (e) => { e.stopPropagation(); }
    }
  };
}
