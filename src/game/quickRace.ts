import type { RoadBody, RoadFeature, RoadPlan, RoadStarter } from '../ai/road';
import type { RaceDef } from '../career/calendar';
import type { CareerLaunch } from '../career/season';
import { riderName } from '../career/roster';
import { aiField } from '../career/squad';
import { teamById, teamKit } from '../career/teams';
import { getRoute, type Climb, type Route } from '../routes/route';
import { realStageRoute, type StageRoute } from '../routes/real/build';
import { REAL_CLIMB_MAP, REAL_STAGES } from '../routes/real/data';
import type { RealStage } from '../routes/real/types';
import type { RiderColors } from '../world/riders';

/** Share of the stage you ride. The finish never moves: a shorter race starts later. */
export type RaceLength = 0.25 | 0.5 | 1;
export type RaceLevel = 'easy' | 'normal' | 'hard' | 'pro';

export const RACE_LENGTHS: { id: RaceLength; label: string; blurb: string }[] = [
  { id: 0.25, label: '25%', blurb: 'The finale' },
  { id: 0.5, label: '50%', blurb: 'Half the stage' },
  { id: 1, label: '100%', blurb: 'The full stage' },
];

export interface LevelSpec {
  id: RaceLevel;
  label: string;
  /** What the bunch rides, as a share of your FTP in W/kg: flat, hills, mountains. Pro is absolute. */
  share: [number, number, number];
  absolute?: [number, number, number];
  blurb: string;
}

export const RACE_LEVELS: LevelSpec[] = [
  { id: 'easy', label: 'Easy', share: [0.62, 0.72, 0.8], blurb: 'The bunch climbs at about 80% of your FTP. Good for a first race.' },
  { id: 'normal', label: 'Normal', share: [0.72, 0.84, 0.94], blurb: 'They climb just under your FTP. You win by riding smart.' },
  { id: 'hard', label: 'Hard', share: [0.8, 0.94, 1.05], blurb: 'They climb above your FTP. Sit in, then pick your moment.' },
  { id: 'pro', label: 'WorldTour', share: [0, 0, 0], absolute: [3.6, 4.7, 5.9], blurb: 'Real pro numbers: about 5.9 W/kg on the big climbs. Good luck.' },
];

/** The bunch pace in W/kg for this level. */
export function levelWkg(level: RaceLevel, ftpWkg: number): { flat: number; hill: number; mountain: number } {
  const spec = RACE_LEVELS.find((l) => l.id === level) ?? RACE_LEVELS[1];
  const [flat, hill, mountain] = spec.absolute ?? spec.share.map((k) => +(k * ftpWkg).toFixed(2));
  return { flat: Math.max(1.4, flat), hill: Math.max(1.6, hill), mountain: Math.max(1.8, mountain) };
}

const KOM_POINTS: Record<string, number[]> = {
  HC: [20, 15, 12, 10, 8, 6, 4, 2],
  '1': [10, 8, 6, 4, 2, 1],
  '2': [5, 3, 2, 1],
  '3': [2, 1],
  '4': [1],
};

/** Points for a climb with no published category, from how much it climbs. Not shown, only scored. */
function sizeCategory(gain: number): string {
  return gain >= 800 ? '1' : gain >= 400 ? '2' : gain >= 150 ? '3' : '4';
}

const built = new Map<string, StageRoute>();
export function stageRoute(stage: RealStage): StageRoute {
  let r = built.get(stage.id);
  if (!r) {
    r = realStageRoute(stage, REAL_CLIMB_MAP);
    built.set(stage.id, r);
  }
  return r;
}

export function stageById(id: string): RealStage | undefined {
  return REAL_STAGES.find((s) => s.id === id);
}

export interface StageCut {
  route: Route;
  startS: number;
  finishS: number;
  climbs: (Climb & { category?: string })[];
  sprints: { s: number; name: string }[];
}

/**
 * Where a race of this length starts. If the cut lands on a climb, the start
 * moves back to the foot of that climb, so you never start halfway up a mountain.
 */
export function cutStage(stage: RealStage, length: RaceLength): StageCut {
  const sr = stageRoute(stage);
  const route = getRoute(sr.def);
  const finishS = route.sectionStart[sr.finishSection] ?? route.length - 2;
  let startS = Math.max(0, finishS * (1 - length));
  for (const c of route.climbs) {
    if (startS > c.start && startS < c.end) startS = Math.max(0, c.start - 300);
  }
  const marks = sr.marks;
  const climbs = route.climbs
    .filter((c) => c.end > startS + 200 && c.end <= finishS + 400)
    .map((c) => ({ ...c, category: marks.find((m) => m.kind === 'climb' && m.name === c.name)?.category }));
  const sprints = marks
    .filter((m) => m.kind === 'sprint')
    .map((m) => {
      const a = route.sectionStart[m.section] ?? 0;
      const b = route.sectionStart[m.section + 1] ?? route.length;
      return { s: a + (b - a) * m.frac, name: m.name };
    })
    .filter((m) => m.s > startS + 500 && m.s < finishS - 500);
  return { route, startS, finishS, climbs, sprints };
}

