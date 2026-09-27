// The weave: the built-in animated model mark.
//
// This file is the pure math. It knows nothing about the DOM, canvas or React,
// which is why it can be imported by `node --test`. `components/ui/Weave.jsx`
// owns the canvas and calls `projectWeave` once per frame.
//
// A model whose icon field holds `MODEL_WEAVE` ('builtin:weave', see
// `lib/brand.js`) is drawn with this instead of an <img>. Nothing here touches
// the network or any package: it is plain trigonometry.
//
// ---------------------------------------------------------------------------
// The mental model
// ---------------------------------------------------------------------------
//
// The mark is a fixed number of dots (see `weavePointCount`). Every dot always
// exists; what changes is where each one sits. A "form" is a function that
// says where dot number i belongs in one particular shape. There is one form
// per state:
//
//   idle        braid   a hoop with three strands plaited around it, tumbling
//   thinking    glass   an hourglass that dots pour through, glowing at the waist
//   generating  ribbon  a figure-eight ribbon with bright streaks racing along it
//
// Switching state never swaps images. Each dot slides from where the old form
// puts it to where the new form puts it, so the mark visibly folds from one
// shape into the next. That is the whole trick, and it is why every form must
// use the same dot numbering (below): dot i of the braid becomes dot i of the
// ribbon.
//
// ---------------------------------------------------------------------------
// How dots are numbered
// ---------------------------------------------------------------------------
//
// Dots are split into three interleaved strands (STRANDS). For dot index i:
//
//   s = i % 3              which strand, 0, 1 or 2
//   j = floor(i / 3)       the dot's position within its strand, 0 .. per-1
//   u = j / per            the same position as a fraction, 0 .. 1
//
// Most forms read `u` as "how far along my path" and `s` as "which of my three
// lines". A form is free to ignore the strands and use i directly (a sphere,
// a grid), but a form that honours them morphs more cleanly, because strand s
// of one form lands on strand s of the next.
//
// ---------------------------------------------------------------------------
// Coordinates and size
// ---------------------------------------------------------------------------
//
// Forms work in a unit space: x to the right, y UP, z toward the viewer. The
// canvas maps a radius of 1 to 38% of the canvas size, so keep every dot
// within roughly 1 of the centre AFTER rotation, or it will be clipped at the
// edge. Perspective (PERSPECTIVE) enlarges dots near the viewer slightly, so
// leave a little headroom: 0.9 is a comfortable outer radius.
//
// Depth is what sells the 3D. `depth` runs 0 (far) to 1 (near) and drives both
// dot size and opacity, and dots are painted far to near so near ones overlap.
//
// ---------------------------------------------------------------------------
// The form contract
// ---------------------------------------------------------------------------
//
// A form is called once per dot per frame with an output object `v` and must
// set every one of these on it:
//
//   v.x, v.y, v.z   final position, already rotated (call `pose`, below)
//   v.depth         0..1, normally set for you by `pose`
//   v.hot           0..1, how much this dot is highlighted. A hot dot is drawn
//                   larger and brighter, in the SAME colour. There is
//                   deliberately no accent colour: the mark only ever uses the
//                   theme's text colour.
//   v.fade          0..1, an opacity multiplier. Use it to hide the seam where
//                   a path wraps from its end back to its start, or to make
//                   parts of a shape appear and disappear.
//
// Forms receive two clocks, and choosing the right one matters:
//
//   time   seconds since the mark mounted. Use it for things that pulse,
//          wobble or sweep at a fixed rhythm.
//   flow   the integral of the state's `stream`. Use it for dots travelling
//          along a path, e.g. `frac(u + flow)`. Because it is integrated
//          rather than computed as time * speed, changing speed between
//          states never makes the dots jump.
//
// ---------------------------------------------------------------------------
// Adding a new form, or swapping one of the three
// ---------------------------------------------------------------------------
//
//   1. Write `myFormAt(v, u, s, ...)` following the contract above. Build the
//      shape in its own comfortable orientation and hand the point to `pose`
//      with a `tilt` that shows it off; `pose` then applies the shared slow
//      tumble so every form moves as one object.
//   2. Add its key to all three entries of WEAVE_STATES. Each state must be
//      one-hot: exactly one form at 1, the rest at 0. The morph eases these
//      weights, so they must also exist on every state.
//   3. Add it to FORMS with the next slot number and dispatch it in
//      `projectWeave`.
//   4. Look at it at 20px (the model picker) and 40px (beside a reply) in both
//      light and dark. A shape that reads at 96px can turn to mush at 20px;
//      fewer, bolder features survive shrinking better than fine detail.
//
// A form that must NOT turn or tilt (a flat waveform, a line of text) skips
// `pose`, writes x, y and z itself with z = 0, and sets `v.depth` to a fixed
// value around 0.85 so it is not drawn dim. Blending still works, because
// forms are blended after each has been posed.
//
// ---------------------------------------------------------------------------
// Shapes already explored
// ---------------------------------------------------------------------------
//
// Sixty variants were prototyped before settling on braid, ribbon and
// hourglass. To avoid repeating them, these were tried and passed over:
//
//   idle        spiral galaxy, trefoil knot, lotus, planet with rings, Möbius
//               band, Borromean rings, ripples, nautilus shell, prism cage,
//               wireframe cube, moon phases, quill feather, slinky arch,
//               fireflies, crown, terrain, candle flame, eye, pebble
//   generating  fountain, vortex, expanding pulses, flat waveform, comet
//               orbit, double helix, spiral surge, woven Lissajous, blooming
//               petals, handwriting, equalizer, digital rain, firework, gears,
//               heartbeat trace, typing lines, jellyfish, propeller, river
//   thinking    gyroscope rings, atom orbits, scanning globe, infinity loop,
//               wobbling coin, twisting globe, synapse arcs, spirograph,
//               juggling rings, tesseract, sonar, combination dial, question
//               mark, magnifier, ellipsis, clock, yarn ball, light bulb,
//               pendulum wave
//
// Any of them can be rebuilt from this contract: each is a closed path, a
// surface or a set of paths described with sin/cos, laid out over (u, s).

