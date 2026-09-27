import { useEffect, useRef } from 'react';
import { weavePointCount, weaveState, easeParams, projectWeave } from '../../lib/weave.js';
import { MODEL_WEAVE } from '../../lib/brand.js';

const TAU = Math.PI * 2;
const mounted = new Set();
const live = new Set();
let raf = 0;
let last = 0;
let palette = 0;
let paletteWatch = null;
let sightWatch = null;
let motionQuery = null;

function reduced() {
  if (!motionQuery && typeof matchMedia === 'function') {
    motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener?.('change', () => { for (const o of mounted) settle(o); });
  }
  return !!motionQuery?.matches;
}

function watchPalette() {
  if (paletteWatch || typeof MutationObserver === 'undefined') return;
  paletteWatch = new MutationObserver(() => {
    palette++;
    for (const o of mounted) if (!live.has(o)) paint(o);
  });
  paletteWatch.observe(document.documentElement, { attributes: true });
}

function sight() {
  if (!sightWatch && typeof IntersectionObserver !== 'undefined') {
    sightWatch = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const o = e.target.__weave;
        if (!o) continue;
        o.visible = e.isIntersecting;
        sync(o);
      }
    });
  }
  return sightWatch;
}

function readColors(o) {
  const cs = getComputedStyle(o.canvas);
  o.color = cs.color || '#888';
  o.colorsAt = palette;
}

function paint(o) {
  const { ctx, canvas } = o;
  if (!ctx || !canvas.width) return;
  if (o.colorsAt !== palette) readColors(o);
  const w = canvas.width;
  const h = canvas.height;
  const r = Math.min(w, h) * 0.38;
  const cx = w / 2;
  const cy = h / 2;
  const dot = Math.max(0.85 * o.dpr, r * 0.05);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = o.color;
  const proj = projectWeave(o.n, o.cur, o.clock, o.proj);
  if (o.order.length !== proj.length) o.order = proj.map((_, i) => i);
  o.order.sort((a, b) => proj[a].depth - proj[b].depth);
  for (const i of o.order) {
    const d = proj[i];
    const x = cx + d.x * r;
    const y = cy + d.y * r;
    const rad = dot * d.size;
    ctx.globalAlpha = d.alpha;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function tick(now) {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
  last = now;
  for (const o of live) {
    o.cur = easeParams(o.cur, o.target, dt);
    o.clock.angle += o.cur.spin * dt;
    o.clock.flow += o.cur.stream * dt;
    o.clock.time += dt;
    paint(o);
  }
  raf = live.size ? requestAnimationFrame(tick) : 0;
  if (!raf) last = 0;
}

function sync(o) {
  if (o.visible && !o.still && !reduced()) {
    live.add(o);
    if (!raf) raf = requestAnimationFrame(tick);
  } else {
    live.delete(o);
  }
}

function settle(o) {
  if (o.still || reduced()) {
    o.cur = o.target;
    paint(o);
  }
  sync(o);
}

function fit(o, cssW, cssH) {
  const { canvas } = o;
  if (!cssW || !cssH) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  o.n = weavePointCount(Math.min(cssW, cssH));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  o.dpr = dpr;
  paint(o);
}

export default function Weave({ state = 'idle', still = false, className = '', style }) {
  const ref = useRef(null);
  const inst = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const target = weaveState(state);
    const o = {
      canvas, ctx: canvas.getContext('2d'), n: 0, proj: [], order: [], dpr: 1,
      cur: weaveState('idle'), target, still, visible: true,
      clock: { time: Math.random() * 10, angle: Math.random() * TAU, flow: Math.random() },
      color: '', colorsAt: -1
    };
    canvas.__weave = o;
    inst.current = o;
    mounted.add(o);
    watchPalette();
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(([e]) => fit(o, e.contentRect.width, e.contentRect.height))
      : null;
    ro?.observe(canvas);
    sight()?.observe(canvas);
    return () => {
      ro?.disconnect();
      sightWatch?.unobserve(canvas);
      mounted.delete(o);
      live.delete(o);
      canvas.__weave = null;
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    const o = inst.current;
    if (!o) return;
    o.target = weaveState(state);
    o.still = still;
    settle(o);
  }, [state, still]);

  return <canvas ref={ref} className={'weave' + (className ? ' ' + className : '')} style={style} aria-hidden="true" />;
}

export function ModelMark({ src, state, still, className, style }) {
  if (!src) return null;
  if (src === MODEL_WEAVE) return <Weave state={state} still={still} className={className} style={style} />;
  return <img src={src} className={className || undefined} style={style} alt="" aria-hidden="true" />;
}
