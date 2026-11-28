import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { atDetail, type Detail } from './geometry';
import { armJoints, buildArms, CUFF_FROM, jerseyStations, SLEEVE_END, SLEEVE_SCALE, upperArmR } from './riderArms';
import { torsoField } from './riderTorso';

function points(g: THREE.BufferGeometry): THREE.Vector3[] {
  const p = g.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i));
}

/** Distance along the upper arm (shoulder end of its tube to the elbow) and from its axis, on the point's side. */
function onUpperArm(p: THREE.Vector3): { u: number; r: number; len: number } {
  const j = armJoints(p.z < 0 ? -1 : 1);
  const axis = j.e.clone().sub(j.s0);
  const len = axis.length();
  axis.normalize();
  const o = p.clone().sub(j.s0);
  const u = o.dot(axis);
  return { u, r: o.addScaledVector(axis, -u).length(), len };
}

const key = (p: THREE.Vector3) => `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;

describe('rider arms', () => {
  for (const detail of [0, 1, 2] as Detail[]) {
    describe(`detail ${detail}`, () => {
      const arms = atDetail(detail, () => buildArms(detail));
      const loft = atDetail(detail, () => jerseyStations(detail));
      const sleeve = points(arms.sleeve);
      const cuff = points(arms.cuff);

      it('has sleeves, cuff bands and bare arms, with unit normals facing out', () => {
        expect(sleeve.length).toBeGreaterThan(100);
        expect(cuff.length).toBeGreaterThan(30);
        for (const g of [arms.sleeve, arms.cuff]) {
          const n = g.getAttribute('normal');
          for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
          // Every face is wound with its vertex normals, so it lights from the outside.
          const p = points(g);
          for (let t = 0; t < p.length; t += 3) {
            const face = new THREE.Triangle(p[t], p[t + 1], p[t + 2]).getNormal(new THREE.Vector3());
            const vn = new THREE.Vector3().fromBufferAttribute(n, t).add(new THREE.Vector3().fromBufferAttribute(n, t + 1)).add(new THREE.Vector3().fromBufferAttribute(n, t + 2));
            if (face.lengthSq() > 0) expect(face.dot(vn)).toBeGreaterThan(0);
          }
        }
        expect(arms.skin.length).toBe(detail === 0 ? 4 : 2);
      });

      it('is mirrored left to right', () => {
        for (const set of [sleeve, cuff]) {
          const keys = new Set(set.map(key));
          for (const p of set) expect(keys.has(key(new THREE.Vector3(p.x, p.y, -p.z)))).toBe(true);
        }
      });

      it('ends the sleeve at its hem, with the cuff band just above it', () => {
        for (const p of sleeve) {
          const { u, len } = onUpperArm(p);
          expect(u).toBeLessThanOrEqual(CUFF_FROM * len + 1e-4);
        }
        for (const p of cuff) {
          const { u, len } = onUpperArm(p);
          expect(u).toBeGreaterThanOrEqual(CUFF_FROM * len - 1e-4);
          expect(u).toBeLessThanOrEqual(SLEEVE_END * len + 1e-4);
        }
      });

      it('grows out of the jersey without a gap', () => {
        // The sleeve's open edges, other than its hem, are tucked inside the jersey loft.
        const all = [...sleeve, ...cuff];
        const edges = new Map<string, [THREE.Vector3, THREE.Vector3]>();
        for (let t = 0; t < all.length; t += 3) {
          for (let e = 0; e < 3; e++) {
            const a = all[t + e];
            const b = all[t + ((e + 1) % 3)];
            const k = [key(a), key(b)].sort().join('|');
            if (edges.has(k)) edges.delete(k);
            else edges.set(k, [a, b]);
          }
        }
        let open = 0;
        for (const [a, b] of edges.values()) {
          const atHem = [a, b].every((p) => {
            const { u, len } = onUpperArm(p);
            return Math.abs(u - SLEEVE_END * len) < 1e-4 || Math.abs(u - CUFF_FROM * len) < 1e-4;
          });
          if (atHem) continue;
          open++;
          for (const p of [a, b]) expect(torsoField(loft, p.x, p.y, p.z)).toBeLessThan(0.001);
        }
        expect(open).toBeGreaterThan(10);
      });

      it('brings the bare arm out of the sleeve under its hem and through the elbow and wrist', () => {
        for (const side of [-1, 1]) {
          const j = armJoints(side);
          const arm = points(arms.skin[detail === 0 ? (side < 0 ? 0 : 2) : side < 0 ? 0 : 1]);
          // Under the sleeve the skin stays inside it, so the sleeve shows a lip at its hem.
          for (const p of arm) {
            const { u, r, len } = onUpperArm(p);
            if (u < SLEEVE_END * len && r < 0.1) expect(r).toBeLessThan(upperArmR(u / len) * SLEEVE_SCALE);
          }
          // One tube round the elbow and the wrist: each joint is about an arm's radius from its surface.
          for (const [joint, radius] of [[j.e, 0.036], [j.wrist, 0.025]] as const) {
            const nearest = Math.min(...arm.map((p) => p.distanceTo(joint)));
            expect(nearest).toBeGreaterThan(radius * 0.6);
            expect(nearest).toBeLessThan(radius * 1.3);
          }
        }
      });
    });
  }
});
