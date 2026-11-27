// Checks that the Krvavec road (feature/krvavec-plaza) and the land-cover and
// map-zoom work (feature/map-zoom-angliru-cover) fit together once both are on main.
import { describe, expect, it, vi } from 'vitest';
import type { RideSession } from '../../game/session';
import { Minimap } from '../../ui/minimap';
import { ChunkBuilder } from '../../world/terrainChunk';
import { TerrainField } from '../../world/terrainField';
import { getRoute, ROUTE_DS } from '../route';
import { ensureAllTracks, hasRealRoad, realClimbRoute } from './build';
import { REAL_CLIMB_MAP, REAL_CLIMBS } from './data';

// Real-road tracks load on demand in the game (routes/real/build.ts); these tests build them synchronously.
await ensureAllTracks();

function fieldFor(id: string) {
  const c = REAL_CLIMB_MAP.get(id)!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const field = new TerrainField({
    x: route.x,
    z: route.z,
    y: route.y,
    seed: def.seed,
    scenery: def.scenery,
    places: def.track?.places,
  });
  return { c, def, route, field };
}

/** A point beside the road at a road sample, with the ground height there. */
function beside(f: ReturnType<typeof fieldFor>, i: number, metres: number) {
  const { route, field } = f;
  const dx = route.x[i + 1] - route.x[i - 1];
  const dz = route.z[i + 1] - route.z[i - 1];
  const len = Math.hypot(dx, dz) || 1;
  const x = route.x[i] + (-dz / len) * metres;
  const z = route.z[i] + (dx / len) * metres;
  return { x, z, h: field.heightAt(x, z) };
}

function treesNear(f: ReturnType<typeof fieldFor>, i: number) {
  const chunk = new ChunkBuilder(f.field, f.def.seed).build({
    id: 1,
    x0: f.route.x[i] - 40,
    z0: f.route.z[i] - 40,
    size: 80,
    segs: 6,
    treeSpacing: 9,
    propDetail: 1,
    treeScale: 1,
  });
  let trees = 0;
  for (let k = 5; k < chunk.props.length; k += 6) if (chunk.props[k] < 2) trees++;
  return trees;
}

describe('Krvavec with the land-cover code', () => {
  const f = fieldFor('krvavec-cerklje');
  const climb = f.route.climbs[0];

  it('passes its pastureAbove line through to the scenery', () => {
    expect(hasRealRoad('krvavec-cerklje')).toBe(true);
    expect(f.c.pastureAbove).toBe(1400);
    expect(f.def.scenery.pastureAbove).toBe(1400);
    expect(f.def.scenery.openAlong).toBeUndefined();
    expect(f.def.track?.places?.cover).toBeUndefined();
  });

  it('keeps the ground above 1,400 m open and the forest below it', () => {
    const iStart = Math.floor(climb.start / ROUTE_DS);
    const iEnd = Math.floor(climb.end / ROUTE_DS);
    let high = 0;
    let low = 0;
    for (let i = iStart + 4; i < iEnd - 4; i += 25) {
      for (const metres of [20, -20]) {
        const p = beside(f, i, metres);
        const cover = f.field.groundCover(p.x, p.z, p.h);
        if (p.h >= 1400) {
          expect(cover, `${(i * ROUTE_DS).toFixed(0)} m, ${p.h.toFixed(0)} m high`).toBe('pasture');
          high++;
        } else {
          expect(cover, `${(i * ROUTE_DS).toFixed(0)} m, ${p.h.toFixed(0)} m high`).toBe('forest');
          low++;
        }
      }
    }
    expect(high).toBeGreaterThan(10);
    expect(low).toBeGreaterThan(50);
  });

  it('grows no trees on the Jezerca pastures', () => {
    const iEnd = Math.floor(climb.end / ROUTE_DS);
    let i = Math.floor(climb.start / ROUTE_DS);
    while (i < iEnd && f.route.y[i] < 1470) i++;
    expect(f.route.y[i]).toBeGreaterThan(1470);
    expect(treesNear(f, i)).toBe(0);
  });
});

describe('Angliru with Krvavec on main', () => {
  it('keeps its open kilometre at Viapará and its mapped cover', () => {
    const f = fieldFor('angliru-la-vega');
    expect(f.def.scenery.openAlong).toEqual([{ fromM: 5000, toM: 6000, radius: 80 }]);
    expect(f.def.scenery.pastureAbove).toBeUndefined();
    const climb = f.route.climbs[0];
    const at = (m: number) => Math.floor((climb.start + m) / ROUTE_DS);
    const open = beside(f, at(5500), 16);
    expect(f.field.groundCover(open.x, open.z, open.h)).toBe('pasture');
    const wooded = beside(f, at(7500), 20);
    expect(f.field.groundCover(wooded.x, wooded.z, wooded.h)).toBe('forest');
  });
});

describe('every real road after the merge', () => {
  it('builds a terrain field, and roads without land-cover settings stay all forest', () => {
    for (const c of REAL_CLIMBS) {
      if (!hasRealRoad(c.id)) continue;
      const f = fieldFor(c.id);
      const sc = f.def.scenery;
      const plain = sc.pastureAbove == null && !sc.openAlong?.length && !f.def.track?.places?.cover;
      if (!plain) continue;
      for (let i = 10; i < f.route.count - 10; i += 200) {
        const p = beside(f, i, 25);
        expect(f.field.groundCover(p.x, p.z, p.h), c.id).toBe('forest');
      }
    }
  });
});

describe('map zoom on the Krvavec road', () => {
  it('cycles nearby, wider and full loop with the rider on the plate', () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const dots: { x: number; y: number }[] = [];
    let strokes = 0;
    const ctx = {
      lineJoin: '',
      lineCap: '',
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
      globalAlpha: 1,
      setTransform() {},
      clearRect() {
        dots.length = 0;
        strokes = 0;
      },
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {
        strokes += 1;
      },
      save() {},
      restore() {},
      translate(x: number, y: number) {
        dots.push({ x, y });
      },
      rotate() {},
      fill() {},
      arc() {},
      closePath() {},
      drawImage() {},
    };
    const g = globalThis as { window?: { devicePixelRatio: number } };
    g.window ??= { devicePixelRatio: 1 };
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    const canvas = { width: 0, height: 0, clientWidth: 420, clientHeight: 130, getContext: () => ctx };
    const route = getRoute(realClimbRoute(REAL_CLIMB_MAP.get('krvavec-cerklje')!));
    const climb = route.climbs[0];
    const session = {
      route,
      player: { s: climb.start + climb.length * 0.6, direction: 1, lat: 0 },
      config: { mode: 'free' },
      sim: { facingAngle: () => 0, racers: [] },
    } as unknown as RideSession;
    const map = new Minimap(canvas as unknown as HTMLCanvasElement);
    const onPlate = () => {
      const dot = dots[dots.length - 1];
      expect(dot).toBeTruthy();
      expect(dot.x).toBeGreaterThan(-24);
      expect(dot.x).toBeLessThan(444);
      expect(dot.y).toBeGreaterThan(-24);
      expect(dot.y).toBeLessThan(154);
      expect(strokes).toBeGreaterThan(4);
    };
    map.draw(session);
    expect(map.current()).toBe('ahead');
    onPlate();
    for (const mode of ['wide', 'loop', 'ahead'] as const) {
      map.toggle();
      map.draw(session);
      now += 700;
      map.draw(session);
      expect(map.current()).toBe(mode);
      onPlate();
    }
    clock.mockRestore();
    vi.unstubAllGlobals();
  });
});
