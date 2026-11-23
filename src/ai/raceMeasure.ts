/**
 * Race measuring tool.
 *
 * Rides a Career stage headless with a seeded field and reports how the racing looks in numbers:
 * how big the break gets and when it is caught, how often the break wins, how often the best
 * rider for the finish wins, how compact the bunch stays, how fast the bunch speed changes, and
 * how hard the AI attacks and sprints compared with the sliders.
 *
 * It is a measuring tool only. It changes nothing in the game. Run it with
 *   MEASURE=1 npx vitest run src/ai/raceMeasure.test.ts
 * and compare the numbers before and after a change to the racing.
 *
 * The player rides the slider tempo for the terrain the whole way, like a rider holding a steady
 * effort, and is left out of every number below.
 */
import { punchyStage, RACES, risesOnCourse, segmentFinish, segmentKind, stageCourse, stageWindow, terrainBand, type RaceDef, type RaceStage, type TerrainBand } from '../career/calendar';
import { aiField } from '../career/squad';
import { teamById, teamKit } from '../career/teams';
import { RideSim, type Racer } from './peloton';
import { stageStrength, terrainWkg, type RoadPlan, type RoadStarter } from './road';

/** Riders closer than this to the rider ahead are in the same group. The same value the AI uses. */
export const GROUP_GAP_M = 16;

/** A group ahead of the bunch with this many riders or fewer is a break. A bigger one is the bunch splitting in two. */
export const BREAK_MAX = 20;

/** Sliders the stage is ridden at. */
export interface MeasureSliders {
  flatWkg: number;
  hillWkg: number;
  mountainWkg: number;
  ttWkg: number;
}

export const DEFAULT_SLIDERS: MeasureSliders = { flatWkg: 2.8, hillWkg: 3.2, mountainWkg: 3.5, ttWkg: 3 };

export interface StageSpec {
  raceId: string;
  stageIndex: number;
  name: string;
  kind: 'road' | 'tt';
  band: TerrainBand;
  km: number;
  finish: 'sprint' | 'hill' | 'mountain';
}

/** Every stage on the calendar, with its length and how much it climbs. */
export function listStages(): StageSpec[] {
  const out: StageSpec[] = [];
  for (const race of RACES) {
    race.stages.forEach((stage, stageIndex) => {
      const window = stageWindow(stage);
      out.push({
        raceId: race.id,
        stageIndex,
        name: `${race.name} · ${stage.name}`,
        kind: segmentKind(stage),
        band: terrainBand(window.ascent, window.km),
        km: window.km,
        finish: segmentFinish(stage),
      });
    });
  }
  return out;
}

/** One road stage per terrain band, the one closest to the length a Career stage usually has. */
export function defaultStages(targetKm = 22): StageSpec[] {
  const all = listStages().filter((spec) => spec.kind === 'road' && spec.km > 5);
  const bands: TerrainBand[] = ['flat', 'hilly', 'medium', 'mountain'];
  const picked: StageSpec[] = [];
  for (const band of bands) {
    const inBand = all.filter((spec) => spec.band === band);
    inBand.sort((a, b) => Math.abs(a.km - targetKm) - Math.abs(b.km - targetKm));
    if (inBand[0]) picked.push(inBand[0]);
  }
  return picked;
}

export interface GroupRow {
  id: number;
  along: number;
}

export interface Cluster {
  riders: GroupRow[];
  /** Metres along the stage of the front rider. */
  nose: number;
  /** Metres along the stage of the last rider. */
  tail: number;
}

/** Splits riders into groups: a rider more than gapM behind the one ahead starts a new group. Front group first. */
export function clusterGroups(rows: GroupRow[], gapM = GROUP_GAP_M): Cluster[] {
  const sorted = [...rows].sort((a, b) => b.along - a.along);
  const groups: Cluster[] = [];
  for (const row of sorted) {
    const last = groups[groups.length - 1];
    if (!last || last.tail - row.along > gapM) groups.push({ riders: [row], nose: row.along, tail: row.along });
    else {
      last.riders.push(row);
      last.tail = row.along;
    }
  }
  return groups;
}

/** The biggest group. The front one wins a tie. */
export function mainGroup(groups: Cluster[]): Cluster | null {
  let best: Cluster | null = null;
  for (const group of groups) if (!best || group.riders.length > best.riders.length) best = group;
  return best;
}

