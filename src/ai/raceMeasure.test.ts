import { describe, expect, it } from 'vitest';
import { RACES, stageCourse } from '../career/calendar';
import { teamById, teamKit } from '../career/teams';
import { RideSim } from './peloton';
import { terrainWkg } from './road';
import { stepSpeed } from '../physics/cycling';
import { BREAK_MAX, clusterGroups, defaultStages, formatSummary, listStages, mainGroup, measureMany, measureStage, planFor, startersFor, summarise, type StageReport } from './raceMeasure';

/**
 * Turned on by MEASURE=1 because it rides whole stages, which is slow on a laptop:
 *   MEASURE=1 npx vitest run src/ai/raceMeasure.test.ts            (macOS, Linux)
 *   $env:MEASURE=1; npx vitest run src/ai/raceMeasure.test.ts      (Windows PowerShell)
 * Optional: MEASURE_SEEDS=5 (how many seeds per stage, default 3),
 *           MEASURE_STAGE=south-week:1 (one stage, as raceId:stageIndex, instead of one per terrain band).
 */
function setting(name: string): string | undefined {
  const viaVite = (import.meta.env as Record<string, string | undefined>)[name];
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return viaVite ?? proc?.env?.[name];
}

function report(over: Partial<StageReport> = {}): StageReport {
  return {
    seed: 1,
    stage: { raceId: 'x', stageIndex: 0, name: 'Test stage', kind: 'road', band: 'flat', km: 20, finish: 'sprint' },
    field: 100,
    finished: 100,
    stageKm: 20,
    winner: 'A',
    winnerTeam: 'T',
    winnerTimeSec: 1800,
    winnerRank: 1,
    marginSec: 0.5,
    bunchFinish: 60,
    lastBehindPct: 3,
    maxGapSec: 0,
    maxGapAtKm: 0,
    maxBreakSize: 0,
    maxSplitSize: 0,
    caughtKmToGo: null,
    winnerFromBreak: false,
    checkpoints: [0.25, 0.5, 0.75, 0.9].map((pct) => ({ pct, mainSize: 90, mainLenM: 120, groups: 2 })),
    trace: [],
    maxSpeedJumpKmh: 1,
    maxSpeedJumpAtKm: 5,
    maxSpeedJumpGradePct: 0,
    peakAttackRatio: 1.2,
    peakFinishWkg: 3.4,
    ...over,
  };
}

describe('race measuring tool: groups', () => {
  it('splits riders where the wheel to the next one is more than 16 m', () => {
    const rows = [
      { id: 1, along: 1000 },
      { id: 2, along: 990 },
      { id: 3, along: 700 },
      { id: 4, along: 695 },
      { id: 5, along: 690 },
      { id: 6, along: 100 },
    ];
    const groups = clusterGroups(rows);
    expect(groups.map((g) => g.riders.length)).toEqual([2, 3, 1]);
    expect(groups[0].nose).toBe(1000);
    expect(groups[1].tail).toBe(690);
  });

  it('chains a long line of riders into one group', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: i, along: 1000 - i * 10 }));
    expect(clusterGroups(rows)).toHaveLength(1);
  });

  it('takes the biggest group as the bunch, and the front one when they tie', () => {
    const groups = clusterGroups([
      { id: 1, along: 500 },
      { id: 2, along: 495 },
      { id: 3, along: 100 },
      { id: 4, along: 95 },
      { id: 5, along: 90 },
    ]);
    expect(mainGroup(groups)!.riders.map((r) => r.id)).toEqual([3, 4, 5]);
    const tie = clusterGroups([
      { id: 1, along: 500 },
      { id: 2, along: 495 },
      { id: 3, along: 100 },
      { id: 4, along: 95 },
    ]);
    expect(mainGroup(tie)!.nose).toBe(500);
  });

  it('copes with no riders', () => {
    expect(clusterGroups([])).toEqual([]);
    expect(mainGroup([])).toBeNull();
  });
});

describe('race measuring tool: stages', () => {
  it('lists every stage on the calendar with a length and a terrain band', () => {
    const all = listStages();
    expect(all.length).toBeGreaterThan(100);
    for (const spec of all) {
      expect(spec.km).toBeGreaterThan(0);
      expect(['flat', 'hilly', 'medium', 'mountain']).toContain(spec.band);
    }
  });

  it('picks one road stage in each terrain band that has one', () => {
    const picked = defaultStages();
    expect(picked.length).toBeGreaterThanOrEqual(3);
    expect(new Set(picked.map((spec) => spec.band)).size).toBe(picked.length);
    for (const spec of picked) expect(spec.kind).toBe('road');
  });
});

