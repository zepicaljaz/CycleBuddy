import * as THREE from 'three';
import { prepare, type Prepared } from './batch';
import { loft, outline, paint, placement, roundedBox, surface, tube, v3 } from './geometry';
import { material, type MatKind, type Model } from './materials';

export interface TractorScheme {
  body: number;
  rim: number;
  roof: number;
}

/** Paint schemes in the spirit of the big farm brands. */
export const TRACTOR_SCHEMES: TractorScheme[] = [
  { body: 0x2f7a35, rim: 0xf2c21b, roof: 0x2f7a35 },
  { body: 0xb3261e, rim: 0x8e9196, roof: 0xf0f0ee },
  { body: 0x1f4f9e, rim: 0xd0d2d6, roof: 0xf0f0ee },
  { body: 0xe06a1a, rim: 0x2e2f33, roof: 0x2a2b2e },
];

/** Wheel sizes and where they sit: +x forward, y up, ground at 0. */
export const TRACTOR = { rearR: 0.8, rearW: 0.5, rearX: -0.85, rearZ: 0.86, frontR: 0.52, frontW: 0.34, frontX: 1.5, frontZ: 0.74 };

const DARK = 0x2a2b2e;
const TYRE = 0x1c1c1e;
const GLASS = 0x2a3a48;

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Flip a geometry's triangles if its first face does not point along `out` at that face. */
function oriented(g: THREE.BufferGeometry, out: (p: THREE.Vector3) => THREE.Vector3): THREE.BufferGeometry {
  const idx = g.getIndex()!;
  const p = g.getAttribute('position');
  const a = new THREE.Vector3().fromBufferAttribute(p, idx.getX(0));
  const b = new THREE.Vector3().fromBufferAttribute(p, idx.getX(1));
  const c = new THREE.Vector3().fromBufferAttribute(p, idx.getX(2));
  const n = b.clone().sub(a).cross(c.clone().sub(a));
  if (n.dot(out(a)) < 0) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  }
  return g;
}

/** Tyre with chevron lugs, dished rim and hub. Axle along z, centred on the origin, rim face toward +z. */
function wheel(r: number, w: number, rimColor: number, lugs: number): Model {
  const inner = r * 0.62;
  const sh = Math.min(0.09, w * 0.22);
  const prof: THREE.Vector2[] = [new THREE.Vector2(inner, -w / 2)];
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    prof.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, -w / 2 + sh + Math.sin(a) * sh));
  }
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    prof.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh));
  }
  prof.push(new THREE.Vector2(inner, w / 2));
  const tyre = new THREE.LatheGeometry(prof, 36).rotateX(Math.PI / 2);
  const lugGeoms: THREE.BufferGeometry[] = [];
  for (let i = 0; i < lugs; i++) {
    for (const side of [-1, 1]) {
      const a = ((i + (side > 0 ? 0.5 : 0)) / lugs) * Math.PI * 2;
      const g = new THREE.BoxGeometry(0.06, 0.09, w * 0.46).rotateX(side * 0.55).translate(r + 0.012, 0, side * w * 0.24).rotateZ(a);
      lugGeoms.push(g);
    }
  }
  const rim = new THREE.CylinderGeometry(inner + 0.005, inner + 0.005, w * 0.7, 28).rotateX(Math.PI / 2);
  const disc = new THREE.CylinderGeometry(inner * 0.9, inner * 0.9, w * 0.5, 24).rotateX(Math.PI / 2).translate(0, 0, w * 0.06);
  const hub = new THREE.CylinderGeometry(r * 0.2, r * 0.24, w * 0.3, 14).rotateX(Math.PI / 2).translate(0, 0, w * 0.4);
  const nuts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    nuts.push(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, w * 0.33));
  }
  return [
    { geom: paint(tyre, TYRE, { crease: 0.9 }), mat: 'rubber' },
    ...lugGeoms.map((g) => ({ geom: paint(g, TYRE, { crease: 0 }), mat: 'rubber' as const })),
    { geom: paint(rim, rimColor, { crease: 0.7 }), mat: 'paint' },
    { geom: paint(disc, rimColor, { crease: 0.7 }), mat: 'paint' },
    { geom: paint(hub, 0x55575c, { crease: 0.7 }), mat: 'metal' },
    ...nuts.map((g) => ({ geom: paint(g, 0x8a8d92, { crease: 0 }), mat: 'metal' as const })),
  ];
}