export interface Sample {
  t: number;
  /** Front rider of the whole field, in metres from the start. */
  front: number;
  /** Front rider of the biggest group, in metres from the start. */
  nose: number;
  /** Seconds the front break is ahead of the bunch. 0 when there is no break. */
  gapSec: number;
  /** Riders in groups of BREAK_MAX or fewer that are ahead of the bunch. */
  breakSize: number;
  /** Riders in bigger groups ahead of the biggest group: the bunch has split. */
  splitSize: number;
  mainSize: number;
  mainLen: number;
  groups: number;
  /** Median speed of the AI riders still racing, in m/s. */
  speed: number;
}

export interface Checkpoint {
  pct: number;
  mainSize: number;
  mainLenM: number;
  groups: number;
}

export interface TracePoint {
  km: number;
  gapSec: number;
  breakSize: number;
  mainSize: number;
}

export interface StageReport {
  seed: number;
  stage: StageSpec;
  field: number;
  finished: number;
  stageKm: number;
  winner: string;
  winnerTeam: string;
  winnerTimeSec: number;
  /** 1 means the winner was the strongest rider in the field for this kind of finish. */
  winnerRank: number;
  marginSec: number;
  /** AI riders that finish within 3 s of the winner. */
  bunchFinish: number;
  /** How far the last rider is behind the winner, as a percentage of the winner's time. */
  lastBehindPct: number;
  maxGapSec: number;
  maxGapAtKm: number;
  maxBreakSize: number;
  /** Most riders seen in a big group ahead of the biggest group. */
  maxSplitSize: number;
  /** Kilometres to go when the break was caught after its biggest gap. Null if it was never caught. */
  caughtKmToGo: number | null;
  winnerFromBreak: boolean;
  checkpoints: Checkpoint[];
  trace: TracePoint[];
  /** Biggest change of the median speed in one second, in km/h, before the last kilometre. */
  maxSpeedJumpKmh: number;
  maxSpeedJumpAtKm: number;
  /** Road grade, in percent, where that change happened. */
  maxSpeedJumpGradePct: number;
  /** Highest AI power while attacking, as a multiple of the slider for that slope. */
  peakAttackRatio: number;
  /** Highest AI power in the last 500 m, in W/kg. */
  peakFinishWkg: number;
}

