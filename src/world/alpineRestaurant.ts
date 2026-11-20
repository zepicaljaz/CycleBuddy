import * as THREE from 'three';
import { prepare, type Prepared } from './batch';
import { merge, paint, placement } from './geometry';
import type { Model } from './materials';
import { ROAD_HALF_WIDTH } from './terrainField';
import type { Site } from './site';

/**
 * Alpine restaurant from the reference: gabled timber cabin, stone chimney,
 * and a deck with picnic tables. Local +X is the deck front. +Z is image-left.
 * y = 0 is the ground line; the stone base stands on it.
 */

const STONE = 0xb5b2a8;
const GLASS_C = 0xc5d4de;
const LEAF = 0x2f6b3c;
const LEAF_LT = 0x3e7c48;
const PINK = 0xe38996;
const WHITE = 0xf4f1ea;
const CLOTH = 0xf7f4ee;
const CHECK = 0xc45a4a;

type Scheme = 'wood' | 'grey';

interface PaintSet {
  wall: number;
  wallDk: number;
  roof: number;
  roofLt: number;
  roofDk: number;
  deck: number;
  trim: number;
}

const WOOD: PaintSet = {
  wall: 0x8d6a49,
  wallDk: 0x6a4d34,
  roof: 0x7a5e46,
  roofLt: 0xa18462,
  roofDk: 0x5c4532,
  deck: 0xa67c52,
  trim: 0x6e5238,
};

const GREY: PaintSet = {
  wall: 0x9a9da2,
  wallDk: 0x6a6e74,
  roof: 0x8b8e93,
  roofLt: 0xb4b7bb,
  roofDk: 0x5c6066,
  deck: 0xa8abaf,
  trim: 0x7a7e84,
};

