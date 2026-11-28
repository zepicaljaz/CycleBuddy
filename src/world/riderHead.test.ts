import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Detail } from './geometry';
import { buildHead, CRANIUM, helmetInner, insideHead, rimHeight, type HeadModels } from './riderHead';

const C = new THREE.Vector3(CRANIUM.x, CRANIUM.y, 0);
const heads: Record<Detail, HeadModels> = { 0: buildHead(0), 1: buildHead(1), 2: buildHead(2) };

function points(g: THREE.BufferGeometry): THREE.Vector3[] {
  const p = g.getAttribute('position');
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
  return out;
}

function triangles(g: THREE.BufferGeometry): THREE.Triangle[] {
  const p = points(g);
  const out: THREE.Triangle[] = [];
  for (let i = 0; i + 2 < p.length; i += 3) out.push(new THREE.Triangle(p[i], p[i + 1], p[i + 2]));
  return out;
}

const _q = new THREE.Vector3();
/** Distance from p to the nearest triangle. */
function distance(tris: THREE.Triangle[], p: THREE.Vector3): number {
  let best = Infinity;
  for (const t of tris) best = Math.min(best, t.closestPointToPoint(p, _q).distanceTo(p));
  return best;
}

/** Signed volume: positive when the faces point out of the shape. */
function volume(g: THREE.BufferGeometry): number {
  let v = 0;
  for (const t of triangles(g)) v += t.a.dot(new THREE.Vector3().crossVectors(t.b, t.c)) / 6;
  return v;
}

const coveredByHelmet = (p: THREE.Vector3) => p.y > rimHeight(Math.atan2(p.z, p.x - C.x)) + 0.003;
const insideShell = (p: THREE.Vector3, margin: number) => {
  const d = p.clone().sub(C);
  const r = d.length();
  return helmetInner(d.normalize()) - r > margin;
};

describe('rider head', () => {
  it('is built at every detail level within its triangle budget', () => {
    const budget: Record<Detail, number> = { 0: 7000, 1: 900, 2: 400 };
    for (const detail of [0, 1, 2] as const) {
      let tris = 0;
      for (const g of Object.values(heads[detail])) {
        const p = g.getAttribute('position');
        tris += p.count / 3;
        for (let i = 0; i < p.array.length; i++) expect(Number.isFinite(p.array[i])).toBe(true);
      }
      expect(tris, `detail ${detail}`).toBeLessThan(budget[detail]);
      expect(heads[detail].skin.getAttribute('position').count).toBeGreaterThan(0);
      expect(heads[detail].shell.getAttribute('position').count).toBeGreaterThan(0);
      expect(heads[detail].lens.getAttribute('position').count).toBeGreaterThan(0);
    }
  });

  it('faces point outward on the closed parts', () => {
    for (const detail of [0, 1, 2] as const) {
      expect(volume(heads[detail].skin), `skin ${detail}`).toBeGreaterThan(0);
      expect(volume(heads[detail].lens), `lens ${detail}`).toBeGreaterThan(0);
    }
  });

  it('has no hole or flipped face in the helmet shell', () => {
    for (const detail of [0, 1, 2] as const) {
      for (const t of triangles(heads[detail].shell)) {
        const mid = new THREE.Vector3().add(t.a).add(t.b).add(t.c).multiplyScalar(1 / 3);
        const d = mid.clone().sub(C);
        // The outer surface only; the edge's lip turns down past the rim.
        if (d.length() < helmetInner(d.clone().normalize()) + 0.012) continue;
        // A flipped face points into the head (near -1); the swept-back tail can stand side on.
        const n = t.getNormal(new THREE.Vector3());
        expect(n.dot(d.normalize()), `detail ${detail}`).toBeGreaterThan(-0.3);
      }
    }
  });

  it('fits the helmet over the skull, hair and ears with room to spare', () => {
    for (const detail of [0, 1, 2] as const) {
      const h = heads[detail];
      for (const p of [...points(h.skin), ...points(h.hair), ...points(h.ears)]) {
        if (!coveredByHelmet(p)) continue;
        expect(insideShell(p, 0.0018), `detail ${detail} at ${p.toArray().map((v) => v.toFixed(3))}`).toBe(true);
      }
    }
  });

  it('sits close on the hair, not floating above it', () => {
    // Over the crown the padding gap between hair and shell is under 12 mm everywhere.
    for (const p of points(heads[0].hair)) {
      if (p.y < 0.07) continue;
      const d = p.clone().sub(C);
      expect(helmetInner(d.clone().normalize()) - d.length()).toBeLessThan(0.012);
    }
    // The shell's edge comes down to the brow and over the back of the skull.
    expect(rimHeight(0)).toBeLessThan(0.05);
    expect(rimHeight(Math.PI)).toBeLessThan(-0.02);
  });

  it('keeps the lens off the face and rests the glasses on the nose and over the ears', () => {
    const skin = triangles(heads[0].skin);
    for (const p of points(heads[0].lens)) {
      expect(insideHead(p.x, p.y, p.z)).toBe(false);
      expect(distance(skin, p)).toBeGreaterThan(0.0015);
    }
    const frame = points(heads[0].frame);
    for (const p of frame) expect(insideHead(p.x, p.y, p.z), `frame at ${p.toArray().map((v) => v.toFixed(3))}`).toBe(false);
    // Pads touch the nose; each arm lies on the head behind the ear.
    const touching = frame.filter((p) => distance(skin, p) < 0.0012);
    expect(touching.some((p) => Math.abs(p.z) < 0.012 && p.x > 0.08)).toBe(true);
    for (const side of [-1, 1]) {
      const arm = frame.filter((p) => p.z * side > 0.05 && p.x < -0.02);
      expect(arm.length).toBeGreaterThan(0);
      expect(Math.min(...arm.map((p) => distance(skin, p)))).toBeLessThan(0.006);
    }
  });

  it('lays the straps on the skin and hides their tops in the shell', () => {
    const skin = triangles(heads[0].skin);
    const straps = points(heads[0].straps);
    expect(straps.length).toBeGreaterThan(0);
    for (const p of straps) {
      const at = p.toArray().map((v) => v.toFixed(3)).join(', ');
      expect(insideHead(p.x, p.y, p.z), `inside the skin at ${at}`).toBe(false);
      expect(distance(skin, p), `off the skin at ${at}`).toBeLessThan(0.01);
      if (coveredByHelmet(p)) expect(insideShell(p, 0), `through the shell at ${at}`).toBe(true);
    }
    // Both sides reach the buckle under the chin.
    const under = straps.filter((p) => p.y < -0.1 && Math.abs(p.z) < 0.01);
    expect(under.length).toBeGreaterThan(0);
  });
});
