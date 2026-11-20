import * as THREE from 'three';
import { colored, loft, merge, outline, v3 } from './geometry';

/**
 * Roadside crowd, matched to the faceted reference figures.
 * A man with a raised fist, a woman with a pennant, an older man with a camera,
 * and a child pointing. Clothes are baked in, so each look keeps its own colours.
 * Everyone faces local +X, with feet on y = 0. The figure's right is +Z.
 *
 * Heads are 8×6 spheres (about 80 triangles). Shirts are 8-sided tapered lofts.
 * Arms and legs are 6-sided tubes. That is the same facet size as the references.
 */

export type SpectatorKind = 'man' | 'woman' | 'elder' | 'child';

export interface SpectatorLook {
  shirt: number;
  pants: number;
  shoes: number;
  hair: number;
  skin: number;
  /** Flag, second shoe, or camera body, depending on the figure. */
  accent: number;
}

export const SPECTATOR_LOOKS: Record<SpectatorKind, SpectatorLook[]> = {
  man: [
    { shirt: 0xe15a2a, pants: 0x5c5148, shoes: 0x2c3038, hair: 0x4a3428, skin: 0xf3d2b5, accent: 0x2f9e4f },
    { shirt: 0xc8102e, pants: 0x2c3340, shoes: 0x1c1e22, hair: 0x1a1a1a, skin: 0xe0a882, accent: 0xf4f4f4 },
    { shirt: 0x2f6fbe, pants: 0x3d4a44, shoes: 0x2a2c30, hair: 0x6b4a32, skin: 0xf1c6a8, accent: 0xe23b3b },
    { shirt: 0xf4f4f4, pants: 0x2a3140, shoes: 0x1c1e22, hair: 0x3a2a22, skin: 0xc68642, accent: 0x2f6fbe },
    { shirt: 0x3aaa5a, pants: 0x4a4038, shoes: 0x2c3038, hair: 0x2a211c, skin: 0x8d5524, accent: 0xf2c14e },
  ],
  woman: [
    { shirt: 0x2aa8a8, pants: 0x2e3440, shoes: 0xc8ccd2, hair: 0x5a3a2a, skin: 0xf3d2b5, accent: 0x2f6fbe },
    { shirt: 0xe45b9a, pants: 0x2a2e36, shoes: 0xf4f4f4, hair: 0x1c1c1c, skin: 0xe0a882, accent: 0xf4f4f4 },
    { shirt: 0xf2c14e, pants: 0x3d4550, shoes: 0x2c3038, hair: 0x8a5a32, skin: 0xf1c6a8, accent: 0xe23b3b },
    { shirt: 0x7b4fd1, pants: 0x2a2e36, shoes: 0x1c1e22, hair: 0x3a2418, skin: 0xc68642, accent: 0xf2c14e },
    { shirt: 0xf4f4f4, pants: 0x1f4f8a, shoes: 0xf4f4f4, hair: 0x2a211c, skin: 0x8d5524, accent: 0x3aaa5a },
  ],
  elder: [
    { shirt: 0x2f7a45, pants: 0xc4b49a, shoes: 0x5a3a28, hair: 0xd9dde2, skin: 0xf3d2b5, accent: 0x2a2c30 },
    { shirt: 0x3d4f73, pants: 0x8a7d6a, shoes: 0x3a2a22, hair: 0xc8ccd0, skin: 0xe0a882, accent: 0x1c1e22 },
    { shirt: 0x8a3a3a, pants: 0x6a6258, shoes: 0x2c241c, hair: 0xeeeae4, skin: 0xf1c6a8, accent: 0x2a2c30 },
    { shirt: 0x6a6e74, pants: 0x3e4650, shoes: 0x1c1e22, hair: 0xb8bec6, skin: 0xc68642, accent: 0x1c1e22 },
  ],
  child: [
    { shirt: 0xf2c14e, pants: 0x3d6fbf, shoes: 0xe23b3b, hair: 0x6b4428, skin: 0xf3d2b5, accent: 0x2f6fbe },
    { shirt: 0xe23b3b, pants: 0x2e3440, shoes: 0x2f6fbe, hair: 0x2a211c, skin: 0xe0a882, accent: 0xf2c14e },
    { shirt: 0x3aaa5a, pants: 0x4a4038, shoes: 0xf4f4f4, hair: 0x8a5a32, skin: 0xf1c6a8, accent: 0xe45b9a },
    { shirt: 0x2f6fbe, pants: 0xe07a2f, shoes: 0x2aa8a0, hair: 0x3a2418, skin: 0xc68642, accent: 0xf4f4f4 },
    { shirt: 0xf4f4f4, pants: 0x2f7a45, shoes: 0xe45b9a, hair: 0x1c1c1c, skin: 0x8d5524, accent: 0xe23b3b },
  ],
};

