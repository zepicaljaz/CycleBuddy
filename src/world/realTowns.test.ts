// Real towns on the real roads: built from their mapped houses (src/routes/real/towns/),
// as many as OpenStreetMap has and no more, inside the real street's extent.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ensureAllTracks, realClimbRoute } from '../routes/real/build';
import { REAL_CLIMB_MAP } from '../routes/real/data';
import { splitGrids } from '../routes/real/terrain';
import { getRoute, type Route } from '../routes/route';
import type { DemGrid } from '../routes/types';
import { Props } from './props';
import { planTowns, type TownSpan } from './scenery';
import { buildSettlements, REAL_VILLAGE } from './settlement';
import { Site, styleFor } from './site';
import { TerrainField } from './terrainField';

// Name boards draw text on a canvas; Node has none. A blank texture stands in.
vi.mock('./textures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./textures')>()),
  textTexture: () => new THREE.Texture(),
}));

await ensureAllTracks();

// The project ships no Node types: node:fs comes in untyped (see propAssets.test.ts).
const FS = 'node:fs';
const fs = await import(/* @vite-ignore */ FS);
const TOWN_FILES = import.meta.glob('../routes/real/towns/*.json', { eager: true, import: 'default' }) as Record<
  string,
  { towns: { name: string; fromM: number; toM: number; osm: { all: number; houses: number; front: number } }[] }
>;
const ROADS = Object.keys(TOWN_FILES).map((p) => p.slice(p.lastIndexOf('/') + 1, -'.json'.length)).sort();

function world(id: string) {
  const route = getRoute(realClimbRoute(REAL_CLIMB_MAP.get(id)!));
  const t = route.def.track!.terrain!;
  const raw: Uint8Array = fs.readFileSync(new URL(`../assets/terrain/${t.file}`, import.meta.url));
  const u16 = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const dem: DemGrid[] = splitGrids(u16, t.grids)!.map(({ info, data }) => ({ ...info, data, scale: 0.1 }));
  const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: route.def.seed, scenery: route.def.scenery, places: route.def.track?.places, dem });
  return { route, field };
}

/** Buildings per town, built on a fresh site. */
function count(route: Route, field: TerrainField, towns: TownSpan[]): number[] {
  const site = new Site(route, field, new Props(), styleFor(route));
  const built: number[] = [];
  buildSettlements(site, towns, [], built);
  return built;
}

/** The towns as they were before the real data: the track's configured spans, generated streets. */
function configured(route: Route): TownSpan[] {
  const list = (route.def.track as unknown as { towns: { name: string; fromM: number; toM: number }[] }).towns;
  return list.map((t) => {
    const mid = (t.fromM + t.toM) / 2;
    const half = Math.max(180, t.toM - t.fromM) / 2;
    return { name: t.name, s0: Math.max(0, mid - half), s1: mid + half };
  });
}

const rows: string[] = [];

describe('real towns from OpenStreetMap', () => {
  for (const id of ROADS) {
    it(`${id}: every town is built from its mapped houses, no bigger than the real one`, () => {
      const { route, field } = world(id);
      const towns = planTowns(route);
      const file = TOWN_FILES[`../routes/real/towns/${id}.json`];
      const before = count(route, field, configured(route));
      const after = count(route, field, towns);
      file.towns.forEach((real, k) => {
        const town = towns.find((t) => t.name === real.name)!;
        expect(town, real.name).toBeDefined();
        expect(town.real, real.name).toBeDefined();
        // The street is the real one: as long as the mapped houses reach (at least 60 m).
        expect(town.s1 - town.s0, real.name).toBeCloseTo(Math.max(60, real.toM - real.fromM), -1);
        const i = towns.indexOf(town);
        // No more buildings than OpenStreetMap maps there (garages count), and most of its houses stand.
        expect(after[i], real.name).toBeLessThanOrEqual(Math.max(real.osm.all * 1.25, real.osm.all + 6));
        expect(after[i], real.name).toBeGreaterThanOrEqual(Math.floor(real.osm.houses * 0.4));
        rows.push(`| ${real.name} (${id}) | ${real.osm.all} | ${real.osm.houses} | ${before[k] ?? '–'} | ${after[i]} | ${real.osm.front < REAL_VILLAGE ? 'village' : 'town'} |`);
      });
    }, 240_000);
  }

  it('prints the table', () => {
    const table = ['| Town (road) | OSM buildings | OSM houses | in game before | after | built as |', '|---|---|---|---|---|---|', ...rows].join('\n');
    console.log(table);
    if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.TOWN_TABLE) fs.writeFileSync(new URL('../../town-table.md', import.meta.url), table);
  });
});
