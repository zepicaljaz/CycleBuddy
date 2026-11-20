import * as THREE from 'three';
import { InstancedModel, prepare, type Prepared } from './batch';
import { UPDATE_RANGE } from './props';
import { loft, merge, outline, paint, placement, tube, v3 } from './geometry';
import type { Model } from './materials';
import { EDGE, type Site } from './site';

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

const cached = new Map<string, Prepared>();
function once(key: string, build: () => Model): Prepared {
  let p = cached.get(key);
  if (!p) cached.set(key, (p = prepare(build())));
  return p;
}

export type BoatKind = 'sail' | 'row' | 'runabout';

/** Hull along +x, deck at y = 0, waterline a little below. */
function hull(len: number, beam: number, depth: number, sheer: number, n = 14): THREE.BufferGeometry {
  const shape = outline(12, 2.6);
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = (t - 0.5) * len;
    const k = Math.pow(Math.sin(t * Math.PI), 0.7);
    const w = beam * k * 0.5;
    const d = depth * (0.55 + 0.45 * k);
    const y0 = -d + sheer * (t - 0.5) * (t - 0.5);
    rings.push(shape.map(([c, s]) => v3(x, y0 + Math.max(0, s) * d * 0.15 + Math.min(0, s) * d, c * w * (s < 0 ? 0.92 : 1))));
  }
  return loft(rings, true, true);
}

function sailboat(): Model {
  const hullG = hull(6.4, 1.85, 0.72, 0.18);
  const deck = hull(6.2, 1.7, 0.08, 0.1);
  deck.translate(0, 0.08, 0);
  const cabin = box(-0.6, 1.4, 0.08, 0.72, -0.55, 0.55);
  const mast = new THREE.CylinderGeometry(0.035, 0.05, 6.2, 10).translate(0.35, 3.2, 0);
  const boom = new THREE.CylinderGeometry(0.028, 0.028, 3.2, 8).rotateZ(Math.PI / 2).translate(-0.9, 0.95, 0);
  const sail = new THREE.BufferGeometry();
  sail.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.1, 0.95, 0.02, 0.35, 6.1, 0.02, -2.4, 0.95, 0.02, -0.1, 0.95, -0.02, 0.35, 6.1, -0.02, -2.4, 0.95, -0.02], 3),
  );
  sail.setIndex([0, 1, 2, 3, 5, 4]);
  const jib = new THREE.BufferGeometry();
  jib.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0.35, 5.6, 0.015, 2.9, 0.55, 0.015, 0.45, 0.7, 0.015, 0.35, 5.6, -0.015, 2.9, 0.55, -0.015, 0.45, 0.7, -0.015], 3),
  );
  jib.setIndex([0, 1, 2, 3, 5, 4]);
  const keel = box(-0.2, 0.5, -1.35, -0.5, -0.04, 0.04);
  const rudder = box(-3.15, -2.85, -0.7, 0.15, -0.025, 0.025);
  return [
    { geom: paint(hullG, 0xffffff, { crease: 0.9 }), mat: 'gloss', tint: 'hull' },
    { geom: paint(deck, 0xc9b79a, { crease: 0.8 }), mat: 'matte' },
    { geom: paint(cabin, 0xffffff, { crease: 0.6 }), mat: 'matte', tint: 'cabin' },
    { geom: merge([paint(mast, 0xd8d4cc, { crease: 0.8 }), paint(boom, 0xd8d4cc, { crease: 0.8 }), paint(keel, 0x2a2c31, { crease: 0.4 }), paint(rudder, 0x2a2c31, { crease: 0.4 })]), mat: 'metal' },
    { geom: merge([paint(sail, 0xffffff, { crease: 0 }), paint(jib, 0xffffff, { crease: 0 })]), mat: 'cloth', tint: 'sail' },
  ];
}

function rowboat(): Model {
  const hullG = hull(3.6, 1.25, 0.42, 0.12, 10);
  const seat = (x: number) => box(x - 0.12, x + 0.12, 0.02, 0.1, -0.48, 0.48);
  const oars: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    oars.push(tube(v3(0.2, 0.28, side * 0.55), v3(1.55, 0.55, side * 1.35), 0.018, 0.014, 6));
    oars.push(box(1.5, 1.85, 0.48, 0.62, side * 1.28, side * 1.48));
  }
  return [
    { geom: paint(hullG, 0x8a4a28, { crease: 0.85 }), mat: 'gloss' },
    { geom: merge([paint(seat(-0.7), 0xc4a06a, { crease: 0.4 }), paint(seat(0.55), 0xc4a06a, { crease: 0.4 })]), mat: 'rough' },
    { geom: merge(oars.map((g) => paint(g, 0x6e4c30, { crease: 0.6 }))), mat: 'rough' },
  ];
}

