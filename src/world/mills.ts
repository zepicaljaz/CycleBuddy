import * as THREE from 'three';
import { prepare, type Prepared } from './batch';
import { paint, tube, v3 } from './geometry';
import type { MatKind, Model } from './materials';

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

const cached = new Map<string, Prepared>();
function once(key: string, build: () => Model): Prepared {
  let p = cached.get(key);
  if (!p) cached.set(key, (p = prepare(build())));
  return p;
}

const PLASTER = 0xefe9dd;
const STONE = 0xb9ae9b;
const WOOD = 0x6e4c30;
const DARK_WOOD = 0x4a3422;
const THATCH = 0x6f5a3c;

/** Where the sails turn, in tower coordinates. The sails face +x. */
export const WINDMILL_HUB = new THREE.Vector3(2.95, 12.4, 0);

/** Tower mill: tapered plaster tower on a stone base, thatched cap, windshaft and tail pole. */
export function windmillTower(variant = 0): Prepared {
  return once(`windmill${variant}`, () => {
    const wall = variant % 2 ? STONE : PLASTER;
    const parts: Model = [];
    const P = (g: THREE.BufferGeometry, c: number, mat: MatKind = 'rough', crease = 0.6, jitter = 0) => parts.push({ geom: paint(g, c, { crease, jitter }), mat });
    P(new THREE.CylinderGeometry(3.45, 3.6, 1.2, 20).translate(0, -0.3, 0), 0x9d937f, 'rough', 0.9, 0.05);
    P(new THREE.CylinderGeometry(2.4, 3.3, 11, 20, 3).translate(0, 5.8, 0), wall, 'rough', 0.9, 0.025);
    P(new THREE.CylinderGeometry(2.95, 3.0, 0.3, 20).translate(0, 4.2, 0), 0x9d937f, 'rough', 0.9);
    // Arched door and small windows up the tower.
    const radiusAt = (y: number) => 3.3 - ((y - 0.3) / 11) * 0.9;
    const door = (a: number) => {
      const r = radiusAt(1.2);
      P(box(-0.06, 0.06, 0.2, 2.3, -0.6, 0.6).translate(r - 0.02, 0, 0).rotateY(a), 0x5a3b26, 'rough');
      P(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(r - 0.02, 2.3, 0).rotateY(a), 0x5a3b26, 'rough');
      P(box(-0.08, 0.08, 2.25, 2.45, -0.8, 0.8).translate(r, 0.7, 0).rotateY(a), 0x9d937f, 'rough');
    };
    door(Math.PI);
    for (const [y, a] of [[3.0, 0.9], [6.0, -1.6], [8.4, 2.2], [9.4, 0.4], [6.6, 2.9]] as [number, number][]) {
      const r = radiusAt(y);
      P(box(-0.06, 0.06, y - 0.45, y + 0.45, -0.32, 0.32).translate(r - 0.02, 0, 0).rotateY(a), 0x2c3540, 'glass');
      P(box(-0.09, 0.09, y - 0.55, y - 0.45, -0.4, 0.4).translate(r, 0, 0).rotateY(a), 0xd8d2c4, 'rough');
    }
    // Cap: curb ring, thatched dome, finial.
    P(new THREE.CylinderGeometry(2.6, 2.55, 0.35, 20).translate(0, 11.45, 0), DARK_WOOD, 'rough', 0.9);
    P(new THREE.SphereGeometry(2.7, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.08, 1.05, 1).translate(0, 11.6, 0), THATCH, 'rough', 0.9, 0.06);
    P(new THREE.CylinderGeometry(0.05, 0.14, 0.9, 8).translate(0, 14.75, 0), DARK_WOOD, 'rough');
    P(new THREE.SphereGeometry(0.18, 8, 6).translate(0, 15.25, 0), 0xb8a46a, 'metal');
    // Windshaft out to the hub, and the tail pole down to the ground at the back.
    P(tube(v3(1.6, WINDMILL_HUB.y, 0), v3(WINDMILL_HUB.x - 0.1, WINDMILL_HUB.y, 0), 0.24, 0.24, 10), DARK_WOOD, 'rough', 0.8);
    P(tube(v3(-2.2, 11.5, 0), v3(-7.2, 0.9, 0), 0.14, 0.14, 6), WOOD, 'rough', 0.8);
    for (const z of [-1, 1]) P(tube(v3(-2.3, 11.6, z * 1.1), v3(-5.2, 5.2, z * 0.12), 0.07, 0.07, 6), WOOD, 'rough', 0.8);
    P(new THREE.TorusGeometry(0.75, 0.06, 6, 14).translate(-7.0, 1.0, 0), WOOD, 'rough', 0.8);
    return parts;
  });
}

