import * as THREE from 'three';
import type { Route, RouteSample } from '../routes/route';
import { mulberry32 } from '../util/math';
import type { Prepared } from './batch';
import { PALETTES, type Building, type BuildingKind, type BuildingPalette } from './buildings';
import { parkedCar, pickPaint, type CarKind } from './cars';
import { paint, placement, surface } from './geometry';
import type { MatKind } from './materials';
import { faceUp, type Props } from './props';
import { ROAD_HALF_WIDTH, type TerrainField } from './terrainField';

export type Style = keyof typeof PALETTES;

/** Which building palette suits the route. */
export function styleFor(route: Route): Style {
  const biome = route.def.scenery.biome;
  if (biome === 'desert' || biome === 'moor' || biome === 'limestone') return biome;
  return ['riviera', 'cypress', 'provence', 'hills'].includes(route.def.id) ? 'mediterranean' : 'alpine';
}

export const EDGE = ROAD_HALF_WIDTH;
export const WALK = 2.4;
/** Back of the pavement, measured from the centreline. */
export const FRONT = EDGE + WALK;
export const KERB = 0.15;

export type Weights = [BuildingKind, number][];

export function weighted<T>(r: number, list: [T, number][]): T {
  let t = r * list.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of list) {
    t -= w;
    if (t <= 0) return k;
  }
  return list[list.length - 1][0];
}

export const CAR_MIX: [CarKind, number][] = [['city', 3], ['hatch', 4], ['sedan', 3], ['suv', 3], ['van', 1]];

export const UP = new THREE.Vector3(0, 1, 0);

