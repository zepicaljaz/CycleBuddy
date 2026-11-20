import * as THREE from 'three';
import { atDetail, loft, merge, paint, q, surface, sweep, tube, v3, type Detail } from './geometry';
import { prepare, type Prepared } from './batch';
import type { Model } from './materials';

export type CarKind = 'city' | 'hatch' | 'sedan' | 'suv' | 'van';

interface Lamp {
  /** Centre height, height, width across the car, and centre distance from the middle. */
  y: number;
  h: number;
  w: number;
  z: number;
  /** Outer end raised (positive) or lowered. */
  slant: number;
}

export interface CarSpec {
  kind: CarKind;
  length: number;
  width: number;
  wheelbase: number;
  /** Front axle to front bumper. */
  overhang: number;
  wheelR: number;
  sill: number;
  /** Body top line from rear to front: bumper, boot or tailgate, belt, bonnet, nose. */
  top: [number, number][];
  /** Cabin top line from rear to front. The ends sit on the body top line. */
  roof: [number, number][];
  /** Roof width over belt width. */
  tumble: number;
  /** Plan-view corner squareness. */
  plan: number;
  /** How abruptly the plan closes at the rear and front ends: higher is boxier. */
  ends: [number, number];
  /** Cabin width at the belt over body width. Close to 1 for flush van sides. */
  inset: number;
  /** Side window spans along the car. */
  windows: [number, number][];
  /** Door shut lines. */
  doors: number[];
  handles: number[];
  /** Windscreen and rear window: base and top points of the glass. */
  screen: [[number, number], [number, number]];
  back: [[number, number], [number, number]];
  /** Part of the rear glass slope that is glazed. */
  backGlass: [number, number];
  head: Lamp;
  tail: Lamp;
  grille: { y: number; h: number; w: number };
  plateFront: number;
  plateRear: number;
  /** Height of the dark lower trim above the sill line. */
  trim: number;
  cladding?: boolean;
  rails?: boolean;
}

