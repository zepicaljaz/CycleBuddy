import * as THREE from 'three';
import { markRange, type InstancedModel } from './batch';
import { atDetail, limb, merge, paint, q, v3, type Detail } from './geometry';
import { clip, ellipsoid, isosurface, smax, smin, soup } from './isosurface';
import { keepShared, material, type MatKind, type Model } from './materials';
import { FOOT_Z, HIP, LEG_Z, THIGH } from './riderBody';
import { capped, ellipse, JERSEY_HEM, SPINE, stationsAt, table, torsoField, type Station } from './riderTorso';

/*
 * Pelvis, seat and both thighs down to the knee as one skinned piece.
 *
 * The shorts are a single surface: the waist, the seat and the thighs are blended
 * distance fields meshed in one go, so there are no seams, caps or balls where they meet.
 * The mesh is modelled with the thighs in the middle of the pedal stroke. Every vertex
 * carries a hip weight (`hipW`: minus for the left thigh, plus for the right, 0 for the
 * pelvis), and the vertex shader turns it about its hip joint by that share of the thigh's
 * rotation. The riders layer sets each thigh's rotation per rider from the same knee
 * solve the shins use, so knee, shin and foot line up exactly as before.
 *
 * Rider-local frame as in riderBody: +x forward, +y up, +z right. Metres.
 */

/** Thigh angle below +x that the mesh is modelled at: mid stroke (the thigh swings from -22° to -67°). */
const REST = -0.78;

/** Unit thigh direction at rest, [left, right]. The knee sits between hip and pedal in z, as `solveKnee` puts it. */
export const THIGH_REST: readonly THREE.Vector3[] = [-1, 1].map((side) =>
  v3(THIGH * Math.cos(REST), THIGH * Math.sin(REST), (side * (FOOT_Z - LEG_Z)) / 2).normalize(),
);

/** Shorts hem, metres down the thigh from the hip joint. Bare skin below. */
export const HEM = 0.36;
/** Thigh radius by fraction of its length, shared with the bare skin below the hem. */
const thighR = (t: number) => table([0, 0.35, 0.7, 1], [0.086, 0.08, 0.068, 0.052], t);
/** Lycra sits a few millimetres proud of the skin, so the leg comes out of the hem cleanly. */
const SHORTS_EASE = 0.0032;

/**
 * Shorts under the jersey: the jersey's own torso, from the seat to a few centimetres up under
 * its hem (`JERSEY_HEM` on the spine), scaled in so it stays inside. The far jerseys have fewer,
 * flatter sides, so their shorts sit further in.
 */
const WAIST: Record<Detail, { to: number; scale: number }> = { 0: { to: 0.22, scale: 0.962 }, 1: { to: 0.21, scale: 0.925 }, 2: { to: 0.2, scale: 0.88 } };
/** The waist's lower end is a dome this deep, so no rim shows where it meets the seat. */
const WAIST_DOME = 0.07;

/**
 * Each buttock: a mass behind and below its hip joint. The two run into each other over a
 * wide fillet, so the seat reads as one shape with a shallow valley down the middle.
 */
const GLUTE = { x: -0.338, y: 1.058, z: 0.056, tilt: 0.38, rx: 0.084, ry: 0.076, rz: 0.081 };
const K_GLUTES = 0.035;
/** Top of the saddle under the sit bones, a few millimetres down so the seat rests on it. */
const SADDLE_Y = 0.986;
/** Thighs are a touch narrower side to side at the top, so the saddle nose fits between them. */
const LAT_TOP = 0.83;

/** Fillet between waist and seat, and between the pelvis and each thigh. */
const K_PELVIS = 0.045;
const K_HIP = 0.04;
/** Hip weights ramp from pelvis to thigh over this difference in their distance fields. */
const KW = 0.11;

/** The jersey hem's plane: a point on it and its normal, pointing up the spine. */
const HEM_PLANE = (() => {
  const spine = new THREE.CatmullRomCurve3(SPINE, false, 'centripetal');
  const c = spine.getPoint(JERSEY_HEM);
  const t = spine.getTangent(JERSEY_HEM);
  return { x: c.x, y: c.y, tx: t.x, ty: t.y };
})();

/** Waist cross-sections along the spine from the seat up to the detail level's `to`. */
function stations(detail: Detail): Station[] {
  const { to, scale } = WAIST[detail];
  return stationsAt(Array.from({ length: 21 }, (_, i) => (to * i) / 20), scale);
}

/** Lower torso through the stations: domed at the seat, flat at the top (hidden under the jersey). */
function waist(st: Station[], x: number, y: number, z: number): number {
  return torsoField(st, x, y, z, WAIST_DOME);
}

/** Both buttocks, tilted with the pelvis. */
function seat(x: number, y: number, z: number): number {
  const c = Math.cos(GLUTE.tilt);
  const s = Math.sin(GLUTE.tilt);
  const px = x - GLUTE.x;
  const py = y - GLUTE.y;
  const u = px * c + py * s;
  const v = -px * s + py * c;
  const left = ellipsoid(u, v, z + GLUTE.z, GLUTE.rx, GLUTE.ry, GLUTE.rz);
  const right = ellipsoid(u, v, z - GLUTE.z, GLUTE.rx, GLUTE.ry, GLUTE.rz);
  return smin(left, right, K_GLUTES);
}