export interface Spot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Shared state while laying out houses: the route, what is taken, and helpers to put things down. */
export class Site {
  readonly rng: () => number;
  readonly pal: BuildingPalette;
  readonly water: number | null;
  /** Built-on boxes: centre x, z, cos and sin of yaw, half depth, half width. */
  private taken: number[] = [];
  /** Camera blockers: centre x, z, cos, sin, half depth, half width, base y, height. */
  private solids: number[] = [];
  private tmp: RouteSample = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 };
  private seed = 1;

  constructor(
    readonly route: Route,
    readonly field: TerrainField,
    readonly props: Props,
    readonly style: Style,
  ) {
    this.rng = mulberry32(route.def.seed + 313);
    this.pal = PALETTES[style];
    this.water = route.def.scenery.waterLevel;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rng() * list.length)];
  }

  tints(): Record<string, number> {
    return { wall: this.pick(this.pal.walls), roof: this.pick(this.pal.roofs), accent: this.pick(this.pal.accents) };
  }

  roadY(s: number): number {
    return this.route.elevationAt(s) + 0.02;
  }

  at(s: number, lat: number): RouteSample {
    return this.route.place(s, lat, { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 });
  }

  ground(x: number, z: number): number {
    return this.field.heightAt(x, z);
  }

  /** Yaw that turns a model's +x toward the road from `side`. */
  facing(s: number, side: number): number {
    const p = this.route.sample(s, this.tmp);
    return Math.atan2(side * p.tx, side * p.tz);
  }

  /** Corners, edge midpoints and centre of a d × w box centred on (x, z). */
  private points(x: number, z: number, yaw: number, d: number, w: number): [number, number][] {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const out: [number, number][] = [];
    for (const a of [-0.5, 0, 0.5]) for (const b of [-0.5, 0, 0.5]) out.push([x + c * a * d + s * b * w, z - s * a * d + c * b * w]);
    return out;
  }

  /** Lowest and highest ground under a footprint, or null where it would sit in water or near a road. */
  survey(x: number, z: number, yaw: number, d: number, w: number, minRoad: number): { lo: number; hi: number } | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [px, pz] of this.points(x, z, yaw, d, w)) {
      if (this.field.onLake(px, pz) || this.field.blocksProp(px, pz)) return null;
      if (this.field.roadDistance(px, pz) < minRoad) return null;
      const h = this.field.heightAt(px, pz);
      if (this.water !== null && h < this.water + 1.2) return null;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return { lo, hi };
  }

  /** True when a d × w box centred on (x, z) overlaps nothing built so far (separating axis test). */
  free(x: number, z: number, yaw: number, d: number, w: number): boolean {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hd = d / 2;
    const hw = w / 2;
    const t = this.taken;
    for (let j = 0; j < t.length; j += 6) {
      const dx = t[j] - x;
      const dz = t[j + 1] - z;
      const c2 = t[j + 2];
      const s2 = t[j + 3];
      const axes = [c, -s, s, c, c2, -s2, s2, c2];
      let apart = false;
      for (let k = 0; k < 8 && !apart; k += 2) {
        const ax = axes[k];
        const az = axes[k + 1];
        const ra = hd * Math.abs(c * ax - s * az) + hw * Math.abs(s * ax + c * az);
        const rb = t[j + 4] * Math.abs(c2 * ax - s2 * az) + t[j + 5] * Math.abs(s2 * ax + c2 * az);
        if (Math.abs(dx * ax + dz * az) >= ra + rb - 0.05) apart = true;
      }
      if (!apart) return false;
    }
    return true;
  }

  /** A solid the ride camera must stay outside. y is the base, h the height. */
  solid(x: number, z: number, yaw: number, d: number, w: number, y: number, h: number): void {
    this.solids.push(x, z, Math.cos(yaw), Math.sin(yaw), d / 2, w / 2, y, h);
  }

  boxes(): Float32Array {
    return Float32Array.from(this.solids);
  }

  /** Mark a footprint as built on, and keep trees off it. */
  occupy(x: number, z: number, yaw: number, d: number, w: number, treePad = 2.5): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.taken.push(x, z, c, s, d / 2, w / 2);
    const long = Math.max(d, w);
    const short = Math.min(d, w);
    const n = Math.max(1, Math.ceil(long / short));
    const r = Math.hypot(short, long / n) / 2 + treePad;
    const [ax, az] = d >= w ? [c, -s] : [s, c];
    for (let i = 0; i < n; i++) {
      const k = ((i + 0.5) / n - 0.5) * long;
      this.props.clearing(x + ax * k, z + az * k, r);
    }
  }

  /** Occupy a box given in road coordinates. */
  occupyStrip(s0: number, s1: number, lat0: number, lat1: number, side: number, treePad = 2.5): void {
    const sm = (s0 + s1) / 2;
    const c = this.at(sm, side * (lat0 + lat1) / 2);
    this.occupy(c.x, c.z, this.facing(sm, side), lat1 - lat0, s1 - s0, treePad);
  }

  freeStrip(s0: number, s1: number, lat0: number, lat1: number, side: number): boolean {
    const sm = (s0 + s1) / 2;
    const c = this.at(sm, side * (lat0 + lat1) / 2);
    return this.free(c.x, c.z, this.facing(sm, side), lat1 - lat0, s1 - s0);
  }

  /**
   * Put a building facing the road from `side` with its front `front` metres from the centreline.
   * floor fixes the ground floor height; otherwise it sits just below the highest ground.
   */
  put(
    b: Building,
    s: number,
    side: number,
    front: number,
    o: { floor?: number; minRoad?: number; bury?: number; tints?: Record<string, number> } = {},
  ): Spot | null {
    const yaw = this.facing(s, side);
    const depth = b.front + b.back;
    const mid = this.at(s, side * (front + depth / 2));
    if (!this.free(mid.x, mid.z, yaw, depth, b.w)) return null;
    const g = this.survey(mid.x, mid.z, yaw, depth, b.w, o.minRoad ?? FRONT - 0.8);
    if (!g) return null;
    const y = o.floor ?? g.hi - 0.2;
    if (g.hi - y > (o.bury ?? 1.8) || y - g.lo > 2.4) return null;
    const origin = this.at(s, side * (front + b.front));
    this.props.place(b.model, placement(origin.x, y, origin.z, yaw), o.tints ?? this.tints());
    this.occupy(mid.x, mid.z, yaw, depth, b.w);
    this.solid(mid.x, mid.z, yaw, depth, b.w, y, b.h + 0.8);
    return { x: origin.x, y, z: origin.z, yaw };
  }

  /** Put a building with its origin at a world point. */
  putAt(b: Building, x: number, z: number, yaw: number, o: { minRoad: number; tints?: Record<string, number> }): Spot | null {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const shift = (b.front - b.back) / 2;
    const mx = x + c * shift;
    const mz = z - sn * shift;
    const depth = b.front + b.back;
    if (!this.free(mx, mz, yaw, depth, b.w)) return null;
    const g = this.survey(mx, mz, yaw, depth, b.w, o.minRoad);
    if (!g || g.hi - g.lo > 2.2) return null;
    const y = g.hi - 0.2;
    this.props.place(b.model, placement(x, y, z, yaw), o.tints ?? this.tints());
    this.occupy(mx, mz, yaw, depth, b.w);
    this.solid(mx, mz, yaw, depth, b.w, y, b.h + 0.8);
    return { x, y, z, yaw };
  }

  add(geom: THREE.BufferGeometry, color: number, mat: MatKind = 'ground', jitter = 0.03, crease = 0.9): void {
    this.props.addWorld(paint(geom, color, { crease, jitter, seed: this.seed++ }), mat);
  }

  car(x: number, y: number, z: number, yaw: number, pitch = 0): void {
    const kind = weighted(this.rng(), CAR_MIX);
    this.props.place(parkedCar(kind), placement(x, y, z, yaw, 1, pitch), { paint: pickPaint(this.rng()) });
  }

  /** Fence bays of `bay` metres (model along +z) between successive points. */
  run(model: Prepared, bay: number, pts: THREE.Vector3[], centred = false): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const z = pts[i + 1].clone().sub(a);
      const len = z.length();
      if (len < 0.3) continue;
      z.divideScalar(len);
      const x = new THREE.Vector3().crossVectors(UP, z).normalize();
      const y = new THREE.Vector3().crossVectors(z, x);
      const m = new THREE.Matrix4().makeBasis(x, y, z.multiplyScalar(len / bay));
      m.setPosition(centred ? a.clone().lerp(pts[i + 1], 0.5) : a);
      this.props.place(model, m);
    }
  }

  /** Points on the ground at a fixed offset along the road. */
  line(s0: number, s1: number, lat: number, step: number, y?: (s: number) => number): THREE.Vector3[] {
    const n = Math.max(1, Math.round(Math.abs(s1 - s0) / step));
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const p = this.at(s, lat);
      out.push(new THREE.Vector3(p.x, y ? y(s) : this.ground(p.x, p.z), p.z));
    }
    return out;
  }

  /** Points on the ground across the road at one place. */
  across(s: number, lat0: number, lat1: number, step: number): THREE.Vector3[] {
    const n = Math.max(1, Math.round(Math.abs(lat1 - lat0) / step));
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const p = this.at(s, lat0 + ((lat1 - lat0) * i) / n);
      out.push(new THREE.Vector3(p.x, this.ground(p.x, p.z), p.z));
    }
    return out;
  }
}