export const CAR_SPECS: CarSpec[] = [
  {
    kind: 'city', length: 3.6, width: 1.66, wheelbase: 2.32, overhang: 0.62, wheelR: 0.29, sill: 0.25,
    top: [[-1.8, 0.62], [-1.79, 0.84], [-1.74, 0.93], [0.95, 0.93], [1.2, 0.89], [1.6, 0.8], [1.76, 0.7], [1.8, 0.55]],
    roof: [[-1.74, 0.93], [-1.66, 1.3], [-1.5, 1.47], [-0.1, 1.51], [0.3, 1.46], [0.95, 0.93]],
    tumble: 0.8, plan: 5, ends: [12, 8], inset: 0.87,
    windows: [[-1.32, -0.42], [-0.32, 0.92]], doors: [-0.38, 0.9], handles: [-0.52],
    screen: [[0.92, 0.95], [0.32, 1.44]], back: [[-1.73, 0.97], [-1.6, 1.38]], backGlass: [0.12, 0.95],
    head: { y: 0.76, h: 0.11, w: 0.3, z: 0.52, slant: 0.03 }, tail: { y: 0.92, h: 0.2, w: 0.13, z: 0.68, slant: 0 },
    grille: { y: 0.58, h: 0.12, w: 0.62 }, plateFront: 0.42, plateRear: 0.62, trim: 0.1,
  },
  {
    kind: 'hatch', length: 4.25, width: 1.79, wheelbase: 2.62, overhang: 0.9, wheelR: 0.315, sill: 0.26,
    top: [[-2.125, 0.6], [-2.115, 0.86], [-2.06, 0.97], [1.0, 0.95], [1.3, 0.91], [1.9, 0.8], [2.08, 0.68], [2.125, 0.5]],
    roof: [[-2.06, 0.97], [-1.97, 1.3], [-1.78, 1.44], [-0.1, 1.47], [0.3, 1.43], [1.0, 0.95]],
    tumble: 0.78, plan: 5, ends: [12, 8], inset: 0.87,
    windows: [[-1.62, -0.44], [-0.32, 0.98]], doors: [0.97, -0.38, -1.3], handles: [-0.5, -1.38],
    screen: [[0.97, 0.97], [0.32, 1.42]], back: [[-2.05, 1.0], [-1.86, 1.4]], backGlass: [0.1, 0.92],
    head: { y: 0.74, h: 0.1, w: 0.36, z: 0.55, slant: 0.03 }, tail: { y: 0.9, h: 0.12, w: 0.3, z: 0.62, slant: -0.02 },
    grille: { y: 0.6, h: 0.14, w: 0.7 }, plateFront: 0.42, plateRear: 0.58, trim: 0.1,
  },
  {
    kind: 'sedan', length: 4.75, width: 1.84, wheelbase: 2.85, overhang: 0.92, wheelR: 0.33, sill: 0.27,
    top: [[-2.375, 0.62], [-2.36, 0.88], [-2.25, 0.99], [-1.2, 1.01], [1.05, 0.97], [1.4, 0.93], [2.1, 0.8], [2.32, 0.66], [2.375, 0.5]],
    roof: [[-1.2, 1.01], [-0.75, 1.36], [-0.45, 1.43], [0.2, 1.44], [0.45, 1.4], [1.05, 0.97]],
    tumble: 0.76, plan: 5, ends: [9, 8], inset: 0.86,
    windows: [[-1.05, -0.36], [-0.26, 1.02]], doors: [1.02, -0.33, -1.25], handles: [-0.45, -1.33],
    screen: [[1.02, 0.99], [0.47, 1.39]], back: [[-1.17, 1.03], [-0.72, 1.36]], backGlass: [0.08, 0.9],
    head: { y: 0.74, h: 0.09, w: 0.42, z: 0.55, slant: 0.04 }, tail: { y: 0.9, h: 0.1, w: 0.36, z: 0.6, slant: 0 },
    grille: { y: 0.6, h: 0.16, w: 0.62 }, plateFront: 0.42, plateRear: 0.74, trim: 0.09,
  },
  {
    kind: 'suv', length: 4.65, width: 1.87, wheelbase: 2.75, overhang: 0.92, wheelR: 0.36, sill: 0.4,
    top: [[-2.325, 0.72], [-2.31, 1.0], [-2.24, 1.08], [1.0, 1.06], [1.3, 1.03], [2.0, 0.93], [2.27, 0.8], [2.325, 0.6]],
    roof: [[-2.24, 1.08], [-2.17, 1.48], [-1.98, 1.64], [0.0, 1.68], [0.3, 1.64], [1.0, 1.06]],
    tumble: 0.8, plan: 5.5, ends: [16, 9], inset: 0.9,
    windows: [[-1.82, -0.42], [-0.3, 0.98]], doors: [0.97, -0.36, -1.35], handles: [-0.48, -1.44],
    screen: [[0.97, 1.08], [0.33, 1.62]], back: [[-2.23, 1.11], [-2.06, 1.58]], backGlass: [0.12, 0.9],
    head: { y: 0.88, h: 0.1, w: 0.42, z: 0.56, slant: 0.04 }, tail: { y: 1.02, h: 0.12, w: 0.3, z: 0.64, slant: 0 },
    grille: { y: 0.72, h: 0.2, w: 0.76 }, plateFront: 0.52, plateRear: 0.72, trim: 0.16, cladding: true, rails: true,
  },
  {
    kind: 'van', length: 4.95, width: 1.92, wheelbase: 3.0, overhang: 0.95, wheelR: 0.33, sill: 0.33,
    top: [[-2.475, 0.6], [-2.47, 1.04], [-2.45, 1.08], [1.4, 1.07], [1.65, 1.03], [2.2, 0.94], [2.42, 0.8], [2.475, 0.55]],
    roof: [[-2.455, 1.9], [-2.4, 1.95], [0.95, 1.96], [1.2, 1.86], [1.65, 1.03]],
    tumble: 0.92, plan: 7, ends: [24, 10], inset: 0.965,
    windows: [[0.32, 1.6]], doors: [1.6, 0.28, -0.62], handles: [0.18, -0.72],
    screen: [[1.62, 1.08], [1.22, 1.84]], back: [[-2.45, 1.1], [-2.44, 1.9]], backGlass: [0.38, 0.9],
    head: { y: 0.9, h: 0.12, w: 0.32, z: 0.6, slant: 0.02 }, tail: { y: 1.05, h: 0.38, w: 0.1, z: 0.84, slant: 0 },
    grille: { y: 0.72, h: 0.2, w: 0.8 }, plateFront: 0.45, plateRear: 0.62, trim: 0.12,
  },
];

export const CAR_KINDS = CAR_SPECS.map((s) => s.kind);
export const carSpec = (kind: CarKind): CarSpec => CAR_SPECS.find((s) => s.kind === kind)!;

