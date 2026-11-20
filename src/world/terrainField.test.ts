import { describe, expect, it } from 'vitest';
import { ROUTES } from '../routes/definitions';
import { getRoute, ROUTE_DS, Route } from '../routes/route';
import { realClimbRoute } from '../routes/real/build';
import { REAL_CLIMB_MAP } from '../routes/real/data';
import { planTowns } from './scenery';
import { ChunkBuilder } from './terrainChunk';
import { ROAD_HALF_WIDTH, TerrainField } from './terrainField';

/** Town mask the way the world builds it, including the ride back down the same street. */
function townMask(route: Route): Uint8Array {
  const town = new Uint8Array(route.count);
  for (const span of planTowns(route)) {
    const a = Math.max(0, Math.floor((span.s0 - 24) / ROUTE_DS));
    const b = Math.min(route.count - 1, Math.ceil((span.s1 + 24) / ROUTE_DS));
    for (let i = a; i <= b; i++) town[i] = 1;
  }
  if (!route.def.track) return town;
  const cell = 16;
  const keyOf = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const cells = new Set<string>();
  for (let i = 0; i < route.count; i++) if (town[i]) cells.add(keyOf(route.x[i], route.z[i]));
  for (let i = 0; i < route.count; i++) if (!town[i] && cells.has(keyOf(route.x[i], route.z[i]))) town[i] = 1;
  return town;
}


/**
 * CPU time this test process has used, in ms. Unlike wall-clock time it does not grow when
 * other test files build worlds on the other cores at the same moment.
 */
function cpuMs(): number {
  const proc = (globalThis as { process?: { cpuUsage(): { user: number; system: number } } }).process;
  if (!proc) return performance.now();
  const { user, system } = proc.cpuUsage();
  return (user + system) / 1000;
}

