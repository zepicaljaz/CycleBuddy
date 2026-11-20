import * as THREE from 'three';
import { HOOD_GRIP } from './bikes';
import { atDetail, curve, limb, loft, merge, outline, paint, q, sweep, tube, v3, type Detail } from './geometry';
import type { Model } from './materials';

// Rider-local frame: +x forward, +y up, +z right. Lengths in metres.
export const HIP = v3(-0.29, 1.035);
export const LEG_Z = 0.095;
export const FOOT_Z = 0.12;
export const THIGH = 0.44;
export const SHIN = 0.42;
/** Ankle joint in the foot frame, whose origin is the pedal axle. */
export const ANKLE = v3(-0.11, 0.085);

const WHITE = 0xffffff;
const SHOULDER = v3(0.15, 1.34, 0.18);
const HEAD = v3(0.297, 1.505);
const HEAD_TILT = -0.35;

/** Piecewise-linear table lookup. */
function table(ts: number[], vs: number[], t: number): number {
  if (t <= ts[0]) return vs[0];
  for (let i = 1; i < ts.length; i++) {
    if (t <= ts[i]) {
      const f = (t - ts[i - 1]) / (ts[i] - ts[i - 1]);
      return vs[i - 1] + (vs[i] - vs[i - 1]) * f;
    }
  }
  return vs[vs.length - 1];
}

const SPINE = [v3(-0.31, 1.04), v3(-0.25, 1.08), v3(-0.19, 1.135), v3(-0.12, 1.18), v3(-0.06, 1.225), v3(0.0, 1.265), v3(0.06, 1.3), v3(0.11, 1.325), v3(0.15, 1.345), v3(0.185, 1.36), v3(0.215, 1.37)];
const TT = [0, 0.08, 0.16, 0.28, 0.4, 0.52, 0.64, 0.74, 0.84, 0.92, 1];
const TW = [0.148, 0.162, 0.15, 0.136, 0.142, 0.156, 0.17, 0.176, 0.168, 0.138, 0.1];
const TH = [0.108, 0.114, 0.108, 0.096, 0.102, 0.11, 0.118, 0.114, 0.1, 0.082, 0.07];
const TN = [1, 1.02, 0.98, 0.94, 1.02, 1.1, 1.14, 1.1, 1.02, 0.94, 0.88];

function torso(from: number, to: number, scale: number, hi: boolean): THREE.BufferGeometry {
  const spine = new THREE.CatmullRomCurve3(SPINE, false, 'centripetal');
  const n = hi ? Math.max(4, Math.round((to - from) * 32)) : Math.max(2, Math.round((to - from) * q(22, 8)));
  const sides = q(36, 14);
  const shape = outline(sides, 2.15);
  const rings: THREE.Vector3[][] = [];
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const Z = v3(0, 0, 1);
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    const c = spine.getPoint(t);
    spine.getTangent(t, T);
    N.crossVectors(T, Z).normalize();
    const w = table(TT, TW, t) * scale;
    const h = table(TT, TH, t) * scale;
    const nose = table(TT, TN, t);
    rings.push(shape.map(([cx, sy]) => c.clone().addScaledVector(Z, cx * w).addScaledVector(N, (sy > 0 ? sy * nose : sy) * h)));
  }
  return loft(rings, true, true);
}

/** Elbow position from shoulder and wrist, bending outward and down. */
function elbow(s: THREE.Vector3, w: THREE.Vector3, l1: number, l2: number, side: number): THREE.Vector3 {
  const d = Math.min(w.distanceTo(s), l1 + l2 - 1e-3);
  const u = w.clone().sub(s).normalize();
  const bend = v3(0, -0.45, side * 0.9);
  bend.addScaledVector(u, -bend.dot(u)).normalize();
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const a = Math.acos(Math.max(-1, Math.min(1, cos)));
  return s.clone().addScaledVector(u, Math.cos(a) * l1).addScaledVector(bend, Math.sin(a) * l1);
}

/** Tube between joints with a radius profile and an optional slice of it. */
function segment(a: THREE.Vector3, b: THREE.Vector3, r: (t: number) => number, from: number, to: number, sides: number, rings: number, scale = 1): THREE.BufferGeometry {
  const path: THREE.Vector3[] = [];
  for (let i = 0; i <= rings; i++) path.push(a.clone().lerp(b, from + ((to - from) * i) / rings));
  return sweep(path, (t) => {
    const rr = r(from + (to - from) * t) * scale;
    return [rr, rr];
  }, { sides });
}