/** Wheel models are built at this radius and scaled per car. */
export const WHEEL_BASE_R = 0.32;

export function axles(spec: CarSpec): { front: number; rear: number; track: number } {
  const front = spec.length / 2 - spec.overhang;
  return { front, rear: front - spec.wheelbase, track: spec.width / 2 - 0.13 };
}

/** Real-world paint: mostly white, black, grey and silver, a few colours. */
export const CAR_PAINTS: [number, number][] = [
  [0xf1f2f3, 22], [0x18191c, 18], [0x6d7177, 14], [0xa9adb3, 14], [0x1f3f7a, 7], [0xa31d22, 6], [0x2c4a3a, 3],
  [0x7a1528, 3], [0xc9b79a, 3], [0x3e6fa8, 3], [0xd9772b, 2], [0xe8c547, 1], [0x5c8f4a, 2], [0x2a2e3a, 4],
];

export function pickPaint(r: number): number {
  const total = CAR_PAINTS.reduce((a, [, w]) => a + w, 0);
  let t = r * total;
  for (const [c, w] of CAR_PAINTS) {
    t -= w;
    if (t <= 0) return c;
  }
  return CAR_PAINTS[0][0];
}

function lerpLine(pts: [number, number][], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    }
  }
  return pts[pts.length - 1][1];
}

const BODY_EXP = 5;
const CABIN_EXP = 3.2;

/** The car body as formulas, so details can be laid exactly onto it. */
class Shape {
  readonly half: number;
  readonly halfW: number;
  readonly front: number;
  readonly rear: number;
  readonly arch: number;
  readonly gx0: number;
  readonly gx1: number;

  constructor(readonly spec: CarSpec) {
    this.half = spec.length / 2;
    this.halfW = spec.width / 2;
    const a = axles(spec);
    this.front = a.front;
    this.rear = a.rear;
    this.arch = spec.wheelR + 0.045;
    this.gx0 = spec.roof[0][0];
    this.gx1 = spec.roof[spec.roof.length - 1][0];
  }

  private smooth(pts: [number, number][], x: number, d = 0.05): number {
    return (lerpLine(pts, x - d) + 2 * lerpLine(pts, x) + lerpLine(pts, x + d)) / 4;
  }

  top(x: number): number {
    return this.smooth(this.spec.top, x, 0.04);
  }

  /** Bottom edge of the sides, ignoring the wheel arches. */
  sillLine(x: number): number {
    return this.spec.sill + 0.1 * THREE.MathUtils.smoothstep(Math.abs(x), this.half - 0.4, this.half);
  }

  bot(x: number): number {
    const s = this.spec;
    let y = this.sillLine(x);
    for (const wx of [this.front, this.rear]) {
      const d = x - wx;
      if (Math.abs(d) < this.arch) y = Math.max(y, s.wheelR + Math.sqrt(this.arch * this.arch - d * d));
    }
    return Math.min(y, this.top(x) - 0.06);
  }

  /** Half width in plan view. */
  width(x: number): number {
    const t = Math.min(1, Math.abs(x) / this.half);
    const end = this.spec.ends[x < 0 ? 0 : 1];
    return this.halfW * Math.pow(Math.max(0, 1 - Math.pow(t, end)), 1 / this.spec.plan);
  }

  roof(x: number): number {
    return this.smooth(this.spec.roof, x, 0.05);
  }

  /** Cabin base line, a little inside the body top. */
  belt(x: number): number {
    return this.top(x) - 0.03;
  }

  cabinHalf(x: number, ys: number): number {
    const base = this.width(x) * this.spec.inset;
    return base * (1 + (this.spec.tumble - 1) * Math.max(0, Math.min(1, ys)));
  }

