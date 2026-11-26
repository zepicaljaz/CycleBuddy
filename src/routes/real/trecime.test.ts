import { describe, expect, it } from 'vitest';
import { getRoute, ROUTE_DS } from '../route';
import type { TrackCover } from '../types';
import { REAL_CLIMB_MAP } from './data';
import { hasRealRoad, realClimbRoute } from './build';
import { planTowns } from '../../world/scenery';
import { TerrainField, type GroundCover } from '../../world/terrainField';
import cover from '../../assets/terrain/tre-cime-misurina.cover.json';

/**
 * Tre Cime di Lavaredo from Misurina. The road height is the Veneto LiDAR survey,
 * not a published drawing, so these tests hold it to every published figure we
 * have: the Giro's 7.2 km, CyclingUp's steepest kilometre and the dip after
 * Lago d'Antorno, the 18 % ramp before the lake, and about 12 % for the last 4 km.
 */
describe('Tre Cime di Lavaredo from Misurina on its real road', () => {
  const c = REAL_CLIMB_MAP.get('tre-cime-misurina')!;
  const def = realClimbRoute(c);
  const route = getRoute(def);
  const climb = route.climbs[0];
  const origin = (def.track as { origin?: { lat: number; lon: number } }).origin!;
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const xz = (lat: number, lon: number) => ({
    x: rad(lon - origin.lon) * Math.cos(rad(origin.lat)) * R,
    z: -rad(lat - origin.lat) * R,
  });
  /** Closest sample on the way up, from Misurina to the top of the loop. */
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
  const i0 = Math.floor(climb.start / ROUTE_DS);
  const i1 = Math.floor(climb.end / ROUTE_DS);
  /** Steepest average gradient over `win` metres of the climb, in %. */
  const steepest = (win: number) => {
    const n = Math.round(win / ROUTE_DS);
    let best = -Infinity;
    for (let i = i0; i + n <= i1; i++) best = Math.max(best, ((route.y[i + n] - route.y[i]) / (n * ROUTE_DS)) * 100);
    return best;
  };

  it('uses the OpenStreetMap line, the LiDAR terrain and the Dolomite scenery', () => {
    expect(hasRealRoad(c.id)).toBe(true);
    expect(def.track?.hairpins).toBe('up');
    expect(def.scenery.biome).toBe('limestone');
    expect(def.scenery.treeline).toBe(2100);
    const grids = def.track!.terrain!.grids;
    expect(grids.map((g) => g.cell)).toEqual([10, 25, 100]);
    expect(def.track!.terrain!.cover).toBe('tre-cime-misurina.cover.json');
    expect(def.track!.source).toContain('Regione del Veneto');
    expect(def.track!.landmarks?.[0].name).toBe('Tre Cime di Lavaredo');
  });

  it('keeps the measured length, start, summit and gain', () => {
    // Giro d'Italia 2023: 7.2 km. Rifugio Auronzo: 2,320 m.
    expect(Math.abs(climb.length - 7200)).toBeLessThan(60);
    expect(climb.startElevation).toBeCloseTo(1760, -1);
    expect(climb.summitElevation).toBeCloseTo(2322, -1);
    expect(Math.abs(climb.gain - c.gain)).toBeLessThan(8);
    for (let k = 0; k < c.kmGrades.length - 1; k++) {
      const a = i0 + Math.round((k * 1000) / ROUTE_DS);
      const b = i0 + Math.round(((k + 1) * 1000) / ROUTE_DS);
      const grade = ((route.y[b] - route.y[a]) / ((b - a) * ROUTE_DS)) * 100;
      expect(Math.abs(grade - c.kmGrades[k]), `km ${k + 1}`).toBeLessThan(0.4);
    }
  });

  it('matches the published ramps, the dip and the final wall', () => {
    // CyclingUp: steepest kilometre 14.1 %, steepest 250 m 16 %.
    expect(steepest(1000)).toBeGreaterThan(13.5);
    expect(steepest(1000)).toBeLessThan(14.6);
    expect(steepest(250)).toBeGreaterThan(14.5);
    expect(steepest(250)).toBeLessThan(16.5);
    // Giro: up to 18 % in the first 1.5 km, the ramp to Lago d'Antorno.
    let ramp = -Infinity;
    const n = Math.round(20 / ROUTE_DS);
    for (let i = i0; i < i0 + Math.round(1500 / ROUTE_DS); i++) ramp = Math.max(ramp, ((route.y[i + n] - route.y[i]) / (n * ROUTE_DS)) * 100);
    expect(ramp).toBeGreaterThan(17);
    expect(ramp).toBeLessThan(21);
    // CyclingUp: the road drops 37 m after the ramp, past the toll gate.
    let peak = -Infinity;
    let drop = 0;
    for (let i = i0; i <= i1; i++) {
      peak = Math.max(peak, route.y[i]);
      drop = Math.max(drop, peak - route.y[i]);
    }
    expect(drop).toBeGreaterThan(34);
    expect(drop).toBeLessThan(45);
    // About 12 % for the last 4 km.
    const last4 = ((route.y[i1] - route.y[i1 - Math.round(4000 / ROUTE_DS)]) / 4000) * 100;
    expect(last4).toBeGreaterThan(11.4);
    expect(last4).toBeLessThan(12.4);
  });

  it('passes Lago d’Antorno and the toll gate, and finishes at Rifugio Auronzo', () => {
    const junction = nearest(46.5861176, 12.2540668);
    const antorno = nearest(46.5965, 12.2655);
    const toll = nearest(46.5998463, 12.2699725);
    const hut = nearest(46.6122183, 12.2961106);
    expect(junction.d).toBeLessThan(10);
    expect(Math.abs(junction.along - climb.start)).toBeLessThan(30);
    expect(toll.d).toBeLessThan(10);
    expect(antorno.along).toBeLessThan(toll.along);
    expect(toll.y).toBeGreaterThan(1840);
    expect(toll.y).toBeLessThan(1870);
    expect(hut.d).toBeLessThan(40);
    expect(climb.end - hut.along).toBeLessThan(60);
    const lakes = def.track!.places!.lakes;
    expect(lakes.map((l) => l.name).sort()).toEqual(["Lago d'Antorno", 'Lago di Misurina']);
    expect(lakes.find((l) => l.name === 'Lago di Misurina')!.level).toBeCloseTo(1747.6, 0);
    expect(lakes.find((l) => l.name === "Lago d'Antorno")!.level).toBeCloseTo(1867.8, 0);
    const towns = planTowns(route);
    expect(towns.find((t) => t.name === 'Misurina')!.s0).toBeLessThan(40);
  });

  it('rides the real one-way loop round the hut and comes back down the same road', () => {
    // The car-park end of the loop, after the summit.
    const m = xz(46.612755, 12.293605);
    let loop = Infinity;
    for (let i = i1; i < i1 + Math.round(600 / ROUTE_DS); i++) loop = Math.min(loop, Math.hypot(route.x[i] - m.x, route.z[i] - m.z));
    expect(loop).toBeLessThan(10);
    const up = Math.floor((climb.start + 4000) / ROUTE_DS);
    let back = Infinity;
    for (let i = i1 + 20; i < route.count; i += 2) back = Math.min(back, Math.hypot(route.x[i] - route.x[up], route.z[i] - route.z[up]));
    expect(back).toBeLessThan(6);
  });

  it('closes the lap and never jumps', () => {
    let worst = 0;
    for (let i = 0; i < route.count; i++) {
      const j = (i + 1) % route.count;
      worst = Math.max(worst, Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]));
    }
    expect(worst).toBeLessThan(2.5);
    expect(Math.max(...Array.from(route.grade, Math.abs))).toBeLessThan(0.21);
  });

  it('grows trees only in the mapped woods, with scree and rock on the towers', () => {
    const field = new TerrainField({
      x: route.x,
      z: route.z,
      y: route.y,
      seed: def.seed,
      scenery: def.scenery,
      places: { ...def.track!.places!, cover: cover as TrackCover },
    });
    const count = (south: number, north: number, west: number, east: number) => {
      const seen: Record<GroundCover, number> = { wood: 0, pasture: 0, forest: 0, scrub: 0, scree: 0, rock: 0 };
      for (let lat = south; lat <= north; lat += 0.0004) {
        for (let lon = west; lon <= east; lon += 0.0005) {
          const p = xz(lat, lon);
          seen[field.groundCover(p.x, p.z, 2000)]++;
        }
      }
      return seen;
    };
    // The towers and the scree below them.
    const towers = count(46.615, 46.621, 12.294, 12.309);
    expect(towers.forest).toBe(0);
    expect(towers.wood).toBe(0);
    expect(towers.rock + towers.scree).toBeGreaterThan((towers.rock + towers.scree + towers.pasture + towers.scrub) * 0.6);
    // Around Misurina and Antorno: mapped woods and open ground, never generated forest.
    const valley = count(46.578, 46.598, 12.24, 12.27);
    expect(valley.forest).toBe(0);
    expect(valley.wood).toBeGreaterThan(20);
    expect(valley.pasture).toBeGreaterThan(20);
  });
});
