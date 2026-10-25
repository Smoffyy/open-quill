import { useCallback, useEffect, useRef, useState } from 'react';
import { simpleMotion } from '../../lib/motion.js';
import { createPortal } from 'react-dom';
import { createPull, pullShape, releasePull, setPull, stepPull } from '../../lib/liquid.js';
import { aroundPoints, fitCanvas, paintLiquid, resolveColor } from '../../lib/liquiddraw.js';


export function usePull(color, { rim, spread = 36, half = 100 } = {}) {
  const [active, setActive] = useState(false);
  const canvas = useRef(null);
  const sim = useRef(null);
  const source = useRef(null);
  const fill = useRef('#000');
  const edge = useRef(null);
  const frame = useRef(0);

  const draw = useCallback(() => {
    const c = canvas.current, p = sim.current, s = source.current;
    if (!c || !p || !s) return;
    const ctx = fitCanvas(c, aroundPoints([s], Math.max(half + 12, 240)));
    const shape = pullShape(p);
    paintLiquid(ctx, {
      fill: fill.current,
      rim: edge.current,
      dents: shape.dent > 0.2 ? [{ x: s.x, y: s.y, nx: s.nx, ny: s.ny, depth: shape.dent, spread, half }] : [],
      necks: shape.neck ? [shape.neck] : [],
      drops: shape.drop ? [shape.drop] : []
    });
  }, [spread, half]);

  const wake = useCallback(() => {
    if (frame.current) return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const p = sim.current;
      const moving = p ? stepPull(p, (now - last) / 1000) : false;
      last = now;
      draw();
      if (!moving) {
        frame.current = 0;
        if (p && p.phase === 'idle') { sim.current = null; setActive(false); }
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [draw]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const begin = useCallback((at) => {
    if (simpleMotion()) return;
    source.current = at;
    fill.current = resolveColor(document.body, color);
    edge.current = rim ? resolveColor(document.body, rim) : null;
    sim.current = createPull({ sx: at.x, sy: at.y, nx: at.nx, ny: at.ny, size: 30 });
    setActive(true);
  }, [color, rim]);

  const update = useCallback((amount) => {
    if (!sim.current) return;
    setPull(sim.current, amount);
    wake();
  }, [wake]);

  const end = useCallback((fire) => {
    if (!sim.current) return;
    releasePull(sim.current, fire);
    wake();
  }, [wake]);

  const node = active ? createPortal(<canvas ref={canvas} className="lq-pull" aria-hidden="true" />, document.body) : null;
  return { node, begin, update, end };
}

export function panelRect() {
  const main = document.querySelector('.main');
  return main ? main.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
}

export function capture(el, id) {
  try { el.setPointerCapture(id); } catch { }
}