  bodyRing(x: number, n: number): THREE.Vector3[] {
    const top = this.top(x);
    const bot = this.bot(x);
    const c = (top + bot) / 2;
    const h = (top - bot) / 2;
    const w = this.width(x);
    const e = 2 / BODY_EXP;
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const cx = Math.sign(cs) * Math.pow(Math.abs(cs), e);
      const sy = Math.sign(sn) * Math.pow(Math.abs(sn), e);
      ring.push(v3(x, c + sy * h, cx * w * (1 - 0.06 * Math.max(0, sy) ** 2)));
    }
    return ring;
  }

  cabinPoint(x: number, a: number): THREE.Vector3 {
    const b = this.belt(x);
    const r = Math.max(b + 0.004, this.roof(x));
    const e = 2 / CABIN_EXP;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const cx = Math.sign(cs) * Math.pow(Math.abs(cs), e);
    const sy = Math.sign(sn) * Math.pow(Math.abs(sn), e);
    return v3(x, b + sy * (r - b), cx * this.cabinHalf(x, sy));
  }

  /** Half width of the outer surface at a point, or -1 outside the car's outline. */
  halfAt(x: number, y: number): number {
    if (Math.abs(x) > this.half) return -1;
    let best = -1;
    const top = this.top(x);
    const bot = this.bot(x);
    if (y >= bot && y <= top) {
      const sy = (2 * y - top - bot) / (top - bot);
      const cx = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(sy), BODY_EXP)), 1 / BODY_EXP);
      best = cx * this.width(x) * (1 - 0.06 * Math.max(0, sy) ** 2);
    }
    if (x > this.gx0 && x < this.gx1) {
      const b = this.belt(x);
      const r = this.roof(x);
      if (r > b && y >= b && y <= r) {
        const ys = (y - b) / (r - b);
        const cx = Math.pow(Math.max(0, 1 - Math.pow(ys, CABIN_EXP)), 1 / CABIN_EXP);
        best = Math.max(best, cx * this.cabinHalf(x, ys));
      }
    }
    return best;
  }

  inside(p: THREE.Vector3): boolean {
    const h = this.halfAt(p.x, p.y);
    return h >= 0 && Math.abs(p.z) <= h;
  }

  /** First point where a ray meets the body, or null. */
  hit(o: THREE.Vector3, d: THREE.Vector3, max = 4): THREE.Vector3 | null {
    const p = new THREE.Vector3();
    let t = 0;
    const step = 0.01;
    while (t < max) {
      p.copy(o).addScaledVector(d, t);
      if (this.inside(p)) break;
      t += step;
    }
    if (t >= max) return null;
    let lo = Math.max(0, t - step);
    let hi = t;
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) / 2;
      p.copy(o).addScaledVector(d, m);
      if (this.inside(p)) hi = m;
      else lo = m;
    }
    return o.clone().addScaledVector(d, hi);
  }

  /**
   * A patch laid onto the body: each (u, v) gives a ray, the patch floats `lift` above the hit.
   * The extra gap keeps a flat pane outside a curved panel. Without it the grille, glass and
   * plate cut through the paint and flash black as the camera moves.
   */
  decal(nu: number, nv: number, ray: (u: number, v: number) => [THREE.Vector3, THREE.Vector3], lift: number): THREE.BufferGeometry {
    let last = new THREE.Vector3();
    return surface(nu, nv, (u, v) => {
      const [o, d0] = ray(u, v);
      const d = d0.clone().normalize();
      const h = this.hit(o, d);
      if (h) last = h.addScaledVector(d, -(lift + 0.02));
      return last.clone();
    });
  }
}

/** Patch facing the viewer that a direction points away from. */
function faceOut(g: THREE.BufferGeometry, outward: THREE.Vector3): THREE.BufferGeometry {
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  let dot = 0;
  for (let i = 0; i < n.count; i++) dot += n.getX(i) * outward.x + n.getY(i) * outward.y + n.getZ(i) * outward.z;
  if (dot < 0) {
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, a);
      }
    }
  }
  return g;
}

/** Inside-out copy: faces point inward, for wheel wells. */
function inward(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  }
  return g;
}

const TRIM = 0x141518;
const GLASS = 0x1b2330;
const CHROME = 0xc9cdd3;

/** Body, glass, lights and trim in the car frame: +x forward, ground at y = 0. Paint is tinted per car. */
export function buildCar(kind: CarKind, detail: Detail): Model {
  return atDetail(detail, () => carAt(carSpec(kind), detail));
}

