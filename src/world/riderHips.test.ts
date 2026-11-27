import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Detail } from './geometry';
import { isosurface } from './isosurface';
import { FOOT_Z, HIP, LEG_Z, SPINE, table, TH, THIGH, TN, TT, TW } from './riderBody';
import { buildHips, HEM, THIGH_REST } from './riderHips';

/** The vertex shader's bend in TypeScript: each vertex turns about its hip by its share of that thigh's turn. */
function bend(p: THREE.Vector3, w: number, turns: THREE.Quaternion[]): THREE.Vector3 {
  const k = w < 0 ? 0 : 1;
  const q = turns[k];
  const a = Math.abs(w);
  const share = new THREE.Quaternion(q.x * a, q.y * a, q.z * a, 1 - a + q.w * a).normalize();
  const pivot = new THREE.Vector3(HIP.x, HIP.y, k ? LEG_Z : -LEG_Z);
  return p.clone().sub(pivot).applyQuaternion(share).add(pivot);
}

/** Turns from rest for the left and right thighs at these angles below +x, pointed as `solveKnee` points them. */
function turnsAt(left: number, right: number): THREE.Quaternion[] {
  return [left, right].map((a, k) => {
    const side = k ? 1 : -1;
    const dir = new THREE.Vector3(THIGH * Math.cos(a), THIGH * Math.sin(a), (side * (FOOT_Z - LEG_Z)) / 2).normalize();
    return new THREE.Quaternion().setFromUnitVectors(THIGH_REST[k], dir);
  });
}

/** A pedal stroke swings each thigh between about -22° and -67° below +x, the two half a turn apart. */
const deg = (d: number) => (d * Math.PI) / 180;
const POSES: [number, number][] = [
  [deg(-22), deg(-67)],
  [deg(-67), deg(-22)],
  [deg(-44), deg(-44)],
  [deg(-22), deg(-44)],
  [deg(-67), deg(-44)],
];

/** Distance down a thigh's rest axis from its hip joint. */
function along(p: THREE.Vector3): number {
  const k = p.z < 0 ? 0 : 1;
  const d = THIGH_REST[k];
  return (p.x - HIP.x) * d.x + (p.y - HIP.y) * d.y + (p.z - (k ? LEG_Z : -LEG_Z)) * d.z;
}

/** How far out of the smooth jersey a point is (1 on its surface), and the spine station it is at. */
const spine = new THREE.CatmullRomCurve3(SPINE, false, 'centripetal');
const STATIONS = Array.from({ length: 301 }, (_, i) => {
  const t = (i / 300) * 0.45;
  return { t, c: spine.getPoint(t), T: spine.getTangent(t) };
});
function jersey(p: THREE.Vector3): { t: number; e: number } {
  let best = STATIONS[0];
  let nearest = Infinity;
  for (const s of STATIONS) {
    const d = Math.hypot(p.x - s.c.x, p.y - s.c.y);
    if (d < nearest) {
      nearest = d;
      best = s;
    }
  }
  const ln = (p.x - best.c.x) * best.T.y - (p.y - best.c.y) * best.T.x;
  const h = table(TT, TH, best.t) * (ln > 0 ? table(TT, TN, best.t) : 1);
  return { t: best.t, e: Math.hypot(p.z / table(TT, TW, best.t), ln / h) };
}

function shorts(detail: Detail) {
  const model = buildHips(detail);
  const part = model.find((p) => p.tint === 'shorts')!;
  const pos = part.geom.getAttribute('position');
  const w = part.geom.getAttribute('hipW');
  const pts: THREE.Vector3[] = [];
  const ws: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    pts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
    ws.push(w.getX(i));
  }
  const bent = POSES.map(([l, r]) => {
    const turns = turnsAt(l, r);
    return pts.map((p, i) => bend(p, ws[i], turns));
  });
  return { model, pts, ws, bent };
}

describe('isosurface', () => {
  it('meshes a sphere closed, on the surface, facing out', () => {
    const r = 0.1;
    const iso = isosurface((x, y, z) => Math.hypot(x, y, z) - r, { min: [-0.13, -0.13, -0.13], max: [0.13, 0.13, 0.13] }, 0.02);
    const p = iso.positions;
    for (let v = 0; v < p.length; v += 3) expect(Math.hypot(p[v], p[v + 1], p[v + 2])).toBeCloseTo(r, 4);
    // Closed: every edge is shared by exactly two triangles, once each way.
    const edges = new Map<string, number>();
    for (let t = 0; t < iso.index.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = iso.index[t + e];
        const b = iso.index[t + ((e + 1) % 3)];
        edges.set(`${a},${b}`, (edges.get(`${a},${b}`) ?? 0) + 1);
      }
    }
    for (const [key, n] of edges) {
      const [a, b] = key.split(',');
      expect(n).toBe(1);
      expect(edges.get(`${b},${a}`)).toBe(1);
    }
    // Wound counter-clockwise from outside: face normals point away from the centre.
    let outward = 0;
    for (let t = 0; t < iso.index.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromArray(p, iso.index[t + k] * 3));
      const n = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
      if (n.dot(a) > 0) outward++;
    }
    expect(outward).toBe(iso.index.length / 3);
  });
});

