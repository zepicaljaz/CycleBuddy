import * as THREE from 'three';
import type { Route } from '../routes/route';
import { ROUTE_DS } from '../routes/route';
import { prepare, type Prepared } from './batch';
import { merge, paint, placement } from './geometry';
import { material, type Model } from './materials';
import type { TerrainField } from './terrainField';

/**
 * The transmitter on Mont Ventoux: a plain concrete shaft and the red-and-white
 * mast that stands on the summit knob, just north of where the road ends.
 * Low poly, one of them, only on this climb.
 */

const CONCRETE = 0xd7d5d0;
const BAND = 0xb9b6b0;
const WINDOW = 0x3a424c;
const WHITE = 0xf4f2ed;
const RED = 0xd43244;
const STONE = 0xb3aea4;

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

function mast(y0: number, y1: number, radius: number): Geo {
  const h = Math.max(1e-3, y1 - y0);
  return new THREE.CylinderGeometry(radius, radius, h, 6).translate(0, y0 + h / 2, 0);
}

let built: Prepared | null = null;

export function ventouxAntenna(): Prepared {
  if (built) return built;
  const parts: Model = [];
  let seed = 3;
  const put = (g: Geo, mat: Model[number]['mat'], color: number, jitter = 0) => {
    parts.push({ geom: paint(g, color, { crease: 0, jitter, seed: seed++ }), mat });
  };

  // Buried pad, so the shaft sits in the slope instead of on a point.
  put(box(-6.4, 6.4, -8, 0.15, -6.4, 6.4), 'rough', STONE, 0.04);
  put(box(-5.4, 5.4, 0, 1.5, -5.4, 5.4), 'matte', CONCRETE, 0.02);
  put(box(-4.1, 4.1, 1.5, 38, -4.1, 4.1), 'matte', CONCRETE, 0.015);

  const windows: Geo[] = [];
  const face = 4.1;
  const proud = 0.16;
  for (let row = 0; row < 7; row++) {
    const y = 5.2 + row * 4.35;
    for (const along of [-1.55, 1.55]) {
      windows.push(box(face, face + proud, y, y + 1.35, along - 0.42, along + 0.42));
      windows.push(box(-face - proud, -face, y, y + 1.35, along - 0.42, along + 0.42));
      windows.push(box(along - 0.42, along + 0.42, y, y + 1.35, face, face + proud));
      windows.push(box(along - 0.42, along + 0.42, y, y + 1.35, -face - proud, -face));
    }
  }
  put(merge(windows), 'matte', WINDOW, 0.02);

  put(box(-5.3, 5.3, 38, 42.4, -5.3, 5.3), 'matte', CONCRETE, 0.015);
  put(box(-5.7, 5.7, 42.4, 43.05, -5.7, 5.7), 'matte', BAND, 0.02);
  put(box(-2.3, -0.9, 43.05, 45.2, -2.1, -0.7), 'matte', BAND, 0.02);
  put(box(1.1, 2.5, 43.05, 44.6, 0.8, 2.2), 'metal', 0x8e949c, 0.02);

  // White, then the long red band, then white at the tip. That banding is the mast.
  put(mast(43.05, 51.2, 0.78), 'paint', WHITE);
  put(mast(51.2, 67.4, 0.72), 'paint', RED);
  put(mast(67.4, 75.2, 0.62), 'paint', WHITE);
  put(mast(75.2, 76.3, 0.28), 'glow', RED);

  built = prepare(parts);
  return built;
}

function nearestRoad(route: Route, s0: number, s1: number, x: number, z: number): number {
  const a = Math.max(0, Math.floor(Math.min(s0, s1) / ROUTE_DS));
  const b = Math.min(route.count - 1, Math.ceil(Math.max(s0, s1) / ROUTE_DS));
  let best = Infinity;
  for (let i = a; i <= b; i++) {
    const dx = route.x[i] - x;
    const dz = route.z[i] - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Stands the mast on the summit bench, just north of the finish (the rider's
 * left on the way up). Further north the terrain grid falls below the road,
 * so the tower stays where the ground is still the summit and clear of the asphalt.
 * Returns null on every other route.
 */
export function ventouxAntennaGroup(route: Route, field: TerrainField): THREE.Group | null {
  const climb = route.climbs.find((c) => c.id === 'ventoux-bedoin');
  if (!climb) return null;
  const dir = climb.end >= climb.start ? 1 : -1;
  const s = climb.end - dir * 8;
  const side = -1;
  let lat = side * 22;
  for (let n = 0; n < 4; n++) {
    const q = route.place(s, lat);
    if (nearestRoad(route, climb.end - 80, climb.end + 280, q.x, q.z) > 16) break;
    lat += side * 6;
  }
  const p = route.place(s, lat);
  // Seat the shaft on the high side of the footprint, so the bank does not cut through the concrete.
  let y = field.heightAt(p.x, p.z);
  for (const dx of [-5, 0, 5]) {
    for (const dz of [-5, 0, 5]) y = Math.max(y, field.heightAt(p.x + dx, p.z + dz));
  }
  const sample = route.sample(s);
  const yaw = Math.atan2(side * sample.tx, side * sample.tz);
  const m = placement(p.x, y, p.z, yaw);
  const group = new THREE.Group();
  group.name = 'ventoux-antenna';
  for (const g of ventouxAntenna().groups) {
    const geom = g.geom.clone();
    geom.applyMatrix4(m);
    const mesh = new THREE.Mesh(geom, material(g.mat));
    mesh.castShadow = g.mat !== 'glow';
    mesh.receiveShadow = g.mat !== 'glow';
    group.add(mesh);
  }
  return group;
}
