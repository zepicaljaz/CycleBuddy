import type { Biome } from '../routes/types';
import { clamp, smoothstep } from '../util/math';
import { Noise2D } from '../util/noise';
import { ROAD_HALF_WIDTH, type TerrainField } from './terrainField';

export interface ChunkRequest {
  id: number;
  x0: number;
  z0: number;
  size: number;
  segs: number;
  treeSpacing: number;
  /** 0 = detailed props near the rider, 1 = simple trees only. */
  propDetail: 0 | 1;
  treeScale: number;
}

export interface ChunkResult {
  id: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** x, y, z, scale, rotation, type per instance. type: 0 pine, 1 broadleaf, 2 rock */
  props: Float32Array;
  minY: number;
  maxY: number;
}

const srgb = (hex: number): [number, number, number] => {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
};

/**
 * Loose limestone rubble where a route sets screeLine. A step darker and greyer
 * than the pale scree colour, with a darker patch mixed in, so the slope reads
 * as gravel rather than snow. Other limestone routes keep pal.scree.
 */
const GRAVEL = srgb(0xbab4a8);
const GRAVEL_DARK = srgb(0x8f8a82);

interface Palette {
  grassLow: RGB;
  grassHigh: RGB;
  forest: RGB;
  rock: RGB;
  rockDark: RGB;
  scree: RGB;
  snow: RGB;
  sand: RGB;
  verge: RGB;
  seabed: RGB;
}

const BIOMES: Record<Biome, Palette> = {
  alpine: {
    grassLow: srgb(0x6f9a3a),
    grassHigh: srgb(0xa8ac5c),
    forest: srgb(0x4c7431),
    rock: srgb(0x8e877d),
    rockDark: srgb(0x6a635b),
    scree: srgb(0xc4bcae),
    snow: srgb(0xeef3f8),
    sand: srgb(0xdcc994),
    verge: srgb(0x8f7f62),
    seabed: srgb(0x5d7d6e),
  },
  limestone: {
    grassLow: srgb(0x8a9644),
    grassHigh: srgb(0xc6b56a),
    forest: srgb(0x3d6840),
    rock: srgb(0xd4c6a8),
    rockDark: srgb(0xa89878),
    scree: srgb(0xe6dcc6),
    snow: srgb(0xeef3f8),
    sand: srgb(0xe6d2a2),
    verge: srgb(0xb5a078),
    seabed: srgb(0x2f8f96),
  },
  desert: {
    grassLow: srgb(0xe0b45e),
    grassHigh: srgb(0xc47a3c),
    forest: srgb(0x8a7840),
    rock: srgb(0xc45a38),
    rockDark: srgb(0x7a3a2c),
    scree: srgb(0xe8c98a),
    snow: srgb(0xeef3f8),
    sand: srgb(0xf0d7a4),
    verge: srgb(0xc4a574),
    seabed: srgb(0xc4a574),
  },
  moor: {
    grassLow: srgb(0x6a7040),
    grassHigh: srgb(0x8a6848),
    forest: srgb(0x3e5238),
    rock: srgb(0x7a736c),
    rockDark: srgb(0x524c48),
    scree: srgb(0xb2aaa0),
    snow: srgb(0xe6eef4),
    sand: srgb(0xc4b492),
    verge: srgb(0x6e6248),
    seabed: srgb(0x3a5560),
  },
  spruce: {
    grassLow: srgb(0x1c4428),
    grassHigh: srgb(0x214e30),
    forest: srgb(0x1c4428),
    rock: srgb(0x6e6862),
    rockDark: srgb(0x48443f),
    scree: srgb(0xa89f94),
    snow: srgb(0xe8eef4),
    sand: srgb(0xb4a888),
    verge: srgb(0x1c4428),
    seabed: srgb(0x2e4a46),
  },
};

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number, out: RGB): RGB => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};

