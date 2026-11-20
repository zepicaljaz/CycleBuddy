import * as THREE from 'three';
import { prepare, type Prepared } from './batch';
import { loft, merge, paint, roundedBox, tube, v3 } from './geometry';
import type { Model } from './materials';
import { buildCarWheel, WHEEL_BASE_R } from './cars';

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

const WHITE = 0xffffff;
const TRIM = 0x2a2c31;
const GLASS = 0x3a4a58;

/** Coachbuilt motorhome, +x forward, ground at y = 0. Paint tints the body. */
export function motorhomeModel(): Model {
  const L = 3.55;
  const W = 1.12;
  const n = 16;
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const x = -L + t * 2 * L;
    const front = THREE.MathUtils.smoothstep(L - 0.55, L, x);
    const rear = THREE.MathUtils.smoothstep(-L + 0.35, -L, -x);
    const y0 = 0.48;
    const y1 = 2.72 - front * 0.22;
    const w = W * (1 - front * 0.12 - rear * 0.04);
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const e = 0.22;
      const cx = Math.sign(c) * Math.pow(Math.abs(c), e);
      const sy = Math.sign(s) * Math.pow(Math.abs(s), e);
      ring.push(v3(x, (y0 + y1) / 2 + sy * (y1 - y0) / 2, cx * w));
    }
    rings.push(ring);
  }
  const body = loft(rings, true, true);
  const cabGlass = box(2.15, 3.42, 1.18, 2.05, -1.02, 1.02);
  const sideWin: THREE.BufferGeometry[] = [];
  for (const z of [-1, 1]) {
    sideWin.push(box(-2.6, -0.4, 1.35, 2.15, z * 1.12, z * 1.14));
    sideWin.push(box(0.15, 1.7, 1.35, 2.15, z * 1.12, z * 1.14));
  }
  const door = box(0.05, 0.95, 0.52, 2.05, 1.12, 1.16);
  const stripe = box(-3.4, 3.4, 1.08, 1.22, -1.13, 1.13);
  const lightsF: THREE.BufferGeometry[] = [];
  const lightsR: THREE.BufferGeometry[] = [];
  for (const z of [-0.72, 0.72]) {
    lightsF.push(box(3.5, 3.56, 0.82, 1.05, z - 0.16, z + 0.16));
    lightsR.push(box(-3.56, -3.5, 0.9, 1.18, z - 0.14, z + 0.14));
  }
  const rack = [box(-2.2, 2.4, 2.74, 2.82, -0.85, 0.85), tube(v3(-2.1, 2.78, -0.82), v3(2.3, 2.78, -0.82), 0.02, 0.02, 6), tube(v3(-2.1, 2.78, 0.82), v3(2.3, 2.78, 0.82), 0.02, 0.02, 6)];
  const step = box(0.15, 0.85, 0.02, 0.18, 1.12, 1.45);
  const grill = box(3.48, 3.55, 0.55, 0.78, -0.45, 0.45);
  return [
    { geom: paint(body, WHITE, { crease: 0.85 }), mat: 'carpaint', tint: 'paint' },
    { geom: merge([cabGlass, ...sideWin].map((g) => paint(g, GLASS, { crease: 0.5 }))), mat: 'glass' },
    { geom: merge([paint(door, 0xd8d6d0, { crease: 0.4 }), paint(stripe, WHITE, { crease: 0.4 }), paint(step, 0x3a3c42, { crease: 0.4 }), ...rack.map((g) => paint(g, TRIM, { crease: 0.6 }))]), mat: 'gloss' },
    { geom: merge(lightsF.map((g) => paint(g, new THREE.Color(3.2, 3.1, 2.7), { crease: 0.5 }))), mat: 'glow' },
    { geom: merge(lightsR.map((g) => paint(g, new THREE.Color(0.9, 0.05, 0.04), { crease: 0.5 }))), mat: 'glow' },
    { geom: paint(grill, TRIM, { crease: 0.4 }), mat: 'metal' },
  ];
}

