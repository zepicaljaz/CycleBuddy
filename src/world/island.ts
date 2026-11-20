import * as THREE from 'three';
import { boat, pier } from './boats';
import { building } from './buildings';
import { merge, paint, placement } from './geometry';
import { gardenTree } from './props';
import type { Site } from './site';
import type { LakeIsland } from './terrainField';

/**
 * The island in the middle of Mirror Lake: a steep oval, a lawn, a stair down to
 * a landing, and a church with a spire facing the shore. The shape follows the
 * island in Lake Bled, kept in this game's low-poly style.
 */
export function placeLakeIsland(site: Site): void {
  const island = site.field.islandCenter();
  const water = site.water;
  if (!island || water === null) return;
  const field = site.field;
  const fx = Math.cos(island.yaw);
  const fz = -Math.sin(island.yaw);
  const at = (toward: number, beside: number) => ({
    x: island.x + fx * toward + fz * beside,
    z: island.z + fz * toward - fx * beside,
  });

  const church = building('church', 2);
  const ground = field.heightAt(island.x, island.z);
  const y = ground - 0.2;
  site.props.place(church.model, placement(island.x, y, island.z, island.yaw), {
    wall: 0xf4f1ea,
    roof: 0x6e342e,
    accent: 0xc6a15a,
  });
  site.props.clearing(island.x, island.z, 26);

  let shore = island.across;
  for (let dist = 24; dist < 150; dist += 2) {
    const p = at(dist, 0);
    if (field.heightAt(p.x, p.z) < water + 0.9) {
      shore = dist;
      break;
    }
  }

  const steps = stair(site, island, at, church.front + 0.8, Math.max(church.front + 8, shore - 1.5));
  site.props.addWorld(steps, 'rough');

  const dock = at(shore - 0.4, 0);
  const deck = water + 0.48;
  site.props.place(pier(12, 2.3, deck - water + 1.25), placement(dock.x, deck, dock.z, island.yaw));
  const boatAt = at(shore + 7.5, 3.1);
  site.props.place(boat('row'), placement(boatAt.x, water, boatAt.z, island.yaw + Math.PI / 2));
  site.props.clearing(dock.x, dock.z, 9);

  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2 + 0.35;
    const rad = 38 + (i % 4) * 6;
    const toward = Math.cos(ang) * rad;
    const beside = Math.sin(ang) * rad;
    if (toward > 14 && Math.abs(beside) < 7) continue;
    const p = at(toward, beside);
    const ty = field.heightAt(p.x, p.z);
    if (ty < water + 2.2) continue;
    const scale = 1.7 + (i % 5) * 0.22;
    site.props.place(gardenTree(i % 6), placement(p.x, ty - 0.15, p.z, ang * 1.7, scale));
  }
}

function stair(
  site: Site,
  island: LakeIsland,
  at: (toward: number, beside: number) => { x: number; z: number },
  from: number,
  to: number,
): THREE.BufferGeometry {
  const yaw = island.yaw;
  const n = Math.max(10, Math.round((to - from) / 1.25));
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = from + ((to - from) * i) / n;
    const x1 = from + ((to - from) * (i + 1)) / n;
    const p = at((x0 + x1) / 2, 0);
    const gy = site.field.heightAt(p.x, p.z);
    const depth = x1 - x0 + 0.12;
    const rise = 0.34;
    const tread = new THREE.BoxGeometry(depth, rise, 4.4);
    tread.translate(0, gy + 0.06 - rise * 0.35, 0);
    tread.rotateY(yaw);
    tread.translate(p.x, 0, p.z);
    parts.push(paint(tread, 0xd5d0c4, { crease: 0.35, jitter: 0.035, seed: i + 4 }));
    for (const side of [-1, 1]) {
      const rail = new THREE.BoxGeometry(depth, 0.62, 0.16);
      rail.translate(0, gy + 0.42, side * 2.05);
      rail.rotateY(yaw);
      rail.translate(p.x, 0, p.z);
      parts.push(paint(rail, 0xe7e2d8, { crease: 0.5, jitter: 0.02, seed: i + 20 + side }));
    }
    site.props.clearing(p.x, p.z, 4.2);
  }
  const top = at(from - 2.2, 0);
  const pad = new THREE.BoxGeometry(6.2, 0.28, 8.4);
  const py = site.field.heightAt(top.x, top.z);
  pad.translate(0, py + 0.02, 0);
  pad.rotateY(yaw);
  pad.translate(top.x, 0, top.z);
  parts.push(paint(pad, 0xddd8ce, { crease: 0.4, jitter: 0.03, seed: 2 }));
  return merge(parts);
}
