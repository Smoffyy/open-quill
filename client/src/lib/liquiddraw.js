export function prepCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

export function fitCanvas(canvas, box) {
  const left = Math.max(0, Math.floor(box.left)), top = Math.max(0, Math.floor(box.top));
  const right = Math.min(window.innerWidth, Math.ceil(box.right)), bottom = Math.min(window.innerHeight, Math.ceil(box.bottom));
  const s = canvas.style;
  s.left = left + 'px';
  s.top = top + 'px';
  s.width = Math.max(1, right - left) + 'px';
  s.height = Math.max(1, bottom - top) + 'px';
  const ctx = prepCanvas(canvas);
  ctx.translate(-left, -top);
  return ctx;
}

export function freeCanvas(canvas) {
  if (canvas.width || canvas.height) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function aroundPoints(points, margin) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return {
    left: Math.min(...xs) - margin, top: Math.min(...ys) - margin,
    right: Math.max(...xs) + margin, bottom: Math.max(...ys) + margin
  };
}

export function resolveColor(el, value) {
  const probe = document.createElement('span');
  probe.style.color = value;
  probe.style.display = 'none';
  el.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

const CLEAR = 'rgba(0, 0, 0, 0)';

export function surfaceOf(el) {
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const before = getComputedStyle(el, '::before');
  if (style.backgroundColor !== CLEAR || before.content === 'none' || before.backgroundColor === CLEAR) {
    return { rect: box, style };
  }
  const left = box.left + parseFloat(style.paddingLeft) + parseFloat(before.marginLeft);
  const top = box.top + parseFloat(style.paddingTop) + parseFloat(before.marginTop);
  const width = parseFloat(before.width), height = parseFloat(before.height);
  return { rect: { left, top, width, height, right: left + width, bottom: top + height }, style: before };
}

export function edgeColor(style) {
  if (parseFloat(style.borderTopWidth) > 0) return style.borderTopColor;
  const ring = style.boxShadow.split(/,(?![^(]*\))/).find(part => / 0px 0px 0px 1px/.test(part));
  return ring ? ring.trim().match(/^(rgba?\([^)]*\)|\S+)/)[1] : null;
}

function dentLift(depth, spread) {
  return (s) => depth * Math.exp(-(s / spread) * (s / spread));
}

function edgeOf(d) {
  if (d.surface) return (s) => d.surface.at(d.u + s);
  return (s) => ({ x: d.x - d.ny * s, y: d.y + d.nx * s, nx: d.nx, ny: d.ny });
}

export function fillDent(ctx, d) {
  const lift = dentLift(d.depth, d.spread), edge = edgeOf(d);
  ctx.beginPath();
  for (let s = -d.half; s <= d.half; s += 2) {
    const p = edge(s), out = lift(s);
    ctx.lineTo(p.x + p.nx * out, p.y + p.ny * out);
  }
  for (let s = d.half; s >= -d.half; s -= 2) {
    const p = edge(s), sink = Math.min(6, lift(s) * 2);
    ctx.lineTo(p.x - p.nx * sink, p.y - p.ny * sink);
  }
  ctx.closePath();
  ctx.fill();
}

export function rimDent(ctx, d) {
  const lift = dentLift(d.depth, d.spread), edge = edgeOf(d);
  let drawing = false;
  ctx.beginPath();
  for (let s = -d.half; s <= d.half; s += 1.5) {
    const out = lift(s);
    if (out < 0.6) {
      drawing = false;
      continue;
    }
    const p = edge(s);
    if (drawing) ctx.lineTo(p.x + p.nx * out, p.y + p.ny * out);
    else ctx.moveTo(p.x + p.nx * out, p.y + p.ny * out);
    drawing = true;
  }
  ctx.stroke();
}

function inward(p) {
  return { x: p.x - p.nx, y: p.y - p.ny };
}