export interface MeasureOptions {
  sliders?: MeasureSliders;
  /** Simulation step in seconds. Smaller is slower and no more accurate than the game itself. */
  dt?: number;
  /** Give up after this many simulated seconds. */
  maxSeconds?: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function startersFor(race: RaceDef): RoadStarter[] {
  return aiField(race, null, false).map((slot) => {
    const rider = slot.rider;
    const team = teamById(rider.teamId);
    const kit = teamKit(team ?? teamById('atlas')!);
    return {
      name: `${rider.first} ${rider.last}`,
      country: rider.country,
      team: team?.name ?? rider.teamId,
      mass: rider.mass,
      colors: { ...kit },
      body: { riderId: rider.id, teamId: rider.teamId, age: rider.age, teammate: false, attrs: rider.attrs, kit },
    };
  });
}

/** The plan the game builds for this stage, with the tactic left on the AI's own. */
export function planFor(race: RaceDef, stage: RaceStage, sliders: MeasureSliders): RoadPlan {
  const course = stageCourse(stage);
  const kind = segmentKind(stage);
  const finish = segmentFinish(stage);
  const { route, from, to, dir, reverse } = course;
  const inside = kind === 'road' && !reverse ? route.climbs.filter((c) => c.start >= from - 40 && c.end <= to + 50 && c.length > 180) : [];
  const back = kind === 'road' && reverse ? risesOnCourse(stage) : [];
  const lastEntry = reverse ? back[back.length - 1]?.entry ?? null : inside[inside.length - 1]?.start ?? null;
  const firstEntry = reverse
    ? back.find((climb) => climb.avgGrade >= 0.03 && climb.length > 400)?.entry ?? null
    : inside.find((climb) => climb.avgGrade >= 0.03 && climb.length > 400)?.start ?? null;
  return {
    flatWkg: sliders.flatWkg,
    hillWkg: sliders.hillWkg,
    mountainWkg: sliders.mountainWkg,
    ttWkg: sliders.ttWkg,
    oneDay: race.stages.length === 1 && kind === 'road',
    timeTrial: kind === 'tt',
    startS: from,
    finishS: to,
    dir,
    lastClimbS: finish === 'sprint' || lastEntry == null ? null : lastEntry,
    firstClimbS: firstEntry,
    finishKind: finish,
    punchy: kind === 'road' && punchyStage(stage),
    tactic: 'control',
    features: [],
  };
}

/** Rides one stage with one seed and measures it. */
export function measureStage(spec: StageSpec, seed: number, options: MeasureOptions = {}): StageReport {
  const race = RACES.find((r) => r.id === spec.raceId);
  if (!race) throw new Error(`Unknown race ${spec.raceId}`);
  const stage = race.stages[spec.stageIndex];
  if (!stage) throw new Error(`Race ${spec.raceId} has no stage ${spec.stageIndex}`);
  const sliders = options.sliders ?? DEFAULT_SLIDERS;
  const dt = options.dt ?? 0.25;
  const maxSeconds = options.maxSeconds ?? 4 * 3600;
  const course = stageCourse(stage);
  const plan = planFor(race, stage, sliders);
  const span = Math.abs(plan.finishS - plan.startS);
  const field = startersFor(race);
  const strength = new Map<string, number>();
  for (const starter of field) strength.set(starter.body.riderId, stageStrength(starter.body.attrs, plan.finishKind, plan.punchy));
  const sim = new RideSim(course.route, {
    startS: course.from,
    finishS: course.to,
    aiCount: 0,
    seed,
    road: plan,
    roadField: field,
    player: { name: 'Measure', massKg: 72, ftp: 250, colors: teamKit(teamById('atlas')!) },
  });
  sim.started = true;
  const ai = (): Racer[] => sim.racers.filter((r) => !r.isPlayer);
  const along = (r: Racer) => (r.s - plan.startS) * course.dir;
  const gradeAt = (r: Racer) => course.route.gradeAt(r.s) * r.direction;
  const samples: Sample[] = [];
  const breakSeconds = new Map<number, number>();
  const breakCandidates = new Set<number>();
  let peakAttackRatio = 0;
  let peakFinishWkg = 0;
  let t = 0;
  let nextSample = 1;
  while (t < maxSeconds && ai().some((r) => r.finishTime === null)) {
    const player = sim.player;
    const grade = course.route.gradeAt(player.s) * player.direction;
    sim.step(dt, terrainWkg(plan, grade) * player.mass, 90);
    t += dt;
    if (t < nextSample) continue;
    nextSample += 1;
    const racing = ai().filter((r) => r.finishTime === null);
    if (!racing.length) break;
    const rows = racing.map((r) => ({ id: r.id, along: along(r) }));
    const groups = clusterGroups(rows);
    const main = mainGroup(groups)!;
    const mainIds = new Set(main.riders.map((row) => row.id));
    const mainSpeed = median(racing.filter((r) => mainIds.has(r.id)).map((r) => r.v));
    const front = groups[0].nose;
    const ahead = groups.filter((g) => g.nose > main.nose);
    const small = ahead.filter((g) => g.riders.length <= BREAK_MAX);
    const big = ahead.filter((g) => g.riders.length > BREAK_MAX);
    const breakSize = small.reduce((sum, g) => sum + g.riders.length, 0);
    for (const group of small) {
      for (const row of group.riders) {
        if (row.along >= span * 0.9) continue;
        const seconds = (breakSeconds.get(row.id) ?? 0) + 1;
        breakSeconds.set(row.id, seconds);
        if (seconds >= 60) breakCandidates.add(row.id);
      }
    }
    samples.push({
      t,
      front,
      nose: main.nose,
      gapSec: small.length ? (small[0].nose - main.nose) / Math.max(2, mainSpeed) : 0,
      breakSize,
      splitSize: big.reduce((sum, g) => sum + g.riders.length, 0),
      mainSize: main.riders.length,
      mainLen: main.nose - main.tail,
      groups: groups.length,
      speed: median(racing.map((r) => r.v)),
    });
    for (const r of racing) {
      const wkg = r.power / Math.max(1, r.mass);
      const grade = gradeAt(r);
      if (r.mode === 'attack') {
        if (grade >= 0) peakAttackRatio = Math.max(peakAttackRatio, wkg / Math.max(0.5, terrainWkg(plan, grade)));
      }
      if (span - along(r) <= 500) peakFinishWkg = Math.max(peakFinishWkg, wkg);
    }
  }

  const finishers = ai().filter((r) => r.finishTime !== null).sort((a, b) => a.finishTime! - b.finishTime!);
  const winner = finishers[0];
  const winnerBody = winner?.road ?? null;
  const winnerStrength = winnerBody ? strength.get(winnerBody.riderId) ?? 0 : 0;
  let winnerRank = 0;
  if (winner) winnerRank = 1 + [...strength.values()].filter((value) => value > winnerStrength).length;
  const winnerTime = winner?.finishTime ?? 0;
  const lastTime = finishers[finishers.length - 1]?.finishTime ?? winnerTime;

  let maxGapSec = 0;
  let maxGapAt = 0;
  let maxBreak = 0;
  let maxSplit = 0;
  samples.forEach((sample, i) => {
    maxBreak = Math.max(maxBreak, sample.breakSize);
    maxSplit = Math.max(maxSplit, sample.splitSize);
    if (sample.gapSec > maxGapSec) {
      maxGapSec = sample.gapSec;
      maxGapAt = i;
    }
  });
  let caughtKmToGo: number | null = null;
  if (maxGapSec >= 10) {
    for (let i = maxGapAt; i < samples.length; i++) {
      if (samples[i].gapSec < 3) {
        caughtKmToGo = Math.max(0, (span - samples[i].nose) / 1000);
        break;
      }
    }
  }

  const checkpoints: Checkpoint[] = [0.25, 0.5, 0.75, 0.9].map((pct) => {
    const sample = samples.find((s) => s.nose >= span * pct) ?? samples[samples.length - 1];
    return { pct, mainSize: sample?.mainSize ?? 0, mainLenM: sample?.mainLen ?? 0, groups: sample?.groups ?? 0 };
  });

  const trace: TracePoint[] = [];
  for (let km = 2; km * 1000 < span; km += 2) {
    const sample = samples.find((s) => s.nose >= km * 1000);
    if (sample) trace.push({ km, gapSec: sample.gapSec, breakSize: sample.breakSize, mainSize: sample.mainSize });
  }

  let maxJump = 0;
  let maxJumpAt = 0;
  let maxJumpGrade = 0;
  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    if (sample.t < 20 || span - sample.nose < 1000) continue;
    const jump = Math.abs(sample.speed - samples[i - 1].speed) * 3.6;
    if (jump > maxJump) {
      maxJump = jump;
      maxJumpAt = sample.nose / 1000;
      maxJumpGrade = course.route.gradeAt(plan.startS + course.dir * sample.nose) * course.dir * 100;
    }
  }