function carAt(spec: CarSpec, detail: Detail): Model {
  const hi = detail === 0;
  const S = new Shape(spec);
  const L = S.half;

  // Stations: even spacing, denser round the wheel arches and at the ends.
  const xs: number[] = [];
  const dx = [0.045, 0.12, 0.24][detail];
  for (let x = -L; x <= L; x += dx) xs.push(x);
  for (const wx of [S.front, S.rear]) {
    const da = [0.03, 0.07, 0.12][detail];
    for (let x = wx - S.arch - 0.02; x <= wx + S.arch + 0.02; x += da) xs.push(x);
  }
  for (const e of hi ? [0.003, 0.01, 0.022, 0.04, 0.065, 0.1] : [0.006, 0.03, 0.08]) xs.push(-L + e, L - e);
  xs.push(-L, L);
  xs.sort((a, b) => a - b);
  const stations = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 0.004);

  const n = q(48, 20);
  const body = loft(stations.map((x) => S.bodyRing(x, n)), true, true);
  const bodyPaint = paint(body, 0xffffff, { crease: 0.7 });
  // Dark plastic along the sills and bumpers.
  const pos = bodyPaint.getAttribute('position');
  const col = bodyPaint.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < S.sillLine(pos.getX(i)) + spec.trim) col.setXYZ(i, 0.075, 0.078, 0.085);
  }

  // Closed through the body below the belt, with end caps, so a tall van back is a solid face.
  const cabinV = q(22, 10);
  const cabinRings: THREE.Vector3[][] = [];
  for (let i = 0; i <= q(40, 16); i++) {
    const x = S.gx0 + ((S.gx1 - S.gx0) * i) / q(40, 16);
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k <= cabinV; k++) ring.push(S.cabinPoint(x, -0.3 + (k / cabinV) * (Math.PI + 0.6)));
    cabinRings.push(ring);
  }
  const cabin = loft(cabinRings, true, true);

  const glass: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const chrome: THREE.BufferGeometry[] = [];
  const headLens: THREE.BufferGeometry[] = [];
  const drl: THREE.BufferGeometry[] = [];
  const tail: THREE.BufferGeometry[] = [];
  const plates: THREE.BufferGeometry[] = [];
  const paintParts: THREE.BufferGeometry[] = [];
  const nu = q(14, 6);
  const nv = q(6, 3);

  // Side windows follow the roof line, with a black surround.
  for (const side of [-1, 1]) {
    for (const [x0, x1] of spec.windows) {
      const pane = (inset: number, lift: number) =>
        faceOut(
          S.decal(nu, nv, (u, v) => {
            const x = x0 + inset + (x1 - x0 - 2 * inset) * u;
            const yb = S.belt(x) + 0.045 + inset;
            const yt = Math.max(yb, S.roof(x) - 0.07 - inset);
            return [v3(x, yb + (yt - yb) * v, side * 3), v3(0, 0, -side)];
          }, lift),
          v3(0, 0, side),
        );
      if (hi) trim.push(pane(-0.02, 0.003));
      glass.push(pane(0, 0.006));
    }
  }

  // Windscreen and rear window, laid along their slopes.
  const slopePane = (pts: [[number, number], [number, number]], v0: number, v1: number, inset: number, lift: number) => {
    const [[bx, by], [tx, ty]] = pts;
    const along = v3(tx - bx, ty - by).normalize();
    const out = v3(along.y, -along.x).multiplyScalar(tx < bx ? 1 : -1);
    if (out.y < 0) out.negate();
    return faceOut(
      S.decal(q(10, 5), q(8, 4), (u, v) => {
        const f = v0 + (v1 - v0) * v;
        const x = bx + (tx - bx) * f;
        const y = by + (ty - by) * f;
        const halfZ = S.cabinHalf(x, f) * 0.86 - inset;
        return [v3(x, y, (u - 0.5) * 2 * halfZ).addScaledVector(out, 2), out.clone().negate()];
      }, lift),
      out,
    );
  };
  if (hi) trim.push(slopePane(spec.screen, 0.02, 0.98, -0.03, 0.003), slopePane(spec.back, spec.backGlass[0] - 0.03, spec.backGlass[1] + 0.03, -0.03, 0.003));
  glass.push(slopePane(spec.screen, 0.05, 0.95, 0, 0.006), slopePane(spec.back, spec.backGlass[0], spec.backGlass[1], 0, 0.006));
  if (spec.kind === 'van') {
    // Split rear doors.
    trim.push(S.decal(2, q(6, 3), (u, v) => [v3(-L - 1, 0.62 + v * 1.2, (u - 0.5) * 0.04), v3(1, 0, 0)], 0.009));
  }

  // Lamps: laid on the nose and tail from slightly outside each corner.
  const lamp = (l: Lamp, front: boolean, side: number, lift: number, shrink = 0) => {
    const dir = v3(front ? -1 : 1, 0, -side * 0.28).normalize();
    return faceOut(
      S.decal(q(10, 4), q(5, 3), (u, v) => {
        const z = side * (l.z - l.w / 2 + shrink + (l.w - 2 * shrink) * u);
        const y = l.y + l.slant * (u - 0.5) * 2 + (v - 0.5) * (l.h - 2 * shrink);
        return [v3(front ? L : -L, y, z).addScaledVector(dir, -1), dir];
      }, lift),
      v3(front ? 1 : -1, 0, 0),
    );
  };
  for (const side of [-1, 1]) {
    headLens.push(lamp(spec.head, true, side, 0.006));
    tail.push(lamp(spec.tail, false, side, 0.006));
    if (hi) {
      trim.push(lamp(spec.head, true, side, 0.003, -0.012), lamp(spec.tail, false, side, 0.003, -0.01));
      // Daytime running light: a strip along the lower edge of the headlight.
      drl.push(lamp({ ...spec.head, y: spec.head.y - spec.head.h * 0.32, h: spec.head.h * 0.18 }, true, side, 0.009, 0.01));
    }
  }

  // Grille, lower intake and number plates.
  const front = (y: number, h: number, w: number, lift: number) =>
    faceOut(S.decal(q(8, 4), q(3, 2), (u, v) => [v3(L + 1, y + (v - 0.5) * h, (u - 0.5) * w), v3(-1, 0, 0)], lift), v3(1, 0, 0));
  const rear = (y: number, h: number, w: number, lift: number) =>
    faceOut(S.decal(q(8, 4), q(3, 2), (u, v) => [v3(-L - 1, y + (v - 0.5) * h, (u - 0.5) * w), v3(1, 0, 0)], lift), v3(-1, 0, 0));
  trim.push(front(spec.grille.y, spec.grille.h, spec.grille.w, 0.004));
  if (hi) {
    trim.push(front(spec.plateFront - 0.02, 0.1, spec.width * 0.5, 0.003));
    chrome.push(front(spec.grille.y + spec.grille.h / 2 + 0.006, 0.012, spec.grille.w * 0.92, 0.006));
  }
  for (const make of [front, rear]) {
    const y = make === front ? spec.plateFront : spec.plateRear;
    const plate = make(y, 0.11, 0.52, 0.008);
    // White plate with the blue band on the left end.
    const pp = paint(plate, 0xf2f2ee, { crease: 0.3 });
    const p = pp.getAttribute('position');
    const c = pp.getAttribute('color');
    // The band is on the viewer's left: +z seen from the front, -z from behind.
    const blueSide = make === front ? 1 : -1;
    for (let i = 0; i < p.count; i += 3) {
      const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      if (z * blueSide > 0.2) for (let k = 0; k < 3; k++) c.setXYZ(i + k, 0.02, 0.08, 0.45);
    }
    plates.push(pp);
  }

  if (hi) {
    // Door shut lines and handles.
    for (const side of [-1, 1]) {
      for (const x0 of spec.doors) {
        trim.push(faceOut(S.decal(1, 6, (u, v) => {
          const x = x0 + (u - 0.5) * 0.007;
          const y0 = S.bot(x) + 0.05;
          const y1 = S.belt(x) - 0.005;
          return [v3(x, y0 + (y1 - y0) * v, side * 3), v3(0, 0, -side)];
        }, 0.0015), v3(0, 0, side)));
      }
      for (const x0 of spec.handles) {
        chrome.push(faceOut(S.decal(3, 2, (u, v) => {
          const x = x0 + (u - 0.5) * 0.15;
          const y = S.belt(x) - 0.075 + (v - 0.5) * 0.026;
          return [v3(x, y, side * 3), v3(0, 0, -side)];
        }, 0.007), v3(0, 0, side)));
      }
    }
  }

  // Mirrors on the doors just behind the windscreen base.
  const [sb] = spec.screen;
  for (const side of [-1, 1]) {
    const x = sb[0] - 0.12;
    const zb = S.cabinHalf(x, 0);
    const zw = S.width(x);
    const y = S.belt(x) + 0.08;
    paintParts.push(new THREE.SphereGeometry(1, q(10, 5), q(6, 3)).scale(0.09, 0.065, 0.085).translate(x, y, side * (zw + 0.07)));
    trim.push(tube(v3(x - 0.02, y - 0.05, side * zb), v3(x, y - 0.02, side * (zw + 0.02)), 0.02, 0.015, q(6, 4)));
  }

  if (spec.cladding) {
    // Moulded arch flares, half sunk into the body.
    for (const wx of [S.front, S.rear]) {
      for (const side of [-1, 1]) {
        const path: THREE.Vector3[] = [];
        const r = S.arch + 0.03;
        for (let i = 0; i <= q(20, 8); i++) {
          const a = -0.25 + ((Math.PI + 0.5) * i) / q(20, 8);
          const x = wx + r * Math.cos(a);
          const y = spec.wheelR + r * Math.sin(a);
          const h = S.halfAt(x, y);
          if (h > 0) path.push(v3(x, y, side * h));
        }
        if (path.length > 2) {
          trim.push(sweep(path, () => [0.03, 0.05], { sides: q(8, 6), exp: 3, offset: () => [side * 0.006, 0] }));
        }
      }
    }
  }

  if (spec.rails) {
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      const x0 = S.gx0 + 0.35;
      const x1 = S.gx1 - 0.85;
      for (let i = 0; i <= 6; i++) {
        const x = x0 + ((x1 - x0) * i) / 6;
        pts.push(v3(x, S.roof(x) + 0.035, side * S.cabinHalf(x, 1) * 0.82));
      }
      for (let i = 1; i < pts.length; i++) chrome.push(tube(pts[i - 1], pts[i], 0.014, 0.014, q(6, 4), false));
      for (const p of [pts[0], pts[pts.length - 1]]) trim.push(tube(p.clone().setY(p.y - 0.04), p, 0.016, 0.016, q(6, 4)));
    }
  }
  if (hi) {
    // Exhaust tip.
    chrome.push(tube(v3(-L - 0.02, S.bot(-L + 0.2) + 0.06, -0.45), v3(-L + 0.12, S.bot(-L + 0.2) + 0.06, -0.45), 0.032, 0.032, 10, true));
  }

  // Wheel wells: a dark half-tube inside each arch.
  for (const wx of [S.front, S.rear]) {
    const well = new THREE.CylinderGeometry(S.arch - 0.01, S.arch - 0.01, spec.width * 0.94, q(16, 8), 1, true, Math.PI / 2, Math.PI);
    well.rotateX(Math.PI / 2).translate(wx, spec.wheelR, 0);
    trim.push(inward(well));
  }

  const glowWhite = new THREE.Color(3.4, 3.3, 2.9);
  const glowAmber = new THREE.Color(3.2, 1.6, 0.25);
  // Proud lamp housings so headlights and tails read as lights, not paint.
  for (const side of [-1, 1]) {
    const hx = L - 0.02;
    const hy = spec.head.y;
    const hz = side * spec.head.z;
    headLens.push(new THREE.SphereGeometry(1, q(10, 5), q(6, 3)).scale(0.04, spec.head.h * 0.42, spec.head.w * 0.28).translate(hx, hy, hz));
    if (hi) {
      drl.push(new THREE.BoxGeometry(0.02, 0.018, spec.head.w * 0.7).translate(hx + 0.01, hy - spec.head.h * 0.28, hz));
      chrome.push(new THREE.BoxGeometry(0.012, spec.head.h * 0.22, 0.04).translate(hx + 0.008, hy, hz + side * (spec.head.w * 0.42)));
    }
    const tx = -L + 0.015;
    const ty = spec.tail.y;
    const tz = side * spec.tail.z;
    tail.push(new THREE.BoxGeometry(0.03, spec.tail.h * 0.7, spec.tail.w * 0.55).translate(tx, ty, tz));
    if (hi) paintParts.push(new THREE.BoxGeometry(0.018, spec.tail.h * 0.22, spec.tail.w * 0.18).translate(tx - 0.008, ty - spec.tail.h * 0.28, tz));
  }
  const model: Model = [
    { geom: merge([bodyPaint, paint(cabin, 0xffffff, { crease: 0.7 }), ...paintParts.map((g) => paint(g, 0xffffff, { crease: 1 }))]), mat: 'carpaint', tint: 'paint' },
    { geom: merge(glass.map((g) => paint(g, GLASS, { crease: 0.6 }))), mat: 'glass' },
    { geom: merge([...trim.map((g) => paint(g, TRIM, { crease: 0.6 })), ...plates]), mat: 'gloss' },
    { geom: merge(headLens.map((g) => paint(g, glowWhite, { crease: 0.8 }))), mat: 'glow' },
    { geom: merge(tail.map((g) => paint(g, new THREE.Color(0.85, 0.04, 0.03), { crease: 0.8 }))), mat: 'glow', tint: 'brake' },
  ];
  if (chrome.length) model.push({ geom: merge(chrome.map((g) => paint(g, CHROME, { crease: 0.8 }))), mat: 'chrome' });
  if (drl.length) model.push({ geom: merge(drl.map((g) => paint(g, glowAmber, { crease: 0.8 }))), mat: 'glow' });
  return model;
}

