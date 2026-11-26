import { steadySpeed, type BikeParams } from '../physics/cycling';
import { clamp } from '../util/math';
import {
  brainFor, breakPace, finaleStart, catchRemaining, chaseCap, chaseSpeedNeeded, criticalRatio, dayForm, descentSkill, factorForSpeed,
  hash01, kickPeakWkg, launchDistance, reserveBudget, sprintCurve, sprintHold, sprintPeakWkg, tickReserve,
  type FieldPeers, type RaceBrain, type SurgeKind,
} from './raceBrain';
import type { RiderColors } from '../world/riders';

/** Seconds between two riders on a time-trial ramp. */
export const TT_GAP = 5;

/**
 * Time-trial start list. Riders with no overall time go first.
 * The leader, rank 0, leaves last.
 */
export function ttStartOrder<T extends { name: string; gcRank?: number }>(riders: T[]): T[] {
  return [...riders].sort((a, b) => {
    const aRank = a.gcRank;
    const bRank = b.gcRank;
    const aSet = aRank != null;
    const bSet = bRank != null;
    if (aSet !== bSet) return aSet ? 1 : -1;
    if (aRank != null && bRank != null && aRank !== bRank) return bRank - aRank;
    return a.name.localeCompare(b.name);
  });
}

/** The nine ratings that set an AI rider. 78 is enough to hold the pace you chose. */
export interface RaceAttrs {
  flat: number;
  hills: number;
  medium: number;
  mountain: number;
  tt: number;
  sprint: number;
  recovery: number;
  endurance: number;
  stamina: number;
}

export interface RoadBody {
  riderId: string;
  teamId: string;
  age: number;
  teammate: boolean;
  attrs: RaceAttrs;
  /** Trade kit, national kit, or the jersey they started the stage in. Classification paint restores this. */
  kit: RiderColors;
  /** Leader jersey worn into this stage: Y pink-tour yellow, P, R, S points, M mountains, W youth, C world, E Europe. */
  badge?: string;
  /** Place in the overall before this stage. 0 is the leader. Missing when they have no time yet. */
  gcRank?: number;
  /** Seconds behind the overall leader before this stage. Set with gcRank. */
  gcGap?: number;
}

export interface RoadFeature {
  s: number;
  kind: 'sprint' | 'kom';
  name: string;
  points: number[];
  awarded: boolean;
  /** Points already given, in the order riders crossed the line. */
  scored: { id: number; name: string; pts: number }[];
  /** Race time when the last point was given. The list fades after this. */
  doneAt: number | null;
}

export type RoadTactic = 'sprint' | 'climb' | 'control';
export type RoadFinish = 'sprint' | 'hill' | 'mountain';

export interface RoadPlan {
  flatWkg: number;
  hillWkg: number;
  mountainWkg: number;
  /** Effort a time trial is ridden at. Riders scale it by their time-trial rating. */
  ttWkg?: number;
  oneDay: boolean;
  timeTrial: boolean;
  startS: number;
  finishS: number;
  /** 1 rides toward higher metres. -1 rides the same road back toward the start. */
  dir?: 1 | -1;
  lastClimbS: number | null;
  /** Stay together on the flat until this point. Null when the stage has no real climb. */
  firstClimbS?: number | null;
  finishKind: RoadFinish;
  tactic: RoadTactic;
  features: RoadFeature[];
  /** Short walls. The riders who do both hills and a sprint are the ones who matter. */
  punchy?: boolean;
}

export interface RoadOrders {
  paceOn: boolean;
  paceWkg: number;
  waitOn: boolean;
  /** Once you touch the buttons, they replace the plan agreed before the stage. */
  manual: boolean;
  /** Fast-forward to the end: teammates ride their own race instead of waiting for, or holding back near, the player. */
  released?: boolean;
}

export interface RoadStarter {
  name: string;
  country: string;
  team: string;
  mass: number;
  colors: RiderColors;
  body: RoadBody;
}

/** The slice of a rider the road brain is allowed to change. */
export interface RoadActor {
  id: number;
  name: string;
  isPlayer: boolean;
  s: number;
  /** Sideways position on the road. Riders in the same file keep FILE_SPACING. */
  lat: number;
  v: number;
  mass: number;
  bike: BikeParams;
  mode: string;
  targetPower: number;
  finishTime: number | null;
  officialTime: number | null;
  sprintPts: number;
  komPts: number;
  told: boolean;
  phase: number;
  road: RoadBody | null;
  /** Fraction of this rider's stamina bar still left. 1 is full. */
  energy?: number;
  /** Surge reserve, 0 to 1: what is left for attacks and for following them. See tickReserve. */
  reserve?: number;
  /** W/kg it costs to hold the group this step, set by shapeRoad. Undefined when the rider is not in a group. */
  effort?: number;
  /** On the last climb, the share of the bunch pace this rider rides when they are not racing for the win. Set by decideRoad. */
  climbShare?: number;
}

const HOLD = 78;

/** Speed (m/s) at which the group's slot drift is at full strength. Slower than this it shrinks with the speed. */
const DRIFT_PACE = 9;

/** Above this speed (60 km/h) pedalling on a descent no longer adds much; riders chasing on a descent pedal below it. */
const SPIN_OUT = 60 / 3.6;

/** Riders closer than this to the rider ahead ride in the same group. The gap bar in the HUD uses it too. */
export const ROAD_GROUP_M = 16;

/** Wheel to wheel along one file of riders. A bike is about 1.7 m long, so this leaves a small gap. */
export const FILE_SPACING = 2.2;
/** Riders closer than this sideways are in the same file and must keep FILE_SPACING. */
export const FILE_WIDTH = 0.6;
/** The first riders of a group ride one line; everyone after spreads across the road. */
export const LINE_LENGTH = 5;
/** Along-road step between slots once the group spreads across the road (about six files wide). */
const SPREAD_STEP = 1.2;

/** How far behind the nose a group slot sits. The single line at the front keeps FILE_SPACING. */
export function slotOffset(slot: number): number {
  if (slot < LINE_LENGTH) return slot * FILE_SPACING;
  return (LINE_LENGTH - 1) * FILE_SPACING + (slot - LINE_LENGTH + 1) * SPREAD_STEP;
}

/**
 * Where each rider of a group rides, counted from the front: the riders who should be ahead of them
 * (a lower slot) and already are. `bySDesc` is the group from the front of the road back.
 */
export function roadPlaces<T>(bySDesc: T[], slot: Map<T, number>): Map<T, number> {
  const size = bySDesc.length;
  const tree = new Array<number>(size + 1).fill(0);
  const out = new Map<T, number>();
  for (const rider of bySDesc) {
    const own = slot.get(rider) ?? 0;
    let count = 0;
    for (let i = Math.min(own, size); i > 0; i -= i & -i) count += tree[i];
    out.set(rider, count);
    for (let i = own + 1; i <= size; i += i & -i) tree[i]++;
  }
  return out;
}

/** A flat time trial uses the time-trial rating. A mountain time trial uses that and the mountains, equally. */
export function trialRating(attrs: Pick<RaceAttrs, 'tt' | 'mountain'>, finish: RoadFinish): number {
  return finish === 'mountain' ? (attrs.tt + attrs.mountain) / 2 : attrs.tt;
}

export function trialFactor(attrs: Pick<RaceAttrs, 'tt' | 'mountain'>, finish: RoadFinish): number {
  return clamp(trialRating(attrs, finish) / HOLD, 0.72, 1);
}

/**
 * A short wall needs both. A high score in only one of the two does not carry the day.
 * The lower attribute counts for most of it.
 */
export function punchScore(attrs: Pick<RaceAttrs, 'hills' | 'sprint'>): number {
  const low = Math.min(attrs.hills, attrs.sprint);
  const high = Math.max(attrs.hills, attrs.sprint);
  return low * 0.72 + high * 0.28;
}

/** What matters at the front on this stage: the sprint, the hills, the punch, or the high mountains. */
export function stageStrength(attrs: RaceAttrs, finish: RoadFinish, punchy = false): number {
  if (finish === 'mountain') return attrs.mountain;
  if (finish === 'hill') return punchy ? punchScore(attrs) : attrs.hills;
  return attrs.sprint;
}

/** Best rider each team has brought to this race, for the way the stage finishes. */
export function teamTempoRank(field: { road: RoadBody | null }[], finish: RoadFinish, punchy = false): Map<string, number> {
  const best = new Map<string, number>();
  for (const rider of field) {
    if (!rider.road) continue;
    const score = stageStrength(rider.road.attrs, finish, punchy);
    best.set(rider.road.teamId, Math.max(best.get(rider.road.teamId) ?? 0, score));
  }
  return best;
}

/**
 * Teams that brought the strongest rider for this finish take the front.
 * Their helpers sit ahead of that leader. Everyone else keeps the order they already have.
 */
export type EnergyPlace = 'draft' | 'bunch' | 'front' | 'break';

/**
 * One tick of the stamina bar.
 * Sitting in the group at or under the pace you set costs nothing. Easy pedalling puts a little back.
 * The front of a group and a breakaway are in the wind: about 40% of the bar every 10 minutes at that
 * pace for a typical rider. Stamina is the size of the tank, endurance is how thriftily they spend it.
 */
