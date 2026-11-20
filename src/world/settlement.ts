import * as THREE from 'three';
import { ROUTE_DS } from '../routes/route';
import { lerp, smoothstep } from '../util/math';
import { building, type Building, type BuildingKind } from './buildings';
import { placement, v3 } from './geometry';
import { bench, bin, fountain, gardenTree, hedge, picketFence, planter, railFence, roadStrip, roadWall, signPost, streetLamp, trafficPole, UPDATE_RANGE, type Props } from './props';
import type { Junction, TownSpan } from './scenery';
import { curtain, EDGE, FRONT, Frame, KERB, patch, Site, weighted, type Style, type Weights } from './site';
import { keepShared } from './materials';
import { textTexture } from './textures';

/** A stop line at a traffic light. Cars heading `dir` wait before `s` while `red`. */
export interface Signal {
  s: number;
  dir: 1 | -1;
  red: boolean;
}

const STREET = 3;

const PAVING = 0xa9a49a;
const KERBSTONE = 0xcac6bd;
const PAVE_SIDE = 0x8f8b83;
const ASPHALT = 0x5f5e5d;
const LOT = 0x575756;
const LINE = 0xe9e7df;
const PLAZA = 0xcbc2b2;
const PATH = 0xbcb2a2;

/** Grassland foliage, the same olive as the moor grass. */
const MOOR_GREEN = 0x6a7040;

/** Broadleaf garden trees stay off spruce plots. Those worlds are spruce only. */
function placeGardenTree(site: Site, x: number, y: number, z: number, yaw: number, variant: number): void {
  if (site.route.def.scenery.biome === 'spruce') return;
  site.props.place(gardenTree(variant, site.style === 'moor'), placement(x, y, z, yaw));
}

function plotHedge(site: Site) {
  return site.style === 'moor' ? hedge(MOOR_GREEN) : hedge();
}

function plotPlanter(site: Site) {
  return site.style === 'moor' ? planter(MOOR_GREEN) : planter();
}

const SOUTHERN: [Weights, Weights, Weights] = [
  [['townhouse', 5], ['shop', 4], ['gablefront', 1]],
  [['townhouse', 4], ['house', 4], ['gablefront', 2]],
  [['house', 5], ['cottage', 2], ['modern', 3]],
];

/** Street frontage by distance from the town centre: centre, middle, edge. */
const TOWN_KINDS: Record<Style, [Weights, Weights, Weights]> = {
  alpine: [
    [['townhouse', 4], ['shop', 4], ['gablefront', 2]],
    [['townhouse', 3], ['gablefront', 3], ['house', 4]],
    [['house', 4], ['cottage', 3], ['modern', 2]],
  ],
  mediterranean: SOUTHERN,
  limestone: SOUTHERN,
  moor: [
    [['townhouse', 5], ['shop', 3], ['cottage', 2]],
    [['cottage', 4], ['house', 4], ['townhouse', 2]],
    [['cottage', 5], ['house', 5]],
  ],
  desert: [
    [['shop', 4], ['adobe', 6]],
    [['adobe', 8], ['modern', 2]],
    [['adobe', 7], ['modern', 3]],
  ],
};

const YARD_KINDS: Record<Style, Weights> = {
  alpine: [['house', 3], ['cottage', 2], ['gablefront', 2], ['modern', 1.2], ['farmhouse', 1.5], ['villa', 1.2], ['duplex', 0.8]],
  mediterranean: [['house', 3], ['cottage', 2], ['gablefront', 1.5], ['modern', 2], ['villa', 1.8], ['duplex', 1]],
  limestone: [['house', 3.5], ['cottage', 2.5], ['modern', 2.5], ['villa', 1.5], ['duplex', 1]],
  moor: [['cottage', 5], ['house', 3], ['modern', 1.2], ['duplex', 1.2]],
  desert: [['adobe', 7], ['modern', 2.2], ['villa', 0.8]],
};

const BACK_ROW: Record<Style, Weights> = {
  alpine: [['apartment', 3], ['house', 1], ['gablefront', 1], ['duplex', 0.8]],
  mediterranean: [['apartment', 3], ['house', 1], ['townhouse', 1], ['villa', 0.6]],
  limestone: [['apartment', 3], ['house', 1], ['duplex', 0.7]],
  moor: [['apartment', 1], ['cottage', 2], ['house', 1], ['duplex', 1]],
  desert: [['apartment', 1], ['adobe', 3], ['modern', 1]],
};

const DRIVE: Record<Style, number[]> = {
  alpine: [0x9d9483, 0x58595c, 0x8e8a84],
  mediterranean: [0xb9a58a, 0x5a5a5c, 0xa89a86],
  limestone: [0xc4b59b, 0x5a5a5c],
  moor: [0x8e8a80, 0x56575a],
  desert: [0xc2a27a, 0xb39470],
};

type Fence = 'rail' | 'picket' | 'hedge' | null;
const FENCES: Record<Style, [Fence, number][]> = {
  alpine: [['rail', 5], ['hedge', 3], ['picket', 2]],
  mediterranean: [['hedge', 6], ['picket', 2], [null, 2]],
  limestone: [['hedge', 6], [null, 4]],
  moor: [['hedge', 5], ['rail', 5]],
  desert: [[null, 1]],
};

// --------------------------------------------------------------------------------------- traffic lights

const CYCLE = 42;
const LENS = new THREE.CircleGeometry(0.095, 14).rotateY(Math.PI / 2);
const ON = [new THREE.Color(0.25, 3.4, 1.7), new THREE.Color(4.2, 2.0, 0.15), new THREE.Color(4.6, 0.25, 0.12)];
const OFF = [new THREE.Color(0.05, 0.1, 0.07), new THREE.Color(0.13, 0.08, 0.02), new THREE.Color(0.13, 0.03, 0.03)];

