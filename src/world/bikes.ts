import * as THREE from 'three';
import { atDetail, curve, merge, paint, q, sweep, surface, tube, v3, type Detail } from './geometry';
import type { Model } from './materials';

/** Cosmetic only. Every brand rides exactly the same. */
export type BikeBrand = 'falcora' | 'montvar' | 'corsano' | 'nordvik' | 'zentra';

export interface BrandSpec {
  id: BikeBrand;
  name: string;
  /** Shown in the garage. */
  model: string;
  blurb: string;
  /** Canvas font for the down-tube logo. */
  font: string;
  spacing: number;
  /** Height of the seat cluster. Lower means a more sloping top tube. */
  clusterY: number;
  /** Where the seat stays meet the seat tube, as a height. Equal to clusterY for classic stays. */
  stayY: number;
  /** Half-width across the bike and half-depth in the frame plane, metres. */
  down: [number, number];
  top: [number, number];
  seat: [number, number];
  head: [number, number];
  chainstay: [number, number];
  seatstay: [number, number];
  fork: [number, number];
  /** Ring shape: 2 round, higher is squarer. */
  exp: number;
  /** Wavy fork blades and stays. */
  wave: boolean;
  /** Seat tube bends around the rear wheel. */
  hug: boolean;
  /** Rim depth, metres. */
  rim: number;
  spokes: number;
  tyre: number;
  gumwall: boolean;
  aeroBar: boolean;
  aeroPost: boolean;
  /** Bar tape, saddle and crank colours. Only the crank is tinted per rider. */
  tape: string;
  saddle: string;
  crank: string;
}

export const BRANDS: BrandSpec[] = [
  {
    id: 'montvar', name: 'MONTVAR', model: 'Montvar Ascent SL', blurb: 'Featherweight climber. Slim round tubes, compact frame, shallow rims.',
    font: '800 104px Poppins, sans-serif', spacing: 14,
    clusterY: 0.68, stayY: 0.68, down: [0.018, 0.018], top: [0.0135, 0.0135], seat: [0.0135, 0.0135], head: [0.018, 0.018],
    chainstay: [0.0085, 0.011], seatstay: [0.007, 0.007], fork: [0.0095, 0.0115], exp: 2, wave: false, hug: false,
    rim: 0.028, spokes: 24, tyre: 0.0126, gumwall: false, aeroBar: false, aeroPost: false,
    tape: '#16171a', saddle: '#16171a', crank: '#25262b',
  },
  {
    id: 'corsano', name: 'CORSANO', model: 'Corsano Onda Corsa', blurb: 'Italian racer. Wave fork and stays, gumwall tyres, white tape.',
    font: 'italic 800 112px Poppins, sans-serif', spacing: 3,
    clusterY: 0.8, stayY: 0.8, down: [0.018, 0.026], top: [0.0145, 0.02], seat: [0.015, 0.019], head: [0.02, 0.025],
    chainstay: [0.01, 0.014], seatstay: [0.008, 0.01], fork: [0.011, 0.017], exp: 3.2, wave: true, hug: false,
    rim: 0.045, spokes: 24, tyre: 0.014, gumwall: true, aeroBar: false, aeroPost: false,
    tape: '#f2f0ea', saddle: '#f2f0ea', crank: '#b9bcc2',
  },
  {
    id: 'nordvik', name: 'NORDVIK', model: 'Nordvik Fjell Endurance', blurb: 'Endurance road bike. Chunky square tubes, relaxed stack, 32 mm tyres.',
    font: '900 100px Poppins, sans-serif', spacing: 8,
    clusterY: 0.73, stayY: 0.66, down: [0.026, 0.028], top: [0.019, 0.018], seat: [0.019, 0.02], head: [0.024, 0.027],
    chainstay: [0.013, 0.016], seatstay: [0.01, 0.011], fork: [0.014, 0.017], exp: 3.8, wave: false, hug: false,
    rim: 0.038, spokes: 24, tyre: 0.0164, gumwall: false, aeroBar: false, aeroPost: false,
    tape: '#2b2d33', saddle: '#16171a', crank: '#2b2d33',
  },
  {
    id: 'falcora', name: 'FALCORA', model: 'Falcora Aerofoil', blurb: 'Aero race bike. Kammtail tubes, dropped stays, 60 mm rims.',
    font: 'italic 900 112px Poppins, sans-serif', spacing: 6,
    clusterY: 0.75, stayY: 0.58, down: [0.015, 0.042], top: [0.014, 0.026], seat: [0.014, 0.034], head: [0.02, 0.036],
    chainstay: [0.01, 0.018], seatstay: [0.007, 0.016], fork: [0.01, 0.026], exp: 2.15, wave: false, hug: false,
    rim: 0.06, spokes: 20, tyre: 0.0135, gumwall: false, aeroBar: true, aeroPost: true,
    tape: '#16171a', saddle: '#16171a', crank: '#1d1e22',
  },
  {
    id: 'zentra', name: 'ZENTRA', model: 'Zentra Vortex SLR', blurb: 'Superbike. Seat tube hugs the wheel, truncated airfoils, 70 mm rims.',
    font: 'italic 800 108px Poppins, sans-serif', spacing: 10,
    clusterY: 0.77, stayY: 0.5, down: [0.014, 0.046], top: [0.013, 0.028], seat: [0.013, 0.04], head: [0.018, 0.04],
    chainstay: [0.01, 0.02], seatstay: [0.0065, 0.018], fork: [0.009, 0.03], exp: 2.05, wave: false, hug: true,
    rim: 0.07, spokes: 20, tyre: 0.013, gumwall: false, aeroBar: true, aeroPost: true,
    tape: '#16171a', saddle: '#16171a', crank: '#16171a',
  },
];