/** Waist and seat, flattened where they sit on the saddle. Symmetric in z. */
function pelvis(st: Station[], x: number, y: number, z: number): number {
  return smax(smin(waist(st, x, y, z), seat(x, y, z), K_PELVIS), SADDLE_Y - y, 0.03);
}

/** The thigh starts in a dome above the hip joint, inside the pelvis. */
const THIGH_TOP = -0.03;
const THIGH_DOME = 0.06;
const THIGH_END = HEM + 0.06;

/** Distance along the left thigh's rest axis from the hip joint. */
function alongLeft(x: number, y: number, z: number): number {
  const d = THIGH_REST[0];
  return (x - HIP.x) * d.x + (y - HIP.y) * d.y + (z + LEG_Z) * d.z;
}

/** Left thigh in shorts: a tapered tube, slightly oval at the top, past the hem (the mesh is cut at the hem). */
function thighLeft(x: number, y: number, z: number): number {
  const d = THIGH_REST[0];
  const ox = x - HIP.x;
  const oy = y - HIP.y;
  const oz = z + LEG_Z;
  const u = ox * d.x + oy * d.y + oz * d.z;
  const px = ox - d.x * u;
  const py = oy - d.y * u;
  const pz = oz - d.z * u;
  // Side-to-side axis: +z made square to the thigh.
  const lx = -d.x * d.z;
  const ly = -d.y * d.z;
  const lz = 1 - d.z * d.z;
  const ll = Math.hypot(lx, ly, lz);
  const lat = (px * lx + py * ly + pz * lz) / ll;
  const other = Math.sqrt(Math.max(0, px * px + py * py + pz * pz - lat * lat));
  const uc = Math.max(0, Math.min(THIGH, u));
  const r = thighR(uc / THIGH) + SHORTS_EASE;
  const oval = LAT_TOP + (1 - LAT_TOP) * THREE.MathUtils.smoothstep(uc, 0.08, 0.3);
  const dc = u < THIGH_TOP ? ellipsoid(lat, other, u - THIGH_TOP, r * oval, r, THIGH_DOME) : ellipse(lat, other, r * oval, r);
  return capped(dc, u - THIGH_END);
}

/** The left half's field: pelvis and the left thigh only, so the thighs never join each other. */
function leftField(st: Station[], x: number, y: number, z: number): number {
  return smin(pelvis(st, x, y, z), thighLeft(x, y, z), K_HIP);
}

/** How much a left-half vertex follows the left thigh: 0 on the pelvis, 1 down the thigh. */
function leftWeight(st: Station[], x: number, y: number, z: number): number {
  const ss = THREE.MathUtils.smoothstep;
  // Where the thigh's field wins over the pelvis's, the skin belongs to the thigh. The ramp is
  // wide on purpose: the turn spreads over the hip, so the crease in front never folds over.
  // Worst case is that crease, between the thigh and the jersey's hem: edges stay between
  // 0.37× and 1.7× their length over the stroke (riderHips.test.ts holds 0.3× to 2×).
  let w = ss(pelvis(st, x, y, z) - thighLeft(x, y, z), -KW, KW);
  const u = alongLeft(x, y, z);
  w = Math.max(w, ss(u, 0.1, 0.2));
  w *= ss(u, -0.04, 0.03);
  // The waist from just below the jersey's hem up stays put, or the belly would push out
  // through the jersey when the thigh straightens. Only on the waist itself, not the thigh.
  const aboveHem = (x - HEM_PLANE.x) * HEM_PLANE.tx + (y - HEM_PLANE.y) * HEM_PLANE.ty;
  w *= 1 - ss(aboveHem, -0.015, 0.025) * (1 - ss(waist(st, x, y, z), 0.006, 0.03));
  // Nothing moves on the centre line, where the two halves meet.
  return w * ss(-z, 0.002, 0.018);
}

/** Grid cell of the surface mesh per detail level. Each half is cut and mirrored, so any cell keeps the legs apart. */
const CELL: Record<Detail, number> = { 0: 0.021, 1: 0.038, 2: 0.058 };

/** The shorts: left half meshed and cut at the centre line and the hem, then mirrored. */
function shorts(detail: Detail): THREE.BufferGeometry {
  const st = stations(detail);
  const iso = isosurface((x, y, z) => leftField(st, x, y, z), { min: [-0.49, 0.68, -0.25], max: [0.09, 1.34, 0.04] }, CELL[detail]);
  let half = clip(soup(iso), (_x, _y, z) => z);
  half = clip(half, (x, y, z) => alongLeft(x, y, z) - HEM);
  const n = half.pos.length / 3;
  // Both halves, the right one mirrored in z with its winding turned back.
  const position = new Float32Array(n * 6);
  const normal = new Float32Array(n * 6);
  const weight = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) {
    const x = half.pos[v * 3];
    const y = half.pos[v * 3 + 1];
    const z = Math.min(0, half.pos[v * 3 + 2]);
    let nx = half.nor[v * 3];
    let ny = half.nor[v * 3 + 1];
    let nz = half.nor[v * 3 + 2];
    // On the centre line the surface is symmetric, so its normal has no sideways part.
    if (z > -1e-5) {
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      nz = 0;
    }
    const w = leftWeight(st, x, y, z);
    position.set([x, y, z], v * 3);
    normal.set([nx, ny, nz], v * 3);
    weight[v] = -w;
    const m = n + v - (v % 3) + [0, 2, 1][v % 3];
    position.set([x, y, -z], m * 3);
    normal.set([nx, ny, -nz], m * 3);
    weight[m] = w;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6).fill(1), 3));
  g.setAttribute('hipW', new THREE.BufferAttribute(weight, 1));
  return g;
}

