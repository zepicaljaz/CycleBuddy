import * as THREE from 'three';
import type { Route } from '../routes/route';
import { ROUTE_DS } from '../routes/route';
import { ROAD_HALF_WIDTH, type TerrainField } from './terrainField';

/** Tufts are laid this far behind and ahead of the followed point, along the road. */
const BEHIND = 60;
const AHEAD = 190;
/** One tuft site per side every this many metres. */
const SPACING = 2.4;
/** Re-laid once the followed point has moved this far. */
const REFILL = 24;
const CAPACITY = Math.ceil(((BEHIND + AHEAD + REFILL) / SPACING) * 2) + 8;

const GRASS: Record<string, number[]> = {
  alpine: [0x6f9440, 0x7e9c45, 0x5f8638, 0x8fa24c, 0x6a8a3c],
  limestone: [0x84984a, 0x96a356, 0x7a8f45, 0xa3a560],
  moor: [0x7f7d4c, 0x8c8452, 0x6f7446, 0x998d5a],
  desert: [0xb09a5e, 0xc2a868, 0x9e8b55, 0xb8a46e],
};

/** Integer hash to 0..1. Same site, same tuft, every time it is laid. */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Three flat blades crossing at 120 degrees, darker at the root. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const lean = 0.07;
    pos.push(-cz * 0.11, 0, cx * 0.11, cz * 0.11, 0, -cx * 0.11, cx * lean, 0.42 - k * 0.05, cz * lean);
    col.push(0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 1.08, 1.08, 1.08);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Grass tufts on the verge, only around the rider. One instanced mesh, refilled
 * every 24 m of travel; nothing is stored for the rest of the route.
 */
export class VergeGrass {
  readonly mesh: THREE.InstancedMesh;
  private lastS = Infinity;
  private palette: THREE.Color[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  private sample = { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0 };
  private loop: boolean;

  constructor(
    private route: Route,
    private field: TerrainField,
  ) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, flatShading: true });
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), mat, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'verge-grass';
    this.loop = isLoop(route);
    this.palette = (GRASS[route.def.scenery.biome ?? 'alpine'] ?? GRASS.alpine).map((h) => new THREE.Color(h));
  }

  update(s: number): void {
    const route = this.route;
    const moved = Math.abs(s - this.lastS);
    if (Math.min(moved, route.length - moved) < REFILL) return;
    this.lastS = s;
    const field = this.field;
    const water = route.def.scenery.waterLevel;
    const treeline = route.def.scenery.treeline;
    const sample = this.sample;
    let n = 0;
    const k0 = Math.floor((s - BEHIND) / SPACING);
    const k1 = Math.ceil((s + AHEAD) / SPACING);
    for (let k = k0; k <= k1 && n < CAPACITY; k++) {
      for (const side of [-1, 1]) {
        const id = k * 2 + (side > 0 ? 1 : 0);
        const r0 = hash(id);
        if (r0 < 0.3) continue;
        const along = k * SPACING + hash(id + 7919) * SPACING;
        if ((along < 0 || along > route.length) && !this.loop) continue;
        const lateral = side * (ROAD_HALF_WIDTH + 1.25 + hash(id + 104729) * 3.6);
        if (field.isTown(Math.floor(route.wrap(along) / ROUTE_DS) % route.count)) continue;
        route.place(along, lateral, sample);
        const y = field.heightAt(sample.x, sample.z);
        if (Math.abs(y - sample.y) > 2.5) continue;
        if (water !== null && y < water + 0.4) continue;
        if (y > treeline + 220 && r0 < 0.75) continue;
        const scree = route.def.scenery.screeLine;
        if (scree != null && y > scree) continue;
        if (field.cleared(sample.x, sample.z) || field.onLake(sample.x, sample.z) || field.blocksProp(sample.x, sample.z)) continue;
        const size = 0.7 + hash(id + 31) * 0.75;
        this.q.setFromAxisAngle(this.up, hash(id + 17) * Math.PI * 2);
        this.m.compose(this.p.set(sample.x, y - 0.03, sample.z), this.q, this.sc.set(size, size * (0.8 + hash(id + 3) * 0.6), size));
        this.mesh.setMatrixAt(n, this.m);
        const base = this.palette[Math.floor(hash(id + 5) * this.palette.length)];
        this.mesh.setColorAt(n, this.c.copy(base).multiplyScalar(0.9 + hash(id + 11) * 0.2));
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** A closed loop joins its ends; an excerpt for the homepage does not. */
function isLoop(route: Route): boolean {
  const last = route.count - 1;
  return Math.hypot(route.x[0] - route.x[last], route.z[0] - route.z[last]) < 24;
}