export const BRAND_IDS = BRANDS.map((b) => b.id);
export const brandSpec = (id: BikeBrand | string | undefined): BrandSpec => BRANDS.find((b) => b.id === id) ?? BRANDS[0];

// Rider-local frame: +x forward, +y up, +z right. Wheels sit at x = ±0.5.
export const WHEEL_R = 0.34;
export const BB = v3(-0.09, 0.27);
export const REAR_AXLE = v3(-0.5, WHEEL_R);
export const FRONT_AXLE = v3(0.5, WHEEL_R);
export const CRANK = 0.17;
const SEAT_DIR = v3(-0.284, 0.9588);
const HEAD_DIR = v3(-0.2924, 0.9563);
export const HEAD_TOP = v3(0.295, 0.825);
const HEAD_BOTTOM = HEAD_TOP.clone().addScaledVector(HEAD_DIR, -0.15);
export const BAR_CLAMP = v3(0.4, 0.85);
/** Where the hands hold the hoods. */
export const HOOD_GRIP = v3(0.458, 0.884, 0.19);
export const SADDLE_TOP = v3(-0.3, 0.985);

const onSeatTube = (y: number) => BB.clone().addScaledVector(SEAT_DIR, (y - BB.y) / SEAT_DIR.y);

const CARBON = 0x22242a;
const ALLOY = 0x9da2aa;
const WHITE = 0xffffff;

interface TubeOpts {
  exp?: number;
  sides?: number;
  rings?: number;
  via?: THREE.Vector3[];
}

function frameTube(a: THREE.Vector3, b: THREE.Vector3, r0: [number, number], r1: [number, number], o: TubeOpts = {}): THREE.BufferGeometry {
  const pts = [a, ...(o.via ?? []), b];
  const path = curve(pts, o.rings ?? (pts.length > 2 ? 14 : 6));
  return sweep(path, (t) => [r0[0] + (r1[0] - r0[0]) * t, r0[1] + (r1[1] - r0[1]) * t], { sides: o.sides ?? 12, exp: o.exp ?? 2 });
}

/** Two points a third of the way along a-b, pushed apart perpendicular to it in the frame plane. */
function wave(a: THREE.Vector3, b: THREE.Vector3, amount: number): THREE.Vector3[] {
  const d = b.clone().sub(a);
  const n = v3(-d.y, d.x, 0).normalize();
  return [
    a.clone().lerp(b, 0.33).addScaledVector(n, amount),
    a.clone().lerp(b, 0.68).addScaledVector(n, -amount * 0.8),
  ];
}

