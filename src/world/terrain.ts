import * as THREE from 'three';
import type { ChunkRequest, ChunkResult } from './terrainChunk';
import type { FieldInput } from './terrainField';
import type { Biome } from '../routes/types';
import { addWindSway, broadleafDetailed, broadleafSimple, cactus, pineDetailed, pineSimple, rock, rockWarm, shrub, spruceDetailed, spruceSimple } from './models';
import { isPropAsset, propAsset } from './propAssets';

const NEAR = 512;
const FAR = NEAR * 4;
/** Far tiles beyond this distance grow sparser trees. */
const SPARSE_TREES = 7000;

export interface TerrainQuality {
  viewDistance: number;
  splitDistance: number;
  lod0Distance: number;
  treeDensity: number;
  /** Chunks whose near edge is at least this far from the camera grow no trees. */
  treeDistance?: number;
}

interface ChunkSpec {
  key: string;
  x0: number;
  z0: number;
  size: number;
  segs: number;
  treeSpacing: number;
  propDetail: 0 | 1;
  treeScale: number;
  dist: number;
  castShadow: boolean;
}

interface LiveChunk {
  spec: ChunkSpec;
  group: THREE.Group;
}

const rectDistance = (x0: number, z0: number, size: number, px: number, pz: number) => {
  const dx = Math.max(x0 - px, 0, px - (x0 + size));
  const dz = Math.max(z0 - pz, 0, pz - (z0 + size));
  return Math.hypot(dx, dz);
};

/** Same olive as the moor grass, so grassland trees do not read as a brighter green. */
const MOOR_FOLIAGE = [0x6a7040, 0x746e44, 0x5c6238] as const;

/**
 * Per prop slot (0 conifer, 1 broadleaf, 2 rock, 3 scrub on land-cover scrub cells; the worker's prop type), the models
 * that can stand there. A slot with several models picks one per prop from its
 * position; a name listed twice is twice as common.
 */
type PropSlots = THREE.BufferGeometry[][];

const BOULDERS = ['boulder_a', 'boulder_b', 'boulder_c', 'boulder_d', 'boulder_e'];

/**
 * Blender models by name (src/assets/models, see scripts/blender/CLAUDE.md), or the
 * code-built fallback when none of them loaded.
 */
function models(names: readonly string[], far: boolean, fallback: () => THREE.BufferGeometry): THREE.BufferGeometry[] {
  const found = names.map((n) => propAsset(n, far)).filter((g): g is THREE.BufferGeometry => g !== null);
  return found.length ? found : [fallback()];
}

/**
 * Fallback for land-cover scrub (prop type PROP_SCRUB = 3: heath, alpenrose, dwarf pine)
 * when the Blender mugo model is missing.
 */
function scrubGeom(biome: Biome): THREE.BufferGeometry {
  return biome === 'moor' ? shrub(MOOR_FOLIAGE) : shrub([0x4f6a34, 0x5a7238, 0x46602e]);
}

/** Which trees and rocks grow in each biome, near (`detailed`) and far (`simple`). */
function propGeomsFor(biome: Biome): { detailed: PropSlots; simple: PropSlots } {
  const level = (far: boolean): PropSlots => {
    if (biome === 'desert') return [[shrub()], [cactus()], [rockWarm()], [shrub()]];
    const rocks = models(BOULDERS, far, rock);
    // Scrub cells (heath, alpenrose, dwarf pine): the Blender mugo, else a low shrub.
    const scrub = biome === 'moor' ? [scrubGeom(biome)] : models(['mugo'], far, () => scrubGeom(biome));
    if (biome === 'moor') {
      // Holm oak's dark olive crown sits with the moor grass; a bright beech would not.
      return [[shrub(MOOR_FOLIAGE)], models(['holm_oak'], far, () => (far ? broadleafSimple(MOOR_FOLIAGE[0]) : broadleafDetailed(MOOR_FOLIAGE))), rocks, scrub];
    }
    if (biome === 'spruce') {
      // The worker never asks for slot 1 here (spruce forests are all conifer).
      const spruce = models(['spruce_a', 'spruce_a', 'spruce_b'], far, far ? spruceSimple : spruceDetailed);
      return [spruce, spruce, rocks, scrub];
    }
    const conifers = biome === 'limestone' ? ['spruce_a', 'larch', 'scots_pine'] : ['spruce_a', 'spruce_a', 'spruce_b', 'larch'];
    return [
      models(conifers, far, far ? pineSimple : pineDetailed),
      models(['beech'], far, () => (far ? broadleafSimple() : broadleafDetailed())),
      rocks,
      scrub,
    ];
  };
  return { detailed: level(false), simple: level(true) };
}