const hash2 = (x: number, z: number): number => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class ChunkBuilder {
  private noise: Noise2D;

  constructor(private field: TerrainField, seed: number) {
    this.noise = new Noise2D(seed * 31 + 5);
  }

  build(req: ChunkRequest): ChunkResult {
    const { x0, z0, size, segs } = req;
    const field = this.field;
    const sc = field.scenery;
    const step = size / segs;
    const W = segs + 3; // includes a one-vertex border for curvature
    const H = new Float32Array(W * W);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const h = field.heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
        H[j * W + i] = h;
        if (i > 0 && j > 0 && i < W - 1 && j < W - 1) {
          minY = Math.min(minY, h);
          maxY = Math.max(maxY, h);
        }
      }
    }
    const hAt = (i: number, j: number) => H[(j + 1) * W + (i + 1)];
    // Concavity-based ambient occlusion per vertex
    const ao = (i: number, j: number) => {
      const c = hAt(i, j);
      const lap = (hAt(i - 1, j) + hAt(i + 1, j) + hAt(i, j - 1) + hAt(i, j + 1)) / 4 - c;
      return clamp(1 - (lap / step) * 1.6, 0.62, 1.08);
    };

    // Hairpin banks refine the grid, so the buffers grow instead of being counted up front.
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const col: RGB = [0, 0, 0];
    const tmp: RGB = [0, 0, 0];

    const faceColor = (cx: number, cy: number, cz: number, ny: number, aoV: number, jitter: number): RGB => {
      const n = this.noise;
      const biome = sc.biome ?? 'alpine';
      const pal = BIOMES[biome];
      const arid = biome === 'desert';
      const treeline = sc.treeline + n.noise(cx / 700, cz / 700) * 120;
      const alt = smoothstep(sc.treeline - 900, sc.treeline + 150, cy);
      mix(pal.grassLow, pal.grassHigh, alt, col);
      const forestN = n.fbm(cx / 850, cz / 850, 2);
      if (arid) {
        const dune = n.noise(cx / 160, cz / 160) * 0.5 + 0.5;
        mix(col, pal.sand, dune * 0.5, col);
      } else {
        const cover = field.groundCover(cx, cz, cy);
        let forest = smoothstep(1 - sc.forestDensity * 1.25, 1.1 - sc.forestDensity, forestN * 0.5 + 0.5) * (1 - smoothstep(treeline - 120, treeline + 40, cy));
        if (cover === 'pasture') forest = 0;
        else if (cover === 'wood') forest = Math.max(forest, 0.82);
        mix(col, pal.forest, forest * 0.75, col);
      }
      const aboveTree = smoothstep(treeline + 100, treeline + 450, cy);
      const barren = aboveTree * smoothstep(-0.2, 0.4, n.noise(cx / 400, cz / 400));
      // A low treeline usually means bare scree above the woods. Pasture stays grass;
      // the steep faces still pick up rock further down.
      const paleScree = !sc.pasture && sc.mountainHeight > 1000 && sc.treeline < 1700;
      const gravelHere = sc.screeLine != null;
      mix(col, gravelHere ? GRAVEL : paleScree ? pal.scree : pal.rock, barren * (sc.pasture ? 0.18 : 0.85), col);
      // Loose gravel takes over across a short band. Steep faces stay that colour
      // instead of turning into dark rock. The patch keeps a rubble slope from
      // reading as one flat sheet of snow.
      const screeAt = sc.screeLine;
      if (screeAt != null) {
        const patch = n.noise(cx / 16, cz / 16) * 0.5 + 0.5;
        mix(GRAVEL, GRAVEL_DARK, patch * 0.55, tmp);
        mix(col, tmp, smoothstep(screeAt - 25, screeAt + 30, cy), col);
      }
      const onScree = screeAt != null && cy > screeAt - 25;
      const rocky = smoothstep(0.86, 0.68, ny) * (arid ? 1.15 : 1) * (onScree ? 0.28 : 1);
      mix(col, mix(pal.rock, pal.rockDark, smoothstep(0.7, 0.45, ny), tmp), Math.min(1, rocky), col);
      const snowLine = sc.snowline + n.noise(cx / 500, cz / 500) * 140;
      const snow = arid ? 0 : smoothstep(snowLine - 40, snowLine + 60, cy) * smoothstep(0.45, 0.7, ny);
      mix(col, pal.snow, snow, col);
      if (sc.waterLevel !== null) {
        if (cy < sc.waterLevel + 3) mix(col, pal.sand, smoothstep(sc.waterLevel + 3, sc.waterLevel + 0.5, cy), col);
        if (cy < sc.waterLevel - 1.5) mix(col, pal.seabed, smoothstep(sc.waterLevel - 1.5, sc.waterLevel - 6, cy), col);
      }
      const d = field.roadDistance(cx, cz);
      if (d < ROAD_HALF_WIDTH + 3.5) {
        const near = smoothstep(ROAD_HALF_WIDTH + 3.5, ROAD_HALF_WIDTH + 1, d) * 0.8;
        if (sc.screeLine != null && cy > sc.screeLine + 15) mix(col, GRAVEL, near * 0.35, col);
        else mix(col, pal.verge, near, col);
      }
      const shade = aoV * (0.94 + jitter * 0.12) * (1 - snow * 0.05);
      col[0] *= shade;
      col[1] *= shade;
      col[2] *= shade;
      return col;
    };

    const pushTri = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
      aoV: number, jitter: number,
    ) => {
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const c = faceColor((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3, ny, aoV, jitter);
      const verts = [ax, ay, az, bx, by, bz, cx, cy, cz];
      for (let k = 0; k < 3; k++) {
        positions.push(verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2]);
        normals.push(nx, ny, nz);
        colors.push(c[0], c[1], c[2]);
      }
      if (ay < minY) minY = ay;
      if (by < minY) minY = by;
      if (cy < minY) minY = cy;
      if (ay > maxY) maxY = ay;
      if (by > maxY) maxY = by;
      if (cy > maxY) maxY = cy;
    };

    // Same diagonal as TerrainField.groundMesh, so props sit on the face the rider sees.
    const drawQuad = (wx: number, wz: number, q: number, aoV: number) => {
      const h00 = field.heightAt(wx, wz);
      const h10 = field.heightAt(wx + q, wz);
      const h01 = field.heightAt(wx, wz + q);
      const h11 = field.heightAt(wx + q, wz + q);
      const gx = Math.floor(wx / q);
      const gz = Math.floor(wz / q);
      const lx = wx - x0;
      const lz = wz - z0;
      if ((gx + gz) & 1) {
        pushTri(lx, h00, lz, lx, h01, lz + q, lx + q, h10, lz, aoV, hash2(gx, gz * 2));
        pushTri(lx + q, h10, lz, lx, h01, lz + q, lx + q, h11, lz + q, aoV, hash2(gx, gz * 2 + 1));
      } else {
        pushTri(lx, h00, lz, lx, h01, lz + q, lx + q, h11, lz + q, aoV, hash2(gx, gz * 2));
        pushTri(lx, h00, lz, lx + q, h11, lz + q, lx + q, h10, lz, aoV, hash2(gx, gz * 2 + 1));
      }
    };

    // The fine bank grid meets a coarser cell along a shared edge. The coarse
    // side is the straight line between the corners; the fine side follows the
    // slope. On a steep face that crack is a hole. A ribbon between the two
    // edges closes it. It is not a wall dropped below the ground: that reads
    // as the zigzag cliff. Only the finer cell emits it, so both chunks agree.
    const stitchEdge = (ax: number, az: number, bx: number, bz: number, fine: number, coarse: number) => {
      const at = (t: number) => field.heightAt(ax + (bx - ax) * t, az + (bz - az) * t);
      const coarseH: number[] = [];
      for (let k = 0; k <= coarse; k++) coarseH.push(at(k / coarse));
      const coarseAt = (k: number) => {
        const u = (k / fine) * coarse;
        const i = Math.min(coarse - 1, Math.floor(u + 1e-9));
        const f = u - i;
        return coarseH[i] * (1 - f) + coarseH[Math.min(coarse, i + 1)] * f;
      };
      let deviate = 0;
      for (let k = 1; k < fine; k++) deviate = Math.max(deviate, Math.abs(at(k / fine) - coarseAt(k)));
      if (deviate < 0.08) return;
      for (let k = 0; k < fine; k++) {
        const t0 = k / fine;
        const t1 = (k + 1) / fine;
        const xA = ax + (bx - ax) * t0;
        const zA = az + (bz - az) * t0;
        const xB = ax + (bx - ax) * t1;
        const zB = az + (bz - az) * t1;
        const y0 = at(t0);
        const y1 = at(t1);
        const c0 = coarseAt(k);
        const c1 = coarseAt(k + 1);
        pushTri(xA - x0, y0, zA - z0, xB - x0, y1, zB - z0, xA - x0, c0, zA - z0, 0.92, 0.35);
        pushTri(xB - x0, y1, zB - z0, xB - x0, c1, zB - z0, xA - x0, c0, zA - z0, 0.92, 0.35);
      }
    };

    // Positions are chunk-local (relative to x0/z0) to keep float precision.
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const wx = x0 + i * step;
        const wz = z0 + j * step;
        const sub = field.meshStep(wx, wz, step);
        if (sub < step - 1e-3) {
          const n = Math.max(1, Math.round(step / sub));
          const q = step / n;
          for (let jj = 0; jj < n; jj++) {
            for (let ii = 0; ii < n; ii++) drawQuad(wx + ii * q, wz + jj * q, q, 0.92);
          }
          const seam = (ox: number, oz: number, ax: number, az: number, bx: number, bz: number) => {
            const nb = field.meshStep(wx + ox * step, wz + oz * step, step);
            if (!(nb > sub + 1e-3)) return;
            const coarse = Math.max(1, Math.round(step / Math.min(nb, step)));
            if (coarse >= n) return;
            stitchEdge(ax, az, bx, bz, n, coarse);
          };
          seam(0, -1, wx, wz, wx + step, wz);
          seam(0, 1, wx, wz + step, wx + step, wz + step);
          seam(-1, 0, wx, wz, wx, wz + step);
          seam(1, 0, wx + step, wz, wx + step, wz + step);
          continue;
        }
        const xa = i * step, xb = (i + 1) * step;
        const za = j * step, zb = (j + 1) * step;
        const h00 = hAt(i, j), h10 = hAt(i + 1, j), h01 = hAt(i, j + 1), h11 = hAt(i + 1, j + 1);
        const a00 = ao(i, j), a10 = ao(i + 1, j), a01 = ao(i, j + 1), a11 = ao(i + 1, j + 1);
        const gx = Math.floor(wx / step);
        const gz = Math.floor(wz / step);
        if ((gx + gz) & 1) {
          pushTri(xa, h00, za, xa, h01, zb, xb, h10, za, (a00 + a01 + a10) / 3, hash2(gx, gz * 2));
          pushTri(xb, h10, za, xa, h01, zb, xb, h11, zb, (a10 + a01 + a11) / 3, hash2(gx, gz * 2 + 1));
        } else {
          pushTri(xa, h00, za, xa, h01, zb, xb, h11, zb, (a00 + a01 + a11) / 3, hash2(gx, gz * 2));
          pushTri(xa, h00, za, xb, h11, zb, xb, h10, za, (a00 + a11 + a10) / 3, hash2(gx, gz * 2 + 1));
        }
      }
    }

    // Skirts hide cracks between chunks of different resolution.
    const skirt = Math.max(8, step * 1.5);
    const edge = (ia: number, ja: number, ib: number, jb: number) => {
      const ax = ia * step, az = ja * step, bx = ib * step, bz = jb * step;
      const ha = hAt(ia, ja), hb = hAt(ib, jb);
      pushTri(ax, ha, az, bx, hb, bz, ax, ha - skirt, az, 0.8, 0.5);
      pushTri(bx, hb, bz, bx, hb - skirt, bz, ax, ha - skirt, az, 0.8, 0.5);
    };
    for (let k = 0; k < segs; k++) {
      edge(k + 1, 0, k, 0);
      edge(k, segs, k + 1, segs);
      edge(0, k, 0, k + 1);
      edge(segs, k + 1, segs, k);
    }

    return {
      id: req.id,
      positions: Float32Array.from(positions),
      normals: Float32Array.from(normals),
      colors: Float32Array.from(colors),
      props: this.scatterProps(req),
      minY,
      maxY,
    };
  }

  private scatterProps(req: ChunkRequest): Float32Array {
    const sp = req.treeSpacing;
    if (!(sp > 0)) return new Float32Array(0);
    const field = this.field;
    const sc = field.scenery;
    const n = this.noise;
    const out: number[] = [];
    const gx0 = Math.ceil(req.x0 / sp);
    const gz0 = Math.ceil(req.z0 / sp);
    const gx1 = Math.floor((req.x0 + req.size) / sp);
    const gz1 = Math.floor((req.z0 + req.size) / sp);
    for (let gz = gz0; gz < gz1; gz++) {
      for (let gx = gx0; gx < gx1; gx++) {
        const r1 = hash2(gx * 7 + 3, gz * 13 + 1);
        const r2 = hash2(gx * 11 + 5, gz * 3 + 7);
        const r3 = hash2(gx * 5 + 9, gz * 17 + 2);
        const x = (gx + r1 * 0.9) * sp;
        const z = (gz + r2 * 0.9) * sp;
        const d = field.roadDistance(x, z);
        if (d < ROAD_HALF_WIDTH + 5) continue;
        if (field.onLake(x, z) && field.heightAt(x, z) < (sc.waterLevel ?? 0) + 2.4) continue;
        if (field.blocksProp(x, z) || field.cleared(x, z)) continue;
        if (d < ROAD_HALF_WIDTH + 24) {
          const near = field.nearestRoad(x, z);
          if (near && field.isTown(near.i)) continue;
        }
        const hx = field.heightAt(x + 3, z);
        const hz = field.heightAt(x, z + 3);
        const h = field.heightAt(x, z);
        const slope = Math.hypot(hx - h, hz - h) / 3;
        // Sit on the triangle the rider sees. The raw sample can be several
        // metres above that face on a climb, which leaves the prop in the air.
        const ground = field.groundMesh(x, z, req.size / req.segs);
        const sink = Math.min(ground.slope, 1.5) * 0.35;
        if (sc.waterLevel !== null && ground.y < sc.waterLevel + 2) continue;
        const treeline = sc.treeline + n.noise(x / 700, z / 700) * 120;
        const forestN = n.fbm(x / 850, z / 850, 2) * 0.5 + 0.5;
        const cover = field.groundCover(x, z, h);
        let density = smoothstep(1 - sc.forestDensity * 1.25, 1.1 - sc.forestDensity, forestN);
        if (cover === 'wood') density = Math.max(density, 0.9);
        // Trees from a land-cover map stand where the map has them, at any height.
        const altFade = cover === 'pasture' ? 0 : cover === 'wood' && field.hasCoverMap ? 1 : 1 - smoothstep(treeline - 200, treeline + 30, h);
        const biome = sc.biome ?? 'alpine';
        const lx = x - req.x0;
        const lz = z - req.z0;
        if (biome === 'desert') {
          if (slope < 0.55 && r3 < 0.03) {
            out.push(lx, ground.y - 0.15 - sink, lz, (0.55 + r1 * 0.4) * Math.min(req.treeScale, 1.1), r1 * Math.PI * 2, r2 > 0.78 ? 1 : 0);
          } else if (req.propDetail === 0 && (r3 > 0.94 || (slope > 0.22 && r3 > 0.72))) {
            out.push(lx, ground.y - 0.35 - sink, lz, 0.55 + r2 * 1.5, r1 * Math.PI * 2, 2);
          }
          continue;
        }
        const keep = (density * 0.85 + (biome === 'moor' ? 0.03 : 0.07)) * altFade * (1 - smoothstep(0.6, 1.0, slope)) * (biome === 'moor' ? 0.55 : 1);
        if (r3 < keep) {
          const broadleaf = sc.broadleaf ? true : biome === 'spruce' ? false : biome === 'moor' ? n.noise(x / 300 + 40, z / 300) > 0.72 : h < 1100 && n.noise(x / 300 + 40, z / 300) > 0.15;
          let scale = (0.75 + hash2(gx, gz) * 0.6) * req.treeScale * (altFade < 0.5 ? 0.8 : 1);
          if (biome === 'moor' && !broadleaf) scale *= 0.45;
          out.push(lx, ground.y - 0.3 - sink, lz, scale, r1 * Math.PI * 2, broadleaf ? 1 : 0);
        } else if (req.propDetail === 0 && r3 > (sc.screeLine != null && h > sc.screeLine ? 0.96 : 0.985) - slope * 0.05) {
          out.push(lx, ground.y - 0.4 - sink, lz, 0.6 + r2 * 1.4, r1 * Math.PI * 2, 2);
        }
      }
    }
    return new Float32Array(out);
  }
}