export function tickEnergy(
  energy: number,
  attrs: Pick<RaceAttrs, 'stamina' | 'endurance' | 'recovery'>,
  wkg: number,
  tempo: number,
  place: EnergyPlace,
  dt: number,
  climbTax = 1,
): number {
  const relative = wkg / Math.max(1.2, tempo);
  const enduranceMul = clamp(1.32 - attrs.endurance / 145, 0.58, 1.22);
  const tank = 0.55 + attrs.stamina / 115;
  const sheltered = place === 'draft' || place === 'bunch';
  let next = energy;
  if (sheltered && relative < 0.9) {
    // About 15% back in five minutes at half the set pace, for a typical recovery.
    next += (attrs.recovery / 80) * 0.00127 * (0.95 - relative) * dt;
  }
  if (sheltered && relative <= 1) return clamp(next, 0, 1);
  const refTank = 0.55 + 70 / 115;
  const refEndurance = clamp(1.32 - 70 / 145, 0.58, 1.22);
  const wind = (0.4 / 600) * (refTank / refEndurance);
  const effort = relative < 0.65 ? relative * 0.35 : Math.pow(Math.max(0, relative), 1.7);
  next -= wind * effort * (sheltered ? 0.35 : 1) * enduranceMul / tank * dt * climbTax;
  return clamp(next, 0, 1);
}

/** Fraction of the bunch pace a clear break holds. A fresh move keeps a small edge. A tired move falls under the pace. */
export function breakFactor(energy: number): number {
  if (energy >= 0.75) return 1.04;
  if (energy >= 0.45) return 1.04 + (1 - 1.04) * ((0.75 - energy) / 0.3);
  if (energy >= 0.15) return 1 + (0.86 - 1) * ((0.45 - energy) / 0.3);
  return 0.84;
}

/** Where the lead-out trains take the front: about 13% of the stage from the line, 1.5 to 3 km. */
export function sprintRampFrom(stageLength: number): number {
  return clamp(stageLength * 0.13, 1500, 3000);
}

/**
 * Speed of the front of the bunch on a flat sprint finish, as a multiple of the flat slider.
 * The lead-out riders are in the wind at these numbers; a rider sitting in the wheels, the player
 * included, rides about the slider at the speed they give. The chase of a break is separate (chaseFactor).
 */
export function flatRunIn(plan: RoadPlan, remaining: number, gapSec: number, grade: number): number {
  void gapSec;
  if (plan.timeTrial || plan.finishKind !== 'sprint' || grade < -0.02 || grade >= 0.035) return 1;
  const from = sprintRampFrom(Math.abs(plan.finishS - plan.startS));
  if (remaining <= 500) return 1.38;
  if (remaining <= 1000) return 1.28;
  if (remaining <= from) return 1.15;
  return 1;
}

/** Fraction taken off the climb pace on the last climb. Rating does most of it. A low bar adds a little, and a bar above 65% adds none. */
export function lastClimbDrop(gap: number, energy: number): number {
  const rating = Math.min(0.26, Math.max(0, gap) / 55);
  const tired = energy < 0.65 ? 0.12 * clamp((0.65 - energy) / 0.3, 0, 1) : 0;
  return Math.min(0.34, rating + tired);
}

export interface WindSlot {
  index: number;
  size: number;
}

/** Groups of riders within 16 m, nose first. The first five of a group are the wind. */
export function assignWindSlots<T extends { s: number }>(riders: T[], along: (s: number) => number): Map<T, WindSlot> {
  const sorted = [...riders].sort((a, b) => along(b.s) - along(a.s));
  const out = new Map<T, WindSlot>();
  let group: T[] = [];
  const stamp = () => {
    for (let index = 0; index < group.length; index++) out.set(group[index], { index, size: group.length });
    group = [];
  };
  for (const rider of sorted) {
    const prev = group[group.length - 1];
    if (prev && along(prev.s) - along(rider.s) > ROAD_GROUP_M) stamp();
    group.push(rider);
  }
  if (group.length) stamp();
  return out;
}

/** In the wind, or sitting in. A protected leader near the front is still sitting in. */
export function staminaPlace(mode: string, draft: number, energy: number, slot: WindSlot | null, sheltered: boolean): EnergyPlace {
  if (mode === 'attack') return 'break';
  if (mode === 'sprint' && draft < 0.1 && energy >= 0.3) return 'break';
  if (!slot || slot.size < 2) return 'front';
  if (slot.index < LINE_LENGTH && !sheltered) return 'front';
  return 'draft';
}

/** The leader of the race: first overall, or in a leader's jersey. They ride in the bunch, not in early moves. */
export function leadsRace(body: RoadBody | null | undefined): boolean {
  if (!body) return false;
  return body.gcRank === 0 || body.badge === 'Y' || body.badge === 'P' || body.badge === 'R';
}

/** The best rider on a team for this finish stays out of the wind, and so does the leader of the race. */
export function isProtectedRider(rider: { road: RoadBody | null }, field: { road: RoadBody | null }[], plan: RoadPlan): boolean {
  if (!rider.road) return false;
  if (leadsRace(rider.road)) return true;
  const own = stageStrength(rider.road.attrs, plan.finishKind, plan.punchy);
  const best = Math.max(own, teamBestCached(field, plan).get(rider.road.teamId) ?? 0);
  return own >= best - 1 && best >= 68;
}

/**
 * teamTempoRank, kept per field. Ratings and teams don't change during a race, so it is only rebuilt
 * when the field grows or the finish changes. isProtectedRider runs for many riders every step.
 */
const teamBestCache = new WeakMap<object, { size: number; finish: RoadFinish; punchy: boolean; best: Map<string, number> }>();
function teamBestCached(field: { road: RoadBody | null }[], plan: RoadPlan): Map<string, number> {
  const punchy = !!plan.punchy;
  const hit = teamBestCache.get(field);
  if (hit && hit.size === field.length && hit.finish === plan.finishKind && hit.punchy === punchy) return hit.best;
  const best = teamTempoRank(field, plan.finishKind, punchy);
  teamBestCache.set(field, { size: field.length, finish: plan.finishKind, punchy, best });
  return best;
}

/** Metres of one pull before the next riders take the wind. About three minutes at the flat. */
const PULL_M = 1600;

/**
 * A rider who should be further forward works this many places ahead of where they ride. The places
 * in between each move back one step, so the bunch never holds an empty place open for someone
 * still stuck behind other riders: an empty place at the front is a hole the riders behind line up
 * behind, and from behind that looks like a small break.
 */
const ENGINE_LIFT = 8;
/** The next riders to take the wind come up through the bunch this many places at a time. */
const WIND_LIFT = 20;

/**
 * A few riders take the wind, then the next few. On a sprint finish that is the sprint teams
 * and, unless the order is to climb, the player's helpers. The protected rider does not pull.
 * A rider whose turn it is but who is further back comes up through the bunch first.
 */
export function orderPull(
  ordered: RoadActor[],
  field: RoadActor[],
  plan: RoadPlan,
  alongM: number,
  rank: Map<string, number>,
  ahead: (rider: RoadActor) => number = (rider) => rider.s,
): RoadActor[] {
  const bestTeam = ordered.reduce((best, rider) => Math.max(best, rank.get(rider.road?.teamId ?? '') ?? 0), 0);
  const pullers = ordered.filter((rider) => {
    if (rider.isPlayer || !rider.road || isProtectedRider(rider, field, plan)) return false;
    if ((rider.energy ?? 1) < 0.3 || (rider.climbShare ?? 1) < 1) return false;
    if (plan.finishKind !== 'sprint') return true;
    if (rider.road.teammate && plan.tactic === 'climb') return false;
    const helping = rider.road.teammate && plan.tactic !== 'climb';
    const team = rank.get(rider.road.teamId) ?? 0;
    const own = stageStrength(rider.road.attrs, plan.finishKind, plan.punchy);
    return helping || (team >= bestTeam - 8 && own >= team - 14 && own >= 54);
  });
  if (!pullers.length) return ordered;
  // A fixed order, so the turn changes only when the pull is over, not when riders swap places.
  pullers.sort((a, b) => a.id - b.id);
  const turn = Math.floor(Math.max(0, alongM) / PULL_M) % pullers.length;
  const wind: RoadActor[] = [];
  for (let i = 0; i < Math.min(LINE_LENGTH, pullers.length); i++) {
    const rider = pullers[(turn + i) % pullers.length];
    if (!wind.includes(rider)) wind.push(rider);
  }
  void ahead;
  const coming = new Set(wind);
  const place = new Map(ordered.map((rider, index) => [rider, index]));
  const key = (rider: RoadActor) => place.get(rider)! - (coming.has(rider) ? WIND_LIFT : 0);
  return [...ordered].sort((a, b) => key(a) - key(b) || place.get(a)! - place.get(b)!);
}

/**
 * The order of a group from the front: where the riders are, with the riders of the teams that set
 * the tempo working their way towards the front a few places at a time.
 */
