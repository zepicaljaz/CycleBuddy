import * as THREE from 'three';
import { prepare, type Prepared } from './batch';
import { curve, merge, paint, sweep, tube, v3 } from './geometry';
import type { Model } from './materials';

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

const DARK = 0x1c1d22;
const FAIRING = 0xf2f0ea;

function tyre(r: number, w: number): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r - w * 0.35, w * 0.42, 8, 22);
}

function rider(camera: boolean): Model {
  const jersey = [
    new THREE.SphereGeometry(1, 10, 8).scale(0.16, 0.2, 0.14).translate(-0.05, 1.18, 0),
    new THREE.SphereGeometry(1, 8, 6).scale(0.12, 0.14, 0.1).translate(-0.18, 0.95, 0),
  ];
  const helm = new THREE.SphereGeometry(1, 14, 10).scale(0.12, 0.11, 0.11).translate(0.08, 1.46, 0);
  const visor = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI, 0.4, 1.2).scale(0.1, 0.09, 0.1).rotateZ(-0.4).translate(0.14, 1.45, 0);
  const legs = [
    sweep(curve([v3(-0.12, 0.95, 0.1), v3(0.05, 0.62, 0.14), v3(0.22, 0.42, 0.12)], 6), () => [0.055, 0.055], { sides: 8 }),
    sweep(curve([v3(-0.12, 0.95, -0.1), v3(0.05, 0.62, -0.14), v3(0.22, 0.42, -0.12)], 6), () => [0.055, 0.055], { sides: 8 }),
  ];
  const arms = [
    sweep(curve([v3(0.02, 1.28, 0.16), v3(0.22, 1.18, 0.28), v3(0.42, 1.08, 0.32)], 5), () => [0.04, 0.04], { sides: 7 }),
    sweep(curve([v3(0.02, 1.28, -0.16), v3(0.22, 1.18, -0.28), v3(0.42, 1.08, -0.32)], 5), () => [0.04, 0.04], { sides: 7 }),
  ];
  const cam: THREE.BufferGeometry[] = [];
  if (camera) {
    cam.push(box(0.18, 0.42, 1.32, 1.5, -0.08, 0.08));
    cam.push(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 10).rotateZ(Math.PI / 2).translate(0.46, 1.4, 0));
    cam.push(box(0.12, 0.22, 1.22, 1.38, -0.12, 0.02));
  }
  const parts: Model = [
    { geom: merge(jersey.map((g) => paint(g, 0x1a1c28, { crease: 1 }))), mat: 'cloth' },
    { geom: merge([...legs, ...arms].map((g) => paint(g, 0x1a1c28, { crease: 1 }))), mat: 'cloth' },
    { geom: paint(helm, 0x1c1d22, { crease: 0.9 }), mat: 'gloss' },
    { geom: paint(visor, 0x22324a, { crease: 0.8 }), mat: 'glass' },
  ];
  if (cam.length) parts.push({ geom: merge(cam.map((g) => paint(g, 0x2a2c31, { crease: 0.6 }))), mat: 'metal' });
  return parts;
}

function moto(camera: boolean): Model {
  const wheelR = 0.32;
  const front = v3(0.72, wheelR);
  const rear = v3(-0.68, wheelR);
  const tank = sweep(curve([v3(-0.15, 0.78), v3(0.05, 0.86), v3(0.28, 0.82), v3(0.42, 0.72)], 8), (t) => [0.14 - t * 0.04, 0.08], { sides: 10, exp: 2.4 });
  const tail = sweep(curve([v3(-0.12, 0.78), v3(-0.4, 0.8), v3(-0.62, 0.74)], 6), (t) => [0.12 - t * 0.04, 0.07], { sides: 8, exp: 2.6 });
  const fairing = sweep(curve([v3(0.35, 0.7), v3(0.55, 0.78), v3(0.72, 0.7), v3(0.78, 0.52)], 8), (t) => [0.22 - t * 0.06, 0.12], { sides: 10, exp: 2.2 });
  const screen = sweep(curve([v3(0.62, 0.82), v3(0.72, 0.98), v3(0.76, 1.08)], 5), () => [0.16, 0.01], { sides: 6, exp: 3 });
  const fork = [tube(front.clone().add(v3(-0.02, 0.06, 0.08)), v3(0.55, 0.95, 0.08), 0.018, 0.018, 6), tube(front.clone().add(v3(-0.02, 0.06, -0.08)), v3(0.55, 0.95, -0.08), 0.018, 0.018, 6)];
  const bars = tube(v3(0.5, 1.05, -0.32), v3(0.5, 1.05, 0.32), 0.016, 0.016, 8);
  const swing = [tube(rear.clone().add(v3(0.04, 0.04, 0.08)), v3(-0.05, 0.52, 0.08), 0.016, 0.016, 6), tube(rear.clone().add(v3(0.04, 0.04, -0.08)), v3(-0.05, 0.52, -0.08), 0.016, 0.016, 6)];
  const engine = box(-0.18, 0.28, 0.32, 0.62, -0.14, 0.14);
  const pipe = sweep(curve([v3(0.2, 0.38, 0.14), v3(-0.2, 0.32, 0.18), v3(-0.7, 0.28, 0.16)], 8), () => [0.028, 0.028], { sides: 8 });
  const head = new THREE.SphereGeometry(1, 10, 8).scale(0.07, 0.07, 0.09).translate(0.82, 0.62, 0);
  const tailLamp = box(-0.78, -0.72, 0.68, 0.78, -0.06, 0.06);
  const wheels = [tyre(wheelR, 0.11).translate(front.x, front.y, 0), tyre(wheelR, 0.13).translate(rear.x, rear.y, 0)];
  const discs = [
    new THREE.CylinderGeometry(0.14, 0.14, 0.01, 16).rotateX(Math.PI / 2).translate(front.x, front.y, 0.06),
    new THREE.CylinderGeometry(0.13, 0.13, 0.01, 16).rotateX(Math.PI / 2).translate(rear.x, rear.y, 0.07),
  ];
  const model: Model = [
    { geom: merge([paint(tank, FAIRING, { crease: 1 }), paint(tail, FAIRING, { crease: 1 }), paint(fairing, FAIRING, { crease: 1 })]), mat: 'carpaint', tint: 'paint' },
    { geom: paint(screen, 0x8ab0c8, { crease: 0.6 }), mat: 'glass' },
    { geom: merge([...fork, bars, ...swing, engine, pipe, ...discs].map((g) => paint(g, DARK, { crease: 0.8 }))), mat: 'metal' },
    { geom: merge(wheels.map((g) => paint(g, 0x1a1a1c, { crease: 1 }))), mat: 'rubber' },
    { geom: paint(head, new THREE.Color(3.3, 3.2, 2.8), { crease: 0.6 }), mat: 'glow' },
    { geom: paint(tailLamp, new THREE.Color(0.9, 0.05, 0.04), { crease: 0.5 }), mat: 'glow' },
  ];
  for (const p of rider(camera)) model.push(p);
  return model;
}

const cache = new Map<string, Prepared>();

export function motorcycle(camera = true): Prepared {
  const key = camera ? 'cam' : 'plain';
  let p = cache.get(key);
  if (!p) cache.set(key, (p = prepare(moto(camera))));
  return p;
}
