import { describe, expect, it } from 'vitest';
import { ROUTES } from '../routes/definitions';
import { Route } from '../routes/route';
import { realClimbRoute } from '../routes/real/build';
import { REAL_CLIMB_MAP } from '../routes/real/data';
import { splitGrids } from '../routes/real/terrain';
import { LandCover, type CoverGrid, type DemGrid, type DemGridInfo, type SceneryDef } from '../routes/types';
import { ChunkBuilder, PROP_SCRUB } from './terrainChunk';
import { TerrainField } from './terrainField';

const SCENERY: SceneryDef = { ...ROUTES.find((r) => r.id === 'alpine')!.scenery, treeline: 2050, snowline: 2850, waterLevel: null };

/** A flat straight road along z = 0 from x = 0 to 2000 m. Cheap to build, and far from every test point but the bank ones. */
function straightRoad(y = 1200) {
  const n = 501;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i * 4;
    ys[i] = y;
  }
  return { x, z, y: ys };
}

/** Two grids like a real road's: 25 m near (fades in over 800 m), 100 m far (over 3000 m). */
const GRIDS: DemGridInfo[] = [
  { x0: -1000, z0: -1500, cell: 25, w: 181, h: 141 },
  { x0: -6000, z0: -6000, cell: 100, w: 141, h: 141 },
];

function demFrom(fn: (x: number, z: number) => number): DemGrid[] {
  return GRIDS.map((g) => {
    // Stored like the real files: unsigned decimetres.
    const data = new Uint16Array(g.w * g.h);
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) data[j * g.w + i] = Math.round(fn(g.x0 + i * g.cell, g.z0 + j * g.cell) * 10);
    return { ...g, data, scale: 0.1 };
  });
}

function coverFrom(fn: (x: number, z: number) => number): CoverGrid[] {
  return GRIDS.map((g) => {
    const data = new Uint8Array(g.w * g.h);
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) data[j * g.w + i] = fn(g.x0 + i * g.cell, g.z0 + j * g.cell);
    return { ...g, data };
  });
}