export function tempoOrder(
  group: RoadActor[],
  rank: Map<string, number>,
  finish: RoadFinish,
  punchy = false,
  ahead: (rider: RoadActor) => number = (rider) => rider.s,
): RoadActor[] {
  const bestTeam = group.reduce((best, rider) => Math.max(best, rank.get(rider.road?.teamId ?? '') ?? 0), 0);
  const physical = [...group].sort((a, b) => ahead(b) - ahead(a));
  const key = new Map<RoadActor, number>();
  physical.forEach((rider, index) => {
    const team = rank.get(rider.road?.teamId ?? '') ?? 0;
    const own = rider.road ? stageStrength(rider.road.attrs, finish, punchy) : 0;
    const engine = team >= bestTeam - 8 && own >= team - 14 && own >= 54;
    key.set(rider, index - (engine ? ENGINE_LIFT : 0));
  });
  const index = new Map(physical.map((rider, i) => [rider, i]));
  return physical.sort((a, b) => key.get(a)! - key.get(b)! || index.get(a)! - index.get(b)!);
}

export function shareFinishTimes(times: number[], gapSec = 1): number[] {
  const order = times.map((t, i) => ({ t, i })).filter((row) => Number.isFinite(row.t)).sort((a, b) => a.t - b.t);
  const out = new Array<number>(times.length).fill(0);
  if (!order.length) return out;
  let cluster = order[0].t;
  let prev = order[0].t;
  for (const row of order) {
    if (row.t - prev > gapSec) cluster = row.t;
    out[row.i] = cluster;
    prev = row.t;
  }
  return out;
}

/**
 * Official times. A time trial is each rider's own ride, from crossing the start line to crossing the finish.
 * A road stage gives one time to every rider in a bunch.
 */
export function sealGroupTimes(
  field: { finishTime: number | null; officialTime: number | null; startTime?: number | null }[],
  timeTrial: boolean,
): void {
  const done = field.filter((r) => r.finishTime != null);
  if (!done.length) return;
  if (timeTrial) {
    for (const r of done) r.officialTime = (r.finishTime ?? 0) - (r.startTime ?? 0);
    return;
  }
  const official = shareFinishTimes(done.map((r) => r.finishTime ?? 0));
  done.forEach((r, i) => {
    r.officialTime = official[i];
  });
}

export function terrainKind(grade: number): 'flat' | 'hill' | 'medium' | 'mountain' {
  if (grade < 0.03) return 'flat';
  if (grade < 0.05) return 'hill';
  if (grade < 0.07) return 'medium';
  return 'mountain';
}

/**
 * Share of the flat W/kg the bunch pedals at on a descent, by slope: [grade, share].
 * Gentle descents stay close to the flat effort. Steep ones taper to a tuck with no pedalling,
 * where gravity sets the speed and the riders recover. Linear between the points, so there is
 * no step at any slope.
 */
const DESCENT_SHARE: ReadonlyArray<readonly [number, number]> = [
  [-0.01, 1],
  [-0.015, 0.9],
  [-0.02, 0.8],
  [-0.03, 0.6],
  [-0.04, 0.45],
  [-0.05, 0.3],
  [-0.06, 0.2],
  [-0.08, 0.1],
  [-0.1, 0],
];

export function descentShare(grade: number): number {
  if (grade >= DESCENT_SHARE[0][0]) return 1;
  const last = DESCENT_SHARE[DESCENT_SHARE.length - 1];
  if (grade <= last[0]) return last[1];
  for (let i = 1; i < DESCENT_SHARE.length; i++) {
    const [g1, s1] = DESCENT_SHARE[i];
    if (grade >= g1) {
      const [g0, s0] = DESCENT_SHARE[i - 1];
      return s0 + (s1 - s0) * ((g0 - grade) / (g0 - g1));
    }
  }
  return last[1];
}

/** W/kg the bunch holds on a descent. It follows the flat slider, so a higher flat setting lifts it too. */
export function descentWkg(flatWkg: number, grade: number): number {
  return flatWkg * descentShare(grade);
}

/** Eases from one value to the next between two slopes, with no corner at either end. */
function blendBetween(from: number, to: number, grade: number, lo: number, hi: number): number {
  if (grade <= lo) return from;
  if (grade >= hi) return to;
  const x = (grade - lo) / (hi - lo);
  return from + (to - from) * x * x * (3 - 2 * x);
}

/**
 * W/kg the bunch rides at this slope. The three sliders meet in ramps one percent wide around
 * 3%, 5% and 7%, so the target never jumps when the road tips up. Descents follow descentWkg.
 */
export function terrainWkg(plan: RoadPlan, grade: number): number {
  if (grade < 0) return descentWkg(plan.flatWkg, grade);
  const hill = plan.hillWkg;
  const medium = plan.punchy ? hill : (hill + plan.mountainWkg) / 2;
  const mountain = plan.punchy ? hill : plan.mountainWkg;
  let wkg = blendBetween(plan.flatWkg, hill, grade, 0.025, 0.035);
  wkg = blendBetween(wkg, medium, grade, 0.045, 0.055);
  return blendBetween(wkg, mountain, grade, 0.065, 0.075);
}

export function raceDir(plan: RoadPlan): 1 | -1 {
  if (plan.dir === 1 || plan.dir === -1) return plan.dir;
  return plan.finishS >= plan.startS ? 1 : -1;
}

/** Metres ridden since the start. Grows as the bunch rides, whichever way the stage points. */
export function roadAlong(plan: RoadPlan, s: number): number {
  return (s - plan.startS) * raceDir(plan);
}

export function roadRemaining(plan: RoadPlan, s: number): number {
  return Math.abs(plan.finishS - plan.startS) - roadAlong(plan, s);
}

/** The peloton rides the watts you set. Attacks and the sprint are the only surges. */
export function racePace(plan: RoadPlan, grade: number, remaining: number, s?: number): number {
  void remaining;
  return s == null ? terrainWkg(plan, grade) : paceWkgAt(plan, s, grade);
}

/** A climb must climb this much (averaged over the last 100 m) to count, and be this long, for its effort to be carried over the top. */
const CREST_CLIMB = 0.025;
const CREST_MIN_M = 200;
/** The effort carried is the mean of the climb's last this many metres. */
const CREST_TAIL_M = 300;
/** Over the top the carried effort ends this far after the road levels out at the bottom, or after this much road with no descent at all. */
const CREST_FLAT_M = 300;
const CREST_PLATEAU_M = 400;
const CREST_STEP_M = 10;

/** Per stage: from each point along the road, the effort carried over the top of the climb just ridden, or NaN. */
const crests = new WeakMap<RoadPlan, Float32Array>();

/**
 * Riders carry the effort they climbed at over the top, then ease off by the slope of the descent
 * (descentShare) and ride the flat slider again once the road levels out at the bottom. Without this
 * the summit fell back to the flat slider and the descent eased from that. Called once per stage.
 */
export function prepareCrests(plan: RoadPlan, gradeAt: (s: number) => number): void {
  if (plan.timeTrial || crests.has(plan)) return;
  const dir = raceDir(plan);
  const span = Math.abs(plan.finishS - plan.startS);
  const n = Math.floor(span / CREST_STEP_M) + 1;
  const out = new Float32Array(n).fill(NaN);
  const grade = (i: number) => gradeAt(plan.startS + dir * i * CREST_STEP_M) * dir;
  const window = Math.round(100 / CREST_STEP_M);
  const tailN = Math.round(CREST_TAIL_M / CREST_STEP_M);
  let sum = 0;
  let state: 'none' | 'climb' | 'over' = 'none';
  let climbM = 0;
  const tail: number[] = [];
  let carry = NaN;
  let descended = false;
  let levelM = 0;
  let overM = 0;
  for (let i = 0; i < n; i++) {
    const g = grade(i);
    sum += g;
    if (i >= window) sum -= grade(i - window);
    const climbing = sum / Math.min(i + 1, window) >= CREST_CLIMB;
    if (climbing) {
      if (state !== 'climb') {
        state = 'climb';
        climbM = 0;
        tail.length = 0;
      }
      climbM += CREST_STEP_M;
      // Only the points that really climb: the level top already counts as climbing in the 100 m average.
      if (g >= CREST_CLIMB) {
        tail.push(terrainWkg(plan, g));
        if (tail.length > tailN) tail.shift();
      }
      continue;
    }
    if (state === 'climb') {
      if (climbM >= CREST_MIN_M) {
        state = 'over';
        carry = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : terrainWkg(plan, CREST_CLIMB);
        descended = false;
        levelM = 0;
        overM = 0;
      } else state = 'none';
    }
    if (state !== 'over') continue;
    overM += CREST_STEP_M;
    if (g < -0.01) {
      descended = true;
      levelM = 0;
    } else if (descended) levelM += CREST_STEP_M;
    if ((descended && levelM > CREST_FLAT_M) || (!descended && overM > CREST_PLATEAU_M)) {
      state = 'none';
      continue;
    }
    out[i] = carry;
  }
  crests.set(plan, out);
}

/** True from the top of a climb until the road levels out after the descent. */
export function overTheTop(plan: RoadPlan, s: number): boolean {
  const table = crests.get(plan);
  if (!table) return false;
  const i = Math.round(roadAlong(plan, s) / CREST_STEP_M);
  return i >= 0 && i < table.length && !Number.isNaN(table[i]);
}

/**
 * W/kg the bunch rides at this point of the stage. Over the top of a climb: the effort carried from
 * the climb, eased by the slope of the descent. Everywhere else: terrainWkg.
 */