/** Upper arm from 4 cm inside the shoulder joint, so the deltoid bulge is part of the same tube. */
const upperArmR = (t: number) => table([0, 0.15, 0.32, 0.55, 0.88, 1], [0.05, 0.057, 0.049, 0.043, 0.037, 0.035], t);
const forearmR = (t: number) => table([0, 0.2, 0.6, 1], [0.036, 0.039, 0.033, 0.025], t);

function headTransform(): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationZ(HEAD_TILT).setPosition(HEAD);
}

/** Aero road helmet: long shell, brow ridge, tapered occipital tail, vent channels and straps. */
function helmet(hi: boolean): { shell: THREE.BufferGeometry; dark: THREE.BufferGeometry[] } {
  const NV = q(48, 18);
  const rimAt = (v: number) => {
    const c = Math.cos(v);
    // Deeper at the nape so the tail wraps the occiput; a little shallower at the brow.
    return Math.PI * (0.5 - 0.08 * c + 0.018 * Math.sin(v) ** 2);
  };
  const outer = (u: number, v: number, inset = 1): THREE.Vector3 => {
    const th = u * rimAt(v);
    const c = Math.cos(v);
    const s = Math.sin(v);
    const front = Math.max(0, c);
    const back = Math.max(0, -c);
    const rx = 0.132 + 0.028 * back - 0.01 * front;
    const ry = 0.122 + 0.01 * back;
    const rz = 0.116 + 0.006 * Math.abs(s);
    const p = v3(Math.sin(th) * c * rx, Math.cos(th) * ry, Math.sin(th) * s * rz);
    const tail = Math.pow(back, 2.4) * THREE.MathUtils.smoothstep(u, 0.28, 1);
    p.x -= 0.052 * tail;
    p.y += 0.012 * tail - 0.008 * (1 - u) * (1 - u);
    // Brow visor: a slight peak above the forehead, then a drop at the rim.
    const brow = Math.pow(front, 5);
    p.y += 0.006 * brow * THREE.MathUtils.smoothstep(u, 0.35, 0.78);
    p.y -= 0.014 * brow * THREE.MathUtils.smoothstep(u, 0.82, 1);
    p.x += 0.01 * brow * u;
    return p.multiplyScalar(inset);
  };
  const ring = (u: number, inset = 1) => {
    const r: THREE.Vector3[] = [];
    for (let k = 0; k < NV; k++) r.push(outer(u, (k / NV) * Math.PI * 2, inset));
    return r;
  };
  const shellRings: THREE.Vector3[][] = [];
  const steps = q(16, 7);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Denser rings near the rim and the crown.
    const u = 0.04 + 0.9 * (t * t * 0.35 + t * 0.65);
    shellRings.push(ring(u));
  }
  const shell = loft(shellRings, true, false);
  const edge = loft([ring(0.92), ring(0.96), ring(1), ring(1, 0.86), ring(0.88, 0.86), ring(0.62, 0.86)], false, false);
  const dark: THREE.BufferGeometry[] = [edge];
  if (hi) {
    const channel = (u0: number, u1: number, v: number, w: number) => {
      const n = 6;
      const rings: THREE.Vector3[][] = [];
      for (let i = 0; i <= n; i++) {
        const u = u0 + ((u1 - u0) * i) / n;
        const p = outer(u, v);
        const along = outer(Math.min(1, u + 0.03), v).sub(outer(Math.max(0, u - 0.03), v)).normalize();
        const normal = p.clone().normalize();
        const side = new THREE.Vector3().crossVectors(along, normal).normalize();
        const c = p.addScaledVector(normal, -0.001);
        rings.push([
          c.clone().addScaledVector(along, 0.01).addScaledVector(side, w),
          c.clone().addScaledVector(along, 0.01).addScaledVector(side, -w),
          c.clone().addScaledVector(along, -0.01).addScaledVector(side, -w),
          c.clone().addScaledVector(along, -0.01).addScaledVector(side, w),
        ]);
      }
      return loft(rings, true, true);
    };
    for (const v of [-0.7, -0.38, 0, 0.38, 0.7]) dark.push(channel(0.28, 0.78, v, 0.007));
    for (const v of [-0.52, -0.18, 0.18, 0.52]) dark.push(channel(0.58, 0.92, v, 0.006));
    for (const v of [Math.PI - 0.42, Math.PI, Math.PI + 0.42]) dark.push(channel(0.48, 0.88, v, 0.0075));
    for (const v of [Math.PI - 0.85, Math.PI + 0.85]) dark.push(channel(0.62, 0.94, v, 0.0055));
    // Tiny exhaust ports on the tail.
    for (const v of [-0.28, 0.28, Math.PI - 0.22, Math.PI + 0.22]) {
      const p = outer(0.9, v);
      const nrm = p.clone().normalize();
      dark.push(new THREE.SphereGeometry(1, 8, 5).scale(0.012, 0.0035, 0.006).translate(p.x + nrm.x * 0.001, p.y + nrm.y * 0.001, p.z + nrm.z * 0.001));
    }
    for (const side of [-1, 1]) {
      const a = outer(0.97, side * 1.18);
      const b = outer(0.985, side * 1.92);
      const chin = v3(0.048, -0.108, side * 0.032);
      dark.push(tube(a, chin, 0.0032, 0.0026, 4, false), tube(b, chin, 0.0032, 0.0026, 4, false));
    }
    dark.push(new THREE.BoxGeometry(0.016, 0.01, 0.028).translate(0.05, -0.11, 0));
  }
  return { shell, dark };
}

