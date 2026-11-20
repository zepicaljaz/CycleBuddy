import * as THREE from 'three';
import { prepare, type Prepared } from './batch';
import { merge, paint, placement } from './geometry';
import type { Model } from './materials';
import { ROAD_HALF_WIDTH } from './terrainField';
import type { Site } from './site';

/**
 * Modern alpine hotel from the reference: flat roofs, a dark cantilevered wing,
 * a glass centre, and a stone terrace with a fireplace and outdoor tables.
 * Local +X is the terrace front. +Z is the dark wing (image-left).
 * y = 0 is the top of the ground; the stone base stands on it and a foundation continues below.
 */

const DARK = 0x3a3f46;
const CONCRETE = 0xd7d5d0;
const ROOF = 0xcccbc7;
const FASCIA = 0x4e535a;
const TILE = 0xc4c6c9;
const STONE = 0xb6b2a9;
const GLASS_C = 0xd4e1ea;
const WARM = 0xe6d4bf;
const METAL = 0x9aa1a8;
const WOOD = 0x6b5342;
const LEAF = 0x2e6a3c;
const LEAF_LT = 0x3d7d48;
const PINK = 0xe38996;
const WHITE = 0xf3f0e8;
const FIRE = 0xff6a22;
const FLAME = 0xffc56a;

const FRONT = 8.2;
const BACK = 6.2;
const HALF_W = 9.6;
const DECK = 1.58;

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

