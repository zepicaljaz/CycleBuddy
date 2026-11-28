import * as THREE from 'three';
import { curve, loft, merge, outline, paint, v3, type Detail } from './geometry';

/*
 * The rider's head: face, ears and hair; a vented road helmet with its retention cradle and
 * straps; wraparound sunglasses. Built once per detail level in the head frame and placed on
 * the body by riderBody.ts with the head's tilt.
 *
 * Head frame: origin in the middle of the cranium, +x forward (the face), +y up, +z right. Metres.
 *
 * The head is a loft of horizontal sections. Each section is two half superellipses (face and
 * back of the head) around its widest point. Above the brow the sections are those of one egg,
 * CRANIUM, and the helmet is that egg grown by PAD, so the shell sits close on the hair and
 * never cuts it. Nose, brow, eye sockets, cheekbones, lips and chin are reliefs pushed out along
 * each section's normal, so the face is one surface. Straps and glasses' arms are laid on that
 * surface through `headPoint` and `headNormal`.
 */

const { smoothstep } = THREE.MathUtils;
const DEG = Math.PI / 180;
const WHITE = 0xffffff;

/** Piecewise-linear lookup in ascending `xs`. */
function lin(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  }
  return ys[ys.length - 1];
}

/** Smooth curve through (xs, ys), xs ascending: cubic Hermite with Catmull-Rom slopes. */
function spline(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (x > xs[i + 1]) i++;
  const slope = (k: number) => {
    const a = Math.max(0, k - 1);
    const b = Math.min(n - 1, k + 1);
    return (ys[b] - ys[a]) / (xs[b] - xs[a]);
  };
  const h = xs[i + 1] - xs[i];
  const s = (x - xs[i]) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * slope(i) * h + (3 * s2 - 2 * s3) * ys[i + 1] + (s3 - s2) * slope(i + 1) * h;
}

/** 1 at 0, easing to 0 at ±r. */
const bump = (d: number, r: number): number => {
  const t = d / r;
  return t * t >= 1 ? 0 : (1 - t * t) ** 2;
};
/** 1 while |d| < a, easing to 0 at b. */
const within = (d: number, a: number, b: number): number => 1 - smoothstep(Math.abs(d), a, b);

// ---------------------------------------------------------------------------------------------
// Head surface

/** The skull above the brow: two half ellipsoids (the back is longer) around this centre. */
export const CRANIUM = { x: -0.004, y: 0.004, front: 0.096, back: 0.1, up: 0.11, side: 0.077 } as const;
/** Hair over the skull at its thickest; it thins to HAIR_EDGE at the hairline. */
const HAIR = 0.0042;
const HAIR_EDGE = 0.0008;
/** Helmet padding: the shell's inner surface is CRANIUM grown by this much in every axis. */
const PAD = 0.0095;

/** Horizontal section at one height: face, widest point, back (x), half width, and the squareness
 *  of the face and back halves (2 is an ellipse; more is flatter in the middle). */
interface Section {
  xf: number;
  xs: number;
  xb: number;
  w: number;
  ef: number;
  eb: number;
}

function craniumSection(y: number): Section {
  const k = Math.sqrt(Math.max(0, 1 - ((y - CRANIUM.y) / CRANIUM.up) ** 2));
  return { xf: CRANIUM.x + CRANIUM.front * k, xs: CRANIUM.x, xb: CRANIUM.x - CRANIUM.back * k, w: CRANIUM.side * k, ef: 2, eb: 2 };
}

/**
 * Sections below the brow, from the bottom of the chin up: [y, xf, xs, xb, w, ef, eb].
 * Proportions of an adult man: eyes at half the head's height, face in thirds (brow, nose base,
 * chin), jaw 11 cm across, cheekbones 14 cm. The back moves forward below the ears into the neck.
 */
const FACE: readonly (readonly number[])[] = [
  [-0.1195, 0.066, 0.054, 0.046, 0.012, 2.4, 2],
  [-0.1165, 0.077, 0.052, 0.04, 0.023, 2.8, 2],
  [-0.111, 0.0855, 0.044, 0.026, 0.0345, 3, 2],
  [-0.103, 0.0905, 0.03, 0.008, 0.0448, 3, 2],
  [-0.093, 0.0925, 0.014, -0.013, 0.0522, 2.9, 2],
  [-0.082, 0.0935, 0.002, -0.031, 0.0572, 2.7, 2],
  [-0.072, 0.0945, -0.004, -0.047, 0.0605, 2.6, 2],
  [-0.062, 0.095, -0.007, -0.061, 0.0625, 2.6, 2],
  [-0.052, 0.0945, -0.008, -0.074, 0.065, 2.7, 2],
  [-0.042, 0.0935, -0.008, -0.084, 0.068, 2.8, 2],
  [-0.03, 0.0925, -0.007, -0.093, 0.0712, 2.9, 2],
  [-0.018, 0.092, -0.006, -0.0985, 0.0738, 2.9, 2],
  [-0.006, 0.0915, -0.005, -0.1015, 0.0758, 2.8, 2],
  [0.006, 0.0915, -0.004, -0.1025, 0.0765, 2.6, 2],
  [0.018, 0.0915, -0.004, -0.1025, 0.0762, 2.3, 2],
];
/** Above this the head is CRANIUM exactly. */
const BROW_TOP = 0.04;
const KNOT_Y: number[] = [];
const KNOT_V: number[][] = [[], [], [], [], [], []];
for (const row of FACE) {
  KNOT_Y.push(row[0]);
  for (let i = 0; i < 6; i++) KNOT_V[i].push(row[i + 1]);
}
for (const y of [0.03, BROW_TOP, 0.05]) {
  const s = craniumSection(y);
  KNOT_Y.push(y);
  [s.xf, s.xs, s.xb, s.w, s.ef, s.eb].forEach((v, i) => KNOT_V[i].push(v));
}
/** Bottom of the chin: the lowest section. */
const CHIN_Y = FACE[0][0];