  return {
    seed,
    stage: spec,
    field: field.length,
    finished: finishers.length,
    stageKm: span / 1000,
    winner: winner?.name ?? 'nobody',
    winnerTeam: winner?.team ?? '',
    winnerTimeSec: winnerTime,
    winnerRank,
    marginSec: finishers[1] ? finishers[1].finishTime! - winnerTime : 0,
    bunchFinish: finishers.filter((r) => r.finishTime! - winnerTime <= 3).length,
    lastBehindPct: winnerTime > 0 ? ((lastTime - winnerTime) / winnerTime) * 100 : 0,
    maxGapSec,
    maxGapAtKm: (samples[maxGapAt]?.nose ?? 0) / 1000,
    maxBreakSize: maxBreak,
    maxSplitSize: maxSplit,
    caughtKmToGo,
    winnerFromBreak: winner ? breakCandidates.has(winner.id) : false,
    checkpoints,
    trace,
    maxSpeedJumpKmh: maxJump,
    maxSpeedJumpAtKm: maxJumpAt,
    maxSpeedJumpGradePct: maxJumpGrade,
    peakAttackRatio,
    peakFinishWkg,
  };
}

export interface Summary {
  stage: StageSpec;
  seeds: number;
  /** Share of races where a break got at least 20 s clear. */
  breakFormed: number;
  /** Share of races where more than BREAK_MAX riders got clear of the biggest group. */
  bunchSplit: number;
  /** Share of races won by a rider who had spent a minute or more in a break before the last tenth of the stage. */
  breakWon: number;
  /** Share of races won by the strongest rider for the finish. */
  favouriteWon: number;
  /** Share of races won by one of the three strongest riders for the finish. */
  topThreeWon: number;
  meanMaxGapSec: number;
  biggestGapSec: number;
  meanBreakSize: number;
  meanCaughtKmToGo: number | null;
  meanMainSizeAt90: number;
  meanGroupsAt90: number;
  meanBunchFinish: number;
  meanMarginSec: number;
  worstLastBehindPct: number;
  biggestSpeedJumpKmh: number;
  biggestPeakAttackRatio: number;
  meanPeakFinishWkg: number;
  highestPeakFinishWkg: number;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function summarise(reports: StageReport[]): Summary {
  const n = reports.length;
  const share = (test: (r: StageReport) => boolean) => (n ? reports.filter(test).length / n : 0);
  const caught = reports.map((r) => r.caughtKmToGo).filter((v): v is number => v != null);
  return {
    stage: reports[0].stage,
    seeds: n,
    breakFormed: share((r) => r.maxGapSec >= 20),
    bunchSplit: share((r) => r.maxSplitSize > BREAK_MAX),
    breakWon: share((r) => r.winnerFromBreak),
    favouriteWon: share((r) => r.winnerRank === 1),
    topThreeWon: share((r) => r.winnerRank >= 1 && r.winnerRank <= 3),
    meanMaxGapSec: mean(reports.map((r) => r.maxGapSec)),
    biggestGapSec: Math.max(...reports.map((r) => r.maxGapSec)),
    meanBreakSize: mean(reports.map((r) => r.maxBreakSize)),
    meanCaughtKmToGo: caught.length ? mean(caught) : null,
    meanMainSizeAt90: mean(reports.map((r) => r.checkpoints[3]?.mainSize ?? 0)),
    meanGroupsAt90: mean(reports.map((r) => r.checkpoints[3]?.groups ?? 0)),
    meanBunchFinish: mean(reports.map((r) => r.bunchFinish)),
    meanMarginSec: mean(reports.map((r) => r.marginSec)),
    worstLastBehindPct: Math.max(...reports.map((r) => r.lastBehindPct)),
    biggestSpeedJumpKmh: Math.max(...reports.map((r) => r.maxSpeedJumpKmh)),
    biggestPeakAttackRatio: Math.max(...reports.map((r) => r.peakAttackRatio)),
    meanPeakFinishWkg: mean(reports.map((r) => r.peakFinishWkg)),
    highestPeakFinishWkg: Math.max(...reports.map((r) => r.peakFinishWkg)),
  };
}

/** Rides one stage with several seeds. */
export function measureMany(spec: StageSpec, seeds: number[], options: MeasureOptions = {}): StageReport[] {
  return seeds.map((seed) => measureStage(spec, seed, options));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const fix = (v: number, d = 1) => v.toFixed(d);

/** Plain text for one stage: the summary over all seeds, then the gap trace of the first seed. */
export function formatSummary(reports: StageReport[]): string {
  const s = summarise(reports);
  const first = reports[0];
  const lines: string[] = [];
  lines.push(`${s.stage.name}  [${s.stage.band}, ${fix(first.stageKm)} km, ${s.stage.finish} finish, ${first.field} riders, ${s.seeds} seeds]`);
  lines.push(`  break: formed (20 s+) in ${pct(s.breakFormed)}, wins ${pct(s.breakWon)}; biggest gap ${fix(s.biggestGapSec, 0)} s (mean ${fix(s.meanMaxGapSec, 0)} s); mean size ${fix(s.meanBreakSize)}; caught ${s.meanCaughtKmToGo == null ? 'never' : `${fix(s.meanCaughtKmToGo)} km to go on average`}`);
  lines.push(`  bunch split into two big groups in ${pct(s.bunchSplit)} of races (most riders in a big group ahead: ${Math.max(...reports.map((r) => r.maxSplitSize))})`);
  lines.push(`  winner: best rider for the finish wins ${pct(s.favouriteWon)}, one of the top three ${pct(s.topThreeWon)}; ${fix(s.meanBunchFinish, 0)} riders within 3 s of the winner; mean margin ${fix(s.meanMarginSec)} s`);
  lines.push(`  bunch at 90% of the stage: ${fix(s.meanMainSizeAt90, 0)} riders in the biggest group, ${fix(s.meanGroupsAt90, 1)} groups; last rider ${fix(s.worstLastBehindPct)}% behind at worst`);
  lines.push(`  speed: biggest change of the bunch speed ${fix(s.biggestSpeedJumpKmh)} km/h in one second (seed ${first.seed}: at ${fix(first.maxSpeedJumpAtKm)} km, grade ${fix(first.maxSpeedJumpGradePct)}%)`);
  lines.push(`  power: attacks reach ${fix(s.biggestPeakAttackRatio, 2)}x the slider; the fastest finish is ${fix(s.highestPeakFinishWkg)} W/kg (mean ${fix(s.meanPeakFinishWkg)})`);
  lines.push(`  seed ${first.seed} gap trace (km: gap s, break size, bunch size): ${first.trace.map((p) => `${p.km}: ${fix(p.gapSec, 0)}s/${p.breakSize}/${p.mainSize}`).join('  ')}`);
  return lines.join('\n');
}
