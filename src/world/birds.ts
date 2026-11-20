import * as THREE from 'three';
import { InstancedModel } from './batch';
import { merge, paint } from './geometry';
import type { Model } from './materials';

function birdGeom(): Model {
  const body = new THREE.SphereGeometry(1, 8, 6).scale(0.13, 0.055, 0.05);
  const head = new THREE.SphereGeometry(1, 7, 5).scale(0.045, 0.04, 0.04).translate(0.12, 0.02, 0);
  const beak = new THREE.ConeGeometry(0.012, 0.04, 5).rotateZ(-Math.PI / 2).translate(0.17, 0.018, 0);
  const tail = new THREE.ConeGeometry(0.03, 0.1, 5).rotateZ(Math.PI / 2).translate(-0.16, 0.01, 0);
  const wing = (z: number) => {
    const g = new THREE.BoxGeometry(0.16, 0.012, 0.28);
    g.translate(0, 0.02, z * 0.16);
    return g;
  };
  return [
    { geom: merge([paint(body, 0x2a2c31, { crease: 0.8 }), paint(head, 0x2a2c31, { crease: 0.8 }), paint(tail, 0x1c1d22, { crease: 0.6 })]), mat: 'matte' },
    { geom: paint(beak, 0xc9a227, { crease: 0.4 }), mat: 'matte' },
    { geom: merge([paint(wing(-1), 0x3a3c42, { crease: 0.4 }), paint(wing(1), 0x3a3c42, { crease: 0.4 })]), mat: 'matte' },
  ];
}

/**
 * A flock that wheels above the camera. Birds stay in a loose V that breathes,
 * so they read as a group rather than a spinning ring.
 */
export class Flock {
  readonly group = new THREE.Group();
  private birds: InstancedModel;
  private readonly n: number;
  private readonly phase: Float32Array;
  private t = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly look = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3(1, 0, 0);

  constructor(n = 22) {
    this.n = n;
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) this.phase[i] = i * 1.7 + Math.random() * 2;
    this.birds = new InstancedModel(birdGeom(), n, { shadows: false, receive: false });
    this.birds.count = n;
    this.group.add(this.birds.group);
    this.group.name = 'flock';
  }

  update(dt: number, eye: THREE.Vector3): void {
    this.t += dt;
    const cx = eye.x + Math.sin(this.t * 0.07) * 40;
    const cz = eye.z + Math.cos(this.t * 0.05) * 55;
    const cy = eye.y + 28 + Math.sin(this.t * 0.2) * 4;
    for (let i = 0; i < this.n; i++) {
      const row = Math.floor(i / 2);
      const side = i % 2 === 0 ? 1 : -1;
      const along = -row * 1.8;
      const spread = row * 1.15 * side;
      const flap = Math.sin(this.t * 9 + this.phase[i]) * 0.35;
      const wobble = Math.sin(this.t * 0.8 + this.phase[i]) * 0.6;
      this.p.set(cx + along + Math.sin(this.t * 0.3 + i) * 0.4, cy + flap * 0.15 + wobble * 0.2, cz + spread + wobble);
      this.look.set(1, flap * 0.15, 0.15 * side).normalize();
      this.q.setFromUnitVectors(this.fwd, this.look);
      this.s.set(1, 1 + Math.abs(flap) * 0.15, 1);
      this.m.compose(this.p, this.q, this.s);
      this.birds.setMatrix(i, this.m);
    }
    this.birds.commit();
  }
}