function section(y: number): Section {
  if (y >= BROW_TOP) return craniumSection(y);
  const at = (i: number) => spline(KNOT_Y, KNOT_V[i], y);
  return { xf: at(0), xs: at(1), xb: at(2), w: at(3), ef: at(4), eb: at(5) };
}

// Nose ridge: height off the face and half width, from below the tip up to the bridge.
const NOSE_Y = [-0.056, -0.05, -0.046, -0.04, -0.034, -0.024, -0.012, 0, 0.012];
const NOSE_H = [0, 0.008, 0.019, 0.0225, 0.0195, 0.0135, 0.0085, 0.0045, 0];
const NOSE_W = [0.017, 0.0165, 0.0155, 0.0145, 0.0135, 0.0118, 0.0102, 0.0088, 0.0075];
/** Across the nose: a rounded top, then the sides fall to the cheek. */
const ridge = (d: number, r: number): number => 1 - smoothstep(Math.abs(d) / r, 0.25, 1);

/** How far the face stands out of its section at (z across, y up); `c` is the cosine of the
 *  section angle, so the back of the head is left alone. */
function relief(z: number, y: number, c: number): number {
  if (c <= 0) return 0;
  const az = Math.abs(z);
  let d = lin(NOSE_Y, NOSE_H, y) * ridge(z, lin(NOSE_Y, NOSE_W, y));
  d += 0.005 * bump(az - 0.0145, 0.0075) * bump(y + 0.046, 0.0075); // nostril wings
  d += 0.004 * bump(y - 0.018, 0.012) * within(z, 0.035, 0.06); // brow ridge
  d -= 0.005 * bump(az - 0.032, 0.016) * bump(y, 0.012); // eye sockets
  d += 0.0038 * bump(az - 0.05, 0.02) * bump(y + 0.028, 0.016); // cheekbones
  d -= 0.0028 * bump(az - 0.046, 0.016) * bump(y + 0.056, 0.014); // lean cheeks under them
  d += 0.0032 * bump(y + 0.062, 0.007) * within(z, 0.014, 0.025); // upper lip
  d -= 0.0022 * bump(y + 0.0715, 0.0035) * within(z, 0.016, 0.025); // mouth
  d += 0.0028 * bump(y + 0.078, 0.006) * within(z, 0.012, 0.023); // lower lip
  d -= 0.0025 * bump(y + 0.09, 0.006) * within(z, 0.015, 0.03); // fold under the lip
  d += 0.0055 * bump(y + 0.103, 0.011) * within(z, 0.016, 0.032); // chin
  return d * smoothstep(c, 0.25, 0.6);
}

/**
 * Point on the skin at section angle `theta` (0 is the face, ±π the back of the head, +π/2 the
 * right ear side) and height `y`.
 */
export function headPoint(theta: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const s = section(y);
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  const front = c >= 0;
  const a = Math.max(1e-4, front ? s.xf - s.xs : s.xs - s.xb);
  const b = Math.max(1e-4, s.w);
  const e = front ? s.ef : s.eb;
  const r = Math.pow(Math.pow(Math.abs(c) / a, e) + Math.pow(Math.abs(sn) / b, e), -1 / e);
  const px = r * c;
  const pz = r * sn;
  // Outward normal of the section there, for the reliefs.
  const nx = (Math.sign(c) * Math.pow(Math.abs(px) / a, e - 1)) / a;
  const nz = (Math.sign(sn) * Math.pow(Math.abs(pz) / b, e - 1)) / b;
  const l = Math.hypot(nx, nz) || 1;
  const d = relief(pz, y, c);
  return out.set(s.xs + px + (nx / l) * d, y, pz + (nz / l) * d);
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Outward unit normal of the skin at (theta, y). */
export function headNormal(theta: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  headPoint(theta - 0.002, y, _a);
  headPoint(theta + 0.002, y, _b);
  headPoint(theta, y - 0.001, _c);
  headPoint(theta, y + 0.001, _d);
  return out.crossVectors(_d.sub(_c), _b.sub(_a)).normalize();
}

/** Section angles for `n` columns, packed at the face when `dense` < 1. Starts at the back (−π). */
function columns(n: number, dense: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * k) / n - 1;
    out.push(Math.PI * (dense * t + (1 - dense) * t * t * t));
  }
  return out;
}

