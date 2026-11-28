import * as THREE from 'three';
import { HOOD_GRIP } from './bikes';
import { curve, sweep, tube, v3, q, type Detail } from './geometry';
import { clip, cull, ellipsoid, isosurface, smin, soup, type Soup } from './isosurface';
import { capped, JERSEY_HEM, stationsAt, table, torsoField, torsoRings, torsoSides, type Station } from './riderTorso';

/*
 * Arms: shoulder and sleeve grow out of the jersey, the bare arm bends through the elbow
 * and flattens into the hand, each as one surface.
 *
 * Sleeve: the jersey's torso and a tapered upper arm are blended distance fields meshed in
 * one go, so the shoulder has a deltoid and an armpit instead of a tube pushed into the
 * jersey. Only the sleeve and its fillet are kept (the torso part lies under the jersey),
 * cut at the sleeve hem, with the cuff band split off for the accent colour.
 * Bare arm: one tube along a smooth line from inside the sleeve, round the elbow, down the
 * forearm and over the hood to the fingertips, its section going from round to the flat hand.
 *
 * The arms do not move against the body (the hands stay on the hoods), so all of this is
 * built once and drawn with the body. Rider-local frame: +x forward, +y up, +z right. Metres.
 */

export const SHOULDER = v3(0.15, 1.34, 0.18);
const UPPER_ARM = 0.29;
const FOREARM = 0.255;

/** Upper arm from 4 cm inside the shoulder joint, so the deltoid bulge is part of the same tube. */
export const upperArmR = (t: number) => table([0, 0.15, 0.32, 0.55, 0.88, 1], [0.05, 0.057, 0.049, 0.043, 0.037, 0.035], t);
const forearmR = (t: number) => table([0, 0.2, 0.6, 1], [0.036, 0.039, 0.033, 0.025], t);
/** Hand over the hood: half width (side to side) and half thickness, wrist to fingertips. */
const handW = (t: number) => table([0, 0.3, 0.6, 1], [0.026, 0.04, 0.041, 0.03], t);
const handH = (t: number) => table([0, 0.3, 0.7, 1], [0.019, 0.021, 0.017, 0.011], t);

/** The sleeve is this much wider than the arm, ends this far down the upper arm (s0 to elbow), and its cuff band starts here. */
export const SLEEVE_SCALE = 1.07;
export const SLEEVE_END = 0.6;
export const CUFF_FROM = 0.53;
/**
 * Fillet where the sleeve meets the jersey (deltoid over the top, armpit underneath). Never
 * narrower than 1.75 grid cells, so the coarse meshes can still follow the armpit's crease.
 */
const kShoulder = (detail: Detail) => Math.max(0.035, CELL[detail] * 1.75);
/** The sleeve starts in a dome this deep, inside the jersey. */
const SLEEVE_DOME = 0.05;

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

export interface ArmJoints {
  /** Shoulder joint. */
  s: THREE.Vector3;
  /** Where the upper arm's tube starts, 4 cm inside the shoulder. */
  s0: THREE.Vector3;
  e: THREE.Vector3;
  wrist: THREE.Vector3;
  /** Middle of the hand on the hood. */
  grip: THREE.Vector3;
}

/** The arm's joints on one side (-1 left, 1 right), hands on the hoods. */
export function armJoints(side: number): ArmJoints {
  const s = SHOULDER.clone().setZ(side * SHOULDER.z);
  const grip = HOOD_GRIP.clone().setZ(side * HOOD_GRIP.z);
  const wrist = grip.clone().add(v3(-0.045, 0.02, 0));
  const e = elbow(s, wrist, UPPER_ARM, FOREARM, side);
  const s0 = s.clone().addScaledVector(e.clone().sub(s).normalize(), -0.04);
  return { s, s0, e, wrist, grip };
}

