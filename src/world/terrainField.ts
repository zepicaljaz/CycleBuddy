import { ROUTE_DS } from '../routes/route';
import { lerp, smoothstep } from '../util/math';
import { Noise2D } from '../util/noise';
import type { CoverGrid, DemGrid, MapPolygon, SceneryDef, TrackPlaces } from '../routes/types';

export const ROAD_HALF_WIDTH = 3.8;

/** Plain-data description of a route, so the field can be rebuilt inside a worker. */
export interface FieldInput {
  x: Float32Array;
  z: Float32Array;
  y: Float32Array;
  seed: number;
  scenery: SceneryDef;
  /** 1 where a road sample runs through a town, so trees stay out of the streets. */
  town?: Uint8Array;
  /** Circles (x, z, radius) kept free of trees: yards, car parks, fields. */
  clear?: Float32Array;
  /** Real height grids around a real road, fine first. Outside them the terrain is generated. */
  dem?: DemGrid[] | null;
  /** Land-cover classes (LandCover) on the same grids as `dem`, fine first. Null keeps the generated look. */
  cover?: CoverGrid[] | null;
  /**
   * Shelves cut into the mesh so a paved terrace is not pierced by a coarse
   * triangle. Each pad is 12 floats: ax, az, bx, bz, ox, oz, a0, a1, b0, b1,
   * height, blend. (ax, az) and (bx, bz) are unit axes; the shelf is the
   * rectangle [a0, a1] × [b0, b1] around (ox, oz), and the height eases back
   * to the hillside across `blend` metres outside that rectangle.
   */
  pads?: Float32Array;
  /** OpenStreetMap lakes and parking lots, in the same local metres as the road. */
  places?: TrackPlaces;
}

const CLEAR_CELL = 64;

const CELL = 8;
const TILE = 64;
const TILE_SIZE = CELL * TILE;
const STAMP_RADIUS = 280;
const IDW_SIGMA = 55;
const COARSE_CELL = 250;
const COARSE_SIGMA = 1300;
const MED_CELL = 100;
const MED_SIGMA = 380;
const HASH_CELL = 32;

interface Tile {
  dist: Float32Array;
  esum: Float32Array;
  wsum: Float32Array;
  /** Road sample that owns this cell, or -1. */
  near: Int32Array;
}

const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);

interface MapArea {
  x: Float32Array;
  z: Float32Array;
  level: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function compileArea(p: MapPolygon): MapArea {
  const x = Float32Array.from(p.x);
  const z = Float32Array.from(p.z);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < x.length; i++) {
    minX = Math.min(minX, x[i]);
    maxX = Math.max(maxX, x[i]);
    minZ = Math.min(minZ, z[i]);
    maxZ = Math.max(maxZ, z[i]);
  }
  return { x, z, level: p.level ?? NaN, minX, maxX, minZ, maxZ };
}

function insideAny(areas: MapArea[], x: number, z: number): boolean {
  for (const area of areas) {
    if (x < area.minX || x > area.maxX || z < area.minZ || z > area.maxZ) continue;
    if (ringHas(area, x, z)) return true;
  }
  return false;
}

function ringHas(area: MapArea, x: number, z: number): boolean {
  const xs = area.x;
  const zs = area.z;
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const yi = zs[i];
    const yj = zs[j];
    if ((yi > z) !== (yj > z) && x < ((xs[j] - xs[i]) * (z - yi)) / (yj - yi) + xs[i]) inside = !inside;
  }
  return inside;
}

function ringEdge(area: MapArea, x: number, z: number): number {
  const xs = area.x;
  const zs = area.z;
  let best = Infinity;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const dx = xs[i] - xs[j];
    const dz = zs[i] - zs[j];
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - xs[j]) * dx + (z - zs[j]) * dz) / l2));
    const ex = xs[j] + dx * t - x;
    const ez = zs[j] + dz * t - z;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** A Bled-style island: an oval mound in the lake, church facing the near shore. */
export interface LakeIsland {
  x: number;
  z: number;
  /** Yaw that points the church front toward the near shore. */
  yaw: number;
  /** Half-width along the shore, metres. */
  along: number;
  /** Half-width toward the shore, metres. */
  across: number;
}

export interface NearestRoad {
  d: number;
  elev: number;
  /** Index of the nearest road sample. */
  i: number;
}

/**
 * Height field built around the road: the road is carved exactly into the terrain,
 * nearby slopes follow the road elevation (so hairpin stacks form hillsides), and
 * procedural ridges rise further away.
 */
export class TerrainField {
  readonly scenery: SceneryDef;
  private readonly rx: Float32Array;
  private readonly rz: Float32Array;
  private readonly ry: Float32Array;
  private readonly n: number;
  private readonly tiles = new Map<number, Tile>();
  private readonly hash = new Map<number, number[]>();
  private readonly noise: Noise2D;
  private readonly coarse: Float32Array;
  private readonly coarseW: number;
  private readonly coarseH: number;
  private readonly coarseX0: number;
  private readonly coarseZ0: number;
  private readonly med: Float32Array;
  private readonly medDist: Float32Array;
  private readonly medW: number;
  private readonly medH: number;
  private readonly medX0: number;
  private readonly medZ0: number;
  readonly minRoadY: number;
  private readonly town: Uint8Array | null;
  /** 0..1, how strongly this road sample is cut into a hillside. */
  private cut!: Float32Array;
  /** +1 when the hillside rises to the right of travel. */
  private uphill!: Float32Array;
  /** Simplified centerline, used to tell the lake from the land. */
  private loopPoly: { x: number; z: number }[] | null = null;
  private readonly insideCache = new Map<number, boolean>();
  private clearData: Float32Array | null = null;
  private readonly dem: DemGrid[] | null;
  private readonly demOut = { h: 0, w: 0 };
  private readonly cover: CoverGrid[] | null;
  private readonly clearHash = new Map<number, number[]>();
  /** A small island in a lakeshore route, or null. */
  private island: LakeIsland | null = null;
  /** Paved shelves. See FieldInput.pads. */
  private pads: Float32Array | null = null;
  private readonly lakes: MapArea[] = [];
  private readonly lots: MapArea[] = [];
  private readonly woods: MapArea[] = [];
  /** Radius of the open verge at this road sample, or 0. The way back is included. */
  private openRadius: Float32Array | null = null;

