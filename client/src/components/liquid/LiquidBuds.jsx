import { useEffect, useRef, useState } from 'react';
import { simpleMotion } from '../../lib/motion.js';
import { createPortal } from 'react-dom';
import { budCenter, budShape, createBud, grabBud, leaveBud, releaseBud, stepBud } from '../../lib/liquid.js';
import { aroundPoints, fitCanvas, paintLiquid, resolveColor } from '../../lib/liquiddraw.js';
import { useDismiss } from '../../lib/dismiss.js';
import { capture } from './usePull.jsx';

export const BUD_SIZE = 44;
export const BUD_GAP = 54;
const CORE = 18;

let activeRing = null;


function rest(s) {
  s.phase = 'formed';
  s.neck = 0;
  s.drop.vol = 1;
  s.drop.x = s.tx;
  s.drop.y = s.ty;
}

export default function LiquidBuds({ open, source, targets, items, color, rim, membrane = true, limit = Infinity, label, trigger, focusFirst, closeOnScroll, onClose }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const canvas = useRef(null);
  const wrap = useRef(null);
  const buttons = useRef([]);
  const sims = useRef([]);
  const fill = useRef('#000');
  const edge = useRef(null);
  const frame = useRef(0);
  const focused = useRef(false);
  const closing = useRef(false);
  const dragged = useRef(false);
  const lastCore = useRef(0);
  const shown = useRef({ open: false, source: null });
  const area = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const live = useRef(null);
  live.current = { source, membrane, focusFirst };

  useDismiss(open, () => close.current?.(), trigger ? [wrap, trigger] : wrap);

  useEffect(() => {
    if (!open || !closeOnScroll) return undefined;
    const away = (e) => {
      if (!wrap.current || !(e.target instanceof Node) || !wrap.current.contains(e.target)) close.current?.();
    };
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open, closeOnScroll]);

  const draw = () => {
    const c = canvas.current;
    if (!c || !area.current) return;
    const { source, membrane } = live.current;
    const ctx = fitCanvas(c, area.current);
    let dent = 0, held = 0;
    const necks = [], drops = [];
    for (const s of sims.current) {
      dent = Math.max(dent, s.mem.d);
      held += s.neck * s.drop.vol;
      const shape = budShape(s);
      if (shape.neck) necks.push(shape.neck);
      if (shape.bridge) necks.push(shape.bridge);
      if (shape.drop) drops.push(shape.drop);
      if (shape.head) drops.push(shape.head);
    }
    let core = source.core && sims.current.length ? CORE * Math.sqrt(held / sims.current.length) : 0;
    if (closing.current) core = Math.min(core, lastCore.current);
    lastCore.current = core;
    if (core > 0.5) drops.push({ x: source.x, y: source.y, rx: core, ry: core, angle: 0 });
    const dents = membrane && dent > 0.2
      ? [{ ...source, depth: dent, spread: source.spread || 30, half: Math.min(source.half || 80, source.surface ? source.surface.length / 4 : Infinity) }]
      : [];
    paintLiquid(ctx, { fill: fill.current, rim: edge.current, dents, necks, drops });
  };

  const place = () => {
    const { focusFirst } = live.current;
    sims.current.forEach((s, i) => {
      const el = buttons.current[i];
      if (!el) return;
      const [x, y] = budCenter(s);
      el.style.transform = 'translate(' + (x - BUD_SIZE / 2) + 'px, ' + (y - BUD_SIZE / 2) + 'px)';
      const drop = budShape(s).drop;
      if (drop) {
        el.style.setProperty('--lq-sx', drop.rx / s.R);
        el.style.setProperty('--lq-sy', drop.ry / s.R);
        el.style.setProperty('--lq-rot', drop.angle + 'rad');
      }
      const on = !closing.current && (s.phase === 'free' || s.phase === 'formed');
      el.classList.toggle('on', on);
      if (on && i === 0 && focusFirst && !focused.current) {
        focused.current = true;
        el.focus({ preventScroll: true });
      }
    });
  };

  const wake = () => {
    if (frame.current) return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      let active = false;
      for (const s of sims.current) if (stepBud(s, (now - last) / 1000)) active = true;
      last = now;
      place();
      draw();
      if (closing.current && sims.current.every(s => s.phase === 'gone')) {
        frame.current = 0;
        setMounted(false);
        return;
      }
      frame.current = active ? requestAnimationFrame(tick) : 0;
    };
    frame.current = requestAnimationFrame(tick);
  };

  const tint = () => {
    const edgeValue = typeof rim === 'function' ? rim() : rim;
    fill.current = resolveColor(document.body, color);
    edge.current = edgeValue ? resolveColor(document.body, edgeValue) : null;
  };

  const vanish = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    sims.current = [];
    setMounted(false);
    close.current?.();
  };
  const self = useRef(vanish);
  self.current = vanish;

  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    if (activeRing === self) activeRing = null;
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const observer = new MutationObserver(() => { tint(); draw(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
    return () => observer.disconnect();
  }, [open]);

  const budAt = (i, delay) => {
    const p = targets[i];
    return createBud({
      sx: source.x, sy: source.y, nx: p.nx ?? source.nx, ny: p.ny ?? source.ny, tx: p.x, ty: p.y,
      size: BUD_SIZE, surface: source.surface, u: source.u, delay
    });
  };

  useEffect(() => {
    if (!mounted) return;
    const want = open ? Math.min(limit, targets.length) : 0;
    const fresh = open && (!shown.current.open || shown.current.source !== source);
    shown.current = { open, source };
    if (fresh) {
      focused.current = false;
      tint();
      area.current = aroundPoints([source, ...targets], Math.max(BUD_SIZE + 60, (source.half || 80) + 12));
      sims.current = targets.map((_, i) => Object.assign(budAt(i, 0), { phase: 'gone' }));
      if (source.core) {
        if (activeRing && activeRing !== self) activeRing.current();
        activeRing = self;
      }
    }
    closing.current = want === 0;
    const stagger = source.core ? 0.025 : 0.05;
    let order = 0;
    sims.current.forEach((s, i) => {
      const live = s.phase !== 'gone' && s.phase !== 'leaving' && s.phase !== 'draining';
      if (i < want && !live) {
        sims.current[i] = budAt(i, order++ * stagger);
        if (simpleMotion()) rest(sims.current[i]);
      } else if (i >= want && live) {
        leaveBud(s, want ? 0 : (sims.current.length - 1 - i) * 0.035);
        if (simpleMotion()) s.phase = 'gone';
      }
    });
    wake();
  }, [open, mounted, limit, source]);

  const stretch = (e, i) => {
    const s = sims.current[i];
    if (e.button !== 0 || !s || closing.current || simpleMotion()) return;
    const el = e.currentTarget;
    const x0 = e.clientX, y0 = e.clientY;
    dragged.current = false;
    capture(el, e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (Math.hypot(dx, dy) > 5) dragged.current = true;
      grabBud(s, dx, dy);
      wake();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      releaseBud(s);
      wake();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onKey = (e) => {
    const list = buttons.current.filter(Boolean);
    const at = list.indexOf(document.activeElement);
    if (at === -1) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    list[(at + step + list.length) % list.length].focus();
  };

  if (!mounted) return null;
  return createPortal(
    <div className="lq-layer">
      <canvas ref={canvas} className="lq-canvas" aria-hidden="true" />
      <div ref={wrap} className="lq-buds" role="toolbar" aria-label={label} onKeyDown={onKey}>
        {items.map((it, i) => (
          <button key={it.id} ref={(el) => { buttons.current[i] = el; }} type="button"
            className={'lq-bud' + (it.active ? ' active' : '') + (it.danger ? ' danger' : '')}
            aria-label={it.label} aria-pressed={it.toggle ? !!it.active : undefined} data-tip={it.label} disabled={!!it.disabled}
            onPointerDown={(e) => stretch(e, i)}
            onClick={() => {
              if (dragged.current) { dragged.current = false; return; }
              it.run();
              if (!it.keep) close.current?.();
            }}>
            {it.icon}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}