function runabout(): Model {
  const hullG = hull(5.2, 1.7, 0.55, 0.08, 16);
  const deck = box(-1.6, 2.4, 0.02, 0.12, -0.72, 0.72);
  const windshield = box(0.85, 0.95, 0.12, 0.62, -0.7, 0.7);
  const seat = box(-0.2, 0.7, 0.12, 0.38, -0.62, 0.62);
  const engine = box(-2.55, -2.05, -0.15, 0.42, -0.28, 0.28);
  const wake = box(-2.6, -2.15, -0.22, 0.05, -0.08, 0.08);
  return [
    { geom: paint(hullG, 0x1f4f8a, { crease: 1 }), mat: 'carpaint', tint: 'paint' },
    { geom: merge([paint(deck, 0xf2f0ea, { crease: 0.6 }), paint(seat, 0x2a2c31, { crease: 0.6 })]), mat: 'matte' },
    { geom: paint(windshield, 0x8ab4d4, { crease: 0.5 }), mat: 'glass' },
    { geom: merge([paint(engine, 0x1c1d22, { crease: 0.7 }), paint(wake, 0x2a2c31, { crease: 0.5 })]), mat: 'metal' },
  ];
}

export function boat(kind: BoatKind, variant = 0): Prepared {
  return once(`boat:${kind}:${variant}`, () => {
    if (kind === 'sail') return sailboat();
    if (kind === 'row') return rowboat();
    return runabout();
  });
}

export const BOAT_KINDS: BoatKind[] = ['sail', 'row', 'runabout'];

const HULL_COLOURS = [0x1b3f78, 0x8d3030, 0x1d6848, 0xb85a28, 0x2a3f6e];
const SAIL_COLOURS = [0xf0d7a2, 0xf4efe6, 0xd5e4ee, 0xf6e0d4, 0xe7efe4];

function paintSail(im: InstancedModel, i: number, hull: number, sail: number, cabin = 0xe7eef3): void {
  im.setTint(i, 'hull', hull);
  im.setTint(i, 'sail', sail);
  im.setTint(i, 'cabin', cabin);
}

/** Wooden pier along +x out over the water, deck at y = 0. `drop` is how far the posts reach below the deck. */
export function pier(length = 14, width = 2.4, drop = 1.6): Prepared {
  return once(`pier:${length}:${width}:${drop.toFixed(1)}`, () => {
    const planks: THREE.BufferGeometry[] = [];
    const posts: THREE.BufferGeometry[] = [];
    const rail: THREE.BufferGeometry[] = [];
    const hw = width / 2;
    for (let x = 0.15; x < length; x += 0.28) planks.push(box(x - 0.12, x + 0.12, 0.02, 0.08, -hw, hw));
    for (let x = 0.8; x < length; x += 2.4) {
      for (const z of [-hw + 0.12, hw - 0.12]) {
        posts.push(box(x - 0.09, x + 0.09, -drop, 0.95, z - 0.09, z + 0.09));
        rail.push(tube(v3(x, 0.92, z), v3(Math.min(length - 0.4, x + 2.4), 0.92, z), 0.04, 0.04, 6, false));
      }
    }
    posts.push(box(-0.2, 0.15, -0.4, 0.1, -hw - 0.15, hw + 0.15));
    const bollard = new THREE.CylinderGeometry(0.09, 0.11, 0.45, 10).translate(length - 0.7, 0.3, 0);
    return [
      { geom: merge(planks.map((g) => paint(g, 0xb08958, { crease: 0, jitter: 0.06 }))), mat: 'rough' },
      { geom: merge([...posts, bollard].map((g) => paint(g, 0x7a5a38, { crease: 0, jitter: 0.05 }))), mat: 'rough' },
      { geom: merge(rail.map((g) => paint(g, 0x6a4a2c, { crease: 0.5 }))), mat: 'rough' },
    ];
  });
}