export function paceWkgAt(plan: RoadPlan, s: number, grade: number): number {
  const table = crests.get(plan);
  if (!table || grade >= CREST_CLIMB) return terrainWkg(plan, grade);
  const i = Math.round(roadAlong(plan, s) / CREST_STEP_M);
  const carry = i >= 0 && i < table.length ? table[i] : NaN;
  if (Number.isNaN(carry)) return terrainWkg(plan, grade);
  return grade < 0 ? carry * descentShare(grade) : carry;
}

function ordersAt(plan: RoadPlan, orders: RoadOrders, s: number, grade: number): RoadOrders {
  if (orders.manual || plan.timeTrial) return orders;
  const remaining = roadRemaining(plan, s);
  const next: RoadOrders = { ...orders, paceOn: false };
  if (plan.tactic === 'control' && remaining > 800) {
    next.paceOn = true;
    next.paceWkg = paceWkgAt(plan, s, grade);
  } else if (plan.tactic === 'climb' && plan.lastClimbS != null && roadAlong(plan, s) >= roadAlong(plan, plan.lastClimbS) && remaining > 450) {
    next.paceOn = true;
    next.paceWkg = plan.mountainWkg * 0.97;
  }
  return next;
}

/** What this slope asks of the rider: the hills, the medium climbs, or the high mountains. */
export function climbRating(attrs: RaceAttrs, grade: number, punchy?: boolean): number {
  if (punchy && grade >= 0.03) return punchScore(attrs);
  if (grade > 0.06) return attrs.mountain;
  if (grade > 0.045) return attrs.medium;
  return attrs.hills;
}

/**
 * The best climbRating among AI road riders, for any slope, from one pass over the field.
 * Gives exactly max(climbRating(rider, grade, punchy)) (0 for an empty field); keep the branches
 * in step with climbRating.
 */
export function climbPeers(field: { road: RoadBody | null; isPlayer: boolean }[], punchy?: boolean): (grade: number) => number {
  let hills = 0;
  let medium = 0;
  let mountain = 0;
  let punch = 0;
  for (const rider of field) {
    if (!rider.road || rider.isPlayer) continue;
    const a = rider.road.attrs;
    hills = Math.max(hills, a.hills);
    medium = Math.max(medium, a.medium);
    mountain = Math.max(mountain, a.mountain);
    punch = Math.max(punch, punchScore(a));
  }
  return (grade) => {
    if (punchy && grade >= 0.03) return punch;
    if (grade > 0.06) return mountain;
    if (grade > 0.045) return medium;
    return hills;
  };
}

/**
 * Extra stamina cost on a climb when this rider is well short of the best.
 * The first few points are free, which is the draft. After that the bar falls faster.
 */
export function climbDrain(attr: number, peer: number, grade: number): number {
  if (grade < 0.05) return 1;
  const gap = Math.max(0, peer - attr - 6);
  return 1 + Math.min(0.45, gap / 50);
}

/** Rating that decides how much over the slider this rider can hold on this slope. */
function slopeRating(attrs: RaceAttrs, grade: number, punchy?: boolean): number {
  return grade >= 0.03 ? climbRating(attrs, grade, punchy) : attrs.flat;
}

/** The best slopeRating in today's field for this slope. Ratings do not change in a race, so they are found once. */
function slopePeer(brain: RaceBrain, field: readonly { road?: RoadBody | null; isPlayer?: boolean }[], grade: number, punchy?: boolean): number {
  if (!brain.peers) {
    const peers: FieldPeers = { flat: 0, hills: 0, medium: 0, mountain: 0, punch: 0, sprint: 0 };
    for (const r of field) {
      if (!r.road || r.isPlayer) continue;
      const a = r.road.attrs;
      peers.flat = Math.max(peers.flat, a.flat);
      peers.hills = Math.max(peers.hills, a.hills);
      peers.medium = Math.max(peers.medium, a.medium);
      peers.mountain = Math.max(peers.mountain, a.mountain);
      peers.punch = Math.max(peers.punch, punchScore(a));
      peers.sprint = Math.max(peers.sprint, a.sprint);
    }
    brain.peers = peers;
  }
  const p = brain.peers;
  if (grade < 0.03) return p.flat;
  if (punchy) return p.punch;
  if (grade > 0.06) return p.mountain;
  if (grade > 0.045) return p.medium;
  return p.hills;
}

/** Strength for the finish of a mountain-top or hill-top kick. */
function kickRating(attrs: RaceAttrs, finish: RoadFinish): number {
  return finish === 'hill' ? punchScore(attrs) : attrs.mountain * 0.8 + attrs.sprint * 0.2;
}

/**
 * Metres along where the decisive final climb starts. The road profile when shapeRoad has read it
 * (a finish that keeps climbing for several climbs counts from the first of them); else the plan's last climb.
 */
function finaleAlong(plan: RoadPlan, brain: RaceBrain): number | null {
  if (plan.finishKind === 'sprint') return null;
  const last = plan.lastClimbS != null ? roadAlong(plan, plan.lastClimbS) : null;
  const profile = brain.finaleAlong;
  if (profile != null) return last != null ? Math.min(profile, last) : profile;
  return last;
}

/**
 * Share of the slider a rider holds after a failed attempt, until the bunch is back. Low enough that
 * they are swallowed within half a minute instead of hanging a second or two ahead like a small break.
 */
const SIT_UP_SHARE = 0.65;

/** Share of the slider a rider holds right after cracking on a climb. */
export const CRACKED_SHARE = 0.88;
/** What it sinks to as the climb goes on, over CRACK_SINK_M. */
export const CRACKED_FLOOR = 0.8;
const CRACK_SINK_M = 300;

/** Share of the slider a cracked rider holds, this many metres after cracking. */
export function crackedShare(metresSince: number): number {
  return CRACKED_SHARE - (CRACKED_SHARE - CRACKED_FLOOR) * clamp(metresSince / CRACK_SINK_M, 0, 1);
}

/** The top share of the day's field for the finish (between the best and the worst) rides the whole last climb at full pace. */
const EASE_FROM = 0.3;
/** Lowest share of the slider a rider who is not racing for the win rides on the last climb. */
const EASE_FLOOR = 0.8;

/**
 * Share of the slider a rider rides on the last climb. A rider close to the best in reach (a
 * contender, a climber working for one) rides it all. The rest know they will not win here and ride
 * their own easier pace: the further down the day's field, the easier, and easier still for a rider
 * whose strengths are the flat and the sprint. `best` and `worst` are the day's ratings for this finish.
 */
export function climbEaseShare(mine: number, best: number, worst: number, flat: number, sprint: number): number {
  const down = (best - mine) / Math.max(6, best - worst);
  if (down <= EASE_FROM) return 1;
  const specialist = Math.max(0, Math.max(flat, sprint) - mine);
  return clamp(1 - 0.25 * (down - EASE_FROM) / (1 - EASE_FROM) - 0.006 * specialist, EASE_FLOOR, 1);
}

/** Start the last climb this far before its foot, so the tempo is on when the road tips up. */
const FINALE_LEAD_M = 100;

function startSurge(brain: RaceBrain, r: RoadActor, kind: SurgeKind, along: number, seconds: number, factor: number): void {
  brain.surges.set(r.id, { kind, fromAlong: along, lenM: seconds * Math.max(4, r.v), factor });
}

/**
 * One tick of the surge reserve for an AI road rider. Effort is measured against the slider for
 * the slope (the flat slider on descents, so a descent refills it). A sprint does not touch it.
 */
export function tickRoadReserve(
  r: RoadActor & { power: number },
  plan: RoadPlan,
  grade: number,
  field: readonly { phase: number; road?: RoadBody | null; isPlayer?: boolean }[],
  dt: number,
): number {
  const reserve = r.reserve ?? 1;
  const body = r.road;
  if (!body || r.isPlayer || plan.timeTrial || r.mode === 'sprint' || r.mode === 'finished') return reserve;
  const brain = brainFor(field, Math.abs(plan.finishS - plan.startS));
  const form = dayForm(body.riderId, brain.seed);
  const rating = slopeRating(body.attrs, grade, plan.punchy);
  const peer = slopePeer(brain, field, grade, plan.punchy);
  const ref = Math.max(0.5, grade < 0 ? plan.flatWkg : terrainWkg(plan, grade));
  const wkg = r.effort ?? r.power / Math.max(1, r.mass);
  return tickReserve(reserve, wkg / ref, criticalRatio(rating, peer, form), reserveBudget(rating, peer, form), body.attrs.recovery, dt);
}

function note(events: string[], text: string): void {
  if (events.length >= 12) return;
  events.push(text);
}

