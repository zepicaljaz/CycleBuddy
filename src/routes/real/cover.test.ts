import { describe, expect, it } from 'vitest';

/**
 * Land cover of the real roads (scripts/real-track/cover.mjs): one class byte per
 * terrain grid point, same grids as the heights. Classes:
 * 0 unknown, 1 forest, 2 meadow, 3 scrub, 4 rock, 5 scree, 6 cliff, 7 glacier, 8 water, 9 built-up.
 */

interface Grid { x0: number; z0: number; cell: number; w: number; h: number }
interface Track {
  id: string;
  x: number[];
  z: number[];
  y: number[];
  terrain: { file: string; grids: Grid[]; cover?: { file: string; grids: Grid[]; sources: string[] } };
}

const ROADS = [
  'vrsic-kranjska-gora',
  'alpe-dhuez-bourg-doisans',
  'stelvio-prato',
  'ventoux-bedoin',
  'tourmalet-luz',
  'angliru-la-vega',
  'galibier-valloire',
  'giau-selva',
  'krvavec-cerklje',
];

const TRACKS = import.meta.glob('./tracks/*.json', { eager: true, import: 'default' }) as Record<string, Track>;
const track = (id: string): Track => TRACKS[`./tracks/${id}.json`];

// The test runs in Node; the browser types the project compiles with don't know `fs`.
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { readFileSync(u: URL): Uint8Array } } }).process.getBuiltinModule('node:fs');
const asset = (file: string) => fs.readFileSync(new URL(`../../assets/terrain/${file}`, import.meta.url));

function load(id: string) {
  const t = track(id);
  const cover = asset(t.terrain.cover!.file);
  const raw = asset(t.terrain.file);
  const heights = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  const g = t.terrain.grids[0];
  const near = cover.subarray(0, g.w * g.h);
  const hNear = (c: number) => heights[c] / 10;
  return { t, g, cover, near, hNear };
}

/** Share of each class among near-grid points that pass `keep`. */
function shares(id: string, keep: (x: number, z: number, h: number) => boolean) {
  const { g, near, hNear } = load(id);
  const n = new Array(10).fill(0);
  let all = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const c = j * g.w + i;
      if (!keep(g.x0 + i * g.cell, g.z0 + j * g.cell, hNear(c))) continue;
      n[near[c]]++;
      all++;
    }
  }
  return { all, share: (...cls: number[]) => cls.reduce((a, k) => a + n[k], 0) / Math.max(1, all) };
}

/** Highest point of the road (the summit, for every one of these climbs). */
function summit(id: string) {
  const t = track(id);
  let k = 0;
  for (let i = 1; i < t.y.length; i++) if (t.y[i] > t.y[k]) k = i;
  return { x: t.x[k], z: t.z[k], y: t.y[k] };
}
const within = (p: { x: number; z: number }, r: number) => (x: number, z: number) => Math.hypot(x - p.x, z - p.z) <= r;

describe('real land cover', () => {
  it.each(ROADS)('%s has cover on the same grids as its heights', (id) => {
    const t = track(id);
    const c = t.terrain.cover;
    expect(c).toBeDefined();
    expect(c!.file).toBe(`${id}.cover.bin`);
    expect(c!.grids).toEqual(t.terrain.grids);
    expect(c!.sources).toContain('ESA WorldCover 2021 v200');
    const bytes = asset(c!.file);
    expect(bytes.length).toBe(c!.grids.reduce((a, g) => a + g.w * g.h, 0));
    let bad = 0;
    for (const v of bytes) if (v > 9) bad++;
    expect(bad).toBe(0);
    const near = bytes.subarray(0, c!.grids[0].w * c!.grids[0].h);
    let unknown = 0;
    for (const v of near) if (v === 0) unknown++;
    expect(unknown / near.length).toBeLessThan(0.2);
  });

  it('Mont Ventoux: the summit is a field of stones', () => {
    // 800 m: the north face drops fast and is wooded higher up than the bare south side.
    const s = shares('ventoux-bedoin', within(summit('ventoux-bedoin'), 800));
    expect(s.share(4, 5, 6)).toBeGreaterThan(0.5);
    expect(s.share(1)).toBeLessThan(0.3);
  });

  it('Stelvio: rock and scree at the pass, ice not far off', () => {
    const top = summit('stelvio-prato');
    const pass = shares('stelvio-prato', within(top, 1500));
    expect(pass.share(4, 5, 6)).toBeGreaterThan(0.3);
    expect(pass.share(1)).toBeLessThan(0.05);
    expect(shares('stelvio-prato', within(top, 4000)).share(7)).toBeGreaterThan(0.05);
  });

  it('Vršič: forest low down, rock and scree high up', () => {
    expect(shares('vrsic-kranjska-gora', (_x, _z, h) => h < 1100).share(1)).toBeGreaterThan(0.5);
    expect(shares('vrsic-kranjska-gora', (_x, _z, h) => h > 2000).share(4, 5, 6)).toBeGreaterThan(0.5);
  });

  it('Tourmalet: open grass above the treeline, not grey rock', () => {
    const s = shares('tourmalet-luz', (_x, _z, h) => h > 1600 && h < 2100);
    expect(s.share(2, 3)).toBeGreaterThan(0.6);
    expect(s.share(4, 5, 6)).toBeLessThan(0.15);
  });

  it('Angliru: meadows and woods', () => {
    expect(shares('angliru-la-vega', () => true).share(1, 2, 3)).toBeGreaterThan(0.9);
  });
});
