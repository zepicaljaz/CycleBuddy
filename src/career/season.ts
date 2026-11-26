import type { RoadBody, RoadFeature, RoadPlan, RoadStarter } from '../ai/road';
import { canEnter, climbScoresOnStage, formatDate, monthsFor, punchyStage, raceById, raceEnd, RACES, risesOnCourse, sharesDay, segmentFinish, segmentKind, stageCourse, stageKm, type RaceDef, type RaceStage } from './calendar';
import { buildOffers, cybPoints, FINISH_POINTS, finishJerseyPoints, offerPoints } from './classify';
import { nationColors, paintKits, type PaintContext } from './jerseys';
import { riderById, riderName, type Rider } from './roster';
import { aiField, champField, fieldFromList, squadFor, startMateCount } from './squad';
import { simulateRace, type SimRace, type SimRow } from './simulate';
import { teamById, teamKit } from './teams';
import type { ActiveRace, CareerState, ClassRow, Division, PalmaresEntry, ResultSheet, SavedRace } from './types';
import type { Climb, Route } from '../routes/route';
import type { RiderColors } from '../world/riders';

const KEY = 'cyclebuddy-career';
export type CareerTab = 'pick' | 'hub' | 'calendar' | 'rankings' | 'record' | 'team' | 'riders' | 'field' | 'brief' | 'offers';
export type CrowdLevel = 'quiet' | 'normal' | 'busy' | 'grand';

export interface RaceClassifications {
  time: ClassRow[];
  sprint: ClassRow[];
  mountains: ClassRow[];
  /** Stages finished, including the one just ridden. */
  done: number;
  stages: number;
}

export interface StageResultRow {
  riderId: string;
  name: string;
  teamId: string;
  country: string;
  age: number;
  time: number;
  sprint: number;
  kom: number;
  isPlayer: boolean;
}

export interface CareerLaunch {
  title: string;
  crowd: CrowdLevel;
  route: Route;
  climb: Climb;
  plan: RoadPlan;
  field: RoadStarter[];
  playerBody: RoadBody;
  playerColors: RiderColors;
  paint: PaintContext;
  /** Classification leaders already earned, worn and listed from stage 2. */
  leaders?: { time: string; sprint: string; mountains: string };
}

export interface RiderProfile {
  name: string;
  weightKg: number;
  skin: string;
  /** The bike the player bought. Frame and wheels stay theirs in a career race. */
  bike?: RiderColors;
}

/** Keep the earlier choice when two entered races share a day. */
function resolveClashes(ids: string[], year: number): string[] {
  const kept: RaceDef[] = [];
  for (const id of ids) {
    const race = raceById(id);
    if (!race) continue;
    if (kept.some((other) => sharesDay(race, other, year))) continue;
    kept.push(race);
  }
  return kept.map((race) => race.id);
}

function racesFor(teamId: string): string[] {
  const team = teamById(teamId);
  if (!team) return [];
  const chosen: RaceDef[] = [];
  for (const race of RACES) {
    if (!canEnter(race.level, team.division)) continue;
    if (chosen.some((other) => sharesDay(race, other))) continue;
    chosen.push(race);
  }
  return chosen.map((race) => race.id);
}

function sheetOf(rows: { riderId: string; name: string; teamId: string; value: number }[], points = false): ResultSheet[] {
  const list = points ? rows.filter((row) => row.value > 0) : rows;
  return list.map((row) => ({ riderId: row.riderId, name: row.name, teamId: row.teamId, value: row.value }));
}

function podiumOf(rows: { riderId: string; name: string; teamId: string }[]): { riderId: string; name: string; team: string }[] {
  return rows.slice(0, 3).map((row) => ({
    riderId: row.riderId,
    name: row.name,
    team: teamById(row.teamId)?.name ?? '',
  }));
}

/** Races that already existed when calendars were first saved. An unticked one of these stays unticked. */
const PRIOR_RACES = [
  'lowland-trophy', 'riviera-tour', 'san-mare', 'valley-cup', 'italia-week', 'flandres', 'ardenne-arrow', 'ardenne-peak',
  'regional-tour', 'basque-week', 'hill-cup', 'italy-tour', 'alpine-week', 'continental-alps', 'mountain-week', 'france-tour',
  'highland-tour', 'northern-tour', 'plateau', 'spanish-tour', 'maple', 'harvest', 'autumn', 'euro-tt', 'euro-road', 'world-tt', 'world-road',
];

/** Tick races added since this career was saved, without turning races the player switched off back on. */
export function adoptCalendar(state: CareerState): boolean {
  const known = new Set(RACES.map((race) => race.id));
  const entered = state.entered.filter((id) => known.has(id));
  let changed = entered.length !== state.entered.length;
  state.entered = entered;
  if (!state.seenRaces) {
    state.seenRaces = [...new Set([...PRIOR_RACES, ...state.entered, ...state.done, ...state.skipped])];
    changed = true;
  }
  const declined = new Set(state.declined ?? []);
  const withoutDeclined = state.entered.filter((id) => !declined.has(id));
  if (withoutDeclined.length !== state.entered.length) {
    state.entered = withoutDeclined;
    changed = true;
  }
  const seen = new Set(state.seenRaces);
  const unseen = racesFor(state.teamId).filter((id) => !seen.has(id) && !declined.has(id) && !state.done.includes(id) && !state.skipped.includes(id));
  if (unseen.length) {
    state.entered = [...new Set([...state.entered, ...unseen])];
    state.seenRaces = [...state.seenRaces, ...unseen];
    changed = true;
  }
  return changed;
}