function lathe(profile: [number, number][], segments: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Flat ring around the z axis at depth z. */
function disc(rIn: number, rOut: number, z: number, thick: number, segments: number): THREE.BufferGeometry {
  return lathe([[rIn, z - thick], [rOut, z - thick], [rOut, z + thick], [rIn, z + thick], [rIn, z - thick]], segments);
}

export interface BikeParts {
  /** Frame, fork, cockpit, and the parts of the wheels that look the same turning or not. */
  frame: Model;
  /** One wheel around its axle, used front and rear. */
  wheel: Model;
  /** Down-tube logos with texture coordinates into the brand atlas. */
  decal: THREE.BufferGeometry | null;
}

/** Bike for one brand at a detail level. Only the close-up level has logos. */
export function buildBike(spec: BrandSpec, detail: Detail, atlasRow: number, atlasRows: number): BikeParts {
  return atDetail(detail, () => bikeAt(spec, detail === 0, atlasRow, atlasRows));
}

function bikeAt(spec: BrandSpec, hi: boolean, atlasRow: number, atlasRows: number): BikeParts {
  const sides = q(16, 8);
  const cluster = onSeatTube(spec.clusterY);
  const stayTop = onSeatTube(spec.stayY);
  const ttFront = HEAD_TOP.clone().addScaledVector(HEAD_DIR, -0.028);
  const dtFront = HEAD_BOTTOM.clone().addScaledVector(HEAD_DIR, 0.035);
  const exp = spec.exp;
  const frame: THREE.BufferGeometry[] = [];

  const seatVia = spec.hug ? [BB.clone().lerp(cluster, 0.45).add(v3(0.03, 0))] : [];
  frame.push(frameTube(BB, cluster.clone().addScaledVector(SEAT_DIR, 0.025), [spec.seat[0] * 1.15, spec.seat[1] * 1.2], spec.seat, { exp, sides, via: seatVia }));
  frame.push(frameTube(dtFront, BB.clone().add(v3(0.015, 0.01)), [spec.down[0], spec.down[1]], [spec.down[0] * 1.15, spec.down[1] * 0.9], { exp, sides }));
  frame.push(frameTube(ttFront, cluster, spec.top, [spec.top[0] * 0.9, spec.top[1] * 0.85], { exp, sides }));
  frame.push(frameTube(HEAD_BOTTOM.clone().addScaledVector(HEAD_DIR, -0.006), HEAD_TOP.clone().addScaledVector(HEAD_DIR, 0.006), [spec.head[0] * 1.12, spec.head[1] * 1.08], spec.head, { exp: Math.min(exp, 2.4), sides: q(16, 8) }));
  // Bottom bracket shell.
  frame.push(tube(BB.clone().setZ(-0.045), BB.clone().setZ(0.045), 0.024, 0.024, q(14, 8)));
  for (const side of [-1, 1]) {
    const drop = REAR_AXLE.clone().setZ(side * 0.067);
    const csMid = v3(-0.3, 0.29, side * 0.058);
    frame.push(frameTube(BB.clone().add(v3(-0.01, 0.0, side * 0.032)), drop, spec.chainstay, [spec.chainstay[0] * 0.75, spec.chainstay[1] * 0.6], { exp: Math.min(exp, 2.6), sides: q(10, 6), via: [csMid], rings: q(10, 4) }));
    const ssTop = stayTop.clone().setZ(side * 0.024).add(v3(-0.008, 0));
    const ssVia = spec.wave ? wave(ssTop, drop, 0.016) : [];
    frame.push(frameTube(ssTop, drop.clone().add(v3(0.006, 0.012)), spec.seatstay, [spec.seatstay[0] * 0.8, spec.seatstay[1] * 0.7], { exp: Math.min(exp, 2.6), sides: q(10, 6), via: ssVia, rings: q(12, 4) }));
    // Dropout.
    frame.push(new THREE.BoxGeometry(0.04, 0.03, 0.007).translate(REAR_AXLE.x + 0.008, REAR_AXLE.y + 0.004, side * 0.068));
    // Fork blade.
    const crown = HEAD_BOTTOM.clone().add(v3(0.004, -0.018, side * 0.046));
    const tip = FRONT_AXLE.clone().setZ(side * 0.051);
    const forkVia = spec.wave ? wave(crown, tip, 0.014) : [crown.clone().lerp(tip, 0.55).add(v3(0.012, 0))];
    frame.push(frameTube(crown, tip.clone().add(v3(-0.004, 0.012)), spec.fork, [spec.fork[0] * 0.75, spec.fork[1] * 0.55], { exp: Math.min(exp, 2.6), sides: q(10, 6), via: forkVia, rings: q(12, 4) }));
    frame.push(new THREE.BoxGeometry(0.028, 0.03, 0.007).translate(FRONT_AXLE.x - 0.004, FRONT_AXLE.y + 0.006, side * 0.052));
  }
  // Fork crown and seat cluster. Aero brands get a wider, flatter crown.
  const crownScale = spec.aeroBar ? [0.038, 0.02, 0.07] : [0.03, 0.022, 0.055];
  frame.push(new THREE.SphereGeometry(1, q(16, 8), q(10, 5)).scale(crownScale[0], crownScale[1], crownScale[2]).translate(HEAD_BOTTOM.x + 0.004, HEAD_BOTTOM.y - 0.012, 0));
  frame.push(new THREE.SphereGeometry(1, q(14, 6), q(10, 4)).scale(spec.seat[1] * 1.05, 0.026, Math.max(spec.seat[0], 0.024) * 1.1).translate(stayTop.x, stayTop.y, 0));
  if (spec.stayY !== spec.clusterY) frame.push(new THREE.SphereGeometry(1, q(12, 6), 5).scale(spec.seat[1], 0.02, spec.seat[0] * 1.05).translate(cluster.x, cluster.y, 0));
  if (hi) {
    // Head-tube badge so the brand name reads even when the down-tube logo is edge-on.
    const badge = new THREE.BoxGeometry(0.004, 0.028, 0.018);
    badge.applyMatrix4(alongDir(HEAD_TOP.clone().addScaledVector(HEAD_DIR, -0.05).add(v3(0.018, 0, 0)), HEAD_DIR));
    frame.push(badge);
  }

  const dark: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  const tape: THREE.BufferGeometry[] = [];
  const saddle: THREE.BufferGeometry[] = [];
  const bottle: THREE.BufferGeometry[] = [];

  // Seatpost and saddle.
  const clamp = onSeatTube(0.945);
  if (spec.aeroPost) {
    dark.push(frameTube(cluster, clamp, [spec.seat[0] * 0.85, spec.seat[1] * 0.8], [spec.seat[0] * 0.85, spec.seat[1] * 0.75], { exp: 2.3, sides }));
  } else {
    dark.push(tube(cluster, clamp, 0.0136, 0.0136, q(10, 6)));
  }
  dark.push(new THREE.BoxGeometry(0.05, 0.016, 0.03).translate(clamp.x, clamp.y + 0.006, 0));
  saddle.push(saddleGeom());
  if (hi) {
    for (const side of [-1, 1]) metal.push(tube(v3(-0.37, 0.958, side * 0.02), v3(-0.2, 0.958, side * 0.016), 0.0025, 0.0025, 4));
  }

  // Steerer, spacers and stem.
  const steerTop = HEAD_TOP.clone().addScaledVector(HEAD_DIR, 0.042);
  dark.push(tube(HEAD_TOP.clone().addScaledVector(HEAD_DIR, 0.004), steerTop, spec.head[0] * 0.95, spec.head[0] * 0.95, q(12, 6)));
  const stemStart = HEAD_TOP.clone().addScaledVector(HEAD_DIR, 0.03);
  if (spec.aeroBar) {
    dark.push(frameTube(stemStart, BAR_CLAMP.clone().add(v3(0.006, 0.002)), [0.017, 0.02], [0.014, 0.012], { exp: 2.6, sides: q(10, 6) }));
  } else {
    dark.push(frameTube(stemStart, BAR_CLAMP, [0.016, 0.017], [0.015, 0.016], { exp: 3, sides: q(10, 6) }));
    dark.push(tube(BAR_CLAMP.clone().setZ(-0.022), BAR_CLAMP.clone().setZ(0.022), 0.019, 0.019, q(10, 6)));
  }
  dark.push(new THREE.CylinderGeometry(0.019, 0.019, 0.01, q(12, 6)).translate(0, 0, 0).applyMatrix4(alongDir(HEAD_TOP.clone().addScaledVector(HEAD_DIR, 0.014))));

  // Handlebar.
  for (const side of [-1, 1]) {
    const z = (zz: number) => side * zz;
    const top = [v3(BAR_CLAMP.x, BAR_CLAMP.y, 0), v3(BAR_CLAMP.x, BAR_CLAMP.y, z(0.12)), v3(BAR_CLAMP.x + 0.005, BAR_CLAMP.y, z(0.165))];
    const drop = [
      v3(BAR_CLAMP.x + 0.03, BAR_CLAMP.y - 0.002, z(0.19)),
      v3(BAR_CLAMP.x + 0.07, BAR_CLAMP.y - 0.01, z(0.195)),
      v3(BAR_CLAMP.x + 0.088, BAR_CLAMP.y - 0.05, z(0.197)),
      v3(BAR_CLAMP.x + 0.075, BAR_CLAMP.y - 0.1, z(0.2)),
      v3(BAR_CLAMP.x + 0.04, BAR_CLAMP.y - 0.122, z(0.2)),
      v3(BAR_CLAMP.x + 0.0, BAR_CLAMP.y - 0.12, z(0.2)),
    ];
    if (spec.aeroBar) {
      dark.push(sweep(curve(top, 6), () => [0.008, 0.024], { sides: q(10, 6), exp: 2.4, ref: v3(0, 1, 0) }));
    } else {
      dark.push(sweep(curve(top, 4), () => [0.0125, 0.0125], { sides: q(10, 6), ref: v3(0, 1, 0) }));
    }
    tape.push(sweep(curve([top[2], ...drop], q(22, 8)), () => [0.0135, 0.0135], { sides: q(10, 6), ref: v3(0, 1, 0) }));
    // Hood and lever.
    const hood = [v3(HOOD_GRIP.x - 0.03, BAR_CLAMP.y + 0.004, z(0.193)), v3(HOOD_GRIP.x + 0.005, BAR_CLAMP.y + 0.022, z(0.194)), v3(HOOD_GRIP.x + 0.03, BAR_CLAMP.y + 0.034, z(0.195)), v3(HOOD_GRIP.x + 0.04, BAR_CLAMP.y + 0.046, z(0.195))];
    dark.push(sweep(curve(hood, q(8, 3)), (t) => [0.013 - t * 0.004, 0.016 - t * 0.006], { sides: q(10, 6), exp: 2.6 }));
    if (hi) dark.push(sweep(curve([v3(HOOD_GRIP.x + 0.032, BAR_CLAMP.y + 0.02, z(0.196)), v3(HOOD_GRIP.x + 0.045, BAR_CLAMP.y - 0.04, z(0.198)), v3(HOOD_GRIP.x + 0.032, BAR_CLAMP.y - 0.1, z(0.2))], 8), (t) => [0.004, 0.009 - t * 0.004], { sides: 6, exp: 2.5 }));
  }

  // Drivetrain that does not turn with the cranks.
  if (hi) {
    const fd = onSeatTube(BB.y + 0.18).add(v3(0.03, 0.0, 0.035));
    dark.push(new THREE.BoxGeometry(0.05, 0.022, 0.012).translate(fd.x, fd.y, fd.z));
    // Rear derailleur and its two pulleys.
    const rd = REAR_AXLE.clone().add(v3(0.0, -0.03, 0.08));
    dark.push(sweep(curve([REAR_AXLE.clone().add(v3(-0.012, -0.004, 0.074)), rd, rd.clone().add(v3(0.012, -0.03, 0.002))], 6), () => [0.006, 0.011], { sides: 6, exp: 2.5 }));
    for (const [px, py] of [[0.01, -0.055], [0.03, -0.12]]) {
      metal.push(new THREE.CylinderGeometry(0.018, 0.018, 0.006, 12).rotateX(Math.PI / 2).translate(REAR_AXLE.x + px, REAR_AXLE.y + py, 0.072));
    }
    // Chain: top run, bottom run up to the jockey wheels.
    const chainZ = 0.046;
    const chain = (pts: THREE.Vector3[]) => metal.push(sweep(pts.map((p) => p.clone().setZ(chainZ)), () => [0.0035, 0.004], { sides: 4, exp: 3 }));
    chain([BB.clone().add(v3(0.005, 0.104)), REAR_AXLE.clone().add(v3(0.004, 0.042))]);
    chain([BB.clone().add(v3(0.005, -0.104)), REAR_AXLE.clone().add(v3(0.03, -0.138))]);
    chain([REAR_AXLE.clone().add(v3(0.014, -0.102)), REAR_AXLE.clone().add(v3(0.03, -0.073))]);
    chain([REAR_AXLE.clone().add(v3(-0.006, -0.044)), REAR_AXLE.clone().add(v3(-0.02, -0.022))]);
    // Disc calipers on the left.
    dark.push(new THREE.BoxGeometry(0.05, 0.026, 0.024).rotateZ(-0.8).translate(FRONT_AXLE.x - 0.055, FRONT_AXLE.y + 0.05, -0.058));
    dark.push(new THREE.BoxGeometry(0.05, 0.026, 0.024).rotateZ(0.8).translate(REAR_AXLE.x + 0.055, REAR_AXLE.y + 0.05, -0.066));
    // Bottle cages and bottles on the down and seat tubes.
    const dtDir = BB.clone().sub(dtFront).normalize();
    const dtUp = v3(dtDir.y, -dtDir.x, 0);
    if (dtUp.y < 0) dtUp.negate();
    const dtMid = dtFront.clone().lerp(BB, 0.58).addScaledVector(dtUp, spec.down[1] + 0.04);
    bottle.push(bottleGeom().applyMatrix4(alongDir(dtMid, dtDir.clone().negate())));
    dark.push(tube(dtMid.clone().addScaledVector(dtUp, -0.036).addScaledVector(dtDir, 0.06), dtMid.clone().addScaledVector(dtUp, -0.036).addScaledVector(dtDir, -0.06), 0.004, 0.004, 4));
    const stDir = SEAT_DIR.clone();
    const stFront = v3(stDir.y, -stDir.x, 0);
    const stMid = BB.clone().addScaledVector(stDir, 0.25).addScaledVector(stFront, spec.seat[1] + 0.04 + (spec.hug ? 0.02 : 0));
    bottle.push(bottleGeom().applyMatrix4(alongDir(stMid, stDir)));
    dark.push(tube(stMid.clone().addScaledVector(stFront, -0.036).addScaledVector(stDir, -0.06), stMid.clone().addScaledVector(stFront, -0.036).addScaledVector(stDir, 0.06), 0.004, 0.004, 4));
  }

  // Rotors and cassette are round enough to stay still while the wheels turn.
  const chrome: THREE.BufferGeometry[] = [];
  if (hi) {
    for (const [axle, z] of [[FRONT_AXLE, -0.05], [REAR_AXLE, -0.058]] as const) {
      chrome.push(disc(0.052, 0.08, z, 0.0011, 32).translate(axle.x, axle.y, 0));
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        chrome.push(new THREE.BoxGeometry(0.036, 0.007, 0.002).translate(0.034, 0, 0).rotateZ(a).translate(axle.x, axle.y, z));
      }
    }
    const steps: [number, number][] = [[0.016, 0.024]];
    for (let k = 0; k <= 5; k++) {
      const r = 0.062 - k * 0.0075;
      const z = 0.024 + k * 0.0075;
      steps.push([r, z], [r, z + 0.005]);
    }
    steps.push([0.016, 0.024 + 6 * 0.0075]);
    chrome.push(lathe(steps, 20).translate(REAR_AXLE.x, REAR_AXLE.y, 0));
  }

  const frameModel: Model = [
    { geom: merge(frame.map((g) => paint(g, WHITE, { crease: 1.1 }))), mat: 'paint', tint: 'frame' },
    { geom: merge([...dark.map((g) => paint(g, CARBON, { crease: 0.9 })), ...saddle.map((g) => paint(g, spec.saddle, { crease: 0.9 }))]), mat: 'gloss' },
    { geom: merge(tape.map((g) => paint(g, spec.tape, { crease: 1 }))), mat: 'matte' },
  ];
  if (metal.length) frameModel.push({ geom: merge(metal.map((g) => paint(g, 0x5a5d64, { crease: 0.9 }))), mat: 'metal' });
  if (chrome.length) frameModel.push({ geom: merge(chrome.map((g) => paint(g, ALLOY, { crease: 0.5 }))), mat: 'chrome' });
  if (bottle.length) frameModel.push({ geom: merge(bottle.map((g) => paint(g, WHITE, { crease: 0.9 }))), mat: 'gloss', tint: 'bottle' });

  return {
    frame: frameModel,
    wheel: wheelModel(spec, hi),
    decal: hi ? downTubeDecal(spec, dtFront, BB.clone().add(v3(0.015, 0.01)), atlasRow, atlasRows) : null,
  };
}

