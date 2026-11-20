import * as THREE from 'three';
import type { Route } from '../routes/route';
import type { MapPolygon } from '../routes/types';
import { placement } from './geometry';
import { signPost } from './props';
import type { Site } from './site';
import { ROAD_HALF_WIDTH, type TerrainField } from './terrainField';
import { textTexture } from './textures';

const GRAVEL = 0x6e675c;
const WATER = 0x3f8b86;

/**
 * Lake Jasna and the Vršič parking lots. The polygons are already in the road's
 * local metres (see scripts/real-track/build.mjs). Water is a finite mesh at the
 * lake's own level, not the valley-wide water plane.
 */
export function buildMappedPlaces(route: Route, field: TerrainField, site: Site | null): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mapped-places';
  const places = route.def.track?.places;
  if (!places) return group;

  const waterMat = new THREE.MeshStandardMaterial({ color: WATER, roughness: 0.28, metalness: 0.02, side: THREE.DoubleSide });
  const gravel = new THREE.MeshStandardMaterial({
    color: GRAVEL,
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });

  for (const lake of places.lakes) {
    const geom = polygonGeometry(lake.x, lake.z, (x, z) => {
      const p = clearOfRoad(route, field, x, z, ROAD_HALF_WIDTH + 2);
      return { x: p.x, y: (lake.level ?? 0) + 0.08, z: p.z };
    });
    const mesh = new THREE.Mesh(geom, waterMat);
    mesh.name = lake.name;
    group.add(mesh);
  }

  for (const lot of places.lots) {
    const geom = polygonGeometry(lot.x, lot.z, (x, z) => {
      const p = clearOfRoad(route, field, x, z, ROAD_HALF_WIDTH + 0.5);
      return { x: p.x, y: field.heightAt(p.x, p.z) + 0.05, z: p.z };
    });
    const mesh = new THREE.Mesh(geom, gravel);
    mesh.name = lot.name;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (site) {
      parkCars(site, field, lot);
      parkingSign(site, route, field, lot);
    }
  }
  return group;
}

function polygonGeometry(xs: number[], zs: number[], place: (x: number, z: number) => { x: number; y: number; z: number }): THREE.BufferGeometry {
  const ring = xs.map((x, i) => place(x, zs[i]));
  const shape = new THREE.Shape();
  shape.moveTo(ring[0].x, ring[0].z);
  for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i].x, ring[i].z);
  shape.closePath();
  const geom = new THREE.ShapeGeometry(shape);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const p = place(pos.getX(i), pos.getY(i));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/** Push a point that sits on the asphalt out to the verge, so a lot or lake does not cover the ride line. */
function clearOfRoad(route: Route, field: TerrainField, x: number, z: number, minDist: number): { x: number; z: number } {
  const near = field.nearestRoad(x, z);
  if (!near || near.d >= minDist) return { x, z };
  let dx = x - route.x[near.i];
  let dz = z - route.z[near.i];
  const len = Math.hypot(dx, dz);
  if (len < 0.2) {
    dx = route.tz[near.i];
    dz = -route.tx[near.i];
  } else {
    dx /= len;
    dz /= len;
  }
  return { x: route.x[near.i] + dx * minDist, z: route.z[near.i] + dz * minDist };
}

function pointInRing(x: number, z: number, xs: number[], zs: number[]): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if ((zs[i] > z) !== (zs[j] > z) && x < ((xs[j] - xs[i]) * (z - zs[i])) / (zs[j] - zs[i]) + xs[i]) inside = !inside;
  }
  return inside;
}

