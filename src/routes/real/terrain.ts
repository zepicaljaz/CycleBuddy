import type { Route } from '../route';
import type { CoverGrid, DemGrid, DemGridInfo } from '../types';

/**
 * Height grids for real roads ship as small binary files (heights in decimetres,
 * unsigned 16-bit, grids back to back) and load only when someone rides that road.
 * A road with mapped land cover has one byte per fine-grid node after the heights.
 */
const FILES = import.meta.glob('../../assets/terrain/*.bin', { query: '?url', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;

interface Loaded {
  grids: DemGrid[];
  cover: CoverGrid | null;
}

const cache = new Map<string, Promise<Loaded | null>>();

/** Reads the grids, and the cover bytes after them when `cover` is given. */
export function readTerrain(buf: ArrayBuffer, grids: DemGridInfo[], cover?: DemGridInfo): Loaded | null {
  let n = 0;
  for (const g of grids) n += g.w * g.h;
  if (n * 2 > buf.byteLength) return null;
  const raw = new Uint16Array(buf, 0, n);
  let off = 0;
  const out: DemGrid[] = [];
  for (const g of grids) {
    const size = g.w * g.h;
    const data = new Float32Array(size);
    for (let i = 0; i < size; i++) data[i] = raw[off + i] / 10;
    off += size;
    out.push({ ...g, data });
  }
  let coverGrid: CoverGrid | null = null;
  if (cover) {
    const size = cover.w * cover.h;
    if (n * 2 + size > buf.byteLength) return null;
    coverGrid = { ...cover, data: new Uint8Array(buf.slice(n * 2, n * 2 + size)) };
  }
  return { grids: out, cover: coverGrid };
}

async function fetchTerrain(t: NonNullable<NonNullable<Route['def']['track']>['terrain']>): Promise<Loaded | null> {
  const key = Object.keys(FILES).find((k) => k.endsWith(`/${t.file}`));
  if (!key) return null;
  const url = await FILES[key]();
  const res = await fetch(url);
  if (!res.ok) return null;
  return readTerrain(await res.arrayBuffer(), t.grids, t.cover);
}

/** Loads the real terrain (and mapped land cover) for a track route onto `route`. Generated routes are left alone. */
export async function loadRouteTerrain(route: Route): Promise<void> {
  const t = route.def.track?.terrain;
  if (!t || route.terrain) return;
  let p = cache.get(t.file);
  if (!p) {
    p = fetchTerrain(t).catch(() => null);
    cache.set(t.file, p);
  }
  const loaded = await p;
  route.terrain = loaded?.grids ?? null;
  route.cover = loaded?.cover ?? null;
}