export function boatMatrix(x: number, y: number, z: number, yaw: number, pitch = 0): THREE.Matrix4 {
  return placement(x, y, z, yaw, 1, pitch);
}

/** Which side of the road the lake is on, or 0 when this point is not on the shore. */
function lakeSide(site: Site, s: number): 1 | -1 | 0 {
  for (const trySide of [1, -1] as const) {
    const p = site.at(s, trySide * 36);
    if (site.field.onLake(p.x, p.z)) return trySide;
  }
  return 0;
}

/**
 * Mirror Lake's start arch gets one pier running out from the bank, with a
 * sailboat tied alongside. It stays put and only rocks on the water.
 */
function moorAtStart(site: Site, water: number): void {
  if (site.route.def.id !== 'lake') return;
  const s = 16;
  const side = lakeSide(site, s);
  if (!side) return;
  let lat = EDGE + 4;
  let probe = site.at(s, side * lat);
  while (lat < 48 && site.field.heightAt(probe.x, probe.z) > water + 1.5) {
    lat += 1;
    probe = site.at(s, side * lat);
  }
  const rootLat = Math.max(EDGE + 2, lat - 1.5);
  const shore = site.at(s, side * rootLat);
  const deck = water + 1.05;
  const length = 14;
  const yaw = site.facing(s, side) + Math.PI;
  site.props.place(pier(length, 2.6, deck - water + 1.15), placement(shore.x, deck, shore.z, yaw));
  const mid = site.at(s, side * (rootLat + length * 0.55));
  site.occupy(mid.x, mid.z, yaw, length + 4, 8, 2);

  const sample = site.route.sample(s);
  const intoX = -sample.tz * side;
  const intoZ = sample.tx * side;
  const out = length - 4.5;
  const bx = shore.x + intoX * out - sample.tx * 5.6;
  const bz = shore.z + intoZ * out - sample.tz * 5.6;
  const bow = Math.atan2(-sample.tz, sample.tx);
  const im = new InstancedModel(boat('sail'), 1, { shadows: true });
  im.count = 1;
  paintSail(im, 0, 0x1e5aa8, 0xe8b15a, 0xd5e4f2);
  site.props.group.add(im.group);
  const m = new THREE.Matrix4();
  let phase = 0.4;
  const pose = () => {
    const bob = Math.sin(phase * 1.2) * 0.05;
    const pitch = Math.sin(phase * 0.85) * 0.025;
    placement(bx, water + bob, bz, bow, 1, pitch, 0, m);
    im.setMatrix(0, m);
    im.commit();
  };
  pose();
  site.props.onUpdate((dt) => {
    phase += dt;
    pose();
  });
}

/** Sailboats that travel the lake, each with its own hull and sail colour. */
function sailOnLake(site: Site, water: number): void {
  if (!site.route.def.scenery.lakeshore) return;
  const { route, field } = site;
  const side = lakeSide(site, 400) || lakeSide(site, 16);
  if (!side) return;
  const fleet = [0, 1, 2, 3].map((i) => ({
    s: [90, 640, 1500, 2600][i],
    lat: 56 + (i % 2) * 26,
    speed: 3.1 + i * 0.55,
  }));
  const hulls = [0xc62828, 0x1565c0, 0x2e7d32, 0xef6c00];
  const sails = [0xf2d21b, 0xe53935, 0xff8f00, 0x29b6f6];
  const im = new InstancedModel(boat('sail'), fleet.length, { shadows: true });
  im.count = fleet.length;
  fleet.forEach((_, i) => paintSail(im, i, hulls[i], sails[i], 0xfff8ee));
  site.props.group.add(im.group);
  const m = new THREE.Matrix4();
  const pose = (i: number) => {
    const b = fleet[i];
    let lat = b.lat;
    let p = route.place(b.s, side * lat);
    if (!field.onLake(p.x, p.z)) {
      lat = Math.min(110, lat + 28);
      p = route.place(b.s, side * lat);
    }
    const ahead = route.sample(route.wrap(b.s + 12));
    const yaw = Math.atan2(-(ahead.z - p.z), ahead.x - p.x);
    const bob = Math.sin(b.s * 0.15) * 0.05;
    const pitch = Math.sin(b.s * 0.08) * 0.03;
    placement(p.x, water + bob, p.z, yaw, 1, pitch, 0, m);
    im.setMatrix(i, m);
  };
  fleet.forEach((_, i) => pose(i));
  im.commit();
  site.props.onUpdate((dt) => {
    for (const b of fleet) b.s = route.wrap(b.s + dt * b.speed);
    fleet.forEach((_, i) => pose(i));
    im.commit();
  });
}

