import { useEffect, useRef } from 'react';
import { panelRect, usePull } from './usePull.jsx';

const LIMIT = 110;
const FIRE = 70;
const SETTLE_MS = 160;

export default function PullToSearch({ scrollRef, onFire }) {
  const pull = usePull('var(--sidebar)', { rim: 'var(--frame-edge, var(--border-soft))', spread: 40, half: 120 });
  const fire = useRef(onFire);
  fire.current = onFire;
  const api = useRef(pull);
  api.current = pull;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let amount = 0;
    let pulling = false;
    let timer = 0;
    let touchY = null;
    const finish = () => {
      const go = amount >= FIRE;
      api.current.end(go);
      pulling = false;
      amount = 0;
      if (go) setTimeout(() => fire.current(), 140);
    };
    const add = (delta) => {
      if (!pulling) {
        pulling = true;
        const r = panelRect();
        api.current.begin({ x: r.left + r.width / 2, y: r.top - 3, nx: 0, ny: 1 });
      }
      amount = Math.min(LIMIT, amount + delta);
      api.current.update(amount);
      clearTimeout(timer);
      timer = setTimeout(finish, SETTLE_MS);
    };
    const wheel = (e) => {
      if (el.scrollTop > 0 || e.deltaY >= 0 || e.ctrlKey) return;
      e.preventDefault();
      add(Math.min(30, -e.deltaY * 0.35));
    };
    const touchStart = (e) => { touchY = el.scrollTop <= 0 ? e.touches[0].clientY : null; };
    const touchMove = (e) => {
      if (touchY === null) return;
      const want = (e.touches[0].clientY - touchY) * 0.6;
      if (want > amount) add(want - amount);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('touchstart', touchStart, { passive: true });
    el.addEventListener('touchmove', touchMove, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('touchstart', touchStart);
      el.removeEventListener('touchmove', touchMove);
    };
  }, [scrollRef]);

  return pull.node;
}