const TAU = Math.PI * 2;

// The golden angle. Stepping around a circle by this much per dot spreads dots
// evenly with no visible spokes, which is how the hourglass scatters its dots
// around each ring instead of lining them up.
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// Distance of the virtual camera. A dot at z is scaled by P / (P - z), so a
// smaller number exaggerates perspective and a larger one flattens it.
const PERSPECTIVE = 3.4;

// Three interleaved strands. The braid is literally three strands and the
// ribbon is three parallel lines, and keeping the count shared is what lets a
// strand of one form flow into the same strand of the next.
const STRANDS = 3;

// One entry per state. The form keys are one-hot weights, the rest are motion:
//
//   spin    radians per second the whole mark turns about its vertical axis
//   stream  how fast `flow` advances, i.e. how fast dots travel along a path
//
// The component eases every one of these numbers toward the target state, so
// a morph also blends speed: the ribbon spins up as it appears.
export const WEAVE_STATES = {
  __proto__: null,
  idle: { braid: 1, ribbon: 0, glass: 0, spin: 0.2, stream: 0.1 },
  thinking: { braid: 0, ribbon: 0, glass: 1, spin: 0.2, stream: 0.18 },
  generating: { braid: 0, ribbon: 1, glass: 0, spin: 0.45, stream: 0.55 }
};

export const WEAVE_KEYS = Object.keys(WEAVE_STATES.idle);

// Unknown names, including the 'static' phase a finished reply reports, fall
// back to idle. The table is prototype-free so a name like '__proto__' cannot
// reach Object.prototype.
export function weaveState(name) {
  return WEAVE_STATES[name] || WEAVE_STATES.idle;
}

// How many dots to draw for a canvas `px` CSS pixels across: about one and a
// half per pixel per strand, clamped so a 14px mark still has a shape and a
// huge one does not cost thousands of arcs per frame. Always a multiple of
// STRANDS so every strand has the same length.
export function weavePointCount(px) {
  return STRANDS * Math.max(20, Math.min(110, Math.round(px * 1.5)));
}

// Moves each parameter a frame's worth toward its target using exponential
// smoothing, which is frame-rate independent: `rate` 4 closes about 98% of the
// gap in one second whatever the refresh rate. This is the morph speed.
export function easeParams(cur, target, dt, rate = 4) {
  const k = 1 - Math.exp(-dt * rate);
  const next = {};
  for (const key of WEAVE_KEYS) next[key] = cur[key] + (target[key] - cur[key]) * k;
  return next;
}

// Fractional part, always in [0, 1) even for negative input. Used to wrap a
// position along a closed path.
function frac(v) {
  return v - Math.floor(v);
}

// A comet tail. `behind` is how far a dot trails the head along a path (0 at
// the head), `length` how long the tail is. Returns 1 at the head falling to 0
// at the end of the tail, squared so the head is sharp and the tail soft.
function comet(behind, length) {
  return behind < length ? (1 - behind / length) ** 2 : 0;
}

// Places a point built in a form's own coordinates into the shared view.
//
//   tilt   the form's own lean about the x axis, chosen per form so its best
//          side faces the viewer (the braid's hoop is tipped back to show its
//          ring, the hourglass stands nearly upright)
//   view   the shared rotation for this frame: a turn about the vertical axis
//          by the integrated spin, then a gently rocking lean toward the
//          viewer. Built once per frame in `projectWeave`.
//
// Writes the final x, y, z and derives depth from z.
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