/** Hood, cab, fenders, exhaust and linkage. */
function body(sc: TractorScheme): Model {
  const parts: Model = [];
  const P = (g: THREE.BufferGeometry, c: number | THREE.Color, mat: MatKind = 'carpaint', crease = 0.6) => parts.push({ geom: paint(g, c, { crease }), mat });
  const T = TRACTOR;

  // Frame and engine block under the hood.
  P(box(-1.25, 2.08, 0.42, 0.8, -0.34, 0.34), DARK, 'metal');
  P(box(0.2, 1.95, 0.72, 1.0, -0.31, 0.31), 0x3a3b3f, 'metal');

  // Hood: a rounded block that drops and narrows toward the grille.
  const ring = (x: number, hw: number, y0: number, y1: number) =>
    outline(20, 5).map(([a, b]) => v3(x, (y0 + y1) / 2 + (b * (y1 - y0)) / 2, a * hw));
  P(loft([ring(0.12, 0.44, 0.92, 1.68), ring(1.0, 0.43, 0.92, 1.66), ring(1.75, 0.4, 0.94, 1.6), ring(2.12, 0.35, 0.96, 1.5)]), sc.body, 'carpaint', 0.9);
  // Side vents and the grille with its slats and lamps.
  for (const z of [-1, 1]) {
    for (let i = 0; i < 4; i++) P(box(1.2 + i * 0.12, 1.27 + i * 0.12, 1.12, 1.4, z * 0.4 - 0.012, z * 0.4 + 0.012).translate(0, 0, z * 0.012), 0x1a1b1d, 'gloss');
  }
  P(box(2.1, 2.16, 0.99, 1.46, -0.29, 0.29), 0x141416, 'gloss');
  for (let i = 0; i < 5; i++) P(box(2.15, 2.18, 1.03 + i * 0.075, 1.055 + i * 0.075, -0.27, 0.27), 0x4a4c51, 'metal');
  for (const z of [-0.19, 0.19]) P(box(2.14, 2.19, 1.36, 1.45, z - 0.07, z + 0.07), 0xe4ebf2, 'chrome');

  // Front weights and axle.
  P(box(2.1, 2.48, 0.5, 0.94, -0.36, 0.36), 0x2c2d30, 'metal');
  for (let i = 0; i < 7; i++) P(box(2.46, 2.58, 0.53, 0.91, -0.34 + i * 0.098, -0.27 + i * 0.098), 0x3c3d41, 'metal', 0);
  P(box(1.38, 1.62, 0.38, 0.56, -0.6, 0.6), DARK, 'metal');

  // Cab: platform, pillars, glass all round, roof with lamps and a beacon.
  const c0 = -1.32;
  const c1 = 0.16;
  const y1 = 2.72;
  const hw = 0.66;
  P(box(c0 - 0.06, c1 + 0.06, 1.12, 1.3, -hw - 0.05, hw + 0.05), DARK, 'metal');
  P(box(c1 - 0.02, c1 + 0.06, 1.3, 1.62, -hw, hw), sc.body, 'carpaint');
  for (const x of [c0, c1]) for (const z of [-hw, hw]) P(box(x - 0.04, x + 0.04, 1.3, y1, z - 0.04, z + 0.04), 0x1e1f22, 'gloss');
  P(box(c1 - 0.012, c1 + 0.012, 1.62, y1 - 0.06, -hw + 0.04, hw - 0.04), GLASS, 'glass');
  P(box(c0 - 0.012, c0 + 0.012, 1.34, y1 - 0.06, -hw + 0.04, hw - 0.04), GLASS, 'glass');
  for (const z of [-hw, hw]) {
    P(box(c0 + 0.04, c1 - 0.04, 1.34, y1 - 0.06, z - 0.012, z + 0.012), GLASS, 'glass');
    P(box(c0 + 0.04, c1 - 0.04, 1.3, 1.36, z - 0.03, z + 0.03), 0x1e1f22, 'gloss');
  }
  P(roundedBox(c1 - c0 + 0.34, 0.16, 2 * hw + 0.2, 0.07).translate((c0 + c1) / 2, y1 + 0.07, 0), sc.roof, 'carpaint', 0.8);
  for (const x of [c0 - 0.1, c1 + 0.12]) for (const z of [-0.45, 0.45]) P(box(x - 0.05, x + 0.05, y1 + 0.02, y1 + 0.12, z - 0.07, z + 0.07), 0xe4ebf2, 'chrome');
  P(new THREE.CylinderGeometry(0.065, 0.075, 0.13, 10).translate(c0 + 0.35, y1 + 0.21, -0.42), 0xf39a1e, 'gloss');
  // Seat, steering wheel and column seen through the glass.
  P(box(c0 + 0.25, c0 + 0.7, 1.3, 1.78, -0.24, 0.24), 0x26272a, 'rubber');
  P(box(c0 + 0.16, c0 + 0.28, 1.6, 2.2, -0.24, 0.24), 0x26272a, 'rubber');
  P(new THREE.TorusGeometry(0.18, 0.018, 6, 20).rotateX(Math.PI / 2).rotateZ(-0.55).translate(c1 - 0.42, 1.98, 0), 0x18191b, 'rubber');
  P(tube(v3(c1 - 0.12, 1.45, 0), v3(c1 - 0.4, 1.96, 0), 0.03, 0.03, 6), 0x18191b, 'metal');
  // Mirrors on arms.
  for (const z of [-1, 1]) {
    P(tube(v3(c1, 2.42, z * hw), v3(c1 + 0.12, 2.5, z * (hw + 0.36)), 0.015, 0.015, 5), 0x18191b, 'metal');
    P(box(c1 + 0.08, c1 + 0.14, 2.38, 2.62, z * (hw + 0.3), z * (hw + 0.46)), 0x18191b, 'gloss');
  }

  // Rear fenders arching over the big wheels, with a side panel each.
  for (const side of [-1, 1]) {
    const r = T.rearR + 0.08;
    const z0 = side * (T.rearZ - T.rearW / 2 - 0.05);
    const z1 = side * (T.rearZ + T.rearW / 2 + 0.06);
    const arc = (u: number) => Math.PI * (0.14 + u * 0.8);
    const centre = new THREE.Vector3(T.rearX, T.rearR, 0);
    const outer = surface(16, 1, (u, v) => {
      const a = arc(u);
      return v3(T.rearX + Math.cos(a) * r, T.rearR + Math.sin(a) * r, z0 + (z1 - z0) * v);
    });
    const under = surface(16, 1, (u, v) => {
      const a = arc(u);
      return v3(T.rearX + Math.cos(a) * (r - 0.03), T.rearR + Math.sin(a) * (r - 0.03), z0 + (z1 - z0) * v);
    });
    const away = (p: THREE.Vector3) => p.clone().sub(centre).setZ(0);
    P(oriented(outer, away), sc.body, 'carpaint', 0.9);
    P(oriented(under, (p) => away(p).negate()), 0x222326, 'matte', 0.9);
    P(box(T.rearX - 0.75, T.rearX + 0.75, 0.86, 1.36, side * 0.6, side * 0.64), sc.body, 'carpaint');
    P(box(T.rearX - r - 0.05, T.rearX - r + 0.01, T.rearR + 0.2, T.rearR + 0.3, side * T.rearZ - 0.09, side * T.rearZ + 0.09), 0xc23a2a, 'gloss');
  }

  // Tank and steps under the cab door.
  for (const side of [-1, 1]) P(box(-0.32, 0.24, 0.6, 1.1, side * 0.35, side * 0.6), sc.body, 'carpaint');
  P(box(-0.05, 0.28, 0.44, 0.48, -0.74, -0.6), DARK, 'metal');
  P(box(-0.05, 0.28, 0.78, 0.82, -0.74, -0.6), DARK, 'metal');

  // Exhaust stack and air intake beside the cab.
  P(tube(v3(0.26, 1.5, 0.3), v3(0.26, 3.02, 0.3), 0.045, 0.045, 10), 0x2a2b2d, 'metal');
  P(tube(v3(0.26, 2.9, 0.3), v3(0.26, 3.04, 0.3), 0.052, 0.052, 10), 0xb7bbc0, 'chrome');
  P(tube(v3(0.26, 1.5, -0.3), v3(0.26, 2.72, -0.3), 0.06, 0.06, 10), sc.body, 'carpaint');
  P(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 12).translate(0.26, 2.8, -0.3), 0x1e1f22, 'gloss');

  // Three-point linkage and drawbar at the back.
  for (const z of [-0.32, 0.32]) P(tube(v3(-1.2, 0.56, z), v3(-1.9, 0.44, z * 1.25), 0.04, 0.04, 6), DARK, 'metal');
  P(tube(v3(-1.2, 1.06, 0), v3(-1.82, 0.96, 0), 0.035, 0.035, 6), DARK, 'metal');
  P(box(-1.6, -1.25, 0.36, 0.44, -0.1, 0.1), DARK, 'metal');
  return parts;
}