export function decideRoad(r: RoadActor, plan: RoadPlan, orders: RoadOrders, grade: number, field: RoadActor[], events: string[]): void {
  if (r.isPlayer || !r.road) return;
  if (r.finishTime != null || r.mode === 'finished') {
    r.mode = 'finished';
    r.targetPower = r.mass * 1.1;
    return;
  }
  const body = r.road;
  const along = roadAlong(plan, r.s);
  const remaining = roadRemaining(plan, r.s);
  const progress = clamp(along / Math.max(1, Math.abs(plan.finishS - plan.startS)), 0, 1);
  const energy = r.energy ?? 1;
  const enduranceEase = clamp(1.22 - body.attrs.endurance / 170, 0.55, 1.2);
  const depth = energy < 0.62 ? (0.62 - energy) * 0.72 * enduranceEase : 0;

  if (plan.timeTrial) {
    const factor = trialFactor(body.attrs, plan.finishKind);
    r.mode = 'steady';
    r.targetPower = (plan.ttWkg ?? plan.flatWkg) * factor * (1 - depth) * r.mass;
    return;
  }

  const ask = ordersAt(plan, orders, r.s, grade);
  const pace = paceWkgAt(plan, r.s, grade);
  const eased = racePace(plan, grade, remaining, r.s);
  const opening = !plan.timeTrial && along < 500;

  if (ask.waitOn && body.teammate && !ask.released) {
    const player = field.find((o) => o.isPlayer);
    if (player && along > roadAlong(plan, player.s) + 20) {
      r.mode = 'follow';
      r.targetPower = 1.4 * r.mass;
      return;
    }
  }

  r.climbShare = undefined;
  const kicking = plan.finishKind === 'sprint' && remaining < 800 && remaining > 0 && grade < 0.035;
  // A teammate who is spent on a climb drops out of the line instead of pulling on empty.
  const spent = !opening && ((grade >= 0.03 && ((r.reserve ?? 1) <= 0.02 || energy < 0.15)) || (r.mode === 'cracked' && grade >= 0.01));
  if (ask.paceOn && body.teammate && !kicking && !spent) {
    r.mode = 'pace';
    r.targetPower = Math.max(0.8, ask.paceWkg) * r.mass;
    return;
  }

  const span = Math.abs(plan.finishS - plan.startS);
  const brain = brainFor(field, span);
  const form = dayForm(body.riderId, brain.seed);
  const reserve = r.reserve ?? 1;
  const already = r.mode === 'attack';
  if (r.mode !== 'cracked') brain.crackedAt.delete(r.id);
  const mine = stageStrength(body.attrs, plan.finishKind, plan.punchy);
  const say = (verb: string) => {
    if (r.told) return;
    r.told = true;
    note(events, `${r.name} ${verb} · ${(r.targetPower / r.mass).toFixed(1)} W/kg`);
  };

  // Where the race is: the front, the best rider for this finish near it, the bunch, the break.
  let localFront = along;
  let pack = -Infinity;
  let sawPack = false;
  let memberTail = Infinity;
  for (const o of field) {
    if (o.isPlayer || !o.road || o.finishTime != null) continue;
    const a = roadAlong(plan, o.s);
    if (a >= along && a <= along + 150) localFront = Math.max(localFront, a);
    if (o.mode !== 'attack' && o.mode !== 'sprint' && o !== r) {
      sawPack = true;
      pack = Math.max(pack, a);
    }
    if (brain.members.has(o.id) && o !== r) memberTail = Math.min(memberTail, a);
  }
  // The best rider for this finish who is with me or ahead of me. Riders further back no longer matter to me.
  let frontPeer = 0;
  let stronger = 0;
  for (const o of field) {
    if (o.isPlayer || !o.road || o.finishTime != null || roadAlong(plan, o.s) < along - 150) continue;
    const strength = stageStrength(o.road.attrs, plan.finishKind, plan.punchy);
    frontPeer = Math.max(frontPeer, strength);
    if (strength > mine) stronger++;
  }
  const clear = sawPack ? along > pack + 35 : r.s > 35;
  // Metres to the front of my group (a bunch is never longer than about 150 m).
  const behind = localFront - along;
  const nearFront = behind <= 30;
  const climbStart = finaleAlong(plan, brain);
  const finale = climbStart != null && along >= climbStart - FINALE_LEAD_M && remaining > 0;
  const climbFrac = climbStart != null ? clamp((along - climbStart) / Math.max(200, span - climbStart), 0, 1) : 0;

  // Flat sprint. Each sprinter jumps at their own distance and holds the peak for 9-12 s.
  if (plan.finishKind === 'sprint' && remaining > 0 && grade < 0.035) {
    let launched = brain.launchedAt.get(r.id);
    // A sprint team's leader can go from deeper in the bunch, jumping earlier the further back he is.
    slopePeer(brain, field, 0);
    const leader = body.attrs.sprint >= brain.peers!.sprint - 8 && isProtectedRider(r, field, plan);
    const reach = leader ? behind <= 90 : nearFront;
    const jumpAt = launchDistance(body.riderId, body.attrs.sprint, brain.seed) + (leader ? behind * 1.2 : 0);
    if (launched == null && remaining <= jumpAt && body.attrs.sprint >= 62 && energy >= 0.25 && reach) {
      launched = along;
      brain.launchedAt.set(r.id, along);
    }
    if (launched != null) {
      const t = (along - launched) / Math.max(8, r.v);
      slopePeer(brain, field, 0);
      const peak = sprintPeakWkg(plan.flatWkg, body.attrs.sprint, brain.peers!.sprint, form);
      r.mode = 'sprint';
      r.targetPower = sprintCurve(peak, plan.flatWkg * 1.3, t, sprintHold(body.attrs.sprint)) * r.mass;
      say('sprints');
      return;
    }
  }

  // Hill or mountain finish: the riders still at the front kick in the last 200-300 m.
  if (plan.finishKind !== 'sprint' && remaining > 0) {
    let launched = brain.launchedAt.get(r.id);
    const kickFrom = plan.finishKind === 'hill' ? 300 : 220;
    if (launched == null && remaining <= kickFrom && reserve > 0.08 && mine >= frontPeer - 10 && behind <= 60 && r.mode !== 'cracked') {
      launched = along;
      brain.launchedAt.set(r.id, along);
    }
    if (launched != null) {
      const t = (along - launched) / Math.max(3, r.v);
      let best = 0;
      for (const o of field) if (o.road && !o.isPlayer) best = Math.max(best, kickRating(o.road.attrs, plan.finishKind));
      const peak = kickPeakWkg(Math.max(pace, plan.flatWkg), kickRating(body.attrs, plan.finishKind), best, form);
      r.mode = 'sprint';
      r.targetPower = sprintCurve(peak, pace * 1.05, t, sprintHold(body.attrs.sprint), 2) * r.mass;
      return;
    }
  }

  // A surge already under way: an attempt, a bridge, an attack, a counter, a descent move.
  const surge = brain.surges.get(r.id);
  if (surge) {
    const travelled = along - surge.fromAlong;
    const bridged = surge.kind === 'bridge' && memberTail < Infinity && along >= memberTail - 8;
    const descentOver = surge.kind === 'descent' && grade > -0.01;
    const empty = surge.kind !== 'descent' && reserve <= 0.02 && grade >= 0.03;
    if (travelled < surge.lenM && !bridged && !descentOver && !empty) {
      const ref = surge.kind === 'descent' ? Math.max(pace, plan.flatWkg * 0.3) : pace;
      r.mode = 'attack';
      r.targetPower = ref * surge.factor * r.mass;
      return;
    }
    brain.surges.delete(r.id);
    if (bridged) brain.members.add(r.id);
    else if ((surge.kind === 'attempt' || surge.kind === 'bridge') && !brain.members.has(r.id)) brain.sitUp.add(r.id);
  }

  // The early break shares the wind until the bunch takes it back.
  if (brain.members.has(r.id)) {
    if (pack < along - 10) {
      let size = 1;
      for (const o of field) {
        if (o !== r && brain.members.has(o.id) && o.finishTime == null && Math.abs(roadAlong(plan, o.s) - along) < 30) size++;
      }
      r.mode = 'attack';
      r.targetPower = pace * breakPace(energy, grade, size) * r.mass;
      return;
    }
    brain.members.delete(r.id);
  }

  // A failed attempt eases off until the bunch comes past.
  if (brain.sitUp.has(r.id)) {
    if (pack < along - 12) {
      r.mode = 'cracked';
      r.targetPower = pace * SIT_UP_SHARE * r.mass;
      return;
    }
    brain.sitUp.delete(r.id);
  }

  // Alone off the front after an attack: on the last climb, the pace this rider can hold; elsewhere a solo break.
  if (already && clear) {
    r.mode = 'attack';
    if (finale && grade >= 0.02) {
      const hold = Math.min(criticalRatio(slopeRating(body.attrs, grade, plan.punchy), slopePeer(brain, field, grade, plan.punchy), form) + (reserve > 0.3 ? 0.05 : 0), 1.2);
      r.targetPower = pace * Math.max(1, hold) * r.mass;
    } else {
      r.targetPower = pace * breakPace(energy, grade, 1) * r.mass;
    }
    return;
  }

  if (!opening && !body.teammate && finale && grade >= 0.025) {
    // A contender is close to the best rider still in reach, and one of the ten best of them.
    const contender = mine >= frontPeer - 8 && stronger < 10;
    let moving = 0;
    for (const move of brain.surges.values()) if (move.kind === 'climb' || move.kind === 'counter') moving++;
    // Planned attacks: one, or two for the strongest, between 42% and 90% of the way up.
    const moves = brain.climbMoves.get(r.id) ?? 0;
    const maxMoves = mine >= frontPeer - 3 ? 2 : 1;
    if (contender && moves < maxMoves && moving < 3 && reserve >= 0.55 && energy >= 0.3) {
      const at = [0, 1].map((k) => 0.42 + 0.48 * hash01(`climb:${body.riderId}:${k}:${brain.seed}`)).sort((a, b) => a - b);
      if (climbFrac >= at[moves]) {
        const factor = clamp(1.16 + (mine - (frontPeer - 8)) / 80, 1.16, 1.28) * (1 + (form - 1) * 0.5);
        const seconds = 40 + 50 * hash01(`climb-len:${body.riderId}:${moves}:${brain.seed}`);
        startSurge(brain, r, 'climb', along, seconds, factor);
        brain.climbMoves.set(r.id, moves + 1);
        r.mode = 'attack';
        r.targetPower = pace * factor * r.mass;
        say('attacks');
        return;
      }
    }
    // Counters: a rival who can stay with the move goes with it.
    if (mine >= frontPeer - 6 && stronger < 6 && moving < 5 && reserve >= 0.4 && energy >= 0.3) {
      for (const o of field) {
        if (o === r || !o.road || o.finishTime != null) continue;
        const move = brain.surges.get(o.id);
        if (!move || move.kind !== 'climb') continue;
        const ahead = roadAlong(plan, o.s) - along;
        if (ahead <= 0 || ahead > 60) continue;
        if (stageStrength(o.road.attrs, plan.finishKind, plan.punchy) < mine - 3) continue;
        if (hash01(`counter:${body.riderId}:${o.id}:${brain.seed}`) >= 0.7) continue;
        const left = Math.max(0, move.lenM - (roadAlong(plan, o.s) - move.fromAlong));
        brain.surges.set(r.id, { kind: 'counter', fromAlong: along, lenM: left + 10 * Math.max(4, r.v), factor: move.factor });
        r.mode = 'attack';
        r.targetPower = pace * move.factor * r.mass;
        say('follows');
        return;
      }
    }
  }

  // One-day races: the best puncheur tries once from a hill in the middle of the race.
  if (!opening && !body.teammate && plan.oneDay && !finale && progress > 0.38 && progress < 0.72 && grade > 0.03 && remaining > 1800
    && mine >= frontPeer - 2 && reserve >= 0.7 && energy >= 0.4 && r.phase > 60 && !brain.climbMoves.has(r.id) && brain.surges.size === 0) {
    startSurge(brain, r, 'punch', along, 40, 1.2);
    brain.climbMoves.set(r.id, 0);
    r.mode = 'attack';
    r.targetPower = pace * 1.2 * r.mass;
    say('attacks');
    return;
  }

  // Cracked: the reserve is gone on a climb. The rider falls well under the slider, and further the
  // longer the climb goes on, and stays cracked to the top: they lose the wheel and do not come back
  // on the climb. Over the top they ride with whoever they are with again.
  const cracking = grade >= 0.03 && (reserve <= 0.02 || energy < 0.15);
  const stillCracked = r.mode === 'cracked' && brain.crackedAt.has(r.id) && grade >= 0.01;
  if (!opening && (cracking || stillCracked)) {
    if (!brain.crackedAt.has(r.id)) brain.crackedAt.set(r.id, along);
    r.mode = 'cracked';
    r.targetPower = pace * crackedShare(along - brain.crackedAt.get(r.id)!) * r.mass;
    return;
  }
  brain.crackedAt.delete(r.id);

  // The last climb: a rider who is not racing for the win rides their own easy pace.
  if (!opening && finale && grade >= 0.02) {
    let share = brain.climbEase.get(r.id);
    if (share === undefined) {
      let worst = mine;
      for (const o of field) if (o.road && !o.isPlayer) worst = Math.min(worst, stageStrength(o.road.attrs, plan.finishKind, plan.punchy));
      share = body.teammate ? 1 : climbEaseShare(mine, frontPeer, worst, body.attrs.flat, body.attrs.sprint);
      brain.climbEase.set(r.id, share);
    }
    if (share < 1) r.climbShare = share;
  }

  r.mode = 'follow';
  r.targetPower = eased * (r.climbShare ?? 1) * r.mass;
}

