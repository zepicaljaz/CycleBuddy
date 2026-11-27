import { describe, expect, it } from 'vitest';
import { ensureAllTracks, realClimbRoute } from '../routes/real/build';
import { REAL_CLIMB_MAP } from '../routes/real/data';
import LANDMARKS from '../routes/real/landmarks.json';
import { getRoute } from '../routes/route';
import { BUILDING_CLEAR, footprintPoints, landmarkModel, landmarksFor, MAX_CUT, MAX_SHIFT, nearestIndex, planLandmarks, terracePad, WAYSIDE_CLEAR, type MappedLandmark } from './landmarks';
import { ROAD_HALF_WIDTH, TerrainField } from './terrainField';

await ensureAllTracks();

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const TRACK_IDS = Object.keys(LANDMARKS).filter((k) => Array.isArray((LANDMARKS as Record<string, unknown>)[k]));

function world(id: string) {
  const route = getRoute(realClimbRoute(REAL_CLIMB_MAP.get(id)!));
  const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: route.def.seed, scenery: route.def.scenery, places: route.def.track?.places });
  return { route, field };
}

describe('mapped landmarks data', () => {
  it('has a source line and the Russian Chapel on Vršič', () => {
    expect(String((LANDMARKS as Record<string, unknown>).source)).toMatch(/OpenStreetMap/);
    const chapel = landmarksFor('vrsic-kranjska-gora').find((l) => l.kind === 'chapel');
    expect(chapel?.name).toBe('Ruska kapelica');
    expect(chapel?.osm).toBe('way/475260112');
    expect(landmarksFor('no-such-road')).toEqual([]);
  });

  for (const id of TRACK_IDS) {
    it(`${id}: every landmark has an OSM source and its x/z is its lat/lon in the road's frame`, () => {
      const { route } = world(id);
      const origin = (route.def.track as unknown as { origin: { lat: number; lon: number } }).origin;
      const list = landmarksFor(id);
      expect(list.length).toBeGreaterThan(0);
      for (const l of list) {
        expect(l.osm, l.name).toMatch(/^(node|way)\/\d+$/);
        expect(l.name.length).toBeGreaterThan(0);
        const x = rad(l.lon - origin.lon) * Math.cos(rad(origin.lat)) * R;
        const z = -rad(l.lat - origin.lat) * R;
        expect(Math.hypot(x - l.x, z - l.z), l.name).toBeLessThan(1);
        // Huts must be next to the road; shrines and crosses at the verge.
        const max = l.kind === 'hut' ? 180 : l.kind === 'shrine' ? 30 : 250;
        expect(l.road, l.name).toBeLessThanOrEqual(max);
      }
    });
  }
});

describe('landmark placement', () => {
  const all: { id: string; l: MappedLandmark }[] = TRACK_IDS.flatMap((id) => landmarksFor(id).map((l) => ({ id, l })));

  for (const id of TRACK_IDS) {
    it(`${id}: placed near the mapped point, never on the road or verge`, () => {
      const { route, field } = world(id);
      const spots = planLandmarks(route, field);
      // The Russian Chapel and the huts must all find a place; a verge cross may be dropped
      // only where it cannot clear the road within MAX_SHIFT.
      for (const l of landmarksFor(id).filter((l) => l.kind !== 'shrine')) {
        expect(spots.some((s) => s.landmark === l), l.name).toBe(true);
      }
      for (const s of spots) {
        const l = s.landmark;
        expect(s.model).toBe(landmarkModel(l));
        expect(Math.hypot(s.x - l.x, s.z - l.z), l.name).toBeLessThanOrEqual(MAX_SHIFT[l.kind] + 0.01);
        const clear = l.kind === 'shrine' ? WAYSIDE_CLEAR : BUILDING_CLEAR;
        for (const [px, pz] of footprintPoints(s.x, s.z, s.yaw, s.d, s.w)) {
          expect(field.roadDistance(px, pz), l.name).toBeGreaterThanOrEqual(clear);
          expect(field.blocksProp(px, pz), l.name).toBe(false);
        }
        expect(Number.isFinite(s.y)).toBe(true);
        // Seated: never above its lowest ground by more than the walls reach down.
        if (l.kind !== 'shrine') expect(s.y - s.lo).toBeLessThan(0.6);
        // A terrace eases back before the verge.
        const pad = terracePad(s, field);
        if (pad) {
          const core = Math.min(...footprintPoints(s.x, s.z, s.yaw, s.d, s.w).map(([x, z]) => field.roadDistance(x, z)));
          expect(pad[11], l.name).toBeLessThanOrEqual(core - ROAD_HALF_WIDTH - 1.5 + 1e-6);
          // Never cut deeper than MAX_CUT below the highest ground.
          expect(s.hi - pad[10], l.name).toBeLessThanOrEqual(MAX_CUT + 1e-6);
        }
      }
    });
  }

  it('the Russian Chapel stands in the forest above the road, door end toward it', () => {
    const { route, field } = world('vrsic-kranjska-gora');
    const s = planLandmarks(route, field).find((p) => p.landmark.kind === 'chapel')!;
    expect(s.shift).toBe(0);
    const i = nearestIndex(route, s.x, s.z);
    const toRoadX = route.x[i] - s.x;
    const toRoadZ = route.z[i] - s.z;
    // Model +x (the porch with the door) in world terms.
    const doorX = Math.cos(s.yaw);
    const doorZ = -Math.sin(s.yaw);
    expect(doorX * toRoadX + doorZ * toRoadZ).toBeGreaterThan(0);
  });

  it('covers every kind at least once', () => {
    const kinds = new Set(all.map((a) => a.l.kind));
    expect([...kinds].sort()).toEqual(['chapel', 'hut', 'shrine']);
  });
});