/** Ring heights per detail level, chin to crown. Close up there is a ring on every feature. */
const RINGS: Record<Detail, number[]> = {
  0: [-0.1195, -0.1165, -0.111, -0.103, -0.096, -0.09, -0.084, -0.078, -0.0715, -0.066, -0.062, -0.056, -0.051, -0.046, -0.04, -0.033, -0.025, -0.016, -0.006, 0.006, 0.018, 0.03, 0.044, 0.062, 0.082, 0.1, 0.1125],
  1: [-0.118, -0.106, -0.09, -0.074, -0.058, -0.042, -0.022, 0.002, 0.03, 0.068, 0.106],
  2: [-0.115, -0.085, -0.052, -0.016, 0.028, 0.072, 0.106],
};
const COLUMNS: Record<Detail, [number, number]> = { 0: [40, 0.34], 1: [14, 0.7], 2: [8, 0.85] };

/** Hairline height by section angle (degrees from the face): short back and sides, a sideburn
 *  in front of the ear, over the ear, down to the nape. */
const HAIRLINE_A = [0, 25, 45, 62, 70, 76, 88, 94, 104, 118, 132, 155, 180];
const HAIRLINE_Y = [0.066, 0.064, 0.052, 0.036, 0.026, -0.006, -0.01, 0.014, 0.018, 0.004, -0.03, -0.046, -0.052];
const hairline = (theta: number): number => lin(HAIRLINE_A, HAIRLINE_Y, Math.abs(THREE.MathUtils.euclideanModulo(theta + Math.PI, 2 * Math.PI) - Math.PI) / DEG);

/** Thickness of the hair over the skin at (theta, y); 0 below the hairline. */
function hairDepth(theta: number, y: number): number {
  const h = y - hairline(theta);
  if (h < 0) return 0;
  return HAIR_EDGE + (HAIR - HAIR_EDGE) * smoothstep(h, 0, 0.012);
}

/** True if the point is inside the skin (between the chin and the crown). */
export function insideHead(x: number, y: number, z: number): boolean {
  if (y < CHIN_Y) return false;
  const s = section(y);
  const p = headPoint(Math.atan2(z, x - s.xs), y, _a);
  return Math.hypot(x - s.xs, z) < Math.hypot(p.x - s.xs, p.z);
}

/** Height of the underside of the jaw above (x, z). */
function jawUnderside(x: number, z: number): number {
  let lo = CHIN_Y - 0.002;
  let hi = -0.06;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (insideHead(x, mid, z)) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function skin(detail: Detail): THREE.BufferGeometry {
  const [n, dense] = COLUMNS[detail];
  const cols = columns(n, dense);
  const rings = RINGS[detail].map((y) => cols.map((t) => headPoint(t, y)));
  const g = paint(loft(rings, true, true), WHITE, { crease: 1.2 });
  // Lips a little darker and redder than the skin, the line between them darker still, and
  // the underside of the jaw in its own shade so the face does not run on into the neck.
  const p = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const col = g.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const face = smoothstep(x, 0.075, 0.088);
    const lips = (bump(y + 0.0625, 0.0055) + bump(y + 0.078, 0.0055)) * within(z, 0.013, 0.024) * face;
    const line = bump(y + 0.0715, 0.0032) * within(z, 0.016, 0.025) * face;
    const under = smoothstep(-nrm.getY(i), 0.35, 0.85) * (1 - smoothstep(y, -0.075, -0.05));
    const k = 1 - 0.2 * under;
    col.setXYZ(i, col.getX(i) * k * (1 - 0.03 * lips - 0.26 * line), col.getY(i) * k * (1 - 0.13 * lips - 0.32 * line), col.getZ(i) * k * (1 - 0.11 * lips - 0.32 * line));
  }
  return g;
}

function hair(detail: Detail): THREE.BufferGeometry {
  const [n, dense] = COLUMNS[detail];
  const cols = columns(n, dense);
  const top = RINGS[detail][RINGS[detail].length - 1];
  const rows = detail === 0 ? 6 : detail === 1 ? 3 : 2;
  const nrm = new THREE.Vector3();
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= rows; i++) {
    const f = i / rows;
    rings.push(
      cols.map((t) => {
        // Rows packed towards the hairline, where the edge shows.
        const y = THREE.MathUtils.lerp(top, hairline(t), 1 - (1 - f) * (1 - f));
        return headPoint(t, y).addScaledVector(headNormal(t, y, nrm), hairDepth(t, y));
      }),
    );
  }
  return paint(loft(rings, true, false), 0x2a1d14, { crease: 1.2 });
}

// ---------------------------------------------------------------------------------------------
// Tubes and ribbons with their own frame at every point

/** Flat four-sided section for straps and bands. */
const FLAT: [number, number][] = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/**
 * Closed tube along `points` whose cross-section `shape` (unit points, e.g. `outline`) is scaled
 * by `ha` along the given `axes` (made square to the path) and by `hb` across them.
 */
function frameTube(points: THREE.Vector3[], axes: THREE.Vector3[], ha: number | ((t: number) => number), hb: number | ((t: number) => number), shape: [number, number][]): THREE.BufferGeometry {
  const T = new THREE.Vector3();
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const rings: THREE.Vector3[][] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    T.subVectors(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
    A.copy(axes[i]).addScaledVector(T, -axes[i].dot(T)).normalize();
    B.crossVectors(T, A);
    const t = i / (n - 1);
    const a = typeof ha === 'number' ? ha : ha(t);
    const b = typeof hb === 'number' ? hb : hb(t);
    rings.push(shape.map(([c, s]) => points[i].clone().addScaledVector(A, c * a).addScaledVector(B, s * b)));
  }
  return loft(rings, true, true);
}

