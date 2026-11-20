import * as THREE from 'three';
import { mulberry32 } from '../util/math';
import { colored, merge } from './geometry';
import type { Model } from './materials';

/**
 * Three roadside fences. Local +X runs along the fence, local +Z faces the road,
 * and the geometry sits on y = 0.
 *
 * The metal rail is a W-beam on posts with base plates. The wooden fence is three
 * faceted rails on irregular posts. The stone wall is a dry stack of faceted blocks.
 */

const BEAM_LIFT = 0.5;

/** Walked so side faces point outward: top slopes up, the road face points +Z, the back points -Z. */
const BEAM_PROFILE: Array<[number, number]> = [
  [0.15, 0.072],
  [0.162, 0.01],
  [-0.162, 0.01],
  [-0.15, 0.072],
  [-0.088, 0.098],
  [-0.04, 0.048],
  [0, 0.034],
  [0.04, 0.048],
  [0.088, 0.098],
];

export function guardrailBeam(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  BEAM_PROFILE.forEach(([y, z], i) => {
    const py = y + BEAM_LIFT;
    if (i === 0) shape.moveTo(z, py);
    else shape.lineTo(z, py);
  });
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 1, steps: 1 });
  g.translate(0, 0, -0.5);
  // Extrusion runs along Z. Turn it along X, and keep the road face on +Z.
  g.rotateY(-Math.PI / 2);
  return colored(g, 0xd2d6db, 0.03, 3);
}

export function guardrailPost(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.22, 0.05, 0.18).translate(0, 0.025, -0.055);
  const shaft = new THREE.BoxGeometry(0.086, 0.6, 0.074).translate(0, 0.34, -0.055);
  const bracket = new THREE.BoxGeometry(0.12, 0.2, 0.045).translate(0, 0.52, -0.012);
  return merge([
    colored(base, 0xa7acb3, 0.03, 1),
    colored(shaft, 0xb7bcc3, 0.025, 2),
    colored(bracket, 0xc5cad0, 0.02, 4),
  ]);
}

function taperedLog(variant: number, height: number, r0: number, r1: number): THREE.BufferGeometry {
  const rng = mulberry32(80 + variant * 19);
  const sides = 6;
  const rings = 1;
  const bulge = Array.from({ length: sides }, () => 0.84 + rng() * 0.32);
  const leanX = (rng() - 0.5) * 0.03;
  const leanZ = (rng() - 0.5) * 0.02;
  const vert = (i: number, ring: number): [number, number, number] => {
    const t = ring / rings;
    // A corner points at the road, so the post reads as a faceted log rather than a plank.
    const a = Math.PI / 2 + (i / sides) * Math.PI * 2 + variant * 0.22;
    const r = (r0 + (r1 - r0) * t) * bulge[i];
    return [Math.cos(a) * r + leanX * t, height * t, Math.sin(a) * r + leanZ * t];
  };
  const pos: number[] = [];
  const push = (p: [number, number, number]) => pos.push(p[0], p[1], p[2]);
  for (let ring = 0; ring < rings; ring++) {
    for (let i = 0; i < sides; i++) {
      const a = vert(i, ring);
      const b = vert((i + 1) % sides, ring);
      const c = vert((i + 1) % sides, ring + 1);
      const d = vert(i, ring + 1);
      push(a); push(b); push(c);
      push(a); push(c); push(d);
    }
  }
  // Only the top is capped: the bottom is in the ground.
  const top: [number, number, number] = [leanX, height, leanZ];
  for (let i = 0; i < sides; i++) {
    push(top); push(vert(i, rings)); push(vert((i + 1) % sides, rings));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

const POST_COLOR = [0x8d6844, 0x7b5b39, 0x9a734c];
const RAIL_Y = [0.34, 0.68, 1.02];
const RAIL_COLOR = [0xb5834f, 0xc49a62, 0xd4ae78];

/** Irregular post. The joint blocks stick out on +Z, where the rails are. */
export function woodPost(variant = 0): THREE.BufferGeometry {
  const v = ((variant % 3) + 3) % 3;
  const parts = [colored(taperedLog(v, 1.26, 0.1, 0.072), POST_COLOR[v], 0.05, 8 + v)];
  for (const y of RAIL_Y) {
    const block = new THREE.BoxGeometry(0.16, 0.14, 0.08).translate(0, y, 0.072);
    parts.push(colored(block, 0x5c412c, 0.04, 20 + y * 10 + v));
  }
  return merge(parts);
}

/** Three rails, one metre along X, sitting in front of the post on +Z. Scale X to the bay length. */
export function woodRails(): THREE.BufferGeometry {
  return merge(RAIL_Y.map((y, i) => {
    // Open-ended: bays meet end to end, so the caps were never seen.
    const rail = new THREE.CylinderGeometry(0.05, 0.046, 1, 5, 1, true);
    rail.rotateZ(Math.PI / 2);
    rail.scale(1, 0.8, 1);
    rail.translate(0, y, 0.105);
    return colored(rail, RAIL_COLOR[i], 0.07, 30 + i);
  }));
}

const STONE_COLOR = [0xe7e2d8, 0xd5cec3, 0xc3b9ab, 0xaea89e, 0x908b83, 0x9d9184, 0xdbcbb6, 0x7c776f, 0xefebe4, 0xb7a894, 0x6a6560];

/** A chunky faceted block. A corner points at the road, and the top is lower than the base. */
function rubble(w: number, h: number, d: number, rng: () => number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.46, 0.52, 1, rng() < 0.55 ? 5 : 6, 1);
  const squash = 0.78 + rng() * 0.3;
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const top = y > 0.15 ? squash : 1;
    p.setX(i, x * w * top);
    p.setY(i, (y + 0.5) * h);
    p.setZ(i, z * d * top);
  }
  g.rotateY(-Math.PI / 2 + (rng() - 0.5) * 0.4);
  g.rotateZ((rng() - 0.5) * 0.1);
  g.rotateX((rng() - 0.5) * 0.08);
  return g;
}

