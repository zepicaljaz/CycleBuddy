import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const v3 = (x: number, y: number, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Close up, mid distance, far away. */
export type Detail = 0 | 1 | 2;
let level: Detail = 0;

/** Segment count for the detail level being built. Far counts are derived from mid and never exceed it. */
export function q(close: number, mid: number): number {
  return level === 0 ? close : level === 1 ? mid : Math.min(mid, Math.max(3, Math.round(mid * 0.55)));
}

/** Run a model builder at a detail level, which `q` reads. */
export function atDetail<T>(detail: Detail, build: () => T): T {
  const prev = level;
  level = detail;
  try {
    return build();
  } finally {
    level = prev;
  }
}

/**
 * Non-indexed copy with normals smoothed across edges flatter than `crease` radians.
 * Positions closer than `tol` count as the same vertex, so small parts keep their shape.
 */
export function creased(geom: THREE.BufferGeometry, crease = 0.6, tol = 1e-5): THREE.BufferGeometry {
  const g = geom.index ? geom.toNonIndexed() : geom.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'uv') g.deleteAttribute(name);
  const p = g.getAttribute('position').array as Float32Array;
  const n = p.length / 3;
  const faces = n / 3;
  const fn = new Float32Array(faces * 3);
  const area = new Float32Array(faces);
  for (let f = 0; f < faces; f++) {
    const o = f * 9;
    const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
    const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    area[f] = l;
    if (l > 0) {
      fn[f * 3] = nx / l;
      fn[f * 3 + 1] = ny / l;
      fn[f * 3 + 2] = nz / l;
    }
  }
  const normals = new Float32Array(n * 3);
  const cosC = Math.cos(crease);
  if (crease <= 0) {
    for (let i = 0; i < n; i++) {
      const f = Math.floor(i / 3);
      normals[i * 3] = fn[f * 3];
      normals[i * 3 + 1] = fn[f * 3 + 1];
      normals[i * 3 + 2] = fn[f * 3 + 2];
    }
  } else {
    const inv = 1 / tol;
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(p[i * 3] * inv)},${Math.round(p[i * 3 + 1] * inv)},${Math.round(p[i * 3 + 2] * inv)}`;
      let list = groups.get(k);
      if (!list) groups.set(k, (list = []));
      list.push(i);
    }
    for (const list of groups.values()) {
      for (const i of list) {
        const fi = Math.floor(i / 3);
        let sx = 0, sy = 0, sz = 0;
        for (const j of list) {
          const fj = Math.floor(j / 3);
          const d = fn[fi * 3] * fn[fj * 3] + fn[fi * 3 + 1] * fn[fj * 3 + 1] + fn[fi * 3 + 2] * fn[fj * 3 + 2];
          if (d < cosC) continue;
          const w = Math.min(area[fj], 1e3) + 1e-12;
          sx += fn[fj * 3] * w;
          sy += fn[fj * 3 + 1] * w;
          sz += fn[fj * 3 + 2] * w;
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        normals[i * 3] = sx / l;
        normals[i * 3 + 1] = sy / l;
        normals[i * 3 + 2] = sz / l;
      }
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}

export interface PaintOptions {
  /** Edges flatter than this many radians are shaded smooth. 0 = faceted. */
  crease?: number;
  /** Random brightness change per triangle. */
  jitter?: number;
  seed?: number;
  /** Keep texture coordinates (for decals). */
  keepUv?: boolean;
}

/** Shaded, non-indexed geometry with a baked vertex colour. All parts share position, normal and colour. */
export function paint(geom: THREE.BufferGeometry, hex: THREE.ColorRepresentation, opts: PaintOptions = {}): THREE.BufferGeometry {
  const g = creased(geom, opts.crease ?? 0.6);
  if (!opts.keepUv && g.getAttribute('uv')) g.deleteAttribute('uv');
  const base = hex instanceof THREE.Color ? hex : new THREE.Color(hex);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const jitter = opts.jitter ?? 0;
  let s = (opts.seed ?? 1) >>> 0 || 1;
  for (let i = 0; i < count; i += 3) {
    let k = 1;
    if (jitter) {
      s = (s * 16807) % 2147483647;
      k = 1 + ((s / 2147483647) * 2 - 1) * jitter;
    }
    for (let v = 0; v < 3 && i + v < count; v++) {
      colors[(i + v) * 3] = base.r * k;
      colors[(i + v) * 3 + 1] = base.g * k;
      colors[(i + v) * 3 + 2] = base.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Flat-shaded geometry with a baked vertex colour. */
export function colored(geom: THREE.BufferGeometry, hex: number, jitter = 0, seed = 1): THREE.BufferGeometry {
  return paint(geom, hex, { crease: 0, jitter, seed });
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.filter((p) => p.getAttribute('position').count > 0);
  if (!list.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
    return g;
  }
  const g = mergeGeometries(list, false);
  if (!g) throw new Error('merge failed');
  g.computeBoundingSphere();
  return g;
}

/** Superellipse outline. exp 2 is an ellipse, higher values get boxier. */
export function outline(n: number, exp = 2): [number, number][] {
  const out: [number, number][] = [];
  const e = 2 / exp;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push([Math.sign(c) * Math.pow(Math.abs(c), e), Math.sign(s) * Math.pow(Math.abs(s), e)]);
  }
  return out;
}

/**
 * Skin over a list of closed rings (same point count each). Caps close the ends.
 * Faces are turned so normals point away from the middle of the shape.
 */
export function loft(rings: THREE.Vector3[][], capStart = true, capEnd = true): THREE.BufferGeometry {
  const N = rings[0].length;
  const pos: number[] = [];
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  const idx: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * N + j;
      const b = i * N + ((j + 1) % N);
      const c = (i + 1) * N + j;
      const d = (i + 1) * N + ((j + 1) % N);
      idx.push(a, c, b, b, c, d);
    }
  }
  const cap = (ring: THREE.Vector3[], base: number, flip: boolean) => {
    const c = new THREE.Vector3();
    for (const p of ring) c.add(p);
    c.multiplyScalar(1 / ring.length);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    for (let j = 0; j < N; j++) {
      const a = base + j;
      const b = base + ((j + 1) % N);
      if (flip) idx.push(ci, a, b);
      else idx.push(ci, b, a);
    }
  };
  if (capStart) cap(rings[0], 0, true);
  if (capEnd) cap(rings[rings.length - 1], (rings.length - 1) * N, false);
  orientOutward(pos, idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function orientOutward(pos: number[], idx: number[]): void {
  let cx = 0, cy = 0, cz = 0;
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    cx += pos[i * 3];
    cy += pos[i * 3 + 1];
    cz += pos[i * 3 + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a] - cx, ay = pos[a + 1] - cy, az = pos[a + 2] - cz;
    const bx = pos[b] - cx, by = pos[b + 1] - cy, bz = pos[b + 2] - cz;
    const qx = pos[c] - cx, qy = pos[c + 1] - cy, qz = pos[c + 2] - cz;
    vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
  }
  if (vol < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }
}

export interface SweepOptions {
  /** Points around each ring. */
  sides?: number;
  /** Superellipse exponent for the ring. */
  exp?: number;
  /** Reference axis for the ring's width. Defaults to +z (across the bike). */
  ref?: THREE.Vector3;
  /** Shift of the ring centre along its width and height axes. */
  offset?: (t: number) => [number, number];
  /** Leading side of the ring (height axis +) is this fraction of the trailing side, for teardrop tubes. */
  nose?: (t: number) => number;
  caps?: boolean;
}

/**
 * Tube along a path. radius(t) returns [half-width, half-height] where width is along
 * the reference axis and height is perpendicular to both the path and that axis.
 */
export function sweep(path: THREE.Vector3[], radius: (t: number) => [number, number], opts: SweepOptions = {}): THREE.BufferGeometry {
  const sides = opts.sides ?? 10;
  const shape = outline(sides, opts.exp ?? 2);
  const ref = opts.ref ?? new THREE.Vector3(0, 0, 1);
  const rings: THREE.Vector3[][] = [];
  const T = new THREE.Vector3();
  const S = new THREE.Vector3();
  const N = new THREE.Vector3();
  const total = pathLength(path);
  let acc = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) acc += path[i].distanceTo(path[i - 1]);
    const t = total > 0 ? acc / total : 0;
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    T.subVectors(b, a).normalize();
    S.copy(ref).addScaledVector(T, -ref.dot(T));
    if (S.lengthSq() < 1e-8) S.set(1, 0, 0).addScaledVector(T, -T.x);
    S.normalize();
    N.crossVectors(T, S).normalize();
    const [rw, rh] = radius(t);
    const [ow, oh] = opts.offset ? opts.offset(t) : [0, 0];
    const nose = opts.nose ? opts.nose(t) : 1;
    const ring: THREE.Vector3[] = [];
    for (const [c, s] of shape) {
      const h = s > 0 ? s * rh * nose : s * rh;
      ring.push(path[i].clone().addScaledVector(S, c * rw + ow).addScaledVector(N, h + oh));
    }
    rings.push(ring);
  }
  return loft(rings, opts.caps ?? true, opts.caps ?? true);
}

export function pathLength(path: THREE.Vector3[]): number {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += path[i].distanceTo(path[i - 1]);
  return l;
}

/** Points on a Catmull-Rom curve through the given points. */
export function curve(points: THREE.Vector3[], segments: number): THREE.Vector3[] {
  if (points.length === 2) {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) out.push(points[0].clone().lerp(points[1], i / segments));
    return out;
  }
  return new THREE.CatmullRomCurve3(points, false, 'centripetal').getPoints(segments);
}

/** Round tube between two points, tapering from r0 to r1. */
export function tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, sides = 8, caps = true): THREE.BufferGeometry {
  return sweep([a, b], (t) => [r0 + (r1 - r0) * t, r0 + (r1 - r0) * t], { sides, caps });
}

/** Unit-length tube along +y with a radius profile, so it can be stretched between two joints. */
export function limb(profile: (t: number) => number, sides = 10, rings = 8, from = 0, to = 1): THREE.BufferGeometry {
  const path: THREE.Vector3[] = [];
  for (let i = 0; i <= rings; i++) path.push(new THREE.Vector3(0, from + ((to - from) * i) / rings, 0));
  return sweep(path, (t) => {
    const r = profile(from + (to - from) * t);
    return [r, r];
  }, { sides, ref: new THREE.Vector3(1, 0, 0) });
}

/** Box with bevelled vertical edges, centred at the origin. */
export function roundedBox(w: number, h: number, d: number, r: number, segs = 2): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const x = w / 2 - r;
  const z = d / 2 - r;
  shape.moveTo(-x, -d / 2);
  shape.lineTo(x, -d / 2);
  shape.absarc(x, -z, r, -Math.PI / 2, 0, false);
  shape.lineTo(w / 2, z);
  shape.absarc(x, z, r, 0, Math.PI / 2, false);
  shape.lineTo(-x, d / 2);
  shape.absarc(-x, z, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w / 2, -z);
  shape.absarc(-x, -z, r, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: segs });
  g.rotateX(Math.PI / 2);
  g.translate(0, h / 2, 0);
  return g;
}

/** Extruded side profile (x, y) across z, centred on z = 0. */
export function profileExtrude(points: [number, number][], width: number, bevel = 0, curveSegments = 1): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return g;
}

/** Quad grid on a callback surface. f(u, v) gives the point for u, v in 0..1. */
export function surface(nu: number, nv: number, f: (u: number, v: number) => THREE.Vector3, withUv = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const p = f(i / nu, j / nv);
      pos.push(p.x, p.y, p.z);
      uv.push(i / nu, j / nv);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Matrix from position, yaw about +y, optional pitch about local z and roll about local x. */
export function placement(x: number, y: number, z: number, yaw = 0, scale = 1, pitch = 0, roll = 0, out = new THREE.Matrix4()): THREE.Matrix4 {
  _e.set(roll, yaw, pitch, 'YZX');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(scale, scale, scale);
  return out.compose(_p, _q, _s);
}

/** Copy of a geometry moved by a matrix. */
export function moved(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  return g.clone().applyMatrix4(m);
}

export function at(g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): THREE.BufferGeometry {
  return g.applyMatrix4(placement(x, y, z, yaw, 1, pitch, roll, _m));
}