/** Smallest bunch that sends an early break up the road. */
const BREAK_FIELD = 20;

/** A rider the bunch would let into the early break: not a leader for today, fresh, and not riding for a teammate. */
function breakCandidate(r: RoadActor, field: RoadActor[], plan: RoadPlan, brain: RaceBrain, fieldBest: number): boolean {
  if (r.isPlayer || !r.road || r.road.teammate || r.finishTime != null || r.mode !== 'follow') return false;
  if (brain.surges.has(r.id) || brain.members.has(r.id) || brain.sitUp.has(r.id)) return false;
  if ((r.energy ?? 1) < 0.7 || (r.reserve ?? 1) < 0.6 || r.road.attrs.flat < 60) return false;
  if (r.road.gcRank != null && r.road.gcRank < 10) return false;
  if (leadsRace(r.road)) return false;
  if (stageStrength(r.road.attrs, plan.finishKind, plan.punchy) >= fieldBest - 6) return false;
  return !isProtectedRider(r, field, plan);
}

/**
 * Whole-race decisions, made from the biggest group: attempts to form the early break, riders
 * bridging across to it, and the odd attack on a descent. Riders carry the moves out in decideRoad.
 */
function directRace(
  field: RoadActor[],
  plan: RoadPlan,
  brain: RaceBrain,
  main: RoadActor[],
  along: (s: number) => number,
  slope: (s: number) => number,
  fieldBest: number,
): void {
  const nose = main[0];
  const noseAlong = along(nose.s);
  if (noseAlong - brain.lastDirect < 10) return;
  brain.lastDirect = noseAlong;
  const rng = brain.rng;
  const pick = (count: number, kind: SurgeKind, seconds: () => number, factor: () => number): RoadActor[] => {
    const pool = main
      .filter((r) => breakCandidate(r, field, plan, brain, fieldBest))
      .map((r) => ({ r, score: (r.road!.attrs.flat + r.road!.attrs.stamina) / 2 + rng() * 30 }))
      .sort((x, y) => y.score - x.score);
    const teams = new Set<string>();
    const out: RoadActor[] = [];
    for (const { r } of pool) {
      if (out.length >= count) break;
      if (teams.has(r.road!.teamId)) continue;
      teams.add(r.road!.teamId);
      startSurge(brain, r, kind, along(r.s), seconds(), factor());
      out.push(r);
    }
    return out;
  };

  // If the break has been caught while the window is still open, the attacking starts again.
  if ((brain.breakState === 'forming' || brain.breakState === 'gone') && noseAlong < brain.breakTo + 1500) {
    let live = 0;
    for (const r of field) if (brain.members.has(r.id) && r.finishTime == null) live++;
    if (!live) {
      brain.breakState = 'open';
      brain.stickAt = brain.attempts + 1 + Math.floor(rng() * 2);
    }
  }
  // An early break needs a bunch to get away from. A small field rides together.
  if (brain.breakState === 'open' && main.length < BREAK_FIELD) brain.breakState = 'none';
  if (brain.breakState === 'open') {
    if (noseAlong > brain.breakTo) brain.breakState = 'none';
    else if (slope(nose.s) < -0.01) brain.nextAttemptAt = Math.max(brain.nextAttemptAt, noseAlong + 100);
    else if (noseAlong >= brain.nextAttemptAt) {
      brain.attempts++;
      const sticks = brain.attempts === brain.stickAt;
      // The move that sticks goes with most of its riders; one or two more bridge across while the gap is small.
      const count = sticks ? Math.max(2, brain.breakTarget - Math.floor(rng() * 3)) : 1 + Math.floor(rng() * 3);
      const went = pick(count, 'attempt', () => 25 + rng() * 15, () => 1.25 + rng() * 0.1);
      if (sticks && went.length) {
        for (const r of went) brain.members.add(r.id);
        brain.breakState = 'forming';
        brain.nextBridgeAt = noseAlong + 150 + rng() * 250;
      } else if (sticks) brain.stickAt++;
      brain.nextAttemptAt = noseAlong + 600 + rng() * 600;
    }
  } else if (brain.breakState === 'forming') {
    let front = -Infinity;
    let live = 0;
    for (const r of field) {
      if (!brain.members.has(r.id) || r.finishTime != null) continue;
      live++;
      front = Math.max(front, along(r.s));
    }
    const gap = (front - noseAlong) / Math.max(2, nose.v);
    if (!live) brain.breakState = 'none';
    else if (brain.members.size >= brain.breakTarget || gap > 12 || noseAlong > brain.breakTo + 1500) brain.breakState = 'gone';
    else if (noseAlong >= brain.nextBridgeAt) {
      pick(1, 'bridge', () => 60, () => 1.45);
      brain.nextBridgeAt = noseAlong + 200 + rng() * 300;
    }
  }

  // A good descender who is fresh may try to ride away on a long descent in the second half.
  const grade = slope(nose.s);
  if (main.length >= BREAK_FIELD / 2 && grade < -0.04 && noseAlong > brain.span * 0.4 && brain.span - noseAlong > 2000 && brain.descentAttacks < 2 && noseAlong - brain.descentSeen > 3000) {
    brain.descentSeen = noseAlong;
    if (rng() < 0.35) {
      let best: RoadActor | null = null;
      let bestSkill = 0.005;
      for (const r of main) {
        if (r.isPlayer || !r.road || r.road.teammate || r.mode !== 'follow' || brain.surges.has(r.id)) continue;
        if ((r.energy ?? 1) < 0.45 || (r.reserve ?? 1) < 0.6) continue;
        // The race leader and the riders close to them overall ride the descent in the bunch.
        if (leadsRace(r.road) || (r.road.gcRank != null && r.road.gcRank < 5)) continue;
        const skill = descentSkill(r.road.riderId);
        if (skill > bestSkill) {
          best = r;
          bestSkill = skill;
        }
      }
      if (best) {
        brain.surges.set(best.id, { kind: 'descent', fromAlong: along(best.s), lenM: 4000, factor: 1.6 });
        brain.descentAttacks++;
      }
    }
  }
}