/** Bare thigh from inside the hem to the knee, laid along a rest direction. Moves wholly with its thigh. */
function bareThigh(side: number): THREE.BufferGeometry {
  const sides = q(18, 8);
  const g = merge([
    paint(limb(thighR, sides, q(3, 1), 0.74, 1).scale(1, THIGH, 1), 0xffffff, { crease: 1.2 }),
    paint(new THREE.SphereGeometry(0.05, sides, q(8, 4)).scale(1.05, 1, 0.95).translate(0, THIGH, 0), 0xffffff, { crease: 1.2 }),
  ]);
  const k = side < 0 ? 0 : 1;
  const turn = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), THIGH_REST[k]);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(turn).setPosition(HIP.x, HIP.y, side * LEG_Z));
  g.setAttribute('hipW', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(side), 1));
  return g;
}

/** Shorts (tinted `shorts`) and bare thighs to the knee (tinted `skin`), for `HipPose` to bend. */
export function buildHips(detail: Detail): Model {
  return atDetail(detail, () => [
    { geom: shorts(detail), mat: 'cloth', tint: 'shorts' },
    { geom: merge([bareThigh(-1), bareThigh(1)]), mat: 'matte', tint: 'skin' },
  ]);
}

// Each thigh's rotation is blended from none by the vertex's weight (normalised lerp of
// the quaternion), about that side's hip joint. One axis, one pivot: no candy-wrapper.
const f = (n: number) => n.toFixed(5);
const HIP_PARS = /* glsl */ `
attribute float hipW;
attribute vec4 hipL;
attribute vec4 hipR;
vec4 hipTurn() {
  return normalize(mix(vec4(0.0, 0.0, 0.0, 1.0), hipW < 0.0 ? hipL : hipR, abs(hipW)));
}
vec3 hipRotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
`;
const HIP_NORMAL = /* glsl */ `
objectNormal = hipRotate(hipTurn(), objectNormal);
`;
const HIP_POSITION = /* glsl */ `
{
  vec3 hipPivot = vec3(${f(HIP.x)}, ${f(HIP.y)}, hipW < 0.0 ? ${f(-LEG_Z)} : ${f(LEG_Z)});
  transformed = hipPivot + hipRotate(hipTurn(), transformed - hipPivot);
}
`;

function bent<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${HIP_PARS}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${HIP_NORMAL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${HIP_POSITION}`);
  };
  m.customProgramCacheKey = () => 'rider-hips';
  return keepShared(m);
}

let mats: { surfaces: Partial<Record<MatKind, THREE.Material>>; depth: THREE.MeshDepthMaterial } | null = null;

/** Surfaces for the hips model, and the shadow-pass material that bends the same way. Built once. */
export function hipMaterials(): { surfaces: Partial<Record<MatKind, THREE.Material>>; depth: THREE.MeshDepthMaterial } {
  if (!mats) {
    mats = {
      surfaces: { cloth: bent(material('cloth').clone()), matte: bent(material('matte').clone()) },
      depth: bent(new THREE.MeshDepthMaterial()),
    };
  }
  return mats;
}

/** Per-rider thigh rotations for an instanced hips model: one quaternion per side, from rest to the posed thigh. */
export class HipPose {
  private readonly left: THREE.InstancedBufferAttribute;
  private readonly right: THREE.InstancedBufferAttribute;

  constructor(model: InstancedModel) {
    const identity = (n: number) => {
      const a = new Float32Array(n * 4);
      for (let i = 3; i < a.length; i += 4) a[i] = 1;
      const attr = new THREE.InstancedBufferAttribute(a, 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      return attr;
    };
    this.left = identity(model.capacity);
    this.right = identity(model.capacity);
    const { depth } = hipMaterials();
    for (const { mesh } of model.meshes) {
      mesh.geometry.setAttribute('hipL', this.left);
      mesh.geometry.setAttribute('hipR', this.right);
      mesh.customDepthMaterial = depth;
    }
  }

  set(i: number, left: THREE.Quaternion, right: THREE.Quaternion): void {
    this.left.setXYZW(i, left.x, left.y, left.z, left.w);
    this.right.setXYZW(i, right.x, right.y, right.z, right.w);
  }

  /** Uploads the first n riders. */
  commit(n: number): void {
    if (n <= 0) return;
    markRange(this.left, n * 4);
    markRange(this.right, n * 4);
  }
}
