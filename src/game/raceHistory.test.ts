import { describe, expect, it } from 'vitest';
import type { ClimbEffort, HillClimbRecord, RideSample, RideSummary } from '../storage/types';
import { raceBlocks, raceDetailHtml, raceListHtml, raceRows, type ClimbFacts } from './raceHistory';
import { RideSession } from './session';
import { getRouteDef } from '../routes/definitions';
import { Route } from '../routes/route';
import { DEFAULT_COLORS } from '../world/riders';
import type { Profile } from '../storage/types';

const BROKEN = /\bundefined\b|\bNaN\b|\[object Object\]|\bInfinity\b/;
const CLIMB: ClimbFacts = { name: 'Vršič', lengthM: 10_600, gainM: 800, avgGrade: 0.075 };

function ride(id: string, extra: Partial<RideSummary> = {}): RideSummary {
  return {
    id,
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-20T09:00:00.000Z',
    startedAt: '2026-11-20T08:00:00.000Z',
    mode: 'race',
    routeId: 'vrsic',
    routeName: 'Vršič',
    climbId: 'vrsic',
    title: 'Hill-climb race: Vršič',
    durationSec: 2400,
    movingSec: 2390,
    distanceM: 10_600,
    ascentM: 800,
    avgPower: 240,
    maxPower: 610,
    normalizedPower: 248,
    avgCadence: 84,
    avgHeartRate: 0,
    maxHeartRate: 0,
    avgSpeedKmh: 15.9,
    race: { position: 12, field: 76, finishTimeSec: 2400, winnerTimeSec: 2060 },
    hasFit: false,
    ...extra,
  };
}

const HILL: HillClimbRecord = {
  climbName: 'Vršič', lengthM: 10_600, gainM: 800, avgGrade: 0.075, weightKg: 75, ftp: 260, aiCount: 2, topWkg: 5, bottomWkg: 1,
  results: [
    { name: 'T. Novarik', country: 'SLO', timeSec: 2060, wkg: 5, drop: 0 },
    { name: 'Me <b>', country: '', timeSec: 2400, wkg: 3.2, drop: 0, player: true },
    { name: 'J. Vinter', country: 'DEN', timeSec: 2500, wkg: 4.1, drop: 0.29 },
  ],
};

/** Five minutes: 200 W, then 260 W, then a last minute at 300 W. */
const SAMPLES: RideSample[] = Array.from({ length: 300 }, (_, t) => ({
  t, power: t < 120 ? 200 : t < 240 ? 260 : 300, cadence: 85, heartRate: 0, speed: 4, distance: t * 4, altitude: 600 + t * 0.3, grade: 0.075,
}));

describe('your Hill climb races', () => {
  it('lists only Hill climb races, newest first', () => {
    const rows = raceRows(
      [
        ride('old'),
        ride('free', { mode: 'free', title: 'Free ride: Alps', race: undefined }),
        ride('career', { title: 'Tour of Slovenia · Stage 2' }),
        ride('new', { startedAt: '2026-11-25T08:00:00.000Z' }),
      ],
      [],
      () => CLIMB,
    );
    expect(rows.map((r) => r.ride.id)).toEqual(['new', 'old']);
  });

  it('shows an older race with what was saved, and takes weight only from that day', () => {
    const effort: ClimbEffort = { id: 'e', climbId: 'vrsic', climbName: 'Vršič', rideId: 'a', createdAt: '', timeSec: 2400, avgPower: 240, wkg: 3.2 };
    const [row] = raceRows([ride('a')], [effort], () => CLIMB);
    expect(row.timeSec).toBe(2400);
    expect(row.position).toBe(12);
    expect(row.gapSec).toBe(340);
    expect(row.weightKg).toBeCloseTo(75);
    expect(row.wkg).toBeCloseTo(3.2);
    expect(raceRows([ride('a')], [], () => CLIMB)[0].wkg).toBeNull();
    const html = raceDetailHtml(row, SAMPLES, 260);
    expect(html).toContain('were not saved for this race');
    expect(html).not.toMatch(BROKEN);
  });

  it('does not call a race finished when you left it short of the top', () => {
    const [row] = raceRows([ride('quit', { distanceM: 4000 })], [], () => CLIMB);
    expect(row.finished).toBe(false);
    expect(row.timeSec).toBeNull();
    expect(row.position).toBeNull();
    expect(raceListHtml([row])).toContain('DNF');
  });

  it('shows the AI settings and finishing order of a saved race', () => {
    const rows = raceRows([ride('a', { race: { position: 2, field: 3, finishTimeSec: 2400, winnerTimeSec: 2060, hill: HILL } })], [], () => null);
    expect(rows[0].wkg).toBeCloseTo(3.2);
    expect(raceListHtml(rows)).toContain('5.0–1.0');
    const html = raceDetailHtml(rows[0], SAMPLES, 260);
    expect(html).toContain('T. Novarik');
    expect(html).toContain('29%');
    expect(html).toContain('+5:40');
    expect(html).toContain('Me &lt;b&gt;');
    expect(html).not.toMatch(BROKEN);
    expect(raceDetailHtml(rows[0], null, 260)).toContain('Reading the ride');
    expect(raceDetailHtml(rows[0], [], 260)).not.toMatch(BROKEN);
    expect(raceListHtml(null)).toContain('Reading');
    expect(raceListHtml([])).toContain('No races yet');
  });

  it('cuts the ride into two-minute blocks of power', () => {
    const blocks = raceBlocks(SAMPLES, 260);
    expect(blocks.map((b) => Math.round(b.power))).toEqual([200, 260, 300]);
    expect(blocks.map((b) => b.seconds)).toEqual([120, 120, 60]);
    expect(blocks.reduce((sum, b) => sum + b.distanceM, 0)).toBeCloseTo(299 * 4);
    expect(blocks.reduce((sum, b) => sum + b.climbedM, 0)).toBeCloseTo(299 * 0.3);
  });

  it('records the race a session rode: settings, finishing order and who lost power', () => {
    const route = new Route(getRouteDef('alpine'));
    const climb = route.climbs[0];
    const profile = { name: 'Me', weightKg: 72, ftp: 250, colors: DEFAULT_COLORS } as Profile;
    const session = new RideSession({ mode: 'race', route, climb, aiCount: 12, topWkg: 5, bottomWkg: 2, profile, seed: 3 });
    session.sim.started = true;
    session.sim.simulateToEnd();
    const record = session.hillClimbRecord()!;
    expect(record).toMatchObject({ climbName: climb.name, aiCount: 12, topWkg: 5, bottomWkg: 2, weightKg: 72 });
    expect(record.results).toHaveLength(13);
    const mine = record.results.find((r) => r.player)!;
    expect(mine.timeSec).toBeNull();
    expect(record.results[record.results.length - 1]).toBe(mine);
    expect(record.results.filter((r) => r.drop > 0).length).toBeGreaterThan(0);
    expect(record.results.find((r) => r.name === 'T. Novarik')!.drop).toBe(0);
  });
});