const parked = new Map<string, Prepared>();

/** Parked motorhome with wheels baked in. Tint slot `paint`. */
export function parkedMotorhome(): Prepared {
  let p = parked.get('mh');
  if (!p) {
    const model: Model = [...motorhomeModel()];
    const spec = { length: 7.1, width: 2.24, wheelbase: 4.15, overhang: 1.05, wheelR: 0.38 };
    const front = spec.length / 2 - spec.overhang;
    const rear = front - spec.wheelbase;
    const track = spec.width / 2 - 0.16;
    const s = spec.wheelR / WHEEL_BASE_R;
    const wheel = buildCarWheel(1);
    for (const x of [front, rear]) {
      for (const side of [-1, 1]) {
        const m = new THREE.Matrix4().makeScale(s, s, s);
        if (side < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
        m.setPosition(x, spec.wheelR, side * track);
        for (const part of wheel) model.push({ ...part, geom: part.geom.clone().applyMatrix4(m) });
      }
    }
    parked.set('mh', (p = prepare(model)));
  }
  return p;
}

export function organizerCar(): Prepared {
  return parked.get('org') ?? (parked.set('org', prepare(organizerModel())), parked.get('org')!);
}

/** Race director car: a long estate with a roof bar, yellow panels and a board. */
function organizerModel(): Model {
  const body = roundedBox(4.7, 1.05, 1.78, 0.12, 3).translate(0, 0.92, 0);
  const cabin = roundedBox(2.35, 0.72, 1.62, 0.1, 3).translate(-0.15, 1.72, 0);
  const screen = box(0.85, 1.15, 1.28, 1.95, -0.72, 0.72);
  const rear = box(-1.35, -1.15, 1.32, 1.92, -0.7, 0.7);
  const bar = box(-0.6, 0.6, 2.08, 2.18, -0.7, 0.7);
  const lamp = (x: number, z: number, c: THREE.Color) => ({ geom: paint(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10).translate(x, 2.22, z), c, { crease: 0.5 }), mat: 'glow' as const });
  const board = box(-0.05, 0.05, 1.55, 1.95, -0.55, 0.55);
  const lightsF = [box(2.28, 2.36, 0.72, 0.92, -0.62, -0.32), box(2.28, 2.36, 0.72, 0.92, 0.32, 0.62)];
  const lightsR = [box(-2.36, -2.28, 0.78, 0.98, -0.58, -0.3), box(-2.36, -2.28, 0.78, 0.98, 0.3, 0.58)];
  const wheels: THREE.BufferGeometry[] = [];
  for (const x of [-1.35, 1.4]) for (const z of [-0.78, 0.78]) {
    wheels.push(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 14).rotateX(Math.PI / 2).translate(x, 0.34, z));
  }
  return [
    { geom: merge([paint(body, 0xf2f2f0, { crease: 0.9 }), paint(cabin, 0xf2f2f0, { crease: 0.9 })]), mat: 'carpaint', tint: 'paint' },
    { geom: merge([paint(screen, GLASS, { crease: 0.5 }), paint(rear, GLASS, { crease: 0.5 })]), mat: 'glass' },
    { geom: merge([paint(bar, 0x1c1d22, { crease: 0.5 }), paint(board, 0xf4c400, { crease: 0.4 })]), mat: 'gloss' },
    lamp(-0.25, -0.45, new THREE.Color(3.4, 2.8, 0.2)),
    lamp(0.25, 0.45, new THREE.Color(3.4, 2.8, 0.2)),
    { geom: merge(lightsF.map((g) => paint(g, new THREE.Color(3.2, 3.1, 2.7), { crease: 0.5 }))), mat: 'glow' },
    { geom: merge(lightsR.map((g) => paint(g, new THREE.Color(0.9, 0.05, 0.04), { crease: 0.5 }))), mat: 'glow' },
    { geom: merge(wheels.map((g) => paint(g, 0x1c1c1e, { crease: 0.8 }))), mat: 'rubber' },
  ];
}