const FRONT = 7.2;
const BACK = 4.4;
const HALF_W = 6.4;
const DECK = 1.28;

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

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function alpineRestaurant(scheme: Scheme = 'wood'): Prepared {
  const c = scheme === 'grey' ? GREY : WOOD;
  const parts: Model = [];
  let seed = scheme === 'grey' ? 40 : 7;
  const put = (g: Geo, mat: Model[number]['mat'], color: number, jitter = 0) => {
    parts.push({ geom: paint(g, color, { crease: 0, jitter, seed: seed++ }), mat });
  };
  const wall = (g: Geo, dark = false) => put(g, 'rough', dark ? c.wallDk : c.wall, 0.04);
  const roof = (g: Geo, dark = false) => put(g, 'rough', dark ? c.roofDk : c.roof, 0.05);
  const deck = (g: Geo) => put(g, 'rough', c.deck, 0.04);
  const stone = (g: Geo) => put(g, 'rough', STONE, 0.07);

  stone(box(-BACK, FRONT - 0.6, -6, 0.15, -HALF_W + 0.3, HALF_W - 0.3));
  const blocks: Geo[] = [];
  const rand = rng(scheme === 'grey' ? 23 : 8);
  const courses = (along: 'x' | 'z', outer: number, sign: 1 | -1, y0: number, y1: number, a0: number, a1: number) => {
    let y = y0;
    while (y < y1 - 0.08) {
      const h = 0.3 + rand() * 0.2;
      const top = Math.min(y1, y + h);
      let a = a0;
      while (a < a1 - 0.12) {
        const w = 0.8 + rand() * 1.1;
        const b = Math.min(a1, a + w);
        const jut = rand() * 0.26;
        const depth = 0.4 + rand() * 0.26;
        if (along === 'z') {
          const xOut = outer + sign * jut;
          const xIn = outer - sign * depth;
          blocks.push(box(Math.min(xOut, xIn), Math.max(xOut, xIn), y, top - 0.02, a + 0.04, b - 0.04));
        } else {
          const zOut = outer + sign * jut;
          const zIn = outer - sign * depth;
          blocks.push(box(a + 0.04, b - 0.04, y, top - 0.02, Math.min(zOut, zIn), Math.max(zOut, zIn)));
        }
        a = b - 0.02;
      }
      y = top - 0.03;
    }
  };
  courses('z', 6.35, 1, 0, DECK, -5.8, 5.6);
  courses('x', -5.9, -1, 0, DECK, -1.5, 6.35);
  courses('x', 5.7, 1, 0, DECK * 0.7, 0.8, 6.35);
  stone(merge(blocks));
  const rock = (x: number, z: number, sx: number, sy: number, sz: number) => {
    const g = new THREE.DodecahedronGeometry(1, 0);
    g.scale(sx, sy, sz);
    g.translate(x, sy * 0.4, z);
    stone(g);
  };
  rock(6.5, 5.15, 0.62, 0.34, 0.48);
  rock(5.6, 5.55, 0.4, 0.24, 0.34);
  rock(6.15, 4.55, 0.32, 0.2, 0.28);

  const planks: Geo[] = [];
  for (let z = -5.5; z < 5.5; z += 0.28) planks.push(box(0.45, 6.15, DECK, DECK + 0.08, z, z + 0.22));
  deck(merge(planks));

  const eaveY = DECK + 3.05;
  const ridgeY = DECK + 5.55;
  const ridgeX = -1.5;
  const frontEave = 1.15;
  const backEave = -4.15;

  // Cabin shell. The right end stays open for the serving hatch.
  wall(box(-3.4, 0.28, DECK, eaveY, -4.75, 4.75));
  wall(box(0.22, 0.4, DECK, eaveY, -4.85, -4.55), true);
  wall(box(0.22, 0.4, DECK, eaveY, 4.45, 4.85), true);
  const battens: Geo[] = [];
  for (const z of [-4.6, -1.85, -0.45, 1.68, 2.82, 4.35]) battens.push(box(0.26, 0.38, DECK + 0.04, eaveY - 0.04, z, z + 0.08));
  for (let x = -3.1; x < 0.1; x += 0.5) battens.push(box(x, x + 0.08, DECK + 0.04, eaveY - 0.04, 4.72, 4.84));
  wall(merge(battens), true);

  const window = (z0: number, z1: number, y0: number, y1: number, cols: number, rows: number) => {
    put(box(0.32, 0.4, y0, y1, z0, z1), 'glass', GLASS_C, 0.01);
    wall(box(0.38, 0.5, y0 - 0.06, y0 + 0.05, z0 - 0.05, z1 + 0.05), true);
    wall(box(0.38, 0.5, y1 - 0.05, y1 + 0.06, z0 - 0.05, z1 + 0.05), true);
    wall(box(0.38, 0.5, y0, y1, z0 - 0.05, z0 + 0.05), true);
    wall(box(0.38, 0.5, y0, y1, z1 - 0.05, z1 + 0.05), true);
    for (let i = 1; i < cols; i++) {
      const z = z0 + ((z1 - z0) * i) / cols;
      wall(box(0.38, 0.48, y0, y1, z - 0.03, z + 0.03), true);
    }
    for (let i = 1; i < rows; i++) {
      const y = y0 + ((y1 - y0) * i) / rows;
      wall(box(0.38, 0.48, y - 0.03, y + 0.03, z0, z1), true);
    }
  };
  window(3.15, 4.2, DECK + 1.15, DECK + 2.35, 2, 2);
  window(-0.05, 1.45, DECK + 0.95, DECK + 2.45, 3, 2);
  window(-1.65, -0.5, DECK + 1.1, DECK + 2.25, 2, 2);

  // Door on the left of the porch.
  wall(box(0.3, 0.48, DECK + 0.02, DECK + 2.2, 2.05, 2.95), true);
  wall(box(0.44, 0.54, DECK + 0.7, DECK + 1.85, 2.28, 2.72));
  put(box(0.5, 0.56, DECK + 1.15, DECK + 1.26, 2.78, 2.86), 'metal', 0xc2b48a, 0);

  // Serving hatch on the image-right end, with two menu boards above a counter.
  put(box(0.18, 0.34, DECK + 0.15, DECK + 2.05, -4.7, -3.35), 'matte', 0x2a2622, 0.02);
  const menu = (z0: number, z1: number) => {
    wall(box(0.62, 0.76, DECK + 2.12, DECK + 2.98, z0, z1), true);
    const lines: Geo[] = [];
    for (let i = 0; i < 4; i++) lines.push(box(0.74, 0.82, DECK + 2.28 + i * 0.15, DECK + 2.36 + i * 0.15, z0 + 0.08, z1 - 0.08));
    put(merge(lines), 'matte', 0xe7e2d6, 0);
  };
  menu(-4.62, -4.05);
  menu(-3.95, -3.38);
  deck(box(0.4, 1.35, DECK + 0.9, DECK + 1.05, -4.8, -3.25));
  put(box(0.7, 0.95, DECK + 1.05, DECK + 1.28, -4.15, -3.85), 'matte', 0xd8d4cc, 0.02);
  put(box(0.78, 0.9, DECK + 1.26, DECK + 1.4, -4.05, -3.95), 'matte', 0x3a3e44, 0);
  for (const z of [-4.45, -4.28, -3.55]) {
    const bottle = new THREE.CylinderGeometry(0.045, 0.05, 0.28, 6);
    bottle.translate(0.85, DECK + 1.18, z);
    put(bottle, 'gloss', z === -4.28 ? 0x8f3a32 : 0xd8d2c4, 0.02);
  }

  // Porch: a small gable on two posts, ridge running out from the wall.
  wall(box(1.55, 1.7, DECK + 0.05, DECK + 2.45, 1.25, 1.4), true);
  wall(box(1.55, 1.7, DECK + 0.05, DECK + 2.45, 3.45, 3.6), true);
  const porchPeak = DECK + 2.95;
  const porchEave = DECK + 2.35;
  const slopeAlongZ = (z0: number, y0: number, z1: number, y1: number, x0: number, x1: number, thick: number) => {
    const dz = z1 - z0;
    const dy = y1 - y0;
    const len = Math.hypot(dz, dy);
    const g = new THREE.BoxGeometry(x1 - x0, thick, len);
    g.translate((x0 + x1) / 2, 0, len / 2);
    g.rotateX(-Math.atan2(dy, dz));
    g.translate(0, y0, z0);
    return g;
  };
  roof(merge([
    slopeAlongZ(1.15, porchEave, 2.45, porchPeak, 0.25, 1.85, 0.1),
    slopeAlongZ(2.45, porchPeak, 3.75, porchEave, 0.25, 1.85, 0.1),
  ]));

  // Solid gable roof. Each slope is one slab, with shingle lips along it.
  const slopeAlongX = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, thick: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const g = new THREE.BoxGeometry(len, thick, z1 - z0);
    g.translate(len / 2, 0, (z0 + z1) / 2);
    g.rotateZ(Math.atan2(dy, dx));
    g.translate(x0, y0, 0);
    return g;
  };
  const lips = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    let nx = dy / len;
    let ny = -dx / len;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const list: Geo[] = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.2) / n;
      const g = new THREE.BoxGeometry(0.18, 0.07, z1 - z0 - 0.15);
      g.rotateZ(Math.atan2(dy, dx));
      g.translate(x0 + dx * t + nx * 0.2, y0 + dy * t + ny * 0.2, (z0 + z1) / 2);
      list.push(g);
    }
    return list;
  };
  const roofZ0 = -5.45;
  const roofZ1 = 5.25;
  roof(merge([
    slopeAlongX(frontEave, eaveY, ridgeX, ridgeY, roofZ0, roofZ1, 0.18),
    slopeAlongX(backEave, eaveY, ridgeX, ridgeY, roofZ0, roofZ1, 0.18),
  ]));
  put(merge([
    ...lips(frontEave, eaveY, ridgeX, ridgeY, roofZ0, roofZ1),
    ...lips(backEave, eaveY, ridgeX, ridgeY, roofZ0, roofZ1),
  ]), 'rough', c.roofLt, 0.04);
  roof(box(ridgeX - 0.16, ridgeX + 0.16, ridgeY + 0.02, ridgeY + 0.16, roofZ0, roofZ1), true);
  const gableAt = (z: number, depth: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(backEave + 0.45, eaveY - 0.02);
    shape.lineTo(ridgeX, ridgeY - 0.08);
    shape.lineTo(frontEave - 0.35, eaveY - 0.02);
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.abs(depth), bevelEnabled: false });
    g.translate(0, 0, depth < 0 ? z + depth : z);
    return g;
  };
  wall(gableAt(4.62, 0.14));
  wall(gableAt(-4.9, 0.14));

  // Stone chimney on the front slope, just left of the serving hatch.
  const chimneyTop = ridgeY + 2.15;
  const chimneyBase = eaveY + 0.85;
  const stones: Geo[][] = [[], [], []];
  const tones = [0xb7b3aa, 0x9c978e, 0xc6c2b8];
  const stoneRand = rng(scheme === 'grey' ? 17 : 4);
  for (let i = 0; i < 7; i++) {
    const y0 = chimneyBase + ((chimneyTop - 0.5 - chimneyBase) * i) / 7;
    const y1 = y0 + (chimneyTop - 0.5 - chimneyBase) / 7 + 0.04;
    let z = -3.35;
    let n = 0;
    while (z < -2.15) {
      const w = 0.42 + stoneRand() * 0.38;
      const jut = stoneRand() * 0.16;
      stones[n % 3].push(box(-0.85 - jut, 0.12 + jut * 0.35, y0, y1 - 0.03, z, Math.min(-2.1, z + w)));
      z += w - 0.04;
      n++;
    }
  }
  tones.forEach((color, i) => put(merge(stones[i]), 'rough', color, 0.05));
  const cap: Geo[] = [
    box(-0.95, 0.22, chimneyTop - 0.4, chimneyTop + 0.08, -3.45, -3.1),
    box(-0.95, 0.22, chimneyTop - 0.4, chimneyTop + 0.08, -2.4, -2.05),
    box(-0.95, -0.62, chimneyTop - 0.4, chimneyTop + 0.08, -3.1, -2.4),
    box(-0.22, 0.22, chimneyTop - 0.4, chimneyTop + 0.08, -3.1, -2.4),
  ];
  stone(merge(cap));
  put(box(-0.58, -0.26, chimneyTop - 0.7, chimneyTop - 0.28, -3.08, -2.42), 'matte', 0x1c1916, 0.02);

  // Low stone wall around the service yard.
  const yard: Geo[] = [];
  const rand2 = rng(91);
  const yardRun = (x0: number, x1: number, z0: number, z1: number) => {
    let y = DECK;
    while (y < DECK + 1.15) {
      const h = 0.3 + rand2() * 0.18;
      let a = Math.min(x0, z0);
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const limit = alongX ? x1 : z1;
      a = alongX ? x0 : z0;
      while (a < limit - 0.1) {
        const w = 0.65 + rand2() * 0.75;
        const b = Math.min(limit, a + w);
        if (alongX) yard.push(box(a, b, y, y + h, z0, z1));
        else yard.push(box(x0, x1, y, y + h, a, b));
        a = b - 0.02;
      }
      y += h - 0.04;
    }
  };
  yardRun(0.15, 5.6, -6.35, -5.75);
  yardRun(-0.15, 0.4, -6.2, -4.7);
  stone(merge(yard));

  // Rail fence on the left of the deck and a short run by the yard.
  const fenceRun = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 1.6));
    const posts: Geo[] = [];
    const rails: Geo[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      posts.push(box(-0.06, 0.06, 0, 0.95, -0.06, 0.06).applyMatrix4(placement(x0 + (x1 - x0) * t, DECK + 0.08, z0 + (z1 - z0) * t, 0)));
    }
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    for (const h of [0.38, 0.72]) {
      const midX = (x0 + x1) / 2;
      const midZ = (z0 + z1) / 2;
      rails.push(box(-0.04, 0.04, h, h + 0.08, -len / 2, len / 2).applyMatrix4(placement(midX, DECK + 0.08, midZ, yaw)));
    }
    deck(merge([...posts, ...rails]));
  };
  fenceRun(2.2, 5.35, 5.8, 5.35);
  fenceRun(5.8, 5.35, 5.8, 2.4);
  fenceRun(4.6, -5.45, 5.9, -5.45);

  const planter = (x: number, z: number, h: number) => {
    const pot = new THREE.CylinderGeometry(0.28, 0.22, 0.38, 7);
    pot.translate(x, DECK + 0.28, z);
    put(pot, 'rough', 0xd4c4a4, 0.04);
    const crown = new THREE.ConeGeometry(0.32 + h * 0.06, h, 7);
    crown.translate(x, DECK + 0.48 + h / 2, z);
    put(crown, 'foliage', h > 1 ? LEAF : LEAF_LT, 0.04);
  };
  planter(2.3, 4.55, 1.25);
  planter(1.7, 3.15, 0.85);
  planter(1.55, 0.55, 1.05);
  planter(1.7, -1.7, 0.95);

  const flowers = (x: number, z: number, len: number) => {
    deck(box(x - 0.22, x + 0.22, DECK + 0.08, DECK + 0.32, z - len / 2, z + len / 2));
    put(box(x - 0.16, x + 0.16, DECK + 0.28, DECK + 0.42, z - len / 2 + 0.06, z + len / 2 - 0.06), 'foliage', 0x3e7a44, 0.04);
    for (let i = 0; i < 3; i++) {
      const bloom = new THREE.IcosahedronGeometry(0.09, 0);
      bloom.translate(x, DECK + 0.5, z - len * 0.28 + i * len * 0.28);
      put(bloom, 'foliage', i === 1 ? WHITE : PINK, 0.02);
    }
  };
  flowers(1.15, 3.9, 0.7);
  flowers(1.15, -0.9, 1.15);
  flowers(1.2, -2.5, 0.85);

  const picnic = (x: number, z: number, yaw: number) => {
    const top = box(-0.7, 0.7, 0.72, 0.8, -0.38, 0.38);
    const leg = (lx: number) => box(lx - 0.06, lx + 0.06, 0, 0.74, -0.32, 0.32);
    const bench = (lz: number) => box(-0.6, 0.6, 0.4, 0.48, lz - 0.12, lz + 0.12);
    const benchLeg = (lx: number, lz: number) => box(lx - 0.04, lx + 0.04, 0, 0.42, lz - 0.04, lz + 0.04);
    const g = merge([
      top, leg(-0.5), leg(0.5),
      bench(0.62), bench(-0.62),
      benchLeg(-0.5, 0.62), benchLeg(0.5, 0.62), benchLeg(-0.5, -0.62), benchLeg(0.5, -0.62),
    ]);
    g.applyMatrix4(placement(x, DECK + 0.08, z, yaw));
    deck(g);
    const cloth = box(-0.62, 0.62, 0.8, 0.86, -0.32, 0.32);
    const checks: Geo[] = [];
    for (let i = -2; i <= 2; i++) checks.push(box(-0.62, 0.62, 0.86, 0.91, i * 0.12 - 0.012, i * 0.12 + 0.012));
    for (let i = -2; i <= 2; i++) checks.push(box(i * 0.24 - 0.012, i * 0.24 + 0.012, 0.86, 0.91, -0.32, 0.32));
    cloth.applyMatrix4(placement(x, DECK + 0.08, z, yaw));
    put(cloth, 'cloth', CLOTH, 0.01);
    const grid = merge(checks);
    grid.applyMatrix4(placement(x, DECK + 0.08, z, yaw));
    put(grid, 'cloth', CHECK, 0.01);
  };
  picnic(3.4, 3.6, 0.5);
  picnic(4.3, 0.4, 0.2);
  picnic(4.5, -2.6, -0.15);

  return prepare(parts);
}

