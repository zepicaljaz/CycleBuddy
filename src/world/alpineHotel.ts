import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { prepare, type Prepared } from './batch';
import { building, type BuildingKind } from './buildings';
import { merge, paint, placement, v3 } from './geometry';
import type { Model } from './materials';
import { bench, fountain, signPost, streetLamp } from './props';
import { ROAD_HALF_WIDTH } from './terrainField';
import type { Site } from './site';
import { textTexture } from './textures';

/**
 * Luxury alpine hotel from the reference: faceted timber and glass on a
 * dry-stone terrace, with two pools, a centre stair, and the terrace planting.
 * Local +X is the entrance front. y = 0 is the stone base; a foundation continues below.
 */

const WOOD = 0xc4a06a;
const WOOD_LT = 0xd8bc8c;
const WOOD_DK = 0x8a5a32;
const STONE = 0xb5b0a6;
const GLASS = 0xd2e0e8;
const WATER = 0x8ecfe2;
const LEAF = 0x3e7a40;
const LEAF_DK = 0x2f6a38;
const TRUNK = 0x5c4030;
const CACTUS = 0x4c8a48;
const CUSHION = 0xe7e2d8;
const WHITE = 0xf4f1ea;

const FRONT = 10;
const BACK = 10;
const HALF_W = 16;

type Geo = THREE.BufferGeometry;

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Geo {
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  const az = Math.min(z0, z1);
  const bz = Math.max(z0, z1);
  return new THREE.BoxGeometry(Math.max(1e-3, bx - ax), Math.max(1e-3, by - ay), Math.max(1e-3, bz - az)).translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
}

