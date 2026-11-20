import { describe, expect, it } from 'vitest';
import { FREE_RIDE_RISE, climbHighlightSpans, freeRideProfileSpan } from '../ui/profileChart';
import { planTowns } from '../world/scenery';
import { ROUTES } from './definitions';
import { RIDE_REGIONS } from './regions';
import { estimateLap, estimateTime } from '../game/estimates';
import { Route, ROUTE_DS, riddenClimbs, routeStarts } from './route';

describe('routes', () => {
  for (const def of ROUTES) {
    describe(def.id, () => {
      const route = new Route(def);

      it('has a sensible loop length', () => {
        expect(route.length).toBeGreaterThan(12_000);
        expect(route.length).toBeLessThan(90_000);
      });

      it('closes the loop in position and elevation', () => {
        const last = route.count - 1;
        expect(Math.hypot(route.x[last] - route.x[0], route.z[last] - route.z[0])).toBeLessThan(ROUTE_DS * 2);
        const endElevation = route.y[last] + route.grade[last] * ROUTE_DS;
        expect(Math.abs(endElevation - route.y[0])).toBeLessThan(1);
      });

      it('stays within trainer gradient limits', () => {
        for (let i = 0; i < route.count; i++) expect(Math.abs(route.grade[i])).toBeLessThan(0.16);
      });

      it('has climbs matching their real-world inspiration', () => {
        for (const c of route.climbs) {
          const designed = def.climbs.find((d) => d.id === c.id)!;
          let len = 0;
          for (let s = designed.fromSection; s <= designed.toSection; s++) len += def.sections[s].length;
          expect(Math.abs(c.length - len) / len).toBeLessThan(0.06);
          expect(c.avgGrade).toBeGreaterThan(0.03);
        }
      });

      it('starts at the bottom or the top of a climb', () => {
        const starts = routeStarts(route);
        expect(starts).toHaveLength(5);
        expect(starts[0]).toEqual({ name: 'Kilometre 0', s: 0 });
        expect(new Set(starts.map((s) => s.name)).size).toBe(5);
        for (let i = 0; i < starts.length; i++) {
          const st = starts[i];
          const next = starts[(i + 1) % starts.length];
          const gap = (next.s - st.s + route.length) % route.length;
          expect(gap, st.name).toBeGreaterThanOrEqual(1200);
          if (st.s === 0) continue;
          const behind = route.elevationAt(st.s) - route.elevationAt(st.s - 450);
          const ahead = route.elevationAt(st.s + 450) - route.elevationAt(st.s);
          const midClimb = behind > 12 && ahead > 12;
          const midDescent = behind < -12 && ahead < -12;
          expect(midClimb || midDescent, `${st.name} at ${Math.round(st.s)} m is mid-slope (behind ${behind.toFixed(0)} m, ahead ${ahead.toFixed(0)} m)`).toBe(false);
          expect(st.name).toMatch(/Below|Top of/);
        }
      });

      it('can be ridden the other way', () => {
        expect(riddenClimbs(route)).toBe(route.climbs);
        const back = riddenClimbs(route, true);
        expect(back.map((c) => c.id).sort()).toEqual(route.climbs.map((c) => c.id).sort());
        for (const c of back) {
          const forward = route.climbs.find((f) => f.id === c.id && Math.abs(f.end - c.start) < 1)!;
          expect(c.avgGrade).toBe(-forward.avgGrade);
          expect(c.maxGrade).toBe(-forward.maxGrade);
          expect(c.length).toBe(forward.length);
          expect(c.end).toBe(forward.start);
        }
        for (let i = 1; i < back.length; i++) expect(back[i - 1].start).toBeGreaterThanOrEqual(back[i].start);
        const forwardLap = estimateLap(route, 230, 72, 0.72);
        const reverseLap = estimateLap(route, 230, 72, 0.72, true);
        expect(forwardLap).toBeCloseTo(estimateTime(route, 0, route.length, 230, 72, 0.72), 4);
        expect(reverseLap).toBeGreaterThan(forwardLap * 0.25);
        expect(reverseLap).toBeLessThan(forwardLap * 4);
      });

      it('highlights the uphill of a reversed lap', () => {
        expect(climbHighlightSpans(route, false)).toEqual(route.climbs.map((c) => ({ start: c.start, end: c.end })));
        for (const span of climbHighlightSpans(route, true)) {
          expect(span.end).toBeGreaterThan(span.start);
          expect(route.elevationAt(span.start) - route.elevationAt(span.end)).toBeGreaterThan(30);
          for (const climb of route.climbs) {
            const overlap = Math.max(0, Math.min(span.end, climb.end) - Math.max(span.start, climb.start));
            expect(overlap / (span.end - span.start)).toBeLessThan(0.35);
          }
        }
      });

      it('does not fold the road over itself', () => {
        const turn = (i: number, j: number) => {
          let d = Math.atan2(route.tz[j], route.tx[j]) - Math.atan2(route.tz[i], route.tx[i]);
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          return Math.abs(d);
        };
        for (let i = 0; i < route.count; i++) {
          const j = (i + 2) % route.count;
          // A real hairpin is about 18° over 4 m. A fold is a near-reversal.
          expect(turn(i, j), `${def.id} folds at ${(i * ROUTE_DS).toFixed(0)} m`).toBeLessThan(0.75);
        }
      });

      it('never crosses or touches itself', () => {
        const cell = 40;
        const grid = new Map<string, number[]>();
        const step = 5;
        for (let i = 0; i < route.count; i += step) {
          const key = `${Math.floor(route.x[i] / cell)},${Math.floor(route.z[i] / cell)}`;
          const arr = grid.get(key) ?? [];
          arr.push(i);
          grid.set(key, arr);
        }
        let minDist = Infinity;
        for (let i = 0; i < route.count; i += step) {
          const cx = Math.floor(route.x[i] / cell);
          const cz = Math.floor(route.z[i] / cell);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              for (const j of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
                const along = Math.min(Math.abs(i - j), route.count - Math.abs(i - j)) * ROUTE_DS;
                if (along < 120) continue;
                minDist = Math.min(minDist, Math.hypot(route.x[i] - route.x[j], route.z[i] - route.z[j]));
              }
            }
          }
        }
        expect(minDist, `${def.id} roads come within ${minDist.toFixed(1)} m`).toBeGreaterThan(16);
      });
    });
  }

  it('keeps every road above the water', () => {
    for (const def of ROUTES) {
      const water = def.scenery.waterLevel;
      if (water === null) continue;
      const route = new Route(def);
      expect(route.bounds.minY, def.id).toBeGreaterThanOrEqual(water + 3.5 - 1e-4);
    }
  });

  it('draws every free-ride profile at the same elevation ratio', () => {
    for (const def of ROUTES) {
      const route = new Route(def);
      const range = route.bounds.maxY - route.bounds.minY;
      const span = freeRideProfileSpan(route.length, range);
      expect(span / route.length, def.id).toBeCloseTo(FREE_RIDE_RISE, 5);
      expect(range, def.id).toBeLessThan(span * 0.96);
    }
  });

  it('keeps the plain loops almost level, with only a little climbing', () => {
    // Some free-ride loops are badged flat and still have short climbs. These four are the ones built to stay near 1%.
    const plains = new Set(['riviera', 'lake', 'dunes', 'lowlands']);
    for (const def of ROUTES.filter((r) => plains.has(r.id))) {
      const route = new Route(def);
      let over = 0;
      for (let i = 0; i < route.count; i++) if (Math.abs(route.grade[i]) > 0.012) over++;
      expect(over / route.count, `${def.id} spends too much of the lap steeper than about 1%`).toBeLessThan(0.22);
      if (def.id === 'riviera' || def.id === 'dunes') {
        expect(route.totalAscent, def.id).toBeGreaterThan(100);
        expect(route.totalAscent, def.id).toBeLessThan(200);
      }
    }
  });

  it('does not hop a rider along a bend', () => {
    const lateral = 2.2;
    const ds = 0.01;
    let worst = 0;
    let where = '';
    for (const def of ROUTES) {
      const route = new Route(def);
      for (let i = 0; i < route.count; i++) {
        const s = i * ROUTE_DS;
        const a = route.place(s - ds, lateral);
        const ax = a.x;
        const az = a.z;
        const b = route.place(s + ds, lateral);
        const jump = Math.hypot(b.x - ax, b.z - az);
        if (jump > worst) {
          worst = jump;
          where = def.id;
        }
      }
    }
    // About 2 cm of road, plus the heading change on the tightest bend.
    // The old sample-index offset hopped several centimetres at every corner.
    expect(worst, where).toBeLessThan(0.04);
  });

  it('recreates the Larch Valley lap', () => {
    const def = ROUTES.find((r) => r.id === 'larch')!;
    const route = new Route(def);
    expect(route.length / 1000).toBeGreaterThan(42);
    expect(route.length / 1000).toBeLessThan(45);
    const climb = route.climbs[0];
    expect(climb.name).toBe('Larch Hill');
    expect(Math.abs(climb.length - 4270) / 4270).toBeLessThan(0.04);
    expect(climb.avgGrade).toBeGreaterThan(0.072);
    expect(climb.avgGrade).toBeLessThan(0.082);
    expect(climb.gain).toBeGreaterThan(300);
    expect(climb.gain).toBeLessThan(350);
    const bottom = (route.elevationAt(climb.start + 800) - route.elevationAt(climb.start)) / 800;
    const top = (route.elevationAt(climb.end) - route.elevationAt(climb.end - 800)) / 800;
    expect(bottom).toBeGreaterThan(0.09);
    expect(bottom).toBeGreaterThan(top);
    const steep = (route.elevationAt(climb.end + 900) - route.elevationAt(climb.end)) / 900;
    expect(steep).toBeLessThan(-0.11);
    const back = route.length - climb.end;
    const avg = (route.elevationAt(0) - route.elevationAt(climb.end)) / back;
    expect(avg).toBeLessThan(-0.035);
    expect(avg).toBeGreaterThan(-0.05);
    const towns = planTowns(route);
    expect(towns.map((t) => t.name)).toEqual(['Holm', 'Bren', 'Millcross', 'High Lea']);
    const holm = towns[0].s1 - towns[0].s0;
    expect(holm).toBeGreaterThan(190);
    expect(holm).toBeLessThan(280);
    expect(holm).toBeGreaterThan(towns[1].s1 - towns[1].s0);
    expect(towns[2].s1).toBeLessThan(climb.start);
    expect(towns[3].s0).toBeGreaterThan(climb.end);
  });

  it('puts a small town about 500 m into each Twin Col', () => {
    const route = new Route(ROUTES.find((r) => r.id === 'twins')!);
    const towns = planTowns(route);
    const nord = route.climbs.find((c) => c.id === 'twins-nord')!;
    const sud = route.climbs.find((c) => c.id === 'twins-sud')!;
    const villard = towns.find((t) => t.name === 'Villard')!;
    const saix = towns.find((t) => t.name === 'Le Saix')!;
    expect((villard.s0 + villard.s1) / 2 - nord.start).toBeGreaterThan(420);
    expect((villard.s0 + villard.s1) / 2 - nord.start).toBeLessThan(620);
    expect(villard.s0).toBeGreaterThan(nord.start);
    expect(villard.s1).toBeLessThan(nord.end - 2000);
    expect(saix.s0 - sud.start).toBeGreaterThan(420);
    expect(saix.s0 - sud.start).toBeLessThan(620);
    expect(saix.s1).toBeLessThan(sud.start + 900);
    expect(saix.s1).toBeLessThan(sud.end - 2000);
    expect(villard.s1 - villard.s0).toBeLessThan(200);
    expect(saix.s1 - saix.s0).toBeLessThan(220);
    expect(towns.filter((t) => t.name !== 'Villard' && t.name !== 'Le Saix').length).toBeGreaterThanOrEqual(2);
  });

  it('puts a small town at 5, 10 and 15 km on Passo del Cielo', () => {
    const route = new Route(ROUTES.find((r) => r.id === 'cielo')!);
    const climb = route.climbs.find((c) => c.id === 'cielo-passo')!;
    const towns = planTowns(route);
    const spots = [
      ['San Giacomo', 5],
      ['Pianaccio', 10],
      ['Le Prese', 15],
    ] as const;
    for (const [name, km] of spots) {
      const town = towns.find((t) => t.name === name)!;
      const mid = (town.s0 + town.s1) / 2;
      expect(mid - climb.start).toBeGreaterThan(km * 1000 - 40);
      expect(mid - climb.start).toBeLessThan(km * 1000 + 40);
      expect(town.s0).toBeGreaterThan(climb.start + 1000);
      expect(town.s1).toBeLessThan(climb.end - 6000);
      expect(town.s1 - town.s0).toBeLessThan(170);
    }
    expect(towns.some((t) => t.s1 < climb.start)).toBe(true);
  });

  it('prints a summary', () => {
    for (const def of ROUTES) {
      const r = new Route(def);
      const climbs = r.climbs
        .map((c) => `${c.name}: ${(c.length / 1000).toFixed(1)} km @ ${(c.avgGrade * 100).toFixed(1)}% (+${c.gain.toFixed(0)} m, max ${(c.maxGrade * 100).toFixed(1)}%)`)
        .join('; ');
      console.log(
        `${def.id}: ${(r.length / 1000).toFixed(1)} km, +${r.totalAscent.toFixed(0)} m, size ${((r.bounds.maxX - r.bounds.minX) / 1000).toFixed(1)}x${((r.bounds.maxZ - r.bounds.minZ) / 1000).toFixed(1)} km | ${climbs}`,
      );
    }
  });
});

describe('free-ride worlds', () => {
  it('puts every loop in exactly one world', () => {
    const seen = new Map<string, string>();
    for (const region of RIDE_REGIONS) {
      expect(region.routes.length).toBeGreaterThan(0);
      expect(region.routes).toContain(region.cover);
      for (const id of region.routes) {
        expect(seen.has(id), `${id} is also in ${seen.get(id)}`).toBe(false);
        seen.set(id, region.id);
      }
    }
    for (const def of ROUTES) expect(seen.has(def.id), def.id).toBe(true);
    expect(seen.size).toBe(ROUTES.length);
  });
});