/** A two-metre run of dry stone wall. Scale X by (span / 2) when the bay is not exactly 2 m. */
export function stoneWall(variant = 0): THREE.BufferGeometry {
  const rng = mulberry32(5200 + variant * 131);
  const length = 2;
  const courses = [
    { y: 0, h: 0.32, d: 0.56 },
    { y: 0.24, h: 0.3, d: 0.48 },
    { y: 0.46, h: 0.28, d: 0.42 },
    { y: 0.68, h: 0.3, d: 0.36 },
  ];
  const parts: THREE.BufferGeometry[] = [];
  courses.forEach((course, ci) => {
    let x = -length / 2 - 0.02 + (ci % 2) * 0.14;
    const top = ci === courses.length - 1;
    while (x < length / 2 + 0.02) {
      const remain = length / 2 + 0.04 - x;
      let w = 0.26 + rng() * (top ? 0.16 : 0.18);
      if (w > remain) w = remain;
      if (w < 0.16) break;
      const h = course.h * (top ? 0.6 + rng() * 0.7 : 0.88 + rng() * 0.28);
      const d = course.d * (0.86 + rng() * 0.22);
      const stone = rubble(w, h, d, rng);
      const y = course.y + (rng() - 0.5) * 0.04;
      stone.translate(x + w / 2, Math.max(0, y), (rng() - 0.5) * 0.05 + (rng() < 0.28 ? 0.035 : 0));
      parts.push(colored(stone, STONE_COLOR[Math.floor(rng() * STONE_COLOR.length)], 0.06, 40 + parts.length + variant * 17));
      x += Math.max(0.16, w * 0.84);
    }
  });
  return merge(parts);
}

/** Property fence the towns already use: post at the origin, rails running 2 m along +Z. */
export function yardRailFence(): Model {
  const post = woodPost(0);
  const rails = woodRails();
  // Route pieces are 1 m along X. A yard bay is 2 m along Z, show face on +X.
  rails.scale(2, 1, 1);
  const turn = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  post.applyMatrix4(turn);
  rails.applyMatrix4(turn);
  rails.translate(0, 0, 1);
  return [
    { geom: post, mat: 'rough' },
    { geom: rails, mat: 'rough' },
  ];
}

/** Upright post. `towardRoad` is a world direction in the XZ plane; local +Z faces that way. */
export function fencePost(at: THREE.Vector3, towardRoad: THREE.Vector3): THREE.Matrix4 {
  const z = towardRoad.clone();
  z.y = 0;
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
  z.normalize();
  const y = new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return new THREE.Matrix4().compose(at, q, new THREE.Vector3(1, 1, 1));
}

/**
 * A bay centred on `at`. `along` is the full span, including the slope, and local +X
 * follows it. `scaleX` stretches a 1 m piece (a stone wall is 2 m, so pass span / 2).
 */
export function fenceSpan(at: THREE.Vector3, along: THREE.Vector3, towardRoad: THREE.Vector3, scaleX: number): THREE.Matrix4 {
  const z = towardRoad.clone();
  z.y = 0;
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
  z.normalize();
  const x = along.clone();
  x.addScaledVector(z, -x.dot(z));
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  // z × x points down on one side of a slope, which planted the rail under the verge.
  const y = new THREE.Vector3().crossVectors(z, x);
  if (y.y < 0) {
    x.negate();
    y.negate();
  }
  y.normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return new THREE.Matrix4().compose(at, q, new THREE.Vector3(scaleX, 1, 1));
}