/** Piers on the shore and boats that drift on the water. */
export function buildWaterfront(site: Site): void {
  if (site.water === null) return;
  const { route, rng, field } = site;
  const water = site.water;
  moorAtStart(site, water);
  sailOnLake(site, water);
  const lakeshore = !!route.def.scenery.lakeshore;
  const piers: { x: number; z: number; yaw: number }[] = [];
  const crafts: { kind: BoatKind; x: number; z: number; yaw: number; r: number; speed: number; phase: number }[] = [];

  let s = 400;
  while (s < route.length - 400) {
    let side: 1 | -1 | 0 = 0;
    for (const trySide of [-1, 1] as const) {
      const p = site.at(s, trySide * 18);
      const lake = lakeshore ? field.onLake(p.x, p.z) : field.heightAt(p.x, p.z) < water + 0.6;
      if (lake) {
        side = trySide;
        break;
      }
    }
    if (!side) {
      s += 280;
      continue;
    }
    const shore = site.at(s, side * (EDGE + 2.5));
    const y = field.heightAt(shore.x, shore.z);
    if (Math.abs(y - water) > 3.5) {
      s += 220;
      continue;
    }
    const yaw = site.facing(s, side);
    if (site.free(shore.x, shore.z, yaw, 16, 4) && rng() < 0.7) {
      site.props.place(pier(12 + rng() * 6, 2.2 + rng() * 0.4), placement(shore.x, water + 0.12, shore.z, yaw));
      site.occupy(shore.x, shore.z, yaw, 16, 4, 2);
      piers.push({ x: shore.x, z: shore.z, yaw });
    }
    const inward = site.at(s, side * (38 + rng() * 22));
    if ((lakeshore ? field.onLake(inward.x, inward.z) : field.heightAt(inward.x, inward.z) < water + 0.4) && rng() < 0.85) {
      crafts.push({
        kind: BOAT_KINDS[Math.floor(rng() * BOAT_KINDS.length)],
        x: inward.x,
        z: inward.z,
        yaw: rng() * Math.PI * 2,
        r: 6 + rng() * 10,
        speed: 0.08 + rng() * 0.12,
        phase: rng() * Math.PI * 2,
      });
    }
    s += 520 + rng() * 480;
  }

  if (!crafts.length) return;
  const layers = BOAT_KINDS.map((kind) => {
    const list = crafts.filter((c) => c.kind === kind);
    if (!list.length) return null;
    const im = new InstancedModel(boat(kind), list.length, { shadows: true });
    im.count = list.length;
    if (kind === 'sail') list.forEach((_, i) => paintSail(im, i, HULL_COLOURS[i % HULL_COLOURS.length], SAIL_COLOURS[i % SAIL_COLOURS.length]));
    site.props.group.add(im.group);
    return { im, list };
  }).filter((x): x is { im: InstancedModel; list: typeof crafts } => !!x);
  const m = new THREE.Matrix4();
  const r2 = UPDATE_RANGE * UPDATE_RANGE;
  site.props.onUpdate((dt, eye) => {
    for (const layer of layers) {
      let moved = false;
      layer.list.forEach((c, i) => {
        c.phase += dt * c.speed;
        const ex = c.x - eye.x;
        const ez = c.z - eye.z;
        // Far boats keep their phase but are not re-posed; they are specks at that range.
        if (ex * ex + ez * ez > r2) return;
        moved = true;
        const x = c.x + Math.cos(c.phase) * c.r;
        const z = c.z + Math.sin(c.phase) * c.r;
        const yaw = c.phase + Math.PI / 2;
        const bob = Math.sin(c.phase * 2.2) * 0.06;
        const pitch = Math.sin(c.phase * 1.6) * 0.04;
        placement(x, water + bob, z, yaw, 1, pitch, 0, m);
        layer.im.setMatrix(i, m);
      });
      if (moved) layer.im.commit();
    }
  });
  void piers;
}