/** One road wheel around its axle (z), outer face towards +z, radius WHEEL_BASE_R. */
export function buildCarWheel(detail: Detail): Model {
  return atDetail(detail, () => {
    const hi = detail === 0;
    const R = WHEEL_BASE_R;
    const seg = q(28, 14);
    const lathe = (pts: [number, number][]) => new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg).rotateX(Math.PI / 2);
    const tyre = lathe([
      [0.212, -0.1], [0.285, -0.102], [0.308, -0.096], [R, -0.075], [R, 0.075], [0.308, 0.096], [0.285, 0.102], [0.212, 0.1],
    ]);
    // Lathe faces point to (dz, -dr) of the profile direction: listed inner barrel to outer face.
    const rimLip = lathe([[0.2, 0.06], [0.205, 0.08], [0.219, 0.088], [0.217, 0.1], [0.2, 0.098]]);
    const dark: THREE.BufferGeometry[] = [new THREE.CircleGeometry(0.205, seg).translate(0, 0, 0.03)];
    const alloy: THREE.BufferGeometry[] = [rimLip];
    if (hi) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        for (const off of [-0.11, 0.11]) {
          const p0 = v3(Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.072);
          const p1 = v3(Math.cos(a + off) * 0.2, Math.sin(a + off) * 0.2, 0.085);
          alloy.push(tube(p0, p1, 0.013, 0.01, 5));
        }
      }
      alloy.push(new THREE.CylinderGeometry(0.06, 0.064, 0.03, 16).rotateX(Math.PI / 2).translate(0, 0, 0.075));
      dark.push(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 10).rotateX(Math.PI / 2).translate(0, 0, 0.092));
      dark.push(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 24).rotateX(Math.PI / 2).translate(0, 0, 0.0));
    } else {
      alloy.push(new THREE.CircleGeometry(0.2, seg).translate(0, 0, 0.082));
    }
    return [
      { geom: paint(tyre, 0x1c1c1e, { crease: 0.9 }), mat: 'rubber' },
      { geom: merge(alloy.map((g) => paint(g, 0xb4b8bf, { crease: 0.9 }))), mat: 'metal' },
      { geom: merge(dark.map((g) => paint(g, 0x2a2b2f, { crease: 0.9 }))), mat: 'gloss' },
    ];
  });
}