const KINDS: SpectatorKind[] = ['man', 'woman', 'elder', 'child'];
const WOOD = 0x8a6a42;
const EYE = 0x1c1916;
const TOOTH = 0xf7f4ee;

export function spectatorKindCount(): number {
  return KINDS.length;
}

export function spectatorLookCount(kind: SpectatorKind): number {
  return SPECTATOR_LOOKS[kind].length;
}

/** Pick a figure. Men and women are the most common people at the roadside. */
export function pickSpectator(rng: () => number): { kind: SpectatorKind; look: number } {
  const roll = rng();
  const kind: SpectatorKind = roll < 0.34 ? 'man' : roll < 0.66 ? 'woman' : roll < 0.84 ? 'elder' : 'child';
  return { kind, look: Math.floor(rng() * SPECTATOR_LOOKS[kind].length) };
}

export function buildSpectator(kind: SpectatorKind, look: number): THREE.BufferGeometry {
  const palette = SPECTATOR_LOOKS[kind][look] ?? SPECTATOR_LOOKS[kind][0];
  if (kind === 'woman') return woman(palette);
  if (kind === 'elder') return elder(palette);
  if (kind === 'child') return child(palette);
  return man(palette);
}

function shade(hex: number, k: number): number {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  c.r = Math.min(c.r, 1);
  c.g = Math.min(c.g, 1);
  c.b = Math.min(c.b, 1);
  return c.getHex();
}

function tube(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r0: number, r1: number, color: number, sides = 6): THREE.BufferGeometry {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 0.001;
  const g = new THREE.CylinderGeometry(r1, r0, len, sides);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len)));
  g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  return colored(g, color);
}

/** Tapered closed tube. rx is depth (+X), rz is width (+Z). */
function tapered(y0: number, y1: number, bottom: [number, number], top: [number, number], color: number, sides = 8, exp = 3): THREE.BufferGeometry {
  const ring = (y: number, rx: number, rz: number) => outline(sides, exp).map(([a, b]) => v3(a * rx, y, b * rz));
  return colored(loft([ring(y0, bottom[0], bottom[1]), ring(y1, top[0], top[1])]), color);
}

function at(g: THREE.BufferGeometry, x: number, z: number): THREE.BufferGeometry {
  g.translate(x, 0, z);
  return g;
}

function sphere(r: number, x: number, y: number, z: number, color: number, w = 8, h = 6): THREE.BufferGeometry {
  return colored(new THREE.SphereGeometry(r, w, h).translate(x, y, z), color);
}

/** Faceted hair shell. The predicate is in head-local space, before the head is moved up. */
function shell(r: number, y: number, color: number, keep: (x: number, y: number, z: number) => boolean, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 8, 6);
  g.scale(sx, sy, sz);
  const index = g.getIndex();
  const pos = g.getAttribute('position');
  const next: number[] = [];
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
      const yy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
      const z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      if (keep(x, yy, z)) next.push(a, b, c);
    }
    g.setIndex(next);
  }
  g.translate(0, y, 0);
  return colored(g, color);
}

function pointOnHead(headY: number, r: number, dy: number, dz: number, proud: number): [number, number, number] {
  const x = Math.sqrt(Math.max(r * r - dy * dy - dz * dz, 0.0004));
  const len = Math.hypot(x, dy, dz) || 1;
  const k = (r + proud) / len;
  return [x * k, headY + dy * k, dz * k];
}