/** Footprint. Depth is along +X, width along Z. */
export const ALPINE_RESTAURANT_SIZE = { front: FRONT, back: BACK, w: HALF_W * 2, h: 7.4 };

/** A wooden restaurant on Col du Nord, a grey one on Col du Sud, and one at Passo Giau. The pass has a refuge, not a village. */
export function placeAlpineRestaurants(site: Site): void {
  placeOne(site, 'twins-nord', 'wood');
  placeOne(site, 'twins-sud', 'grey');
  placeOne(site, 'giau-selva', 'wood');
}

function placeOne(site: Site, climbId: string, scheme: Scheme): void {
  const climb = site.route.climbs.find((item) => item.id === climbId);
  if (!climb) return;
  const dir = climb.end >= climb.start ? 1 : -1;
  const s = climb.end - dir * 16;
  const roadY = site.roadY(s);
  let side: 1 | -1 = 1;
  let lowest = Infinity;
  for (const candidate of [1, -1] as const) {
    const q = site.at(s, candidate * 24);
    const rise = site.ground(q.x, q.z) - roadY;
    if (rise < lowest) {
      lowest = rise;
      side = candidate;
    }
  }
  const lat = side * (ROAD_HALF_WIDTH + HALF_W + 6);
  const p = site.at(s, lat);
  const y = Math.max(roadY - 0.15, site.ground(p.x, p.z) - 0.25);
  const sample = site.route.sample(s);
  const yaw = Math.atan2(sample.tz, -sample.tx);
  site.props.place(alpineRestaurant(scheme), placement(p.x, y, p.z, yaw));
  site.occupy(p.x, p.z, yaw, FRONT + BACK, HALF_W * 2, 3);
  site.solid(p.x, p.z, yaw, FRONT + BACK, HALF_W * 2, y, ALPINE_RESTAURANT_SIZE.h);
  site.props.clearing(p.x, p.z, 18);
}