const bodies = new Map<number, Prepared>();
const wheels = new Map<string, Prepared>();
const parked = new Map<number, Prepared>();

export function tractorBody(scheme: number): Prepared {
  const k = scheme % TRACTOR_SCHEMES.length;
  let p = bodies.get(k);
  if (!p) bodies.set(k, (p = prepare(body(TRACTOR_SCHEMES[k]))));
  return p;
}

export function tractorWheel(scheme: number, front: boolean): Prepared {
  const k = scheme % TRACTOR_SCHEMES.length;
  const key = `${k}:${front}`;
  let p = wheels.get(key);
  if (!p) {
    const T = TRACTOR;
    wheels.set(key, (p = prepare(front ? wheel(T.frontR, T.frontW, TRACTOR_SCHEMES[k].rim, 18) : wheel(T.rearR, T.rearW, TRACTOR_SCHEMES[k].rim, 22))));
  }
  return p;
}

/** Where each wheel sits and which way its rim faces. */
function wheelSpots(): { x: number; y: number; z: number; front: boolean; flip: boolean }[] {
  const T = TRACTOR;
  const out = [];
  for (const front of [true, false]) {
    for (const side of [-1, 1]) {
      out.push({ x: front ? T.frontX : T.rearX, y: front ? T.frontR : T.rearR, z: side * (front ? T.frontZ : T.rearZ), front, flip: side < 0 });
    }
  }
  return out;
}