/** Stable pick of one of `n` models for a prop at world (x, z). */
const variantAt = (x: number, z: number, n: number) => {
  const h = Math.imul(Math.round(x * 4) ^ Math.imul(Math.round(z * 4), 0x27d4eb2d), 0x165667b1);
  // Fold the high bits down: a multiply's low bits only depend on the inputs' low bits.
  return ((h ^ (h >>> 15)) >>> 0) % n;
};

const overlaps = (a: ChunkSpec, b: ChunkSpec) =>
  a.x0 < b.x0 + b.size && b.x0 < a.x0 + a.size && a.z0 < b.z0 + b.size && b.z0 < a.z0 + a.size;

export class TerrainManager {
  readonly group = new THREE.Group();
  private workers: Worker[] = [];
  private inflight = new Map<number, ChunkSpec>();
  private workerLoad: number[] = [];
  private live = new Map<string, LiveChunk>();
  private desired = new Map<string, ChunkSpec>();
  private requestedKeys = new Set<string>();
  private nextId = 1;
  /** Desired chunks may still be missing. Cleared once every one is live or requested. */
  private pumpDirty = true;
  private lastFocus = new THREE.Vector2(Infinity, Infinity);
  private readyWorkers = 0;
  private material: THREE.MeshStandardMaterial;
  private propMaterial: THREE.MeshStandardMaterial;
  private propGeoms: { detailed: PropSlots; simple: PropSlots };
  readonly windTime = { value: 0 };
  quality: TerrainQuality;
  onProgress?: (loaded: number, wanted: number) => void;

  constructor(input: FieldInput, quality: TerrainQuality) {
    this.quality = quality;
    this.group.name = 'terrain';
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    this.propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    addWindSway(this.propMaterial, this.windTime, 0.012);
    const biome = input.scenery.biome ?? 'alpine';
    this.propGeoms = propGeomsFor(biome);
    const n = Math.min(3, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onMessage(i, e.data);
      w.postMessage({ type: 'init', input });
      this.workers.push(w);
      this.workerLoad.push(0);
    }
  }

  get ready(): boolean {
    return this.readyWorkers === this.workers.length;
  }

  /** Fraction of desired chunks currently displayed. */
  get progress(): number {
    if (!this.desired.size) return 0;
    let have = 0;
    for (const k of this.desired.keys()) if (this.live.has(k)) have++;
    return have / this.desired.size;
  }

  private onMessage(worker: number, msg: { type: string; res?: ChunkResult }) {
    if (msg.type === 'ready') {
      this.readyWorkers++;
      this.pumpDirty = true;
      return;
    }
    if (msg.type !== 'chunk' || !msg.res) return;
    this.workerLoad[worker]--;
    const spec = this.inflight.get(msg.res.id);
    this.inflight.delete(msg.res.id);
    if (!spec) return;
    this.requestedKeys.delete(spec.key);
    // A worker slot came free, so a chunk that was waiting can go out.
    this.pumpDirty = true;
    if (!this.desired.has(spec.key)) return;
    this.live.set(spec.key, { spec, group: this.buildMesh(spec, msg.res) });
    this.collectGarbage();
  }

  private buildMesh(spec: ChunkSpec, res: ChunkResult): THREE.Group {
    const group = new THREE.Group();
    group.position.set(spec.x0, 0, spec.z0);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(res.colors, 3));
    geom.boundingBox = new THREE.Box3(new THREE.Vector3(0, res.minY - 40, 0), new THREE.Vector3(spec.size, res.maxY + 20, spec.size));
    geom.boundingSphere = geom.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geom, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = spec.castShadow;
    group.add(mesh);