function feature(headY: number, r: number, dy: number, dz: number, proud: number, depth: number, height: number, width: number, color: number): THREE.BufferGeometry {
  const [x, y, z] = pointOnHead(headY, r, dy, dz, proud);
  return colored(new THREE.BoxGeometry(depth, height, width).translate(x, y, z), color);
}

function face(headY: number, r: number, skin: number, hair: number, smile: number): THREE.BufferGeometry[] {
  const brow = shade(hair, 0.4);
  const nose = new THREE.ConeGeometry(r * 0.13, r * 0.28, 4);
  nose.rotateZ(-Math.PI / 2);
  const [nx, ny, nz] = pointOnHead(headY, r, -r * 0.06, 0, r * 0.12);
  nose.translate(nx, ny, nz);
  return [
    feature(headY, r, r * 0.16, r * 0.28, 0.006, 0.012, r * 0.16, r * 0.26, EYE),
    feature(headY, r, r * 0.16, -r * 0.28, 0.006, 0.012, r * 0.16, r * 0.26, EYE),
    feature(headY, r, r * 0.34, r * 0.3, 0.004, 0.01, r * 0.07, r * 0.2, brow),
    feature(headY, r, r * 0.34, -r * 0.3, 0.004, 0.01, r * 0.07, r * 0.2, brow),
    colored(nose, shade(skin, 0.9)),
    feature(headY, r, -r * 0.38, 0, 0.006, 0.01, r * 0.1, r * smile, 0x3a2420),
    feature(headY, r, -r * 0.34, 0, 0.012, 0.008, r * 0.07, r * smile * 0.72, TOOTH),
  ];
}

function shoe(z: number, color: number, sole: number, length = 0.22, width = 0.09): THREE.BufferGeometry[] {
  const upper = new THREE.BoxGeometry(length, 0.05, width);
  const p = upper.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    if (p.getX(i) > length * 0.12) {
      p.setY(i, Math.min(p.getY(i), 0.002));
      p.setZ(i, p.getZ(i) * 0.75);
    }
  }
  upper.translate(length * 0.06, 0.042, z);
  const soleG = new THREE.BoxGeometry(length * 0.92, 0.016, width * 0.9).translate(length * 0.04, 0.01, z);
  return [colored(upper, color), colored(soleG, sole)];
}

function fist(x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.038, 5, 4);
  g.scale(0.85, 1.05, 0.9);
  g.translate(x, y, z);
  return colored(g, color);
}

/** Open polo collar. The front faces are left out so the neck shows in the V. */
function polo(y: number, color: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.08, 0.052, 0.055, 8, 1, true);
  const index = g.getIndex();
  const pos = g.getAttribute('position');
  const next: number[] = [];
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
      if (x > 0.02) continue;
      next.push(a, b, c);
    }
    g.setIndex(next);
  }
  g.translate(0, y, 0);
  return colored(g, color);
}

/** Shirt or sweater: waist, chest, shoulders, then a narrower neckline. */
function shirt(color: number, waistY: number, shoulderY: number, neckY: number, waist: [number, number], shoulder: [number, number], neck: [number, number], exp = 3): THREE.BufferGeometry {
  const midY = (waistY + shoulderY) / 2;
  const ring = (y: number, rx: number, rz: number) => outline(8, exp).map(([a, b]) => v3(a * rx, y, b * rz));
  return colored(loft([
    ring(waistY, waist[0], waist[1]),
    ring(midY, (waist[0] + shoulder[0]) / 2, (waist[1] + shoulder[1]) / 2),
    ring(shoulderY, shoulder[0], shoulder[1]),
    ring(neckY, neck[0], neck[1]),
  ]), color);
}

function banner(x: number, y: number, z: number, width: number, height: number, color: number, yaw = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.01, height, Math.abs(width));
  g.translate(0, height / 2, Math.sign(width || 1) * Math.abs(width) / 2);
  if (yaw) g.rotateY(yaw);
  g.translate(x, y, z);
  return colored(g, color);
}