/** A parked tractor with its wheels baked in, for static farmyards. */
export function parkedTractor(scheme: number): Prepared {
  const k = scheme % TRACTOR_SCHEMES.length;
  let p = parked.get(k);
  if (!p) {
    const groups = [...tractorBody(k).groups];
    for (const w of wheelSpots()) {
      const m = placement(w.x, w.y, w.z, w.flip ? Math.PI : 0);
      for (const g of tractorWheel(k, w.front).groups) groups.push({ mat: g.mat, geom: g.geom.clone().applyMatrix4(m) });
    }
    parked.set(k, (p = { groups }));
  }
  return p;
}

function meshes(p: Prepared, into: THREE.Object3D): void {
  for (const g of p.groups) {
    const m = new THREE.Mesh(g.geom, material(g.mat));
    m.castShadow = g.mat !== 'glass' && g.mat !== 'glow';
    m.receiveShadow = true;
    into.add(m);
  }
}

/** A tractor that drives: body plus four wheels that turn, the front pair steering. */
export class TractorRig {
  readonly group = new THREE.Group();
  private wheels: { spin: THREE.Object3D; steer: THREE.Object3D; r: number; front: boolean }[] = [];

  constructor(scheme: number) {
    meshes(tractorBody(scheme), this.group);
    for (const w of wheelSpots()) {
      const steer = new THREE.Group();
      steer.position.set(w.x, w.y, w.z);
      const turn = new THREE.Group();
      turn.rotation.y = w.flip ? Math.PI : 0;
      const spin = new THREE.Group();
      meshes(tractorWheel(scheme, w.front), spin);
      turn.add(spin);
      steer.add(turn);
      this.group.add(steer);
      this.wheels.push({ spin, steer, r: w.front ? TRACTOR.frontR : TRACTOR.rearR, front: w.front });
    }
  }

  /** travelled: metres driven so far, which turns the wheels. steer: front wheel angle in radians. */
  pose(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, travelled: number, steer: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.set(roll, yaw, pitch, 'YZX');
    for (const w of this.wheels) {
      const a = travelled / w.r;
      // Wheels on the left are turned round, so they spin the other way in their own frame.
      w.spin.rotation.z = w.steer.position.z < 0 ? a : -a;
      if (w.front) w.steer.rotation.y = steer;
    }
  }
}