/** 0 green, 1 amber, 2 red for the main road (group 0) or the side street (group 1). */
function lightState(t: number, group: number): number {
  if (group === 0) return t < 22 ? 0 : t < 25 ? 1 : 2;
  return t >= 27 && t < 37 ? 0 : t >= 37 && t < 40 ? 1 : 2;
}

class Lights {
  private lenses: { m: THREE.Matrix4; town: number; group: number; color: number }[] = [];
  private towns: { t: number; signals: { sig: Signal; group: number }[] }[] = [];

  town(phase: number): number {
    this.towns.push({ t: phase, signals: [] });
    return this.towns.length - 1;
  }

  pole(site: Site, town: number, group: number, x: number, y: number, z: number, yaw: number, arm: number): void {
    const m = placement(x, y, z, yaw);
    site.props.place(trafficPole(arm), m);
    for (let i = 0; i < 3; i++) {
      this.lenses.push({ m: m.clone().multiply(new THREE.Matrix4().makeTranslation(0.14, 2.45 + i * 0.3, 0)), town, group, color: i });
      if (arm > 0) this.lenses.push({ m: m.clone().multiply(new THREE.Matrix4().makeTranslation(0.14, 3.4 + i * 0.3, arm)), town, group, color: i });
    }
  }

  signal(town: number, group: number, sig: Signal): void {
    this.towns[town].signals.push({ sig, group });
  }