function blank(teamId: string, nation: string, flat: number, hill: number, mountain: number): CareerState {
  const entered = racesFor(teamId);
  return {
    version: 1,
    year: 2026,
    age: 24,
    nation,
    teamId,
    flatWkg: flat,
    hillWkg: hill,
    mountainWkg: mountain,
    ttWkg: 4.6,
    tactic: 'control',
    entered,
    enteredSeeded: true,
    seenRaces: [...entered],
    done: [],
    skipped: [],
    active: null,
    races: [],
    history: [],
    cyb: {},
    cont: {},
    jerseyWear: {},
    wins: {},
    teamPoints: {},
    palmares: [],
    stageNotes: [],
    champions: {},
    offers: null,
  };
}

function stageEnds(stage: RaceStage): { route: Route; start: number; end: number; dir: 1 | -1; reverse: boolean } {
  const course = stageCourse(stage);
  return { route: course.route, start: course.from, end: course.to, dir: course.dir, reverse: course.reverse };
}

function climbsOnStage(route: Route, start: number, end: number): Climb[] {
  return route.climbs.filter((c) => c.start >= start - 40 && c.end <= end + 50 && c.length > 180);
}

function komPoints(length: number, avgGrade: number): number[] {
  const score = (length / 1000) * avgGrade * 100;
  return length >= 4000 && score >= 28
    ? [20, 15, 12, 8, 6, 4, 2, 1]
    : score >= 18 ? [10, 8, 6, 4, 2, 1]
      : score >= 10 ? [5, 3, 2, 1]
        : [3, 2, 1];
}

/**
 * Metres from the start to an intermediate sprint.
 * The banner sits on road flatter than 2%, the same green the profile uses for flat,
 * and as near the middle as that allows. A stage that never flattens has no sprint.
 */
function sprintDistance(stage: RaceStage): number | null {
  const { route, start, end, dir } = stageEnds(stage);
  const span = Math.abs(end - start);
  const preferred = span * 0.46;
  const grade = (along: number) => route.gradeAt(start + dir * along) * dir;
  const flatEnough = (along: number, before: number, after: number) => {
    if (along < 400 || along > span - 700) return false;
    for (let d = -before; d <= after; d += 20) {
      const g = grade(along + d);
      if (g <= -0.02 || g >= 0.02) return false;
    }
    return true;
  };
  if (flatEnough(preferred, 200, 80)) return preferred;
  const points: number[] = [];
  const lo = 400;
  const hi = span - 700;
  for (let along = lo; along <= hi; along += 20) {
    if (flatEnough(along, 40, 40)) points.push(along);
  }
  const runs: { lo: number; hi: number }[] = [];
  for (const along of points) {
    const run = runs[runs.length - 1];
    if (!run || along - run.hi > 30) runs.push({ lo: along, hi: along });
    else run.hi = along;
  }
  const long = runs.filter((run) => run.hi - run.lo >= 80);
  const pool = long.length ? long : runs;
  let best = -1;
  let bestDist = Infinity;
  for (const run of pool) {
    if (preferred >= run.lo && preferred <= run.hi) return preferred;
    const mid = (run.lo + run.hi) / 2;
    const dist = Math.abs(mid - preferred);
    if (dist < bestDist) {
      bestDist = dist;
      best = mid;
    }
  }
  return best >= 0 ? best : null;
}

function roadFeatures(stage: RaceStage, oneDay = false): RoadFeature[] {
  // A one-day race pays at the finish only. Nothing along the road scores.
  if (oneDay) return [];
  const { route, start, end, dir, reverse } = stageEnds(stage);
  const span = Math.abs(end - start);
  const kind = segmentKind(stage);
  const features: RoadFeature[] = [];
  const sprintAt = kind === 'road' && span > 12000 ? sprintDistance(stage) : null;
  if (sprintAt != null) {
    features.push({ s: start + dir * sprintAt, kind: 'sprint', name: 'Intermediate sprint', points: [12, 8, 6, 4, 2], awarded: false, scored: [], doneAt: null });
  }
  if (kind !== 'road') return features;
  if (reverse) {
    for (const climb of risesOnCourse(stage)) {
      features.push({
        s: climb.top - dir * 12,
        kind: 'kom',
        name: climb.name,
        points: komPoints(climb.length, climb.avgGrade),
        awarded: false,
        scored: [],
        doneAt: null,
      });
    }
    return features;
  }
  // Every climb on the profile whose summit is on the stage pays points, even one that starts before the stage.
  for (const climb of route.climbs.filter((c) => climbScoresOnStage(c, start, end))) {
    const top = Math.max(climb.start + 20, climb.end - 12);
    features.push({
      s: Math.min(end - 1, Math.max(start + 1, top)),
      kind: 'kom',
      name: climb.name,
      points: komPoints(climb.length, climb.avgGrade),
      awarded: false,
      scored: [],
      doneAt: null,
    });
  }
  return features;
}

export interface StagePrime {
  /** Fraction along the stage. The finish is 1, at the right end of the profile. */
  at: number;
  kind: 'sprint' | 'kom' | 'finish';
  name: string;
  points: number[];
}

