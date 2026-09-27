// The canvas side of the weave. The shapes and the math live in
// `lib/weave.js`; read the long comment at the top of that file first. This
// file only draws what `projectWeave` returns, and decides when to draw.
//
// Design decisions worth knowing before changing anything here:
//
// - One animation loop for every mark on the page. A long thread can hold
//   several marks, and one requestAnimationFrame driving all of them is far
//   cheaper than one each. `live` is the set the loop animates; it stops
//   itself when the set is empty.
// - A mark only animates while it is on screen (IntersectionObserver), is not
//   `still`, and the user has not asked for reduced motion. Otherwise it is
//   painted once in its final shape and left alone.
// - The colour comes from CSS `color` on the canvas (`.weave` in
//   `styles/weave.css` sets it to var(--text)), so the mark follows the theme
//   and preset without knowing about either. There is no accent colour on
//   purpose. The colour is re-read only when <html> changes attributes, which
//   is how theme and preset switches are made, not every frame.
// - Every mark starts in the idle shape and eases toward the state it was
//   given. A new reply therefore visibly grows from the idle braid into the
//   generating ribbon instead of appearing already mid-state.
//
// The component is only used through `ModelMark` at the bottom of this file,
// which falls back to a plain <img> for any icon that is not the weave.

import { useEffect, useRef } from 'react';
import { weavePointCount, weaveState, easeParams, projectWeave } from '../../lib/weave.js';
import { MODEL_WEAVE } from '../../lib/brand.js';

const TAU = Math.PI * 2;

// Every mounted mark, animating or not. Used to repaint paused marks when the
// theme changes and to re-evaluate them when reduced motion is toggled.
const mounted = new Set();
// The marks the shared loop is currently animating.
const live = new Set();
// The pending requestAnimationFrame id, 0 when the loop is stopped.
let raf = 0;
// Timestamp of the previous frame, 0 after the loop stops so the next start
// does not see one enormous time step.
let last = 0;
// Bumped whenever <html> changes attributes. Each mark remembers the value it
// last read its colour at, and re-reads when they differ.
let palette = 0;
// Lazily created singletons, shared by every mark.
let paletteWatch = null;
let sightWatch = null;
let motionQuery = null;

// Whether the user prefers reduced motion. The media query is created once and
// watched, so turning the OS setting on or off takes effect immediately on
// every mark without a reload.
function reduced() {
  if (!motionQuery && typeof matchMedia === 'function') {
    motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener?.('change', () => { for (const o of mounted) settle(o); });
  }
  return !!motionQuery?.matches;
}

// Theme, palette and preset changes are all attribute changes on <html>
// (data-theme, data-preset, style). One observer marks every cached colour as
// stale and repaints the marks the loop is not already repainting.
function watchPalette() {
  if (paletteWatch || typeof MutationObserver === 'undefined') return;
  paletteWatch = new MutationObserver(() => {
    palette++;
    for (const o of mounted) if (!live.has(o)) paint(o);
  });
  paletteWatch.observe(document.documentElement, { attributes: true });
}

// One IntersectionObserver for all marks. A mark scrolled out of view leaves
// the loop and a mark scrolled back in rejoins it, so a long thread only pays
// for the marks you can see.
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

// Reads the dot colour from the canvas's computed CSS `color`.
function readColors(o) {
  const cs = getComputedStyle(o.canvas);
  o.color = cs.color || '#888';
  o.colorsAt = palette;
}

// Draws one frame of one mark.
//
// `projectWeave` returns dots in a unit space centred on 0. They are scaled so
// a radius of 1 reaches 38% of the canvas, which leaves margin for
// perspective and highlighted dots swelling. Dots are sorted far to near so
// the front of the shape overlaps the back, then each is a filled circle whose
// size and opacity come from its depth and highlight.
//
// The base dot radius is 5% of that radius, but never below 0.85 device
// pixels, so tiny marks (the 20px picker icon) still have visible dots.
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

// The shared loop. For every live mark it eases the shape parameters toward
// the target state (this is the morph), advances the three clocks and paints.
//
// `angle` and `flow` are integrated from the current, eased speeds rather
// than computed as time * speed. That way a speed change during a morph
// changes how fast things move from now on, instead of jumping the whole
// shape to where it would have been at the new speed.
//
// The time step is capped at 50ms so a tab returning from the background
// does not lurch.
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

// Puts a mark in or out of the shared loop to match its current situation,
// starting the loop if it was idle.
function sync(o) {
  if (o.visible && !o.still && !reduced()) {
    live.add(o);
    if (!raf) raf = requestAnimationFrame(tick);
  } else {
    live.delete(o);
  }
}

// Applies a new state or `still` flag. A mark that will not animate snaps
// straight to its target shape and is painted once, since there is no loop to
// ease it there.
function settle(o) {
  if (o.still || reduced()) {
    o.cur = o.target;
    paint(o);
  }
  sync(o);
}

// Sizes the canvas backing store to its CSS box. The size comes from the
// ResizeObserver's content box, so padding on the element (the model docs
// icon has some) does not stretch the drawing. Device pixel ratio is capped at
// 2: beyond that the extra pixels are not visible on dots this small and only
// cost fill time. The dot count follows the displayed size.
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

// The mark itself.
//
//   state      'idle' | 'thinking' | 'generating'; anything else is idle, which
//              covers the 'static' phase of a finished reply
//   still      draw one frame and never animate, for lists where a row of
//              moving marks would distract (the model picker, admin catalog)
//   className  styles the canvas; it needs a definite width and height from
//              CSS or `style`, exactly like an <img> would
//
// All per-mark state lives in a plain object `o` rather than React state, so
// animating never re-renders the component. The first effect creates it and
// wires the observers; the second feeds prop changes into it.
export default function Weave({ state = 'idle', still = false, className = '', style }) {
  const ref = useRef(null);
  const inst = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const target = weaveState(state);
    const o = {
      canvas, ctx: canvas.getContext('2d'), n: 0, proj: [], order: [], dpr: 1,
      // Starts at idle, not at `target`, so the first thing a new mark does
      // is morph into its state. See the note at the top of this file.
      cur: weaveState('idle'), target, still, visible: true,
      // Random starting clocks, so two marks side by side are not in lockstep.
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

// Renders whatever a model's icon field holds. `MODEL_WEAVE` becomes the
// animated mark; anything else is an ordinary image URL. Use this everywhere a
// model icon is shown so the built-in mark works in every place an uploaded
// logo does. Both are decorative (the model name is always next to them), so
// neither is announced to screen readers.
export function ModelMark({ src, state, still, className, style }) {
  if (!src) return null;
  if (src === MODEL_WEAVE) return <Weave state={state} still={still} className={className} style={style} />;
  return <img src={src} className={className || undefined} style={style} alt="" aria-hidden="true" />;
}