/** Fraction along the upper arm (s0 to elbow) of a point, and its distance from that axis. */
function upperArmAt(j: ArmJoints, x: number, y: number, z: number): { t: number; u: number; r: number; len: number } {
  const dx = j.e.x - j.s0.x;
  const dy = j.e.y - j.s0.y;
  const dz = j.e.z - j.s0.z;
  const len = Math.hypot(dx, dy, dz);
  const ox = x - j.s0.x;
  const oy = y - j.s0.y;
  const oz = z - j.s0.z;
  const u = (ox * dx + oy * dy + oz * dz) / len;
  const r = Math.sqrt(Math.max(0, ox * ox + oy * oy + oz * oz - u * u));
  return { t: u / len, u, r, len };
}

/** The sleeve on its own: the upper arm's tube a little wider, domed inside the shoulder, past the hem (the mesh is cut there). */
function sleeveField(j: ArmJoints, x: number, y: number, z: number): number {
  const { t, u, r, len } = upperArmAt(j, x, y, z);
  const radius = upperArmR(Math.max(0, Math.min(1, t))) * SLEEVE_SCALE;
  if (u < 0) return ellipsoid(r, 0, u, radius, radius, SLEEVE_DOME);
  return capped(r - radius, u - (SLEEVE_END * len + 0.05));
}

/**
 * The jersey's torso as lofted at this detail level: its rings, straight between them, at the
 * depth of the loft's flat sides (`inset` 0), or pulled in by `inset`. Call inside `atDetail`.
 */
export function jerseyStations(detail: Detail, inset = 0): Station[] {
  const n = torsoRings(JERSEY_HEM, 1, detail === 0);
  const ts = Array.from({ length: n + 1 }, (_, i) => JERSEY_HEM + ((1 - JERSEY_HEM) * i) / n);
  return stationsAt(ts, Math.cos(Math.PI / torsoSides()) - inset);
}

/** The sleeve's fillet runs into the jersey pulled in this much, so it rises out of the loft. */
const FILLET_INSET = 0.012;

/** Grid cell of the sleeve mesh per detail level. */
const CELL: Record<Detail, number> = { 0: 0.017, 1: 0.03, 2: 0.045 };

/** Mirrors a right-side soup to the left: z flipped, winding turned back. */
function mirrored(s: Soup): Soup {
  const pos = s.pos.slice();
  const nor = s.nor.slice();
  for (let t = 0; t < pos.length; t += 9) {
    for (const k of [0, 1, 2]) {
      const src = t + [0, 2, 1][k] * 3;
      const dst = t + k * 3;
      pos[dst] = s.pos[src];
      pos[dst + 1] = s.pos[src + 1];
      pos[dst + 2] = -s.pos[src + 2];
      nor[dst] = s.nor[src];
      nor[dst + 1] = s.nor[src + 1];
      nor[dst + 2] = -s.nor[src + 2];
    }
  }
  return { pos, nor };
}

/** Plain white geometry from a soup, shaded by its own normals (like `paint` output). */
function geometry(parts: Soup[]): THREE.BufferGeometry {
  const pos = parts.flatMap((p) => p.pos);
  const nor = parts.flatMap((p) => p.nor);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
  return g;
}

/** Right sleeve with its shoulder fillet, split into the jersey-coloured part and the cuff band. */
function sleeve(detail: Detail): { jersey: Soup; cuff: Soup } {
  const j = armJoints(1);
  const st = jerseyStations(detail, FILLET_INSET);
  const loft = jerseyStations(detail);
  const k = kShoulder(detail);
  const field = (x: number, y: number, z: number) => smin(torsoField(st, x, y, z), sleeveField(j, x, y, z), k);
  const iso = isosurface(field, { min: [-0.08, 1.02, 0.02], max: [0.36, 1.5, 0.32] }, CELL[detail]);
  // Whatever lies inside the jersey is never seen: the torso part and the foot of the fillet.
  let s = cull(soup(iso), (x, y, z) => torsoField(loft, x, y, z) < -0.0004 || sleeveField(j, x, y, z) - torsoField(st, x, y, z) >= k);
  const { len } = upperArmAt(j, j.e.x, j.e.y, j.e.z);
  const along = (x: number, y: number, z: number) => upperArmAt(j, x, y, z).u;
  s = clip(s, (x, y, z) => along(x, y, z) - SLEEVE_END * len);
  return {
    jersey: clip(s, (x, y, z) => along(x, y, z) - CUFF_FROM * len),
    cuff: clip(s, (x, y, z) => CUFF_FROM * len - along(x, y, z)),
  };
}