/** Points and normals on the skin along a path given as (section angle, y) pairs, lifted off the
 *  skin (and any hair) by `lift`. */
function onHead(path: [number, number][], samples: number, lift: number): { points: THREE.Vector3[]; normals: THREE.Vector3[] } {
  const smooth = curve(path.map(([t, y]) => v3(t, y)), samples);
  const points: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  for (const s of smooth) {
    const nrm = headNormal(s.x, s.y);
    points.push(headPoint(s.x, s.y).addScaledVector(nrm, hairDepth(s.x, s.y) + lift));
    normals.push(nrm);
  }
  return { points, normals };
}

/** Small box laid on a surface: `along` the strap, `nrm` out of the skin. */
function plate(at: THREE.Vector3, along: THREE.Vector3, nrm: THREE.Vector3, l: number, w: number, h: number): THREE.BufferGeometry {
  const n = nrm.clone().normalize();
  const a = along.clone().addScaledVector(n, -along.dot(n)).normalize();
  const s = new THREE.Vector3().crossVectors(n, a);
  const m = new THREE.Matrix4().makeBasis(a, n, s).setPosition(at);
  return new THREE.BoxGeometry(l, h, w).applyMatrix4(m);
}

// ---------------------------------------------------------------------------------------------
// Ears

function ear(side: number): { body: THREE.BufferGeometry; bowl: THREE.BufferGeometry } {
  const theta = side * 97 * DEG;
  const rootY = -0.017;
  const nrm = headNormal(theta, rootY);
  nrm.y = 0;
  nrm.normalize();
  const root = headPoint(theta, rootY).addScaledVector(nrm, -0.0008);
  // Leans back 15°, and its back edge stands 24° off the side of the head.
  const lean = 15 * DEG;
  const flare = 24 * DEG;
  const up = v3(-Math.sin(lean), Math.cos(lean));
  up.addScaledVector(nrm, -up.dot(nrm)).normalize();
  const back = new THREE.Vector3().crossVectors(nrm, up);
  if (back.x > 0) back.negate();
  const bk = back.clone().multiplyScalar(Math.cos(flare)).addScaledVector(nrm, Math.sin(flare));
  const out = nrm.clone().multiplyScalar(Math.cos(flare)).addScaledVector(back, -Math.sin(flare));
  const at = (b: number, u: number, o = 0) => root.clone().addScaledVector(bk, b).addScaledVector(up, u).addScaledVector(out, o);
  // The rim (helix) from the front above the ear canal, over the top and down the back to the lobe.
  const rim = curve(
    [at(0.002, 0.011), at(0.005, 0.021), at(0.011, 0.0275), at(0.019, 0.028), at(0.026, 0.022), at(0.029, 0.011), at(0.028, -0.002), at(0.024, -0.013), at(0.018, -0.021), at(0.011, -0.026), at(0.005, -0.024), at(0.002, -0.018)],
    14,
  );
  const outs = rim.map(() => out);
  const body = frameTube(rim, outs, 0.0032, (t) => (t > 0.72 ? 0.0042 + 0.0022 * smoothstep(t, 0.72, 0.9) : 0.0042), outline(6, 2));
  // The bowl inside the rim, a little sunk and darker.
  const bowl = new THREE.SphereGeometry(1, 8, 6)
    .scale(0.0125, 0.02, 0.0036)
    .applyMatrix4(new THREE.Matrix4().makeBasis(bk, up, out).setPosition(at(0.0135, 0.001, -0.0012)));
  return { body, bowl };
}

// ---------------------------------------------------------------------------------------------
// Sunglasses: one wraparound lens on an ellipse round the eyes, a half frame along its top
// and round its ends, arms along the side of the head over the ears, pads on the nose.

const LENS = { cx: -0.003, a: 0.1065, b: 0.09, span: 1.08, thick: 0.0028 } as const;
const lensTop = (s: number): number => 0.0195 - 0.0045 * s * s;
const LENS_BOT_S = [0, 0.1, 0.2, 0.35, 0.6, 0.85, 1];
const LENS_BOT_Y = [-0.0012, -0.005, -0.0165, -0.021, -0.019, -0.0105, -0.0015];
const lensBottom = (s: number): number => lin(LENS_BOT_S, LENS_BOT_Y, Math.abs(s));

/** Point on the lens' middle surface at s in [-1, 1] across (+1 is the right temple). */
function lensPoint(s: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const f = s * LENS.span;
  return out.set(LENS.cx + LENS.a * Math.cos(f), y, LENS.b * Math.sin(f));
}
function lensNormal(s: number): THREE.Vector3 {
  const f = s * LENS.span;
  return v3(Math.cos(f) / LENS.a, 0, Math.sin(f) / LENS.b).normalize();
}

