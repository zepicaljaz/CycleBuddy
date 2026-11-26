import type { Route } from '../route';
import type { CoverGrid, DemGrid, DemGridInfo } from '../types';

/**
 * Height grids for real roads ship as small binary files (heights in decimetres,
 * unsigned 16-bit, grids back to back) and load only when someone rides that road.
 */
const FILES = import.meta.glob('../../assets/terrain/*.bin', { query: '?url', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;

const cache = new Map<string, Promise<DemGrid[] | null>>();

async function fetchGrids(file: string, grids: NonNullable<NonNullable<Route['def']['track']>['terrain']>['grids']): Promise<DemGrid[] | null> {
  const key = Object.keys(FILES).find((k) => k.endsWith(`/${file}`));
  if (!key) return null;
  const url = await FILES[key]();
  const res = await fetch(url);
  if (!res.ok) return null;
  const raw = new Uint16Array(await res.arrayBuffer());
  let off = 0;
  const out: DemGrid[] = [];
  for (const g of grids) {
    const n = g.w * g.h;
    if (off + n > raw.length) return null;
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = raw[off + i] / 10;
    off += n;
    out.push({ ...g, data });
  }
  return out;
}

const coverCache = new Map<string, Promise<CoverGrid[] | null>>();

/** Cover grids are (value, run) byte pairs, all grids back to back. */
async function fetchCover(file: string, grids: DemGridInfo[]): Promise<CoverGrid[] | null> {
  const key = Object.keys(FILES).find((k) => k.endsWith(`/${file}`));
  if (!key) return null;
  const res = await fetch(await FILES[key]());
  if (!res.ok) return null;
  return decodeCover(new Uint8Array(await res.arrayBuffer()), grids);
}

/** Unpacks run-length encoded cover grids. Null if the data does not fill them exactly. */
export function decodeCover(rle: Uint8Array, grids: DemGridInfo[]): CoverGrid[] | null {
  const out: CoverGrid[] = [];
  let at = 0;
  for (const g of grids) {
    const data = new Uint8Array(g.w * g.h);
    let i = 0;
    while (i < data.length) {
      if (at + 1 >= rle.length) return null;
      const v = rle[at];
      const n = rle[at + 1];
      at += 2;
      if (i + n > data.length) return null;
      data.fill(v, i, i + n);
      i += n;
    }
    out.push({ ...g, data });
  }
  return at === rle.length ? out : null;
}

/** Loads the real terrain (and tree cover, if any) for a track route onto the route. Generated routes are left alone. */
export async function loadRouteTerrain(route: Route): Promise<void> {
  const t = route.def.track?.terrain;
  if (!t || route.terrain) return;
  let p = cache.get(t.file);
  if (!p) {
    p = fetchGrids(t.file, t.grids).catch(() => null);
    cache.set(t.file, p);
  }
  let c: Promise<CoverGrid[] | null> | null = null;
  if (t.cover) {
    c = coverCache.get(t.cover.file) ?? null;
    if (!c) {
      c = fetchCover(t.cover.file, t.cover.grids).catch(() => null);
      coverCache.set(t.cover.file, c);
    }
  }
  const [terrain, cover] = await Promise.all([p, c]);
  route.terrain = terrain;
  route.cover = cover;
}