/** Intermediate sprint, mountain points, and the finish, with the points each one pays. */
export function stagePrimes(stage: RaceStage, oneDay = false): StagePrime[] {
  const { start, end, dir } = stageEnds(stage);
  const span = Math.max(1, Math.abs(end - start));
  const tt = segmentKind(stage) === 'tt';
  const marks: StagePrime[] = roadFeatures(stage, oneDay).map((feature) => ({
    at: Math.min(0.99, Math.max(0.01, ((feature.s - start) * dir) / span)),
    kind: feature.kind,
    name: feature.name,
    points: feature.points,
  }));
  marks.push({
    at: 1,
    kind: 'finish',
    name: 'Finish',
    points: FINISH_POINTS.map((_, index) => finishJerseyPoints(index + 1, tt)).filter((pts) => pts > 0),
  });
  return marks;
}

export class Career {
  state: CareerState | null = null;
  tab: CareerTab = 'pick';
  draftTeam = 'slorising';
  draftNation = 'SLO';
  draftFlat = 3.4;
  draftHill = 3.8;
  draftMountain = 4.3;
  /** Month shown on the calendar. Kept in memory so the page stays on the month you opened. */
  calendarMonth: number | null = null;
  /** Team opened from All teams. Null is the list of teams. */
  browseTeam: string | null = null;
  riderSort: { key: string; dir: 1 | -1 } = { key: 'name', dir: 1 };
  /** Standings page: the points tables, or the classifications of races already held. */
  rankSheet: 'rankings' | 'results' = 'rankings';