function parkCars(site: Site, field: TerrainField, lot: MapPolygon): void {
  const n = lot.x.length;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += lot.x[i];
    cz += lot.z[i];
  }
  cx /= n;
  cz /= n;
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (let i = 0; i < n; i++) {
    const dx = lot.x[i] - cx;
    const dz = lot.z[i] - cz;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
  }
  const ang = 0.5 * Math.atan2(2 * xz, xx - zz);
  const ax = Math.cos(ang);
  const az = Math.sin(ang);
  const bx = -az;
  const bz = ax;
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = lot.x[i] - cx;
    const dz = lot.z[i] - cz;
    const a = dx * ax + dz * az;
    const b = dx * bx + dz * bz;
    a0 = Math.min(a0, a);
    a1 = Math.max(a1, a);
    b0 = Math.min(b0, b);
    b1 = Math.max(b1, b);
  }
  const along = a1 - a0;
  const across = b1 - b0;
  const long = along >= across;
  const lx = long ? ax : bx;
  const lz = long ? az : bz;
  const wx = long ? bx : ax;
  const wz = long ? bz : az;
  const l0 = long ? a0 : b0;
  const l1 = long ? a1 : b1;
  const w0 = long ? b0 : a0;
  const w1 = long ? b1 : a1;
  const spanL = l1 - l0;
  const spanW = w1 - w0;
  const insetL = 3.2;
  const insetW = 2.2;
  if (spanL < insetL * 2 + 4 || spanW < insetW * 2 + 1.8) return;
  const rows = Math.min(4, Math.max(1, Math.floor((spanL - insetL * 2) / 5.6)));
  const cols = Math.min(4, Math.max(1, Math.floor((spanW - insetW * 2) / 2.7)));
  let placed = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const l = l0 + insetL + ((r + 0.5) * (spanL - insetL * 2)) / rows;
      const w = w0 + insetW + ((c + 0.5) * (spanW - insetW * 2)) / cols;
      const x = cx + lx * l + wx * w;
      const z = cz + lz * l + wz * w;
      if (!pointInRing(x, z, lot.x, lot.z)) continue;
      if (field.overWater(x, z)) continue;
      const face = (r + c) % 2 === 0 ? 1 : -1;
      // The whole car, not just its centre, has to stay off the asphalt.
      let onRoad = field.roadDistance(x, z) < ROAD_HALF_WIDTH + 3.2;
      for (let k = 0; k < 8 && !onRoad; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (field.roadDistance(x + Math.cos(a) * 2.5, z + Math.sin(a) * 2.5) < ROAD_HALF_WIDTH + 0.6) onRoad = true;
      }
      if (onRoad) continue;
      const yaw = Math.atan2(-(lz * face), lx * face);
      const ahead = field.heightAt(x + lx * face * 1.6, z + lz * face * 1.6);
      const behind = field.heightAt(x - lx * face * 1.6, z - lz * face * 1.6);
      const pitch = Math.atan((ahead - behind) / 3.2);
      site.car(x, field.heightAt(x, z) + 0.04, z, yaw, pitch);
      placed++;
      if (placed >= 8) return;
    }
  }
}

function parkingSign(site: Site, route: Route, field: TerrainField, lot: MapPolygon): void {
  let best = Infinity;
  let sx = lot.x[0];
  let sz = lot.z[0];
  for (let i = 0; i < lot.x.length; i++) {
    const d = field.roadDistance(lot.x[i], lot.z[i]);
    if (d < best) {
      best = d;
      sx = lot.x[i];
      sz = lot.z[i];
    }
  }
  const p = clearOfRoad(route, field, sx, sz, ROAD_HALF_WIDTH + 1.6);
  if (field.overWater(p.x, p.z)) return;
  const near = field.nearestRoad(p.x, p.z);
  const y = field.heightAt(p.x, p.z);
  site.props.place(signPost(), placement(p.x, y, p.z));
  const face = new THREE.MeshStandardMaterial({
    map: textTexture([{ text: 'P', size: 180, color: '#ffffff', weight: '800' }], '#1e5c9a', 256, 256),
    roughness: 0.55,
  });
  const back = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.8 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.06), [back, back, back, back, face, back]);
  board.position.set(p.x, y + 2.2, p.z);
  if (near) board.rotation.y = Math.atan2(route.x[near.i] - p.x, route.z[near.i] - p.z);
  board.castShadow = true;
  site.props.group.add(board);
}