    const props = res.props;
    const count = props.length / 6;
    if (count > 0) {
      const geoms = spec.propDetail === 0 ? this.propGeoms.detailed : this.propGeoms.simple;
      // One InstancedMesh per model, as before; a slot with several models splits its props.
      const byModel = new Map<string, { type: number; geom: THREE.BufferGeometry; list: number[] }>();
      for (let i = 0; i < count; i++) {
        const type = props[i * 6 + 5];
        const slot = geoms[type];
        const v = slot.length > 1 ? variantAt(spec.x0 + props[i * 6], spec.z0 + props[i * 6 + 2], slot.length) : 0;
        const key = `${type}:${slot[v].id}`;
        let entry = byModel.get(key);
        if (!entry) byModel.set(key, (entry = { type, geom: slot[v], list: [] }));
        entry.list.push(i);
      }
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      const c = new THREE.Color();
      byModel.forEach(({ type, geom, list }) => {
        const inst = new THREE.InstancedMesh(geom, this.propMaterial, list.length);
        list.forEach((i, k) => {
          const o = i * 6;
          const scale = props[o + 3];
          q.setFromAxisAngle(up, props[o + 4]);
          // Trees vary in height (0.85-1.35) and lean a little warmer or cooler,
          // so a hillside is not one stamped tree. Rocks only vary in brightness.
          const h1 = ((i * 2654435761) >>> 0) % 1000 / 1000;
          const h2 = ((i * 40503 + 17) >>> 0) % 1000 / 1000;
          s.set(scale, type === 2 ? scale : scale * (0.85 + h2 * 0.5), scale);
          p.set(props[o], props[o + 1], props[o + 2]);
          m.compose(p, q, s);
          inst.setMatrixAt(k, m);
          const tint = 0.86 + ((i * 7919) % 100) / 400;
          if (type === 2) inst.setColorAt(k, c.setRGB(tint, tint, tint));
          else inst.setColorAt(k, c.setRGB(tint * (0.9 + h1 * 0.2), tint * (1.0 + h2 * 0.05), tint * (0.84 + (1 - h1) * 0.14)));
        });
        inst.castShadow = spec.castShadow;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        group.add(inst);
      });
    }
    this.group.add(group);
    return group;
  }

  /** Remove chunks no longer desired once everything overlapping them is ready. */
  private collectGarbage() {
    for (const [key, chunk] of this.live) {
      if (this.desired.has(key)) continue;
      let covered = true;
      for (const spec of this.desired.values()) {
        if (overlaps(spec, chunk.spec) && !this.live.has(spec.key)) {
          covered = false;
          break;
        }
      }
      if (covered) {
        this.disposeChunk(chunk);
        this.live.delete(key);
      }
    }
  }

  private disposeChunk(chunk: LiveChunk) {
    this.group.remove(chunk.group);
    chunk.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }

  update(focus: THREE.Vector3, dt: number): void {
    this.windTime.value += dt;
    const fx = focus.x - this.lastFocus.x;
    const fz = focus.z - this.lastFocus.y;
    // Infinity - Infinity is NaN after a refresh; treat that as moved.
    if (!(fx * fx + fz * fz <= 24 * 24)) {
      this.lastFocus.set(focus.x, focus.z);
      this.computeDesired(focus.x, focus.z);
      this.collectGarbage();
      this.updateShadowFlags(focus.x, focus.z);
      this.pumpDirty = true;
    }
    if (this.pumpDirty) this.pump();
  }

  private updateShadowFlags(px: number, pz: number) {
    for (const chunk of this.live.values()) {
      const cast = chunk.spec.size === NEAR && rectDistance(chunk.spec.x0, chunk.spec.z0, NEAR, px, pz) < 260;
      if (chunk.spec.castShadow === cast) continue;
      chunk.spec.castShadow = cast;
      chunk.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = cast;
      });
    }
  }

  /** Forces a full re-evaluation (e.g. after a quality change or teleport). */
  refresh(focus: THREE.Vector3): void {
    this.lastFocus.set(Infinity, Infinity);
    this.update(focus, 0);
  }

  private computeDesired(px: number, pz: number) {
    const q = this.quality;
    const desired = new Map<string, ChunkSpec>();
    const r = Math.ceil(q.viewDistance / FAR) + 1;
    const fcx = Math.floor(px / FAR);
    const fcz = Math.floor(pz / FAR);
    const density = q.treeDensity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const fx = (fcx + dx) * FAR;
        const fz = (fcz + dz) * FAR;
        const fd = rectDistance(fx, fz, FAR, px, pz);
        if (fd > q.viewDistance) continue;
        if (fd < q.splitDistance) {
          for (let j = 0; j < 4; j++) {
            for (let i = 0; i < 4; i++) {
              const x0 = fx + i * NEAR;
              const z0 = fz + j * NEAR;
              const d = rectDistance(x0, z0, NEAR, px, pz);
              let lod: 0 | 1 | 2 = 2;
              if (d < q.lod0Distance) lod = 0;
              else if (d < q.splitDistance * 0.75) lod = 1;
              const segs = lod === 0 ? 64 : lod === 1 ? 32 : 16;
              const spacing = (lod === 0 ? 9 : lod === 1 ? 15 : 26) / density;
              const trees = q.treeDistance === undefined || d < q.treeDistance;
              const treeSpacing = trees ? spacing : 0;
              // Tree spacing is in the key, so a new density or tree range rebuilds the chunk.
              const key = `N${x0},${z0},${lod},${treeSpacing.toFixed(2)}`;
              desired.set(key, {
                key, x0, z0, size: NEAR, segs, treeSpacing,
                propDetail: lod === 0 ? 0 : 1,
                treeScale: lod === 2 ? 1.25 : 1,
                dist: d,
                castShadow: d < 260,
              });
            }
          }
        } else {
          const trees = q.treeDistance === undefined || fd < q.treeDistance;
          // Past SPARSE_TREES a tree is a pixel or two: fewer, slightly bigger ones keep the slope
          // reading as wooded at about 40 % of the triangles.
          const sparse = fd > SPARSE_TREES;
          const treeSpacing = trees ? (sparse ? 75 : 48) / density : 0;
          const key = `F${fx},${fz},${treeSpacing.toFixed(2)}`;
          desired.set(key, {
            key, x0: fx, z0: fz, size: FAR, segs: 32, treeSpacing,
            propDetail: 1, treeScale: sparse ? 2.1 : 1.7, dist: fd, castShadow: false,
          });
        }
      }
    }
    this.desired = desired;
  }

  private pump() {
    if (!this.ready) return;
    const missing = [...this.desired.values()]
      .filter((s) => !this.live.has(s.key) && !this.requestedKeys.has(s.key))
      .sort((a, b) => a.dist - b.dist);
    let sent = 0;
    for (const spec of missing) {
      let best = 0;
      for (let i = 1; i < this.workers.length; i++) if (this.workerLoad[i] < this.workerLoad[best]) best = i;
      if (this.workerLoad[best] >= 3) break;
      sent++;
      const id = this.nextId++;
      const req: ChunkRequest = {
        id, x0: spec.x0, z0: spec.z0, size: spec.size, segs: spec.segs,
        treeSpacing: spec.treeSpacing, propDetail: spec.propDetail, treeScale: spec.treeScale,
      };
      this.inflight.set(id, spec);
      this.requestedKeys.add(spec.key);
      this.workerLoad[best]++;
      this.workers[best].postMessage({ type: 'chunk', req });
    }
    // Everything missing is now in flight. The next reply or focus move sets the flag again.
    if (sent === missing.length) this.pumpDirty = false;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const chunk of this.live.values()) this.disposeChunk(chunk);
    this.live.clear();
    this.material.dispose();
    this.propMaterial.dispose();
    // Blender models are shared by every world (propAssets caches them); only code-built ones are ours.
    for (const g of new Set([...this.propGeoms.detailed.flat(), ...this.propGeoms.simple.flat()])) if (!isPropAsset(g)) g.dispose();
  }
}
