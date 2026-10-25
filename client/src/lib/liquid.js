const R = 17;
const STEP = 1 / 240;
const GRAVITY = 2400;
const NECK_K = 300;
const NECK_BREAK = 20;
const DENT = 10;
const MEM_K = 260;
const MEM_C = 16;
const DROP_K = 190;
const DROP_C = 14;
const WOBBLE_K = 520;
const WOBBLE_C = 13;
const PILL_K = 300;
const PILL_C = 26;
const FORM_TIME = 0.34;
const SHRINK_K = 340;
const SHRINK_C = 34;
const LIFT_K = 150;
const LIFT_C = 15;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const near = (a, b, e) => Math.abs(a - b) < e;

function spring(x, v, target, k, c, dt) {
  const nv = v + (k * (target - x) - c * v) * dt;
  return [x + nv * dt, nv];
}

export const springStep = spring;

export function createLiquid({ line, rest, width, height, attached }) {
  return {
    phase: attached ? 'forming' : 'growing',
    attached,
    t: 0,
    line,
    rest,
    mem: { d: 0, v: 0 },
    drop: { y: attached ? line : rest + R, v: 0, vol: 0, a: 0, av: 0 },
    neck: attached ? 1 : 0,
    pill: { on: false, w: 2 * R, h: 2 * R, vw: 0, vh: 0, tw: width, th: height }
  };
}

export function retarget(s, width, height) {
  s.pill.tw = width;
  s.pill.th = height;
}

export function settleLiquid(s) {
  s.phase = 'pill';
  s.pill.on = true;
  s.pill.w = s.pill.tw;
  s.pill.h = s.pill.th;
  s.pill.vw = 0;
  s.pill.vh = 0;
  s.drop.vol = 1;
  s.drop.v = 0;
  s.drop.y = s.rest + s.pill.th / 2;
  s.mem.d = 0;
  s.mem.v = 0;
  s.neck = 0;
}

export function leaveLiquid(s) {
  if (s.phase === 'gone') return;
  s.phase = 'shrink';
  s.t = 0;
}

function dropTop(s) {
  return s.drop.y - (s.pill.on ? s.pill.h / 2 : R * Math.sqrt(s.drop.vol));
}

function stretch(s) {
  return dropTop(s) - (s.line + s.mem.d);
}

function tick(s, dt) {
  const d = s.drop, m = s.mem, p = s.pill;
  s.t += dt;
  [d.a, d.av] = spring(d.a, d.av, 0, WOBBLE_K, WOBBLE_C, dt);

  if (s.phase === 'forming') {
    d.vol = clamp(s.t / FORM_TIME, 0, 1);
    [m.d, m.v] = spring(m.d, m.v, DENT * d.vol, MEM_K, MEM_C, dt);
    d.y = s.line + m.d + R * Math.sqrt(d.vol) * 0.8;
    d.v = m.v;
    if (d.vol >= 1) { s.phase = 'falling'; s.t = 0; }
  } else if (s.phase === 'growing') {
    d.vol = clamp(s.t / 0.22, 0, 1);
    if (d.vol >= 1) { s.phase = 'free'; s.t = 0; d.av -= 6; }
  } else if (s.phase === 'falling') {
    const st = Math.max(0, stretch(s));
    const pull = NECK_K * st * Math.pow(Math.max(0, 1 - st / NECK_BREAK), 1.5);
    d.v += (GRAVITY - pull) * dt;
    d.y += d.v * dt;
    m.v += (-MEM_K * m.d - MEM_C * m.v + pull * 0.25) * dt;
    m.d += m.v * dt;
    const now = stretch(s);
    s.neck = clamp(1 - now / NECK_BREAK, 0, 1);
    if (now >= NECK_BREAK) {
      s.phase = 'free';
      s.t = 0;
      s.neck = 0;
      d.v *= 0.6;
      d.av -= 9;
    }
  } else if (s.phase === 'free') {
    [m.d, m.v] = spring(m.d, m.v, 0, MEM_K, MEM_C, dt);
    [d.y, d.v] = spring(d.y, d.v, s.rest + R, DROP_K, DROP_C, dt);
    if (s.t > 0.22 && near(d.y, s.rest + R, 1.5) && Math.abs(d.v) < 40) {
      s.phase = 'pill';
      s.t = 0;
      const e = shapeStretch(s);
      p.on = true;
      p.w = 2 * R / Math.sqrt(1 + e);
      p.h = 2 * R * Math.sqrt(1 + e);
    }
  } else if (s.phase === 'pill') {
    [m.d, m.v] = spring(m.d, m.v, 0, MEM_K, MEM_C, dt);
    [p.w, p.vw] = spring(p.w, p.vw, p.tw, PILL_K, PILL_C, dt);
    [p.h, p.vh] = spring(p.h, p.vh, p.th, PILL_K, PILL_C, dt);
    d.y = s.rest + p.h / 2;
  } else if (s.phase === 'shrink') {
    [p.w, p.vw] = spring(p.w, p.vw, 2 * R, SHRINK_K, SHRINK_C, dt);
    [p.h, p.vh] = spring(p.h, p.vh, 2 * R, SHRINK_K, SHRINK_C, dt);
    d.y = s.rest + p.h / 2;
    if (near(p.w, 2 * R, 1.5) && near(p.h, 2 * R, 1.5)) {
      p.on = false;
      d.vol = 1;
      d.v = 0;
      d.av += 5;
      s.phase = s.attached ? 'reach' : 'fade';
      s.t = 0;
    }
  } else if (s.phase === 'reach') {
    const gapTo = dropTop(s) - s.line;
    [m.d, m.v] = spring(m.d, m.v, gapTo + 4, MEM_K * 1.4, MEM_C, dt);
    [d.y, d.v] = spring(d.y, d.v, s.rest + R - 3, DROP_K, DROP_C, dt);
    s.neck = clamp(1 - stretch(s) / NECK_BREAK, 0, 1);
    if (stretch(s) < 2) { s.phase = 'rise'; s.t = 0; s.neck = 1; }
  } else if (s.phase === 'rise') {
    [d.y, d.v] = spring(d.y, d.v, s.line - R * 0.4, LIFT_K, LIFT_C, dt);
    const reach = Math.max(0, dropTop(s) - s.line);
    [m.d, m.v] = spring(m.d, m.v, Math.min(reach, DENT * 1.4), MEM_K, MEM_C, dt);
    if (dropTop(s) < s.line + 6) d.vol = Math.max(0, d.vol - dt / 0.2);
    s.neck = 1;
    if (d.vol <= 0) { s.phase = 'settle'; s.t = 0; s.neck = 0; }
  } else if (s.phase === 'settle') {
    [m.d, m.v] = spring(m.d, m.v, 0, MEM_K, MEM_C, dt);
    if (near(m.d, 0, 0.3) && Math.abs(m.v) < 4) s.phase = 'gone';
  } else if (s.phase === 'fade') {
    d.vol = Math.max(0, d.vol - dt / 0.18);
    if (d.vol <= 0) s.phase = 'gone';
  }
}