function glasses(): { lens: THREE.BufferGeometry; frame: THREE.BufferGeometry[] } {
  const arc = (y: number, scale: number, from: number, to: number, n: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const a = from + ((to - from) * i) / n;
      pts.push(v3(Math.cos(a) * 0.104 * scale, y, Math.sin(a) * 0.088 * scale));
    }
    return pts;
  };
  const lens = sweep(arc(0.002, 1.02, -1.15, 1.15, q(14, 6)), (t) => [0.017 - 0.004 * Math.abs(t - 0.5), 0.003], { sides: q(8, 4), exp: 3, ref: v3(0, 1, 0) });
  const frame = [sweep(arc(0.02, 1.025, -1.2, 1.2, q(12, 5)), () => [0.0035, 0.0035], { sides: 4, exp: 3, ref: v3(0, 1, 0) })];
  for (const side of [-1, 1]) {
    const end = v3(Math.cos(1.2) * 0.106, 0.018, side * Math.sin(1.2) * 0.09);
    frame.push(tube(end, v3(-0.03, 0, side * 0.084), 0.0025, 0.0025, 3));
  }
  return { lens, frame };
}

export interface BodyModels {
  /** Everything that moves with the bike frame. */
  body: Model;
  thigh: Model;
  shin: Model;
  foot: Model;
  /** Red discs for the mountains jersey. Drawn only for the rider who wears it. */
  polka: Model;
}

export function buildBody(detail: Detail): BodyModels {
  return atDetail(detail, () => bodyAt(detail === 0));
}

