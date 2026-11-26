import { describe, expect, it } from 'vitest';
import { getRoute, ROUTE_DS } from '../route';
import { REAL_CLIMB_MAP } from './data';
import { hasRealRoad, realClimbRoute } from './build';
import { readTerrain } from './terrain';
import { findHairpins } from '../../world/climbs';
import { planTowns } from '../../world/scenery';
import { TerrainField } from '../../world/terrainField';

/** Reads the built terrain file from disk. The tests run in Node; the app itself fetches it. */
async function terrainBytes(file: string): Promise<ArrayBuffer> {
  const fsModule = 'node:fs';
  const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(p: URL): Uint8Array };
  const bytes = readFileSync(new URL(`../../assets/terrain/${file}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('Passo di Gavia from Ponte di Legno on its real road', () => {
  const c = REAL_CLIMB_MAP.get('gavia-ponte-di-legno')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];
  const track = def.track!;
  const origin = (track as { origin?: { lat: number; lon: number } }).origin!;
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const xz = (lat: number, lon: number) => ({
    x: rad(lon - origin.lon) * Math.cos(rad(origin.lat)) * R,
    z: -rad(lat - origin.lat) * R,
  });
  /** Closest sample on the way up, from the village to the pass. */
  const nearest = (lat: number, lon: number) => {
    const p = xz(lat, lon);
    const b = Math.floor(climb.end / ROUTE_DS);
    let d = Infinity;
    let idx = 0;
    for (let i = 0; i <= b; i++) {
      const dist = Math.hypot(route.x[i] - p.x, route.z[i] - p.z);
      if (dist < d) {
        d = dist;
        idx = i;
      }
    }
    return { d, idx, along: idx * ROUTE_DS, y: route.y[idx] };
  };

  it('uses the OpenStreetMap line of the SS 300', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(track.hairpins).toBe('up');
    expect(def.scenery.treeline).toBe(2100);
  });

  it('keeps the published start, summit and gain', () => {
    // salite.ch: 17.39 km. Through the village streets and up the SS 300 OSM measures 17.78 km.
    expect(Math.abs(climb.length - c.lengthKm * 1000) / (c.lengthKm * 1000)).toBeLessThan(0.025);
    expect(climb.start).toBe(0);
    expect(climb.startElevation).toBeCloseTo(1258, 0);
    expect(climb.summitElevation).toBeCloseTo(2621, 0);
    expect(Math.abs(climb.gain - c.gain)).toBeLessThan(8);
  });

  it('passes every mark on the salite.ch chart at its published height', () => {
    const marks = [
      { name: 'SS 300 at Via Trento', lat: 46.2640344, lon: 10.5171869, y: 1296, off: 10 },
      { name: "Sant'Apollonia", lat: 46.2966, lon: 10.5065, y: 1584, off: 30 },
      { name: 'tunnel, lower portal', lat: 46.3274032, lon: 10.48947, y: 2332, off: 10 },
      { name: 'tunnel, upper portal', lat: 46.3321316, lon: 10.4888726, y: 2377, off: 10 },
      { name: 'pass', lat: 46.3434797, lon: 10.4873336, y: 2621, off: 10 },
    ];
    let last = -1;
    for (const m of marks) {
      const p = nearest(m.lat, m.lon);
      expect(p.d, m.name).toBeLessThan(m.off);
      expect(Math.abs(p.y - m.y), m.name).toBeLessThan(3);
      expect(p.along, m.name).toBeGreaterThan(last);
      last = p.along;
    }
    // The tunnel is about half a kilometre long on both the chart and the map.
    const tunnel = nearest(46.3321316, 10.4888726).along - nearest(46.3274032, 10.48947).along;
    expect(tunnel).toBeGreaterThan(450);
    expect(tunnel).toBeLessThan(600);
  });

  it('has no ramp steeper than the published sections allow', () => {
    const a = Math.floor(climb.start / ROUTE_DS);
    const b = Math.floor(climb.end / ROUTE_DS);
    let steep = 0;
    const span = Math.round(100 / ROUTE_DS);
    for (let i = a; i + span <= b; i += 2) steep = Math.max(steep, (route.y[i + span] - route.y[i]) / (span * ROUTE_DS));
    expect(steep).toBeGreaterThan(0.11);
    expect(steep).toBeLessThan(0.135);
  });

  it('starts in Ponte di Legno and signs the sharp bends from the foot', () => {
    const town = planTowns(route).find((t) => t.name === 'Ponte di Legno')!;
    expect(town.s0).toBeLessThan(40);
    expect(town.s1).toBeLessThan(1200);
    const pins = findHairpins(route, climb);
    expect(pins.length).toBeGreaterThan(8);
    expect(pins[0].number).toBe(1);
    const along = pins.map((p) => p.idx * ROUTE_DS);
    for (let i = 1; i < along.length; i++) expect(along[i]).toBeGreaterThan(along[i - 1]);
  });

  it('draws Lago Nero and Lago Bianco off the road and the parking at the pass', () => {
    const places = track.places!;
    expect(places.lakes.map((l) => l.name)).toEqual(['Lago Nero', 'Lago Bianco']);
    const [nero, bianco] = places.lakes;
    // The water sits on the terrain grid: Lago Nero about 2,370 m, Lago Bianco about 2,603 m.
    expect(nero.level!).toBeGreaterThan(2355);
    expect(nero.level!).toBeLessThan(2396);
    expect(bianco.level!).toBeGreaterThan(2595);
    expect(bianco.level!).toBeLessThan(2612);
    expect(places.lots.map((l) => l.name)).toEqual(['Passo di Gavia']);
  });

  it('reads the mapped land cover: woods low down, open and rock near the pass', async () => {
    const t = track.terrain!;
    expect(t.cover).toBeDefined();
    expect(t.file).toBe('gavia-ponte-di-legno.bin');
    const loaded = readTerrain(await terrainBytes(t.file), t.grids, t.cover)!;
    expect(loaded.cover!.data.length).toBe(t.cover!.w * t.cover!.h);
    const field = new TerrainField({
      x: route.x,
      z: route.z,
      y: route.y,
      seed: def.seed,
      scenery: def.scenery,
      dem: loaded.grids,
      cover: loaded.cover,
    });
    // Count what grows 60 m to the side of the road, low on the climb and near the top.
    const tally = (from: number, to: number) => {
      const n: Record<string, number> = {};
      for (let i = Math.floor(from / ROUTE_DS); i < Math.floor(to / ROUTE_DS); i += 10) {
        const j = i + 1;
        const dx = route.x[j] - route.x[i];
        const dz = route.z[j] - route.z[i];
        const len = Math.hypot(dx, dz) || 1;
        for (const side of [-1, 1]) {
          const kind = field.groundCover(route.x[i] - (dz / len) * 60 * side, route.z[i] + (dx / len) * 60 * side, route.y[i]);
          n[kind] = (n[kind] ?? 0) + 1;
        }
      }
      return n;
    };
    const low = tally(5000, 10000);
    const high = tally(15500, climb.end);
    expect(low.wood ?? 0).toBeGreaterThan((low.meadow ?? 0) + (low.rock ?? 0));
    expect(high.wood ?? 0).toBe(0);
    expect((high.meadow ?? 0) + (high.rock ?? 0)).toBeGreaterThan(10);
  });

  it('turns at the pass and comes back down the same road, closing the lap', () => {
    const up = Math.floor((climb.start + 8000) / ROUTE_DS);
    let back = Infinity;
    for (let i = Math.floor(climb.end / ROUTE_DS) + 20; i < route.count; i += 2) {
      back = Math.min(back, Math.hypot(route.x[i] - route.x[up], route.z[i] - route.z[up]));
    }
    expect(back).toBeLessThan(6);
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
  });
});