function foldedFlag(x: number, y: number, z: number, dir: number, color: number): THREE.BufferGeometry[] {
  const w = 0.1 * dir;
  return [
    banner(x, y, z, w, 0.12, color, dir > 0 ? -0.2 : 0.2),
    banner(x + 0.012, y + 0.004, z + w * 0.8, w * 0.95, 0.11, shade(color, 0.78), dir > 0 ? -0.55 : 0.55),
  ];
}

function checkerColor(accent: number): number {
  const c = new THREE.Color(accent);
  if (c.g > 0.55 && c.r > 0.55 && c.b < 0.45) return 0x2a62c4;
  return 0xf2c14e;
}

function pennant(x: number, y: number, z: number, a: number, b: number): THREE.BufferGeometry[] {
  const A: [number, number, number] = [x, y, z];
  const B: [number, number, number] = [x + 0.02, y + 0.17, z - 0.015];
  const C: [number, number, number] = [x + 0.035, y + 0.045, z - 0.2];
  const G: [number, number, number] = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
  const mid = (p: [number, number, number], q: [number, number, number]): [number, number, number] => [
    (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2,
  ];
  const AB = mid(A, B);
  const BC = mid(B, C);
  const CA = mid(C, A);
  const tri = (p: [number, number, number], q: [number, number, number], r: [number, number, number], color: number) => {
    const s = 0.008;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2],
      p[0] + s, p[1], p[2], r[0] + s, r[1], r[2], q[0] + s, q[1], q[2],
    ], 3));
    return colored(g, color);
  };
  return [
    tri(A, AB, G, a), tri(AB, B, G, b), tri(B, BC, G, a),
    tri(BC, C, G, b), tri(C, CA, G, a), tri(CA, A, G, b),
  ];
}

function leg(z: number, y0: number, y1: number, ankle: number, hip: number, color: number): THREE.BufferGeometry {
  return at(tapered(y0, y1, [ankle * 0.9, ankle], [hip * 0.95, hip], color, 6, 2.15), 0.01, z);
}

function man(look: SpectatorLook): THREE.BufferGeometry {
  const headY = 1.48;
  const r = 0.125;
  const parts: THREE.BufferGeometry[] = [
    ...shoe(0.075, look.shoes, shade(look.shoes, 1.25)),
    ...shoe(-0.075, look.shoes, shade(look.shoes, 1.25)),
    leg(0.075, 0.05, 0.88, 0.052, 0.072, look.pants),
    leg(-0.075, 0.05, 0.88, 0.052, 0.072, look.pants),
    shirt(look.shirt, 0.8, 1.18, 1.34, [0.09, 0.12], [0.1, 0.16], [0.055, 0.07]),
    polo(1.33, shade(look.shirt, 0.82)),
    tube(0, 1.3, 0, 0, 1.38, 0, 0.052, 0.046, look.skin, 6),
    sphere(r, 0, headY, 0, look.skin),
    shell(r * 1.22, headY + 0.015, look.hair, (x, y) => y > 0.035 || (y > -0.04 && x < 0.02), 1.06, 0.9, 1.08),
    ...ears(headY, r, look.skin),
    ...face(headY, r, look.skin, look.hair, 0.5),
    // Short sleeve, then a skin arm straight up. Forearm stays at one distance from the spine.
    tube(0.04, 1.16, 0.13, 0.05, 1.32, 0.24, 0.05, 0.044, look.shirt),
    tube(0.05, 1.32, 0.24, 0.05, 1.52, 0.3, 0.042, 0.036, look.skin),
    tube(0.05, 1.52, 0.3, 0.05, 1.7, 0.3, 0.036, 0.032, look.skin),
    fist(0.05, 1.72, 0.3, look.skin),
    // Flag out to his left, about shoulder height.
    tube(0.05, 1.14, -0.12, 0.09, 1.04, -0.24, 0.048, 0.04, look.shirt),
    tube(0.09, 1.04, -0.24, 0.12, 1.14, -0.38, 0.036, 0.03, look.skin),
    fist(0.12, 1.16, -0.4, look.skin),
    tube(0.12, 1.14, -0.4, 0.14, 1.32, -0.52, 0.008, 0.006, WOOD, 4),
    ...foldedFlag(0.15, 1.3, -0.52, -1, look.accent),
  ];
  return merge(parts);
}

