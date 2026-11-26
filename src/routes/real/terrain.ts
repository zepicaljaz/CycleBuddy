import type { Route } from '../route';
import type { CoverGrid, DemGrid, DemGridInfo } from '../types';

/**
 * Height grids for real roads ship as small binary files (heights in decimetres,
 * unsigned 16-bit, grids back to back) and load only when someone rides that road.
 * Land cover sits beside them as `<id>.cover.bin`: one byte per node, same grids.
 */
const FILES = import.meta.glob('../../assets/terrain/*.bin', { query: '?url', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;

const cache = new Map<string, Promise<DemGrid[] | null>>();
const coverCache = new Map<string, Promise<CoverGrid[] | null>>();

async function fetchBytes(file: string): Promise<ArrayBuffer | null> {
  const key = Object.keys(FILES).find((k) => k.endsWith(`/${file}`));
  if (!key) return null;
  const url = await FILES[key]();
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.arrayBuffer();
}

/** Splits a file of grids stored back to back. Null when the file is shorter than the grids say. */
export function splitGrids<T extends Uint16Array | Uint8Array>(raw: T, grids: DemGridInfo[]): { info: DemGridInfo; data: T }[] | null {
  let off = 0;
  const out: { info: DemGridInfo; data: T }[] = [];
  for (const g of grids) {
    const n = g.w * g.h;
    if (off + n > raw.length) return null;
    // slice, not subarray: each grid owns its buffer, so a worker copy is only that grid.
    out.push({ info: g, data: raw.slice(off, off + n) as T });
    off += n;
  }
  return out;
}

async function fetchGrids(file: string, grids: DemGridInfo[]): Promise<DemGrid[] | null> {
  const buf = await fetchBytes(file);
  if (!buf) return null;
  // Kept as decimetres. TerrainField scales on read; a Float32 copy per worker doubled the memory.
  const parts = splitGrids(new Uint16Array(buf), grids);
  return parts?.map(({ info, data }) => ({ ...info, data, scale: 0.1 })) ?? null;
}

async function fetchCover(file: string, grids: DemGridInfo[]): Promise<CoverGrid[] | null> {
  const buf = await fetchBytes(file);
  if (!buf) return null;
  const parts = splitGrids(new Uint8Array(buf), grids);
  return parts?.map(({ info, data }) => ({ ...info, data })) ?? null;
}

/**
 * Loads the real terrain for a track route onto `route.terrain`, and its land
 * cover onto `route.cover` when the track has one. A missing or broken cover file
 * leaves `route.cover` null and the road keeps the generated look. Generated
 * routes are left alone.
 */
export async function loadRouteTerrain(route: Route): Promise<void> {
  const t = route.def.track?.terrain;
  if (!t) return;
  const jobs: Promise<void>[] = [];
  if (!route.terrain) {
    let p = cache.get(t.file);
    if (!p) {
      p = fetchGrids(t.file, t.grids).catch(() => null);
      cache.set(t.file, p);
    }
    jobs.push(p.then((g) => void (route.terrain = g)));
  }
  const c = t.cover;
  if (c && !route.cover) {
    let p = coverCache.get(c.file);
    if (!p) {
      p = fetchCover(c.file, c.grids).catch(() => null);
      coverCache.set(c.file, p);
    }
    jobs.push(p.then((g) => void (route.cover = g)));
  }
  await Promise.all(jobs);
}
