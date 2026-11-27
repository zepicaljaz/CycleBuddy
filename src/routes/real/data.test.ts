import { describe, expect, it } from 'vitest';
import { getRoute, ROUTE_DS } from '../route';
import { findHairpins } from '../../world/climbs';
import { countHairpins } from './build.test';
import { ensureAllTracks, realClimbRoute, realStageRoute } from './build';
import { checkClimb, REAL_CLIMB_MAP, REAL_CLIMBS, REAL_STAGES } from './data';
import climbsJson from './climbs.json';
import stagesJson from './stages.json';
import type { RealClimb } from './types';

// Real-road tracks load on demand in the game (routes/real/build.ts); these tests build them synchronously.
await ensureAllTracks();

describe('real climb data', () => {
  it('keeps every researched climb and stage', () => {
    for (const c of climbsJson as unknown as RealClimb[]) expect(checkClimb(c), c.id).toBeNull();
    expect(REAL_CLIMBS.length).toBe(climbsJson.length);
    expect(REAL_STAGES.length).toBe(stagesJson.length);
  });

  it('builds each climb to its published length, gain and hairpin count', () => {
    for (const c of REAL_CLIMBS) {
      const route = getRoute(realClimbRoute(c));
      const climb = route.climbs.find((x) => x.id === c.id)!;
      expect(climb, c.id).toBeTruthy();
      const valley = route.def.track?.climbFromSection === 0;
      if (valley) {
        const published = route.def.sections[1].length;
        expect(Math.abs(published / 1000 - c.lengthKm) / c.lengthKm, `${c.id} published length`).toBeLessThan(0.04);
        expect(climb.length, `${c.id} includes the valley`).toBeGreaterThan(c.lengthKm * 1000);
        const bridge = Math.round(route.sectionStart[1] / ROUTE_DS);
        expect(Math.abs(route.y[bridge] - c.startElevation), `${c.id} profile start`).toBeLessThan(8);
        const profileGain = climb.summitElevation - route.y[bridge];
        expect(Math.abs(profileGain - c.gain) / c.gain, `${c.id} gain`).toBeLessThan(0.06);
      } else {
        expect(Math.abs(climb.length / 1000 - c.lengthKm) / c.lengthKm, `${c.id} length`).toBeLessThan(0.04);
        expect(Math.abs(climb.gain - c.gain) / c.gain, `${c.id} gain`).toBeLessThan(0.06);
      }
      if (c.hairpinsKnown) {
        // A real road keeps its published signs on the sharpest bends. The plain
        // turn counter also sees the finish-street corners, which are not numbered.
        const found = route.def.track?.hairpinCount ? findHairpins(route, climb).length : countHairpins(route, climb.start, climb.end);
        expect(Math.abs(found - c.hairpins), `${c.id} hairpins`).toBeLessThanOrEqual(route.def.track ? 0 : 1);
      }
    }
  });

  it('builds every stage with its finish inside the loop', () => {
    for (const s of REAL_STAGES) {
      const sr = realStageRoute(s, REAL_CLIMB_MAP);
      const route = getRoute(sr.def);
      const finish = route.sectionStart[sr.finishSection];
      expect(finish / 1000, s.id).toBeGreaterThan(s.totalKm * 0.9);
      expect(finish / 1000, s.id).toBeLessThan(s.totalKm * 1.1);
    }
  });
});