function hull(pts: number[][]): Geo {
  return new ConvexGeometry(pts.map((p) => v3(p[0], p[1], p[2])));
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function alpineHotel(): Prepared {
  const parts: Model = [];
  let seed = 3;
  const put = (g: Geo, mat: Model[number]['mat'], color: number, jitter = 0) => {
    parts.push({ geom: paint(g, color, { crease: 0, jitter, seed: seed++ }), mat });
  };
  const wood = (g: Geo, color = WOOD) => put(g, 'rough', color, 0.045);
  const stone = (g: Geo) => put(g, 'rough', STONE, 0.09);
  const glass = (g: Geo) => put(g, 'glass', GLASS, 0.015);

  // Foundation keeps the terrace planted when the summit falls away beside the road.
  stone(box(-BACK + 0.4, FRONT - 0.2, -8, 0.35, -HALF_W + 0.6, HALF_W - 0.6));

  const blocks: Geo[] = [];
  const pushStone = (g: Geo) => blocks.push(g);
  const rand = rng(41);
  const courses = (along: 'x' | 'z', outer: number, sign: 1 | -1, y0: number, y1: number, a0: number, a1: number) => {
    let y = y0;
    while (y < y1 - 0.12) {
      const h = 0.34 + rand() * 0.32;
      const top = Math.min(y1, y + h);
      let a = a0;
      while (a < a1 - 0.18) {
        const w = 0.95 + rand() * 1.45;
        const b = Math.min(a1, a + w);
        const jut = rand() * 0.48;
        const depth = 0.5 + rand() * 0.45;
        const yLo = y + rand() * 0.05;
        const yHi = top - 0.02;
        if (along === 'z') {
          const xOut = outer + sign * jut;
          const xIn = outer - sign * depth;
          pushStone(box(Math.min(xOut, xIn), Math.max(xOut, xIn), yLo, yHi, a + 0.05, b - 0.05));
        } else {
          const zOut = outer + sign * jut;
          const zIn = outer - sign * depth;
          pushStone(box(a + 0.05, b - 0.05, yLo, yHi, Math.min(zOut, zIn), Math.max(zOut, zIn)));
        }
        a = b - 0.02;
      }
      y = top - 0.04;
    }
  };

  // Main plinth under the deck. The centre front is left open for the stair.
  courses('z', 4.6, 1, 0, 2.7, -HALF_W + 0.4, -2.8);
  courses('z', 4.6, 1, 0, 2.7, 2.8, HALF_W - 0.4);
  courses('z', -BACK + 0.2, -1, 0, 2.55, -HALF_W + 0.5, HALF_W - 0.5);
  courses('x', HALF_W - 0.3, 1, 0, 2.55, -BACK + 0.4, 4.2);
  courses('x', -HALF_W + 0.3, -1, 0, 2.15, -2, 9.6);
  stone(merge(blocks));

  // Open stone tanks so the water reads. Image-left pool is +Z, the larger pool is -Z and closer.
  const tank = (x0: number, x1: number, z0: number, z1: number, rim: number) => {
    const t = 0.42;
    stone(box(x0, x0 + t, 0, rim, z0, z1));
    stone(box(x1 - t, x1, 0, rim, z0, z1));
    stone(box(x0, x1, 0, rim, z0, z0 + t));
    stone(box(x0, x1, 0, rim, z1 - t, z1));
    put(box(x0 + t, x1 - t, rim - 0.55, rim - 0.16, z0 + t, z1 - t), 'rough', 0x8aa0a6, 0.02);
    put(box(x0 + t + 0.05, x1 - t - 0.05, rim - 0.14, rim - 0.02, z0 + t + 0.05, z1 - t - 0.05), 'gloss', WATER, 0.02);
  };
  tank(4.4, 9.0, 5.4, 13.4, 1.92);
  tank(5.6, 10.2, -14.8, -4.6, 1.62);

  // Boulders around the foot of the wall.
  const rock = (x: number, y: number, z: number, sx: number, sy: number, sz: number, spin: number) => {
    const g = new THREE.DodecahedronGeometry(1, 0);
    g.scale(sx, sy, sz);
    g.rotateY(spin);
    g.translate(x, y, z);
    stone(g);
  };
  rock(8.6, 0.45, 13.4, 1.3, 0.7, 1.1, 0.4);
  rock(9.4, 0.38, 2.2, 0.9, 0.55, 0.8, 1.1);
  rock(7.2, 0.42, -1.2, 1.15, 0.6, 0.95, 0.7);
  rock(10.2, 0.5, -14.8, 1.45, 0.75, 1.2, 0.2);
  rock(-8.5, 0.4, -13, 1.1, 0.6, 0.9, 1.4);
  rock(2.4, 0.32, 15.2, 0.8, 0.45, 0.7, 0.5);

  // Decks. Planks run toward the entrance.
  const planks = (x0: number, x1: number, y: number, z0: number, z1: number) => {
    const list: Geo[] = [];
    for (let z = z0; z < z1 - 0.05; z += 0.38) list.push(box(x0, x1, y, y + 0.1, z, Math.min(z1, z + 0.32)));
    wood(merge(list), WOOD_LT);
  };
  planks(-1.5, 4.55, 2.58, -14.6, 13.6);
  planks(4.3, 8.4, 1.78, 4.8, 13.2);

  // Centre stair, wide at the bottom, landing on the main deck.
  for (let i = 0; i < 6; i++) {
    const x1 = 9.3 - i * 0.78;
    const y0 = 0.62 + i * 0.33;
    wood(box(x1 - 0.82, x1, y0, y0 + 0.1, -2.55, 2.55), i % 2 ? WOOD : WOOD_LT);
  }
  // Short flight from the left pool terrace up to the deck.
  for (let i = 0; i < 3; i++) {
    const x1 = 4.5 - i * 0.55;
    const y0 = 1.9 + i * 0.24;
    wood(box(x1 - 0.55, x1, y0, y0 + 0.08, 4.5, 6.3), WOOD);
  }

  const mullion = (x: number, y0: number, y1: number, z0: number, z1: number, cols: number) => {
    glass(box(x, x + 0.08, y0, y1, z0, z1));
    for (let i = 0; i <= cols; i++) {
      const z = z0 + ((z1 - z0) * i) / cols;
      wood(box(x + 0.06, x + 0.16, y0, y1, z - 0.045, z + 0.045), WOOD_DK);
    }
    wood(box(x + 0.06, x + 0.16, y0 - 0.04, y0 + 0.05, z0, z1), WOOD_DK);
    wood(box(x + 0.06, x + 0.16, y1 - 0.05, y1 + 0.04, z0, z1), WOOD_DK);
    wood(box(x + 0.06, x + 0.16, (y0 + y1) / 2 - 0.04, (y0 + y1) / 2 + 0.04, z0, z1), WOOD_DK);
  };

  // Left wing. Glass below, a timber fold above it, balcony at the outer end.
  put(box(-6.4, 0.8, 2.78, 5.25, 3.8, 12.0), 'rough', 0x6a5538, 0.03);
  mullion(1.9, 3.1, 5.15, 4.4, 11.2, 3);
  glass(box(0.2, 1.7, 3.15, 5.1, 12.05, 12.16));
  wood(hull([
    [-5.8, 5.15, 3.3], [2.25, 5.1, 3.5], [-6.0, 5.2, 12.5], [2.4, 5.05, 12.7],
    [-4.2, 8.9, 4.8], [-1.1, 9.7, 7.3], [0.4, 8.3, 5.4],
    [-3.4, 7.3, 12.3], [1.5, 6.6, 11.4], [2.15, 7.05, 6.2],
  ]));
  mullion(2.55, 5.35, 7.45, 4.6, 10.8, 2);
  wood(box(1.15, 2.85, 5.18, 5.34, 11.3, 13.8), WOOD_LT);
  glass(box(2.6, 2.68, 5.4, 6.55, 11.4, 13.7));
  glass(box(1.3, 2.75, 5.4, 6.55, 13.65, 13.74));

  // Centre: timber roof behind a glass front, and a sharp porch wedge over the door.
  wood(hull([
    [-7.4, 5.5, -1.8], [-7.6, 5.6, 5.6], [0.35, 5.7, -1.4], [0.4, 5.6, 5.2],
    [-3.4, 12.6, 0.2], [-1.5, 13.7, 2.5], [-0.2, 11.2, -0.4], [-0.6, 10.0, 5.0],
    [-5.2, 9.2, 5.4], [-2.4, 8.4, -1.5],
  ]));
  mullion(1.55, 3.35, 6.5, -1.3, 4.7, 3);
  // Glass on the front slope of the centre peak, so the tall face is glazing rather than a solid timber wall.
  glass(hull([
    [0.7, 6.2, -1.15], [0.88, 6.2, -1.15], [0.7, 6.2, 4.7], [0.88, 6.2, 4.7],
    [-0.85, 13.15, 0.7], [-0.68, 13.15, 0.7], [-0.85, 13.15, 3.5], [-0.68, 13.15, 3.5],
  ]));
  wood(hull([
    [0.78, 6.35, 1.55], [1.0, 6.35, 1.55], [0.78, 6.35, 1.72], [1.0, 6.35, 1.72],
    [-0.72, 12.9, 1.95], [-0.52, 12.9, 1.95], [-0.72, 12.9, 2.12], [-0.52, 12.9, 2.12],
  ]), WOOD_DK);
  wood(hull([
    [0.55, 9.15, -0.9], [0.78, 9.15, -0.9], [0.2, 9.55, -0.9], [0.42, 9.55, -0.9],
    [0.55, 9.15, 4.4], [0.78, 9.15, 4.4], [0.2, 9.55, 4.4], [0.42, 9.55, 4.4],
  ]), WOOD_DK);
  wood(hull([
    [0.25, 4.15, -1.55], [0.25, 4.15, 1.7],
    [0.05, 6.25, -1.85], [0.05, 6.4, 1.9],
    [3.25, 4.45, -1.15], [3.35, 4.3, 1.35],
    [2.15, 5.75, 0.1],
  ]));
  put(box(0.7, 2.15, 2.74, 4.45, -1.05, 1.25), 'rough', 0x2c2926, 0.02);
  glass(box(2.05, 2.14, 2.9, 4.3, -0.72, 0.82));
  wood(box(2.08, 2.2, 2.85, 4.35, -0.06, 0.06), WOOD_DK);

  // Right wing, then the glass conservatory falling toward the outer corner.
  put(box(-5.6, 0.7, 2.78, 5.1, -13.2, -2.4), 'rough', 0x6e5840, 0.03);
  wood(hull([
    [-5.0, 5.05, -13.3], [0.5, 4.95, -13.6], [-4.8, 5.1, -2.5], [0.45, 5.2, -2.3],
    [-2.4, 8.8, -9.4], [-0.4, 8.2, -4.8], [0.3, 6.7, -12.4], [0.55, 7.0, -3.6],
  ]));
  mullion(1.7, 3.1, 6.15, -12.2, -3.5, 4);
  put(box(-2.2, 1.2, 2.78, 4.2, -15.7, -11.8), 'rough', 0x6a5538, 0.02);
  glass(box(1.85, 1.96, 2.95, 4.85, -15.4, -12.1));
  glass(hull([
    [1.7, 4.15, -15.6], [1.88, 4.15, -15.6], [1.45, 4.35, -11.7], [1.62, 4.35, -11.7],
    [-0.7, 7.15, -14.9], [-0.52, 7.15, -14.9], [-0.15, 6.45, -12.1], [0.02, 6.45, -12.1],
  ]));
  wood(box(1.35, 2.15, 3.4, 3.62, -15.9, -11.5), WOOD_DK);
  wood(box(-0.85, -0.62, 4.2, 7.25, -15.15, -14.9), WOOD_DK);
  wood(box(0.15, 0.38, 4.0, 6.6, -12.25, -12.0), WOOD_DK);

  // Planter, bonsai, and the two figures by the door. Image-left of the entrance is +Z.
  stone(box(1.7, 4.5, 2.68, 3.35, 2.0, 5.7));
  put(box(1.95, 4.25, 3.28, 3.46, 2.25, 5.45), 'rough', 0x4e7a3e, 0.04);
  const trunk = new THREE.CylinderGeometry(0.1, 0.18, 1.7, 5);
  trunk.rotateZ(0.65);
  trunk.translate(2.85, 4.15, 3.5);
  put(trunk, 'rough', TRUNK, 0.04);
  const crown = (x: number, y: number, z: number, r: number, color: number) => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1.45, 0.48, 1.2);
    g.translate(x, y, z);
    put(g, 'foliage', color, 0.05);
  };
  crown(2.15, 4.35, 2.85, 0.72, LEAF);
  crown(3.35, 4.85, 3.7, 0.85, LEAF_DK);
  crown(2.7, 5.15, 4.45, 0.62, LEAF);
  crown(3.9, 4.45, 2.9, 0.55, LEAF);
  crown(3.1, 4.55, 4.7, 0.48, LEAF_DK);

  const figure = (x: number, z: number, color: number, h = 1.45) => {
    put(box(x - 0.16, x + 0.16, 2.7, 2.7 + h * 0.42, z - 0.1, z + 0.1), 'rough', color, 0.03);
    put(box(x - 0.2, x + 0.2, 2.7 + h * 0.4, 2.7 + h * 0.82, z - 0.14, z + 0.14), 'cloth', color, 0.02);
    const head = new THREE.IcosahedronGeometry(0.13, 0);
    head.translate(x, 2.7 + h * 0.95, z);
    put(head, 'rough', 0xd8b090, 0.02);
  };
  figure(3.55, 0.35, 0x4a5560);
  figure(3.7, 0.95, 0xd5d0c8, 1.25);

  // White sculpture to the right of the door.
  put(box(3.7, 4.05, 2.7, 3.85, -2.55, -2.15), 'rough', WHITE, 0.02);
  const slab = box(-0.12, 0.12, 0, 0.85, -0.16, 0.16);
  slab.applyMatrix4(placement(3.95, 3.7, -2.25, 0.4, 1, 0, 0.35));
  put(slab, 'rough', WHITE, 0.02);

  // Egg chair on the left pool deck.
  const shell = new THREE.SphereGeometry(0.62, 7, 5, 0, Math.PI * 2, 0.2, Math.PI * 0.72);
  shell.translate(6.9, 2.55, 9.2);
  put(shell, 'rough', 0xeeeae2, 0.02);
  put(box(6.6, 7.25, 2.28, 2.42, 8.9, 9.55), 'cloth', 0xc8d0c4, 0.02);
  put(box(6.8, 7.0, 1.92, 2.45, 9.05, 9.28), 'metal', 0x8a8e92, 0);

  // Loungers and the outdoor sofa on the right terrace.
  const lounger = (x: number, z: number, yaw: number) => {
    const seat = box(-0.35, 0.95, 0, 0.08, -0.28, 0.28);
    seat.applyMatrix4(placement(x, 2.82, z, yaw, 1, 0.18));
    wood(seat, WOOD_LT);
    const pad = box(-0.2, 0.85, 0.08, 0.16, -0.22, 0.22);
    pad.applyMatrix4(placement(x, 2.82, z, yaw, 1, 0.18));
    put(pad, 'cloth', CUSHION, 0.02);
  };
  lounger(3.4, -6.4, 0.5);
  lounger(3.55, -8.3, 0.35);
  put(box(2.9, 4.3, 2.7, 3.15, -15.2, -13.3), 'cloth', 0xd5dbe4, 0.02);
  put(box(2.85, 4.35, 3.1, 3.55, -15.15, -14.85), 'cloth', 0xd5dbe4, 0.02);
  put(box(2.85, 4.35, 3.1, 3.55, -13.65, -13.35), 'cloth', 0xd5dbe4, 0.02);

  // Cacti in square stone planters.
  const cactus = (x: number, z: number, s: number, arms: boolean) => {
    stone(box(x - 0.38, x + 0.38, 2.68, 3.05, z - 0.38, z + 0.38));
    const trunk = new THREE.CylinderGeometry(0.08 * s, 0.11 * s, 0.85 * s, 6);
    trunk.translate(x, 3.05 + 0.42 * s, z);
    put(trunk, 'foliage', CACTUS, 0.04);
    if (!arms) return;
    for (const side of [-1, 1]) {
      const arm = new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.42 * s, 5);
      arm.rotateZ(side * 1.05);
      arm.translate(x + side * 0.16 * s, 3.05 + 0.55 * s, z);
      put(arm, 'foliage', 0x5a9a52, 0.03);
    }
  };
  cactus(3.3, -11.2, 1.35, true);
  cactus(3.85, -10.2, 0.85, true);
  cactus(7.4, 12.4, 0.7, true);
  cactus(6.5, 13.0, 0.45, false);

  return prepare(parts);
}