/** Matrix that turns +y to point along `dir`, placed at `pos`. */
function alongDir(pos: THREE.Vector3, dir = HEAD_DIR): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), dir.clone().normalize());
  return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
}

function saddleGeom(): THREE.BufferGeometry {
  // Nose at the front, wide flat tail at the back. Top surface at SADDLE_TOP.y.
  const n = q(12, 6);
  const pts = [v3(-0.395, 0.972), v3(-0.38, 0.978), v3(-0.34, 0.979), v3(-0.29, 0.976), v3(-0.24, 0.972), v3(-0.19, 0.971), v3(-0.15, 0.966)];
  const width = [0.06, 0.07, 0.068, 0.05, 0.028, 0.02, 0.012];
  const path = curve(pts, n);
  return sweep(path, (t) => {
    const i = Math.min(width.length - 2, Math.floor(t * (width.length - 1)));
    const f = t * (width.length - 1) - i;
    return [width[i] + (width[i + 1] - width[i]) * f, 0.011 + (1 - t) * 0.003];
  }, { sides: q(12, 6), exp: 3.2 });
}

function bottleGeom(): THREE.BufferGeometry {
  const prof: [number, number][] = [[0, -0.1], [0.033, -0.1], [0.036, -0.09], [0.035, -0.02], [0.031, 0.0], [0.035, 0.03], [0.036, 0.075], [0.03, 0.09], [0.013, 0.1], [0.012, 0.115], [0, 0.118]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12);
  return g;
}