describe('land cover', () => {
  it('coverAt reads node (i, j) at (x0 + i·cell, z0 + j·cell), fine grid first', () => {
    const road = straightRoad();
    const fine: CoverGrid = { x0: 100, z0: 200, cell: 25, w: 4, h: 3, data: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2]) };
    const far: CoverGrid = { x0: 0, z0: 0, cell: 100, w: 10, h: 10, data: new Uint8Array(100).fill(LandCover.scree) };
    const field = new TerrainField({ ...road, seed: 1, scenery: SCENERY, cover: [fine, far] });
    expect(field.coverAt(100, 200)).toBe(1);
    expect(field.coverAt(175, 200)).toBe(4);
    expect(field.coverAt(150, 225)).toBe(7);
  });

  it('coverAt rounds to the nearest node and falls through unknown nodes', () => {
    const road = straightRoad();
    const fine: CoverGrid = { x0: 100, z0: 200, cell: 25, w: 4, h: 3, data: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2]) };
    const far: CoverGrid = { x0: 0, z0: 0, cell: 100, w: 10, h: 10, data: new Uint8Array(100).fill(LandCover.scree) };
    const field = new TerrainField({ ...road, seed: 1, scenery: SCENERY, cover: [fine, far] });
    expect(field.coverAt(112.4, 200)).toBe(1);
    expect(field.coverAt(112.6, 200)).toBe(2);
    expect(field.coverAt(100, 212.6)).toBe(5);
    // Node (1, 2) has no data: the far grid answers.
    expect(field.coverAt(125, 250)).toBe(LandCover.scree);
    // Outside both grids.
    expect(field.coverAt(-500, -500)).toBe(0);
    // No cover at all.
    expect(new TerrainField({ ...road, seed: 1, scenery: SCENERY }).coverAt(125, 225)).toBe(0);
  });

  it('splits a cover file into its grids, and rejects a short one', () => {
    const grids: DemGridInfo[] = [
      { x0: 0, z0: 0, cell: 25, w: 2, h: 2 },
      { x0: 0, z0: 0, cell: 100, w: 3, h: 1 },
    ];
    const parts = splitGrids(Uint8Array.from([1, 2, 3, 4, 5, 6, 7]), grids)!;
    expect(Array.from(parts[0].data)).toEqual([1, 2, 3, 4]);
    expect(Array.from(parts[1].data)).toEqual([5, 6, 7]);
    expect(splitGrids(Uint8Array.from([1, 2, 3]), grids)).toBeNull();
  });

  it('reads decimetre heights the same as metres', () => {
    const road = straightRoad();
    const fn = (x: number, z: number) => 1500 + 0.3 * x - 0.2 * z;
    const metres: DemGrid[] = GRIDS.map((g) => {
      const data = new Float32Array(g.w * g.h);
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) data[j * g.w + i] = Math.round(fn(g.x0 + i * g.cell, g.z0 + j * g.cell) * 10) / 10;
      return { ...g, data };
    });
    const a = new TerrainField({ ...road, seed: 3, scenery: SCENERY, dem: metres });
    const b = new TerrainField({ ...road, seed: 3, scenery: SCENERY, dem: demFrom(fn) });
    for (const [x, z] of [[600, 700], [1300, -900], [-200, 300]]) expect(b.demAt(x, z).h).toBeCloseTo(a.demAt(x, z).h, 3);
  });

  describe('colour', () => {
    const road = straightRoad();
    // Gentle real ground (about 6°) with a 0.9 cut bank's triangle on top of it.
    const gentle = demFrom((x, z) => 1200 + 0.1 * z + 0.02 * x);
    const stripes = (x: number) => (x < 400 ? LandCover.meadow : x < 800 ? LandCover.rock : x < 1200 ? LandCover.forest : x < 1600 ? LandCover.cliff : LandCover.scree);
    const covered = new ChunkBuilder(new TerrainField({ ...road, seed: 5, scenery: SCENERY, dem: gentle, cover: coverFrom((x) => stripes(x)) }), 5);
    const bare = new ChunkBuilder(new TerrainField({ ...road, seed: 5, scenery: SCENERY, dem: gentle }), 5);
    const generated = new ChunkBuilder(new TerrainField({ ...road, seed: 5, scenery: SCENERY }), 5);
    const BANK_NY = 1 / Math.hypot(1, 0.9);

    it('is rock only where the cover says rock or cliff, whatever the slope', () => {
      for (const ny of [1, 0.9, BANK_NY, 0.5, 0.3]) {
        for (const x of [200, 600, 1000, 1400, 1800]) {
          covered.faceColor(x, 1230, 300, ny, 1, 0.5);
          expect(covered.lastKind, `x ${x}, ny ${ny}`).toBe(stripes(x));
        }
      }
      // Rock and meadow at the same slope: grey against green.
      const rock = [...covered.faceColor(600, 1230, 300, 0.95, 1, 0.5)];
      const meadow = [...covered.faceColor(200, 1230, 300, 0.95, 1, 0.5)];
      expect(meadow[1] - meadow[2]).toBeGreaterThan((rock[1] - rock[2]) * 2);
    });

    it('a steep meadow is only a little darker, never grey', () => {
      const flat = [...covered.faceColor(200, 1230, 300, 1, 1, 0.5)];
      // A steep DEM under the meadow: same node class, steeper real ground.
      const steepField = new TerrainField({ ...road, seed: 5, scenery: SCENERY, dem: demFrom((_x, z) => 1200 + 0.9 * z), cover: coverFrom(() => LandCover.meadow) });
      const steep = [...new ChunkBuilder(steepField, 5).faceColor(200, 1230, 300, BANK_NY, 1, 0.5)];
      const hue = (c: number[]) => c[1] / (c[0] + c[1] + c[2]);
      expect(hue(steep)).toBeCloseTo(hue(flat), 2);
      expect(steep[1]).toBeLessThan(flat[1]);
      expect(steep[1]).toBeGreaterThan(flat[1] * 0.85);
    });

    it('a road bank is not rock unless the cover says rock', () => {
      // Points 20-30 m from the road: the cut bank, triangle normal at the 0.9 pitch.
      for (const x of [200, 1000]) {
        covered.faceColor(x, 1215, 24, BANK_NY, 1, 0.5);
        expect(covered.lastKind).not.toBe(LandCover.rock);
      }
      covered.faceColor(600, 1215, 24, BANK_NY, 1, 0.5);
      expect(covered.lastKind).toBe(LandCover.rock);
      // Without cover, the gentle real ground under the bank decides: not rock either.
      bare.faceColor(200, 1215, 24, BANK_NY, 1, 0.5);
      expect(bare.lastKind).toBe(0);
      // A generated road has no real ground and keeps the old rule: the bank reads as rock.
      generated.faceColor(200, 1215, 24, BANK_NY, 1, 0.5);
      expect(generated.lastKind).toBe(LandCover.rock);
    });

    it('a face gets the same class at every mesh cell size (8, 16, 32, 64 m)', () => {
      // Real ground with every steepness from flat to cliff.
      const wavy = (x: number, z: number) => 1600 + 420 * Math.sin(x / 260) * Math.cos(z / 330) + 0.15 * z;
      const cover = (x: number, z: number) => ((Math.floor(x / 140) + Math.floor(z / 170)) % 6) + 1;
      const fields = [
        new TerrainField({ ...road, seed: 9, scenery: SCENERY, dem: demFrom(wavy) }),
        new TerrainField({ ...road, seed: 9, scenery: SCENERY, dem: demFrom(wavy), cover: coverFrom(cover) }),
      ];
      for (const field of fields) {
        const b = new ChunkBuilder(field, 9);
        let rockSeen = 0;
        for (let k = 0; k < 60; k++) {
          const px = 50 + ((k * 397) % 1900);
          const pz = 320 + ((k * 211) % 700);
          const kinds = [8, 16, 32, 64].map((q) => {
            // The triangle of a q-metre cell that holds the point, with the mesh's diagonal.
            const gx = Math.floor(px / q);
            const gz = Math.floor(pz / q);
            const x0 = gx * q;
            const z0 = gz * q;
            const u = (px - x0) / q;
            const v = (pz - z0) / q;
            const h = (i: number, j: number) => field.heightAt(x0 + i * q, z0 + j * q);
            let tri: [number, number, number][];
            if ((gx + gz) & 1) tri = u + v <= 1 ? [[0, 0, h(0, 0)], [0, 1, h(0, 1)], [1, 0, h(1, 0)]] : [[1, 0, h(1, 0)], [0, 1, h(0, 1)], [1, 1, h(1, 1)]];
            else tri = u <= v ? [[0, 0, h(0, 0)], [0, 1, h(0, 1)], [1, 1, h(1, 1)]] : [[0, 0, h(0, 0)], [1, 1, h(1, 1)], [1, 0, h(1, 0)]];
            const [a, bb, c] = tri.map(([i, j, y]) => [x0 + i * q, y, z0 + j * q]);
            const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2];
            const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const faceNy = Math.abs(ny) / Math.hypot(nx, ny, nz);
            b.faceColor(px, (a[1] + bb[1] + c[1]) / 3, pz, faceNy, 1, 0.5);
            return b.lastKind;
          });
          if (kinds[0] === LandCover.rock) rockSeen++;
          expect(new Set(kinds).size, `point ${px}, ${pz}: ${kinds.join(',')}`).toBe(1);
        }
        expect(rockSeen, 'some rock to compare').toBeGreaterThan(0);
      }
    });
  });

  describe('props', () => {
    const road = straightRoad();
    // Real ground rising south of the road at 0.75 (about 37°): steep, but alpine woods grow there.
    const dem = demFrom((_x, z) => 1200 + 0.75 * Math.max(0, z));
    const stripe = (x: number, z: number) => {
      if (z < 0) return LandCover.meadow;
      if (x < 512) return LandCover.forest;
      if (x < 1024) return LandCover.scrub;
      if (x < 1300) return LandCover.rock;
      if (x < 1400) return LandCover.cliff;
      if (x < 1536) return LandCover.scree;
      if (x < 1800) return LandCover.glacier;
      return LandCover.water;
    };
    const field = new TerrainField({ ...road, seed: 11, scenery: SCENERY, dem, cover: coverFrom(stripe) });
    const builder = new ChunkBuilder(field, 11);
    const props: { x: number; y: number; z: number; scale: number; type: number }[] = [];
    for (const x0 of [0, 512, 1024, 1536]) {
      const res = builder.build({ id: 1, x0, z0: 0, size: 512, segs: 64, treeSpacing: 9, propDetail: 0, treeScale: 1 });
      for (let i = 0; i < res.props.length; i += 6) {
        props.push({ x: x0 + res.props[i], y: res.props[i + 1], z: res.props[i + 2], scale: res.props[i + 3], type: res.props[i + 5] });
      }
    }
    const nearCliff = (x: number, z: number) => [[25, 0], [-25, 0], [0, 25], [0, -25]].some(([dx, dz]) => field.coverAt(x + dx, z + dz) === LandCover.cliff);

    it('trees grow in the forest on a steep slope, and nowhere on rock, scree, cliff, glacier or water', () => {
      const trees = props.filter((p) => p.type === 0 || p.type === 1);
      const inForest = trees.filter((p) => field.coverAt(p.x, p.z) === LandCover.forest).length;
      expect(inForest).toBeGreaterThan(1000);
      for (const p of trees) expect([LandCover.forest, LandCover.meadow]).toContain(field.coverAt(p.x, p.z));
    });

    it('scrub grows low bushes, only on scrub', () => {
      const bushes = props.filter((p) => p.type === PROP_SCRUB);
      expect(bushes.length).toBeGreaterThan(500);
      for (const p of bushes) expect(field.coverAt(p.x, p.z)).toBe(LandCover.scrub);
    });

    it('boulders lie only on rock, scree and cliff, or at a cliff foot, and are seated', () => {
      const boulders = props.filter((p) => p.type === 2);
      expect(boulders.length).toBeGreaterThan(50);
      for (const p of boulders) {
        const cls = field.coverAt(p.x, p.z);
        expect([LandCover.rock, LandCover.scree, LandCover.cliff].includes(cls as 4) || nearCliff(p.x, p.z), `boulder on class ${cls}`).toBe(true);
        expect(field.roadDistance(p.x, p.z)).toBeGreaterThan(5.8 + 1.4 * p.scale - 0.01);
        const ground = field.groundMesh(p.x, p.z, 8);
        // Sunk by at least a fifth of its size, more on a slope.
        expect(p.y).toBeLessThanOrEqual(ground.y - 0.2 * p.scale + 1e-4);
      }
      // Scree, below the cliff band, gets more than plain rock.
      const per = (lo: number, hi: number) => boulders.filter((p) => p.x >= lo && p.x < hi).length / (hi - lo);
      expect(per(1400, 1536)).toBeGreaterThan(per(1024, 1300));
    });
  });

  describe('roads without cover look exactly as before', () => {
    // Chunk colours and props captured before land cover existed. A deliberate
    // change to the generated look updates these numbers.
    const cases: { name: string; route: () => Route; s: number; picks: number[][]; props: number; p: number }[] = [
      {
        name: 'alpine (generated)',
        route: () => new Route(ROUTES.find((r) => r.id === 'alpine')!),
        s: 7663973.89861929,
        picks: [
          [0.1347961276769638, 0.23072940111160278, 0.04511648416519165],
          [0.10305887460708618, 0.17961056530475616, 0.0346304327249527],
          [0.13048729300498962, 0.22180649638175964, 0.0435057133436203],
          [0.14844515919685364, 0.22837400436401367, 0.046440090984106064],
        ],
        props: 14466,
        p: 247859601.1001467,
      },
      {
        // With the treeline and snowline it had before its scenery hints were added.
        name: 'stelvio-prato (real road, no grids loaded)',
        route: () => {
          const def = realClimbRoute(REAL_CLIMB_MAP.get('stelvio-prato')!);
          return new Route({ ...def, scenery: { ...def.scenery, treeline: 2050, snowline: 2850 } });
        },
        s: 25001975.50206583,
        picks: [
          [0.3422800600528717, 0.3490237891674042, 0.1291351616382599],
          [0.2504339814186096, 0.2319052815437317, 0.1665416955947876],
          [0.3821331858634949, 0.39812812209129333, 0.11817038059234619],
          [0.2967285215854645, 0.2827840745449066, 0.17272992432117462],
        ],
        props: 804,
        p: 17093006.733493228,
      },
    ];
    for (const c of cases) {
      it(c.name, () => {
        const route = c.route();
        const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: route.def.seed, scenery: route.def.scenery });
        const b = new ChunkBuilder(field, route.def.seed);
        const i = Math.floor(route.count * 0.4);
        const x0 = Math.floor(route.x[i] / 512) * 512;
        const z0 = Math.floor(route.z[i] / 512) * 512;
        const res = b.build({ id: 1, x0, z0, size: 512, segs: 64, treeSpacing: 9, propDetail: 0, treeScale: 1 });
        let s = 0;
        for (let k = 0; k < res.colors.length; k++) s += res.colors[k] * ((k % 97) + 1);
        let p = 0;
        for (let k = 0; k < res.props.length; k++) p += res.props[k] * ((k % 89) + 1);
        expect(s).toBeCloseTo(c.s, 2);
        [0, 3001, 12345, 40001].forEach((k, n) => {
          for (let ch = 0; ch < 3; ch++) expect(res.colors[k * 3 + ch]).toBeCloseTo(c.picks[n][ch], 6);
        });
        expect(res.props.length).toBe(c.props);
        expect(p).toBeCloseTo(c.p, 1);
      });
    }
  });
});