function glasses(detail: Detail): { lens: THREE.BufferGeometry; frame: THREE.BufferGeometry[] } {
  const hi = detail === 0;
  const n = hi ? 24 : detail === 1 ? 6 : 4;
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= n; i++) {
    const s = (2 * i) / n - 1;
    const nrm = lensNormal(s);
    const top = lensTop(s);
    const bot = lensBottom(s);
    const h = LENS.thick / 2;
    rings.push([lensPoint(s, top).addScaledVector(nrm, h), lensPoint(s, bot).addScaledVector(nrm, h), lensPoint(s, bot).addScaledVector(nrm, -h), lensPoint(s, top).addScaledVector(nrm, -h)]);
  }
  const lens = loft(rings, true, true);
  if (!hi) return { lens, frame: [] };

  const frame: THREE.BufferGeometry[] = [];
  // Brow bar along the top edge, wrapping down round each end of the lens.
  const bar: THREE.Vector3[] = [];
  const add = (s: number, y: number) => bar.push(lensPoint(s, y).addScaledVector(lensNormal(s), 0.0006));
  add(-1.035, lensBottom(1) + 0.004);
  add(-1.04, lensTop(1) - 0.004);
  for (let i = 0; i <= 16; i++) {
    const s = -1 + (2 * i) / 16;
    add(s, lensTop(s) + 0.0008);
  }
  add(1.04, lensTop(1) - 0.004);
  add(1.035, lensBottom(1) + 0.004);
  const barPts = curve(bar, 28);
  const barAx = barPts.map((p) => {
    const s = Math.asin(THREE.MathUtils.clamp(p.z / LENS.b, -1, 1)) / LENS.span;
    return lensNormal(s);
  });
  frame.push(frameTube(barPts, barAx, 0.0026, 0.0028, outline(6, 3)));
  for (const side of [-1, 1]) {
    // Arm: from the hinge at the end of the lens, along the head above the ear, over its root
    // and a little down behind it.
    const hinge = lensPoint(side * 1.04, lensTop(1) - 0.003);
    const { points, normals } = onHead(
      [
        [side * 72 * DEG, 0.0155],
        [side * 86 * DEG, 0.0165],
        [side * 99 * DEG, 0.0175],
        [side * 111 * DEG, 0.0145],
        [side * 121 * DEG, 0.006],
        [side * 127 * DEG, -0.004],
      ],
      10,
      0.0034,
    );
    const pts = [hinge, ...points];
    const axes = [lensNormal(side), ...normals];
    frame.push(frameTube(pts, axes, (t) => 0.0016 + 0.0006 * (1 - t), (t) => 0.0034 - 0.0012 * t, outline(6, 3)));
    // Pad between the lens and the side of the nose.
    const pad = new THREE.SphereGeometry(1, 6, 4).scale(0.0052, 0.0034, 0.0018).rotateY(side * 0.35).translate(0.0966, -0.0018, side * 0.0076);
    frame.push(pad);
  }
  return { lens, frame };
}

// ---------------------------------------------------------------------------------------------
// Helmet

const C = v3(CRANIUM.x, CRANIUM.y);

/** Distance from the cranium's centre to the helmet's inner surface along unit direction `d`. */
export function helmetInner(d: THREE.Vector3): number {
  const a = (d.x > 0 ? CRANIUM.front : CRANIUM.back) + PAD;
  return 1 / Math.sqrt((d.x / a) ** 2 + (d.y / (CRANIUM.up + PAD)) ** 2 + (d.z / (CRANIUM.side + PAD)) ** 2);
}

/** Height of the helmet's lower edge by azimuth round the head (degrees, 0 at the brow, 180 at the
 *  nape): low over the brow, up over the ears, down over the back of the skull. */
const RIM_A = [0, 25, 45, 62, 78, 96, 112, 128, 146, 164, 180];
const RIM_Y = [0.0385, 0.037, 0.0335, 0.0285, 0.025, 0.025, 0.018, 0.006, -0.012, -0.026, -0.031];
export function rimHeight(azimuth: number): number {
  const a = Math.abs(Math.atan2(Math.sin(azimuth), Math.cos(azimuth))) / DEG;
  return lin(RIM_A, RIM_Y, a);
}

/**
 * The shell is a four-sided patch over the head: u runs from the brow edge (0) to the back edge
 * (1), v from the left edge over the ear (-1) to the right one (1). Corners at the temples and
 * behind the ears. The patch lives in angles round the cranium's centre: phi in the middle plane
 * from the front over the top to the back, psi out to the side.
 */
const AF = 62 * DEG;
const AB = 128 * DEG;

function rimAngles(azimuth: number): [number, number] {
  const ca = Math.cos(azimuth);
  const sa = Math.sin(azimuth);
  const y = rimHeight(azimuth);
  const k = Math.sqrt(Math.max(0, 1 - ((y - C.y) / (CRANIUM.up + PAD)) ** 2));
  const a = (ca > 0 ? CRANIUM.front : CRANIUM.back) + PAD;
  const rho = k / Math.sqrt((ca / a) ** 2 + (sa / (CRANIUM.side + PAD)) ** 2);
  const dx = rho * ca;
  const dy = y - C.y;
  const dz = rho * sa;
  let phi = Math.atan2(dy, dx);
  if (phi < -Math.PI / 2) phi += 2 * Math.PI;
  return [phi, Math.asin(dz / Math.hypot(dx, dy, dz))];
}

