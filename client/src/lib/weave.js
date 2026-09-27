const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const PERSPECTIVE = 3.4;
const STRANDS = 3;

export const WEAVE_STATES = {
  __proto__: null,
  idle: { braid: 1, ribbon: 0, glass: 0, spin: 0.2, stream: 0.1 },
  thinking: { braid: 0, ribbon: 0, glass: 1, spin: 0.2, stream: 0.18 },
  generating: { braid: 0, ribbon: 1, glass: 0, spin: 0.45, stream: 0.55 }
};

export const WEAVE_KEYS = Object.keys(WEAVE_STATES.idle);

export function weaveState(name) {
  return WEAVE_STATES[name] || WEAVE_STATES.idle;
}

export function weavePointCount(px) {
  return STRANDS * Math.max(20, Math.min(110, Math.round(px * 1.5)));
}

export function easeParams(cur, target, dt, rate = 4) {
  const k = 1 - Math.exp(-dt * rate);
  const next = {};
  for (const key of WEAVE_KEYS) next[key] = cur[key] + (target[key] - cur[key]) * k;
  return next;
}

function frac(v) {
  return v - Math.floor(v);
}

function comet(behind, length) {
  return behind < length ? (1 - behind / length) ** 2 : 0;
}

function pose(v, x, y, z, tilt, view) {
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const y0 = y * ct - z * st;
  const z0 = y * st + z * ct;
  const x1 = x * view.cy + z0 * view.sy;
  const z1 = -x * view.sy + z0 * view.cy;
  v.x = x1;
  v.y = y0 * view.cx - z1 * view.sx;
  v.z = y0 * view.sx + z1 * view.cx;
  v.depth = Math.max(0, Math.min(1, (v.z + 1) / 2));
}

function braidAt(v, u, s, time, flow, view) {
  const L = frac(u + flow * 0.25);
  const a = L * TAU;
  const ph = (s * TAU) / STRANDS + 3 * a + flow * TAU;
  const rad = 0.68 + 0.2 * Math.cos(ph);
  pose(v, rad * Math.cos(a), rad * Math.sin(a), 0.2 * Math.sin(ph), -1.05, view);
  v.hot = 0.7 * comet(frac(time * 0.14 - L), 0.14);
  v.fade = 1;
}

function ribbonAt(v, u, s, time, flow, view) {
  const L = frac(u + flow);
  const a = L * TAU;
  const sc = 1 + 0.06 * Math.sin(time * 6.3) * Math.sin(time * 1.9);
  const lift = (s - 1) * 0.1 * (0.7 + 0.3 * Math.sin(2 * a + time * 3));
  pose(v, 0.95 * Math.sin(a) * sc, (0.55 * Math.sin(2 * a) + lift) * sc, 0.6 * Math.cos(3 * a) * sc, 0, view);
  let streak = 0;
  for (let c = 0; c < 3; c++) streak = Math.max(streak, comet(frac(frac(time * 0.38 + c / 3) - L), 0.14));
  v.hot = streak;
  v.fade = 1;
}

function glassAt(v, u, s, j, time, flow, view) {
  const L = frac(u + flow);
  const y = 0.76 - 1.52 * L;
  const r = 0.05 + (0.6 * Math.abs(y)) / 0.76;
  const th = j * GOLDEN * 3 + s * 2.1 + time * 0.4;
  pose(v, r * Math.cos(th), y, r * Math.sin(th), -0.15, view);
  v.hot = Math.exp(-((y / 0.12) ** 2));
  v.fade = Math.max(0, Math.min(1, L / 0.06, (1 - L) / 0.06));
}

const FORMS = [['braid', 0], ['ribbon', 1], ['glass', 2]];
const slots = [{}, {}, {}];

export function projectWeave(n, p, clock, out = []) {
  const { time, angle, flow } = clock;
  const per = Math.ceil(n / STRANDS);
  const rx = 0.35 + 0.18 * Math.sin(time * 0.27);
  const view = { cy: Math.cos(angle), sy: Math.sin(angle), cx: Math.cos(rx), sx: Math.sin(rx) };
  const active = FORMS.filter(([key]) => p[key] > 1e-4);
  let total = 0;
  for (const [key] of active) total += p[key];
  for (let i = 0; i < n; i++) {
    const s = i % STRANDS;
    const j = Math.floor(i / STRANDS);
    const u = j / per;
    let x = 0, y = 0, z = 0, depth = 0, hot = 0, fade = 0;
    for (const [key, k] of active) {
      const v = slots[k];
      if (k === 0) braidAt(v, u, s, time, flow, view);
      else if (k === 1) ribbonAt(v, u, s, time, flow, view);
      else glassAt(v, u, s, j, time, flow, view);
      const w = p[key] / total;
      x += v.x * w; y += v.y * w; z += v.z * w;
      depth += v.depth * w; hot += v.hot * w; fade += v.fade * w;
    }
    const persp = PERSPECTIVE / (PERSPECTIVE - z);
    const glow = Math.min(1, hot) * (0.4 + 0.6 * depth);
    const o = out[i] || (out[i] = {});
    o.x = x * persp;
    o.y = -y * persp;
    o.depth = depth;
    o.size = (0.5 + 0.7 * depth) * (1 + 0.8 * glow);
    o.alpha = Math.min(1, 0.16 + 0.84 * depth ** 1.4 + glow * 0.3) * fade;
    o.hot = glow;
  }
  out.length = n;
  return out;
}