  finish(props: Props): void {
    if (!this.lenses.length) return;
    const mesh = new THREE.InstancedMesh(LENS, new THREE.MeshBasicMaterial(), this.lenses.length);
    mesh.name = 'traffic-lights';
    this.lenses.forEach((l, i) => mesh.setMatrixAt(i, l.m));
    mesh.computeBoundingSphere();
    props.group.add(mesh);
    const shown = new Int8Array(this.lenses.length).fill(-1);
    // Centre of each town's lights. Lenses are recoloured only near the camera;
    // the timing (which cars obey) runs everywhere.
    const centre = this.towns.map(() => ({ x: 0, z: 0, n: 0 }));
    for (const l of this.lenses) {
      const c = centre[l.town];
      c.x += l.m.elements[12];
      c.z += l.m.elements[14];
      c.n++;
    }
    for (const c of centre) if (c.n) { c.x /= c.n; c.z /= c.n; }
    const near = new Uint8Array(this.towns.length);
    const r2 = UPDATE_RANGE * UPDATE_RANGE;
    const update = (dt: number, eye?: THREE.Vector3) => {
      for (const t of this.towns) {
        t.t = (t.t + dt) % CYCLE;
        for (const s of t.signals) s.sig.red = lightState(t.t, s.group) !== 0;
      }
      let any = false;
      centre.forEach((c, k) => {
        const dx = c.x - (eye?.x ?? c.x);
        const dz = c.z - (eye?.z ?? c.z);
        near[k] = dx * dx + dz * dz <= r2 ? 1 : 0;
        if (near[k]) any = true;
      });
      if (!any) return;
      let dirty = false;
      this.lenses.forEach((l, i) => {
        if (!near[l.town]) return;
        const lit = lightState(this.towns[l.town].t, l.group) === l.color ? 1 : 0;
        if (shown[i] === lit) return;
        shown[i] = lit;
        mesh.setColorAt(i, (lit ? ON : OFF)[l.color]);
        dirty = true;
      });
      if (dirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    update(0);
    props.onUpdate(update);
  }
}

// --------------------------------------------------------------------------------------- signs

const signMats = new Map<string, THREE.MeshStandardMaterial>();
function signMat(key: string, make: () => THREE.Texture): THREE.MeshStandardMaterial {
  let m = signMats.get(key);
  if (!m) signMats.set(key, (m = keepShared(new THREE.MeshStandardMaterial({ map: make(), roughness: 0.6 }))));
  return m;
}

const signBacks = new Map<number, THREE.MeshStandardMaterial>();
function signBack(color: number): THREE.MeshStandardMaterial {
  let m = signBacks.get(color);
  if (!m) signBacks.set(color, (m = keepShared(new THREE.MeshStandardMaterial({ color, roughness: 0.6 }))));
  return m;
}

/** A board on two posts. The lettering is on the face toward yaw; the back is blank. */
function board(site: Site, x: number, y: number, z: number, yaw: number, w: number, h: number, mat: THREE.Material, postH: number, backColor: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  for (const k of w > 1 ? [-0.42, 0.42] : [0]) {
    site.props.place(signPost(), placement(x + c * k * w, y, z - s * k * w, yaw, 1).multiply(new THREE.Matrix4().makeScale(1, postH / 2.6, 1)));
  }
  const back = signBack(backColor);
  // Box faces: +x, -x, +y, -y, +z, -z. The +z face is the one riders read.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), [back, back, back, back, mat, back]);
  mesh.position.set(x, y + postH - h / 2 + 0.05, z);
  mesh.rotation.y = yaw;
  mesh.castShadow = true;
  site.props.group.add(mesh);
}

// --------------------------------------------------------------------------------------- towns

/** Everything a town needs along its street. */
function buildTown(site: Site, town: TownSpan, junctions: Junction[], lights: Lights, signals: Signal[]): void {
  const { route, rng } = site;
  const sc = (town.s0 + town.s1) / 2;
  const half = (town.s1 - town.s0) / 2;
  const gaps: Record<number, [number, number][]> = { [-1]: [], [1]: [] };
  const reserved: Record<number, [number, number][]> = { [-1]: [], [1]: [] };
  const id = lights.town(rng() * CYCLE);
  const top = (s: number) => site.roadY(s) + KERB;
  for (const j of junctions) {
    const js = j.idx * ROUTE_DS;
    if (js > town.s0 - 10 && js < town.s1 + 10) {
      gaps[j.side].push([js - 2.7, js + 2.7]);
      reserved[j.side].push([js - 4, js + 4]);
    }
  }

  // Side street at the centre, on whichever side has room.
  let ss: 1 | -1 = rng() < 0.5 ? 1 : -1;
  let street = streetFits(site, sc, ss);
  if (!street) {
    ss = -ss as 1 | -1;
    street = streetFits(site, sc, ss);
  }
  const cs = -ss as 1 | -1;
  if (street) {
    gaps[ss].push([sc - STREET, sc + STREET]);
    reserved[ss].push([sc - STREET - 1, sc + STREET + 1]);
    site.occupyStrip(sc - STREET - 1.6, sc + STREET + 1.6, EDGE, EDGE + street, ss, 1);
  }

  // Church on a square, opposite the side street if it can.
  const tries: [number, 1 | -1][] = [
    [sc, cs], [sc - 36, cs], [sc + 36, cs], [sc - 52, cs], [sc + 52, cs],
    [sc - 38, ss], [sc + 38, ss], [sc - 20, cs], [sc + 20, ss], [sc, ss],
  ];
  for (const [s, side] of tries) {
    if (Math.abs(s - sc) > half - 14) continue;
    const span = churchSquare(site, s, side);
    if (span) {
      reserved[side].push(span);
      break;
    }
  }

  // Car park near one end of town.
  for (const [a, side] of [[town.s0 + 6, cs], [town.s1 - 42, cs], [town.s0 + 6, ss], [town.s1 - 42, ss], [sc + 48, cs], [sc - 70, ss]] as [number, 1 | -1][]) {
    if (reserved[side].some(([r0, r1]) => a + 36 > r0 && a < r1)) continue;
    if (carPark(site, a, side)) {
      reserved[side].push([a, a + 36]);
      gaps[side].push([a + 1, a + 7.5]);
      break;
    }
  }

  // Zebra crossings either side of the junction, and at both ends of town.
  const marks = (g: THREE.BufferGeometry) => site.add(g, LINE, 'marks', 0.02, 0);
  const zebra = (s: number) => {
    for (let l = -EDGE + 0.45; l < EDGE - 0.6; l += 1) marks(roadStrip(route, s - 1.5, s + 1.5, l, l + 0.5, (ss2) => site.roadY(ss2) + 0.008, 3));
  };
  for (const s of [sc - 10.5, sc + 10.5]) zebra(s);
  for (const s of [town.s0 + 10, town.s1 - 10]) if (half > 70) zebra(s);

  // Stop lines and lights for both directions.
  const stopA = sc - 13.5;
  const stopB = sc + 13.5;
  marks(roadStrip(route, stopA - 0.2, stopA + 0.2, 0.1, EDGE - 0.2, (s) => site.roadY(s) + 0.008, 1));
  marks(roadStrip(route, stopB - 0.2, stopB + 0.2, -EDGE + 0.2, -0.1, (s) => site.roadY(s) + 0.008, 1));
  const sigA: Signal = { s: stopA, dir: 1, red: false };
  const sigB: Signal = { s: stopB, dir: -1, red: false };
  signals.push(sigA, sigB);
  lights.signal(id, 0, sigA);
  lights.signal(id, 0, sigB);
  {
    const a = site.at(stopA - 0.4, EDGE + 0.55);
    lights.pole(site, id, 0, a.x, top(stopA), a.z, Math.atan2(a.tz, -a.tx), 2.6);
    const b = site.at(stopB + 0.4, -EDGE - 0.55);
    lights.pole(site, id, 0, b.x, top(stopB), b.z, Math.atan2(-b.tz, b.tx), 2.6);
  }
  if (street) sideStreet(site, sc, ss, street, lights, id);

  // Pavements with kerbs, broken at the side street and the car park entrance.
  for (const side of [-1, 1] as const) {
    let a = town.s0 - 6;
    const cuts = [...gaps[side]].sort((p, q) => p[0] - q[0]);
    for (const [g0, g1] of [...cuts, [town.s1 + 6, Infinity] as [number, number]]) {
      if (g0 - a > 0.5) pavement(site, a, g0, side);
      a = g1;
    }
  }

  // Lamps, bins and benches on the pavement.
  const busy = (side: number, s: number, pad: number) =>
    gaps[side].some(([g0, g1]) => s > g0 - pad && s < g1 + pad) || Math.abs(s - stopA) < 2 || Math.abs(s - stopB) < 2 || Math.abs(s - sc + 10.5) < 2.5 || Math.abs(s - sc - 10.5) < 2.5;
  for (const side of [-1, 1] as const) {
    let k = 0;
    for (let s = town.s0 - 4 + (side > 0 ? 0 : 12); s < town.s1 + 4; s += 24, k++) {
      if (busy(side, s, 1.5)) continue;
      const p = site.at(s, side * (EDGE + 0.45));
      site.props.place(streetLamp(), placement(p.x, top(s), p.z, site.facing(s, side)));
      if (k % 2 === 0 && !busy(side, s + 1.3, 1)) {
        const q = site.at(s + 1.3, side * (EDGE + 0.5));
        site.props.place(bin(), placement(q.x, top(s), q.z, 0));
      }
    }
  }

  // The street frontage, densest at the centre.
  const kinds = TOWN_KINDS[site.style];
  for (const side of [-1, 1] as const) {
    let s = town.s0 + 2 + rng() * 3;
    let benches = 0;
    while (s < town.s1 - 4) {
      const block = reserved[side].find(([r0, r1]) => s < r1 && s + 5 > r0);
      if (block) {
        s = block[1] + 0.6;
        continue;
      }
      const dc = Math.abs(s - sc) / half;
      const kind = weighted(rng(), kinds[dc < 0.45 ? 0 : dc < 0.8 ? 1 : 2]);
      const b = building(kind, Math.floor(rng() * 6));
      const end = s + b.w;
      const hit = reserved[side].find(([r0, r1]) => end > r0 && s < r1);
      if (hit) {
        s = hit[1] + 0.6;
        continue;
      }
      const dense = kind === 'shop' || kind === 'townhouse';
      const setback = kind === 'shop' ? 0.1 : dense ? 0.3 + rng() * 0.9 : 2.6 + rng() * 2.4;
      const mid = s + b.w / 2;
      const spot = site.put(b, mid, side, FRONT + setback, { floor: top(mid) + 0.02 });
      if (spot && setback > 2) frontGarden(site, mid, side, b, setback);
      if (spot && kind === 'shop' && benches < 2 && rng() < 0.35 && !busy(side, mid, 2)) {
        const p = site.at(mid + 2.2, side * (FRONT - 0.5));
        site.props.place(rng() < 0.5 ? bench() : plotPlanter(site), placement(p.x, top(mid), p.z, site.facing(mid, side)));
        benches++;
      }
      s = end + (dense ? 0.25 + rng() * 0.9 : 1.8 + rng() * 2.4) + (spot ? 0 : 2);
    }
  }

  // Apartment blocks behind, and a tower in the bigger towns.
  const back = BACK_ROW[site.style];
  for (let i = 0; i < Math.round(half / 40) * 2; i++) {
    const side = i % 2 ? 1 : -1;
    const b = building(weighted(rng(), back), Math.floor(rng() * 6));
    const s = town.s0 + 12 + rng() * (2 * half - 24);
    const front = FRONT + 18 + rng() * 6;
    if (site.put(b, s, side, front, { minRoad: front - 1.5 })) backLot(site, s, side, front, b);
  }
  if (half > 95 && site.style !== 'moor') {
    for (let i = 0; i < 6; i++) {
      const s = town.s0 + 20 + rng() * (2 * half - 40);
      const front = FRONT + 22 + rng() * 6;
      if (site.put(building('tower', Math.floor(rng() * 4)), s, rng() < 0.5 ? 1 : -1, front, { minRoad: front - 1.5 })) break;
    }
  }

  // Name boards facing traffic as it enters.
  const mat = signMat(`town:${town.name}`, () => textTexture([{ text: town.name, size: 54, color: '#1c2430', weight: '700' }], '#f4efe4', 512, 160));
  const a = site.at(town.s0 - 9, EDGE + 1.3);
  board(site, a.x, site.roadY(town.s0 - 9), a.z, Math.atan2(-a.tx, -a.tz), 2.4, 0.76, mat, 2.4, 0xf4efe4);
  const b = site.at(town.s1 + 9, -EDGE - 1.3);
  board(site, b.x, site.roadY(town.s1 + 9), b.z, Math.atan2(b.tx, b.tz), 2.4, 0.76, mat, 2.4, 0xf4efe4);
}

/** Length of a side street that fits at s, or 0. */
function streetFits(site: Site, s: number, side: number): number {
  const f = new Frame(site, s, side);
  for (const len of [64, 46, 32]) {
    let ok = true;
    for (let d = EDGE + 8; d <= EDGE + len && ok; d += 8) {
      for (const w of [-STREET - 2, 0, STREET + 2]) {
        const x = f.x(d, w);
        const z = f.z(d, w);
        const h = site.ground(x, z);
        if (site.field.onLake(x, z) || site.field.blocksProp(x, z) || site.field.roadDistance(x, z) < d - 1.5) ok = false;
        else if (site.water !== null && h < site.water + 1.2) ok = false;
        else if (Math.abs(h - f.y) > 0.12 * (d - EDGE) + 1) ok = false;
      }
    }
    if (ok && site.freeStrip(s - STREET, s + STREET, EDGE + 1, EDGE + len, side)) return len;
  }
  return 0;
}

/** A short street off the main road: asphalt, pavements, houses along it and cars at the kerb. */
function sideStreet(site: Site, s: number, side: 1 | -1, len: number, lights: Lights, id: number): void {
  const { rng } = site;
  const f = new Frame(site, s, side);
  const L = EDGE + len;
  const level = (d: number, x: number, z: number) => Math.max(site.ground(x, z) + 0.04, lerp(f.y, site.ground(x, z) + 0.04, smoothstep(EDGE, EDGE + 22, d)));
  const yAt = (d: number, w: number) => level(d, f.x(d, w), f.z(d, w));

  site.add(patch(Math.ceil(len / 3), 3, (u, v) => {
    const d = EDGE - 0.3 + u * (L - EDGE + 0.3);
    const w = (v - 0.5) * 2 * STREET;
    return v3(f.x(d, w), yAt(d, w) + (d < EDGE ? 0.004 : 0), f.z(d, w));
  }), ASPHALT, 'ground', 0.025);
  // Turning circle at the end.
  site.add(patch(16, 3, (u, v) => {
    const a = u * Math.PI * 2;
    const r = v * 7;
    const d = L + 2 + Math.cos(a) * r;
    const w = Math.sin(a) * r;
    return v3(f.x(d, w), yAt(d, w) + 0.002, f.z(d, w));
  }), ASPHALT, 'ground', 0.025);

  // Pavements both sides.
  for (const k of [-1, 1]) {
    const w0 = k * STREET;
    const w1 = k * (STREET + 1.6);
    const n = Math.ceil((L - FRONT) / 3);
    site.add(patch(n, 1, (u, v) => {
      const d = FRONT + u * (L - FRONT);
      const w = lerp(w0, w1, v);
      return v3(f.x(d, w), yAt(d, w0) + KERB, f.z(d, w));
    }), PAVING, 'rough', 0.05);
    site.add(curtain(n, (u) => {
      const d = FRONT + u * (L - FRONT);
      const y = yAt(d, w0);
      return [f.x(d, w0), f.z(d, w0), y - 0.03, y + KERB];
    }), KERBSTONE, 'rough', 0, 0);
    site.add(curtain(n, (u) => {
      const d = FRONT + u * (L - FRONT);
      const y = yAt(d, w0);
      return [f.x(d, w1), f.z(d, w1), y - 0.8, y + KERB];
    }), PAVE_SIDE, 'rough', 0, 0);
  }

  // Zebra across the mouth, stop line and a light for traffic coming out.
  for (let w = -STREET + 0.4; w < STREET - 0.5; w += 1) {
    site.add(patch(1, 1, (u, v) => {
      const d = FRONT + 0.6 + u * 3;
      const ww = w + v * 0.5;
      return v3(f.x(d, ww), yAt(d, ww) + 0.01, f.z(d, ww));
    }), LINE, 'marks', 0.02, 0);
  }
  site.add(patch(1, 1, (u, v) => {
    const d = FRONT + 4.1 + u * 0.4;
    const w = side * v * (STREET - 0.2);
    return v3(f.x(d, w), yAt(d, w) + 0.01, f.z(d, w));
  }), LINE, 'marks', 0.02, 0);
  {
    const d = FRONT + 4.8;
    const w = side * (STREET + 0.5);
    lights.pole(site, id, 1, f.x(d, w), yAt(d, w) + KERB, f.z(d, w), f.yaw(1, 0), 0);
  }

  // Lamps on one side.
  for (let d = FRONT + 14; d < L; d += 20) {
    const w = -side * (STREET + 0.4);
    site.props.place(streetLamp(), placement(f.x(d, w), yAt(d, w) + KERB, f.z(d, w), f.yaw(0, side)));
  }

  // Cars parked along the kerb on the lamp-free side.
  for (let d = FRONT + 9; d < L - 4; d += 5.6) {
    if (rng() < 0.45) continue;
    const w = side * (STREET - 1.05);
    const fwd = rng() < 0.5 ? 1 : -1;
    site.car(f.x(d, w), yAt(d, w), f.z(d, w), f.yaw(fwd, 0));
  }

  // Houses facing the street.
  const kinds = TOWN_KINDS[site.style][1];
  for (const k of [-1, 1]) {
    let d = FRONT + 6;
    while (d < L - 2) {
      const b = building(weighted(rng(), kinds), Math.floor(rng() * 6));
      const dm = d + b.w / 2;
      if (dm + b.w / 2 > L + 4) break;
      const setback = 1.5 + rng() * 2.5;
      const w = k * (STREET + 1.6 + setback + b.front);
      const yaw = f.yaw(0, -k);
      site.putAt(b, f.x(dm, w), f.z(dm, w), yaw, { minRoad: FRONT + 2 });
      d += b.w + 1.5 + rng() * 2;
    }
  }
}

/** Pavement on one side between s0 and s1: paving, a kerb stone edge and faces down to the road and the ground. */
function pavement(site: Site, s0: number, s1: number, side: number): void {
  const { route } = site;
  const top = (s: number) => site.roadY(s) + KERB;
  site.add(roadStrip(route, s0, s1, side * EDGE, side * (EDGE + 0.25), (s) => top(s) + 0.006, 2), KERBSTONE, 'rough', 0.02, 0.9);
  site.add(roadStrip(route, s0, s1, side * (EDGE + 0.25), side * FRONT, top, 2), PAVING, 'rough', 0.05, 0.9);
  site.add(roadWall(route, s0, s1, side * EDGE, (s) => site.roadY(s) - 0.03, (s) => top(s) + 0.006, side < 0, 2), KERBSTONE, 'rough', 0, 0.9);
  site.add(roadWall(route, s0, s1, side * FRONT, (s) => site.roadY(s) - 0.8, top, side > 0, 2), PAVE_SIDE, 'rough', 0, 0.9);
  for (const s of [s0, s1]) {
    site.add(curtain(1, (u) => {
      const p = site.at(s, side * lerp(EDGE, FRONT, u));
      return [p.x, p.z, site.roadY(s) - 0.03, top(s) + 0.006];
    }), PAVE_SIDE, 'rough', 0, 0);
  }
}

/** Hedge along the pavement with a gap and a path to the door. */
function frontGarden(site: Site, s: number, side: number, b: Building, setback: number): void {
  const top = (ss: number) => site.roadY(ss) + KERB;
  const door = s + side * b.door;
  const lat = side * (FRONT + 0.45);
  const style = site.rng();
  const hedged = style < 0.55;
  const fence = hedged ? plotHedge(site) : style < 0.8 ? picketFence() : null;
  if (fence) {
    const bay = hedged ? 1 : 2;
    const centred = hedged;
    const a = s - b.w / 2 + 0.3;
    const e = s + b.w / 2 - 0.3;
    if (door - 0.8 - a > 1) site.run(fence, bay, site.line(a, door - 0.8, lat, bay, top), centred);
    if (e - door - 0.8 > 1) site.run(fence, bay, site.line(door + 0.8, e, lat, bay, top), centred);
  }
  site.add(roadStrip(site.route, door - 0.6, door + 0.6, side * FRONT, side * (FRONT + setback + 0.3), (ss) => top(ss) + 0.01, 2), PATH, 'ground', 0.04);
}

/** Parking and a lawn tree in front of an apartment block set back from the street. */
function backLot(site: Site, s: number, side: number, front: number, b: Building): void {
  const { rng } = site;
  if (b.h < 9) return;
  const lat = front - 3.2;
  const n = Math.floor((b.w - 2) / 2.6);
  for (let i = 0; i < n; i++) {
    if (rng() < 0.4) continue;
    const ss = s - b.w / 2 + 2.6 + i * 2.6;
    const p = site.at(ss, side * lat);
    const yaw = site.facing(ss, side);
    if (!site.free(p.x, p.z, yaw, 4.8, 2.2)) continue;
    site.occupy(p.x, p.z, yaw, 4.8, 2.2, 0);
    site.car(p.x, site.ground(p.x, p.z) + 0.02, p.z, yaw + (rng() < 0.5 ? Math.PI : 0));
  }
}

/** Church behind a paved square with a fountain, benches and trees. Returns the span it takes along the street. */
function churchSquare(site: Site, s: number, side: 1 | -1): [number, number] | null {
  const { rng } = site;
  const b = building('church', Math.floor(rng() * 4));
  const depth = 9;
  const halfW = Math.max(12.5, b.w / 2 + 2);
  if (!site.freeStrip(s - halfW, s + halfW, FRONT, FRONT + depth, side)) return null;
  const tints = { wall: site.pick(site.pal.walls.slice(0, 4)), roof: site.pick(site.pal.roofs), accent: site.pick(site.pal.accents) };
  const spot = site.put(b, s, side, FRONT + depth, { bury: 1.4, tints });
  if (!spot) return null;
  site.occupyStrip(s - halfW, s + halfW, FRONT, FRONT + depth, side, 1);
  const top = (ss: number) => site.roadY(ss) + KERB;
  const yAt = (ss: number, lat: number) => {
    const p = site.at(ss, side * lat);
    return Math.max(top(ss), site.ground(p.x, p.z) + 0.04);
  };
  site.add(patch(Math.ceil(halfW), 5, (u, v) => {
    const ss = s - halfW + u * 2 * halfW;
    const lat = FRONT - 0.02 + v * (depth + 1.6);
    const p = site.at(ss, side * lat);
    return v3(p.x, yAt(ss, lat), p.z);
  }), PLAZA, 'ground', 0.05);
  for (const e of [s - halfW, s + halfW]) {
    site.add(curtain(5, (u) => {
      const lat = FRONT + u * (depth + 1.6);
      const p = site.at(e, side * lat);
      return [p.x, p.z, top(e) - 0.6, yAt(e, lat)];
    }), PAVE_SIDE, 'rough', 0, 0);
  }
  const fs = s + (rng() < 0.5 ? -1 : 1) * (halfW - 5.5);
  const fp = site.at(fs, side * (FRONT + 4.4));
  site.props.place(fountain(), placement(fp.x, yAt(fs, 4.4 + FRONT) - 0.02, fp.z, 0));
  for (const k of [-1, 1]) {
    const bs = fs + k * 3.6;
    const p = site.at(bs, side * (FRONT + 4.4));
    site.props.place(bench(), placement(p.x, yAt(bs, FRONT + 4.4), p.z, site.facing(bs, side) + (k < 0 ? Math.PI / 2 : -Math.PI / 2)));
  }
  for (const k of [-1, 1]) {
    const ts = s + k * (halfW - 1.6);
    const p = site.at(ts, side * (FRONT + depth - 0.6));
    placeGardenTree(site, p.x, yAt(ts, FRONT + depth - 0.6) - 0.05, p.z, rng() * 6, Math.floor(rng() * 4));
    const q = site.at(ts, side * (FRONT + 1.2));
    site.props.place(plotPlanter(site), placement(q.x, yAt(ts, FRONT + 1.2), q.z, 0));
  }
  return [s - halfW - 0.5, s + halfW + 0.5];
}

/** A car park behind the pavement: entrance, two rows of bays, lamps, a sign and cars. */
function carPark(site: Site, a: number, side: 1 | -1): boolean {
  const { route, rng } = site;
  const L = 36;
  const D = 19;
  const lat0 = FRONT;
  const lat1 = FRONT + D;
  for (let u = 0; u <= 6; u++) {
    for (let v = 0; v <= 3; v++) {
      const s = a + (L * u) / 6;
      const p = site.at(s, side * (lat0 + (D * v) / 3));
      if (site.field.onLake(p.x, p.z) || site.field.blocksProp(p.x, p.z) || site.field.roadDistance(p.x, p.z) < lat0 - 0.8) return false;
      if (Math.abs(site.ground(p.x, p.z) - site.roadY(s)) > 1.6) return false;
    }
  }
  if (!site.freeStrip(a, a + L, lat0, lat1 + 1, side)) return false;
  site.occupyStrip(a, a + L, lat0, lat1 + 1, side, 1.5);
  const lotY = (s: number, lat: number) => {
    const p = site.at(s, side * lat);
    // The grass mesh is coarser than this lot, so its triangles rise above the
    // sampled ground. Follow that mesh or the grass shows through the asphalt.
    return Math.max(site.roadY(s) + 0.03, site.field.surfaceHeight(p.x, p.z) + 0.06);
  };
  site.add(patch(18, 10, (u, v) => {
    const s = a + u * L;
    const lat = lat0 - 0.02 + v * D;
    const p = site.at(s, side * lat);
    return v3(p.x, lotY(s, lat), p.z);
  }), LOT, 'ground', 0.03);
  site.add(roadStrip(route, a + 1, a + 7.5, side * (EDGE - 0.25), side * lat0, (s) => site.roadY(s) + 0.012, 1), LOT, 'ground', 0.03);
  site.add(roadWall(route, a, a + L, side * lat1, (s) => lotY(s, lat1) - 0.9, (s) => lotY(s, lat1), side > 0, 2), PAVE_SIDE, 'rough', 0, 0.9);
  for (const e of [a, a + L]) {
    site.add(curtain(6, (u) => {
      const lat = lat0 + u * D;
      const p = site.at(e, side * lat);
      return [p.x, p.z, lotY(e, lat) - 0.9, lotY(e, lat)];
    }), PAVE_SIDE, 'rough', 0, 0);
  }

  const mark = (s0: number, s1: number, l0: number, l1: number) =>
    site.add(roadStrip(route, s0, s1, side * l0, side * l1, (s, lat) => lotY(s, Math.abs(lat)) + 0.012, 2), LINE, 'marks', 0.02, 0);
  const rows: [number, number, number][] = [
    [lat0 + 0.8, lat0 + 5.8, a + 8.5],
    [lat1 - 5.6, lat1 - 0.6, a + 0.6],
  ];
  for (const [l0, l1, start] of rows) {
    const n = Math.floor((a + L - 0.6 - start) / 2.5);
    const outer = l0 < lat0 + 2 ? l0 : l1;
    mark(start, start + n * 2.5, outer - 0.06, outer + 0.06);
    for (let i = 0; i <= n; i++) {
      const s = start + i * 2.5;
      mark(s - 0.06, s + 0.06, l0, l1);
      if (i < n && rng() < 0.64) {
        const sm = s + 1.25;
        const lm = (l0 + l1) / 2;
        const p = site.at(sm, side * lm);
        const noseIn = rng() < 0.75;
        const towardRoad = (outer === l0) === noseIn;
        site.car(p.x, lotY(sm, lm), p.z, site.facing(sm, side) + (towardRoad ? 0 : Math.PI));
      }
    }
  }

  const aisle = (rows[0][1] + rows[1][0]) / 2;
  for (const s of [a + 12, a + 28]) {
    const p = site.at(s, side * aisle);
    site.props.place(streetLamp(), placement(p.x, lotY(s, aisle), p.z, site.facing(s, side) + Math.PI / 2));
  }
  site.run(plotHedge(site), 1, site.line(a + 8.2, a + L - 0.3, side * (lat0 + 0.35), 1, (s) => lotY(s, lat0 + 0.35)), true);
  site.run(plotHedge(site), 1, site.line(a + 0.3, a + L - 0.3, side * (lat1 + 0.5), 1), true);
  for (const s of [a + 3, a + L - 3]) {
    const p = site.at(s, side * (lat1 + 2.2));
    placeGardenTree(site, p.x, site.ground(p.x, p.z) - 0.05, p.z, rng() * 6, Math.floor(rng() * 4));
  }

  const mat = signMat('parking', () => textTexture([{ text: 'P', size: 190, color: '#ffffff', weight: '800' }], '#1f5fb4', 256, 256));
  const p = site.at(a + 0.4, side * (EDGE + 0.6));
  board(site, p.x, site.roadY(a) + KERB, p.z, Math.atan2(-p.tx, -p.tz), 0.7, 0.7, mat, 2.5, 0x1f5fb4);
  return true;
}

// --------------------------------------------------------------------------------------- country houses

/** A house with its garage, drive, parked car, fence and garden trees. */
function yard(site: Site, s: number, side: 1 | -1, front: number): boolean {
  const { rng, style } = site;
  const b = building(weighted(rng(), YARD_KINDS[style]), Math.floor(rng() * 6));
  const garageKind: BuildingKind | null = style === 'desert' ? (rng() < 0.4 ? 'garage' : null) : rng() < 0.85 ? (rng() < 0.35 ? 'garage2' : 'garage') : null;
  const g = garageKind ? building(garageKind, Math.floor(rng() * 4)) : null;
  const gDir = rng() < 0.5 ? 1 : -1;
  const driveW = g ? Math.max(2.8, g.w - 0.9) : 2.8;
  const sDrive = s + gDir * (b.w / 2 + 0.8 + (g ? g.w : driveW + 0.6) / 2);
  const span = (g ? g.w : driveW) / 2;
  const sA = Math.min(s - b.w / 2, sDrive - span) - 2.5;
  const sB = Math.max(s + b.w / 2, sDrive + span) + 2.5;
  const depth = Math.max(b.front + b.back, g ? g.front + g.back : 0);
  const latF = EDGE + 2.2;
  const latB = front + depth + 5 + rng() * 6;
  if (!site.freeStrip(sA, sB, latF, latB, side)) return false;
  {
    const sm = (sA + sB) / 2;
    const c = site.at(sm, side * (latF + latB) / 2);
    const gr = site.survey(c.x, c.z, site.facing(sm, side), latB - latF, sB - sA, latF - 0.6);
    if (!gr || gr.hi - gr.lo > 3.4) return false;
  }
  const tints = site.tints();
  const house = site.put(b, s, side, front, { tints, bury: 1.2 });
  if (!house) return false;
  const garage = g ? site.put(g, sDrive, side, front + 0.6, { tints, bury: 1 }) : null;
  site.occupyStrip(sA, sB, latF, latB, side, 1.5);

  // Drive from the road to the garage door, or to a gravel pad.
  const f = new Frame(site, sDrive, side);
  const end = garage ? front + 0.6 : front + 4;
  const endY = garage ? garage.y + 0.02 : site.ground(f.x(end, 0), f.z(end, 0)) + 0.04;
  const driveY = (d: number, w: number) => {
    const x = f.x(d, w);
    const z = f.z(d, w);
    return Math.max(site.ground(x, z) + 0.035, lerp(f.y + 0.012, endY, smoothstep(EDGE, end, d)));
  };
  const color = site.pick(DRIVE[style]);
  site.add(patch(Math.max(2, Math.ceil((end - EDGE) / 2)), 2, (u, v) => {
    const d = EDGE - 0.15 + u * (end - EDGE + 0.15);
    const w = (v - 0.5) * driveW;
    return v3(f.x(d, w), driveY(d, w), f.z(d, w));
  }), color, 'ground', 0.05);
  if (end - EDGE > 8.5 && rng() < 0.72) {
    const d = end - 3.1;
    const w = g && g.w > 5 ? (rng() < 0.5 ? -1.3 : 1.3) : 0;
    const toHouse = rng() < 0.6;
    const pitch = Math.atan((driveY(d + 1.5, w) - driveY(d - 1.5, w)) / 3) * (toHouse ? 1 : -1);
    site.car(f.x(d, w), driveY(d, w), f.z(d, w), f.yaw(toHouse ? 1 : -1, 0), pitch);
  }

  // Path to the front door.
  const door = s + side * b.door;
  if (Math.abs(door - sDrive) > driveW / 2 + 1) {
    const pf = new Frame(site, door, side);
    const pathY = (d: number, w: number) => site.ground(pf.x(d, w), pf.z(d, w)) + 0.03;
    site.add(patch(Math.max(2, Math.ceil((front - latF) / 2)), 1, (u, v) => {
      const d = latF - 0.3 + u * (front + 0.2 - latF);
      const w = (v - 0.5) * 1.1;
      return v3(pf.x(d, w), pathY(d, w), pf.z(d, w));
    }), PATH, 'ground', 0.05);
  }

  // Fence or hedge round the plot, open for the drive and the path.
  const kind = weighted(rng(), FENCES[style]);
  if (kind) {
    const model = kind === 'rail' ? railFence() : kind === 'picket' ? picketFence() : plotHedge(site);
    const bay = kind === 'hedge' ? 1 : 2;
    const centred = kind === 'hedge';
    const cuts: [number, number][] = [[sDrive - driveW / 2 - 0.4, sDrive + driveW / 2 + 0.4]];
    if (Math.abs(door - sDrive) > driveW / 2 + 1) cuts.push([door - 0.8, door + 0.8]);
    cuts.sort((p, q) => p[0] - q[0]);
    let a = sA;
    for (const [c0, c1] of [...cuts, [sB, sB] as [number, number]]) {
      if (c0 - a > 1) site.run(model, bay, site.line(a, c0, side * latF, bay), centred);
      a = Math.max(a, c1);
    }
    site.run(model, bay, site.line(sA, sB, side * latB, bay), centred);
    for (const e of [sA, sB]) site.run(model, bay, site.across(e, side * latF, side * latB, bay), centred);
  }

  // Trees in the garden behind.
  const behind = front + depth + 1.8;
  const trees = latB - behind > 3 ? 1 + Math.floor(rng() * 3) : 0;
  for (let i = 0; i < trees; i++) {
    const ts = lerp(sA + 2, sB - 2, rng());
    const tl = lerp(behind, latB - 1.5, rng());
    const p = site.at(ts, side * tl);
    placeGardenTree(site, p.x, site.ground(p.x, p.z) - 0.05, p.z, rng() * 6, Math.floor(rng() * 4));
  }
  if (front - latF > 7 && rng() < 0.5) {
    const ts = s - gDir * (b.w / 4);
    const p = site.at(ts, side * (latF + 2.5));
    placeGardenTree(site, p.x, site.ground(p.x, p.z) - 0.05, p.z, rng() * 6, Math.floor(rng() * 4));
  }
  return true;
}

function inTown(towns: TownSpan[], s: number, pad: number): boolean {
  return towns.some((t) => s >= t.s0 - pad && s <= t.s1 + pad);
}

/** Clusters of houses with yards on flat stretches, and a couple at each side road. */
function buildYards(site: Site, towns: TownSpan[], junctions: Junction[]): void {
  const { route, rng } = site;
  const treeline = route.def.scenery.treeline;
  const nearSpur = (s: number, side: number) => junctions.some((j) => j.side === side && Math.abs(j.idx * ROUTE_DS - s) < 26);
  const tryYard = (s: number, side: 1 | -1, front: number) => {
    if (s < 60 || s > route.length - 60 || nearSpur(s, side) || inTown(towns, s, 40)) return false;
    return yard(site, s, side, front);
  };

  let next = 900;
  while (next < route.length - 800) {
    const idx = Math.floor(next / ROUTE_DS);
    let flat = true;
    for (let k = -60; k <= 60; k += 10) {
      const g = route.grade[(idx + k + route.count) % route.count];
      if (Math.abs(g) > 0.055) flat = false;
    }
    if (flat && route.y[idx] < treeline - 120 && !route.hairpin[idx] && !inTown(towns, next, 90)) {
      const houses = 3 + Math.floor(rng() * 5);
      for (let h = 0; h < houses; h++) {
        tryYard(next + (rng() - 0.5) * 320, rng() < 0.5 ? -1 : 1, EDGE + 9 + rng() * 14);
      }
      next += 2200 + rng() * 2600;
    } else {
      next += 350;
    }
  }

  for (const j of junctions) {
    tryYard(j.idx * ROUTE_DS + 34, j.side, EDGE + 10 + rng() * 4);
    tryYard(j.idx * ROUTE_DS - 34, j.side, EDGE + 13 + rng() * 5);
  }
}

/** Towns and country houses. Returns the traffic light stop lines for the traffic. */
export function buildSettlements(site: Site, towns: TownSpan[], junctions: Junction[]): Signal[] {
  const lights = new Lights();
  const signals: Signal[] = [];
  for (const town of towns) buildTown(site, town, junctions, lights, signals);
  buildYards(site, towns, junctions);
  lights.finish(site.props);
  return signals;
}
