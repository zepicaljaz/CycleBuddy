// The Free ride list sorts and shows real roads from trackIndex.json before their tracks
// are fetched. This keeps the index equal to what the tracks build. After adding or
// rebuilding a track: `npm run track-index` (sets UPDATE_TRACK_INDEX=1, which rewrites the file).
import { describe, expect, it } from 'vitest';
import { getRoute } from '../route';
import {
  allTracksReady, ensureAllTracks, ensureTrack, hasRealRoad, realClimbRoute, realRoadClimbs, realRoadStats, trackReady, type TrackIndexRow,
} from './build';
import { REAL_CLIMB_MAP } from './data';

// The project ships no Node types: node:fs comes in untyped (see propAssets.test.ts).
const FS = 'node:fs';
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const TRACK_IDS = Object.keys(import.meta.glob('./tracks/*.json')).map((p) => p.slice(p.lastIndexOf('/') + 1, -'.json'.length)).sort();

describe('lazy real-road tracks', () => {
  it('knows every road from the file names alone, and builds none before it is fetched', async () => {
    expect(TRACK_IDS.length).toBeGreaterThan(0);
    for (const id of TRACK_IDS) expect(hasRealRoad(id)).toBe(true);
    expect(realRoadClimbs().map((c) => c.id).sort()).toEqual(TRACK_IDS.filter((id) => REAL_CLIMB_MAP.has(id)));
    const id = TRACK_IDS[0];
    const climb = REAL_CLIMB_MAP.get(id)!;
    expect(trackReady(id)).toBe(false);
    // Building it early would cache a generated road under the real road's id.
    expect(() => realClimbRoute(climb)).toThrow(/not loaded/);
    await ensureTrack(id);
    expect(trackReady(id)).toBe(true);
    expect((realClimbRoute(climb).track as { id?: string } | undefined)?.id).toBe(id);
  });

  it('index matches the tracks (run `npm run track-index` after adding or rebuilding one)', async () => {
    await ensureAllTracks();
    expect(allTracksReady()).toBe(true);
    const fresh: Record<string, TrackIndexRow> = {};
    for (const id of TRACK_IDS) {
      const climb = REAL_CLIMB_MAP.get(id);
      if (!climb) continue;
      const route = getRoute(realClimbRoute(climb));
      fresh[id] = { length: route.length, ascent: route.totalAscent };
    }
    if (env.UPDATE_TRACK_INDEX) {
      const fs = await import(/* @vite-ignore */ FS);
      const body = Object.entries(fresh).map(([id, row]) => `  ${JSON.stringify(id)}: ${JSON.stringify(row)}`).join(',\n');
      fs.writeFileSync(new URL('./trackIndex.json', import.meta.url), `{\n${body}\n}\n`);
      return;
    }
    for (const id of Object.keys(fresh)) expect(realRoadStats(id), id).toEqual(fresh[id]);
    // No rows for roads that are gone.
    for (const climb of realRoadClimbs()) expect(realRoadStats(climb.id), climb.id).toBeDefined();
  });
});
