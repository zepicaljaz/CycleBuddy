import type { Route } from '../route';
import type { DemGrid } from '../types';

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

/** Loads the real terrain for a track route onto `route.terrain`. Generated routes are left alone. */
export async function loadRouteTerrain(route: Route): Promise<void> {
  const t = route.def.track?.terrain;
  if (!t || route.terrain) return;
  let p = cache.get(t.file);
  if (!p) {
    p = fetchGrids(t.file, t.grids).catch(() => null);
    cache.set(t.file, p);
  }
  route.terrain = await p;
}