function bodyAt(hi: boolean): BodyModels {
  const sides = q(18, 8);
  const jersey: THREE.BufferGeometry[] = [torso(0.16, 1, 1, hi)];
  const accent: THREE.BufferGeometry[] = [torso(0.58, 0.72, 1.016, hi), tube(v3(0.17, 1.325), v3(0.232, 1.402), 0.056, 0.054, q(18, 8), false)];
  const shorts: THREE.BufferGeometry[] = [torso(0, 0.26, 0.985, hi)];
  const skin: THREE.BufferGeometry[] = [];
  const hand: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    shorts.push(new THREE.SphereGeometry(1, q(12, 6), q(8, 4)).scale(0.1, 0.08, 0.072).translate(-0.33, 1.005, side * 0.062));
    const s = SHOULDER.clone().setZ(side * SHOULDER.z);
    const grip = HOOD_GRIP.clone().setZ(side * HOOD_GRIP.z);
    const wrist = grip.clone().add(v3(-0.045, 0.02, 0));
    const e = elbow(s, wrist, 0.29, 0.255, side);
    const s0 = s.clone().addScaledVector(e.clone().sub(s).normalize(), -0.04);
    jersey.push(segment(s0, e, upperArmR, 0, 0.6, sides, q(7, 3), 1.07));
    accent.push(segment(s0, e, upperArmR, 0.55, 0.62, sides, 1, 1.09));
    skin.push(segment(s0, e, upperArmR, 0.55, 1, sides, q(4, 2)));
    skin.push(new THREE.SphereGeometry(0.036, sides, q(6, 3)).translate(e.x, e.y, e.z));
    skin.push(segment(e, wrist, forearmR, 0, 1, sides, q(6, 2)));
    // Hand wrapped over the hood, fingers curling down its front.
    const handPath = curve([wrist, wrist.clone().add(v3(0.025, -0.006)), grip.clone().add(v3(0.008, 0.006)), grip.clone().add(v3(0.03, -0.008)), grip.clone().add(v3(0.038, -0.034))], q(8, 3));
    hand.push(sweep(handPath, (t) => [table([0, 0.3, 0.6, 1], [0.026, 0.04, 0.041, 0.03], t), table([0, 0.3, 0.7, 1], [0.019, 0.021, 0.015, 0.011], t)], { sides: q(10, 6), exp: 2.6 }));
    if (hi) hand.push(tube(wrist.clone().add(v3(0.015, -0.012, -side * 0.025)), grip.clone().add(v3(0.012, -0.012, -side * 0.024)), 0.01, 0.008, 6));
  }
  skin.push(tube(v3(0.17, 1.325), v3(0.275, 1.455), 0.05, 0.046, sides));
  if (hi) {
    // Centre zip and a pair of rear pockets on the jersey.
    jersey.push(tube(v3(0.02, 1.12), v3(0.2, 1.355), 0.006, 0.005, 6, false));
    for (const z of [-0.07, 0, 0.07]) {
      accent.push(new THREE.BoxGeometry(0.012, 0.055, 0.055).translate(-0.3, 1.07, z));
    }
  }
  // Head, jaw, nose and ears, tilted with the head.
  const head = headTransform();
  const face: THREE.BufferGeometry[] = [
    new THREE.SphereGeometry(1, q(28, 12), q(20, 8)).scale(0.098, 0.112, 0.08),
    new THREE.SphereGeometry(1, q(18, 8), q(12, 5)).scale(0.062, 0.046, 0.06).translate(0.035, -0.072, 0),
  ];
  if (hi) {
    face.push(new THREE.SphereGeometry(1, 10, 8).scale(0.022, 0.026, 0.013).rotateZ(0.35).translate(0.09, -0.03, 0));
    for (const side of [-1, 1]) face.push(new THREE.SphereGeometry(1, 10, 8).scale(0.02, 0.03, 0.009).translate(-0.008, -0.01, side * 0.08));
  }
  for (const f of face) skin.push(f.applyMatrix4(head));
  const hair = new THREE.SphereGeometry(1, q(14, 6), q(8, 4), -Math.PI / 2, Math.PI, Math.PI * 0.32, Math.PI * 0.4).scale(0.1, 0.114, 0.083).applyMatrix4(head);

  const helm = helmet(hi);
  const helmMatrix = new THREE.Matrix4().makeRotationZ(HEAD_TILT + 0.06).setPosition(HEAD.clone().add(v3(-0.006, 0.02)));
  const shell = helm.shell.applyMatrix4(helmMatrix);
  const helmDark = helm.dark.map((g) => g.applyMatrix4(helmMatrix));
  const specs = glasses();
  const glassMatrix = new THREE.Matrix4().makeRotationZ(HEAD_TILT + 0.1).setPosition(HEAD);

  const body: Model = [
    { geom: merge(jersey.map((g) => paint(g, WHITE, { crease: 1.2 }))), mat: 'cloth', tint: 'jersey' },
    { geom: merge(accent.map((g) => paint(g, WHITE, { crease: 1.2 }))), mat: 'cloth', tint: 'jerseyAccent' },
    { geom: merge(shorts.map((g) => paint(g, WHITE, { crease: 1.2 }))), mat: 'cloth', tint: 'shorts' },
    { geom: merge([...skin, ...hand].map((g) => paint(g, WHITE, { crease: 1.2 }))), mat: 'matte', tint: 'skin' },
    { geom: paint(hair, 0x3a2a1e, { crease: 1.2 }), mat: 'matte' },
    { geom: paint(shell, WHITE, { crease: 0.8 }), mat: 'paint', tint: 'helmet' },
    { geom: merge(helmDark.map((g) => paint(g, 0x18191c, { crease: 0.8 }))), mat: 'gloss' },
    { geom: paint(specs.lens.applyMatrix4(glassMatrix), 0x22324a, { crease: 1 }), mat: 'glass' },
    { geom: merge(specs.frame.map((g) => paint(g.applyMatrix4(glassMatrix), 0x1a1b1e, { crease: 1 }))), mat: 'gloss' },
  ];

  // Legs are built at true length along +y and posed joint to joint.
  const thighR = (t: number) => table([0, 0.35, 0.7, 1], [0.086, 0.08, 0.068, 0.052], t);
  const calfR = (t: number) => table([0, 0.22, 0.45, 0.75, 1], [0.047, 0.055, 0.047, 0.033, 0.029], t);
  const thigh: Model = [
    { geom: paint(limb(thighR, sides, q(8, 3), -0.06, 0.82).scale(1, THIGH, 1), WHITE, { crease: 1.2 }), mat: 'cloth', tint: 'shorts' },
    {
      geom: merge([
        paint(limb(thighR, sides, q(3, 1), 0.8, 1).scale(1, THIGH, 1), WHITE, { crease: 1.2 }),
        paint(new THREE.SphereGeometry(0.05, sides, q(8, 4)).scale(1.05, 1, 0.95).translate(0, THIGH, 0), WHITE, { crease: 1.2 }),
      ]),
      mat: 'matte',
      tint: 'skin',
    },
  ];
  const shin: Model = [
    { geom: paint(limb(calfR, sides, q(8, 3), 0, 0.74).scale(1, SHIN, 1), WHITE, { crease: 1.2 }), mat: 'matte', tint: 'skin' },
    { geom: paint(limb((t) => calfR(Math.min(1, t)) * 1.06, sides, q(4, 2), 0.7, 1.08).scale(1, SHIN, 1), WHITE, { crease: 1.2 }), mat: 'cloth', tint: 'socks' },
  ];
  return { body, thigh, shin, foot: shoe(hi), polka: polkaDots(hi) };
}