function ears(headY: number, r: number, skin: number): THREE.BufferGeometry[] {
  return [0.9, -0.9].map((z) => {
    const g = new THREE.SphereGeometry(0.02, 5, 4);
    g.scale(0.5, 0.85, 0.35);
    g.translate(0.01, headY - 0.01, z * r);
    return colored(g, shade(skin, 0.94));
  });
}

function woman(look: SpectatorLook): THREE.BufferGeometry {
  const headY = 1.4;
  const r = 0.112;
  const parts: THREE.BufferGeometry[] = [
    ...shoe(0.07, look.shoes, 0xf7f7f7, 0.18, 0.072),
    ...shoe(-0.07, look.shoes, 0xf7f7f7, 0.18, 0.072),
    tube(0.01, 0.045, 0.07, 0.01, 0.12, 0.07, 0.038, 0.034, 0xf7f7f7),
    tube(0.01, 0.045, -0.07, 0.01, 0.12, -0.07, 0.038, 0.034, 0xf7f7f7),
    tube(0.01, 0.1, 0.07, 0.01, 0.52, 0.07, 0.04, 0.044, look.skin),
    tube(0.01, 0.1, -0.07, 0.01, 0.52, -0.07, 0.04, 0.044, look.skin),
    at(tapered(0.48, 0.68, [0.048, 0.052], [0.055, 0.062], look.pants, 6, 2.4), 0.01, 0.07),
    at(tapered(0.48, 0.68, [0.048, 0.052], [0.055, 0.062], look.pants, 6, 2.4), 0.01, -0.07),
    shirt(look.shirt, 0.64, 1.08, 1.24, [0.075, 0.105], [0.09, 0.145], [0.05, 0.065]),
    polo(1.23, shade(look.shirt, 0.82)),
    tube(0, 1.22, 0, 0, 1.3, 0, 0.044, 0.04, look.skin, 6),
    sphere(r, 0, headY, 0, look.skin),
    shell(0.13, headY, look.hair, (x, y, z) => {
      const faceOpen = x > -0.005 && y < 0.075 && Math.abs(z) < 0.068;
      return !faceOpen && y > -0.075;
    }, 0.98, 1.04, 1.06),
    ...face(headY, r, look.skin, look.hair, 0.48),
    // Hand on her hip. The elbow stays inside the cheer radius.
    tube(0.04, 1.08, 0.12, 0.08, 0.96, 0.2, 0.04, 0.034, look.shirt),
    tube(0.08, 0.96, 0.2, 0.1, 0.88, 0.1, 0.032, 0.028, look.skin),
    fist(0.1, 0.86, 0.08, look.skin),
    // Pennant up beside her head.
    tube(0.04, 1.08, -0.11, 0.05, 1.26, -0.22, 0.038, 0.032, look.shirt),
    tube(0.05, 1.26, -0.22, 0.06, 1.44, -0.32, 0.03, 0.026, look.skin),
    fist(0.065, 1.46, -0.34, look.skin),
    tube(0.07, 1.44, -0.34, 0.09, 1.6, -0.42, 0.007, 0.006, WOOD, 4),
    ...pennant(0.1, 1.56, -0.42, look.accent, checkerColor(look.accent)),
  ];
  return merge(parts);
}