/** Four sails round the hub at the origin, turning about +x. */
export function windmillSails(): Prepared {
  return once('sails', () => {
    const parts: Model = [];
    const P = (g: THREE.BufferGeometry, c: number, mat: MatKind = 'rough', crease = 0) => parts.push({ geom: paint(g, c, { crease }), mat });
    P(new THREE.CylinderGeometry(0.42, 0.42, 0.55, 12).rotateZ(Math.PI / 2), DARK_WOOD, 'rough', 0.8);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const turn = (g: THREE.BufferGeometry) => g.rotateX(a);
      // Stock along +y, lattice on one side of it, sailcloth behind the bars.
      P(turn(box(0.1, 0.36, 0, 9.8, -0.14, 0.14)), WOOD);
      for (const z of [0.3, 1.95]) P(turn(box(0.12, 0.26, 1.5, 9.7, z - 0.05, z + 0.05)), 0xd8cdb4);
      for (let y = 1.6; y < 9.8; y += 0.62) P(turn(box(0.12, 0.24, y - 0.04, y + 0.04, 0.12, 1.98)), 0xd8cdb4);
      const cloth = new THREE.PlaneGeometry(1.7, 7.4).rotateY(Math.PI / 2).translate(0.08, 5.65, 1.12);
      parts.push({ geom: paint(turn(cloth), 0xe9e2cf, { crease: 0 }), mat: 'cloth' });
    }
    return parts;
  });
}

/** Overshot water wheel at the origin, axle along z. */
export function waterWheel(): Prepared {
  return once('waterwheel', () => {
    const parts: Model = [];
    const P = (g: THREE.BufferGeometry, c: number, mat: MatKind = 'rough', crease = 0.6) => parts.push({ geom: paint(g, c, { crease }), mat });
    const R = 2.5;
    for (const z of [-0.55, 0.55]) {
      P(new THREE.TorusGeometry(R, 0.08, 6, 36).translate(0, 0, z), DARK_WOOD, 'rough', 0.9);
      P(new THREE.TorusGeometry(R - 0.55, 0.06, 6, 30).translate(0, 0, z), DARK_WOOD, 'rough', 0.9);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        P(box(0, R, -0.06, 0.06, z - 0.06, z + 0.06).rotateZ(a), WOOD, 'rough', 0);
      }
    }
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      P(box(R - 0.6, R - 0.02, -0.035, 0.035, -0.58, 0.58).rotateZ(a), WOOD, 'rough', 0);
      P(box(R - 0.62, R - 0.56, -0.2, 0.2, -0.58, 0.58).rotateZ(a), 0x5a3f28, 'rough', 0);
    }
    P(new THREE.CylinderGeometry(0.35, 0.35, 1.3, 12).rotateX(Math.PI / 2), DARK_WOOD, 'rough', 0.8);
    P(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 10).rotateX(Math.PI / 2).translate(0, 0, -0.5), 0x3b3c3f, 'metal', 0.8);
    return parts;
  });
}

/** Wooden flume on posts that feeds the top of the wheel, running along +x from above the axle. */
export function flume(length: number, height: number): Prepared {
  return once(`flume${length.toFixed(1)}:${height.toFixed(1)}`, () => {
    const parts: Model = [];
    const P = (g: THREE.BufferGeometry, c: number) => parts.push({ geom: paint(g, c, { crease: 0 }), mat: 'rough' });
    P(box(-0.3, length, height, height + 0.08, -0.45, 0.45), WOOD);
    for (const z of [-0.45, 0.45]) P(box(-0.3, length, height, height + 0.45, z - 0.04, z + 0.04), WOOD);
    P(box(-0.3, length, height + 0.08, height + 0.3, -0.41, 0.41), 0x3f6f86);
    for (let x = 1.5; x < length; x += 2.2) for (const z of [-0.4, 0.4]) P(box(x - 0.08, x + 0.08, -1.5, height, z - 0.08, z + 0.08), DARK_WOOD);
    return parts;
  });
}