function wheelModel(spec: BrandSpec, hi: boolean): Model {
  const R = WHEEL_R;
  const tw = spec.tyre;
  const seg = q(64, 24);
  const depth = spec.rim;
  const rimTop = R - tw * 1.75;
  const rimBot = rimTop - depth;
  const tyres: THREE.BufferGeometry[] = [new THREE.TorusGeometry(R - tw, tw, q(8, 5), seg)];
  const walls: THREE.BufferGeometry[] = [];
  if (spec.gumwall) {
    for (const side of [-1, 1]) walls.push(disc(R - tw * 1.75, R - tw * 0.55, side * tw * 0.82, 0.0012, seg));
  }
  const rimW = tw * 0.82;
  const rim = lathe([
    [rimTop + 0.001, rimW],
    [rimTop - depth * 0.25, rimW * 1.06],
    [rimTop - depth * 0.7, rimW * 0.92],
    [rimBot + 0.004, rimW * 0.5],
    [rimBot, 0],
    [rimBot + 0.004, -rimW * 0.5],
    [rimTop - depth * 0.7, -rimW * 0.92],
    [rimTop - depth * 0.25, -rimW * 1.06],
    [rimTop + 0.001, -rimW],
    [rimTop + 0.001, rimW],
  ], seg);
  const hub: THREE.BufferGeometry[] = [];
  const hubLen = 0.06;
  hub.push(new THREE.CylinderGeometry(0.017, 0.017, hubLen * 2, q(12, 6)).rotateX(Math.PI / 2));
  for (const side of [-1, 1]) hub.push(disc(0.012, 0.028, side * 0.03, 0.002, q(12, 6)));
  if (hi) {
    for (let k = 0; k < spec.spokes; k++) {
      const a = (k / spec.spokes) * Math.PI * 2;
      const side = k % 2 === 0 ? 1 : -1;
      const lean = side * 0.06;
      const h = v3(Math.cos(a + lean) * 0.027, Math.sin(a + lean) * 0.027, side * 0.03);
      const r = v3(Math.cos(a) * (rimBot + 0.003), Math.sin(a) * (rimBot + 0.003), side * 0.002);
      hub.push(tube(h, r, 0.0016, 0.0014, 3, false));
    }
  }
  const model: Model = [
    { geom: merge(tyres.map((g) => paint(g, 0x1c1c1f, { crease: 1.2 }))), mat: 'rubber' },
    { geom: paint(rim, WHITE, { crease: 1.1 }), mat: 'paint', tint: 'wheels' },
    { geom: merge(hub.map((g) => paint(g, 0x2a2c31, { crease: 1 }))), mat: 'metal' },
  ];
  if (walls.length) model.push({ geom: merge(walls.map((g) => paint(g, 0xb38a5a, { crease: 1 }))), mat: 'rubber' });
  return model;
}