function elder(look: SpectatorLook): THREE.BufferGeometry {
  const headY = 1.46;
  const r = 0.12;
  const cap = shade(look.hair, 0.62);
  const lens = new THREE.CylinderGeometry(0.024, 0.028, 0.045, 8);
  lens.rotateZ(-Math.PI / 2);
  lens.translate(0.22, 1.05, 0);
  const glass = new THREE.CylinderGeometry(0.016, 0.016, 0.01, 8);
  glass.rotateZ(-Math.PI / 2);
  glass.translate(0.246, 1.05, 0);
  const beard = new THREE.SphereGeometry(0.062, 6, 5);
  beard.scale(0.75, 0.65, 1.3);
  beard.translate(0.05, headY - 0.075, 0);
  const ring = (z: number) => {
    const g = new THREE.TorusGeometry(0.026, 0.0032, 4, 8);
    g.rotateY(Math.PI / 2);
    const [x, y] = pointOnHead(headY, r, r * 0.1, z, 0.01);
    g.translate(x, y, z);
    return colored(g, 0x2a2e32);
  };
  const parts: THREE.BufferGeometry[] = [
    ...shoe(0.078, look.shoes, shade(look.shoes, 1.15)),
    ...shoe(-0.078, look.shoes, shade(look.shoes, 1.15)),
    leg(0.078, 0.05, 0.88, 0.052, 0.074, look.pants),
    leg(-0.078, 0.05, 0.88, 0.052, 0.074, look.pants),
    shirt(look.shirt, 0.8, 1.16, 1.32, [0.095, 0.13], [0.11, 0.165], [0.06, 0.075], 2.5),
    tube(0, 1.28, 0, 0, 1.36, 0, 0.05, 0.046, look.skin, 6),
    sphere(r, 0, headY, 0, look.skin),
    shell(0.125, headY, look.hair, (x, y, z) => y < 0.015 && y > -0.07 && Math.abs(z) > 0.04 && x < 0.06),
    ...ears(headY, r, look.skin),
    ...face(headY, r, look.skin, look.hair, 0.36),
    colored(beard, look.hair),
    feature(headY, r, -r * 0.18, 0, 0.012, 0.012, 0.016, 0.065, look.hair),
    ring(0.032),
    ring(-0.032),
    feature(headY, r, r * 0.1, 0, 0.014, 0.008, 0.008, 0.028, 0x2a2e32),
    colored(new THREE.CylinderGeometry(0.125, 0.135, 0.05, 8).translate(-0.005, headY + r - 0.01, 0), cap),
    colored(new THREE.BoxGeometry(0.1, 0.012, 0.15).translate(0.11, headY + 0.04, 0), shade(cap, 0.85)),
    // Arms stay close to the chest so the cheer does not pull the camera away.
    tube(0.04, 1.14, 0.13, 0.12, 1.04, 0.08, 0.048, 0.04, look.shirt),
    tube(0.12, 1.04, 0.08, 0.16, 1.02, 0.04, 0.036, 0.03, look.skin),
    fist(0.17, 1.02, 0.045, look.skin),
    tube(0.04, 1.14, -0.13, 0.12, 1.04, -0.08, 0.048, 0.04, look.shirt),
    tube(0.12, 1.04, -0.08, 0.16, 1.02, -0.04, 0.036, 0.03, look.skin),
    fist(0.17, 1.02, -0.045, look.skin),
    colored(new THREE.BoxGeometry(0.05, 0.065, 0.08).translate(0.19, 1.05, 0), look.accent),
    colored(lens, 0x1a1e22),
    colored(glass, 0x9fd0dc),
    colored(new THREE.BoxGeometry(0.028, 0.018, 0.028).translate(0.18, 1.095, 0), 0x4a5058),
    tube(0.02, 1.28, -0.06, 0.0, 1.36, -0.02, 0.007, 0.006, shade(look.shirt, 0.5), 4),
    tube(0.0, 1.36, -0.02, 0.16, 1.1, -0.01, 0.007, 0.006, shade(look.shirt, 0.5), 4),
  ];
  return merge(parts);
}

function curl(x: number, y: number, z: number, r: number, color: number): THREE.BufferGeometry {
  return colored(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z), color);
}