  load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CareerState;
      if (parsed?.version !== 1 || !parsed.teamId || !teamById(parsed.teamId)) return;
      parsed.history = parsed.history ?? [];
      parsed.champions = parsed.champions ?? {};
      parsed.cont = parsed.cont ?? {};
      parsed.jerseyWear = parsed.jerseyWear ?? {};
      parsed.ttWkg = parsed.ttWkg || 4.6;
      parsed.declined = parsed.declined ?? [];
      parsed.stageNotes = parsed.stageNotes ?? [];
      const freshCalendar = !parsed.enteredSeeded;
      if (freshCalendar) {
        if (parsed.entered.length === 0) {
          const skip = new Set([...parsed.done, ...parsed.skipped]);
          parsed.entered = racesFor(parsed.teamId).filter((id) => !skip.has(id));
        }
        parsed.enteredSeeded = true;
      }
      const adopted = adoptCalendar(parsed);
      const resolved = resolveClashes(parsed.entered, parsed.year);
      const clashed = resolved.length !== parsed.entered.length || resolved.some((id, index) => id !== parsed.entered[index]);
      if (clashed) parsed.entered = resolved;
      const repaired = parsed.active ? repairClassifications(parsed.active) : false;
      this.state = parsed;
      if (freshCalendar || adopted || clashed || repaired) this.save();
      this.tab = parsed.offers?.length ? 'offers' : 'hub';
    } catch {
      this.state = null;
    }
  }

  save(): void {
    if (typeof localStorage === 'undefined' || !this.state) return;
    localStorage.setItem(KEY, JSON.stringify(this.state));
  }

  reset(): void {
    this.state = null;
    this.tab = 'pick';
    this.calendarMonth = null;
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  }

  create(teamId: string, nation: string, flat: number, hill: number, mountain: number): void {
    this.state = blank(teamId, nation, flat, hill, mountain);
    this.tab = 'hub';
    this.calendarMonth = null;
    this.save();
  }

  shiftCalendar(dir: number): void {
    const team = this.team();
    const year = this.state?.year ?? 2026;
    if (!team || !dir) return;
    const months = monthsFor(team.division, year);
    if (!months.length) return;
    const current = months.includes(this.calendarMonth ?? -1) ? this.calendarMonth! : months[0];
    const index = months.indexOf(current) + dir;
    if (index < 0 || index >= months.length) return;
    this.calendarMonth = months[index];
  }

  team() {
    return this.state ? teamById(this.state.teamId) : undefined;
  }

  nextOpen(): RaceDef | undefined {
    return RACES.find((race) => this.state && !this.state.done.includes(race.id));
  }

  nextEntered(): RaceDef | undefined {
    const state = this.state;
    if (!state) return undefined;
    return RACES.find((race) => !state.done.includes(race.id) && state.entered.includes(race.id));
  }

  toggleEnter(raceId: string): string {
    const on = !this.state?.entered.includes(raceId);
    return this.setEnter(raceId, on);
  }

  /** Save a calendar tick. An unticked race stays off and is not offered as the next race. */
  setEnter(raceId: string, on: boolean): string {
    const state = this.state;
    const race = raceById(raceId);
    const team = this.team();
    if (!state || !race || !team || state.done.includes(raceId) || state.active?.raceId === raceId) return '';
    if (!canEnter(race.level, team.division)) return '';
    state.seenRaces = state.seenRaces ?? [];
    state.declined = state.declined ?? [];
    if (!state.seenRaces.includes(raceId)) state.seenRaces.push(raceId);
    const rememberOff = (id: string) => {
      if (!state.declined!.includes(id)) state.declined!.push(id);
    };
    if (!on) {
      state.entered = state.entered.filter((id) => id !== raceId);
      rememberOff(raceId);
      this.save();
      return '';
    }
    state.declined = state.declined.filter((id) => id !== raceId);
    const dropped = state.entered
      .map((id) => raceById(id))
      .filter((other): other is RaceDef => !!other && sharesDay(race, other, state.year));
    const dropIds = new Set(dropped.map((other) => other.id));
    for (const id of dropIds) rememberOff(id);
    state.entered = state.entered.filter((id) => !dropIds.has(id));
    state.entered.push(raceId);
    this.save();
    if (!dropped.length) return '';
    const names = dropped.map((other) => other.name).join(', ');
    return dropped.length > 1 ? `${names} share a day with this race, so they were unticked.` : `${names} is on the same day, so it was unticked.`;
  }

  setDifficulty(flat: number, hill: number, mountain: number): void {
    if (!this.state) return;
    this.state.flatWkg = flat;
    this.state.hillWkg = hill;
    this.state.mountainWkg = mountain;
    this.save();
  }

  setTimeTrial(wkg: number): void {
    if (!this.state) return;
    this.state.ttWkg = wkg;
    this.save();
  }

  setTactic(tactic: CareerState['tactic']): void {
    if (!this.state) return;
    this.state.tactic = tactic;
    this.save();
  }

  toggleSquad(riderId: string): string {
    if (!this.state) return '';
    const note = pickSquad(this.state, riderId);
    this.save();
    return note;
  }

  /** Races you are not riding, up to the next one on your calendar or the end of the year. */
  simulateAhead(): string[] {
    const state = this.state;
    if (!state || state.offers) return [];
    const notes: string[] = [];
    for (const race of RACES) {
      if (state.done.includes(race.id)) continue;
      if (state.entered.includes(race.id)) break;
      notes.push(this.finishSim(race, false));
    }
    this.maybeOffers();
    this.save();
    return notes;
  }

  skipNext(): void {
    const state = this.state;
    if (!state) return;
    const active = state.active;
    if (active && active.stageIndex > 0) return;
    const race = active ? raceById(active.raceId) : this.nextEntered();
    if (!race) return;
    state.entered = state.entered.filter((id) => id !== race.id);
    state.declined = state.declined ?? [];
    if (!state.declined.includes(race.id)) state.declined.push(race.id);
    state.skipped.push(race.id);
    state.active = null;
    this.tab = 'hub';
    this.finishSim(race, true);
    this.maybeOffers();
    this.save();
  }

  openBrief(): void {
    const race = this.nextEntered();
    if (!race || !this.state || this.state.active) {
      this.tab = this.state?.active ? 'brief' : 'calendar';
      return;
    }
    this.simulateAhead();
    this.state.active = {
      raceId: race.id,
      stageIndex: 0,
      gc: [],
      sprint: [],
      kom: [],
      stageWinners: [],
      squad: squadFor(this.state.teamId, race, startMateCount(race)).map((rider) => rider.id),
    };
    this.tab = 'brief';
    this.save();
  }

  launch(profile: RiderProfile): CareerLaunch | null {
    const state = this.state;
    const active = state?.active;
    const race = active ? raceById(active.raceId) : undefined;
    const team = this.team();
    if (!state || !active || !race || !team) return null;
    const stage = race.stages[active.stageIndex];
    if (!stage) return null;
    const { route, start, end, dir, reverse } = stageEnds(stage);
    const finish = segmentFinish(stage);
    const kind = segmentKind(stage);
    const inside = kind === 'road' && !reverse ? climbsOnStage(route, start, end) : [];
    const back = kind === 'road' && reverse ? risesOnCourse(stage) : [];
    const lastEntry = reverse ? back[back.length - 1]?.entry ?? null : inside[inside.length - 1]?.start ?? null;
    const firstEntry = reverse
      ? back.find((climb) => climb.avgGrade >= 0.03 && climb.length > 400)?.entry ?? null
      : inside.find((climb) => climb.avgGrade >= 0.03 && climb.length > 400)?.start ?? null;
    const oneDayRace = race.stages.length === 1;
    const features = roadFeatures(stage, oneDayRace);
    const plan: RoadPlan = {
      flatWkg: state.flatWkg,
      hillWkg: state.hillWkg,
      mountainWkg: state.mountainWkg,
      ttWkg: state.ttWkg,
      oneDay: race.stages.length === 1 && kind === 'road',
      timeTrial: kind === 'tt',
      startS: start,
      finishS: end,
      dir,
      lastClimbS: finish === 'sprint' || lastEntry == null ? null : lastEntry,
      firstClimbS: firstEntry,
      finishKind: finish,
      punchy: kind === 'road' && punchyStage(stage),
      tactic: state.tactic,
      features,
    };
    const recall = race.stages.length > 1 && active.stageIndex > 0 && (active.startList?.length ?? 0) > 0;
    const slots = recall
      ? fieldFromList(active.startList ?? [], team.id)
      : race.level === 'champ'
        ? champField(race, state.nation)
        : aiField(race, team.id, true, active.squad);
    if (race.stages.length > 1 && !recall) {
      active.startList = slots.map((slot) => slot.rider.id);
      this.save();
    }
    const field: RoadStarter[] = slots.map((slot) => starter(slot.rider, slot.teammate, race.level === 'champ'));
    const playerKit = race.level === 'champ'
      ? nationColors(teamKit(team, profile.skin), state.nation)
      : teamKit(team, profile.skin);
    const rankOf = (id: string, name: string): number | undefined => {
      let index = active.gc.findIndex((row) => row.riderId === id);
      if (index < 0) index = active.gc.findIndex((row) => row.name === name);
      return index < 0 ? undefined : index;
    };
    const gapOf = (rank: number | undefined): number | undefined =>
      rank === undefined || !active.gc[0] ? undefined : Math.max(0, active.gc[rank].value - active.gc[0].value);
    const playerBody: RoadBody = {
      riderId: 'player',
      teamId: team.id,
      age: state.age,
      teammate: false,
      attrs: { flat: 70, hills: 70, medium: 70, mountain: 70, tt: 70, sprint: 70, recovery: 70, endurance: 70, stamina: 70 },
      kit: playerKit,
      gcRank: rankOf('player', profile.name),
    };
    playerBody.gcGap = gapOf(playerBody.gcRank);
    for (const rider of field) {
      rider.body.gcRank = rankOf(rider.body.riderId, rider.name);
      rider.body.gcGap = gapOf(rider.body.gcRank);
    }
    const paint = paintContext(state, race, active);
    const dressed = [{ colors: playerKit, sprintPts: 0, komPts: 0, road: playerBody }, ...field.map((r) => ({ colors: r.colors, sprintPts: 0, komPts: 0, road: r.body }))];
    paintKits(dressed, paint);
    if (profile.bike) {
      dressed[0].colors = {
        ...dressed[0].colors,
        frame: profile.bike.frame,
        wheels: profile.bike.wheels,
        bike: profile.bike.bike,
        wheelBrand: profile.bike.wheelBrand ?? profile.bike.bike,
      };
    }
    field.forEach((rider, i) => {
      rider.colors = dressed[i + 1].colors;
    });
    return {
      title: `${race.name} · ${stage.name}`,
      crowd: crowdFor(race),
      route,
      climb: spanClimb(route, start, end, stage.name, `career-${race.id}-${active.stageIndex}`),
      plan,
      field,
      playerBody,
      playerColors: dressed[0].colors,
      paint,
      leaders: active.stageIndex > 0 && race.stages.length > 1 ? {
        time: field.find((rider) => rider.body.badge === 'Y' || rider.body.badge === 'P' || rider.body.badge === 'R')?.name
          ?? (playerBody.badge === 'Y' || playerBody.badge === 'P' || playerBody.badge === 'R' ? profile.name : active.gc[0]?.name ?? ''),
        sprint: field.find((rider) => rider.body.badge === 'S')?.name ?? (playerBody.badge === 'S' ? profile.name : active.sprint[0]?.name ?? ''),
        mountains: field.find((rider) => rider.body.badge === 'M')?.name ?? (playerBody.badge === 'M' ? profile.name : active.kom[0]?.name ?? ''),
      } : undefined,
    };
  }

  commit(rows: StageResultRow[]): { another: boolean; headline: string; classifications: RaceClassifications | null } {
    const state = this.state;
    const active = state?.active;
    const race = active ? raceById(active.raceId) : undefined;
    if (!state || !active || !race) return { another: false, headline: '', classifications: null };
    const player = rows.find((r) => r.isPlayer);
    if (!player || !(player.time > 0)) return { another: false, headline: 'Stage not counted.', classifications: null };
    const stage = race.stages[active.stageIndex];
    const tt = stage ? segmentKind(stage) === 'tt' : false;
    // Time only. The sort is stable, so riders given one bunch time keep the order they crossed the line.
    const ordered = [...rows].sort((a, b) => a.time - b.time);
    const winner = ordered[0];
    const playerPlaceNow = ordered.findIndex((row) => row.isPlayer) + 1;
    state.stageNotes = state.stageNotes ?? [];
    state.stageNotes.push({
      year: state.year,
      raceId: race.id,
      race: race.name,
      stage: stage?.name ?? 'Stage',
      place: playerPlaceNow,
      time: player.time,
    });
    active.stageWinners.push({ name: winner.name, riderId: winner.riderId, label: stage?.name ?? 'Stage' });
    if (race.stages.length > 1) addWin(state, winner.isPlayer ? 'player' : winner.riderId);

    active.gc = mergeTime(active.gc, ordered, active.stageIndex);
    // A stage race keeps intermediate sprints and the climbs. A one-day race pays at the finish only:
    // sprint points always, and mountain points as well when the finish is up the climb.
    const oneDay = race.stages.length === 1;
    const climbFinish = oneDay && !!stage && segmentKind(stage) === 'road' && segmentFinish(stage) !== 'sprint';
    const finishPts = (index: number) => finishJerseyPoints(index + 1, tt);
    const sprintRows = ordered.map((row, index) => ({ ...row, sprint: (oneDay ? 0 : row.sprint) + finishPts(index), kom: 0 }));
    const mountainRows = ordered.map((row, index) => ({ ...row, sprint: 0, kom: climbFinish ? finishPts(index) : oneDay ? 0 : row.kom }));
    active.sprint = mergePoints(active.sprint, sprintRows, 'sprint');
    active.kom = mergePoints(active.kom, mountainRows, 'kom');
    active.stageIndex += 1;

    if (race.stages.length > 1) {
      ordered.slice(0, 12).forEach((row, index) => addCyb(state, race, row, cybPoints(race, 'stage', index + 1)));
    }
    const classifications = race.stages.length > 1 ? {
      time: active.gc.map((row) => ({ ...row })),
      sprint: active.sprint.map((row) => ({ ...row })),
      mountains: active.kom.map((row) => ({ ...row })),
      done: active.stageIndex,
      stages: race.stages.length,
    } : null;

    if (active.stageIndex < race.stages.length) {
      this.save();
      return { another: true, headline: `${winner.name} wins the stage. You are ${placeOf(active.gc, 'player')} on time.`, classifications };
    }

    const gcWinner = active.gc[0];
    const overall = race.stages.length === 1 ? ordered : active.gc;
    overall.slice(0, 15).forEach((row, index) => addCyb(state, race, row, cybPoints(race, 'overall', index + 1)));
    if (gcWinner) addWin(state, gcWinner.riderId === 'player' ? 'player' : gcWinner.riderId);
    const playerPlace = placeOf(overall, 'player');
    if (playerPlace > 0 && playerPlace <= 10) {
      state.palmares.push({
        year: state.year,
        raceId: race.id,
        name: race.name,
        place: playerPlace,
        kind: race.champ ? 'champ' : race.stages.length > 1 ? 'overall' : 'one-day',
      });
    }
    if (race.champ && gcWinner) {
      if (race.champ === 'world-road') state.champions.worldRoad = gcWinner.riderId;
      if (race.champ === 'world-tt') state.champions.worldTt = gcWinner.riderId;
      if (race.champ === 'euro-road') state.champions.euroRoad = gcWinner.riderId;
      if (race.champ === 'euro-tt') state.champions.euroTt = gcWinner.riderId;
    }
    if (gcWinner && (race.jerseys === 'yellow' || race.jerseys === 'pink' || race.jerseys === 'red')) {
      state.jerseyWear = { ...(state.jerseyWear ?? {}), [race.jerseys]: gcWinner.riderId === 'player' ? 'player' : gcWinner.riderId };
    }
    const podium = podiumOf(overall);
    state.races.push({
      raceId: race.id,
      name: race.name,
      year: state.year,
      winnerId: gcWinner?.riderId ?? winner.riderId,
      winnerName: gcWinner?.name ?? winner.name,
      winnerTeam: teamById(gcWinner?.teamId ?? winner.teamId)?.name ?? '',
      podium,
      playerPlace: playerPlace || null,
      skipped: false,
      time: sheetOf(overall.map((row) => ({ riderId: row.riderId, name: row.name, teamId: row.teamId, value: 'time' in row ? row.time : row.value }))),
      sprint: sheetOf(active.sprint, true),
      mountains: sheetOf(active.kom, true),
    });
    state.done.push(race.id);
    state.entered = state.entered.filter((id) => id !== race.id);
    state.active = null;
    this.maybeOffers();
    this.tab = state.offers ? 'offers' : 'hub';
    this.save();
    const where = playerPlace ? ` You finished ${playerPlace}.` : '';
    return { another: false, headline: `${gcWinner?.name ?? winner.name} wins ${race.name}.${where}`, classifications };
  }

  acceptOffer(teamId: string): void {
    const state = this.state;
    if (!state?.offers?.some((offer) => offer.teamId === teamId)) return;
    state.history = [...state.history, ...state.races.map((race) => ({ ...race, time: undefined, sprint: undefined, mountains: undefined }))];
    state.teamId = teamId;
    state.year += 1;
    state.age += 1;
    const next = racesFor(teamId);
    state.entered = next;
    state.seenRaces = [...next];
    state.declined = [];
    state.enteredSeeded = true;
    state.done = [];
    state.skipped = [];
    state.active = null;
    state.races = [];
    state.cyb = {};
    state.cont = {};
    state.jerseyWear = {};
    state.wins = {};
    state.teamPoints = {};
    state.offers = null;
    this.tab = 'hub';
    this.save();
  }

  private finishSim(race: RaceDef, skipped: boolean): string {
    const state = this.state;
    if (!state) return '';
    const sim = simulateRace(race, state.year, state.nation);
    applySim(state, race, sim, skipped);
    const winner = sim.overall[0];
    return `${race.name}: ${winner?.name ?? 'no result'} (${formatDate(race.month, race.day)})`;
  }

  private maybeOffers(): void {
    const state = this.state;
    if (!state || state.offers || state.active) return;
    if (RACES.some((race) => !state.done.includes(race.id))) return;
    // Pro and Continental results count too, or a Continental rider could only move up through championships.
    state.offers = buildOffers(offerPoints(state.cyb.player ?? 0, state.cont?.player ?? 0), state.teamId);
    this.tab = 'offers';
  }
}