const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _flip = new THREE.Matrix4().makeRotationY(Math.PI);

/** Matrices for the four wheels of a car placed at `base`, turned by `spin` radians. */
export function wheelMatrices(spec: CarSpec, base: THREE.Matrix4, spin: number, out: THREE.Matrix4[]): void {
  const a = axles(spec);
  const s = spec.wheelR / WHEEL_BASE_R;
  let i = 0;
  for (const x of [a.front, a.rear]) {
    for (const side of [-1, 1]) {
      _w.makeRotationZ(-spin);
      if (side < 0) _w.multiply(_flip);
      _m.makeScale(s, s, s).premultiply(_w);
      _m.setPosition(x, spec.wheelR, side * a.track);
      out[i++].multiplyMatrices(base, _m);
    }
  }
}

const parked = new Map<CarKind, Prepared>();

/** A parked car with its wheels baked in, at middle detail, for static scenery. Tint slot 'paint'. Its lights are off. */
export function parkedCar(kind: CarKind): Prepared {
  let p = parked.get(kind);
  if (!p) {
    const model: Model = buildCar(kind, 1).map((part) => {
      if (part.mat !== 'glow') return part;
      const geom = part.geom.clone();
      const col = geom.getAttribute('color');
      const k = part.tint ? 0.9 : 0.3;
      for (let i = 0; i < col.count; i++) col.setXYZ(i, Math.min(1, col.getX(i) * k), Math.min(1, col.getY(i) * k), Math.min(1, col.getZ(i) * k));
      return { geom, mat: 'gloss' as const };
    });
    const mats = Array.from({ length: 4 }, () => new THREE.Matrix4());
    wheelMatrices(carSpec(kind), new THREE.Matrix4(), 0, mats);
    const wheel = buildCarWheel(1);
    for (const m of mats) for (const part of wheel) model.push({ ...part, geom: part.geom.clone().applyMatrix4(m) });
    parked.set(kind, (p = prepare(model)));
  }
  return p;
}