// Idle. A hoop of radius 0.68 with three strands plaited around it.
//
// `a` walks around the hoop. `ph` is each strand's angle around the hoop's
// tube: offset by a third of a turn per strand so the three interleave, and
// advanced by 3a so each strand wraps the tube three times per lap, which is
// what makes it read as a braid. Adding `flow` to `ph` makes the plait roll
// slowly around the tube.
//
// The tube radius is 0.2, so dots stay within 0.88 of the centre. The hoop is
// tipped back by -1.05 rad so it is seen as a ring rather than edge on; the
// shared tumble then turns it through its edge-on moment now and then, which
// is intended.
//
// A single soft glint travels around the hoop every seven seconds or so.
function braidAt(v, u, s, time, flow, view) {
  const L = frac(u + flow * 0.25);
  const a = L * TAU;
  const ph = (s * TAU) / STRANDS + 3 * a + flow * TAU;
  const rad = 0.68 + 0.2 * Math.cos(ph);
  pose(v, rad * Math.cos(a), rad * Math.sin(a), 0.2 * Math.sin(ph), -1.05, view);
  v.hot = 0.7 * comet(frac(time * 0.14 - L), 0.14);
  v.fade = 1;
}

// Generating. A figure-eight ribbon in 3D: x = sin a, y = sin 2a traces the
// eight, and z = cos 3a lifts and dips it so the loops pass in front of and
// behind each other.
//
// The three strands are three parallel lines a little apart in y (`lift`),
// with the gap breathing so the ribbon twists as it goes. `sc` swells the
// whole shape with two sines multiplied together, which gives an irregular,
// speech-like pulse rather than a steady beat.
//
// Dots stream along the path at the state's `stream` speed, and three bright
// streaks, a third of a lap apart, race along it slightly faster than the
// dots so they read as energy moving through the ribbon.
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

// Thinking. Two cones point to point, with dots pouring from the top through
// the narrow waist and out of the bottom, like sand in an hourglass.
//
// `L` is how far a dot has fallen, 0 at the top rim and 1 at the bottom. The
// radius shrinks linearly toward the waist and grows again after it, never
// reaching zero (0.05) so the waist stays a visible neck. Each dot sits at its
// own angle around the axis, spread with the golden angle so the cones fill
// evenly instead of forming stripes, and the whole thing slowly turns.
//
// Dots glow as they squeeze through the waist, and fade in at the top and out
// at the bottom so there is no visible jump when a dot wraps back to the top.
function glassAt(v, u, s, j, time, flow, view) {
  const L = frac(u + flow);
  const y = 0.76 - 1.52 * L;
  const r = 0.05 + (0.6 * Math.abs(y)) / 0.76;
  const th = j * GOLDEN * 3 + s * 2.1 + time * 0.4;
  pose(v, r * Math.cos(th), y, r * Math.sin(th), -0.15, view);
  v.hot = Math.exp(-((y / 0.12) ** 2));
  v.fade = Math.max(0, Math.min(1, L / 0.06, (1 - L) / 0.06));
}

// Every form, as [key in WEAVE_STATES, slot]. The slot picks the function in
// `projectWeave` and the scratch object it writes into.
const FORMS = [['braid', 0], ['ribbon', 1], ['glass', 2]];

// One reusable output object per form, so a frame allocates nothing per dot.
const slots = [{}, {}, {}];

// Computes every dot for one frame.
//
//   n      dot count, from `weavePointCount`
//   p      the current, possibly mid-morph, parameters (see WEAVE_STATES)
//   clock  { time, angle, flow }: seconds, integrated spin, integrated stream
//   out    an array to fill and reuse between frames
//
// For each dot it asks every form that currently has weight where that dot
// belongs, and takes the weighted average. At rest only one form has weight,
// so this is just that shape; mid-morph each dot sits partway along the line
// between its place in the old shape and its place in the new one. Forms with
// no weight are skipped entirely, so a settled mark costs one form per dot.
//
// Returns, per dot, the screen position in unit space (y flipped to point
// down, as the canvas expects), plus depth, size multiplier, opacity and
// highlight for the painter in `Weave.jsx`.
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
    // Near dots spread out and far dots draw in, which is what makes the
    // shape look solid rather than flat.
    const persp = PERSPECTIVE / (PERSPECTIVE - z);
    // A highlight on the far side is dimmed so it does not shine through the
    // front of the shape.
    const glow = Math.min(1, hot) * (0.4 + 0.6 * depth);
    const o = out[i] || (out[i] = {});
    o.x = x * persp;
    o.y = -y * persp;
    o.depth = depth;
    // Far dots are half size and near dots 1.2x; a highlight adds up to 80%.
    o.size = (0.5 + 0.7 * depth) * (1 + 0.8 * glow);
    // Far dots fade to 16% so the back of the shape stays readable without
    // cluttering the front. The 1.4 power keeps the middle depths dimmer than
    // a straight line would.
    o.alpha = Math.min(1, 0.16 + 0.84 * depth ** 1.4 + glow * 0.3) * fade;
    o.hot = glow;
  }
  out.length = n;
  return out;
}