function neckFrame(n) {
  const len = Math.hypot(n.bx - n.ax, n.by - n.ay);
  if (len < 0.5) return null;
  const ux = (n.bx - n.ax) / len, uy = (n.by - n.ay) / len;
  const wx = -uy, wy = ux;
  const hw = n.waist / 2;
  const top = hw + 9;
  const bottom = Math.min(n.base * 0.95, hw + 8);
  let c1, c2, k1, k2;
  if (n.surface) {
    c1 = inward(n.surface.at(n.u - top));
    c2 = inward(n.surface.at(n.u + top));
    k1 = inward(n.surface.at(n.u - hw));
    k2 = inward(n.surface.at(n.u + hw));
    if ((c1.x - n.ax) * wx + (c1.y - n.ay) * wy > 0) {
      [c1, c2] = [c2, c1];
      [k1, k2] = [k2, k1];
    }
  } else {
    let fx = wx, fy = wy;
    if (n.tx !== undefined) {
      const side = n.tx * wx + n.ty * wy < 0 ? -1 : 1;
      fx = n.tx * side;
      fy = n.ty * side;
    }
    c1 = { x: n.ax - fx * top, y: n.ay - fy * top };
    c2 = { x: n.ax + fx * top, y: n.ay + fy * top };
    k1 = { x: n.ax - fx * hw, y: n.ay - fy * hw };
    k2 = { x: n.ax + fx * hw, y: n.ay + fy * hw };
  }
  const attached = !!n.surface || n.tx !== undefined;
  return { c1, c2, k1, k2, wx, wy, hw, bottom, skip: attached ? top - hw + 3 : 0 };
}

export function fillNeck(ctx, n) {
  const f = neckFrame(n);
  if (!f) return;
  const { c1, c2, k1, k2, wx, wy, hw, bottom } = f;
  ctx.beginPath();
  ctx.moveTo(c1.x, c1.y);
  ctx.bezierCurveTo(k1.x, k1.y, n.bx - wx * hw, n.by - wy * hw, n.bx - wx * bottom, n.by - wy * bottom);
  ctx.lineTo(n.bx + wx * bottom, n.by + wy * bottom);
  ctx.bezierCurveTo(n.bx + wx * hw, n.by + wy * hw, k2.x, k2.y, c2.x, c2.y);
  ctx.closePath();
  ctx.fill();
}

export function rimNeck(ctx, n) {
  const f = neckFrame(n);
  if (!f) return;
  const { c1, c2, k1, k2, wx, wy, hw, bottom, skip } = f;
  ctx.beginPath();
  ctx.moveTo(c1.x, c1.y);
  ctx.bezierCurveTo(k1.x, k1.y, n.bx - wx * hw, n.by - wy * hw, n.bx - wx * bottom, n.by - wy * bottom);
  ctx.moveTo(c2.x, c2.y);
  ctx.bezierCurveTo(k2.x, k2.y, n.bx + wx * hw, n.by + wy * hw, n.bx + wx * bottom, n.by + wy * bottom);
  if (skip) ctx.setLineDash([0, skip, 1e4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function fillDrop(ctx, x, y, rx, ry, angle) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), angle || 0, 0, Math.PI * 2);
  ctx.fill();
}

export function rimDrop(ctx, x, y, rx, ry, angle) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), angle || 0, 0, Math.PI * 2);
  ctx.stroke();
}

function traceBox(ctx, b) {
  ctx.beginPath();
  ctx.roundRect(b.l, b.t, b.r - b.l, b.b - b.t, Math.max(0, b.radius));
}

export function fillBox(ctx, b) {
  traceBox(ctx, b);
  ctx.fill();
}

export function rimBox(ctx, b) {
  traceBox(ctx, b);
  ctx.stroke();
}

export function paintLiquid(ctx, { fill, rim, dents = [], necks = [], drops = [], boxes = [] }) {
  const pass = (dent, neck, drop, box) => {
    for (const b of boxes) box(ctx, b);
    for (const d of dents) dent(ctx, d);
    for (const n of necks) neck(ctx, n);
    for (const d of drops) drop(ctx, d.x, d.y, d.rx, d.ry, d.angle);
  };
  if (rim) {
    ctx.strokeStyle = rim;
    ctx.lineWidth = 2;
    pass(rimDent, rimNeck, rimDrop, rimBox);
  }
  ctx.fillStyle = fill;
  pass(fillDent, fillNeck, fillDrop, fillBox);
}