/**
 * Logo strips on both sides of the down tube. On the right the text reads from the
 * bottom bracket up to the head tube; on the left from the head tube down, so both
 * sides read left to right.
 */
function downTubeDecal(spec: BrandSpec, front: THREE.Vector3, back: THREE.Vector3, row: number, rows: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const dir = back.clone().sub(front);
  const T = dir.clone().normalize();
  const N = v3(T.y, -T.x, 0);
  if (N.y < 0) N.negate();
  const [w0, h0] = spec.down;
  const v0 = 1 - (row + 1) / rows;
  const v1 = 1 - row / rows;
  for (const side of [-1, 1]) {
    const g = surface(24, 6, (u, v) => {
      // u runs along the logo, v from the bottom of the letters to the top.
      const along = side > 0 ? 0.86 - u * 0.6 : 0.26 + u * 0.6;
      const c = front.clone().lerp(back, along);
      const ang = (v - 0.5) * 1.5;
      const w = w0 * (1 + 0.15 * along) * 1.06 + 0.0006;
      const h = h0 * (1 - 0.1 * along) * 1.04 + 0.0006;
      const e = 2 / spec.exp;
      const cs = Math.pow(Math.cos(ang), e);
      const sn = Math.sign(Math.sin(ang)) * Math.pow(Math.abs(Math.sin(ang)), e);
      return c.addScaledVector(v3(0, 0, side), w * cs).addScaledVector(N, h * sn);
    }, true);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + (v1 - v0) * uv.getY(i));
    const flat = g.toNonIndexed();
    flat.computeVertexNormals();
    parts.push(flat);
  }
  const out = mergeUv(parts);
  return out;
}