const edge = {
  front: (v: number) => rimAngles(v * AF),
  back: (v: number) => rimAngles(Math.PI - v * (Math.PI - AB)),
  right: (u: number) => rimAngles(AF + u * (AB - AF)),
  left: (u: number) => rimAngles(-(AF + u * (AB - AF))),
};
const CORNERS = { fl: edge.front(-1), fr: edge.front(1), bl: edge.back(-1), br: edge.back(1) };

/** Unit direction from the cranium's centre to patch point (u, v): a Coons patch of the four edges. */
function shellDir(u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
  const f = edge.front(v);
  const b = edge.back(v);
  const l = edge.left(u);
  const r = edge.right(u);
  const wl = (1 - v) / 2;
  const wr = (1 + v) / 2;
  const mix = (i: 0 | 1) =>
    (1 - u) * f[i] + u * b[i] + wl * l[i] + wr * r[i] - ((1 - u) * (wl * CORNERS.fl[i] + wr * CORNERS.fr[i]) + u * (wl * CORNERS.bl[i] + wr * CORNERS.br[i]));
  const phi = mix(0);
  const psi = mix(1);
  return out.set(Math.cos(psi) * Math.cos(phi), Math.cos(psi) * Math.sin(phi), Math.sin(psi));
}

/** Shell thickness: thinner at the brow edge and down the sides. */
const thickness = (u: number, v: number): number => 0.021 * (1 - 0.3 * v * v) * (0.76 + 0.24 * smoothstep(u, 0, 0.16));
const TAIL = v3(-0.96, -0.28).normalize();

/** Point of the shell at patch (u, v), `depth` 0 on the inner surface, 1 on the outer. */
function shellPoint(u: number, v: number, depth: number, out = new THREE.Vector3()): THREE.Vector3 {
  const d = shellDir(u, v, _a);
  // A small ridge along the brow edge, and the back drawn out into a short tail.
  const lip = 0.0024 * (1 - smoothstep(u, 0, 0.08)) * (1 - 0.6 * v * v);
  const tail = 0.017 * Math.pow(smoothstep(u, 0.45, 1), 1.5) * (1 - 0.5 * v * v);
  return out
    .copy(C)
    .addScaledVector(d, helmetInner(d) + depth * (thickness(u, v) + lip))
    .addScaledVector(TAIL, tail * depth);
}

// Grid lines of the shell. Vents sit exactly on them, so each vent is a run of whole cells.
const U_LINES: Record<Detail, number[]> = {
  0: [0, 0.03, 0.07, 0.12, 0.18, 0.25, 0.31, 0.37, 0.43, 0.49, 0.55, 0.61, 0.67, 0.73, 0.79, 0.85, 0.9, 0.945, 0.975, 1],
  1: [0, 0.07, 0.25, 0.31, 0.55, 0.61, 0.79, 0.9, 1],
  2: [0, 0.18, 0.4, 0.62, 0.82, 1],
};
const V_HALF: Record<Detail, number[]> = {
  0: [0, 0.07, 0.14, 0.25, 0.36, 0.44, 0.52, 0.63, 0.74, 0.83, 0.91, 0.96, 1],
  1: [0, 0.14, 0.36, 0.62, 0.86, 1],
  2: [0, 0.4, 0.75, 1],
};
/** Vents as [u0, u1, v0, v1] on the right half, mirrored to the left. */
type Vent = [number, number, number, number];
const VENTS: Vent[] = [
  [0.07, 0.25, 0.14, 0.36], // front intakes either side of the centre rib
  [0.12, 0.25, 0.52, 0.74],
  [0.31, 0.55, 0.14, 0.36], // channels over the top
  [0.31, 0.49, 0.52, 0.74],
  [0.61, 0.79, 0.14, 0.36], // rear channels
  [0.67, 0.85, 0.52, 0.74],
  [0.85, 0.945, 0.14, 0.36], // exhaust ports above the back edge
];
/** Mid distance keeps the three big pairs, so the helmet does not change when it switches. */
const VENTS_AT: Record<Detail, Vent[]> = { 0: VENTS, 1: [VENTS[0], VENTS[2], VENTS[4]], 2: [] };
const inVent = (vents: Vent[], u: number, v: number): boolean => vents.some(([u0, u1, v0, v1]) => u > u0 && u < u1 && Math.abs(v) > v0 && Math.abs(v) < v1);

/** Triangles pushed so that their normal points along `ref`. */
class Faces {
  readonly pos: number[] = [];
  /** Each triangle is turned on its own: a coarse cell can be far from flat. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ref: THREE.Vector3): void {
    _b.subVectors(b, a);
    _c.subVectors(c, a);
    const [q, r] = _d.crossVectors(_b, _c).dot(ref) < 0 ? [c, b] : [b, c];
    this.pos.push(a.x, a.y, a.z, q.x, q.y, q.z, r.x, r.y, r.z);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ref: THREE.Vector3): void {
    this.tri(a, b, c, ref);
    this.tri(a, c, d, ref);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    return g;
  }
}

interface HelmetParts {
  /** Outer shell and the top of its edge: the helmet colour. */
  shell: THREE.BufferGeometry;
  /** Underside of the edge, inside of the shell, vent walls and floors, cradle: dark. */
  liner: THREE.BufferGeometry;
  /** Straps, strap dividers and buckle. */
  straps: THREE.BufferGeometry[];
}

