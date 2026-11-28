import * as THREE from 'three';
import { q, v3 } from './geometry';
import { ellipsoid } from './isosurface';

/*
 * The rider's torso: the centre line and section tables the jersey is lofted from, and a
 * distance field of the same torso, so the shorts and the sleeves can blend into it.
 * Rider-local frame: +x forward, +y up, +z right. Metres.
 */

/** Piecewise-linear table lookup. */
export function table(ts: number[], vs: number[], t: number): number {
  if (t <= ts[0]) return vs[0];
  for (let i = 1; i < ts.length; i++) {
    if (t <= ts[i]) {
      const f = (t - ts[i - 1]) / (ts[i] - ts[i - 1]);
      return vs[i - 1] + (vs[i] - vs[i - 1]) * f;
    }
  }
  return vs[vs.length - 1];
}

/** Torso centre line from the saddle to the neck, and its width, depth and belly tables along it. */
export const SPINE = [v3(-0.31, 1.04), v3(-0.25, 1.08), v3(-0.19, 1.135), v3(-0.12, 1.18), v3(-0.06, 1.225), v3(0.0, 1.265), v3(0.06, 1.3), v3(0.11, 1.325), v3(0.15, 1.345), v3(0.185, 1.36), v3(0.215, 1.37)];
export const TT = [0, 0.08, 0.16, 0.28, 0.4, 0.52, 0.64, 0.74, 0.84, 0.92, 1];
export const TW = [0.148, 0.162, 0.15, 0.136, 0.142, 0.156, 0.17, 0.176, 0.168, 0.138, 0.1];
export const TH = [0.108, 0.114, 0.108, 0.096, 0.102, 0.11, 0.118, 0.114, 0.1, 0.082, 0.07];
export const TN = [1, 1.02, 0.98, 0.94, 1.02, 1.1, 1.14, 1.1, 1.02, 0.94, 0.88];
/** Where the jersey's hem sits on the spine (0 at the saddle, 1 at the neck). The shorts show below it. */
export const JERSEY_HEM = 0.16;

/** Sides of a torso section at the detail level being built. */
export const torsoSides = (): number => q(36, 14);

/** Rings in a torso loft from `from` to `to` at the detail level being built. */
export function torsoRings(from: number, to: number, hi: boolean): number {
  return hi ? Math.max(4, Math.round((to - from) * 32)) : Math.max(2, Math.round((to - from) * q(22, 8)));
}

/** One cross-section of the torso: centre, unit tangent along the spine (in xy), half width, half depth, belly factor. */
export interface Station {
  x: number;
  y: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
  nose: number;
}

/** Torso sections at these points on the spine, scaled by `scale`. */
export function stationsAt(ts: number[], scale: number): Station[] {
  const spine = new THREE.CatmullRomCurve3(SPINE, false, 'centripetal');
  const T = new THREE.Vector3();
  return ts.map((t) => {
    const c = spine.getPoint(t);
    spine.getTangent(t, T);
    const l = Math.hypot(T.x, T.y);
    return { x: c.x, y: c.y, tx: T.x / l, ty: T.y / l, w: table(TT, TW, t) * scale, h: table(TT, TH, t) * scale, nose: table(TT, TN, t) };
  });
}

/** 2D ellipse distance (Quilez's bound), half axes a and b. */
export function ellipse(u: number, v: number, a: number, b: number): number {
  const k0 = Math.hypot(u / a, v / b);
  if (k0 < 1e-9) return -Math.min(a, b);
  return (k0 * (k0 - 1)) / Math.hypot(u / (a * a), v / (b * b));
}

/** Exact distance for a section field `d` closed by an end plane `end` (both signed). */
export function capped(d: number, end: number): number {
  return Math.min(Math.max(d, end), 0) + Math.hypot(Math.max(d, 0), Math.max(end, 0));
}

/**
 * Distance to the torso through these stations: elliptical sections, straight between
 * stations like the jersey loft, flat at the top and either flat or domed `dome` deep at the bottom.
 */
export function torsoField(st: Station[], x: number, y: number, z: number, dome = 0): number {
  // Find the section plane through the point, between two stations' planes, as the loft
  // interpolates them. Unlike the nearest point on the centre line, this does not jump from
  // one segment to the next on the inside of a bend, so the field stays continuous.
  const side = (k: number) => (x - st[k].x) * st[k].tx + (y - st[k].y) * st[k].ty;
  let best = Infinity;
  let bi = 0;
  let bs = 0;
  let f0 = side(0);
  for (let i = 0; i < st.length - 1; i++) {
    const f1 = side(i + 1);
    let s: number;
    if (f0 >= 0 && f1 <= 0) {
      // Between the planes: the plane through the point, refined once with the interpolated tangent.
      s = f0 - f1 > 1e-12 ? f0 / (f0 - f1) : 0;
      const a = st[i];
      const b = st[i + 1];
      for (let it = 0; it < 2; it++) {
        const tx = a.tx + (b.tx - a.tx) * s;
        const ty = a.ty + (b.ty - a.ty) * s;
        const g = (x - a.x - (b.x - a.x) * s) * tx + (y - a.y - (b.y - a.y) * s) * ty;
        const dg = -((b.x - a.x) * tx + (b.y - a.y) * ty) + (x - a.x - (b.x - a.x) * s) * (b.tx - a.tx) + (y - a.y - (b.y - a.y) * s) * (b.ty - a.ty);
        if (Math.abs(dg) < 1e-12) break;
        s = Math.max(0, Math.min(1, s - g / dg));
      }
    } else if (i === 0 && f0 < 0) s = 0;
    else if (i === st.length - 2 && f1 > 0) s = 1;
    else {
      f0 = f1;
      continue;
    }
    const a = st[i];
    const b = st[i + 1];
    const dx = x - (a.x + (b.x - a.x) * s);
    const dy = y - (a.y + (b.y - a.y) * s);
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      bi = i;
      bs = s;
    }
    f0 = f1;
  }
  const a = st[bi];
  const b = st[bi + 1];
  const lerp = (p: number, r: number) => p + (r - p) * bs;
  let tx = lerp(a.tx, b.tx);
  let ty = lerp(a.ty, b.ty);
  const tl = Math.hypot(tx, ty);
  tx /= tl;
  ty /= tl;
  const ox = x - lerp(a.x, b.x);
  const oy = y - lerp(a.y, b.y);
  const along = ox * tx + oy * ty;
  // N = T × Z points to the belly, as in the jersey loft.
  const ln = ox * ty - oy * tx;
  const w = lerp(a.w, b.w);
  const h = lerp(a.h, b.h) * (ln > 0 ? lerp(a.nose, b.nose) : 1);
  const first = bi === 0 && bs === 0 && along < 0;
  if (first && dome > 0) return ellipsoid(z, ln, along, w, h, dome);
  const end = first ? -along : bi === st.length - 2 && bs === 1 ? along : -1;
  return capped(ellipse(z, ln, w, h), end);
}