function mergeUv(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const p of parts) {
    pos.push(...(p.getAttribute('position').array as Float32Array));
    nor.push(...(p.getAttribute('normal').array as Float32Array));
    uv.push(...(p.getAttribute('uv').array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Crank arms, spider, chainrings and pedal axles. Right arm points along +x before posing. */
export function crankModel(detail: Detail): Model {
  return atDetail(detail, () => crankAt(detail === 0));
}

function crankAt(hi: boolean): Model {
  const parts: THREE.BufferGeometry[] = [];
  const rings: THREE.BufferGeometry[] = [];
  const s = hi ? 1 : 0;
  for (const side of [-1, 1]) {
    const dirX = side;
    const z0 = side * 0.062;
    parts.push(sweep(curve([v3(0, 0, z0), v3(dirX * 0.09, 0, side * 0.068), v3(dirX * CRANK, 0, side * 0.074)], q(6, 2)), (t) => [0.0085, 0.02 - t * 0.007], { sides: q(8, 5), exp: 2.6, ref: v3(0, 0, 1) }));
    parts.push(tube(v3(dirX * CRANK, 0, side * 0.07), v3(dirX * CRANK, 0, side * 0.112), 0.006, 0.006, q(8, 4)));
  }
  parts.push(tube(v3(0, 0, -0.07), v3(0, 0, 0.07), 0.012, 0.012, q(10, 5)));
  if (s) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      parts.push(new THREE.BoxGeometry(0.07, 0.012, 0.006).translate(0.035, 0, 0).rotateZ(a).translate(0, 0, 0.054));
    }
  }
  rings.push(disc(0.088, 0.106, 0.05, 0.0015, q(48, 18)));
  rings.push(disc(0.06, 0.074, 0.043, 0.0015, q(36, 14)));
  return [
    { geom: merge(parts.map((g) => paint(g, WHITE, { crease: 0.9 }))), mat: 'metal', tint: 'crank' },
    { geom: merge(rings.map((g) => paint(g, 0x3a3c42, { crease: 0.6 }))), mat: 'metal' },
  ];
}

/** Brand logos stacked in rows: white letters on clear, tinted per rider. */
export function brandAtlas(): { texture: THREE.CanvasTexture; rows: number } {
  const rows = BRANDS.length;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128 * rows;
  const ctx = canvas.getContext('2d')!;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    BRANDS.forEach((b, i) => {
      ctx.save();
      ctx.font = b.font;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      const letters = [...b.name];
      const widths = letters.map((l) => ctx.measureText(l).width);
      const total = widths.reduce((a, w) => a + w, 0) + b.spacing * (letters.length - 1);
      const scale = Math.min(1, 980 / total);
      ctx.translate(512, i * 128 + 66);
      ctx.scale(scale, 1);
      let x = -total / 2;
      letters.forEach((l, k) => {
        ctx.fillText(l, x, 0);
        x += widths[k] + b.spacing;
      });
      ctx.restore();
    });
  };
  draw();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  // Web fonts may still be loading on the first draw.
  if (document.fonts) {
    Promise.all(BRANDS.map((b) => document.fonts.load(b.font)))
      .then(() => {
        draw();
        texture.needsUpdate = true;
      })
      .catch(() => {});
  }
  return { texture, rows };
}

/** Logo colour that reads against the frame: the jersey accent if it stands out, otherwise black or white. */
export function decalColor(frame: string, accent: string): string {
  const lum = (hex: string) => {
    const c = new THREE.Color(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  };
  const lf = lum(frame);
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (ratio(lf, lum(accent)) > 2.6) return accent;
  return lf > 0.35 ? '#141518' : '#ffffff';
}