function helmet(detail: Detail): HelmetParts {
  const us = U_LINES[detail];
  const vs = [...V_HALF[detail].slice(1).reverse().map((v) => -v), ...V_HALF[detail]];
  const isVent = (u: number, v: number) => inVent(VENTS_AT[detail], u, v);
  const outer = us.map((u) => vs.map((v) => shellPoint(u, v, 1)));
  const floor = us.map((u) => vs.map((v) => shellPoint(u, v, 0.3)));
  const shell = new Faces();
  const liner = new Faces();
  const pit = new Faces();
  const ref = new THREE.Vector3();
  const mid = new THREE.Vector3();
  for (let i = 0; i < us.length - 1; i++) {
    for (let j = 0; j < vs.length - 1; j++) {
      const um = (us[i] + us[i + 1]) / 2;
      const vm = (vs[j] + vs[j + 1]) / 2;
      const o = [outer[i][j], outer[i + 1][j], outer[i + 1][j + 1], outer[i][j + 1]];
      if (!isVent(um, vm)) {
        shell.quad(o[0], o[1], o[2], o[3], ref.subVectors(o[0], C));
        continue;
      }
      const f = [floor[i][j], floor[i + 1][j], floor[i + 1][j + 1], floor[i][j + 1]];
      pit.quad(f[0], f[1], f[2], f[3], ref.subVectors(f[0], C));
      shellPoint(um, vm, 1, mid);
      // Walls where the neighbour is solid shell: [corner, corner, neighbour's cell centre].
      const sides: [number, number, number, number][] = [
        [0, 1, um, vs[j] - 1e-3],
        [1, 2, us[i + 1] + 1e-3, vm],
        [2, 3, um, vs[j + 1] + 1e-3],
        [3, 0, us[i] - 1e-3, vm],
      ];
      for (const [p, q, nu, nv] of sides) {
        if (isVent(nu, nv)) continue;
        const edgeMid = o[p].clone().add(o[q]).multiplyScalar(0.5);
        liner.quad(o[p], o[q], f[q], f[p], ref.subVectors(mid, edgeMid));
      }
    }
  }

  // The edge all round: boundary of the patch in order, front, right, back, left.
  const loop: [number, number][] = [];
  for (const v of vs) loop.push([0, v]);
  for (const u of us.slice(1)) loop.push([u, 1]);
  for (const v of vs.slice(0, -1).reverse()) loop.push([1, v]);
  for (const u of us.slice(1, -1).reverse()) loop.push([u, -1]);
  const ring = (fn: (u: number, v: number) => THREE.Vector3) => loop.map(([u, v]) => fn(u, v));
  const toward = (u: number, v: number, k: number): [number, number] => [u + (0.5 - u) * k, v * (1 - k)];
  const O = ring((u, v) => shellPoint(u, v, 1));
  const I = ring((u, v) => shellPoint(u, v, 0));
  const E = ring((u, v) => {
    const [iu, iv] = toward(u, v, 0.05);
    return shellPoint(u, v, 1).sub(shellPoint(iu, iv, 1)).normalize();
  });
  const M = O.map((o, k) => o.clone().lerp(I[k], 0.45).addScaledVector(E[k], 0.0032));
  const I2 = ring((u, v) => {
    const [iu, iv] = toward(u, v, detail === 0 ? 0.12 : 0.2);
    return shellPoint(iu, iv, 0);
  });
  const n = loop.length;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    shell.quad(O[k], O[k1], M[k1], M[k], E[k]);
    liner.quad(M[k], M[k1], I[k1], I[k], E[k]);
    liner.quad(I[k], I[k1], I2[k1], I2[k], ref.subVectors(C, I[k]));
  }
  // Close up, the inside of the whole shell on every other grid line, facing the head. Without it
  // a low view up past the edge sees the sky through the back of the outer surface.
  if (detail === 0) {
    const every = (lines: number[]) => lines.filter((_, i) => i % 2 === 0 || i === lines.length - 1);
    const iu = every(us);
    const iv = every(vs);
    const inner = iu.map((u) => iv.map((v) => shellPoint(u, v, 0)));
    for (let i = 0; i < iu.length - 1; i++) {
      for (let j = 0; j < iv.length - 1; j++) {
        liner.quad(inner[i][j], inner[i + 1][j], inner[i + 1][j + 1], inner[i][j + 1], ref.subVectors(C, inner[i][j]));
      }
    }
  }

  const lining: THREE.BufferGeometry[] = [liner.geometry()];
  if (detail === 0) lining.push(...cradle());
  return {
    shell: paint(shell.geometry(), WHITE, { crease: 0.75 }),
    liner: merge([...lining.map((g) => paint(g, 0x1d1e21, { crease: 0.75 })), paint(pit.geometry(), 0x0d0e10, { crease: 0.75 })]),
    straps: detail === 0 ? chinStraps() : [],
  };
}

