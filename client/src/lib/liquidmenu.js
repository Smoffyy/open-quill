import { useLayoutEffect } from 'react';
import {
  PANEL_FADE, createPanel, drainPanel, grabPanel, panelFrame, panelSettled, panelShape, panelSide, panelSource,
  releasePanel, retargetPanel, stepPanel
} from './liquid.js';
import { edgeColor, fitCanvas, freeCanvas, paintLiquid, surfaceOf } from './liquiddraw.js';
import { simpleMotion } from './motion.js';

const SPILL = 64;
const panels = new Set();
const tones = new Map();
let canvas = null;
let probe = null;
let frame = 0;

function layer() {
  if (!canvas || !canvas.isConnected) {
    canvas = document.createElement('canvas');
    canvas.className = 'lq-menu-layer';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
  }
  return canvas;
}

function channels(color) {
  if (tones.has(color)) return tones.get(color);
  if (!probe) probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = 'rgba(0, 0, 0, 0)';
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const c = [...probe.getImageData(0, 0, 1, 1).data];
  if (tones.size > 256) tones.clear();
  tones.set(color, c);
  return c;
}

function areaOf(rect, source) {
  return {
    left: Math.min(rect.x, source.x) - SPILL, top: Math.min(rect.y, source.y) - SPILL,
    right: Math.max(rect.x + rect.w, source.x) + SPILL, bottom: Math.max(rect.y + rect.h, source.y) + SPILL
  };
}

function backdrop(el) {
  const r = el.getBoundingClientRect();
  for (const hit of document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)) {
    if (el.contains(hit) || hit.classList.contains('lq-menu-layer')) continue;
    for (let e = hit; e; e = e.parentElement) {
      const c = channels(getComputedStyle(e).backgroundColor);
      if (c[3] === 255) return c;
    }
  }
  return channels(getComputedStyle(document.body).backgroundColor);
}

function solid(style, el) {
  const c = channels(style.backgroundColor);
  if (!c[3]) return null;
  if (c[3] === 255) return c;
  const base = backdrop(el), k = c[3] / 255;
  return [0, 1, 2].map(i => c[i] * k + base[i] * (1 - k)).concat(255);
}

function ring(style) {
  const color = edgeColor(style);
  return color ? channels(color) : null;
}

function lerp(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function css([r, g, b, a]) {
  return 'rgba(' + Math.round(r) + ', ' + Math.round(g) + ', ' + Math.round(b) + ', ' + (a / 255).toFixed(3) + ')';
}

function draw() {
  const shown = [];
  for (const p of panels) {
    const shape = panelShape(p);
    if (shape) shown.push([p, shape]);
  }
  const c = layer();
  if (!shown.length) {
    freeCanvas(c);
    return;
  }
  const box = shown.map(([p]) => p.area).reduce((a, b) => ({
    left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom)
  }));
  const ctx = fitCanvas(c, box);
  for (const [p, shape] of shown) {
    ctx.globalAlpha = shape.alpha;
    paintLiquid(ctx, {
      fill: css(lerp(p.from.fill, p.to.fill, shape.mix)),
      rim: p.to.rim && css(lerp(p.from.rim, p.to.rim, shape.mix)),
      dents: shape.dent ? [shape.dent] : [],
      boxes: shape.box ? [shape.box] : [],
      necks: shape.neck ? [shape.neck] : [],
      drops: shape.drop ? [shape.drop] : []
    });
  }
  ctx.globalAlpha = 1;
}

function wake() {
  if (frame) return;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    let active = false;
    for (const p of panels) {
      const wasRevealed = p.revealed;
      if (stepPanel(p, (now - last) / 1000)) active = true;
      if (p.revealed && !wasRevealed) p.onReveal?.();
      p.onFrame?.();
      if (p.phase === 'gone') panels.delete(p);
    }
    last = now;
    draw();
    frame = active ? requestAnimationFrame(tick) : 0;
  };
  frame = requestAnimationFrame(tick);
}

function ownsDrag(target, menu) {
  if (target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [data-no-stretch]')) return true;
  for (let el = target; el && el !== menu; el = el.parentElement) {
    if (getComputedStyle(el).touchAction === 'none') return true;
  }
  return false;
}

function swallow(e) {
  e.stopPropagation();
  e.preventDefault();
}

export function pointRef(x, y) {
  return { current: { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }) } };
}

const NEAR_EDGE = 20;

function nodeOf(from) {
  return from && typeof from === 'object' && 'current' in from ? from.current : from;
}

function hostFor(trigger, from) {
  if (!trigger.closest) return null;
  if (from === 'trigger') return trigger;
  if (typeof from === 'string') return trigger.closest(from);
  if (from) return nodeOf(from);
  return trigger.closest('[data-liquid], [data-liquid-source]');
}

function edgeGap(rect, own, [nx, ny]) {
  if (ny > 0) return rect.bottom - own.bottom;
  if (ny < 0) return own.top - rect.top;
  if (nx > 0) return rect.right - own.right;
  return own.left - rect.left;
}

