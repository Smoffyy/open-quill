import { useRef } from 'react';

export function useLongPress(onPress, delay = 450) {
  const press = useRef(null);
  const cb = useRef(onPress);
  cb.current = onPress;
  const cancel = () => {
    if (!press.current) return;
    clearTimeout(press.current.timer);
    press.current = null;
  };
  return {
    onPointerDown(e) {
      if (e.pointerType !== 'touch') return;
      cancel();
      const { target, clientX, clientY } = e;
      const timer = setTimeout(() => { press.current = null; cb.current(target, clientX, clientY); }, delay);
      press.current = { x: clientX, y: clientY, timer };
    },
    onPointerMove(e) {
      if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel
  };
}