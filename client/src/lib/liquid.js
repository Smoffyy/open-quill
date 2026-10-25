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