function starter(rider: Rider, teammate: boolean, national: boolean): RoadStarter {
  const team = teamById(rider.teamId);
  const base = team ? teamKit(team) : teamKit(teamById('atlas')!);
  const kit = national ? nationColors(base, rider.country) : base;
  const name = riderName(rider);
  return {
    name,
    country: rider.country,
    team: team?.name ?? rider.teamId,
    mass: rider.mass,
    colors: { ...kit },
    body: { riderId: rider.id, teamId: rider.teamId, age: rider.age, teammate, attrs: rider.attrs, kit },
  };
}

function paintContext(state: CareerState, race: RaceDef, active: ActiveRace): PaintContext {
  const overnight = active.stageIndex > 0 && race.stages.length > 1;
  const jersey = !overnight ? 'none' : race.jerseys === 'pink' || race.jerseys === 'red' ? race.jerseys : 'yellow';
  return {
    gcId: overnight ? active.gc[0]?.riderId ?? null : null,
    gcOrder: overnight ? active.gc.map((row) => row.riderId) : [],
    youthIds: overnight ? active.gc.filter((row) => row.age <= 25).map((row) => row.riderId) : [],
    sprintBase: overnight ? Object.fromEntries(active.sprint.map((row) => [row.riderId, row.value])) : {},
    komBase: overnight ? Object.fromEntries(active.kom.map((row) => [row.riderId, row.value])) : {},
    jersey,
    champions: state.champions,
    tour: state.jerseyWear ?? {},
  };
}

