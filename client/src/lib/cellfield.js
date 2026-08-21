export const CELL = 4;
export const CELL_GAP = 1;
export const CELL_FPS = 24;
export const CELL_SPEED = 620;
export const TRAIL_DECAY = 0.86;
export const TRAIL_GAIN = 0.85;
export const AMBIENT = 1;
export const HEAD_WHITE = 0.8;
export const HEAD_CURVE = 2.2;

export function cellRand(col, row) {
  const n = Math.sin(col * 127.1 + row * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function cellRamp(col, cols) {
  if (cols < 2) return 1;
  return Math.pow(col / (cols - 1), 1.6);
}

export function headColumn(fill, width) {
  return Math.round((fill * width) / CELL) - 1;
}

export function fadeTrail(heat, decay = TRAIL_DECAY) {
  for (let c = 0; c < heat.length; c++) heat[c] *= decay;
  return heat;
}

export function stampTrail(heat, from, to) {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(heat.length - 1, Math.max(from, to));
  for (let c = a; c <= b; c++) heat[c] = 1;
  return heat;
}

export function cellAlpha(col, cols, seed, phase, heat = 0) {
  const twinkle = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(phase + seed * Math.PI * 2));
  const lit = Math.min(1, cellRamp(col, cols) * AMBIENT + heat * TRAIL_GAIN);
  return lit * twinkle;
}

export function parseRgb(value, fallback = [255, 255, 255]) {
  const m = /(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)/.exec(String(value || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : fallback;
}

export function hotMix(base, hot, heat) {
  const t = Math.pow(Math.min(1, Math.max(0, heat)), HEAD_CURVE) * HEAD_WHITE;
  return 'rgb(' + base.map((v, i) => Math.round(v + (hot[i] - v) * t)).join(',') + ')';
}

export function paintCells(ctx, w, h, dpr, colour, phase, heat, hot) {
  if (!ctx || !(w > 0) || !(h > 0)) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const base = parseRgb(colour);
  const tip = parseRgb(hot, base);
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  const size = CELL - CELL_GAP;
  for (let c = 0; c < cols; c++) {
    const lit = heat ? heat[c] || 0 : 0;
    ctx.fillStyle = lit > 0.01 ? hotMix(base, tip, lit) : colour;
    for (let r = 0; r < rows; r++) {
      ctx.globalAlpha = cellAlpha(c, cols, cellRand(c, r), phase, lit);
      ctx.fillRect(c * CELL, r * CELL, size, size);
    }
  }
  ctx.globalAlpha = 1;
}