  constructor(input: FieldInput) {
    this.town = input.town ?? null;
    this.dem = input.dem?.length ? input.dem : null;
    this.cover = input.cover?.length ? input.cover : null;
    this.pads = input.pads ?? null;
    for (const lake of input.places?.lakes ?? []) this.lakes.push(compileArea(lake));
    for (const lot of input.places?.lots ?? []) this.lots.push(compileArea(lot));
    for (const wood of input.places?.cover?.wood ?? []) this.woods.push(compileArea(wood));
    if (input.clear) this.setClearings(input.clear);
    this.scenery = input.scenery;
    this.rx = input.x;
    this.rz = input.z;
    this.ry = input.y;
    this.n = input.x.length;
    this.markOpenRoad();
    this.noise = new Noise2D(input.seed * 13 + 1);
    if (input.scenery.lakeshore) {
      const poly: { x: number; z: number }[] = [];
      for (let i = 0; i < this.n; i += 6) poly.push({ x: this.rx[i], z: this.rz[i] });
      this.loopPoly = poly;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let sumY = 0;
    let minY = Infinity;
    for (let i = 0; i < this.n; i++) {
      minX = Math.min(minX, this.rx[i]);
      maxX = Math.max(maxX, this.rx[i]);
      minZ = Math.min(minZ, this.rz[i]);
      maxZ = Math.max(maxZ, this.rz[i]);
      sumY += this.ry[i];
      minY = Math.min(minY, this.ry[i]);
    }
    this.minRoadY = minY;
    const meanY = sumY / this.n;

    // Spatial hash of all road samples for exact nearest-road queries.
    for (let i = 0; i < this.n; i++) {
      const k = key(Math.floor(this.rx[i] / HASH_CELL), Math.floor(this.rz[i] / HASH_CELL));
      let arr = this.hash.get(k);
      if (!arr) this.hash.set(k, (arr = []));
      arr.push(i);
    }
    this.buildCuts();

    // Fine sparse tiles: approximate distance + smoothed road elevation.
    const r = Math.ceil(STAMP_RADIUS / CELL);
    const inv2s2 = 1 / (2 * IDW_SIGMA * IDW_SIGMA);
    let cachedTx = Infinity;
    let cachedTz = Infinity;
    let tile: Tile | undefined;
    for (let i = 0; i < this.n; i += 3) {
      const px = this.rx[i];
      const pz = this.rz[i];
      const py = this.ry[i];
      const cx = Math.floor(px / CELL);
      const cz = Math.floor(pz / CELL);
      for (let dz = -r; dz <= r; dz++) {
        const gz = cz + dz;
        const wz = (gz + 0.5) * CELL - pz;
        const tz = Math.floor(gz / TILE);
        const lz = gz - tz * TILE;
        for (let dx = -r; dx <= r; dx++) {
          const gx = cx + dx;
          const wx = (gx + 0.5) * CELL - px;
          const d2 = wx * wx + wz * wz;
          if (d2 > STAMP_RADIUS * STAMP_RADIUS) continue;
          const tx = Math.floor(gx / TILE);
          if (tx !== cachedTx || tz !== cachedTz || !tile) {
            tile = this.tileFor(gx, gz, true)!;
            cachedTx = tx;
            cachedTz = tz;
          }
          const lx = gx - tx * TILE;
          const idx = lz * TILE + lx;
          const d = Math.sqrt(d2);
          if (d < tile.dist[idx]) {
            tile.dist[idx] = d;
            tile.near[idx] = i;
          }
          const w = Math.exp(-d2 * inv2s2);
          tile.esum[idx] += w * py;
          tile.wsum[idx] += w;
        }
      }
    }

    // Coarse regional elevation so far-away terrain sits at a plausible level.
    const margin = 16000;
    this.coarseX0 = minX - margin;
    this.coarseZ0 = minZ - margin;
    this.coarseW = Math.ceil((maxX - minX + 2 * margin) / COARSE_CELL) + 1;
    this.coarseH = Math.ceil((maxZ - minZ + 2 * margin) / COARSE_CELL) + 1;
    this.coarse = new Float32Array(this.coarseW * this.coarseH);
    const cInv = 1 / (2 * COARSE_SIGMA * COARSE_SIGMA);
    const samples: number[] = [];
    for (let i = 0; i < this.n; i += 50) samples.push(i);
    for (let gz = 0; gz < this.coarseH; gz++) {
      for (let gx = 0; gx < this.coarseW; gx++) {
        const x = this.coarseX0 + gx * COARSE_CELL;
        const z = this.coarseZ0 + gz * COARSE_CELL;
        let es = 0;
        let ws = 0;
        for (const i of samples) {
          const dx = this.rx[i] - x;
          const dz = this.rz[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 16 * COARSE_SIGMA * COARSE_SIGMA) continue;
          const w = Math.exp(-d2 * cInv);
          es += w * this.ry[i];
          ws += w;
        }
        const eps = 0.05;
        this.coarse[gz * this.coarseW + gx] = (es + meanY * eps) / (ws + eps);
      }
    }

    // Medium-scale elevation: bridges the road corridor and the regional field so
    // valleys next to big climbs don't turn into cliffs.
    const mMargin = 3500;
    this.medX0 = minX - mMargin;
    this.medZ0 = minZ - mMargin;
    this.medW = Math.ceil((maxX - minX + 2 * mMargin) / MED_CELL) + 1;
    this.medH = Math.ceil((maxZ - minZ + 2 * mMargin) / MED_CELL) + 1;
    const esum = new Float32Array(this.medW * this.medH);
    const wsum = new Float32Array(this.medW * this.medH);
    const mInv = 1 / (2 * MED_SIGMA * MED_SIGMA);
    const mr = Math.ceil((MED_SIGMA * 3) / MED_CELL);
    for (let i = 0; i < this.n; i += 10) {
      const cx = Math.round((this.rx[i] - this.medX0) / MED_CELL);
      const cz = Math.round((this.rz[i] - this.medZ0) / MED_CELL);
      for (let dz = -mr; dz <= mr; dz++) {
        const gz = cz + dz;
        if (gz < 0 || gz >= this.medH) continue;
        const wz = this.medZ0 + gz * MED_CELL - this.rz[i];
        for (let dx = -mr; dx <= mr; dx++) {
          const gx = cx + dx;
          if (gx < 0 || gx >= this.medW) continue;
          const wx = this.medX0 + gx * MED_CELL - this.rx[i];
          const w = Math.exp(-(wx * wx + wz * wz) * mInv);
          esum[gz * this.medW + gx] += w * this.ry[i];
          wsum[gz * this.medW + gx] += w;
        }
      }
    }
    // Coarse distance-to-road out to a few km (fine tiles only reach STAMP_RADIUS).
    this.medDist = new Float32Array(this.medW * this.medH).fill(1e5);
    const dr = Math.ceil(mMargin / MED_CELL);
    for (let i = 0; i < this.n; i += 20) {
      const cx = Math.round((this.rx[i] - this.medX0) / MED_CELL);
      const cz = Math.round((this.rz[i] - this.medZ0) / MED_CELL);
      for (let dz = -dr; dz <= dr; dz++) {
        const gz = cz + dz;
        if (gz < 0 || gz >= this.medH) continue;
        const wz = this.medZ0 + gz * MED_CELL - this.rz[i];
        for (let dx = -dr; dx <= dr; dx++) {
          const gx = cx + dx;
          if (gx < 0 || gx >= this.medW) continue;
          const wx = this.medX0 + gx * MED_CELL - this.rx[i];
          const d = Math.sqrt(wx * wx + wz * wz);
          const k = gz * this.medW + gx;
          if (d < this.medDist[k]) this.medDist[k] = d;
        }
      }
    }

    this.med = new Float32Array(this.medW * this.medH);
    for (let gz = 0; gz < this.medH; gz++) {
      for (let gx = 0; gx < this.medW; gx++) {
        const k = gz * this.medW + gx;
        const c = this.coarseAt(this.medX0 + gx * MED_CELL, this.medZ0 + gz * MED_CELL);
        const eps = 0.02;
        this.med[k] = (esum[k] + c * eps) / (wsum[k] + eps);
      }
    }
    this.placeIsland();
  }

  /** Where the lake island sits, when this route has one. */
  islandCenter(): LakeIsland | null {
    return this.island;
  }

  /**
   * A compact island out in the water, toward the middle of the lake but close
   * enough to the start shore that the church is still in view. The loop centre
   * itself is more than two kilometres from the road, past the water the camera draws.
   */
  private placeIsland(): void {
    const sc = this.scenery;
    if (!sc.lakeshore || sc.waterLevel === null || this.n < 4) return;
    const i = Math.min(this.n - 2, Math.round(40 / ROUTE_DS));
    let tx = this.rx[i + 1] - this.rx[i];
    let tz = this.rz[i + 1] - this.rz[i];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const reach = 680;
    const x = this.rx[i] - tz * reach;
    const z = this.rz[i] + tx * reach;
    if (!this.insideLoop(x, z, true)) return;
    const yaw = Math.atan2(-(this.rz[i] - z), this.rx[i] - x);
    this.island = { x, z, yaw, along: 112, across: 78 };
  }

  private medSample(arr: Float32Array, x: number, z: number, fallback: number): number {
    const fx = (x - this.medX0) / MED_CELL;
    const fz = (z - this.medZ0) / MED_CELL;
    if (fx < 0 || fz < 0 || fx >= this.medW - 1 || fz >= this.medH - 1) return fallback;
    const gx = Math.floor(fx);
    const gz = Math.floor(fz);
    const tx = fx - gx;
    const tz = fz - gz;
    const W = this.medW;
    return lerp(lerp(arr[gz * W + gx], arr[gz * W + gx + 1], tx), lerp(arr[(gz + 1) * W + gx], arr[(gz + 1) * W + gx + 1], tx), tz);
  }

  private medAt(x: number, z: number): number {
    return this.medSample(this.med, x, z, this.coarseAt(x, z));
  }

  private medDistAt(x: number, z: number): number {
    return this.medSample(this.medDist, x, z, 1e5);
  }

  private tileFor(gx: number, gz: number, create: boolean): Tile | undefined {
    const tx = Math.floor(gx / TILE);
    const tz = Math.floor(gz / TILE);
    const k = key(tx, tz);
    let t = this.tiles.get(k);
    if (!t && create) {
      t = {
        dist: new Float32Array(TILE * TILE).fill(1e9),
        esum: new Float32Array(TILE * TILE),
        wsum: new Float32Array(TILE * TILE),
        near: new Int32Array(TILE * TILE).fill(-1),
      };
      this.tiles.set(k, t);
    }
    return t;
  }

  private cellValue(gx: number, gz: number, out: { d: number; e: number; w: number }) {
    const t = this.tileFor(gx, gz, false);
    if (!t) {
      out.d = 1e9;
      out.e = 0;
      out.w = 0;
      return;
    }
    const lx = gx - Math.floor(gx / TILE) * TILE;
    const lz = gz - Math.floor(gz / TILE) * TILE;
    const idx = lz * TILE + lx;
    out.d = t.dist[idx];
    out.e = t.esum[idx];
    out.w = t.wsum[idx];
  }

  private tmp = [
    { d: 0, e: 0, w: 0 },
    { d: 0, e: 0, w: 0 },
    { d: 0, e: 0, w: 0 },
    { d: 0, e: 0, w: 0 },
  ];

  /** A high mountain gets the shelf cut on most of its steep road, not just scattered stretches. */
  private largeMountain(): boolean {
    return this.scenery.mountainHeight >= 900;
  }

  /**
   * Another road sample off to one side, ignoring the road we're standing on.
   * Used so a hairpin stack rises toward the leg above it.
   */
  private roadOffToTheSide(i: number, x: number, z: number, minAlong: number): { i: number; d: number; rise: number } | null {
    const n = this.n;
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    let best = -1;
    let bestD = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = this.hash.get(key(cx + dx, cz + dz));
        if (!arr) continue;
        for (const j of arr) {
          let along = Math.abs(j - i);
          if (along > n / 2) along = n - along;
          if (along < minAlong) continue;
          const d = Math.hypot(this.rx[j] - x, this.rz[j] - z);
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        }
      }
    }
    if (best < 0) return null;
    return { i: best, d: bestD, rise: this.ry[best] - this.ry[i] };
  }

  /**
 * On steeper stretches, cut the road into a hillside: one side rises beside
 * the verge, the other falls away. Open stretches stay as they are.
 * On a large mountain the cut starts past the verge, so the slope does not
 * cross the asphalt, and the range behind it keeps climbing.
   */
  private buildCuts(): void {
    const n = this.n;
    const large = this.largeMountain();
    this.cut = new Float32Array(n);
    this.uphill = new Float32Array(n);
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ds = Math.hypot(this.rx[j] - this.rx[i], this.rz[j] - this.rz[i]) || 1;
      raw[i] = (this.ry[j] - this.ry[i]) / ds;
    }
    const half = 18;
    for (let i = 0; i < n; i++) {
      const j = (i + 4) % n;
      let tx = this.rx[j] - this.rx[i];
      let tz = this.rz[j] - this.rz[i];
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const ang = this.noise.noise(this.rx[i] / 1600, this.rz[i] / 1600) * Math.PI;
      const dot = -tz * Math.cos(ang) + tx * Math.sin(ang);
      let uphill: number = dot >= 0 ? 1 : -1;
      if (large) {
        let bestSide = 0;
        let bestRise = 2.5;
        for (const side of [-1, 1]) {
          const hit = this.roadOffToTheSide(i, this.rx[i] + -tz * side * 26, this.rz[i] + tx * side * 26, 18);
          if (hit && hit.d < 70 && hit.rise > bestRise) {
            bestRise = hit.rise;
            bestSide = side;
          }
        }
        if (bestSide !== 0) uphill = bestSide;
      }
      this.uphill[i] = uphill;
      let g = 0;
      for (let k = -half; k <= half; k++) g += raw[(i + k + n) % n];
      g /= half * 2 + 1;
      const steep = smoothstep(large ? 0.02 : 0.04, large ? 0.045 : 0.065, Math.abs(g));
      const vary = this.noise.fbm(this.rx[i] / 650, this.rz[i] / 650, 2);
      const presence = large ? smoothstep(-0.95, -0.25, vary) : smoothstep(-0.45, 0.2, vary);
      const cut = steep * presence;
      this.cut[i] = this.town && this.town[i] ? 0 : large ? Math.min(1, Math.max(cut, steep * 0.85)) : cut;
      if (this.dem) {
        // Real ground: the hillside rises on whichever side really is higher, and the
        // road is cut in where the slope across it is steep.
        const lx = -tz * 40;
        const lz = tx * 40;
        const left = this.demAt(this.rx[i] + lx, this.rz[i] + lz);
        const lw = left.w;
        const lh = left.h;
        const right = this.demAt(this.rx[i] - lx, this.rz[i] - lz);
        if (lw > 0.5 && right.w > 0.5) {
          this.uphill[i] = lh >= right.h ? 1 : -1;
          const across = Math.abs(lh - right.h) / 80;
          this.cut[i] = this.town && this.town[i] ? 0 : smoothstep(0.12, 0.4, across);
        }
      }
    }
    if (large && !this.dem) {
      const src = Float32Array.from(this.uphill);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -8; k <= 8; k++) s += src[(i + k + n) % n];
        if (Math.abs(s) >= 5) this.uphill[i] = s > 0 ? 1 : -1;
      }
    }
    for (let i = 0; i < n; i += 2) {
      if (this.cut[i] < 0.05) continue;
      const j = (i + 4) % n;
      let tx = this.rx[j] - this.rx[i];
      let tz = this.rz[j] - this.rz[i];
      const len = Math.hypot(tx, tz) || 1;
      const side = this.uphill[i];
      const reach = large ? 22 : 16;
      const px = this.rx[i] + (-tz / len) * side * reach;
      const pz = this.rz[i] + (tx / len) * side * reach;
      const hit = large ? this.roadOffToTheSide(i, px, pz, 16) : null;
      const near = large ? hit : this.nearestRoad(px, pz);
      if (!near) continue;
      let along = Math.abs(near.i - i);
      if (along > n / 2) along = n - along;
      if (!large) {
        if (along > 20 && near.d < 11) {
          for (let k = -4; k <= 4; k++) this.cut[(i + k + n) % n] = 0;
        }
        continue;
      }
      const rise = this.ry[near.i] - this.ry[i];
      if (along > 16 && near.d < 16 && rise < 3) {
        for (let k = -2; k <= 2; k++) this.cut[(i + k + n) % n] *= 0.35;
      }
    }
  }

  /** Inside the loop and off the asphalt, so trees and fences stay on the land side. */
  onLake(x: number, z: number): boolean {
    if (!this.scenery.lakeshore || !this.loopPoly) return false;
    return this.insideLoop(x, z, true);
  }

  /** Inside a mapped lake. The carriageway itself is not water. */
  overWater(x: number, z: number): boolean {
    if (!this.lakes.length) return false;
    let inside = false;
    for (const a of this.lakes) {
      if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
      if (ringHas(a, x, z)) {
        inside = true;
        break;
      }
    }
    return inside && this.roadDistance(x, z) >= ROAD_HALF_WIDTH + 2;
  }

  /** Inside a mapped parking lot, including where it meets the verge. */
  onLot(x: number, z: number): boolean {
    for (const a of this.lots) {
      if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
      if (ringHas(a, x, z)) return true;
    }
    return false;
  }

  /** Mapped water or a parking lot: no trees, grass or buildings. */
  blocksProp(x: number, z: number): boolean {
    return this.overWater(x, z) || this.onLot(x, z);
  }

  /** Lower the bed of a mapped lake. The road itself stays at the road. */
  private carveLake(x: number, z: number, h: number, d: number): number {
    if (!this.lakes.length || d < ROAD_HALF_WIDTH + 2) return h;
    for (const a of this.lakes) {
      if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
      if (!ringHas(a, x, z)) continue;
      const bed = a.level - 1.7;
      const t = smoothstep(0, 8, ringEdge(a, x, z));
      const target = h + (bed - h) * t;
      if (target < h) h = target;
    }
    return h;
  }

  /** A gravel lot follows the road beside it, so the hillside does not rise through it. */
  private paveLot(x: number, z: number, h: number, d: number, roadElev: number): number {
    if (!this.lots.length || d < ROAD_HALF_WIDTH + 2) return h;
    for (const a of this.lots) {
      if (x < a.minX - 4 || x > a.maxX + 4 || z < a.minZ - 4 || z > a.maxZ + 4) continue;
      const inside = ringHas(a, x, z);
      const edge = inside ? 0 : ringEdge(a, x, z);
      if (!inside && edge > 3.5) continue;
      const t = inside ? 1 : 1 - smoothstep(0, 3.5, edge);
      h += (roadElev - h) * t;
    }
    return h;
  }

  /** True when the point is inside the road loop. The lake route uses this for the shore. */
  private insideLoop(x: number, z: number, nearRoad: boolean): boolean {
    if (!this.loopPoly) return false;
    if (nearRoad) return this.rayInside(x, z);
    const ix = Math.floor(x / 24);
    const iz = Math.floor(z / 24);
    const k = (ix + 80000) * 200000 + (iz + 80000);
    const cached = this.insideCache.get(k);
    if (cached !== undefined) return cached;
    const inside = this.rayInside((ix + 0.5) * 24, (iz + 0.5) * 24);
    this.insideCache.set(k, inside);
    return inside;
  }

  private rayInside(px: number, pz: number): boolean {
    const poly = this.loopPoly;
    if (!poly) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const zi = poly[i].z;
      const zj = poly[j].z;
      if (zi > pz !== zj > pz) {
        const xi = poly[i].x;
        const xj = poly[j].x;
        if (px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  /** Signed metres to the right of travel at road sample i. */
  private lateral(i: number, x: number, z: number): number {
    const j = (i + 4) % this.n;
    let tx = this.rx[j] - this.rx[i];
    let tz = this.rz[j] - this.rz[i];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    return (x - this.rx[i]) * -tz + (z - this.rz[i]) * tx;
  }

  /** Road sample stamped into the fine tile, or -1 outside the corridor. */
  private stampedNear(x: number, z: number): number {
    const fx = x / CELL - 0.5;
    const fz = z / CELL - 0.5;
    const gx = Math.floor(fx);
    const gz = Math.floor(fz);
    let bestD = 1e8;
    let best = -1;
    for (let dz = 0; dz <= 1; dz++) {
      for (let dx = 0; dx <= 1; dx++) {
        const cellX = gx + dx;
        const cellZ = gz + dz;
        const t = this.tileFor(cellX, cellZ, false);
        if (!t) continue;
        const lx = cellX - Math.floor(cellX / TILE) * TILE;
        const lz = cellZ - Math.floor(cellZ / TILE) * TILE;
        const cell = lz * TILE + lx;
        if (t.near[cell] >= 0 && t.dist[cell] < bestD) {
          bestD = t.dist[cell];
          best = t.near[cell];
        }
      }
    }
    return best;
  }

  /** Bilinear lookup of approximate road distance and smoothed road elevation. */
  private fine(x: number, z: number): { d: number; elev: number; w: number } {
    const fx = x / CELL - 0.5;
    const fz = z / CELL - 0.5;
    const gx = Math.floor(fx);
    const gz = Math.floor(fz);
    const tx = fx - gx;
    const tz = fz - gz;
    const [a, b, c, d] = this.tmp;
    this.cellValue(gx, gz, a);
    this.cellValue(gx + 1, gz, b);
    this.cellValue(gx, gz + 1, c);
    this.cellValue(gx + 1, gz + 1, d);
    const missing = a.d >= 1e8 || b.d >= 1e8 || c.d >= 1e8 || d.d >= 1e8;
    const dist = missing ? 1e9 : lerp(lerp(a.d, b.d, tx), lerp(c.d, d.d, tx), tz);
    const e = lerp(lerp(a.e, b.e, tx), lerp(c.e, d.e, tx), tz);
    const w = lerp(lerp(a.w, b.w, tx), lerp(c.w, d.w, tx), tz);
    return { d: dist, elev: w > 1e-9 ? e / w : 0, w };
  }

  coarseAt(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.coarseW - 1.001, (x - this.coarseX0) / COARSE_CELL));
    const fz = Math.max(0, Math.min(this.coarseH - 1.001, (z - this.coarseZ0) / COARSE_CELL));
    const gx = Math.floor(fx);
    const gz = Math.floor(fz);
    const tx = fx - gx;
    const tz = fz - gz;
    const W = this.coarseW;
    const c = this.coarse;
    return lerp(lerp(c[gz * W + gx], c[gz * W + gx + 1], tx), lerp(c[(gz + 1) * W + gx], c[(gz + 1) * W + gx + 1], tx), tz);
  }

  /** Exact distance to the road centreline and the road elevation there (within ~32 m). */
  nearestRoad(x: number, z: number): NearestRoad | null {
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    let best = -1;
    let bestD2 = Infinity;
    // Two cells, not one. From the edge of a cell a road 35 m away sits in the
    // cell beyond the neighbour, and missing it makes the nearest road jump
    // to the terrace on the other side.
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const arr = this.hash.get(key(cx + dx, cz + dz));
        if (!arr) continue;
        for (const i of arr) {
          const ddx = this.rx[i] - x;
          const ddz = this.rz[i] - z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = i;
          }
        }
      }
    }
    if (best < 0) return null;
    let resD = Math.sqrt(bestD2);
    let resE = this.ry[best];
    for (const o of [-1, 1]) {
      const j = (best + o + this.n) % this.n;
      const ax = this.rx[best];
      const az = this.rz[best];
      const bx = this.rx[j];
      const bz = this.rz[j];
      const vx = bx - ax;
      const vz = bz - az;
      const len2 = vx * vx + vz * vz;
      if (len2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
      const px = ax + vx * t;
      const pz = az + vz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < resD) {
        resD = d;
        resE = this.ry[best] + (this.ry[j] - this.ry[best]) * t;
      }
    }
    return { d: resD, elev: resE, i: best };
  }

  /** Replace the paved shelves. Pass the same array on FieldInput for the workers. */
  setPads(data: Float32Array): void {
    this.pads = data;
  }

  padData(): Float32Array {
    return this.pads ?? new Float32Array(0);
  }

  setClearings(data: Float32Array): void {
    this.clearData = data;
    this.clearHash.clear();
    for (let i = 0; i < data.length; i += 3) {
      const x = data[i];
      const z = data[i + 1];
      const r = data[i + 2];
      for (let ix = Math.floor((x - r) / CLEAR_CELL); ix <= Math.floor((x + r) / CLEAR_CELL); ix++) {
        for (let iz = Math.floor((z - r) / CLEAR_CELL); iz <= Math.floor((z + r) / CLEAR_CELL); iz++) {
          const k = key(ix, iz);
          let list = this.clearHash.get(k);
          if (!list) this.clearHash.set(k, (list = []));
          list.push(i);
        }
      }
    }
  }

  /** True on a road sample whose verge is kept open, including the way back down it. */
  isOpenRoad(index: number): boolean {
    return (this.openRadius?.[index] ?? 0) > 0;
  }

  /**
   * What grows here. A mapped wood stands. A point whose nearest road sample is
   * an open stretch, and which sits inside that stretch's radius, is grazed.
   * Everywhere else keeps the generated forest.
   */
  groundCover(x: number, z: number, y: number): 'wood' | 'pasture' | 'forest' {
    if (insideAny(this.woods, x, z)) return 'wood';
    const near = this.openRadius ? this.nearestRoad(x, z) : null;
    if (near && near.d <= (this.openRadius?.[near.i] ?? 0)) return 'pasture';
    const line = this.scenery.pastureAbove;
    if (line != null && y >= line) return 'pasture';
    return 'forest';
  }

  /** Mark the open stretches, and the samples that come back down the same road. */
  private markOpenRoad(): void {
    const spans = this.scenery.openAlong;
    if (!spans?.length) return;
    const radius = new Float32Array(this.n);
    for (const span of spans) {
      const a = Math.max(0, Math.floor(span.fromM / ROUTE_DS));
      const b = Math.min(this.n - 1, Math.ceil(span.toM / ROUTE_DS));
      for (let i = a; i <= b; i++) radius[i] = Math.max(radius[i], span.radius);
    }
    const marked: number[] = [];
    for (let i = 0; i < this.n; i += 2) if (radius[i] > 0) marked.push(i);
    for (let i = 0; i < this.n; i++) {
      if (radius[i] > 0) continue;
      for (const j of marked) {
        const dx = this.rx[i] - this.rx[j];
        const dz = this.rz[i] - this.rz[j];
        if (dx * dx + dz * dz < 25 * 25) {
          radius[i] = radius[j];
          break;
        }
      }
    }
    this.openRadius = radius;
  }

  /** True inside a clearing, where no trees grow. */
  cleared(x: number, z: number): boolean {
    const data = this.clearData;
    if (!data) return false;
    const list = this.clearHash.get(key(Math.floor(x / CLEAR_CELL), Math.floor(z / CLEAR_CELL)));
    if (!list) return false;
    for (const i of list) {
      const dx = x - data[i];
      const dz = z - data[i + 1];
      if (dx * dx + dz * dz < data[i + 2] * data[i + 2]) return true;
    }
    return false;
  }

  /** True when this road sample is inside a town street. */
  isTown(index: number): boolean {
    return this.town !== null && this.town[index] === 1;
  }

  /** Approximate distance to the nearest road (cheap). */
  roadDistance(x: number, z: number): number {
    const f = this.fine(x, z);
    if (f.d < 30) {
      const n = this.nearestRoad(x, z);
      if (n) return n.d;
    }
    return this.blendDistance(f.d, x, z);
  }

  /** Fine distance near the road, coarse distance field further out. */
  private blendDistance(fineD: number, x: number, z: number): number {
    const edge = STAMP_RADIUS - 20;
    return fineD < edge ? fineD : Math.max(edge, this.medDistAt(x, z));
  }

  /**
   * Real ground height at a point, and how much of it to use (1 inside the grids,
   * fading to 0 at their outer edge). The fine grid fades into the coarse one.
   */
  demAt(x: number, z: number): { h: number; w: number } {
    const out = this.demOut;
    out.h = 0;
    out.w = 0;
    const grids = this.dem;
    if (!grids) return out;
    let h = 0;
    let w = 0;
    for (let k = grids.length - 1; k >= 0; k--) {
      const g = grids[k];
      const fx = (x - g.x0) / g.cell;
      const fz = (z - g.z0) / g.cell;
      if (fx < 0 || fz < 0 || fx >= g.w - 1 || fz >= g.h - 1) continue;
      const edge = Math.min(fx, fz, g.w - 1 - fx, g.h - 1 - fz) * g.cell;
      const t = smoothstep(0, k === grids.length - 1 ? 3000 : 800, edge);
      const gx = Math.floor(fx);
      const gz = Math.floor(fz);
      const tx = fx - gx;
      const tz = fz - gz;
      const d = g.data;
      const W = g.w;
      const v = lerp(lerp(d[gz * W + gx], d[gz * W + gx + 1], tx), lerp(d[(gz + 1) * W + gx], d[(gz + 1) * W + gx + 1], tx), tz) * (g.scale ?? 1);
      if (w === 0) {
        h = v;
        w = t;
      } else {
        h = lerp(h, v, t);
        w = Math.max(w, t);
      }
    }
    out.h = h;
    out.w = w;
    return out;
  }

  /** True when this road has real ground heights. */
  get hasDem(): boolean {
    return this.dem !== null;
  }

  /** True when this road has a land-cover map. */
  get hasCover(): boolean {
    return this.cover !== null;
  }

  /**
   * Steepness of the real ground, as the up component of its normal (1 flat,
   * 0.7 about 45°), and how much real ground there is here (0..1, as demAt).
   * Taken from the DEM 12.5 m either side of the point, so it is the same
   * whatever the mesh cell is (8 m beside the rider, 64 m on the far tiles),
   * and the invented facets and bumps on top of the DEM never flip it.
   * Road banks are not in the DEM either: a bank takes the colour of the slope
   * it was cut into. Returns w = 0 without a DEM.
   */
  demNormalY(x: number, z: number): { ny: number; w: number } {
    const out = this.demNyOut;
    out.ny = 1;
    out.w = 0;
    if (!this.dem) return out;
    const s = 12.5;
    const c = this.demAt(x, z);
    const w = c.w;
    if (w <= 0) return out;
    const e = this.demAt(x + s, z).h;
    const wv = this.demAt(x - s, z).h;
    const so = this.demAt(x, z + s).h;
    const no = this.demAt(x, z - s).h;
    const gx = (e - wv) / (2 * s);
    const gz = (so - no) / (2 * s);
    out.ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
    out.w = w;
    return out;
  }
  private readonly demNyOut = { ny: 1, w: 0 };

  /**
   * Land-cover class at a point (LandCover), or 0. The fine grid wins, then the
   * far one; inside a grid the nearest node counts (node (i, j) sits exactly at
   * x0 + i·cell, z0 + j·cell, like the heights). A node with no data (0) falls
   * through to the coarser grid.
   */
  coverAt(x: number, z: number): number {
    const grids = this.cover;
    if (!grids) return 0;
    for (const g of grids) {
      const i = Math.round((x - g.x0) / g.cell);
      const j = Math.round((z - g.z0) / g.cell);
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
      const v = g.data[j * g.w + i];
      if (v !== 0) return v;
    }
    return 0;
  }

  /**
   * How much of each class is around a point: bilinear weights of the four
   * surrounding nodes, summed per class into `out` (length 10). Nodes with no
   * data are left out and the rest rescaled. Returns the weight that was found
   * (0 when nothing is known here). Used for colour, so a class edge is a short
   * blend instead of a staircase of 25 m squares.
   */
  coverMix(x: number, z: number, out: Float32Array): number {
    out.fill(0);
    const grids = this.cover;
    if (!grids) return 0;
    for (const g of grids) {
      const fx = (x - g.x0) / g.cell;
      const fz = (z - g.z0) / g.cell;
      if (fx < 0 || fz < 0 || fx > g.w - 1 || fz > g.h - 1) continue;
      const gx = Math.min(g.w - 2, Math.floor(fx));
      const gz = Math.min(g.h - 2, Math.floor(fz));
      const tx = fx - gx;
      const tz = fz - gz;
      const d = g.data;
      const W = g.w;
      const a = d[gz * W + gx];
      const b = d[gz * W + gx + 1];
      const c = d[(gz + 1) * W + gx];
      const e = d[(gz + 1) * W + gx + 1];
      let sum = 0;
      const add = (v: number, wt: number) => {
        if (v === 0 || v > 9 || wt <= 0) return;
        out[v] += wt;
        sum += wt;
      };
      add(a, (1 - tx) * (1 - tz));
      add(b, tx * (1 - tz));
      add(c, (1 - tx) * tz);
      add(e, tx * tz);
      if (sum <= 1e-6) continue;
      for (let k = 1; k < 10; k++) out[k] /= sum;
      return 1;
    }
    return 0;
  }

  heightAt(x: number, z: number): number {
    const sc = this.scenery;
    const f = this.fine(x, z);
    let d = this.blendDistance(f.d, x, z);
    let roadElev = f.elev;
    let roadI = -1;
    if (d < 110) {
      const n = this.nearestRoad(x, z);
      if (n && n.d < 100) {
        d = n.d;
        roadElev = n.elev;
        roadI = n.i;
      }
    }
    if (roadI < 0 && d < 180) roadI = this.stampedNear(x, z);
    const coarse = this.coarseAt(x, z);
    const med = this.medAt(x, z);
    const local = f.w > 1e-6 ? f.elev : med;
    const base = lerp(lerp(local, med, smoothstep(70, 270, d)), coarse, smoothstep(600, 2800, d));

    const noise = this.noise;
    const ridge = noise.ridged(x / 3600, z / 3600, 5);
    // Large mountains start climbing again just past the verge, so a roadside
    // bank runs on into the range instead of sitting on a flat shelf.
    const large = this.largeMountain();
    const rise = smoothstep(large ? 55 : 30, large ? 1400 : 2600, d);
    const mtn = sc.mountainHeight * rise * Math.sqrt(rise) * (ridge * 1.35 - 0.1);
    const hills = noise.fbm(x / 420, z / 420, 3) * (16 + sc.mountainHeight * 0.03) * smoothstep(8, 160, d);
    const bumps = noise.noise(x / 60, z / 60) * 2.2 * smoothstep(10, 40, d);
    let natural = base + mtn + hills + bumps;
    if (this.dem) {
      // Real ground. Near the road it gives way to the road's own elevation so the
      // asphalt sits on a bench; low-poly facets come from a little noise.
      const real = this.demAt(x, z);
      if (real.w > 0) {
        const ground = lerp(local, real.h, smoothstep(40, 220, d));
        const facets = noise.fbm(x / 160, z / 160, 2) * 4 * smoothstep(20, 140, d);
        natural = lerp(natural, ground + facets + bumps, real.w);
      }
    }

    if (sc.waterLevel !== null && !sc.lakeshore) {
      const sea = smoothstep(-0.05, 0.35, noise.fbm(x / 6500 + 17.3, z / 6500 - 4.1, 2));
      natural -= (Math.max(60, base - sc.waterLevel + 40) * sea) * smoothstep(120, 700, d);
    }

    let shaped = natural;
    const cut = roadI >= 0 ? this.roadCut(x, z) : 0;
    // The near terrain grid is 8 m. The bank has to start far enough out that a
    // triangle covering the asphalt stays flat, or the slope cuts through the road.
    // A hairpin's other leg is closer than that. pairBank joins the two legs with
    // the same kind of slope used here, and meshStep only refines those cells.
    const clear = ROAD_HALF_WIDTH + 14;
    if (cut > 0.05 && roadI >= 0) {
      const rising = this.lateral(roadI, x, z) * this.uphill[roadI] >= 0 ? 1 : -1;
      const along = Math.max(0, d - clear);
      if (large) {
        // Above the gravel line the bank is the same loose stone as the hillside:
        // a gentler rise that keeps going, and a little more fall on the downhill side.
        const gravel = sc.screeLine != null && roadElev > sc.screeLine;
        if (rising > 0) {
          const toe = Math.min(along, gravel ? 18 : 10) * (gravel ? 0.55 : 0.9);
          const fade = (1 - smoothstep(gravel ? 46 : 32, gravel ? 120 : 78, d)) * cut;
          shaped = natural + toe * fade;
        } else {
          const drop = Math.min(along, gravel ? 14 : 12) * (gravel ? 0.28 : 0.16);
          const fade = (1 - smoothstep(gravel ? 40 : 34, gravel ? 96 : 80, d)) * cut;
          shaped = natural - drop * fade;
        }
      } else if (rising > 0) {
        const target = roadElev - 0.3 + Math.min(along * (0.62 + 0.28 * cut), 9 + 16 * cut);
        const keep = (1 - smoothstep(clear + 40, clear + 150, d)) * cut;
        shaped = lerp(natural, Math.max(natural, target), keep);
      } else {
        const target = roadElev - 0.3 - Math.min(along * (0.38 + 0.24 * cut), 5 + 12 * cut);
        const keep = (1 - smoothstep(clear + 12, clear + 80, d)) * cut;
        shaped = lerp(natural, Math.min(natural, target), keep);
      }
    }

    const shoulder = cut > 0.05 ? clear + 4 : ROAD_HALF_WIDTH + 24;
    const blendStart = cut > 0.05 ? clear : ROAD_HALF_WIDTH + 1.2;
    const w = smoothstep(blendStart, shoulder, d);
    let h = lerp(roadElev - 0.3, shaped, w);
    // A grid vertex on the asphalt stays at the road, even when the bank beside it is steep.
    if (roadI >= 0 && d < ROAD_HALF_WIDTH + 1.6) h = roadElev - 0.3;
    // The blend above is only a few metres wide, and beside a hairpin `shaped` is
    // already the next terrace. Dumping that offset across the blend is a wall at
    // the verge. Climb away from the flat shelf at the cut pitch, and let the
    // hillside take over further out, where the run is long enough.
    let verge = ROAD_HALF_WIDTH + 2.4;
    let pitched = h;
    if (roadI >= 0 && d < 160) {
      verge = lerp(ROAD_HALF_WIDTH + 2.4, clear, smoothstep(0, 0.35, cut));
      const own = roadElev - 0.3 + Math.max(0, d - verge) * 0.9;
      // A lower road's cone is only an upper bound past this road's own verge.
      // Inside the verge it punches a hole through the shoulder: the rail's
      // triangle then sits in the air.
      let cap = own;
      if (d > verge) cap = Math.min(own, this.coneCap(x, z, verge));
      const floor = roadElev - 0.3 - Math.max(0, d - verge) * 0.9;
      if (pitched > cap) pitched = lerp(cap, pitched, smoothstep(70, 150, d));
      // The downhill side had the same fault: the valley is already low at the
      // verge, and blending it in over 4 m is a wall you fall off. Drop at 0.9.
      if (pitched < floor) pitched = lerp(floor, pitched, smoothstep(70, 150, d));
    }
    // Between the two legs the bank owns the ground. Mixing it with the shelf
    // lets the nearest road flip to the terrace above, which is a step, and on
    // the grid that step is a triangular fin. A town turns the rock cut off,
    // but the two carriageways are still there.
    if (roadI >= 0 && d < 80) {
      const bank = this.pairBank(x, z, d, roadI, roadElev);
      if (bank && d >= ROAD_HALF_WIDTH + 1.6) h = lerp(pitched, bank.h, bank.w);
      else h = pitched;
    } else {
      h = pitched;
    }
    // The bank can still step when the nearest carriageway flips and a different
    // pair of feet is chosen. Every nearby road owns a 0.9 wedge. The ground
    // stays inside the overlap, which is continuous. A stack closer than that
    // pitch has no overlap; the bank is allowed to be steeper there.
    if (roadI >= 0 && d > clear && d < 150) {
      const hi = this.coneCap(x, z, clear);
      const lo = this.coneFloor(x, z, clear);
      if (lo <= hi + 1) {
        const t = smoothstep(70, 150, d);
        if (h > hi) h = lerp(hi, h, t);
        else if (h < lo) h = lerp(lo, h, t);
      }
    }
    // The nearest carriageway can be the one above this lane. Hold the ground
    // down to every carriageway the point actually sits on, or that lane is buried.
    if (roadI >= 0 && d < ROAD_HALF_WIDTH + 0.85) h = Math.min(h, this.carriagewayCap(x, z, roadI, roadElev));
    if (sc.lakeshore && sc.waterLevel !== null && d > clear) {
      const water = sc.waterLevel;
      if (this.insideLoop(x, z, d < clear + 48)) {
        const bed = water - 1.4;
        const t = smoothstep(clear, clear + 8, d);
        h = lerp(roadElev - 0.3, bed, t);
      } else if (h < water + 2.5) {
        h = water + 2.5;
      }
    }
    // A low beach by the start arch, so a pier there can sit just above the boats.
    if (sc.lakeshore && sc.waterLevel !== null && roadI >= 0 && d > ROAD_HALF_WIDTH + 10) {
      const len = this.n * ROUTE_DS;
      const along = roadI * ROUTE_DS;
      const fromStart = Math.min(along, len - along);
      const cove = 1 - smoothstep(80, 170, fromStart);
      if (cove > 0 && this.insideLoop(x, z, true)) {
        const water = sc.waterLevel;
        const edge = ROAD_HALF_WIDTH + 10;
        const beach = ROAD_HALF_WIDTH + 18;
        const shelf = water + 0.7;
        const t = smoothstep(edge, beach, d);
        let shoreH = lerp(roadElev - 0.3, shelf, t);
        const bed = water - 1.4;
        shoreH = lerp(shoreH, bed, smoothstep(beach, beach + 12, d));
        h = lerp(h, shoreH, cove);
      }
    }
    h = this.carveLake(x, z, h, d);
    h = this.applyPads(x, z, this.raiseIsland(x, z, h, d));
    h = this.paveLot(x, z, h, d, roadElev);
    return h;
  }

  /** Keep a paved shelf under its asphalt. Only lowers ground that rises through it. */
  private applyPads(x: number, z: number, h: number): number {
    const pads = this.pads;
    if (!pads) return h;
    for (let i = 0; i + 12 <= pads.length; i += 12) {
      const dx = x - pads[i + 4];
      const dz = z - pads[i + 5];
      const a = dx * pads[i] + dz * pads[i + 1];
      const b = dx * pads[i + 2] + dz * pads[i + 3];
      const outside = Math.hypot(Math.max(0, pads[i + 6] - a, a - pads[i + 7]), Math.max(0, pads[i + 8] - b, b - pads[i + 9]));
      const blend = pads[i + 11];
      if (outside >= blend) continue;
      const cap = pads[i + 10];
      const limit = cap + (h - cap) * (outside / blend);
      if (limit < h) h = limit;
    }
    return h;
  }

  /** Steep little island with a flat lawn on top, so a church can sit above the water. */
  private raiseIsland(x: number, z: number, h: number, d: number): number {
    const island = this.island;
    const water = this.scenery.waterLevel;
    if (!island || water === null || d < 80) return h;
    const dx = x - island.x;
    const dz = z - island.z;
    if (dx * dx + dz * dz > 160 * 160) return h;
    const fx = Math.cos(island.yaw);
    const fz = -Math.sin(island.yaw);
    const toward = dx * fx + dz * fz;
    const beside = dx * fz - dz * fx;
    const across = island.across * (toward > 0 ? 0.9 : 1.14);
    const e = Math.hypot(toward / across, beside / island.along);
    if (e > 1.1) return h;
    const bank = 1 - smoothstep(0.68, 0.98, e);
    const top = lerp(water - 0.2, water + 6.6, bank);
    const mask = 1 - smoothstep(0.96, 1.08, e);
    return lerp(h, top, mask);
  }

  /** otherLeg cache: road sample, then the 1 m cell the query sits in. -1 means none. */
  private readonly legCache = new Map<number, number>();
  private readonly bankCache = new Map<number, number>();
  /** Lowest 0.9 cone of the carriageways near a 1 m cell. */
  private readonly coneCache = new Map<number, number>();
  private readonly coneFloorCache = new Map<number, number>();
  private readonly cutCache = new Map<number, number>();

  /**
   * Rock-cut strength near this point, blended across every carriageway in
   * range. Snapping to the nearest sample's cut flips the bank by several
   * metres where two hairpin legs meet and one of them is cut harder.
   */
  private roadCut(x: number, z: number): number {
    const ck = (Math.round(x * 0.5) + 100000) * 400000 + (Math.round(z * 0.5) + 100000);
    const hit = this.cutCache.get(ck);
    if (hit !== undefined) return hit;
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    let csum = 0;
    let wsum = 0;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const arr = this.hash.get(key(cx + dx, cz + dz));
        if (!arr) continue;
        for (const i of arr) {
          const ddx = this.rx[i] - x;
          const ddz = this.rz[i] - z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 > 45 * 45) continue;
          const w = 1 / (16 + d2);
          csum += this.cut[i] * w;
          wsum += w;
        }
      }
    }
    const cut = wsum > 0 ? csum / wsum : 0;
    this.cutCache.set(ck, cut);
    return cut;
  }

  /**
   * Closest sample on another leg of the road. Far enough along not to be this
   * bend, and far enough in height not to be the return carriageway a metre away.
   * -1 when there isn't one within the search.
   */
  private otherLeg(i: number, x: number, z: number): number {
    const q = (Math.round(x) + 20000) * 100000 + (Math.round(z) + 20000);
    const k = i * 1e10 + q;
    const cached = this.legCache.get(k);
    if (cached !== undefined) return cached;
    const n = this.n;
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    const here = this.foot(i, x, z);
    let best = -1;
    // The closest other sample is often a wiggle of this same bend. The leg
    // that matters is the one this point actually sits between.
    let bestScore = Infinity;
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const arr = this.hash.get(key(cx + dx, cz + dz));
        if (!arr) continue;
        for (const j of arr) {
          let along = Math.abs(j - i);
          if (along > n / 2) along = n - along;
          const dy = Math.abs(this.ry[j] - this.ry[i]);
          // A few samples along this carriageway are this same bend. The next
          // terrace of a tight hairpin can be that close in index too, so only
          // skip the ones that have not actually climbed.
          if (along < 16 && dy < 8) continue;
          if (dy < 2.5) continue;
          const there = this.foot(j, x, z);
          if (there.d > 80) continue;
          const sep = Math.hypot(here.x - there.x, here.z - there.z);
          if (sep < 6.5 || sep > 100) continue;
          const slack = here.d + there.d - sep;
          if (slack > 20) continue;
          const score = slack * 3 + sep;
          if (score < bestScore) {
            bestScore = score;
            best = j;
          }
        }
      }
    }
    this.legCache.set(k, best);
    return best;
  }

  /**
   * The ground beside a road may not sit above a 0.9 slope from any carriageway
   * nearby. Using only the nearest road releases that slope as a wall when a
   * higher bend becomes the nearest one.
   */
  private coneCap(x: number, z: number, verge: number): number {
    const slot = verge > 10 ? 1 : 0;
    const ck = ((Math.round(x) + 100000) * 400000 + (Math.round(z) + 100000)) * 2 + slot;
    const hit = this.coneCache.get(ck);
    if (hit !== undefined) return hit;
    const reach = 85;
    const reach2 = reach * reach;
    let cap = Infinity;
    let floor = -Infinity;
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const arr = this.hash.get(key(cx + dx, cz + dz));
        if (!arr) continue;
        for (const i of arr) {
          const ddx = this.rx[i] - x;
          const ddz = this.rz[i] - z;
          if (ddx * ddx + ddz * ddz > reach2) continue;
          const f = this.foot(i, x, z);
          if (f.d > reach) continue;
          const rise = Math.max(0, f.d - verge) * 0.9;
          const extra = Math.max(0, f.d - 60) * 2;
          const base = f.elev - 0.3;
          const c = base + rise + extra;
          const fl = base - rise - extra;
          if (c < cap) cap = c;
          if (fl > floor) floor = fl;
        }
      }
    }
    if (!Number.isFinite(cap)) cap = 1e9;
    if (!Number.isFinite(floor)) floor = -1e9;
    this.coneCache.set(ck, cap);
    this.coneFloorCache.set(ck, floor);
    return cap;
  }

  /** Highest 0.9 floor of the carriageways near this point. Filled with coneCap. */
  private coneFloor(x: number, z: number, verge: number): number {
    const slot = verge > 10 ? 1 : 0;
    const ck = ((Math.round(x) + 100000) * 400000 + (Math.round(z) + 100000)) * 2 + slot;
    this.coneCap(x, z, verge);
    return this.coneFloorCache.get(ck) ?? -1e9;
  }

  /** Closest point on the road segment through sample i. */
  private foot(i: number, x: number, z: number): { x: number; z: number; d: number; elev: number } {
    let px = this.rx[i];
    let pz = this.rz[i];
    let elev = this.ry[i];
    let best = Math.hypot(x - px, z - pz);
    const n = this.n;
    for (const o of [-1, 1]) {
      const j = (i + o + n) % n;
      const vx = this.rx[j] - this.rx[i];
      const vz = this.rz[j] - this.rz[i];
      const len2 = vx * vx + vz * vz;
      if (len2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - this.rx[i]) * vx + (z - this.rz[i]) * vz) / len2));
      const qx = this.rx[i] + vx * t;
      const qz = this.rz[i] + vz * t;
      const dist = Math.hypot(x - qx, z - qz);
      if (dist < best) {
        best = dist;
        px = qx;
        pz = qz;
        elev = this.ry[i] + (this.ry[j] - this.ry[i]) * t;
      }
    }
    return { x: px, z: pz, d: best, elev };
  }

  /**
   * The two carriageways of a hairpin, when the point sits in the ground between
   * them. `shelf` is how far the flat verge reaches before the bank starts.
   */
  private legPair(x: number, z: number, roadI: number): {
    sep: number;
    rise: number;
    shelf: number;
    slack: number;
    dLow: number;
    lowElev: number;
    highElev: number;
  } | null {
    // A town sets the rock cut to zero. The two carriageways are still a pair,
    // and without this the grass cell stays 8 m and crosses the street.
    if (roadI < 0) return null;
    const j = this.otherLeg(roadI, x, z);
    if (j < 0) return null;
    const a = this.foot(roadI, x, z);
    const b = this.foot(j, x, z);
    const sep = Math.hypot(a.x - b.x, a.z - b.z);
    // Stelvio's stacked bends come back about 7 m apart. Closer than that and the
    // two carriageways are the same road. Wider than about 70 m is a different
    // hillside, and pairBank fades the slope out before that. The open bends
    // above Valloire come back about 50 m apart.
    if (sep < 6.5 || sep > 100) return null;
    const rise = Math.abs(a.elev - b.elev);
    // A low terrace still lifts an 8 m triangle across the lane. 2.5 m is enough.
    if (rise < 2.5) return null;
    const slack = a.d + b.d - sep;
    // A wide bend sits off the straight line between its feet, so the gap
    // between the two distances is a few metres even in the middle of the bank.
    if (slack > (sep >= 30 ? 20 : 14)) return null;
    const lowA = a.elev <= b.elev;
    // Same pitch as the rock cut on a straight: 0.9 rise per metre. The verge
    // keeps whatever is left, but never so little that the bank covers the rail.
    const wantRun = rise / 0.9;
    const minShelf = sep >= 24 ? ROAD_HALF_WIDTH + 2.6 : ROAD_HALF_WIDTH + 1.6;
    const shelf = Math.max(minShelf, Math.min(ROAD_HALF_WIDTH + 14, (sep - wantRun) * 0.5));
    return {
      sep,
      rise,
      shelf,
      slack,
      dLow: lowA ? a.d : b.d,
      lowElev: (lowA ? a.elev : b.elev) - 0.3,
      highElev: (lowA ? b.elev : a.elev) - 0.3,
    };
  }

  /** Coarsest grid that still keeps every asphalt triangle on the flat shelf. */
  private bankMesh(sep: number): number {
    // Gap between the two asphalts. A triangle reaches about its diagonal past
    // the lane, so a 1 m cell still crosses the lane when the next one is close.
    // Any coarser cell can still bridge the lane: one corner sits on the next
    // terrace, or down the hillside, and the diagonal crosses the asphalt.
    const gap = sep * 0.5 - ROAD_HALF_WIDTH;
    if (gap < 0.8) return 0.25;
    if (gap < 1.6) return 0.5;
    return 1;
  }

  /**
   * Lowest carriageway this point sits on, as a ground height. The nearest
   * centreline can be the terrace above, which would lift the grass through
   * the lane underneath.
   */
  private carriagewayCap(x: number, z: number, roadI: number, roadElev: number): number {
    const limit = ROAD_HALF_WIDTH + 0.85;
    let cap = roadElev;
    const reach2 = (limit + 4) * (limit + 4);
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = this.hash.get(key(cx + dx, cz + dz));
        if (!arr) continue;
        for (const i of arr) {
          let along = Math.abs(i - roadI);
          if (along > this.n / 2) along = this.n - along;
          if (along < 12) continue;
          const ddx = this.rx[i] - x;
          const ddz = this.rz[i] - z;
          if (ddx * ddx + ddz * ddz > reach2) continue;
          const f = this.foot(i, x, z);
          if (f.d <= limit && f.elev < cap) cap = f.elev;
        }
      }
    }
    return cap - 0.3;
  }

  /**
   * Height of the bank between two hairpin legs, and how strongly it replaces
   * the ordinary shelf. Null when this point is not between two legs.
   * The slope runs from the lower verge up to the upper verge. Where the gap
   * is wide it rises at 0.9, like the other cuts; where the legs are close it
   * uses the whole gap so there is no vertical step left over. The crest is a
   * fixed distance from the lower road, so it follows the bend.
   */
  private pairBank(x: number, z: number, d: number, roadI: number, roadElev: number): { h: number; w: number } | null {
    if (d > 70) return null;
    const pair = this.legPair(x, z, roadI);
    if (!pair) return null;
    // A few metres of slack is the bend sitting off the straight line between
    // its feet. Fading there lets the nearest-road shelf show through, and that
    // shelf flips to the terrace above: a step beside the lane. Hold the slope
    // until the point is clearly beside the pair, not between the legs.
    // The same fade applies as the legs get further apart than a normal stack.
    // Cutting the pair off at a fixed distance drops the ground onto the verge wall.
    const slack0 = pair.sep >= 30 ? 8 : 4;
    const slack1 = pair.sep >= 30 ? 18 : 12;
    // Fade with separation even when the point sits between the legs. Keeping a
    // full-weight slope out to 100 m hands the ground to a road across the
    // valley, and it switches on in one metre at the edge of the search.
    // 75 m stacks (the open bends) stay on the slope. The weight is already
    // gone before the search stops finding the pair, so the cutoff is not a step.
    const far = smoothstep(72, 96, pair.sep);
    const w = (1 - far) * (1 - smoothstep(slack0, slack1, pair.slack));
    if (w < 0.02) return null;
    const toeEnd = Math.min(pair.sep - pair.shelf, pair.shelf + pair.rise / 0.9);
    const crest = Math.max(pair.shelf + 0.8, toeEnd);
    const t = smoothstep(pair.shelf, crest, pair.dLow);
    let bh = lerp(pair.lowElev, pair.highElev, t);
    // The flat shelf is the lower road's. Snapping to the upper road just because
    // it is nearer puts that terrace's height down beside the lower asphalt.
    if (d <= pair.shelf && roadElev <= pair.lowElev + 1) bh = pair.lowElev;
    return { h: bh, w };
  }

  /**
   * Size of the grass cells covering this square. Between two hairpin legs the
   * bank is steeper than one coarse triangle can show without crossing the
   * asphalt, so those cells (and one neighbour, so the join is not the bank)
   * drop to 1 m, 0.5 m or 0.25 m. The height itself is the slope; the finer
   * grid only samples it. The chunk builder stitches the fine edge to the
   * coarse one, or the join is a hole in the face. Steps coarser than 16 m
   * stay coarse.
   */
  meshStep(x0: number, z0: number, step: number): number {
    if (step <= 1 || step > 16) return step;
    let want = this.cellBankMesh(x0, z0, step);
    if (step > 2) {
      want = Math.min(want, this.cellBankMesh(x0 + step, z0, step));
      want = Math.min(want, this.cellBankMesh(x0 - step, z0, step));
      want = Math.min(want, this.cellBankMesh(x0, z0 + step, step));
      want = Math.min(want, this.cellBankMesh(x0, z0 - step, step));
    }
    return want < step ? want : step;
  }

  /**
   * Finest bank grid this cell needs, or 32 when the cell is not between two legs.
   * The samples include the real corners. A triangle uses those vertices, and a
   * point just inside the cell can miss the terrace that the corner sits on.
   */
  private cellBankMesh(x0: number, z0: number, step: number): number {
    const k = ((Math.round(x0) + 100000) * 400000 + (Math.round(z0) + 100000)) * 8 + Math.round(step);
    const cached = this.bankCache.get(k);
    if (cached !== undefined) return cached;
    const pts: [number, number][] = [
      [x0 + step * 0.5, z0 + step * 0.5],
      [x0, z0],
      [x0 + step, z0],
      [x0, z0 + step],
      [x0 + step, z0 + step],
    ];
    let mesh = 32;
    let roadElev = 0;
    let onRoad = false;
    for (const [x, z] of pts) {
      const n = this.nearestRoad(x, z);
      if (!n || n.d > 34) continue;
      if (n.d < ROAD_HALF_WIDTH + 2) {
        onRoad = true;
        roadElev = n.elev;
      }
      const pair = this.legPair(x, z, n.i);
      if (!pair) continue;
      mesh = Math.min(mesh, this.bankMesh(pair.sep));
    }
    // A corner off the shelf, high or low, pulls the diagonal across the lane.
    // The same diagonal, one corner still on the flat verge and the next one up
    // the bank, is the triangular fin beside a hairpin. Refine any cell near the
    // road whose corners span that step. A coarser cell further out stays coarse.
    let near = onRoad;
    if (!near) {
      for (const [x, z] of pts) {
        const n = this.nearestRoad(x, z);
        if (n && n.d < 40) {
          near = true;
          break;
        }
      }
    }
    if (near && mesh > 1) {
      let lo = Infinity;
      let hi = -Infinity;
      let besideLane = onRoad;
      for (const [x, z] of pts) {
        const y = this.heightAt(x, z);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
        if (!besideLane) {
          const n = this.nearestRoad(x, z);
          if (n && n.d < 10) besideLane = true;
        }
      }
      const span = hi - lo;
      // A cell that touches the lane, or a face steeper than the cut, cannot
      // stay one triangle: the diagonal is the fin, and it crosses the rail.
      if ((besideLane && span > 1.2) || span > step * 1.15) mesh = 1;
    }
    if (onRoad && mesh > 1) {
      const shelf = roadElev - 0.3;
      for (const [x, z] of pts) {
        const y = this.heightAt(x, z);
        if (y - shelf > 0.35 || shelf - y > 0.8) {
          mesh = 1;
          break;
        }
      }
    }
    this.bankCache.set(k, mesh);
    return mesh;
  }

  /**
   * Height of the grass mesh. Vertices sit on a grid aligned with the terrain
   * chunks, and the diagonal matches the chunk builder, so a paved surface set
   * to this height stays on top of the grass instead of letting a coarse
   * triangle poke through.
   */
  surfaceHeight(x: number, z: number, step = 8): number {
    return this.groundMesh(x, z, step).y;
  }

  /**
   * The grass triangle under a point: its height, and how steep that face is
   * (rise over run). A raw height sample can sit well above this face where a
   * climb bends inside one grid cell, which is how a tree ends up in the air.
   */
  groundMesh(x: number, z: number, step = 8): { y: number; slope: number } {
    const i = Math.floor(x / step);
    const j = Math.floor(z / step);
    const x0 = i * step;
    const z0 = j * step;
    const fine = this.meshStep(x0, z0, step);
    if (fine < step - 1e-3) return this.groundMesh(x, z, fine);
    const u = (x - x0) / step;
    const v = (z - z0) / step;
    const h00 = this.heightAt(x0, z0);
    const h10 = this.heightAt(x0 + step, z0);
    const h01 = this.heightAt(x0, z0 + step);
    const h11 = this.heightAt(x0 + step, z0 + step);
    let y: number;
    let dhdx: number;
    let dhdz: number;
    if ((i + j) & 1) {
      if (u + v <= 1) {
        y = h00 * (1 - u - v) + h10 * u + h01 * v;
        dhdx = h10 - h00;
        dhdz = h01 - h00;
      } else {
        y = h11 * (u + v - 1) + h10 * (1 - v) + h01 * (1 - u);
        dhdx = h11 - h01;
        dhdz = h11 - h10;
      }
    } else if (u <= v) {
      y = h00 * (1 - v) + h01 * (v - u) + h11 * u;
      dhdx = h11 - h01;
      dhdz = h01 - h00;
    } else {
      y = h00 * (1 - u) + h10 * (u - v) + h11 * v;
      dhdx = h10 - h00;
      dhdz = h11 - h10;
    }
    return { y, slope: Math.hypot(dhdx, dhdz) / step };
  }
}

export const TERRAIN_TILE_SIZE = TILE_SIZE;