describe('rider hips', () => {
  for (const detail of [0, 1, 2] as Detail[]) {
    describe(`detail ${detail}`, () => {
      const { model, pts, ws, bent } = shorts(detail);

      it('has the shorts and the bare thighs, every vertex weighted', () => {
        expect(model.map((p) => p.tint).sort()).toEqual(['shorts', 'skin']);
        for (const p of model) expect(p.geom.getAttribute('hipW').count).toBe(p.geom.getAttribute('position').count);
        expect(pts.length % 3).toBe(0);
        expect(pts.every((p) => Number.isFinite(p.x + p.y + p.z))).toBe(true);
        expect(ws.every((w) => Math.abs(w) <= 1)).toBe(true);
      });

      it('is mirrored, each half following its own thigh and the centre line following neither', () => {
        for (let i = 0; i < pts.length; i++) {
          if (Math.abs(pts[i].z) < 1e-6) expect(Math.abs(ws[i])).toBe(0);
          else if (ws[i] !== 0) expect(Math.sign(ws[i])).toBe(Math.sign(pts[i].z));
        }
        expect(ws.filter((w) => w < 0).length).toBe(ws.filter((w) => w > 0).length);
      });

      it('moves the hem wholly with the thigh, so it meets the bare leg, and ends there', () => {
        for (let i = 0; i < pts.length; i++) {
          if (along(pts[i]) > HEM - 0.03) expect(Math.abs(ws[i])).toBe(1);
          expect(along(pts[i])).toBeLessThanOrEqual(HEM + 1e-4);
        }
      });

      it('keeps the seat on the saddle through the stroke', () => {
        // On top of the saddle behind the hip joints, between the sit bones.
        let moved = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (p.y < 0.98 || p.y > 0.995 || Math.abs(p.z) > 0.05 || p.x > HIP.x - 0.04 || p.x < -0.39) continue;
          for (const pose of bent) moved = Math.max(moved, pose[i].distanceTo(p));
        }
        expect(moved).toBeLessThan(0.012);
      });

      it('stays inside the jersey above its hem in every pose', () => {
        // Fewer jersey sides further out: their flat faces cut in by cos(π/n).
        const limit = Math.cos(Math.PI / [36, 14, 8][detail]) - 0.01;
        let covered = 0;
        for (let i = 0; i < pts.length; i++) {
          const j = jersey(pts[i]);
          if (j.t < 0.17 || j.e > 1.2) continue;
          covered++;
          expect(j.e).toBeLessThan(limit);
          for (const pose of bent) expect(jersey(pose[i]).e).toBeLessThan(limit);
        }
        expect(covered).toBeGreaterThan(20);
      });

      it('bends through the stroke without tearing or folding over', () => {
        let longest = 1;
        let shortest = 1;
        let flipped = 0;
        for (const pose of bent) {
          for (let t = 0; t < pts.length; t += 3) {
            for (let e = 0; e < 3; e++) {
              const a = t + e;
              const b = t + ((e + 1) % 3);
              const rest = pts[a].distanceTo(pts[b]);
              if (rest < 1e-4) continue;
              const ratio = pose[a].distanceTo(pose[b]) / rest;
              longest = Math.max(longest, ratio);
              shortest = Math.min(shortest, ratio);
            }
            const n0 = new THREE.Triangle(pts[t], pts[t + 1], pts[t + 2]).getNormal(new THREE.Vector3());
            const n1 = new THREE.Triangle(pose[t], pose[t + 1], pose[t + 2]).getNormal(new THREE.Vector3());
            // A face turns with the thigh (up to 23°), never round to face inward.
            if (n0.dot(n1) < Math.cos(deg(90))) flipped++;
          }
        }
        // The worst is the crease in front of the hip, between the jersey's hem and the thigh.
        expect(longest).toBeLessThan(2);
        expect(shortest).toBeGreaterThan(0.3);
        expect(flipped).toBe(0);
      });

      it('keeps the inner thighs apart, so the two legs never share skin', () => {
        for (const p of pts) if (along(p) > 0.12) expect(Math.abs(p.z)).toBeGreaterThan(0.01);
      });
    });
  }
});
