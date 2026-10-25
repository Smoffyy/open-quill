import { useEffect, useRef, useState } from 'react';
import { simpleMotion } from '../../lib/motion.js';
import { createPortal } from 'react-dom';
import { springStep } from '../../lib/liquid.js';
import { fillDent, fitCanvas, resolveColor } from '../../lib/liquiddraw.js';
import { capture } from './usePull.jsx';
import { t } from '../../i18n.jsx';

const HEIGHT = 340;
const SHOW_LIST = 150;
const OPEN_SIDEBAR = 300;
const MAX = 360;

export default function SidebarPeek({ chats, onOpen, onExpand }) {
  const [drag, setDrag] = useState(null);
  const [hot, setHot] = useState(-1);
  const zone = useRef(null);
  const canvas = useRef(null);
  const list = useRef(null);
  const state = useRef({ w: 0, v: 0, target: 0, done: false });
  const frame = useRef(0);
  const fill = useRef('#000');
  const rows = chats.slice(0, 7);

  const draw = () => {
    const c = canvas.current;
    if (!c || !drag) return;
    const ctx = fitCanvas(c, { left: 0, top: drag.y - HEIGHT / 2 - 40, right: MAX + 60, bottom: drag.y + HEIGHT / 2 + 40 });
    const s = state.current;
    if (s.w < 0.5) return;
    ctx.fillStyle = fill.current;
    fillDent(ctx, { x: 2, y: drag.y, nx: 1, ny: 0, depth: Math.min(s.w * 0.25, 24), spread: 110, half: 200 });
    ctx.beginPath();
    ctx.roundRect(-24, drag.y - HEIGHT / 2, s.w + 24, HEIGHT, 18);
    ctx.fill();
  };

  const wake = () => {
    if (frame.current) return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const s = state.current;
      [s.w, s.v] = springStep(s.w, s.v, s.target, 260, 22, Math.min(0.05, (now - last) / 1000));
      if (simpleMotion()) [s.w, s.v] = [s.target, 0];
      last = now;
      if (list.current) {
        list.current.style.width = Math.max(0, s.w) + 'px';
        list.current.classList.toggle('on', s.w > SHOW_LIST && !s.done);
      }
      draw();
      const settled = Math.abs(s.w - s.target) < 0.3 && Math.abs(s.v) < 3;
      if (settled && s.done) { frame.current = 0; setDrag(null); return; }
      frame.current = settled ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onDown = (e) => {
    if (e.button !== 0) return;
    const y = Math.min(Math.max(e.clientY, HEIGHT / 2 + 12), window.innerHeight - HEIGHT / 2 - 12);
    fill.current = resolveColor(document.body, 'var(--sidebar)');
    state.current = { w: 0, v: 0, target: 0, done: false };
    setDrag({ y });
    setHot(-1);
    capture(zone.current, e.pointerId);
    const x0 = e.clientX;
    let picked = -1;
    const move = (ev) => {
      const s = state.current;
      s.target = Math.max(0, Math.min(MAX, (ev.clientX - x0) * 1.1));
      const items = list.current ? [...list.current.querySelectorAll('li')] : [];
      picked = s.w > SHOW_LIST ? items.findIndex(li => { const b = li.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom; }) : -1;
      setHot(picked);
      wake();
    };
    const up = () => {
      zone.current?.removeEventListener('pointermove', move);
      zone.current?.removeEventListener('pointerup', up);
      zone.current?.removeEventListener('pointercancel', up);
      const s = state.current;
      if (s.target > OPEN_SIDEBAR) onExpand();
      else if (picked >= 0 && rows[picked]) onOpen(rows[picked].id);
      s.done = true;
      s.target = 0;
      wake();
    };
    zone.current.addEventListener('pointermove', move);
    zone.current.addEventListener('pointerup', up);
    zone.current.addEventListener('pointercancel', up);
  };

  return (
    <>
      <div ref={zone} className="peek-zone" aria-hidden="true" onPointerDown={onDown}>
        <span className="lq-hint right" />
      </div>
      {drag && createPortal(
        <div className="lq-layer">
          <canvas ref={canvas} className="lq-canvas" aria-hidden="true" />
          <div ref={list} className="lq-peek" style={{ top: drag.y - HEIGHT / 2, height: HEIGHT }}>
            <div className="lq-peek-label">{t('Recents')}</div>
            <ul>
              {rows.map((c, i) => <li key={c.id} className={i === hot ? 'hot' : ''}>{c.title || t('New chat')}</li>)}
            </ul>
            <div className="lq-peek-hint">{t('Keep pulling to open the sidebar')}</div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}