export function shapeRoad(
  field: RoadActor[],
  plan: RoadPlan,
  orders: RoadOrders,
  gradeAt: (s: number) => number,
  altAt: (s: number) => number,
): void {
  if (plan.timeTrial) return;
  const dir = raceDir(plan);
  const along = (s: number) => (s - plan.startS) * dir;
  const slope = (s: number) => gradeAt(s) * dir;
  const player = field.find((r) => r.isPlayer);
  const active = field.filter((r) => !r.isPlayer && r.finishTime == null && (r.mode === 'follow' || r.mode === 'pace') && r.road);
  active.sort((a, b) => along(b.s) - along(a.s));
  const groups: RoadActor[][] = [];
  for (const r of active) {
    const group = groups[groups.length - 1];
    if (!group || along(group[group.length - 1].s) - along(r.s) > ROAD_GROUP_M) groups.push([r]);
    else group.push(r);
  }
  const tempo = teamTempoRank(field, plan.finishKind, plan.punchy);
  const span = Math.abs(plan.finishS - plan.startS);
  const brain = brainFor(field, span);
  for (const r of field) r.effort = undefined;
  const main = groups.reduce<RoadActor[] | null>((best, group) => (!best || group.length > best.length ? group : best), null);
  const frontGroup = groups.find((group) => group.length >= 2) ?? null;
  if (brain.finaleAlong === undefined) {
    brain.finaleAlong = plan.finishKind === 'sprint' ? null : finaleStart(span, (a) => slope(plan.startS + dir * a));
  }
  const climbStart = finaleAlong(plan, brain);
  let fieldBest = 0;
  for (const r of field) {
    if (r.isPlayer || !r.road || r.finishTime != null) continue;
    fieldBest = Math.max(fieldBest, stageStrength(r.road.attrs, plan.finishKind, plan.punchy));
  }

  // The front of the race ahead of the biggest group: the break, or a lone attacker.
  let gapSec = 0;
  let breakLead: RoadActor | null = null;
  let breakDangerous = false;
  if (main && main.length) {
    const noseAlong = along(main[0].s);
    const ahead = field
      .filter((r) => !r.isPlayer && r.finishTime == null && r.road && r.mode === 'attack' && along(r.s) > noseAlong + 8)
      .sort((x, y) => along(y.s) - along(x.s));
    if (ahead.length) {
      breakLead = ahead[0];
      gapSec = (along(breakLead.s) - noseAlong) / Math.max(2, main[0].v);
      // A break the bunch lets go has none of the riders who can win today. Anything else is chased now.
      let prev = along(breakLead.s);
      for (const r of ahead) {
        if (prev - along(r.s) > ROAD_GROUP_M) break;
        prev = along(r.s);
        const strong = stageStrength(r.road!.attrs, plan.finishKind, plan.punchy) >= fieldBest - 6 || (r.road!.gcRank != null && r.road!.gcRank < 5);
        const joining = brain.surges.get(r.id)?.kind === 'bridge';
        if ((!brain.members.has(r.id) && !joining) || strong) breakDangerous = true;
      }
    }
    directRace(field, plan, brain, main, along, slope, fieldBest);
  }

  /** How hard the biggest group rides to hold or close the break, as a multiple of the slider. */
  const chaseFactor = (nose: RoadActor, wkg: number, grade: number, group: RoadActor[]): number => {
    if (!breakLead || gapSec <= 1) return 1;
    const remainingNose = roadRemaining(plan, nose.s);
    const kmToCatch = (remainingNose - catchRemaining(span, plan.finishKind, climbStart)) / 1000;
    const vBreak = Math.max(2, breakLead.v);
    let pullers = 0;
    let pullEnergy = 0;
    for (const r of group) {
      if (isProtectedRider(r, field, plan)) continue;
      pullers++;
      pullEnergy += r.energy ?? 1;
    }
    const cap = chaseCap(brain.chaseCommit, pullers ? pullEnergy / pullers : 1, grade);
    let target: number;
    if (breakDangerous) target = chaseSpeedNeeded(vBreak, gapSec, Math.max(0.8, gapSec / 8));
    else if (kmToCatch <= gapSec / 5) target = chaseSpeedNeeded(vBreak, gapSec, Math.max(0.3, kmToCatch));
    else if (gapSec >= brain.gapCap) target = vBreak;
    else return 1;
    return factorForSpeed(target, wkg, nose.mass, grade, nose.bike, altAt(nose.s), cap);
  };

  groups.forEach((group, gi) => {
    if (group.length < 2) return;
    const current = [...group].sort((a, b) => along(b.s) - along(a.s));
    const nose = current[0];
    const grade = slope(nose.s);
    const noseAlong = along(nose.s);
    const remainingNose = roadRemaining(plan, nose.s);
    const ask = ordersAt(plan, orders, player?.s ?? nose.s, grade);
    const opening = noseAlong < 500;
    const eased = opening ? terrainWkg(plan, grade) : racePace(plan, grade, remainingNose, nose.s);
    let factor = 1;
    if (!opening) {
      if (group === main) factor = Math.max(factor, chaseFactor(nose, eased, grade, group));
      // A group behind another group closes on the flat, the way a split bunch comes back together.
      // Not on the run-in to a climb finish, where the splits are the race.
      const ahead = gi > 0 ? groups[gi - 1] : null;
      const regroup = plan.finishKind === 'sprint' || climbStart == null || noseAlong < climbStart - 300;
      // In the finale the leaders' teams bring back anyone ahead who is not attacking.
      if (ahead && !regroup && group === main) {
        const gap = (along(ahead[ahead.length - 1].s) - noseAlong) / Math.max(2, nose.v);
        if (gap > 0.5 && gap < 30) factor = Math.max(factor, grade >= 0.03 ? 1.08 : 1.2);
      }
      if (ahead && regroup) {
        const gap = (along(ahead[ahead.length - 1].s) - noseAlong) / Math.max(2, nose.v);
        if (grade < 0.03 && gap > 0.5 && gap < 45) factor = Math.max(factor, 1.2);
        else if (grade >= 0.03 && gap > 0.5 && gap < 15) factor = Math.max(factor, 1.05);
      }
      // The last climb: the leaders' teams set a tempo on the bunch from 30% of the way up.
      if (group === main && climbStart != null && noseAlong >= climbStart && grade >= 0.02) {
        const frac = (noseAlong - climbStart) / Math.max(200, span - climbStart);
        const mountain = plan.finishKind === 'mountain';
        if (frac >= 0.7) factor = Math.max(factor, mountain ? 1.1 : 1.08);
        else if (frac >= 0.3) factor = Math.max(factor, mountain ? 1.06 : 1.05);
      }
      if (group === frontGroup || group === main) factor = Math.max(factor, flatRunIn(plan, remainingNose, gapSec, grade));
      // In the finale a few riders who slipped ahead of the bunch without attacking do not ride away from it.
      const mainNose = main && main.length ? along(main[0].s) : -Infinity;
      if (group !== main && group.length < 10 && climbStart != null && noseAlong >= climbStart - FINALE_LEAD_M && noseAlong > mainNose) {
        factor = 0.97;
      }
    }
    // Descents use the real slope. The pedalling comes from terrainWkg, which tapers with the slope
    // (descentWkg), so a gentle descent is still ridden near the flat effort and a steep one is a tuck.
    const rollGrade = grade;
    const bunch = steadySpeed(Math.max(0, eased * nose.mass), rollGrade, nose.bike, altAt(nose.s), 0);
    const mates = current.filter((r) => r.road?.teammate);
    const others = current.filter((r) => !r.road?.teammate);
    // The slider applies to the group only once the teammates are the riders at the front.
    const orderedOn = ask.manual && ask.paceOn && mates.length > 0;
    const rearmostMate = mates.length ? Math.min(...mates.map((r) => along(r.s))) : -Infinity;
    const foremostOther = others.length ? Math.max(...others.map((r) => along(r.s))) : -Infinity;
    // The order is for the player's group: once the player is off the back, this group rides its own pace.
    const playerAlong = player ? along(player.s) : -Infinity;
    const withPlayer = playerAlong >= along(current[current.length - 1].s) - ROAD_GROUP_M && playerAlong <= noseAlong + ROAD_GROUP_M;
    const matesLead = orderedOn && withPlayer && rearmostMate >= foremostOther - 2.5;
    const groupWkg = matesLead ? ask.paceWkg : eased * factor;
    const pace = steadySpeed(Math.max(0, groupWkg * nose.mass), rollGrade, nose.bike, altAt(nose.s), 0);
    const ordered = orderPull(
      tempoOrder(group, tempo, plan.finishKind, plan.punchy, (rider) => along(rider.s)),
      field,
      plan,
      noseAlong,
      tempo,
      (rider) => along(rider.s),
    );
    // What it costs to hold this group. The riders in the wind pay the multiple; in the wheels most of it is hidden on the flat.
    const wind = new Set<RoadActor>();
    for (let i = 0; i < Math.min(LINE_LENGTH, ordered.length); i++) {
      const rider = ordered[i];
      if (isProtectedRider(rider, field, plan) || (rider.energy ?? 1) < 0.3 || (rider.climbShare ?? 1) < 1) continue;
      wind.add(rider);
      if (factor > 1 && !matesLead) {
        // Closing a gap on a descent takes pedalling, as long as pedalling still adds speed.
        const closing = grade < 0 && rider.v < SPIN_OUT ? plan.flatWkg : 0;
        rider.targetPower = Math.max(eased, closing) * factor * rider.mass;
      }
    }
    for (const rider of current) {
      const f = matesLead ? ask.paceWkg / Math.max(0.5, eased) : factor;
      if (wind.has(rider)) rider.effort = eased * f;
      else if (grade < 0.03) rider.effort = eased * 0.8 * (1 + (f - 1) * 0.5);
      else rider.effort = eased * f * 0.98;
      rider.effort *= rider.climbShare ?? 1;
    }
    const lead = ordered[0];
    const slot = new Map(ordered.map((rider, index) => [rider, index]));
    // A rider's place counts only the riders ordered ahead of them who are already ahead on the road.
    // A rider still coming up from further back takes no room until they get there, so no empty
    // place opens behind the front rider while they come through.
    const place = roadPlaces(current, slot);
    // The line at the front is evenly spaced; the spread bunch behind is staggered so it does not look gridded.
    const placeBehind = (rider: RoadActor) => {
      const at = place.get(rider) ?? 0;
      return slotOffset(at) + (at < LINE_LENGTH ? 0 : (rider.id % 5) * 0.17);
    };
    const head = noseAlong;
    for (const rider of current) {
      // A rider easing up the last climb rides their own share of the pace, whoever's wheel they are on.
      const share = rider.climbShare ?? 1;
      let base = pace;
      if (!matesLead && rider !== nose) {
        const rg = slope(rider.s);
        const ew = opening ? terrainWkg(plan, rg) : racePace(plan, rg, roadRemaining(plan, rider.s), rider.s);
        base = steadySpeed(Math.max(0, ew * factor * share * nose.mass), rg, nose.bike, altAt(rider.s), 0);
      } else if (share < 1) {
        base = steadySpeed(Math.max(0, groupWkg * share * nose.mass), rollGrade, nose.bike, altAt(nose.s), 0);
      }
      if (!opening && orderedOn && rider.road?.teammate && !matesLead) {
        const own = steadySpeed(Math.max(0, ask.paceWkg * rider.mass), rollGrade, rider.bike, altAt(rider.s), 0);
        base = Math.max(own, bunch + 0.65);
      }
      // Hold the pace you set. Only the rider who should be leading creeps
      // past the wheel ahead, and only that one wheel eases. The group does not surge or sit up.
      const wantAlong = head - placeBehind(rider);
      let drift = 0;
      // Teammates under orders ride their own effort; everyone else keeps their place in the group.
      if (!opening && !(orderedOn && rider.road?.teammate)) {
        if (rider === lead && rider !== nose) drift = 0.3;
        else if (rider === nose && rider !== lead) drift = -0.18;
        else if (rider !== nose) drift = clamp((wantAlong - along(rider.s)) * 0.08, -0.2, 0.3);
        // The same few percent of the pace at any speed. A flat 0.2 m/s is nothing at 10 m/s and a tenth of the speed on a wall.
        drift *= clamp(base / DRIFT_PACE, 0.25, 1);
      }
      rider.v = Math.max(0.4, base + drift);
    }
    // Never ride into the back wheel of the rider ahead in the same file.
    for (let i = 1; i < current.length; i++) {
      const rider = current[i];
      for (let j = i - 1; j >= 0; j--) {
        const ahead = current[j];
        const gap = along(ahead.s) - along(rider.s);
        if (gap > FILE_SPACING) break;
        if (Math.abs(ahead.lat - rider.lat) >= FILE_WIDTH) continue;
        // A rider who is racing goes round one who is easing up the last climb.
        if ((ahead.climbShare ?? 1) < (rider.climbShare ?? 1) - 0.02) break;
        rider.v = Math.max(0.4, Math.min(rider.v, ahead.v - (FILE_SPACING - gap) * 0.3));
        break;
      }
    }
  });
  const breaks = field.filter((r) => !r.isPlayer && r.finishTime == null && r.mode === 'attack' && r.road).sort((a, b) => along(b.s) - along(a.s));
  const escape: RoadActor[][] = [];
  for (const r of breaks) {
    const group = escape[escape.length - 1];
    if (!group || along(group[group.length - 1].s) - along(r.s) > ROAD_GROUP_M) escape.push([r]);
    else group.push(r);
  }
  for (const group of escape) {
    if (group.length < 2) continue;
    const nose = group[0];
    const pull = Math.floor(nose.s / 420) % group.length;
    const leader = group[pull];
    if (leader !== nose) leader.v = Math.max(leader.v, nose.v + 1.1);
    else {
      let prev = nose;
      for (let i = 1; i < group.length; i++) {
        const r = group[i];
        r.v = Math.max(0.4, prev.v + clamp((along(prev.s) - along(r.s) - 1.3) * 0.8, -1, 1.6));
        prev = r;
      }
    }
  }
  // Attack and sprint watts stay capped. On a descent that cap is the real slope,
  // so a move cannot fall slower than the coasting bunch, and it cannot exceed its own power.
  // Off the bunch, a good descender gains a little on a descent and a poor one loses a little.
  const mainSpeed = main && main.length ? main[0].v : 0;
  for (const r of field) {
    if (r.isPlayer || r.finishTime != null || (r.mode !== 'attack' && r.mode !== 'sprint')) continue;
    const grade = slope(r.s);
    const powered = steadySpeed(Math.max(0, r.targetPower), grade, r.bike, altAt(r.s), 0);
    r.v = Math.min(r.v, powered);
    if (grade < -0.02 && r.road && r.mode === 'attack') {
      const skill = descentSkill(r.road.riderId);
      r.v *= 1 + skill;
      if (brain.surges.get(r.id)?.kind === 'descent') r.v = Math.max(r.v, mainSpeed * (1.02 + Math.max(0, skill)));
    }
  }
  if (!player || orders.released) return;
  // Teammates on the front pull the group the player is in, one line ahead of it at most. They do not
  // ride away from it: if the player cannot hold their effort, they ride the player's pace.
  let groupFront = along(player.s);
  let frontSpeed = player.v;
  if (orders.paceOn) {
    const order = field.filter((o) => o.finishTime == null && !o.road?.teammate).sort((a, b) => along(b.s) - along(a.s));
    for (let i = order.indexOf(player) - 1; i >= 0; i--) {
      if (along(order[i].s) - along(order[i + 1].s) > ROAD_GROUP_M) break;
      groupFront = along(order[i].s);
      frontSpeed = order[i].v;
    }
  }
  const lineAhead = LINE_LENGTH * FILE_SPACING;
  for (const r of field) {
    if (!r.road?.teammate || r.finishTime != null || r.mode === 'sprint' || r.mode === 'finished') continue;
    const ahead = along(r.s) - along(player.s);
    if (orders.waitOn && ahead > 18) r.v = Math.min(r.v, 1.8);
    else if (!orders.paceOn && ahead > 16) r.v = Math.min(r.v, Math.max(1.2, player.v * 0.98));
    else if (orders.paceOn && along(r.s) - groupFront > lineAhead) {
      r.v = Math.min(r.v, Math.max(1.2, frontSpeed - clamp((along(r.s) - groupFront - lineAhead) * 0.1, 0, 1)));
    }
  }
}

export function awardRoadFeatures(field: RoadActor[], plan: RoadPlan, events: string[]): void {
  for (const feature of plan.features) {
    if (feature.awarded) continue;
    const have = new Set(feature.scored.map((row) => row.id));
    const line = roadAlong(plan, feature.s);
    const crossed = field.filter((r) => roadAlong(plan, r.s) >= line && !have.has(r.id)).sort((a, b) => roadAlong(plan, b.s) - roadAlong(plan, a.s));
    for (const r of crossed) {
      const place = feature.scored.length;
      if (place >= feature.points.length) break;
      // A place worth nothing is still taken, so the next rider gets the next place.
      const pts = Math.max(0, feature.points[place]);
      feature.scored.push({ id: r.id, name: r.name, pts });
      if (pts > 0) {
        if (feature.kind === 'sprint') r.sprintPts += pts;
        else r.komPts += pts;
      }
      if (place === 0) note(events, `${feature.name}: ${r.name}`);
    }
    if (feature.scored.length >= feature.points.length) feature.awarded = true;
  }
}