describe('race measuring tool: summary', () => {
  it('turns several races into shares and means', () => {
    const rows = [
      report({ maxGapSec: 45, maxBreakSize: 4, caughtKmToGo: 3, winnerRank: 1, bunchFinish: 40 }),
      report({ maxGapSec: 0, winnerRank: 5, winnerFromBreak: true, bunchFinish: 20, maxSplitSize: BREAK_MAX + 5 }),
    ];
    const s = summarise(rows);
    expect(s.seeds).toBe(2);
    expect(s.breakFormed).toBe(0.5);
    expect(s.breakWon).toBe(0.5);
    expect(s.favouriteWon).toBe(0.5);
    expect(s.topThreeWon).toBe(0.5);
    expect(s.bunchSplit).toBe(0.5);
    expect(s.meanMaxGapSec).toBeCloseTo(22.5, 10);
    expect(s.biggestGapSec).toBe(45);
    expect(s.meanCaughtKmToGo).toBe(3);
    expect(s.meanBunchFinish).toBe(30);
  });

  it('prints one block of plain text', () => {
    const text = formatSummary([report({ maxGapSec: 40, maxBreakSize: 4, caughtKmToGo: 3.2 })]);
    expect(text).toContain('Test stage');
    expect(text).toContain('break:');
    expect(text).toContain('bunch at 90%');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(7);
  });
});

const on = !!setting('MEASURE');

describe('race measuring tool: racing', () => {
  it.skipIf(!on)('rides the stages and prints the numbers', () => {
    const seedCount = Math.max(1, Number(setting('MEASURE_SEEDS') ?? 3));
    const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
    const chosen = setting('MEASURE_STAGE');
    const stages = chosen
      ? listStages().filter((spec) => `${spec.raceId}:${spec.stageIndex}` === chosen)
      : defaultStages();
    expect(stages.length).toBeGreaterThan(0);
    for (const spec of stages) {
      const reports = measureMany(spec, seeds);
      console.log(`\n${formatSummary(reports)}`);
      for (const r of reports) {
        expect(r.finished).toBe(r.field);
        expect(Number.isFinite(r.winnerTimeSec)).toBe(true);
        expect(r.winnerTimeSec).toBeGreaterThan(0);
      }
    }
  }, 3_600_000);

  it.skipIf(!on)('rides the same race twice with the same seed', () => {
    const spec = defaultStages()[0];
    const a = measureStage(spec, 7);
    const b = measureStage(spec, 7);
    expect(b.winner).toBe(a.winner);
    expect(b.winnerTimeSec).toBe(a.winnerTimeSec);
    expect(b.maxGapSec).toBe(a.maxGapSec);
  }, 3_600_000);
});

describe('a rider holding steady power at the foot of a wall', () => {
  // North Week, stage 3 (Slenaken): three 500 m walls at 9% to 10%, the first at 33.5 km.
  // The player holds 2.1 W/kg all the way, below the 2.6 W/kg the bunch rides on the hills. The bunch
  // used to brake before the wall and sag behind its slots on it, so the player passed dozens of riders at once.
  function passedBetween(seed: number, fromS: number, toS: number): number {
    const race = RACES.find((r) => r.id === 'north-week')!;
    const stage = race.stages[2];
    const course = stageCourse(stage);
    const plan = planFor(race, stage, { flatWkg: 2.2, hillWkg: 2.6, mountainWkg: 3, ttWkg: 3 });
    const sim = new RideSim(course.route, {
      startS: course.from,
      finishS: course.to,
      aiCount: 0,
      seed,
      road: plan,
      roadField: startersFor(race),
      player: { name: 'Test', massKg: 72, ftp: 250, colors: teamKit(teamById('atlas')!) },
    });
    sim.started = true;
    const ahead = () => sim.racers.filter((r) => !r.isPlayer && r.s > sim.player.s).length;
    let before = -1;
    let after = -1;
    for (let t = 0; t < 1500 && after < 0; t += 0.25) {
      sim.step(0.25, 2.1 * sim.player.mass, 90);
      if (before < 0 && sim.player.s >= fromS) before = ahead();
      if (before >= 0 && sim.player.s >= toS) after = ahead();
    }
    return before - after;
  }

  it('does not carry the player past the bunch on the first wall or the second', () => {
    for (const seed of [1, 3]) {
      expect(passedBetween(seed, 33300, 33700)).toBeLessThan(10);
      expect(passedBetween(seed, 34400, 34800)).toBeLessThan(10);
    }
  });
});