function spanClimb(route: Route, start: number, end: number, name: string, id: string): Climb {
  const span = Math.abs(end - start);
  const gain = route.elevationAt(end) - route.elevationAt(start);
  return {
    id,
    name,
    inspiredBy: name,
    start,
    end,
    length: Math.max(1, span),
    gain,
    avgGrade: gain / Math.max(1, span),
    maxGrade: 0.08,
    startElevation: route.elevationAt(start),
    summitElevation: route.elevationAt(end),
  };
}

function crowdFor(race: RaceDef): CrowdLevel {
  if (race.champ || (race.level === 'world' && race.stages.length >= 6)) return 'grand';
  if (race.level === 'world') return 'busy';
  if (race.level === 'pro') return 'normal';
  return 'quiet';
}

/** The same rider can arrive under a roster id on one stage and under their name on another. */
function sameRider(row: { riderId: string; name: string }): string {
  if (row.riderId === 'player') return 'player';
  return row.name;
}

function rememberId(row: ClassRow, incomingId: string): void {
  if (row.riderId !== 'player' && riderById(incomingId)) row.riderId = incomingId;
}

function collapseRows(rows: ClassRow[], order: 'asc' | 'desc'): ClassRow[] {
  const map = new Map<string, ClassRow>();
  for (const row of rows) {
    const key = sameRider(row);
    const had = map.get(key);
    if (!had) map.set(key, { ...row });
    else {
      had.value += row.value;
      if (had.places != null || row.places != null) had.places = (had.places ?? 0) + (row.places ?? 0);
      if (had.stages != null || row.stages != null) had.stages = (had.stages ?? 0) + (row.stages ?? 0);
      rememberId(had, row.riderId);
    }
  }
  return [...map.values()].sort((a, b) =>
    order === 'asc'
      ? a.value - b.value || (a.places ?? 0) - (b.places ?? 0)
      : b.value - a.value || a.name.localeCompare(b.name));
}