/** Footprint of the hotel. Depth is along +X, width along Z. */
export const ALPINE_HOTEL_SIZE = { front: FRONT, back: BACK, w: HALF_W * 2, h: 14.2 };

/** The hotel stands beside the Passo del Cielo summit, front facing the road. */
export function placeAlpineHotel(site: Site): void {
  const climb = site.route.climbs.find((c) => c.id === 'cielo-passo');
  if (!climb) return;
  const dir = climb.end >= climb.start ? 1 : -1;
  const s = climb.end - dir * 18;
  const roadY = site.roadY(s);
  let side: 1 | -1 = 1;
  let lowest = Infinity;
  for (const candidate of [1, -1] as const) {
    const q = site.at(s, candidate * 28);
    const rise = site.ground(q.x, q.z) - roadY;
    if (rise < lowest) {
      lowest = rise;
      side = candidate;
    }
  }
  // Front (+X) faces riders coming up the climb. The near edge stays off the summit rails.
  const lat = side * (ROAD_HALF_WIDTH + HALF_W + 6);
  const p = site.at(s, lat);
  const y = Math.max(roadY - 0.15, site.ground(p.x, p.z) - 0.25);
  const sample = site.route.sample(s);
  const yaw = Math.atan2(sample.tz, -sample.tx);
  site.props.place(alpineHotel(), placement(p.x, y, p.z, yaw));
  site.occupy(p.x, p.z, yaw, FRONT + BACK, HALF_W * 2, 3);
  site.solid(p.x, p.z, yaw, FRONT + BACK, HALF_W * 2, y, ALPINE_HOTEL_SIZE.h);
  site.props.clearing(p.x, p.z, 26);
  placeSummitClose(site, p.x, y, p.z, yaw, side);
}