/** Retention cradle round the back of the skull below the shell, with its dial. */
function cradle(): THREE.BufferGeometry[] {
  const path: [number, number][] = [];
  for (const a of [-128, -142, -156, -168, 180, 168, 156, 142, 128]) {
    const t = Math.abs(a) / 180;
    path.push([a * DEG, lin([128 / 180, 156 / 180, 1], [0.004, -0.03, -0.044], t)]);
  }
  // Unwrap through the back so the curve does not jump from +π to -π.
  for (const p of path) if (p[0] < 0) p[0] += 2 * Math.PI;
  const { points, normals } = onHead(path, 16, 0.0018);
  const band = frameTube(points, normals, 0.0011, 0.0045, FLAT);
  const t = Math.PI;
  const y = -0.045;
  const nrm = headNormal(t, y);
  const at = headPoint(t, y).addScaledVector(nrm, hairDepth(t, y) + 0.004);
  const dial = new THREE.CylinderGeometry(0.0095, 0.0105, 0.0055, 10).applyMatrix4(new THREE.Matrix4().makeBasis(v3(0, 0, 1), nrm, new THREE.Vector3().crossVectors(v3(0, 0, 1), nrm)).setPosition(at));
  return [band, dial];
}

/** Front and rear strap each side, joined in a divider under the ear lobe, then along the jaw
 *  to a buckle under the chin. */
function chinStraps(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const W = 0.0058;
  const H = 0.0007;
  const LIFT = 0.0016;
  const split = (side: number): [number, number] => [side * 97 * DEG, -0.063];
  for (const side of [-1, 1]) {
    const [st, sy] = split(side);
    const front = onHead([[side * 70 * DEG, 0.036], [side * 77 * DEG, 0.012], [side * 84 * DEG, -0.02], [side * 91 * DEG, -0.047], [st, sy]], 9, LIFT);
    const rear = onHead([[side * 129 * DEG, 0.022], [side * 126 * DEG, -0.006], [side * 118 * DEG, -0.034], [side * 107 * DEG, -0.054], [st, sy]], 9, LIFT);
    out.push(frameTube(front.points, front.normals, H, W, FLAT), frameTube(rear.points, rear.normals, H, W, FLAT));
    // From the divider down the side of the jaw, then under it to the buckle.
    const down = onHead([[st, sy], [side * 98 * DEG, -0.076], [side * 100 * DEG, -0.087]], 5, LIFT);
    const under = curve([v3(0.006, 0, side * 0.047), v3(0.021, 0, side * 0.038), v3(0.035, 0, side * 0.026), v3(0.045, 0, side * 0.013), v3(0.049, 0, 0)], 8);
    const points = [...down.points];
    const normals = [...down.normals];
    for (const p of under) {
      const e = 0.002;
      const y = jawUnderside(p.x, p.z);
      const nrm = v3(jawUnderside(p.x + e, p.z) - jawUnderside(p.x - e, p.z), -2 * e, jawUnderside(p.x, p.z + e) - jawUnderside(p.x, p.z - e)).normalize();
      points.push(v3(p.x, y, p.z).addScaledVector(nrm, LIFT));
      normals.push(nrm);
    }
    out.push(frameTube(points, normals, H, W, FLAT));
    // Divider where the straps meet.
    const k = front.points.length - 1;
    const along = front.points[k].clone().sub(front.points[k - 2]);
    out.push(plate(front.points[k].clone().addScaledVector(front.normals[k], 0.0012), along, front.normals[k], 0.018, 0.013, 0.004));
  }
  // Buckle under the chin.
  const y = jawUnderside(0.049, 0);
  const nrm = v3(jawUnderside(0.051, 0) - jawUnderside(0.047, 0), -0.004, 0).normalize();
  out.push(plate(v3(0.049, y, 0).addScaledVector(nrm, 0.0032), v3(0, 0, 1), nrm, 0.024, 0.017, 0.0055));
  return out;
}

// ---------------------------------------------------------------------------------------------

export interface HeadModels {
  /** Face and scalp with the lips and the jaw's underside shaded; white for the skin tint. */
  skin: THREE.BufferGeometry;
  /** Ears; white for the skin tint. Empty far away. */
  ears: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  /** Helmet shell; white for the helmet tint. */
  shell: THREE.BufferGeometry;
  /** Inside, edge underside, vents and cradle of the helmet. */
  liner: THREE.BufferGeometry;
  /** Strap webbing. Empty far away. */
  straps: THREE.BufferGeometry;
  lens: THREE.BufferGeometry;
  /** Glasses' frame, arms and nose pads. Empty far away. */
  frame: THREE.BufferGeometry;
}

/** The whole head at a detail level, painted, in the head frame. */
export function buildHead(detail: Detail): HeadModels {
  const ears: THREE.BufferGeometry[] = [];
  if (detail === 0) {
    for (const side of [-1, 1]) {
      const e = ear(side);
      ears.push(paint(e.body, WHITE, { crease: 1.2 }), paint(e.bowl, new THREE.Color(0.78, 0.66, 0.64), { crease: 1.2 }));
    }
  }
  const h = helmet(detail);
  const g = glasses(detail);
  return {
    skin: skin(detail),
    ears: merge(ears),
    hair: hair(detail),
    shell: h.shell,
    liner: h.liner,
    straps: merge(h.straps.map((s) => paint(s, 0x17181a, { crease: 0.9 }))),
    lens: paint(g.lens, 0x1b2433, { crease: 1 }),
    frame: merge(g.frame.map((f) => paint(f, 0x151619, { crease: 1 }))),
  };
}