/** Add split stage rows back together. Returns true when a total changed. */
export function repairClassifications(active: ActiveRace): boolean {
  const before = JSON.stringify([active.gc, active.sprint, active.kom]);
  active.gc = collapseRows(active.gc, 'asc');
  active.sprint = collapseRows(active.sprint, 'desc');
  active.kom = collapseRows(active.kom, 'desc');
  return before !== JSON.stringify([active.gc, active.sprint, active.kom]);
}

/**
 * Overall time after one more stage. `rows` is the stage result in crossing order and
 * `stagesBefore` the number of stages already in `prev`. Equal times are split on the sum of
 * stage places, never on the name. A rider with no time on this stage (or an earlier one)
 * leaves the classification instead of keeping a shorter total. A rider who arrives under a
 * roster id on one stage and under their name on another is still one row.
 */
export function mergeTime(
  prev: ClassRow[],
  rows: { riderId: string; name: string; teamId: string; country: string; age: number; time: number }[],
  stagesBefore = 0,
): ClassRow[] {
  // Saves from before stages were counted list only riders who had every stage so far.
  const map = new Map<string, ClassRow & { places: number; stages: number }>();
  for (const row of collapseRows(prev, 'asc')) map.set(sameRider(row), { ...row, places: row.places ?? 0, stages: row.stages ?? stagesBefore });
  rows.forEach((row, index) => {
    const place = index + 1;
    const key = sameRider(row);
    const had = map.get(key);
    if (had) {
      had.value += row.time;
      had.places += place;
      had.stages += 1;
      rememberId(had, row.riderId);
    } else map.set(key, { riderId: row.riderId, name: row.name, teamId: row.teamId, country: row.country, age: row.age, value: row.time, places: place, stages: 1 });
  });
  const need = stagesBefore + 1;
  return [...map.values()].filter((row) => row.stages >= need).sort((a, b) => a.value - b.value || a.places - b.places);
}