/** A grid over (u, v) in 0..1, flipped to face up. */
export function patch(nu: number, nv: number, f: (u: number, v: number) => THREE.Vector3): THREE.BufferGeometry {
  return faceUp(surface(nu, nv, f));
}

/** A vertical face between two curves, drawn from both sides. */
export function curtain(n: number, f: (u: number) => [number, number, number, number]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const [ax, az, a0, a1] = f(i / n);
    const [bx, bz, b0, b1] = f((i + 1) / n);
    pos.push(ax, a0, az, bx, b0, bz, ax, a1, az, bx, b0, bz, bx, b1, bz, ax, a1, az);
    pos.push(ax, a0, az, ax, a1, az, bx, b0, bz, bx, b0, bz, ax, a1, az, bx, b1, bz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** A local frame on the road at s, for side streets and drives: P(d, w) = origin + u·d + t·w. */
export class Frame {
  readonly ox: number;
  readonly oz: number;
  readonly tx: number;
  readonly tz: number;
  readonly ux: number;
  readonly uz: number;
  readonly y: number;

  constructor(site: Site, s: number, side: number) {
    const p = site.at(s, 0);
    this.ox = p.x;
    this.oz = p.z;
    this.tx = p.tx;
    this.tz = p.tz;
    this.ux = -p.tz * side;
    this.uz = p.tx * side;
    this.y = site.roadY(s);
  }

  x(d: number, w: number): number {
    return this.ox + this.ux * d + this.tx * w;
  }

  z(d: number, w: number): number {
    return this.oz + this.uz * d + this.tz * w;
  }

  /** Yaw that points a model's +x along (a, b) in frame terms (a along u, b along t). */
  yaw(a: number, b: number): number {
    const dx = this.ux * a + this.tx * b;
    const dz = this.uz * a + this.tz * b;
    return Math.atan2(-dz, dx);
  }
}
