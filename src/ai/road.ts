import { steadySpeed, type BikeParams } from '../physics/cycling';
import { clamp } from '../util/math';
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
}

const HOLD = 78;

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

/** Where a flat sprint starts to lift. A short stage starts closer to the line, and never further than 8 km. */
export function sprintRampFrom(stageLength: number): number {
  return Math.min(8000, Math.max(6000, stageLength * 0.33));
}

/**
 * Bunch multiplier on a flat sprint finish.
 * A gap only adds a small tempo, because the break slows as its bar falls.
 * The run-in then steps up over the last kilometres.
 */
export function flatRunIn(plan: RoadPlan, remaining: number, gapSec: number, grade: number): number {
  if (plan.timeTrial || plan.finishKind !== 'sprint' || grade < 0) return 1;
  if (terrainKind(grade) !== 'flat') return 1;
  const from = sprintRampFrom(Math.abs(plan.finishS - plan.startS));
  let factor = 1;
  if (remaining <= 1000) factor = 1.1;
  else if (remaining <= 3000) factor = 1.08;
  else if (remaining <= from) factor = 1.05;
  if (gapSec > 10 && remaining > 1000) factor = Math.max(factor, 1.04);
  return factor;
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
    if (prev && along(prev.s) - along(rider.s) > 16) stamp();
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

/** The best rider on a team for this finish stays out of the wind. */
export function isProtectedRider(rider: { road: RoadBody | null }, field: { road: RoadBody | null }[], plan: RoadPlan): boolean {
  if (!rider.road) return false;
  const own = stageStrength(rider.road.attrs, plan.finishKind, plan.punchy);
  let best = own;
  for (const other of field) {
    if (other.road?.teamId !== rider.road.teamId) continue;
    best = Math.max(best, stageStrength(other.road.attrs, plan.finishKind, plan.punchy));
  }
  return own >= best - 1 && best >= 68;
}

/** Metres of one pull before the next riders take the wind. About three minutes at the flat. */
const PULL_M = 1600;

/**
 * A few riders take the wind, then the next few. On a sprint finish that is the sprint teams
 * and, unless the order is to climb, the player's helpers. The protected rider does not pull.
 */
export function orderPull(
  ordered: RoadActor[],
  field: RoadActor[],
  plan: RoadPlan,
  alongM: number,
  rank: Map<string, number>,
): RoadActor[] {
  const bestTeam = ordered.reduce((best, rider) => Math.max(best, rank.get(rider.road?.teamId ?? '') ?? 0), 0);
  const pullers = ordered.filter((rider) => {
    if (rider.isPlayer || !rider.road || isProtectedRider(rider, field, plan)) return false;
    if ((rider.energy ?? 1) < 0.3) return false;
    if (plan.finishKind !== 'sprint') return true;
    if (rider.road.teammate && plan.tactic === 'climb') return false;
    const helping = rider.road.teammate && plan.tactic !== 'climb';
    const team = rank.get(rider.road.teamId) ?? 0;
    const own = stageStrength(rider.road.attrs, plan.finishKind, plan.punchy);
    return helping || (team >= bestTeam - 8 && own >= team - 14 && own >= 54);
  });
  if (!pullers.length) return ordered;
  const turn = Math.floor(Math.max(0, alongM) / PULL_M) % pullers.length;
  const used = new Set<RoadActor>();
  const wind: RoadActor[] = [];
  for (let i = 0; i < Math.min(LINE_LENGTH, pullers.length); i++) {
    const rider = pullers[(turn + i) % pullers.length];
    if (used.has(rider)) continue;
    wind.push(rider);
    used.add(rider);
  }
  return [...wind, ...ordered.filter((rider) => !used.has(rider))];
}

export function tempoOrder(
  group: RoadActor[],
  rank: Map<string, number>,
  finish: RoadFinish,
  punchy = false,
  ahead: (rider: RoadActor) => number = (rider) => rider.s,
): RoadActor[] {
  const bestTeam = group.reduce((best, rider) => Math.max(best, rank.get(rider.road?.teamId ?? '') ?? 0), 0);
  const engine: RoadActor[] = [];
  const rest: RoadActor[] = [];
  for (const rider of group) {
    const team = rank.get(rider.road?.teamId ?? '') ?? 0;
    const own = rider.road ? stageStrength(rider.road.attrs, finish, punchy) : 0;
    if (team >= bestTeam - 8 && own >= team - 14 && own >= 54) engine.push(rider);
    else rest.push(rider);
  }
  engine.sort((a, b) => {
    const teamA = rank.get(a.road?.teamId ?? '') ?? 0;
    const teamB = rank.get(b.road?.teamId ?? '') ?? 0;
    if (teamB !== teamA) return teamB - teamA;
    const ownA = a.road ? stageStrength(a.road.attrs, finish, punchy) : 0;
    const ownB = b.road ? stageStrength(b.road.attrs, finish, punchy) : 0;
    return ownA - ownB;
  });
  rest.sort((a, b) => ahead(b) - ahead(a));
  return [...engine, ...rest];
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

/** Attack watts. Harder than the pace you set, and never more than twice that pace. */
function attackPower(pace: number, mass: number, factor: number): number {
  return Math.min(pace * factor, pace * 2) * mass;
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
export function racePace(plan: RoadPlan, grade: number, remaining: number): number {
  void remaining;
  return terrainWkg(plan, grade);
}

function ordersAt(plan: RoadPlan, orders: RoadOrders, s: number, grade: number): RoadOrders {
  if (orders.manual || plan.timeTrial) return orders;
  const remaining = roadRemaining(plan, s);
  const next: RoadOrders = { ...orders, paceOn: false };
  if (plan.tactic === 'control' && remaining > 800) {
    next.paceOn = true;
    next.paceWkg = terrainWkg(plan, grade);
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

function bestClimb(field: RoadActor[], grade: number, punchy?: boolean): number {
  let best = 0;
  for (const rider of field) {
    if (!rider.road || rider.isPlayer || rider.finishTime != null) continue;
    best = Math.max(best, climbRating(rider.road.attrs, grade, punchy));
  }
  return best;
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

function stageBest(body: RoadBody, field: RoadActor[], plan: RoadPlan): number {
  let best = stageStrength(body.attrs, plan.finishKind, plan.punchy);
  for (const rider of field) {
    if (rider.road?.teamId !== body.teamId) continue;
    best = Math.max(best, stageStrength(rider.road.attrs, plan.finishKind, plan.punchy));
  }
  return best;
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
  const pace = terrainWkg(plan, grade);
  const eased = racePace(plan, grade, remaining);
  const opening = !plan.timeTrial && along < 500;

  if (ask.waitOn && body.teammate && !ask.released) {
    const player = field.find((o) => o.isPlayer);
    if (player && along > roadAlong(plan, player.s) + 20) {
      r.mode = 'follow';
      r.targetPower = 1.4 * r.mass;
      return;
    }
  }

  const kicking = plan.finishKind === 'sprint' && remaining < 800 && remaining > 0 && grade < 0.035;
  if (ask.paceOn && body.teammate && !kicking) {
    r.mode = 'pace';
    r.targetPower = Math.max(0.8, ask.paceWkg) * r.mass;
    return;
  }

  const nearLast = plan.lastClimbS != null && along >= roadAlong(plan, plan.lastClimbS) - 500 && remaining > 100;
  const onLast = nearLast && grade > 0.035;
  const mine = climbRating(body.attrs, grade, plan.punchy);
  const peer = bestClimb(field, grade, plan.punchy);
  const attackers = field.filter((o) => o !== r && o.mode === 'attack' && o.finishTime == null).length;
  const already = r.mode === 'attack';
  const fresh = energy >= 0.32;
  let pack = -Infinity;
  let sawPack = false;
  for (const other of field) {
    if (other.finishTime != null || other.mode === 'attack' || other.mode === 'sprint') continue;
    sawPack = true;
    pack = Math.max(pack, roadAlong(plan, other.s));
  }
  const clear = sawPack ? along > pack + 35 : r.s > 35;

  // A clear move keeps a small edge while the bar is high, then falls under the bunch as the wind spends it.
  if (already && !nearLast) {
    if (clear) {
      r.mode = 'attack';
      r.targetPower = attackPower(pace, r.mass, breakFactor(energy));
      return;
    }
    if (energy >= 0.45) {
      r.mode = 'attack';
      r.targetPower = attackPower(pace, r.mass, 1.12);
      return;
    }
    r.mode = 'follow';
  }

  // The riders who can win this climb go. Everyone more than a few points back lets them go.
  if (!opening && !body.teammate && fresh && nearLast && attackers < 8 && mine >= peer - 6 && energy >= 0.4 && (mine >= peer - 2 || r.phase > 22 || already)) {
    const factor = clamp(1.1 + Math.max(0, mine - (peer - 3)) / 45, 1.1, 1.28);
    r.mode = 'attack';
    r.targetPower = attackPower(pace, r.mass, factor);
    if (!r.told) {
      r.told = true;
      note(events, `${r.name} attacks · ${(r.targetPower / r.mass).toFixed(1)} W/kg`);
    }
    return;
  }

  const marked = field.some((o) => o !== r && o.mode === 'attack' && !!o.road && roadAlong(plan, o.s) >= along - 20 && climbRating(o.road.attrs, grade, plan.punchy) >= mine - 1);
  if (!opening && !body.teammate && fresh && nearLast && marked && mine >= peer - 8 && energy >= 0.36 && attackers < 12) {
    r.mode = 'attack';
    r.targetPower = attackPower(pace, r.mass, 1.08);
    if (!r.told) {
      r.told = true;
      note(events, `${r.name} follows · ${(r.targetPower / r.mass).toFixed(1)} W/kg`);
    }
    return;
  }

  // One-day races: the best puncheur tries from a hill, not from the gun.
  if (!opening && !body.teammate && fresh && plan.oneDay && !onLast && progress > 0.38 && progress < 0.72 && grade > 0.03 && remaining > 1800 && mine >= peer - 2 && attackers < 2 && (r.phase > 60 || already)) {
    r.mode = 'attack';
    r.targetPower = attackPower(pace, r.mass, 1.12);
    if (!r.told) {
      r.told = true;
      note(events, `${r.name} attacks · ${(r.targetPower / r.mass).toFixed(1)} W/kg`);
    }
    return;
  }

  // Early move. The leader for this finish stays in. A few others jump, then ride a steady gap.
  const ownFinish = stageStrength(body.attrs, plan.finishKind, plan.punchy);
  const teamBestHere = stageBest(body, field, plan);
  const leader = ownFinish >= teamBestHere - 1 && teamBestHere >= 68;
  if (!opening && !body.teammate && fresh && !onLast && !leader && progress > 0.06 && progress < 0.22 && attackers < 4 && (r.phase > 84 || already)) {
    r.mode = 'attack';
    r.targetPower = attackPower(pace, r.mass, 1.16);
    if (!r.told) {
      r.told = true;
      note(events, `${r.name} goes clear · ${(r.targetPower / r.mass).toFixed(1)} W/kg`);
    }
    return;
  }

  if (remaining < 320 && remaining > 0 && plan.punchy && plan.finishKind === 'hill' && (onLast || remaining < 180)) {
    const kick = 1.04 + Math.max(0, punchScore(body.attrs) - 72) / 80;
    r.mode = 'sprint';
    r.targetPower = pace * kick * r.mass;
    return;
  }

  if (plan.finishKind === 'sprint' && grade < 0.035 && remaining < 800 && remaining > 0) {
    if (energy < 0.3) {
      r.mode = 'follow';
      r.targetPower = pace * r.mass;
      return;
    }
    if (remaining > 500) {
      if (body.attrs.sprint >= 82) {
        const move = Math.min(1.16, 1.12 + Math.max(0, body.attrs.sprint - 82) / 80);
        r.mode = 'sprint';
        r.targetPower = plan.flatWkg * move * r.mass;
        return;
      }
    } else {
      const kick = 1.08 + Math.max(0, body.attrs.sprint - 68) / 70;
      r.mode = 'sprint';
      r.targetPower = plan.flatWkg * kick * r.mass;
      return;
    }
  }

  if (remaining < 180 && remaining > 0 && plan.finishKind !== 'sprint') {
    r.mode = 'sprint';
    r.targetPower = pace * (1.04 + Math.max(0, body.attrs.sprint - 70) / 120) * r.mass;
    return;
  }

  // Earlier climbs stay together unless someone is far off the pace. The last climb
  // splits into groups: low stamina and a weaker climbing rating each open a gap.
  if (!opening && onLast) {
    const drop = lastClimbDrop(Math.max(0, peer - mine), energy);
    if (drop > 0.045) {
      r.mode = 'cracked';
      r.targetPower = pace * (1 - drop) * r.mass;
      return;
    }
  } else if (!opening && grade >= 0.05) {
    const gap = peer - mine;
    if (gap > 12) {
      const ease = 1 - Math.min(0.1, (gap - 12) / 140);
      const tired = energy < 0.35 ? 0.94 : 1;
      r.mode = 'cracked';
      r.targetPower = pace * ease * tired * r.mass;
      return;
    }
  }
  if (energy < 0.22 && grade >= 0.03) {
    r.mode = 'cracked';
    r.targetPower = pace * 0.9 * r.mass;
    return;
  }

  r.mode = 'follow';
  r.targetPower = eased * r.mass;
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
    if (!group || along(group[group.length - 1].s) - along(r.s) > 16) groups.push([r]);
    else group.push(r);
  }
  const tempo = teamTempoRank(field, plan.finishKind, plan.punchy);
  const main = groups.reduce<RoadActor[] | null>((best, group) => (!best || group.length > best.length ? group : best), null);
  let gapSec = 0;
  if (main && main.length) {
    const noseAlong = along(main[0].s);
    let back = Infinity;
    for (const rider of field) {
      if (rider.isPlayer || rider.finishTime != null || rider.mode !== 'attack') continue;
      const pos = along(rider.s);
      if (pos > noseAlong + 8) back = Math.min(back, pos);
    }
    if (back < Infinity) gapSec = (back - noseAlong) / Math.max(2, main[0].v);
  }
  groups.forEach((group) => {
    if (group.length < 2) return;
    const current = [...group].sort((a, b) => along(b.s) - along(a.s));
    const nose = current[0];
    const grade = slope(nose.s);
    const ask = ordersAt(plan, orders, player?.s ?? nose.s, grade);
    const opening = along(nose.s) < 500;
    const eased = opening ? terrainWkg(plan, grade) : racePace(plan, grade, roadRemaining(plan, nose.s));
    const factor = group === main ? flatRunIn(plan, roadRemaining(plan, nose.s), gapSec, grade) : 1;
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
    const matesLead = orderedOn && rearmostMate >= foremostOther - 2.5;
    const groupWkg = matesLead ? ask.paceWkg : eased * factor;
    const pace = steadySpeed(Math.max(0, groupWkg * nose.mass), rollGrade, nose.bike, altAt(nose.s), 0);
    const ordered = orderPull(
      tempoOrder(group, tempo, plan.finishKind, plan.punchy, (rider) => along(rider.s)),
      field,
      plan,
      along(nose.s),
      tempo,
    );
    if (factor > 1 && !matesLead) {
      for (let i = 0; i < Math.min(LINE_LENGTH, ordered.length); i++) {
        const rider = ordered[i];
        if (isProtectedRider(rider, field, plan) || (rider.energy ?? 1) < 0.3) continue;
        rider.targetPower = plan.flatWkg * factor * rider.mass;
      }
    }
    const lead = ordered[0];
    const slot = new Map(ordered.map((rider, index) => [rider, index]));
    for (const rider of current) {
      let base = pace;
      if (!opening && orderedOn && rider.road?.teammate && !matesLead) {
        const own = steadySpeed(Math.max(0, ask.paceWkg * rider.mass), rollGrade, rider.bike, altAt(rider.s), 0);
        base = Math.max(own, bunch + 0.65);
      }
      // Hold the pace you set. Only the rider who should be leading creeps
      // past the wheel ahead, and only that one wheel eases. The group does not surge or sit up.
      const want = slot.get(rider) ?? 0;
      // The line at the front is evenly spaced; the spread bunch behind is staggered so it does not look gridded.
      const stagger = want < LINE_LENGTH ? 0 : (rider.id % 5) * 0.17;
      const wantAlong = along(nose.s) - slotOffset(want) - stagger;
      let drift = 0;
      if (!opening && !orderedOn) {
        if (rider === lead && rider !== nose) drift = 0.3;
        else if (rider === nose && rider !== lead) drift = -0.18;
        else if (rider !== nose) drift = clamp((wantAlong - along(rider.s)) * 0.08, -0.2, 0.3);
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
        rider.v = Math.max(0.4, Math.min(rider.v, ahead.v - (FILE_SPACING - gap) * 0.3));
        break;
      }
    }
  });
  const breaks = field.filter((r) => !r.isPlayer && r.finishTime == null && r.mode === 'attack' && r.road).sort((a, b) => along(b.s) - along(a.s));
  const escape: RoadActor[][] = [];
  for (const r of breaks) {
    const group = escape[escape.length - 1];
    if (!group || along(group[group.length - 1].s) - along(r.s) > 16) escape.push([r]);
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
  for (const r of field) {
    if (r.isPlayer || r.finishTime != null || (r.mode !== 'attack' && r.mode !== 'sprint')) continue;
    const grade = slope(r.s);
    const powered = steadySpeed(Math.max(0, r.targetPower), grade, r.bike, altAt(r.s), 0);
    r.v = Math.min(r.v, powered);
  }
  if (!player || orders.released) return;
  for (const r of field) {
    if (!r.road?.teammate || r.finishTime != null || r.mode === 'sprint' || r.mode === 'finished') continue;
    const ahead = along(r.s) - along(player.s);
    if (orders.waitOn && ahead > 18) r.v = Math.min(r.v, 1.8);
    else if (!orders.paceOn && ahead > 16) r.v = Math.min(r.v, Math.max(1.2, player.v * 0.98));
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