function miniBike(x: number, y: number): THREE.BufferGeometry[] {
  const wheel = (z: number) => colored(new THREE.TorusGeometry(0.016, 0.0035, 4, 8).rotateY(Math.PI / 2).translate(x, y, z), 0x1a1c20);
  return [
    wheel(-0.026),
    wheel(0.026),
    colored(new THREE.BoxGeometry(0.006, 0.005, 0.036).translate(x, y + 0.006, 0), 0x1a1c20),
    colored(new THREE.BoxGeometry(0.006, 0.02, 0.006).translate(x, y + 0.016, -0.006), 0x2f9e4f),
    colored(new THREE.IcosahedronGeometry(0.008, 0).translate(x, y + 0.03, -0.006), 0xf3d2b5),
  ];
}

function child(look: SpectatorLook): THREE.BufferGeometry {
  const headY = 0.92;
  const r = 0.11;
  const parts: THREE.BufferGeometry[] = [
    ...shoe(0.05, look.shoes, 0xf7f7f7, 0.14, 0.064),
    ...shoe(-0.05, look.accent, 0xf7f7f7, 0.14, 0.064),
    colored(new THREE.BoxGeometry(0.045, 0.01, 0.066).translate(0.025, 0.058, 0.05), 0xf7f7f7),
    colored(new THREE.BoxGeometry(0.045, 0.01, 0.066).translate(0.025, 0.058, -0.05), 0xf7f7f7),
    tube(0, 0.04, 0.05, 0, 0.32, 0.05, 0.034, 0.038, look.skin),
    tube(0, 0.04, -0.05, 0, 0.32, -0.05, 0.034, 0.038, look.skin),
    at(tapered(0.28, 0.44, [0.04, 0.046], [0.048, 0.054], look.pants, 6, 2.4), 0, 0.05),
    at(tapered(0.28, 0.44, [0.04, 0.046], [0.048, 0.054], look.pants, 6, 2.4), 0, -0.05),
    shirt(look.shirt, 0.4, 0.66, 0.76, [0.065, 0.09], [0.075, 0.115], [0.045, 0.06], 2.8),
    ...miniBike(0.085, 0.56),
    tube(0, 0.74, 0, 0, 0.82, 0, 0.038, 0.034, look.skin, 6),
    sphere(r, 0, headY, 0, look.skin),
    ...face(headY, r, look.skin, look.hair, 0.58),
    curl(0.015, headY + 0.1, 0, 0.05, look.hair),
    curl(0.03, headY + 0.07, 0.065, 0.042, look.hair),
    curl(0.03, headY + 0.07, -0.065, 0.042, look.hair),
    curl(-0.01, headY + 0.085, 0.05, 0.04, look.hair),
    curl(-0.01, headY + 0.085, -0.05, 0.04, look.hair),
    curl(-0.035, headY + 0.04, 0.015, 0.038, look.hair),
    curl(0.04, headY + 0.09, 0.03, 0.036, look.hair),
    curl(0.04, headY + 0.09, -0.03, 0.036, look.hair),
    curl(0, headY + 0.045, 0.08, 0.034, look.hair),
    curl(0, headY + 0.045, -0.08, 0.034, look.hair),
    // Pointing arm, his left, just past the curls.
    tube(0.02, 0.66, -0.08, 0.03, 0.84, -0.2, 0.032, 0.028, look.skin),
    tube(0.03, 0.84, -0.2, 0.04, 1.0, -0.32, 0.026, 0.022, look.skin),
    fist(0.04, 1.02, -0.34, look.skin),
    tube(0.045, 1.04, -0.36, 0.05, 1.12, -0.4, 0.007, 0.005, look.skin, 4),
    // White flag, his right, held out at shoulder height.
    tube(0.02, 0.64, 0.08, 0.04, 0.72, 0.16, 0.032, 0.028, look.skin),
    tube(0.04, 0.72, 0.16, 0.05, 0.8, 0.28, 0.026, 0.022, look.skin),
    fist(0.05, 0.82, 0.3, look.skin),
    tube(0.055, 0.8, 0.3, 0.065, 0.94, 0.38, 0.006, 0.005, WOOD, 4),
    ...foldedFlag(0.075, 0.92, 0.38, 1, 0xf7f7f7),
  ];
  return merge(parts);
}