export function modernHotel(): Prepared {
  const parts: Model = [];
  let seed = 11;
  const put = (g: Geo, mat: Model[number]['mat'], color: number, jitter = 0) => {
    parts.push({ geom: paint(g, color, { crease: 0, jitter, seed: seed++ }), mat });
  };
  const stone = (g: Geo) => put(g, 'rough', STONE, 0.07);
  const dark = (g: Geo) => put(g, 'matte', DARK, 0.02);
  const concrete = (g: Geo) => put(g, 'matte', CONCRETE, 0.015);
  const glass = (g: Geo, color = GLASS_C) => put(g, 'glass', color, 0.01);

  // Foundation, then the raised terrace the reference sits on.
  stone(box(-BACK, FRONT - 0.4, -6, 0.2, -HALF_W + 0.4, HALF_W - 0.4));
  const blocks: Geo[] = [];
  const rand = rng(19);
  const courses = (along: 'x' | 'z', outer: number, sign: 1 | -1, y0: number, y1: number, a0: number, a1: number) => {
    let y = y0;
    while (y < y1 - 0.08) {
      const h = 0.32 + rand() * 0.22;
      const top = Math.min(y1, y + h);
      let a = a0;
      while (a < a1 - 0.15) {
        const w = 0.85 + rand() * 1.15;
        const b = Math.min(a1, a + w);
        const jut = rand() * 0.28;
        const depth = 0.42 + rand() * 0.28;
        const yLo = y + rand() * 0.04;
        const yHi = top - 0.015;
        if (along === 'z') {
          const xOut = outer + sign * jut;
          const xIn = outer - sign * depth;
          blocks.push(box(Math.min(xOut, xIn), Math.max(xOut, xIn), yLo, yHi, a + 0.04, b - 0.04));
        } else {
          const zOut = outer + sign * jut;
          const zIn = outer - sign * depth;
          blocks.push(box(a + 0.04, b - 0.04, yLo, yHi, Math.min(zOut, zIn), Math.max(zOut, zIn)));
        }
        a = b - 0.03;
      }
      y = top - 0.03;
    }
  };
  courses('z', 7.15, 1, 0, DECK, -8.7, 8.5);
  courses('x', -8.85, -1, 0, DECK, -1.2, 7.15);
  courses('x', 8.55, 1, 0, DECK * 0.72, 1.4, 7.15);
  stone(merge(blocks));
  // Loose rocks at the near corner.
  const rock = (x: number, z: number, sx: number, sy: number, sz: number, spin: number) => {
    const g = new THREE.DodecahedronGeometry(1, 0);
    g.scale(sx, sy, sz);
    g.rotateY(spin);
    g.translate(x, sy * 0.45, z);
    stone(g);
  };
  rock(7.7, -8.2, 0.7, 0.38, 0.55, 0.4);
  rock(6.6, -8.6, 0.45, 0.28, 0.4, 1.1);
  rock(8.1, 6.4, 0.5, 0.3, 0.42, 0.6);

  // Pavers.
  const tiles: Geo[] = [];
  for (let x = 0.55; x < 6.9; x += 0.92) {
    for (let z = -8.2; z < 8.2; z += 0.92) {
      tiles.push(box(x, x + 0.84, DECK, DECK + 0.06, z, Math.min(8.15, z + 0.84)));
    }
  }
  put(merge(tiles), 'matte', TILE, 0.02);

  const railAlongZ = (x: number, z0: number, z1: number) => {
    const posts = Math.max(2, Math.round(Math.abs(z1 - z0) / 1.7));
    for (let i = 0; i <= posts; i++) {
      const z = z0 + ((z1 - z0) * i) / posts;
      put(box(x - 0.04, x + 0.04, DECK + 0.04, DECK + 0.98, z - 0.04, z + 0.04), 'metal', METAL, 0);
    }
    glass(box(x - 0.015, x + 0.015, DECK + 0.08, DECK + 0.78, z0, z1));
    put(box(x - 0.03, x + 0.03, DECK + 0.9, DECK + 0.98, z0, z1), 'metal', METAL, 0);
  };
  const railAlongX = (z: number, x0: number, x1: number) => {
    const posts = Math.max(2, Math.round(Math.abs(x1 - x0) / 1.7));
    for (let i = 0; i <= posts; i++) {
      const x = x0 + ((x1 - x0) * i) / posts;
      put(box(x - 0.04, x + 0.04, DECK + 0.04, DECK + 0.98, z - 0.04, z + 0.04), 'metal', METAL, 0);
    }
    glass(box(x0, x1, DECK + 0.08, DECK + 0.78, z - 0.015, z + 0.015));
    put(box(x0, x1, DECK + 0.9, DECK + 0.98, z - 0.03, z + 0.03), 'metal', METAL, 0);
  };
  railAlongZ(6.45, -7.7, 7.7);
  railAlongX(-8.15, 0.6, 6.45);
  railAlongX(8.05, 1.5, 6.45);

  // Dark cantilevered wing, image-left. Upper floor is a framed box over a glass ground floor.
  dark(box(-4.55, 1.75, 4.32, 4.52, 2.7, 8.15));
  dark(box(-4.7, -4.35, 4.32, 7.02, 2.55, 8.25));
  dark(box(-4.55, 1.8, 4.32, 7.02, 2.55, 2.82));
  dark(box(-4.55, 1.8, 4.32, 7.02, 7.95, 8.25));
  dark(box(1.55, 1.82, 4.32, 4.7, 2.7, 8.15));
  dark(box(1.55, 1.82, 6.55, 7.02, 2.7, 8.15));
  glass(box(1.28, 1.4, 4.75, 6.4, 3.05, 7.75), WARM);
  for (let y = 4.9; y < 6.35; y += 0.26) dark(box(1.62, 1.8, y, y + 0.07, 2.95, 7.85));
  glass(box(-1.1, 0.9, 4.85, 6.25, 8.05, 8.16), WARM);
  for (let y = 5; y < 6.2; y += 0.3) dark(box(-1.05, 0.95, y, y + 0.06, 8.12, 8.24));
  put(box(-2.4, -0.4, 4.7, 5.35, 4.2, 6.8), 'cloth', 0xddd6cc, 0.02);
  // Ground floor, set back so the upper floor overhangs it.
  dark(box(-4.4, -0.15, DECK + 0.02, 4.28, 3.15, 3.42));
  dark(box(-4.4, -0.15, DECK + 0.02, 4.28, 7.55, 7.82));
  dark(box(-4.4, -3.9, DECK + 0.02, 4.28, 3.15, 7.82));
  glass(box(0.2, 0.32, DECK + 0.28, 3.95, 3.5, 7.45), WARM);
  dark(box(0.26, 0.4, DECK + 0.22, 4.15, 3.42, 3.55));
  dark(box(0.26, 0.4, DECK + 0.22, 4.15, 7.4, 7.55));
  dark(box(0.26, 0.4, 3.9, 4.12, 3.42, 7.55));
  put(box(-1.6, -0.35, DECK + 0.5, DECK + 1.05, 4.5, 6.5), 'cloth', 0xd9d3c8, 0.02);

  // Centre: two-storey glazing, with the stair left open so it reads through the facade.
  concrete(box(-4.6, -0.05, DECK, 6.55, -2.35, -0.2));
  concrete(box(-4.6, -0.05, DECK, 6.55, 1.35, 2.55));
  const mullion = (x: number, y0: number, y1: number, z0: number, z1: number, cols: number) => {
    glass(box(x, x + 0.06, y0, y1, z0, z1));
    for (let i = 0; i <= cols; i++) {
      const z = z0 + ((z1 - z0) * i) / cols;
      dark(box(x + 0.04, x + 0.14, y0, y1, z - 0.04, z + 0.04));
    }
    dark(box(x + 0.04, x + 0.14, y0 - 0.04, y0 + 0.05, z0, z1));
    dark(box(x + 0.04, x + 0.14, y1 - 0.05, y1 + 0.04, z0, z1));
    dark(box(x + 0.04, x + 0.14, (y0 + y1) / 2 - 0.035, (y0 + y1) / 2 + 0.035, z0, z1));
  };
  mullion(0.12, DECK + 0.2, 4.15, -2.15, -0.35, 1);
  mullion(0.12, 4.22, 6.45, -2.15, 2.45, 3);
  mullion(0.12, DECK + 0.2, 4.15, 1.15, 2.45, 1);
  // Open stair bay, lowest steps proud of the glazing so the flight reads from the terrace.
  put(box(-2.7, -2.35, DECK + 0.05, 6.35, -0.15, 1.25), 'matte', WARM, 0.02);
  for (let i = 0; i < 8; i++) {
    const x1 = 0.42 - i * 0.34;
    const y0 = DECK + 0.08 + i * 0.3;
    dark(box(x1 - 0.34, x1, y0, y0 + 0.07, 0.05, 1.08));
  }
  dark(box(-2.2, 0.22, DECK + 0.35, 5.9, 1.08, 1.16));
  concrete(box(-3.2, 0.05, 4.12, 4.28, -2.2, 2.5));

  // Ribbed column where the dark wing meets the glass.
  for (let i = 0; i < 4; i++) dark(box(0.05, 0.28, DECK + 0.1, 6.6, 2.35 + i * 0.12, 2.42 + i * 0.12));

  // Right wing: concrete, upper glazing, fireplace and the terrace bar.
  concrete(box(-4.8, 0.25, DECK, 6.35, -8.15, -2.15));
  mullion(0.18, 4.35, 6.15, -7.55, -2.55, 3);
  glass(box(-1.6, 0.1, 4.55, 6.05, -8.12, -8.0));
  // Fireplace, glass front, flame in front of the concrete pier.
  concrete(box(0.35, 1.7, DECK, DECK + 0.38, -5.45, -3.25));
  dark(box(0.5, 1.55, DECK + 0.38, DECK + 2.15, -5.35, -5.15));
  dark(box(0.5, 1.55, DECK + 0.38, DECK + 2.15, -3.55, -3.35));
  dark(box(0.5, 1.55, DECK + 1.95, DECK + 2.15, -5.35, -3.35));
  glass(box(1.42, 1.5, DECK + 0.45, DECK + 1.15, -5.05, -3.65));
  put(box(1.5, 1.85, DECK + 0.48, DECK + 1.45, -4.9, -3.8), 'glow', FIRE, 0);
  put(box(1.58, 1.9, DECK + 1.2, DECK + 2.0, -4.65, -4.05), 'glow', FLAME, 0);
  glass(box(0.15, 0.28, DECK + 0.4, DECK + 3.4, -8.05, -7.9));
  // Bar and the two menu boards.
  concrete(box(0.35, 1.65, DECK, DECK + 1.05, -7.7, -5.55));
  dark(box(0.45, 1.55, DECK + 1.02, DECK + 1.1, -7.55, -5.7));
  put(box(1.15, 1.45, DECK + 1.1, DECK + 1.28, -6.5, -6.15), 'gloss', 0xc9b08a, 0);
  dark(box(0.22, 0.32, DECK + 1.7, DECK + 2.85, -7.45, -6.55));
  dark(box(0.22, 0.32, DECK + 1.7, DECK + 2.85, -6.4, -5.55));
  for (const z0 of [-7.35, -6.3]) {
    for (let k = 0; k < 4; k++) put(box(0.3, 0.36, DECK + 1.85 + k * 0.22, DECK + 1.98 + k * 0.22, z0, z0 + 0.7), 'matte', 0xd5d8dc, 0);
  }

  // Roofs. The dark wing keeps its own parapet; the main roof overhangs the bar with a pergola.
  put(box(-5.05, 1.85, 6.95, 7.22, 2.35, 8.55), 'matte', ROOF, 0.015);
  dark(box(-5.2, 1.95, 7.05, 7.32, 2.22, 2.4));
  dark(box(-5.2, 1.95, 7.05, 7.32, 8.4, 8.58));
  dark(box(-5.2, -4.95, 7.05, 7.32, 2.22, 8.58));
  dark(box(1.7, 1.95, 7.05, 7.32, 2.22, 8.58));
  put(box(-5.5, 2.7, 6.42, 6.82, -8.45, 2.55), 'matte', ROOF, 0.015);
  dark(box(-5.65, 2.85, 6.55, 6.95, -8.6, -8.4));
  dark(box(2.55, 2.85, 6.55, 6.95, -8.6, 2.55));
  dark(box(-5.65, 2.85, 6.55, 6.95, 2.4, 2.58));
  const slats: Geo[] = [];
  for (let z = -7.7; z < -1.7; z += 0.38) slats.push(box(0.7, 3.05, 6.28, 6.4, z, z + 0.08));
  for (let z = 1.15; z < 2.7; z += 0.32) slats.push(box(0.85, 2.15, 6.22, 6.34, z, z + 0.07));
  put(merge(slats), 'matte', FASCIA, 0.02);

  // Back wall so the uphill side is not an open shell.
  concrete(box(-5.3, -4.5, DECK, 6.5, -8, 8.1));

  const planter = (x: number, z: number, h: number, lean = 0) => {
    concrete(box(x - 0.32, x + 0.32, DECK + 0.06, DECK + 0.48, z - 0.32, z + 0.32));
    const trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.25, 5);
    trunk.translate(x, DECK + 0.58, z);
    put(trunk, 'rough', 0x5c4030, 0.03);
    const crown = new THREE.ConeGeometry(0.34 + h * 0.08, h, 7);
    crown.translate(x + lean, DECK + 0.7 + h / 2, z);
    put(crown, 'foliage', h > 1 ? LEAF : LEAF_LT, 0.04);
    const tip = new THREE.ConeGeometry(0.16, h * 0.45, 6);
    tip.translate(x + lean, DECK + 0.7 + h * 0.82, z);
    put(tip, 'foliage', LEAF_LT, 0.03);
  };
  planter(5.7, 6.15, 1.35);
  planter(4.35, 3.55, 0.85);
  planter(2.15, 0.15, 1.15, 0.04);
  planter(5.55, -1.35, 0.95);
  planter(2.55, -6.55, 1.05);

  const flowers = (x: number, z: number, len: number) => {
    concrete(box(x - 0.28, x + 0.28, DECK + 0.06, DECK + 0.38, z - len / 2, z + len / 2));
    put(box(x - 0.22, x + 0.22, DECK + 0.34, DECK + 0.48, z - len / 2 + 0.08, z + len / 2 - 0.08), 'foliage', 0x3f7a45, 0.04);
    for (let i = 0; i < 3; i++) {
      const zz = z - len * 0.28 + i * len * 0.28;
      const bloom = new THREE.IcosahedronGeometry(0.1, 0);
      bloom.translate(x, DECK + 0.58, zz);
      put(bloom, 'foliage', i === 1 ? WHITE : PINK, 0.02);
    }
  };
  flowers(4.7, 5.15, 1.15);
  flowers(3.9, -2.55, 1.25);
  flowers(3.15, -5.15, 1.05);

  const chair = (x: number, y: number, z: number, yaw: number) => {
    const seat = box(-0.16, 0.16, 0, 0.045, -0.16, 0.16);
    const back = box(-0.16, -0.12, 0.04, 0.42, -0.15, 0.15);
    const leg = (lx: number, lz: number) => box(lx - 0.02, lx + 0.02, -0.42, 0, lz - 0.02, lz + 0.02);
    const g = merge([seat, back, leg(-0.12, -0.12), leg(0.12, -0.12), leg(-0.12, 0.12), leg(0.12, 0.12)]);
    g.applyMatrix4(placement(x, y, z, yaw));
    put(g, 'matte', 0x4c5158, 0.01);
  };
  const table = (x: number, z: number, yaw: number) => {
    const top = box(-0.55, 0.55, 0, 0.05, -0.34, 0.34);
    const legs = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(sx * 0.42 - 0.03, sx * 0.42 + 0.03, -0.72, 0, sz * 0.24 - 0.03, sz * 0.24 + 0.03)));
    const g = merge([top, ...legs]);
    g.applyMatrix4(placement(x, DECK + 0.78, z, yaw));
    put(g, 'matte', WOOD, 0.03);
    chair(x + Math.cos(yaw) * 0.05 + Math.sin(yaw) * 0.55, DECK + 0.72, z - Math.sin(yaw) * 0.05 + Math.cos(yaw) * 0.55, yaw + Math.PI / 2);
    chair(x + Math.cos(yaw) * 0.05 - Math.sin(yaw) * 0.55, DECK + 0.72, z - Math.sin(yaw) * 0.05 - Math.cos(yaw) * 0.55, yaw - Math.PI / 2);
    chair(x + Math.cos(yaw) * 0.72, DECK + 0.72, z - Math.sin(yaw) * 0.72, yaw + Math.PI);
    chair(x - Math.cos(yaw) * 0.72, DECK + 0.72, z + Math.sin(yaw) * 0.72, yaw);
  };
  table(4.85, 4.55, 0.4);
  table(5.15, -2.35, 0.15);
  table(4.35, -5.7, -0.35);

  return prepare(parts);
}

/** Footprint of the hotel. Depth is along +X, width along Z. */
export const MODERN_HOTEL_SIZE = { front: FRONT, back: BACK, w: HALF_W * 2, h: 8.4 };

/** The hotel stands beside the Alpe du Geant summit, front facing riders coming up. */
export function placeModernHotel(site: Site): void {
  const climb = site.route.climbs.find((c) => c.id === 'alpine-geant');
  if (!climb) return;
  const dir = climb.end >= climb.start ? 1 : -1;
  const s = climb.end - dir * 16;
  const roadY = site.roadY(s);
  let side: 1 | -1 = 1;
  let lowest = Infinity;
  for (const candidate of [1, -1] as const) {
    const q = site.at(s, candidate * 26);
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
  site.props.place(modernHotel(), placement(p.x, y, p.z, yaw));
  site.occupy(p.x, p.z, yaw, FRONT + BACK, HALF_W * 2, 3);
  site.solid(p.x, p.z, yaw, FRONT + BACK, HALF_W * 2, y, MODERN_HOTEL_SIZE.h);
  site.props.clearing(p.x, p.z, 22);
}