function fieldSize(length: RaceLength): number {
  // Big fields cost frames. A finale needs fewer riders on the road than a whole stage.
  return length === 0.25 ? 64 : length === 0.5 ? 80 : 96;
}

export interface QuickRaceInput {
  stageId: string;
  length: RaceLength;
  level: RaceLevel;
  ftpWkg: number;
  colors: RiderColors;
}

export type QuickLaunch = CareerLaunch & { quick: { stageId: string; length: RaceLength; level: RaceLevel } };

/** A one-off pro stage against the career peloton. Nothing here touches career state. */
export function launchQuickRace(input: QuickRaceInput): QuickLaunch | null {
  const stage = stageById(input.stageId);
  if (!stage) return null;
  const cut = cutStage(stage, input.length);
  const { route, startS, finishS, climbs } = cut;
  const wkg = levelWkg(input.level, input.ftpWkg);
  const features: RoadFeature[] = [
    ...cut.sprints.map((s) => ({ s: s.s, kind: 'sprint' as const, name: s.name, points: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6], awarded: false, scored: [], doneAt: null })),
    ...climbs.map((c) => ({
      s: Math.min(finishS - 5, Math.max(c.start + 20, c.end - 12)),
      kind: 'kom' as const,
      name: c.name,
      points: KOM_POINTS[c.category ?? sizeCategory(c.gain)] ?? [3, 2, 1],
      awarded: false,
      scored: [],
      doneAt: null,
    })),
  ].sort((a, b) => a.s - b.s);
  const last = climbs[climbs.length - 1];
  const finishKind = stage.finish === 'summit' ? 'mountain' : stage.finish === 'hill' ? 'hill' : stage.finish === 'descent' ? 'mountain' : 'sprint';
  const plan: RoadPlan = {
    flatWkg: wkg.flat,
    hillWkg: wkg.hill,
    mountainWkg: wkg.mountain,
    oneDay: true,
    timeTrial: false,
    startS,
    finishS,
    lastClimbS: finishKind === 'sprint' || !last ? null : last.start,
    firstClimbS: climbs.find((c) => c.avgGrade >= 0.03 && c.length > 400)?.start ?? null,
    finishKind,
    punchy: stage.finish === 'hill' && climbs.every((c) => c.length < 2500),
    tactic: 'control',
    features,
  };
  const race: RaceDef = {
    id: `quick-${stage.id}`,
    name: stage.name,
    month: 7,
    day: 1,
    level: 'world',
    profile: stage.finish === 'sprint' ? 'sprint' : stage.finish === 'hill' ? 'classic' : 'gc',
    jerseys: 'none',
    stages: [],
  };
  const slots = aiField(race, null, false).slice(0, fieldSize(input.length));
  const field: RoadStarter[] = slots.map(({ rider }) => {
    const team = teamById(rider.teamId);
    const kit = team ? teamKit(team) : input.colors;
    const body: RoadBody = { riderId: rider.id, teamId: rider.teamId, age: rider.age, teammate: false, attrs: rider.attrs, kit };
    return { name: riderName(rider), country: rider.country, team: team?.name ?? rider.teamId, mass: rider.mass, colors: { ...kit }, body };
  });
  const playerBody: RoadBody = {
    riderId: 'player',
    teamId: '',
    age: 25,
    teammate: false,
    attrs: { flat: 70, hills: 70, medium: 70, mountain: 70, tt: 70, sprint: 70, recovery: 70, endurance: 70, stamina: 70 },
    kit: input.colors,
  };
  const gain = route.elevationAt(finishS) - route.elevationAt(startS);
  const climbSpan: Climb = {
    id: `quick-${stage.id}-${input.length}`,
    name: stage.name,
    inspiredBy: stage.inspiredBy,
    start: startS,
    end: finishS,
    length: Math.max(1, finishS - startS),
    gain,
    avgGrade: gain / Math.max(1, finishS - startS),
    maxGrade: Math.max(0.02, ...climbs.map((c) => c.maxGrade)),
    startElevation: route.elevationAt(startS),
    summitElevation: route.elevationAt(finishS),
  };
  const lengthLabel = RACE_LENGTHS.find((l) => l.id === input.length)?.label ?? '';
  return {
    title: `${stage.name}${input.length < 1 ? ` · ${lengthLabel}` : ''}`,
    crowd: stage.finish === 'summit' || input.level === 'pro' ? 'grand' : 'busy',
    route,
    climb: climbSpan,
    plan,
    field,
    playerBody,
    playerColors: input.colors,
    paint: { gcId: null, youthIds: [], sprintBase: {}, komBase: {}, jersey: 'none', champions: {}, tour: {} },
    quick: { stageId: stage.id, length: input.length, level: input.level },
  };
}