/**
 * Bare arm on one side: one tube from inside the sleeve, round the elbow, down the forearm
 * and over the hood to the fingertips. Round on the arm, flattening at the wrist into the hand.
 */
function bareArm(side: number): THREE.BufferGeometry {
  const j = armJoints(side);
  const up = j.e.clone().sub(j.s0);
  const fore = j.wrist.clone().sub(j.e).normalize();
  const START = 0.48;
  const points = [
    j.s0.clone().addScaledVector(up, START),
    j.s0.clone().addScaledVector(up, 0.8),
    j.e,
    j.e.clone().addScaledVector(fore, 0.06),
    j.e.clone().lerp(j.wrist, 0.55),
    j.wrist,
    // Palm on the hood, fingers over the front of it (the hood's horn stays inside the hand) and down the lever.
    j.wrist.clone().add(v3(0.025, -0.006)),
    j.grip.clone().add(v3(0.01, 0.012)),
    j.grip.clone().add(v3(0.036, 0.006)),
    j.grip.clone().add(v3(0.048, -0.024)),
  ];
  const path = curve(points, q(26, 10));
  // Where the elbow and the wrist fall along the path, as fractions of its length.
  const acc = [0];
  for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = acc[acc.length - 1];
  const at = (p: THREE.Vector3) => {
    let best = 0;
    for (let i = 1; i < path.length; i++) if (path[i].distanceTo(p) < path[best].distanceTo(p)) best = i;
    return acc[best] / total;
  };
  const tE = at(j.e);
  const tW = at(j.wrist);
  const ss = THREE.MathUtils.smoothstep;
  return sweep(path, (t) => {
    if (t <= tE) {
      const r = upperArmR(START + ((1 - START) * t) / tE);
      return [r, r];
    }
    if (t <= tW) {
      const f = (t - tE) / (tW - tE);
      const r = forearmR(f);
      // The wrist is a little wider than deep, and meets the hand at the hand's own size.
      const k = ss(f, 0.55, 1);
      return [r + (handW(0) - forearmR(1)) * k, r + (handH(0) - forearmR(1)) * k];
    }
    const f = (t - tW) / (1 - tW);
    return [handW(f), handH(f)];
  }, { sides: q(18, 8) });
}

export interface ArmModels {
  /** Sleeves and their shoulder fillets, white, shaded: tint with the jersey. */
  sleeve: THREE.BufferGeometry;
  /** Sleeve cuff bands, white, shaded: tint with the jersey accent. */
  cuff: THREE.BufferGeometry;
  /** Bare arms and hands, unshaded (paint them with the skin). */
  skin: THREE.BufferGeometry[];
}

/** Both arms at a detail level. Call inside `atDetail`. */
export function buildArms(detail: Detail): ArmModels {
  const right = sleeve(detail);
  const skin: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    skin.push(bareArm(side));
    if (detail === 0) {
      // Thumb round the inside of the hood.
      const j = armJoints(side);
      skin.push(tube(j.wrist.clone().add(v3(0.015, -0.012, -side * 0.025)), j.grip.clone().add(v3(0.012, -0.012, -side * 0.024)), 0.01, 0.008, 6));
    }
  }
  return {
    sleeve: geometry([right.jersey, mirrored(right.jersey)]),
    cuff: geometry([right.cuff, mirrored(right.cuff)]),
    skin,
  };
}