export function stepLiquid(s, elapsed) {
  let left = Math.min(elapsed, 0.05);
  while (left > 0) {
    const dt = Math.min(STEP, left);
    tick(s, dt);
    left -= dt;
  }
  return !isResting(s);
}

export function isResting(s) {
  if (s.phase === 'gone') return true;
  if (s.phase !== 'pill') return false;
  const p = s.pill, m = s.mem, d = s.drop;
  return near(p.w, p.tw, 0.3) && near(p.h, p.th, 0.3) && Math.abs(p.vw) < 2 && Math.abs(p.vh) < 2
    && near(m.d, 0, 0.3) && Math.abs(m.v) < 3 && Math.abs(d.a) < 0.004 && Math.abs(d.av) < 0.05;
}

function shapeStretch(s) {
  return clamp(s.drop.v * 0.0022 + s.drop.a, -0.32, 0.55);
}

export function liquidShape(s) {
  const d = s.drop, p = s.pill;
  const shape = { line: s.line, dent: s.attached ? Math.max(-3, s.mem.d) : null, drop: null, neck: null };
  if (p.on) {
    shape.drop = { pill: true, w: p.w, h: p.h, y: d.y - p.h / 2, radius: Math.min(p.h / 2, 22) };
  } else if (d.vol > 0) {
    const r = R * Math.sqrt(d.vol);
    const e = shapeStretch(s);
    shape.drop = { pill: false, rx: r / Math.sqrt(1 + e), ry: r * Math.sqrt(1 + e), y: d.y };
  }
  if (s.attached && s.neck > 0 && shape.drop && !p.on) {
    const top = s.line + s.mem.d - 1;
    const bottom = shape.drop.y - shape.drop.ry + 3;
    if (bottom > top) shape.neck = { top, bottom, waist: shape.drop.rx * 1.3 * Math.pow(s.neck, 0.7), base: shape.drop.rx };
  }
  return shape;
}

const BUD_FORM = 0.16;
const BUD_DENT = 7;
const BUD_GRAVITY = 2600;
const BUD_NECK_K = 330;
const BUD_BREAK = 13;
const BUD_K = 230;
const BUD_C = 17;
const BUD_RETURN_K = 190;
const BUD_RETURN_C = 18;
const BUD_DRAIN = 0.14;
const STRETCH_CAP = 30;
const STRETCH_K = 300;
const STRETCH_C = 10;