describe('terrain field', () => {
  it('follows the same triangulation the grass mesh uses', () => {
    const route = new Route(ROUTES.find((r) => r.id === 'riviera')!);
    const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: route.def.seed, scenery: route.def.scenery });
    const step = 8;
    const x = route.x[40] + 3.5;
    const z = route.z[40] - 6;
    const i = Math.floor(x / step);
    const j = Math.floor(z / step);
    const x0 = i * step;
    const z0 = j * step;
    expect(field.surfaceHeight(x0, z0)).toBeCloseTo(field.heightAt(x0, z0), 6);
    const h00 = field.heightAt(x0, z0);
    const h10 = field.heightAt(x0 + step, z0);
    const h01 = field.heightAt(x0, z0 + step);
    const h11 = field.heightAt(x0 + step, z0 + step);
    const mid = ((i + j) & 1) === 0 ? (h00 + h11) / 2 : (h10 + h01) / 2;
    expect(field.surfaceHeight(x0 + step / 2, z0 + step / 2)).toBeCloseTo(mid, 5);
  });

  for (const id of ['alpine', 'cielo', 'riviera']) {
    it(`${id}: builds quickly and the road sits on the terrain`, () => {
      const route = new Route(ROUTES.find((r) => r.id === id)!);
      const c0 = cpuMs();
      const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: route.def.seed, scenery: route.def.scenery });
      const buildMs = cpuMs() - c0;

      const t1 = performance.now();
      let maxErr = 0;
      for (let i = 0; i < route.count; i += 97) {
        maxErr = Math.max(maxErr, Math.abs(field.heightAt(route.x[i], route.z[i]) - (route.y[i] - 0.3)));
        const ex = -route.tz[i];
        const ez = route.tx[i];
        for (const lat of [-3.2, 3.2]) {
          maxErr = Math.max(maxErr, Math.abs(field.heightAt(route.x[i] + ex * lat, route.z[i] + ez * lat) - (route.y[i] - 0.3)));
        }
      }
      const evals = 20000;
      for (let k = 0; k < evals; k++) field.heightAt(route.x[0] + (k % 141) * 9, route.z[0] + Math.floor(k / 141) * 9);
      const perEvalUs = ((performance.now() - t1) * 1000) / evals;
      // How often is terrain within 400 m of the road steeper than 50 degrees?
      let steep = 0;
      let total = 0;
      for (let i = 0; i < route.count; i += 211) {
        const rx = -route.tz[i];
        const rz = route.tx[i];
        for (const lat of [-400, -250, -120, -60, 60, 120, 250, 400]) {
          const x = route.x[i] + rx * lat;
          const z = route.z[i] + rz * lat;
          const h = field.heightAt(x, z);
          const slope = Math.max(Math.abs(field.heightAt(x + 8, z) - h), Math.abs(field.heightAt(x, z + 8) - h)) / 8;
          total++;
          if (slope > 1.19) steep++;
        }
      }
      const steepPct = (steep / total) * 100;
      console.log(`${id}: field ${buildMs.toFixed(0)} ms, ${perEvalUs.toFixed(2)} us/eval, road error ${maxErr.toFixed(3)} m, cliffs near road ${steepPct.toFixed(1)}%`);
      expect(steepPct).toBeLessThan(2);
      expect(maxErr).toBeLessThan(0.2);
      expect(buildMs).toBeLessThan(5000);
    });
  }

  it('puts the lake against one side of the road and leaves the other side dry', () => {
    const route = new Route(ROUTES.find((r) => r.id === 'lake')!);
    const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: route.def.seed, scenery: route.def.scenery });
    const water = route.def.scenery.waterLevel!;
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (let k = 0; k < route.count; k += 40) {
      cx += route.x[k];
      cz += route.z[k];
      n++;
    }
    cx /= n;
    cz /= n;
    expect(field.heightAt(cx, cz)).toBeLessThan(water);
    const island = field.islandCenter();
    expect(island).not.toBeNull();
    expect(field.onLake(island!.x, island!.z)).toBe(true);
    expect(field.heightAt(island!.x, island!.z)).toBeGreaterThan(water + 5);
    expect(field.roadDistance(island!.x, island!.z)).toBeGreaterThan(250);
    const fx = Math.cos(island!.yaw);
    const fz = -Math.sin(island!.yaw);
    expect(field.heightAt(island!.x + fx * 30, island!.z + fz * 30)).toBeGreaterThan(water + 4);
    expect(field.heightAt(island!.x + fx * 130, island!.z + fz * 130)).toBeLessThan(water + 1);
    expect(field.heightAt(island!.x - fx * 260, island!.z - fz * 260)).toBeLessThan(water);
    expect(route.bounds.minY).toBeGreaterThan(water + 3);
    let sided = 0;
    let samples = 0;
    let maxRoadErr = 0;
    for (let i = 0; i < route.count; i += 70) {
      maxRoadErr = Math.max(maxRoadErr, Math.abs(field.heightAt(route.x[i], route.z[i]) - (route.y[i] - 0.3)));
      const rx = -route.tz[i];
      const rz = route.tx[i];
      const left = field.heightAt(route.x[i] - rx * 48, route.z[i] - rz * 48);
      const right = field.heightAt(route.x[i] + rx * 48, route.z[i] + rz * 48);
      const leftWet = left < water;
      const rightWet = right < water;
      const drySide = leftWet ? right : left;
      if (leftWet !== rightWet && drySide > water + 1.5) sided++;
      samples++;
    }
    expect(maxRoadErr).toBeLessThan(0.2);
    expect(sided / samples).toBeGreaterThan(0.8);
  });

  it('seats trees and rocks on the slope the rider sees', () => {
    const route = new Route(ROUTES.find((r) => r.id === 'mistral')!);
    const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: route.def.seed, scenery: route.def.scenery });
    const step = 8;
    let gap = 0;
    let anchorX = route.x[0];
    let anchorZ = route.z[0];
    for (let i = 0; i < route.count; i += 30) {
      if (route.grade[i] < 0.05) continue;
      const rx = -route.tz[i];
      const rz = route.tx[i];
      for (const lat of [-36, -24, 24, 36]) {
        const x = route.x[i] + rx * lat;
        const z = route.z[i] + rz * lat;
        const lift = field.heightAt(x, z) - field.surfaceHeight(x, z, step);
        if (lift > gap) {
          gap = lift;
          anchorX = x;
          anchorZ = z;
        }
      }
    }
    // On Crest de Vent the raw sample rises inside a grid cell, above the drawn face.
    expect(gap).toBeGreaterThan(1.5);

    const x0 = Math.floor(anchorX / 512) * 512;
    const z0 = Math.floor(anchorZ / 512) * 512;
    const res = new ChunkBuilder(field, route.def.seed).build({
      id: 1,
      x0,
      z0,
      size: 512,
      segs: 64,
      treeSpacing: 9,
      propDetail: 0,
      treeScale: 1,
    });
    expect(res.props.length / 6).toBeGreaterThan(10);
    for (let i = 0; i < res.props.length; i += 6) {
      const x = x0 + res.props[i];
      const y = res.props[i + 1];
      const z = z0 + res.props[i + 2];
      const ground = field.groundMesh(x, z, step);
      const sink = Math.min(ground.slope, 1.5) * 0.35;
      const base = res.props[i + 5] === 2 ? 0.4 : 0.3;
      expect(y).toBeCloseTo(ground.y - base - sink, 2);
      expect(y).toBeLessThanOrEqual(ground.y);
    }
  });

  for (const id of ['alpe-dhuez-bourg-doisans', 'vrsic-kranjska-gora', 'stelvio-prato', 'ventoux-bedoin', 'tourmalet-luz', 'angliru-la-vega', 'galibier-valloire', 'giau-selva']) {
    it(`${id}: a hairpin bank does not cross the asphalt or drop the rail`, () => {
      const route = getRoute(realClimbRoute(REAL_CLIMB_MAP.get(id)!));
      const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: route.def.seed, scenery: route.def.scenery, town: townMask(route) });
      let overRoad = 0;
      let railGap = 0;
      let overAt = 0;
      let railAt = 0;
      let rails = 0;
      for (let i = 0; i < route.count; i += 8) {
        const rx = -route.tz[i];
        const rz = route.tx[i];
        for (const lat of [-3.7, -3.2, 3.2, 3.7]) {
          const mesh = field.groundMesh(route.x[i] + rx * lat, route.z[i] + rz * lat, 8).y;
          const over = mesh - route.y[i];
          if (over > overRoad) {
            overRoad = over;
            overAt = i * ROUTE_DS;
          }
        }
        for (const lat of [-(ROAD_HALF_WIDTH + 0.8), ROAD_HALF_WIDTH + 0.8]) {
          const x = route.x[i] + rx * lat;
          const z = route.z[i] + rz * lat;
          const x2 = x + rx * Math.sign(lat);
          const z2 = z + rz * Math.sign(lat);
          const drop = (px: number, pz: number) => route.y[i] - field.heightAt(px, pz);
          // Same omissions as the rail builder: on the other carriageway, or on the lip above it.
          if (field.roadDistance(x, z) < ROAD_HALF_WIDTH + 0.4) continue;
          if (drop(x, z) > 1.2 || drop(x2, z2) > 1.2) continue;
          rails++;
          const mesh = field.groundMesh(x, z, 8).y;
          const gap = route.y[i] - mesh;
          if (gap > railGap) {
            railGap = gap;
            railAt = i * ROUTE_DS;
          }
        }
      }
      expect(rails, 'rails actually checked').toBeGreaterThan(80);
      expect(overRoad, `slope on the road at ${overAt} m`).toBeLessThan(0.15);
      expect(railGap, `rail above the ground at ${railAt} m`).toBeLessThan(1.2);
    });

    it(`${id}: the bank between hairpin legs is a slope that follows the road`, () => {
      const route = getRoute(realClimbRoute(REAL_CLIMB_MAP.get(id)!));
      const field = new TerrainField({ x: route.x, z: route.z, y: route.y, seed: route.def.seed, scenery: route.def.scenery });
      const otherAt = (i: number) => {
        let best = -1;
        let bestD = 46;
        for (let j = 0; j < route.count; j += 2) {
          let along = Math.abs(j - i);
          if (along > route.count / 2) along = route.count - along;
          if (along < 20) continue;
          const dy = route.y[j] - route.y[i];
          if (Math.abs(dy) < 6) continue;
          const d = Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]);
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        }
        return best < 0 ? null : { j: best, d: bestD, dy: route.y[best] - route.y[i] };
      };

      let banks = 0;
      for (let i = 0; i < route.count && banks < 3; i += 16) {
        const o = otherAt(i);
        if (!o || o.d < 18 || o.d > 42) continue;
        for (const side of [-1, 1]) {
          const rx = -route.tz[i] * side;
          const rz = route.tx[i] * side;
          const ys: number[] = [];
          let prevD = 0;
          for (let t = 4; t <= 34; t += 1) {
            const x = route.x[i] + rx * t;
            const z = route.z[i] + rz * t;
            const rd = field.roadDistance(x, z);
            // The next carriageway is where the distance to a road starts falling.
            if (t > 6 && rd < prevD - 0.4) break;
            prevD = rd;
            ys.push(field.groundMesh(x, z, 8).y);
          }
          if (ys.length < 10) continue;
          const rise = ys[ys.length - 1] - ys[0];
          if (rise < 5) continue;
          let stepMax = 0;
          for (let k = 1; k < ys.length; k++) stepMax = Math.max(stepMax, ys[k] - ys[k - 1]);
          const lo = ys[0] + rise * 0.2;
          const hi = ys[0] + rise * 0.8;
          let a = -1;
          let b = -1;
          for (let k = 0; k < ys.length; k++) {
            if (a < 0 && ys[k] >= lo) a = k;
            if (ys[k] >= hi) b = k;
          }
          // A vertical face would put most of this rise into one metre. The crest of a
          // slope this wide follows the road; a grid step cannot. A tight stack can
          // pack the middle of the slope into a few metres and still not be a wall.
          expect(stepMax, `cliff beside the road at ${i * ROUTE_DS} m`).toBeLessThan(Math.max(3.6, rise * 0.28));
          expect(b - a, `bank is a wall at ${i * ROUTE_DS} m`).toBeGreaterThan(2);
          banks++;
          break;
        }
      }
      expect(banks, 'a hairpin bank to measure').toBeGreaterThan(0);
    });
  }
});