/** Small red circles on the jersey. Other kits never draw this mesh. */
function polkaDots(hi: boolean): Model {
  const spine = new THREE.CatmullRomCurve3(SPINE, false, 'centripetal');
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const Z = v3(0, 0, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const turn = new THREE.Quaternion();
  const segs = hi ? 10 : 6;
  const discs: THREE.BufferGeometry[] = [];
  const place = (center: THREE.Vector3, normal: THREE.Vector3, radius: number) => {
    const disc = new THREE.CylinderGeometry(radius, radius, 0.003, segs);
    turn.setFromUnitVectors(up, normal);
    disc.applyQuaternion(turn);
    const p = center.clone().addScaledVector(normal, 0.008);
    disc.translate(p.x, p.y, p.z);
    discs.push(disc);
  };
  const rows: { t: number; lats: number[] }[] = [
    { t: 0.32, lats: [-0.58, 0, 0.58] },
    { t: 0.44, lats: [-0.3, 0.32] },
    { t: 0.76, lats: [-0.55, 0.04, 0.55] },
    { t: 0.88, lats: [-0.28, 0.34] },
  ];
  for (const row of rows) {
    const c = spine.getPoint(row.t);
    spine.getTangent(row.t, T);
    N.crossVectors(T, Z).normalize();
    const w = table(TT, TW, row.t);
    const depth = table(TT, TH, row.t);
    const nose = table(TT, TN, row.t);
    for (const lat of row.lats) {
      for (const face of [-1, 1]) {
        const center = c.clone().addScaledVector(Z, lat * w).addScaledVector(N, face * depth * (face > 0 ? nose : 1));
        place(center, N.clone().multiplyScalar(face), 0.02);
      }
    }
  }
  for (const side of [-1, 1]) {
    const s = SHOULDER.clone().setZ(side * SHOULDER.z);
    const grip = HOOD_GRIP.clone().setZ(side * HOOD_GRIP.z);
    const wrist = grip.clone().add(v3(-0.045, 0.02, 0));
    const e = elbow(s, wrist, 0.29, 0.255, side);
    const s0 = s.clone().addScaledVector(e.clone().sub(s).normalize(), -0.04);
    const arm = e.clone().sub(s0);
    const along = arm.clone().normalize();
    const outward = new THREE.Vector3().crossVectors(along, up);
    if (outward.z * side < 0) outward.negate();
    outward.normalize();
    for (const t of [0.22, 0.45]) {
      const center = s0.clone().addScaledVector(arm, t).addScaledVector(outward, upperArmR(t) * 1.07);
      place(center, outward, 0.016);
    }
  }
  return [{ geom: paint(merge(discs), 0xd0121a, { crease: 0.4 }), mat: 'cloth' }];
}

/** Road shoe in the foot frame: origin on the pedal axle, +x to the toe. Includes cleat and pedal. */
function shoe(hi: boolean): Model {
  // Last stations from heel to toe. Heel is taller and narrower; the ball is the widest point.
  const xs = [-0.186, -0.176, -0.16, -0.138, -0.11, -0.075, -0.035, 0.005, 0.04, 0.068, 0.09, 0.104, 0.114];
  const cy = [0.062, 0.07, 0.076, 0.074, 0.068, 0.058, 0.05, 0.044, 0.039, 0.035, 0.032, 0.03, 0.028];
  const hh = [0.04, 0.052, 0.056, 0.054, 0.048, 0.04, 0.032, 0.026, 0.021, 0.017, 0.013, 0.009, 0.005];
  const hw = [0.022, 0.028, 0.033, 0.036, 0.039, 0.043, 0.046, 0.047, 0.044, 0.037, 0.028, 0.018, 0.009];
  const sides = q(20, 10);
  const shape = outline(sides, 2.4);
  const ring = (i: number, grow = 1) =>
    shape.map(([c, s]) => {
      const heel = s < 0 ? 0.82 : 1;
      const lift = xs[i] > 0.08 ? (xs[i] - 0.08) * 0.18 : 0;
      return v3(xs[i], cy[i] + lift + s * hh[i] * heel * grow, c * hw[i] * grow);
    });
  const upper = loft(xs.map((_, i) => ring(i)), true, true);
  const soleRings = xs.map((x, i) => {
    const toe = i === xs.length - 1 ? 0.004 : 0;
    const heel = i === 0 ? -0.006 : 0;
    return shape.map(([c, s]) => v3(x + heel + toe, 0.016 + s * 0.009, c * (hw[i] * 1.08 + 0.002)));
  });
  const sole = loft(soleRings, true, true);
  const dark: THREE.BufferGeometry[] = [sole];
  if (hi) {
    const mid = (r1: THREE.Vector3[], r2: THREE.Vector3[], f: number) => r1.map((p, k) => p.clone().lerp(r2[k], f));
    for (const [a, b] of [[5, 6], [8, 9]]) {
      const ra = ring(a, 1.035);
      const rb = ring(b, 1.035);
      dark.push(loft([mid(ra, rb, 0.25), mid(ra, rb, 0.7)], false, false));
    }
    dark.push(new THREE.CylinderGeometry(0.013, 0.015, 0.01, 14).rotateZ(-0.28).translate(-0.078, 0.122, 0.004));
    dark.push(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 10).rotateZ(-0.28).translate(-0.078, 0.128, 0.004));
    // Heel counter, pull tab and a pair of carbon ridges under the ball.
    dark.push(sweep(curve([v3(-0.182, 0.05), v3(-0.178, 0.09), v3(-0.16, 0.118)], 6), () => [0.028, 0.01], { sides: 8, exp: 2.8 }));
    dark.push(new THREE.BoxGeometry(0.012, 0.032, 0.022).translate(-0.186, 0.07, 0));
    dark.push(new THREE.BoxGeometry(0.055, 0.006, 0.038).translate(0.02, 0.012, 0));
    dark.push(new THREE.BoxGeometry(0.04, 0.006, 0.03).translate(-0.06, 0.012, 0));
  }
  const pedal = [new THREE.BoxGeometry(0.078, 0.014, 0.072).translate(0.004, -0.003, 0), new THREE.BoxGeometry(0.028, 0.01, 0.058).translate(0.046, 0.002, 0)];
  const cleat = new THREE.BoxGeometry(0.052, 0.009, 0.046).translate(0.006, 0.01, 0);
  return [
    { geom: paint(upper, WHITE, { crease: 1.15 }), mat: 'gloss', tint: 'shoes' },
    { geom: merge(dark.map((g) => paint(g, 0x1b1b1e, { crease: 0.95 }))), mat: 'gloss' },
    { geom: merge([...pedal.map((g) => paint(g, 0x222328, { crease: 0.4 })), paint(cleat, 0xb3261e, { crease: 0.4 })]), mat: 'gloss' },
  ];
}