function unit(x, y) {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

export function createBud({ sx, sy, nx, ny, tx, ty, size, delay = 0, form = BUD_FORM, gravity = BUD_GRAVITY, surface = null, u = 0 }) {
  return {
    phase: 'wait', t: -delay, sx, sy, nx, ny, tx, ty, form, gravity, surface, u, R: size / 2,
    mem: { d: 0, v: 0 },
    drop: { x: sx, y: sy, vx: 0, vy: 0, vol: 0, a: 0, av: 0 },
    neck: 1,
    grab: null,
    st: { x: 0, y: 0, vx: 0, vy: 0 }
  };
}

export function moveBud(b, tx, ty) {
  b.tx = tx;
  b.ty = ty;
}

function softPull(dx, dy, cap) {
  const len = Math.hypot(dx, dy);
  const k = len > 0 ? cap * Math.tanh(len / (cap * 2.4)) / len : 0;
  return { x: dx * k, y: dy * k };
}

export function grabBud(b, dx, dy) {
  b.grab = softPull(dx, dy, STRETCH_CAP);
}

export function releaseBud(b) {
  b.grab = null;
}

export function leaveBud(b, delay = 0) {
  if (b.phase === 'gone' || b.phase === 'leaving' || b.phase === 'draining') return;
  b.grab = null;
  b.phase = 'leaving';
  b.t = -delay;
}

function budSource(b) {
  return [b.sx + b.nx * b.mem.d, b.sy + b.ny * b.mem.d];
}

function budRadius(b) {
  return b.R * Math.sqrt(b.drop.vol);
}

function budStretch(b) {
  const [ax, ay] = budSource(b);
  return Math.hypot(b.drop.x - ax, b.drop.y - ay) - budRadius(b);
}

function budTick(b, dt) {
  const d = b.drop, m = b.mem;
  b.t += dt;
  [d.a, d.av] = spring(d.a, d.av, 0, WOBBLE_K, WOBBLE_C, dt);
  const st = b.st;
  [st.x, st.vx] = spring(st.x, st.vx, b.grab ? b.grab.x : 0, STRETCH_K, STRETCH_C, dt);
  [st.y, st.vy] = spring(st.y, st.vy, b.grab ? b.grab.y : 0, STRETCH_K, STRETCH_C, dt);
  if (b.phase === 'wait') {
    if (b.t >= 0) { b.phase = 'forming'; b.t = 0; }
  } else if (b.phase === 'forming') {
    d.vol = clamp(b.t / b.form, 0, 1);
    [m.d, m.v] = spring(m.d, m.v, BUD_DENT * d.vol, MEM_K, MEM_C, dt);
    const r = budRadius(b);
    d.x = b.sx + b.nx * (m.d + r * 0.8);
    d.y = b.sy + b.ny * (m.d + r * 0.8);
    if (d.vol >= 1) { b.phase = 'falling'; b.t = 0; }
  } else if (b.phase === 'falling') {
    const [ax, ay] = budSource(b);
    const [gx, gy] = unit(b.tx - ax, b.ty - ay);
    const st = Math.max(0, budStretch(b));
    const pull = BUD_NECK_K * st * Math.pow(Math.max(0, 1 - st / BUD_BREAK), 1.5);
    const [px, py] = unit(ax - d.x, ay - d.y);
    d.vx += (gx * b.gravity + px * pull) * dt;
    d.vy += (gy * b.gravity + py * pull) * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    m.v += (-MEM_K * m.d - MEM_C * m.v + pull * 0.2) * dt;
    m.d += m.v * dt;
    const now = budStretch(b);
    b.neck = clamp(1 - now / BUD_BREAK, 0, 1);
    if (now >= BUD_BREAK) {
      b.phase = 'free';
      b.t = 0;
      b.neck = 0;
      d.vx *= 0.55;
      d.vy *= 0.55;
      d.av -= 7;
    }
  } else if (b.phase === 'free' || b.phase === 'formed') {
    [m.d, m.v] = spring(m.d, m.v, 0, MEM_K, MEM_C, dt);
    [d.x, d.vx] = spring(d.x, d.vx, b.tx, BUD_K, BUD_C, dt);
    [d.y, d.vy] = spring(d.y, d.vy, b.ty, BUD_K, BUD_C, dt);
    if (b.phase === 'free' && b.t > 0.12 && Math.hypot(d.x - b.tx, d.y - b.ty) < 2 && Math.hypot(d.vx, d.vy) < 60) b.phase = 'formed';
  } else if (b.phase === 'leaving') {
    if (b.t < 0) {
      [d.x, d.vx] = spring(d.x, d.vx, b.tx, BUD_K, BUD_C, dt);
      [d.y, d.vy] = spring(d.y, d.vy, b.ty, BUD_K, BUD_C, dt);
      return;
    }
    const [ax, ay] = budSource(b);
    [d.x, d.vx] = spring(d.x, d.vx, ax, BUD_RETURN_K, BUD_RETURN_C, dt);
    [d.y, d.vy] = spring(d.y, d.vy, ay, BUD_RETURN_K, BUD_RETURN_C, dt);
    const st = budStretch(b);
    [m.d, m.v] = spring(m.d, m.v, st < BUD_BREAK ? BUD_DENT : 0, MEM_K, MEM_C, dt);
    b.neck = clamp(1 - st / BUD_BREAK, 0, 1);
    if (st < budRadius(b) * 0.4) { b.phase = 'draining'; b.t = 0; }
  } else if (b.phase === 'draining') {
    d.vol = Math.max(0, d.vol - dt / BUD_DRAIN);
    b.neck = d.vol > 0 ? 1 : 0;
    const [ax, ay] = budSource(b);
    [d.x, d.vx] = spring(d.x, d.vx, ax, BUD_RETURN_K, BUD_RETURN_C, dt);
    [d.y, d.vy] = spring(d.y, d.vy, ay, BUD_RETURN_K, BUD_RETURN_C, dt);
    [m.d, m.v] = spring(m.d, m.v, BUD_DENT * d.vol, MEM_K, MEM_C, dt);
    if (d.vol <= 0 && near(m.d, 0, 0.3) && Math.abs(m.v) < 4) b.phase = 'gone';
  }
}

export function stepBud(b, elapsed) {
  let left = Math.min(elapsed, 0.05);
  while (left > 0) {
    const dt = Math.min(STEP, left);
    budTick(b, dt);
    left -= dt;
  }
  return !budResting(b);
}

export function budResting(b) {
  if (b.phase === 'gone') return true;
  if (b.phase !== 'formed') return false;
  const st = b.st;
  const gx = b.grab ? b.grab.x : 0, gy = b.grab ? b.grab.y : 0;
  if (Math.hypot(st.x - gx, st.y - gy) > 0.2 || Math.hypot(st.vx, st.vy) > 3) return false;
  const d = b.drop, m = b.mem;
  return Math.hypot(d.x - b.tx, d.y - b.ty) < 0.3 && Math.hypot(d.vx, d.vy) < 3
    && near(m.d, 0, 0.3) && Math.abs(m.v) < 3 && Math.abs(d.a) < 0.004 && Math.abs(d.av) < 0.05;
}

function dropEllipse(r, vx, vy, a) {
  const speed = Math.hypot(vx, vy);
  const e = clamp(speed * 0.002 + a, -0.32, 0.55);
  return { rx: r * Math.sqrt(1 + e), ry: r / Math.sqrt(1 + e), angle: speed > 1 ? Math.atan2(vy, vx) : Math.PI / 2 };
}

export function budCenter(b) {
  return [b.drop.x + b.st.x * 0.3, b.drop.y + b.st.y * 0.3];
}

function stretchShape(b, r, shape) {
  const st = b.st;
  const len = Math.hypot(st.x, st.y);
  const [x, y] = budCenter(b);
  const grow = len * 0.15;
  shape.drop = { x, y, rx: r + grow, ry: r * r / (r + grow), angle: Math.atan2(st.y, st.x) };
  if (len < 3) return;
  const hr = r * 0.5;
  shape.head = { x: b.drop.x + st.x, y: b.drop.y + st.y, rx: hr, ry: hr, angle: 0 };
  shape.bridge = { ax: x, ay: y, bx: shape.head.x, by: shape.head.y, waist: r * 1.2 * (1 - 0.5 * Math.min(1, len / STRETCH_CAP)), base: hr };
}

export function budShape(b) {
  const d = b.drop;
  const r = budRadius(b);
  const shape = { dent: b.mem.d, drop: null, neck: null, head: null, bridge: null };
  if (r > 0.2) {
    if (Math.hypot(b.st.x, b.st.y) > 0.5) stretchShape(b, r, shape);
    else shape.drop = { x: d.x, y: d.y, ...dropEllipse(r, d.vx, d.vy, d.a) };
  }
  if (b.neck > 0 && shape.drop) {
    const [ax, ay] = budSource(b);
    const [ux, uy] = unit(d.x - ax, d.y - ay);
    const reach = Math.max(0, r - 3);
    const bx = d.x - ux * reach, by = d.y - uy * reach;
    if (Math.hypot(bx - ax, by - ay) > 1) shape.neck = { ax: b.sx - b.nx, ay: b.sy - b.ny, bx, by, waist: r * 1.3 * Math.pow(b.neck, 0.7), base: r, tx: -b.ny, ty: b.nx, surface: b.surface, u: b.u };
  }
  return shape;
}

const PULL_RESIST = 0.55;
const PULL_FALL = 2200;
const PULL_FADE = 0.32;

export function createPull({ sx, sy, nx, ny, size }) {
  return {
    phase: 'idle', target: 0, sx, sy, nx, ny, R: size / 2,
    mem: { d: 0, v: 0 },
    drop: { x: sx, y: sy, vx: 0, vy: 0, vol: 0, a: 0, av: 0 }
  };
}

export function setPull(p, amount) {
  if (p.phase === 'falling') return;
  p.phase = amount > 0 ? 'pulling' : p.phase === 'pulling' ? 'back' : p.phase;
  p.target = Math.max(0, amount);
}

export function releasePull(p, fire) {
  if (p.phase !== 'pulling') return;
  p.phase = fire ? 'falling' : 'back';
  p.target = 0;
  if (fire) { p.drop.vx = p.nx * 260; p.drop.vy = p.ny * 260; p.drop.av -= 8; }
}

function pullTick(p, dt) {
  const d = p.drop, m = p.mem;
  [d.a, d.av] = spring(d.a, d.av, 0, WOBBLE_K, WOBBLE_C, dt);
  if (p.phase === 'pulling' || p.phase === 'back') {
    [m.d, m.v] = spring(m.d, m.v, p.target * PULL_RESIST, MEM_K * 1.4, MEM_C * 1.2, dt);
    d.vol = clamp((m.d - 6) / 26, 0, 1);
    const r = p.R * Math.sqrt(d.vol);
    d.x = p.sx + p.nx * (m.d + r * 0.55);
    d.y = p.sy + p.ny * (m.d + r * 0.55);
    d.vx = p.nx * m.v;
    d.vy = p.ny * m.v;
    if (p.phase === 'back' && near(m.d, 0, 0.3) && Math.abs(m.v) < 4) { p.phase = 'idle'; d.vol = 0; }
  } else if (p.phase === 'falling') {
    [m.d, m.v] = spring(m.d, m.v, 0, MEM_K, MEM_C, dt);
    d.vx += p.nx * PULL_FALL * dt;
    d.vy += p.ny * PULL_FALL * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vol = Math.max(0, d.vol - dt / PULL_FADE);
    if (d.vol <= 0 && near(m.d, 0, 0.3) && Math.abs(m.v) < 4) p.phase = 'idle';
  }
}

export function stepPull(p, elapsed) {
  let left = Math.min(elapsed, 0.05);
  while (left > 0) {
    const dt = Math.min(STEP, left);
    pullTick(p, dt);
    left -= dt;
  }
  return p.phase !== 'idle';
}

export function pullShape(p) {
  const d = p.drop;
  const r = p.R * Math.sqrt(d.vol);
  const shape = { dent: p.mem.d, drop: null, neck: null };
  if (r > 0.2) shape.drop = { x: d.x, y: d.y, ...dropEllipse(r, d.vx, d.vy, d.a) };
  if (shape.drop && p.phase !== 'falling') {
    const ax = p.sx + p.nx * (p.mem.d - 1), ay = p.sy + p.ny * (p.mem.d - 1);
    shape.neck = { ax, ay, bx: d.x, by: d.y, waist: r * 1.6, base: r };
  }
  return shape;
}

export function wrapLeft({ left, top, bottom, radius, offset, gap, count, minY, maxY }) {
  const rc = Math.min(radius, (bottom - top) / 2);
  const mid = (top + bottom) / 2;
  const a = (bottom - top) / 2 - rc;
  const R = rc + offset;
  const arc = R * Math.PI / 2;
  const at = (s) => {
    const side = s < 0 ? -1 : 1;
    const d = Math.abs(s);
    if (d <= a) return { x: left - offset, y: mid + s };
    if (d <= a + arc) {
      const phi = (d - a) / R;
      return { x: left + rc - R * Math.cos(phi), y: mid + side * (a + R * Math.sin(phi)) };
    }
    return { x: left + rc + d - a - arc, y: mid + side * (a + R) };
  };
  const place = (shift) => Array.from({ length: count }, (_, i) => at(((count - 1) / 2 - i) * gap + shift));
  let shift = Math.min(a + arc / 2, a + arc + gap * 0.4 - (count - 1) / 2 * gap);
  let points = place(shift);
  for (let n = 0; n < 80; n++) {
    const low = Math.max(...points.map(p => p.y));
    const high = Math.min(...points.map(p => p.y));
    if (low > maxY && high - 4 >= minY) shift -= 4;
    else if (high < minY && low + 4 <= maxY) shift += 4;
    else break;
    points = place(shift);
  }
  return points;
}

export function gridTargets({ count, cols, gap, size, x, y, rowStep, width, align = 'center', margin = 8 }) {
  const fit = Math.max(1, Math.min(count, cols, Math.floor((width - 2 * margin - size) / gap) + 1));
  const span = (fit - 1) * gap;
  const start = align === 'center' ? x - span / 2 : x;
  const left = Math.min(Math.max(start, margin + size / 2), width - margin - size / 2 - span);
  return Array.from({ length: count }, (_, i) => ({ x: left + (i % fit) * gap, y: y + Math.floor(i / fit) * rowStep }));
}

export const PANEL_FADE = 0.14;
const PANEL_DRAG = 0.2;
const PANEL_SQUEEZE = 0.06;
const PANEL_CLEAR = 18;
const PANEL_STUCK = 0.6;
const PANEL_SNAP = 12;
const PANEL_EDGES = [['l', -1, 0], ['t', 0, -1], ['r', 1, 0], ['b', 0, 1]];
const PANEL_SIDES = { __proto__: null, top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

export const PANEL_MOTION = {
  default: { drop: 30, form: 0.08, gravity: 6500, near: [520, 36], far: [260, 18], reveal: 0.75, stretch: 26 },
  snappy: { drop: 24, form: 0.05, gravity: 9000, near: [700, 46], far: [440, 30], reveal: 0.7, stretch: 18 },
  soft: { drop: 36, form: 0.12, gravity: 4200, near: [380, 26], far: [180, 12], reveal: 0.8, stretch: 34 }
};

export function panelMotion(motion) {
  const preset = typeof motion === 'string' ? PANEL_MOTION[motion] : motion;
  return { ...PANEL_MOTION.default, ...preset };
}

function along(lo, hi, at, want) {
  if (at === 'start') return lo;
  if (at === 'end') return hi;
  if (at === 'center') return (lo + hi) / 2;
  const n = parseFloat(at);
  if (Number.isFinite(n)) return lo + (hi - lo) * clamp(n, 0, 1);
  return clamp(want, lo, hi);
}

export function panelSide(trigger, rect, side) {
  if (PANEL_SIDES[side]) return PANEL_SIDES[side];
  const beyond = {
    top: trigger.top - rect.y,
    bottom: rect.y + rect.h - trigger.bottom,
    left: trigger.left - rect.x,
    right: rect.x + rect.w - trigger.right
  };
  const best = Object.keys(beyond).reduce((a, b) => (beyond[b] > beyond[a] ? b : a));
  return beyond[best] > 0 ? PANEL_SIDES[best] : [0, 0];
}

function edgePoint(trigger, rect, [nx, ny], at) {
  const mx = rect.x + rect.w / 2, my = rect.y + rect.h / 2;
  if (ny) return { x: along(trigger.left, trigger.right, at, mx), y: ny > 0 ? trigger.bottom : trigger.top };
  return { x: nx > 0 ? trigger.right : trigger.left, y: along(trigger.top, trigger.bottom, at, my) };
}

export function sourceOn(rect, radius, x, y) {
  const surface = outline({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, radius });
  const u = surface.project(x, y);
  const p = surface.at(u);
  return { x: p.x - p.nx, y: p.y - p.ny, nx: p.nx, ny: p.ny, surface, u };
}

export function panelSource(trigger, rect, { radius = 0, side, at } = {}) {
  const dir = panelSide(trigger, rect, side);
  if (!dir[0] && !dir[1]) return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, nx: 0, ny: 0, surface: null, u: 0 };
  const hit = edgePoint(trigger, rect, dir, at);
  return sourceOn(trigger, radius, hit.x, hit.y);
}

function panelRect(rect) {
  return { l: rect.x, t: rect.y, r: rect.x + rect.w, b: rect.y + rect.h };
}

function circleBox(x, y, r) {
  return { l: x - r, t: y - r, r: x + r, b: y + r };
}

function anchorOf(p) {
  const r = p.m.drop / 2, s = p.source;
  const x = s.x + s.nx * (r + PANEL_CLEAR), y = s.y + s.ny * (r + PANEL_CLEAR);
  return { x: clamp(x, p.rect.l + r, p.rect.r - r), y: clamp(y, p.rect.t + r, p.rect.b - r) };
}

function setBox(p, box, vx = 0, vy = 0) {
  p.box = { l: { x: box.l, v: vx }, t: { x: box.t, v: vy }, r: { x: box.r, v: vx }, b: { x: box.b, v: vy } };
}

export function createPanel({ source, rect, radius, motion }) {
  const m = panelMotion(motion);
  const p = {
    phase: 'bud', t: 0, m, source, radius, rect: panelRect(rect), grab: null, box: null, bud: null,
    alpha: 1, vol: 1, revealed: false, spread: 10
  };
  if (source.nx || source.ny) {
    const a = anchorOf(p);
    p.bud = createBud({
      sx: source.x, sy: source.y, nx: source.nx, ny: source.ny, tx: a.x, ty: a.y,
      size: m.drop, form: m.form, gravity: m.gravity, surface: source.surface, u: source.u
    });
  } else {
    p.phase = 'morph';
    setBox(p, circleBox(source.x, source.y, m.drop / 2));
  }
  return p;
}

export function retargetPanel(p, rect) {
  const next = panelRect(rect), was = p.rect;
  if (p.box) {
    const dx = next.l - was.l, dy = next.t - was.t;
    const small = Math.abs(next.r - next.l - (was.r - was.l)) < PANEL_SNAP && Math.abs(next.b - next.t - (was.b - was.t)) < PANEL_SNAP;
    for (const [key] of PANEL_EDGES) {
      const e = p.box[key];
      if (small && p.phase === 'open') p.box[key] = { x: next[key], v: 0 };
      else e.x += key === 'l' || key === 'r' ? dx : dy;
    }
  }
  p.rect = next;
}

export function grabPanel(p, dx, dy) {
  if (p.phase === 'morph' || p.phase === 'open') p.grab = softPull(dx, dy, p.m.stretch);
}

export function releasePanel(p) {
  p.grab = null;
}

export function drainPanel(p) {
  if (p.phase === 'shrink' || p.phase === 'return' || p.phase === 'gone') return;
  p.grab = null;
  p.alpha = 1;
  if (p.phase === 'bud') {
    leaveBud(p.bud);
    p.phase = 'return';
    return;
  }
  p.phase = 'shrink';
}

function panelTarget(p) {
  if (p.phase === 'shrink') {
    const a = anchorOf(p);
    return circleBox(a.x, a.y, p.m.drop / 2);
  }
  const r = p.rect;
  if (!p.grab) return r;
  const gx = p.grab.x, gy = p.grab.y;
  return {
    l: r.l + Math.min(0, gx) + Math.max(0, gx) * PANEL_DRAG + Math.abs(gy) * PANEL_SQUEEZE,
    r: r.r + Math.max(0, gx) + Math.min(0, gx) * PANEL_DRAG - Math.abs(gy) * PANEL_SQUEEZE,
    t: r.t + Math.min(0, gy) + Math.max(0, gy) * PANEL_DRAG + Math.abs(gx) * PANEL_SQUEEZE,
    b: r.b + Math.max(0, gy) + Math.min(0, gy) * PANEL_DRAG - Math.abs(gx) * PANEL_SQUEEZE
  };
}

function panelGrown(p) {
  const b = p.box, r = p.rect;
  return Math.min((b.r.x - b.l.x) / (r.r - r.l), (b.b.x - b.t.x) / (r.b - r.t));
}

function panelOff(p, target) {
  return Math.max(...PANEL_EDGES.map(([key]) => Math.abs(p.box[key].x - target[key])));
}

function pourBack(p) {
  const b = p.box;
  const x = (b.l.x + b.r.x) / 2, y = (b.t.x + b.b.x) / 2;
  const bud = p.bud;
  Object.assign(bud.drop, { x, y, vx: 0, vy: 0, vol: 1, a: 0, av: 0 });
  Object.assign(bud, { phase: 'free', neck: 0, grab: null, tx: x, ty: y });
  leaveBud(bud);
  p.phase = 'return';
}

function panelTick(p, dt) {
  if (p.phase === 'gone') return;
  if (p.phase === 'bud' || p.phase === 'return') {
    budTick(p.bud, dt);
    p.t += dt;
    if (p.phase === 'return' && p.bud.phase === 'gone') p.phase = 'gone';
    if (p.phase === 'bud' && (p.bud.phase === 'free' || p.bud.phase === 'formed' || p.t > PANEL_STUCK)) {
      const d = p.bud.drop;
      setBox(p, circleBox(d.x, d.y, budRadius(p.bud)), d.vx, d.vy);
      p.phase = 'morph';
    }
    return;
  }
  const target = panelTarget(p);
  const [nearK, nearC] = p.m.near, [farK, farC] = p.m.far;
  for (const [key, ex, ey] of PANEL_EDGES) {
    const toward = (1 - (ex * p.source.nx + ey * p.source.ny)) / 2;
    const e = p.box[key];
    [e.x, e.v] = spring(e.x, e.v, target[key], farK + (nearK - farK) * toward, farC + (nearC - farC) * toward, dt);
  }
  if (p.phase === 'morph' && panelGrown(p) >= p.m.reveal) {
    p.phase = 'open';
    p.revealed = true;
  }
  if (p.phase === 'open') p.alpha = Math.max(0, p.alpha - dt / PANEL_FADE);
  if (p.phase === 'shrink' && panelOff(p, target) < 2) {
    if (p.bud) pourBack(p);
    else p.vol = Math.max(0, p.vol - dt / 0.12);
    if (p.vol <= 0) p.phase = 'gone';
  }
}

export function panelSettled(p) {
  if (p.phase !== 'open' || p.alpha > 0 || p.grab) return false;
  return panelOff(p, panelTarget(p)) < 0.3 && PANEL_EDGES.every(([key]) => Math.abs(p.box[key].v) < 2);
}

export function stepPanel(p, elapsed) {
  let left = Math.min(elapsed, 0.05);
  while (left > 0) {
    const dt = Math.min(STEP, left);
    panelTick(p, dt);
    left -= dt;
  }
  return p.phase !== 'gone' && !panelSettled(p);
}

export function panelFrame(p) {
  const b = p.box;
  return { x: b.l.x, y: b.t.x, w: Math.max(1, b.r.x - b.l.x), h: Math.max(1, b.b.x - b.t.x) };
}

export function panelShape(p) {
  if (p.phase === 'gone') return null;
  if (p.phase === 'bud' || p.phase === 'return') {
    const s = budShape(p.bud), src = p.source;
    const dent = s.dent > 0.2 && src.surface
      ? { surface: src.surface, u: src.u, depth: s.dent, spread: p.spread, half: Math.min(p.spread * 3, src.surface.length / 4) }
      : null;
    return { alpha: 1, mix: 0, box: null, neck: s.neck, drop: s.drop, dent };
  }
  if (p.alpha <= 0) return null;
  const b = p.box;
  const scale = Math.sqrt(p.vol);
  const cx = (b.l.x + b.r.x) / 2, cy = (b.t.x + b.b.x) / 2;
  const w = Math.max(0, b.r.x - b.l.x) * scale, h = Math.max(0, b.b.x - b.t.x) * scale;
  const box = { l: cx - w / 2, t: cy - h / 2, r: cx + w / 2, b: cy + h / 2, radius: Math.min(p.radius, w / 2, h / 2) };
  return { alpha: p.alpha, mix: clamp(panelGrown(p) / p.m.reveal, 0, 1), box, neck: null, drop: null, dent: null };
}

export function outline({ left, top, right, bottom, radius = 0 }) {
  const r = Math.max(0, Math.min(radius, (right - left) / 2, (bottom - top) / 2));
  const w = right - left - 2 * r, h = bottom - top - 2 * r;
  const q = Math.PI * r / 2;
  const segs = [
    { len: w, line: [left + r, top, 1, 0], n: [0, -1] },
    { len: q, arc: [right - r, top + r, -Math.PI / 2] },
    { len: h, line: [right, top + r, 0, 1], n: [1, 0] },
    { len: q, arc: [right - r, bottom - r, 0] },
    { len: w, line: [right - r, bottom, -1, 0], n: [0, 1] },
    { len: q, arc: [left + r, bottom - r, Math.PI / 2] },
    { len: h, line: [left, bottom - r, 0, -1], n: [-1, 0] },
    { len: q, arc: [left + r, top + r, Math.PI] }
  ];
  const length = segs.reduce((sum, g) => sum + g.len, 0);
  const point = (g, d) => {
    if (g.line) {
      const [x, y, dx, dy] = g.line;
      return { x: x + dx * d, y: y + dy * d, nx: g.n[0], ny: g.n[1] };
    }
    const [cx, cy, a0] = g.arc;
    const a = a0 + (r ? d / r : 0);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
  };
  const at = (u) => {
    let d = ((u % length) + length) % length;
    for (const g of segs) {
      if (d <= g.len) return point(g, d);
      d -= g.len;
    }
    return point(segs[0], 0);
  };
  const reachOn = (g, px, py) => {
    if (g.line) {
      const [x, y, dx, dy] = g.line;
      return clamp((px - x) * dx + (py - y) * dy, 0, g.len);
    }
    const [cx, cy, a0] = g.arc;
    const a = (((Math.atan2(py - cy, px - cx) - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (a <= Math.PI / 2) return a * r;
    if (a < Math.PI * 1.25) return g.len;
    return 0;
  };
  const project = (px, py) => {
    let best = 0, bestDist = Infinity, start = 0;
    for (const g of segs) {
      const d = reachOn(g, px, py);
      const p = point(g, d);
      const dist = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = start + d;
      }
      start += g.len;
    }
    return best;
  };
  return { length, at, project };
}