function mergePoints(prev: ClassRow[], rows: { riderId: string; name: string; teamId: string; country: string; age: number; sprint: number; kom: number }[], key: 'sprint' | 'kom'): ClassRow[] {
  const map = new Map<string, ClassRow>();
  const add = (row: ClassRow) => {
    const id = sameRider(row);
    const had = map.get(id);
    if (!had) map.set(id, { ...row });
    else {
      had.value += row.value;
      rememberId(had, row.riderId);
    }
  };
  for (const row of collapseRows(prev, 'desc')) add(row);
  for (const row of rows) {
    const gain = row[key];
    if (gain <= 0 && !map.has(sameRider(row))) continue;
    if (gain <= 0) continue;
    add({ riderId: row.riderId, name: row.name, teamId: row.teamId, country: row.country, age: row.age, value: gain });
  }
  return [...map.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function placeOf(rows: { riderId: string }[], id: string): number {
  const index = rows.findIndex((row) => row.riderId === id);
  return index < 0 ? 0 : index + 1;
}

function addWin(state: CareerState, riderId: string): void {
  state.wins[riderId] = (state.wins[riderId] ?? 0) + 1;
}

function addCyb(state: CareerState, race: RaceDef, row: { riderId: string; teamId: string; isPlayer?: boolean }, points: number): void {
  if (points <= 0) return;
  const id = row.isPlayer || row.riderId === 'player' ? 'player' : row.riderId;
  const continental = race.level === 'pro' || race.level === 'continental';
  const book = continental ? (state.cont ??= {}) : state.cyb;
  book[id] = (book[id] ?? 0) + points;
  if (row.teamId) state.teamPoints[row.teamId] = (state.teamPoints[row.teamId] ?? 0) + points;
}

function applySim(state: CareerState, race: RaceDef, sim: SimRace, skipped: boolean): void {
  const award = (rows: SimRow[], kind: 'overall' | 'stage') => {
    rows.slice(0, 15).forEach((row, index) => addCyb(state, race, row, cybPoints(race, kind, index + 1)));
  };
  if (race.stages.length === 1) award(sim.overall, 'overall');
  else {
    for (const stage of sim.stages) {
      award(stage.rows, 'stage');
      const winner = stage.rows[0];
      if (winner) addWin(state, winner.riderId);
    }
    award(sim.overall, 'overall');
  }
  const winner = sim.overall[0];
  if (winner) addWin(state, winner.riderId);
  if (race.champ && winner) {
    if (race.champ === 'world-road') state.champions.worldRoad = winner.riderId;
    if (race.champ === 'world-tt') state.champions.worldTt = winner.riderId;
    if (race.champ === 'euro-road') state.champions.euroRoad = winner.riderId;
    if (race.champ === 'euro-tt') state.champions.euroTt = winner.riderId;
  }
  const saved: SavedRace = {
    raceId: race.id,
    name: race.name,
    year: state.year,
    winnerId: winner?.riderId ?? '',
    winnerName: winner?.name ?? '—',
    winnerTeam: teamById(winner?.teamId ?? '')?.name ?? '',
    podium: podiumOf(sim.overall),
    playerPlace: null,
    skipped,
    time: sim.overall.map((row) => ({ riderId: row.riderId, name: row.name, teamId: row.teamId, value: row.time })),
    sprint: [...sim.overall].filter((row) => row.sprint > 0).sort((a, b) => b.sprint - a.sprint || a.name.localeCompare(b.name)).map((row) => ({ riderId: row.riderId, name: row.name, teamId: row.teamId, value: row.sprint })),
    mountains: [...sim.overall].filter((row) => row.kom > 0).sort((a, b) => b.kom - a.kom || a.name.localeCompare(b.name)).map((row) => ({ riderId: row.riderId, name: row.name, teamId: row.teamId, value: row.kom })),
  };
  state.races.push(saved);
  state.done.push(race.id);
}

export function teammatesFor(state: CareerState): { id: string; name: string; program: string }[] {
  const race = state.active ? raceById(state.active.raceId) : undefined;
  if (!race) return [];
  const chosen = state.active?.squad;
  const riders = chosen?.length
    ? chosen.map((id) => riderById(id)).filter((rider): rider is NonNullable<typeof rider> => !!rider)
    : squadFor(state.teamId, race, startMateCount(race));
  return riders.map((rider) => ({ id: rider.id, name: riderName(rider), program: rider.program }));
}

/** Pick or drop a teammate before the first stage. The start list has a fixed size. */
export function pickSquad(state: CareerState, riderId: string): string {
  const active = state.active;
  const race = active ? raceById(active.raceId) : undefined;
  if (!active || !race || active.stageIndex > 0) return '';
  const need = startMateCount(race);
  const squad = active.squad ?? squadFor(state.teamId, race, need).map((rider) => rider.id);
  if (squad.includes(riderId)) {
    active.squad = squad.filter((id) => id !== riderId);
    return '';
  }
  if (squad.length >= need) return `The start list is ${need} teammates. Untick one first.`;
  active.squad = [...squad, riderId];
  return '';
}

export function teamRanking(
  points: Record<string, number>,
  divisions: Division[],
  limit: number,
  pinId = '',
): { id: string; name: string; division: Division; value: number; place: number }[] {
  const ranked = Object.entries(points)
    .flatMap(([id, value]) => {
      const team = teamById(id);
      return team && divisions.includes(team.division) ? [{ id, name: team.name, division: team.division, value }] : [];
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .map((row, index) => ({ ...row, place: index + 1 }));
  const shown = ranked.slice(0, limit);
  if (!pinId || shown.some((row) => row.id === pinId)) return shown;
  const mine = ranked.find((row) => row.id === pinId);
  return mine ? [...shown, mine] : shown;
}

export function rankingRows(map: Record<string, number>, limit: number, playerName = 'You'): { id: string; name: string; team: string; value: number }[] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, value]) => {
      if (id === 'player') return { id, name: playerName || 'You', team: '', value };
      const rider = riderById(id);
      return { id, name: rider ? riderName(rider) : id, team: teamById(rider?.teamId ?? '')?.name ?? '', value };
    });
}

export function palmaresOf(state: CareerState): PalmaresEntry[] {
  return [...state.palmares].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name));
}

export { raceEnd, stageKm };