/**
 * Houses, church, park and car park on the hotel's terrace.
 * `along` is metres downhill of the hotel (local +X). `outward` is metres
 * away from the road; the hotel itself occupies outward −16..16.
 */
function placeSummitClose(site: Site, x: number, y: number, z: number, yaw: number, side: 1 | -1): void {
  const pose = placement(x, y, z, yaw);
  const zOf = (outward: number) => -side * outward;
  const terrace = 0.18;
  const stone = (a0: number, a1: number, o0: number, o1: number, y0: number, y1: number, color = STONE) => {
    const g = box(a0, a1, y0, y1, zOf(o0), zOf(o1));
    g.applyMatrix4(pose);
    site.add(g, color, 'rough', 0.06, 0);
  };
  const worldAt = (along: number, ly: number, outward: number) => new THREE.Vector3(along, ly, zOf(outward)).applyMatrix4(pose);

  // One stone shelf, stopping just short of the hotel so the two bases do not fight.
  stone(-18, 18.2, 17.2, 49, -7.2, terrace);
  stone(18.4, 38, 11.5, 44, -7.2, terrace);
  stone(10.5, 18.2, -14.5, 17, -7.2, terrace);
  stone(18.4, 46, -14.5, 11.2, -7.2, terrace);

  const put = (kind: BuildingKind, variant: number, along: number, outward: number) => {
    const b = building(kind, variant);
    const spot = worldAt(along, terrace, outward);
    site.props.place(b.model, placement(spot.x, spot.y, spot.z, yaw), site.tints());
    site.occupy(spot.x, spot.z, yaw, b.d, b.w, 1.2);
    site.solid(spot.x, spot.z, yaw, b.d, b.w, spot.y, b.h);
    site.props.clearing(spot.x, spot.z, Math.max(b.d, b.w) * 0.55);
  };
  put('cottage', 0, -11, 26);
  put('house', 1, 1, 26.4);
  put('cottage', 2, 13.5, 26);
  put('church', 3, -1, 41);

  // Park: paved terrace, fountain, benches and lamps. Above the snowline, so no lawn and no trees.
  stone(19, 37.2, 12.2, 43.2, terrace + 0.02, terrace + 0.1, 0xd4d0c6);
  stone(22, 34, 20, 22.4, terrace + 0.1, terrace + 0.16, 0xc2bdb2);
  const fountainAt = worldAt(28, terrace + 0.1, 30);
  site.props.place(fountain(), placement(fountainAt.x, fountainAt.y, fountainAt.z, yaw));
  for (const [along, outward, turn] of [[22, 16, 0], [24, 38, Math.PI], [34, 26, Math.PI / 2]] as const) {
    const benchAt = worldAt(along, terrace + 0.08, outward);
    site.props.place(bench(), placement(benchAt.x, benchAt.y, benchAt.z, yaw + turn));
  }
  for (const [along, outward] of [[21, 14], [35, 40]] as const) {
    const lampAt = worldAt(along, terrace + 0.1, outward);
    site.props.place(streetLamp(), placement(lampAt.x, lampAt.y, lampAt.z, yaw));
  }

  // Car park just downhill of the hotel, still clear of the summit rails.
  const lot = 0x575756;
  stone(15.5, 44.5, -13.2, 9.6, terrace + 0.02, terrace + 0.08, lot);
  const line = (a0: number, a1: number, o0: number, o1: number) => stone(a0, a1, o0, o1, terrace + 0.08, terrace + 0.11, 0xe7e4da);
  line(17.2, 41.5, -10.6, -10.45);
  line(17.2, 41.5, 6.4, 6.55);
  for (let i = 0; i <= 8; i++) {
    const a = 17.2 + i * 3.04;
    line(a, a + 0.08, -10.6, -5.4);
    line(a, a + 0.08, 1.2, 6.5);
  }
  const stalls: [number, number, number][] = [
    [18.7, -8, 1], [21.7, -8, 1], [24.8, -8, 1], [30.9, -8, 1], [33.9, -8, 1], [37, -8, 1],
    [18.7, 3.8, -1], [21.7, 3.8, -1], [27.8, 3.8, -1], [30.9, 3.8, -1], [33.9, 3.8, -1],
  ];
  for (const [along, outward, face] of stalls) {
    const carAt = worldAt(along, terrace + 0.16, outward);
    site.car(carAt.x, carAt.y, carAt.z, yaw + face * -side * Math.PI / 2);
  }
  for (const along of [22, 36]) {
    const lampAt = worldAt(along, terrace + 0.06, -1);
    site.props.place(streetLamp(), placement(lampAt.x, lampAt.y, lampAt.z, yaw + Math.PI / 2));
  }
  const signAt = worldAt(14.2, terrace, -12);
  const face = yaw + Math.PI / 2;
  site.props.place(signPost(), placement(signAt.x, signAt.y, signAt.z, face).multiply(new THREE.Matrix4().makeScale(1, 2.5 / 2.6, 1)));
  const back = new THREE.MeshStandardMaterial({ color: 0x1f5fb4, roughness: 0.55 });
  const letter = new THREE.MeshStandardMaterial({
    map: textTexture([{ text: 'P', size: 190, color: '#ffffff', weight: '800' }], '#1f5fb4', 256, 256),
    roughness: 0.55,
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.06), [back, back, back, back, letter, back]);
  board.position.set(signAt.x, signAt.y + 2.15, signAt.z);
  board.rotation.y = face;
  board.castShadow = true;
  site.props.group.add(board);

  // The terrace is flat, but the snow mesh is an 8 m grid and a vertex inside
  // the car park can stand several metres above the asphalt. Hold that shelf
  // down, then ease back to the hillside so the edge is not a cliff.
  const ax = Math.cos(yaw);
  const az = -Math.sin(yaw);
  const bx = -side * Math.sin(yaw);
  const bz = -side * Math.cos(yaw);
  site.field.setPads(new Float32Array([
    ax, az, bx, bz, x, z,
    -28, 58, -20, 60,
    y + 0.02, 16,
  ]));
}