function nearbySurface(trigger, own, dir) {
  for (let el = trigger, depth = 0; el && el !== document.body && depth < 5; el = el.parentElement, depth++) {
    if ('liquid' in el.dataset) return null;
    const surface = surfaceOf(el);
    if (!channels(surface.style.backgroundColor)[3]) continue;
    return edgeGap(surface.rect, own, dir) <= NEAR_EDGE ? surface : null;
  }
  return null;
}

function resolveSource(trigger, menu, opts) {
  const own = trigger.getBoundingClientRect();
  const host = hostFor(trigger, opts.from);
  const data = (host || trigger).dataset || {};
  const side = opts.side || data.liquidSide;
  const at = opts.at ?? data.liquidAt;
  const motion = opts.motion || data.liquidMotion;
  let surface = null;
  if (host && host !== trigger && 'liquid' in host.dataset && !opts.from) {
    const parent = surfaceOf(host), r = parent.rect;
    const strip = { left: r.left, right: r.right, top: own.top, bottom: own.bottom, width: r.width, height: own.height };
    return { rect: strip, radius: 0, style: parent.style, host, side, at, motion };
  }
  if (host) surface = surfaceOf(host);
  else if (trigger.closest) surface = nearbySurface(trigger, own, panelSide(own, menu, side));
  if (!surface) return { rect: own, radius: 0, style: null, host: null, side, at, motion };
  const radius = parseFloat(surface.style.borderTopLeftRadius) || 0;
  return { rect: surface.rect, radius, style: surface.style, host: host || trigger, side, at, motion };
}

export function useLiquidMenu(open, menuRef, triggerRef, opts = {}) {
  useLayoutEffect(() => {
    const el = menuRef.current, trigger = triggerRef.current;
    if (!open || !el || !trigger || simpleMotion()) return undefined;
    el.dataset.liquid = 'pour';
    el.style.setProperty('--lq-fade', PANEL_FADE + 's');
    const sheet = getComputedStyle(el).transform;
    let panel = null;
    let base = null;
    let moved = false;

    const measure = () => {
      const own = el.style.transform;
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      el.style.transform = own;
      base = { x: r.left, y: r.top, w: r.width, h: r.height };
    };

    const follow = () => {
      if (!panel.revealed) return;
      if (panelSettled(panel)) {
        if (moved) {
          el.style.transform = '';
          el.style.transformOrigin = '';
          moved = false;
        }
        return;
      }
      const f = panelFrame(panel);
      el.style.transformOrigin = '0 0';
      el.style.transform = 'translate(' + (f.x - base.x) + 'px, ' + (f.y - base.y) + 'px) '
        + (sheet === 'none' ? '' : sheet + ' ') + 'scale(' + f.w / base.w + ', ' + f.h / base.h + ')';
      moved = true;
    };

    const onDown = (e) => {
      if (!panel || !panel.revealed || e.button !== 0) return;
      if (e.pointerType === 'touch' && el.scrollHeight > el.clientHeight + 1) return;
      if (ownsDrag(e.target, el)) return;
      const x0 = e.clientX, y0 = e.clientY;
      let dragging = false;
      const move = (ev) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!dragging && Math.hypot(dx, dy) < 5) return;
        if (!dragging) {
          dragging = true;
          el.dataset.stretching = '';
          window.getSelection()?.removeAllRanges();
        }
        grabPanel(panel, dx, dy);
        wake();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!dragging) return;
        delete el.dataset.stretching;
        releasePanel(panel);
        wake();
        el.addEventListener('click', swallow, true);
        setTimeout(() => el.removeEventListener('click', swallow, true), 0);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };

    const start = requestAnimationFrame(() => {
      measure();
      const surface = surfaceOf(el);
      const fill = solid(surface.style, el);
      if (!fill) {
        el.dataset.liquid = 'shown';
        return;
      }
      const src = resolveSource(trigger, base, opts);
      const rim = ring(surface.style);
      const from = {
        fill: (src.style && solid(src.style, src.host)) || fill,
        rim: (src.style && ring(src.style)) || rim
      };
      panel = createPanel({
        source: panelSource(src.rect, base, { radius: src.radius, side: src.side, at: src.at }),
        rect: base,
        radius: parseFloat(surface.style.borderTopLeftRadius) || 0,
        motion: src.motion
      });
      Object.assign(panel, {
        area: areaOf(base, panel.source),
        from,
        to: { fill, rim: rim || from.rim },
        onReveal: () => { el.dataset.liquid = 'shown'; },
        onFrame: follow
      });
      panels.add(panel);
      wake();
    });

    const resize = new ResizeObserver(() => {
      measure();
      if (!panel) return;
      retargetPanel(panel, base);
      panel.area = areaOf(base, panel.source);
      follow();
      wake();
    });
    resize.observe(el);
    if (opts.stretch !== false) el.addEventListener('pointerdown', onDown);

    return () => {
      cancelAnimationFrame(start);
      resize.disconnect();
      el.removeEventListener('pointerdown', onDown);
      delete el.dataset.liquid;
      el.style.removeProperty('--lq-fade');
      delete el.dataset.stretching;
      el.style.transform = '';
      el.style.transformOrigin = '';
      if (!panel) return;
      panel.onFrame = null;
      drainPanel(panel);
      wake();
    };
  }, [open]);
}