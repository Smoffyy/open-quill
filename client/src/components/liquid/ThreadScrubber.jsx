import { useEffect, useRef, useState } from 'react';
import { simpleMotion } from '../../lib/motion.js';
import { createPortal } from 'react-dom';
import { springStep } from '../../lib/liquid.js';
import { fillDent, fillDrop, fitCanvas, resolveColor } from '../../lib/liquiddraw.js';
import { capture, panelRect } from './usePull.jsx';


export default function ThreadScrubber({ scrollRef }) {
  const [scrub, setScrub] = useState(null);
  const zone = useRef(null);
  const canvas = useRef(null);
  const tip = useRef(null);
  const state = useRef(null);
  const frame = useRef(0);
  const fill = useRef('#000');

  const draw = () => {
    const c = canvas.current, s = state.current;
    if (!c || !s) return;
    const ctx = fitCanvas(c, { left: s.edge - 90, top: Math.min(s.y, ...s.marks) - 50, right: s.edge + 20, bottom: Math.max(s.y, ...s.marks) + 50 });
    if (s.vol <= 0) return;
    ctx.fillStyle = fill.current;
    for (const y of s.marks) fillDent(ctx, { x: s.edge, y, nx: -1, ny: 0, depth: 3 * s.vol, spread: 5, half: 14 });
    const r = 13 * Math.sqrt(s.vol);
    const e = Math.min(0.5, Math.abs(s.vy) * 0.0015);
    fillDent(ctx, { x: s.edge, y: s.y, nx: -1, ny: 0, depth: 10 * s.vol, spread: 14, half: 40 });
    fillDrop(ctx, s.edge - 9 - r * 0.6, s.y, r / Math.sqrt(1 + e), r * Math.sqrt(1 + e), 0);
  };

  const wake = () => {
    if (frame.current) return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const s = state.current;
      if (!s) { frame.current = 0; return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      [s.y, s.vy] = springStep(s.y, s.vy, s.target, 420, 26, dt);
      s.vol = s.done ? Math.max(0, s.vol - dt / 0.16) : Math.min(1, s.vol + dt / 0.12);
      draw();
      if (s.done && s.vol <= 0) { frame.current = 0; state.current = null; setScrub(null); return; }
      const still = Math.abs(s.y - s.target) < 0.2 && Math.abs(s.vy) < 2 && s.vol >= 1;
      frame.current = still ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onDown = (e) => {
    const scroller = scrollRef.current;
    if (e.button !== 0 || !scroller) return;
    const users = [...scroller.querySelectorAll('.msg.user')];
    if (users.length < 2) return;
    const z = zone.current.getBoundingClientRect();
    const marks = users.map((_, i) => z.top + 18 + (z.height - 36) * (i / (users.length - 1)));
    fill.current = resolveColor(document.body, 'var(--sidebar)');
    state.current = { marks, edge: panelRect().right, y: e.clientY, vy: 0, target: e.clientY, vol: 0, done: false, at: -1 };
    setScrub({ users });
    capture(zone.current, e.pointerId);
    const go = (y) => {
      const s = state.current;
      let best = 0;
      marks.forEach((m, i) => { if (Math.abs(m - y) < Math.abs(marks[best] - y)) best = i; });
      if (best === s.at && tip.current && tip.current.classList.contains('on')) return;
      s.at = best;
      s.target = marks[best];
      const el = users[best];
      const text = (el.querySelector('.bubble-user-text') || el).textContent.trim();
      if (tip.current) {
        tip.current.textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;
        tip.current.style.top = marks[best] + 'px';
        tip.current.style.right = (window.innerWidth - s.edge + 34) + 'px';
        tip.current.classList.add('on');
      }
      const top = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
      scroller.scrollTo({ top, behavior: simpleMotion() ? 'auto' : 'smooth' });
    };
    requestAnimationFrame(() => go(e.clientY));
    const move = (ev) => { go(ev.clientY); wake(); };
    const up = () => {
      zone.current?.removeEventListener('pointermove', move);
      zone.current?.removeEventListener('pointerup', up);
      zone.current?.removeEventListener('pointercancel', up);
      if (state.current) state.current.done = true;
      if (tip.current) tip.current.classList.remove('on');
      wake();
    };
    zone.current.addEventListener('pointermove', move);
    zone.current.addEventListener('pointerup', up);
    zone.current.addEventListener('pointercancel', up);
    wake();
  };

  return (
    <>
      <div ref={zone} className="scrub-zone" aria-hidden="true" onPointerDown={onDown}>
        <span className="lq-hint up" />
        <span className="lq-hint down" />
      </div>
      {scrub && createPortal(
        <div className="lq-layer">
          <canvas ref={canvas} className="lq-canvas" aria-hidden="true" />
          <div ref={tip} className="lq-scrub-tip" />
        </div>,
        document.body
      )}
    </>
  );
}