describe('Harbour Race, from the bunch to the last climb', () => {
  // One whole race (21 km, a 4.6 km climb at 7% to the finish), seed 1, sliders 2.8 / 3.2 / 3.5.
  // The player rides the slider for the terrain, like a rider holding a steady effort.
  function ride() {
    const race = RACES.find((r) => r.id === 'harbour-race')!;
    const stage = race.stages[0];
    const course = stageCourse(stage);
    const plan = planFor(race, stage, { flatWkg: 2.8, hillWkg: 3.2, mountainWkg: 3.5, ttWkg: 3 });
    const sim = new RideSim(course.route, {
      startS: course.from,
      finishS: course.to,
      aiCount: 0,
      seed: 1,
      road: plan,
      roadField: startersFor(race),
      player: { name: 'Test', massKg: 72, ftp: 250, colors: teamKit(teamById('atlas')!) },
    });
    sim.started = true;
    const span = Math.abs(plan.finishS - plan.startS);
    const along = (s: number) => (s - plan.startS) * course.dir;
    const lastClimb = along(plan.lastClimbS!);
    let samples = 0;
    let holes = 0;
    let within30AtOneKm = -1;
    let next = 0;
    for (let t = 0; t < 3 * 3600; t += 0.25) {
      sim.step(0.25, terrainWkg(plan, course.route.gradeAt(sim.player.s) * course.dir) * sim.player.mass, 90);
      const ai = sim.racers.filter((r) => !r.isPlayer);
      if (ai.every((r) => r.finishTime !== null)) break;
      if (t < next) continue;
      next = t + 2;
      const racing = ai.filter((r) => r.finishTime === null).sort((a, b) => along(b.s) - along(a.s));
      const front = along(racing[0].s);
      if (within30AtOneKm < 0 && span - front <= 1000) {
        within30AtOneKm = racing.filter((r) => (front - along(r.s)) / Math.max(3, racing[0].v) <= 30).length;
      }
      if (front < 1500 || front > lastClimb - 200) continue;
      // The front of the biggest group: no rider in its first 16 more than 8 m behind the one ahead.
      const bunch = [...racing, sim.player].filter((r) => r.isPlayer || r.mode === 'follow' || r.mode === 'pace').sort((a, b) => along(b.s) - along(a.s));
      const groups = clusterGroups(bunch.map((r) => ({ id: r.id, along: along(r.s) })));
      const main = mainGroup(groups)!.riders.slice(0, 16);
      samples++;
      if (main.some((row, i) => i > 0 && main[i - 1].along - row.along > 8)) holes++;
    }
    const finish = sim.racers.filter((r) => !r.isPlayer && r.finishTime !== null).map((r) => r.finishTime!).sort((a, b) => a - b);
    return { holeShare: holes / Math.max(1, samples), within30AtOneKm, hundredthBehind: finish[99] - finish[0] };
  }

  it('keeps the front of the bunch together and splits the field on the last climb', () => {
    const result = ride();
    // Before: a gap of more than 8 m in the first 16 riders 64% of the time, which looked like a small break.
    expect(result.holeShare).toBeLessThan(0.1);
    // Before: 128 riders within 30 s of the front at 1 km to go, and the 100th rider 50 s behind the winner.
    expect(result.within30AtOneKm).toBeLessThan(60);
    expect(result.hundredthBehind).toBeGreaterThan(90);
  });
});

describe('over the top of a climb', () => {
  // North Week, stage 3 (Slenaken): 12% descents off the walls. The bunch used to be allowed 1.8 m/s² more
  // than physics on a descent, so it sped up nearly four times as fast as a player holding the same power.
  it('lets the bunch speed up on a descent only as fast as physics does', () => {
    const race = RACES.find((r) => r.id === 'north-week')!;
    const stage = race.stages[2];
    const course = stageCourse(stage);
    const plan = planFor(race, stage, { flatWkg: 2.8, hillWkg: 3.2, mountainWkg: 3.5, ttWkg: 3 });
    const sim = new RideSim(course.route, {
      startS: course.from,
      finishS: course.to,
      aiCount: 0,
      seed: 1,
      road: plan,
      roadField: startersFor(race),
      player: { name: 'Test', massKg: 72, ftp: 250, colors: teamKit(teamById('atlas')!) },
    });
    sim.started = true;
    const before = new Map<number, number>();
    const gained: number[] = [];
    const physics: number[] = [];
    for (let t = 0; t < 900; t += 0.25) {
      sim.step(0.25, terrainWkg(plan, course.route.gradeAt(sim.player.s) * course.dir) * sim.player.mass, 90);
      for (const r of sim.racers) {
        const v0 = before.get(r.id);
        before.set(r.id, r.v);
        const grade = course.route.gradeAt(r.s) * r.direction;
        if (r.isPlayer || r.mode !== 'follow' || v0 == null || grade > -0.06 || v0 > 15) continue;
        gained.push((r.v - v0) / 0.25);
        physics.push((stepSpeed(v0, r.power, grade, r.bike, 0.25, course.route.elevationAt(r.s), r.draft, 0) - v0) / 0.25);
      }
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    expect(gained.length).toBeGreaterThan(500);
    // Before: 2.36 m/s² against 0.62 m/s² from physics.
    expect(median(gained)).toBeLessThan(median(physics) + 0.1);
  });
});
