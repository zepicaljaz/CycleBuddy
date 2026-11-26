/**
 * The parts of a Career road race that the bunch shares: who is in the break, who is surging,
 * how hard the chase may ride, when each sprinter jumps. Plus the small physiology helpers the
 * road AI uses for surges, sprints, descents and day form.
 *
 * The rule the whole file keeps: the bunch tempo is the player's sliders. Everything here is a
 * short, bounded effort above the slider (an attack, a counter, a sprint) or a speed the bunch
 * holds so a break can be caught. Numbers are scaled to Career stages of 15-30 km; physiology
 * that runs in time (a 40 s attack, a 12 s sprint) is not scaled. See docs/CAREER_RACING.md.
 */
import { steadySpeed, type BikeParams } from '../physics/cycling';
import { clamp, hashString, mulberry32 } from '../util/math';

/** Chapatte's law: an organised chase takes back about a minute every 10 km, so 6 s per km. */
export const CHASE_SEC_PER_KM = 6;

export type SurgeKind = 'attempt' | 'bridge' | 'climb' | 'counter' | 'punch' | 'descent';

export interface Surge {
  kind: SurgeKind;
  /** Metres along the stage where it started. */
  fromAlong: number;
  /** How far it lasts, in metres. Set from the planned seconds and the speed at the start. */
  lenM: number;
  /** Power as a multiple of the slider for the slope (descents: of the descent tempo). */
  factor: number;
}

export type BreakState = 'open' | 'forming' | 'gone' | 'none';

export interface RaceBrain {
  seed: number;
  rng: () => number;
  span: number;
  /** The early break may form between these two points, in metres along. */
  breakFrom: number;
  breakTo: number;
  /** Riders the break grows to: 3 to 6. */
  breakTarget: number;
  /** Which attempt sticks (1, 2 or 3). 99 means no break today. */
  stickAt: number;
  attempts: number;
  nextAttemptAt: number;
  nextBridgeAt: number;
  breakState: BreakState;
  members: Set<number>;
  /** Riders whose attempt failed. They ease off until the bunch takes them back. */
  sitUp: Set<number>;
  surges: Map<number, Surge>;
  /** Final-climb attacks already made, per rider. */
  climbMoves: Map<number, number>;
  /** Share of the slider each rider rides on the last climb, decided at its foot. Below 1 they are not racing for the win. */
  climbEase: Map<number, number>;
  /** Metres along where each cracked rider cracked. */
  crackedAt: Map<number, number>;
  /** Metres along where each sprinter jumped. */
  launchedAt: Map<number, number>;
  /** 0 to 1: how much the sprint teams will commit to the chase today. Low means the break may survive. */
  chaseCommit: number;
  /** Seconds the bunch lets the break have before it holds the gap. */
  gapCap: number;
  /** Metres along of the last descent the bunch was checked on for a descent attack. */
  descentSeen: number;
  descentAttacks: number;
  /** Metres along of the bunch nose at the last whole-race decision. */
  lastDirect: number;
  /** Best ratings in the field, found once. */
  peers: FieldPeers | null;
  /** Metres along where the final ascent starts, found once from the road profile. Null: no climb finish. Undefined: not looked at yet. */
  finaleAlong?: number | null;
}

const brains = new WeakMap<object, RaceBrain>();

/** 0 to 1 from a string, the same every time. */
export function hash01(text: string): number {
  return hashString(text) / 4294967296;
}

/**
 * The shared race state for one field. Keyed by the field array, so a new race gets a new brain.
 * Seeded from the riders' phases, which come from the race seed, so a seed always gives the same race.
 */
export function brainFor(field: readonly { phase: number }[], span: number): RaceBrain {
  const known = brains.get(field);
  if (known) return known;
  let seed = field.length * 7919;
  for (const rider of field) seed = (seed + Math.floor(rider.phase * 104729)) >>> 0;
  const rng = mulberry32(seed);
  const breakFrom = Math.max(500, span * 0.03);
  const breakTo = Math.min(Math.max(breakFrom + 1500, span * 0.25), 6000, span * 0.4);
  const brain: RaceBrain = {
    seed,
    rng,
    span,
    breakFrom,
    breakTo,
    breakTarget: 3 + Math.floor(rng() * 4),
    stickAt: rng() < 0.9 ? 1 + Math.floor(rng() * 3) : 99,
    attempts: 0,
    nextAttemptAt: breakFrom + rng() * 400,
    nextBridgeAt: 0,
    breakState: 'open',
    members: new Set(),
    sitUp: new Set(),
    surges: new Map(),
    climbMoves: new Map(),
    climbEase: new Map(),
    crackedAt: new Map(),
    launchedAt: new Map(),
    chaseCommit: rng(),
    gapCap: gapCap(span / 1000, rng()),
    descentSeen: -Infinity,
    descentAttacks: 0,
    lastDirect: -Infinity,
    peers: null,
  };
  brains.set(field, brain);
  return brain;
}

/** The biggest gap the bunch allows the early break: about 2.2 s per km of stage, 25-75 s, with a day-to-day spread. */
export function gapCap(spanKm: number, roll: number): number {
  return clamp(2.2 * spanKm, 25, 75) * (0.8 + 0.4 * roll);
}

/** Day form: 0.93 to 1.07. It changes surge capacity and sprint power only, never the bunch tempo. */
export function dayForm(riderId: string, seed: number): number {
  // Asked for every rider on every step: keep the last race's values instead of hashing a new string each time.
  if (seed !== formSeed) {
    formSeed = seed;
    formCache.clear();
  }
  let form = formCache.get(riderId);
  if (form === undefined) {
    form = 0.93 + 0.14 * hash01(`form:${riderId}:${seed}`);
    formCache.set(riderId, form);
  }
  return form;
}
let formSeed: number | undefined;
const formCache = new Map<string, number>();

/** Descending skill: speed on a descent for a rider alone or in a break, about ±1.5%. The same rider every race. */
export function descentSkill(riderId: string): number {
  return (hash01(`descend:${riderId}`) - 0.5) * 0.03;
}

/**
 * Multiple of the slider this rider can hold for as long as they like, from their rating on this
 * slope against the best rating in today's field. The best rider holds about 9% over the slider,
 * a rider 11 points behind holds the slider exactly, 22 points behind about 9% under. Measured
 * against today's field because the slider is the bunch's tempo in every division. Day form moves it a little.
 */
export function criticalRatio(rating: number, peer: number, form = 1): number {
  return clamp(1.09 + (rating - peer) / 120, 0.9, 1.12) + (form - 1) * 0.5;
}

/**
 * Size of the surge reserve, in "slider-seconds": riding 0.25 over the critical ratio empties a
 * budget of 12.5 in 50 s. 10 for a rider 30 points behind the best, up to 17.5 for the best; times day form.
 */
export function reserveBudget(rating: number, peer: number, form = 1): number {
  return (10 + clamp(rating - (peer - 30), 0, 30) / 4) * form;
}

export interface FieldPeers {
  flat: number;
  hills: number;
  medium: number;
  mountain: number;
  punch: number;
  sprint: number;
}

/**
 * One tick of the surge reserve (0 to 1), a W'-balance model measured against the slider.
 * Above the critical ratio it empties in proportion to the excess. Below it, it refills, faster the easier the effort.
 */
export function tickReserve(reserve: number, relative: number, critical: number, budget: number, recovery: number, dt: number): number {
  if (relative > critical) return clamp(reserve - ((relative - critical) * dt) / Math.max(1, budget), 0, 1);
  const rate = ((critical - relative) * (1 - reserve) * dt) / 60;
  return clamp(reserve + rate * (recovery / 70), 0, 1);
}

/**
 * Power of a break, as a multiple of the slider for the slope. A group shares the wind, so on the
 * flat it rides faster than the bunch's front; on a climb the wind matters little and it rides near
 * the slider. It fades as the stamina bar empties.
 */
export function breakPace(energy: number, grade: number, size: number): number {
  const flat = size >= 2 ? 1.16 : 1.1;
  const climb = 1.03;
  const w = clamp((grade - 0.01) / 0.04, 0, 1);
  const base = flat + (climb - flat) * w;
  const fade = 0.86 + 0.14 * clamp((energy - 0.1) / 0.6, 0, 1);
  return base * fade;
}

/**
 * Peak sprint power: the flat slider times 3.2 to 5, capped at 16 W/kg. The best sprinter in today's
 * field gets 4.7 times the slider, and each 12 points behind him is one times less. Day form moves it ±3.5%.
 */
export function sprintPeakWkg(flatWkg: number, sprint: number, peer: number, form = 1): number {
  const mult = clamp(4.7 + (sprint - peer) / 12, 3.2, 5);
  return Math.min(16, flatWkg * mult * (1 + (form - 1) * 0.5));
}

/**
 * Where the final ascent of a climb finish starts, in metres along the stage. Walks back from the
 * line while the road keeps climbing (200 m average of 2% or more), across dips of up to 700 m, so a
 * finish over two or three short walls counts from the first of them.
 * Null when the last 300 m do not climb, so the finish is after the climb, not on it.
 */
export function finaleStart(span: number, gradeAlong: (along: number) => number): number | null {
  const step = 25;
  const windowAvg = (end: number) => {
    let sum = 0;
    let n = 0;
    for (let a = Math.max(0, end - 200); a <= end; a += step) {
      sum += gradeAlong(a);
      n++;
    }
    return n ? sum / n : 0;
  };
  if (windowAvg(span) < 0.015 && windowAvg(span - 100) < 0.015) return null;
  let start = span;
  let dip = 0;
  for (let a = span; a > 0; a -= step) {
    if (windowAvg(a) >= 0.02) {
      start = Math.max(0, a - 200);
      dip = 0;
    } else {
      dip += step;
      if (dip > 700) break;
    }
  }
  return span - start >= 300 ? start : null;
}

/**
 * Peak of an uphill kick at the end of a hill or mountain finish: 1.5 to 2.6 times the slope's slider.
 * The best finisher in today's field gets 2.4 times, and each 15 points behind him is one times less.
 */
export function kickPeakWkg(tempoWkg: number, rating: number, peer: number, form = 1): number {
  return tempoWkg * clamp(2.4 + (rating - peer) / 15, 1.5, 2.6) * (1 + (form - 1) * 0.5);
}

/** Seconds a sprinter holds the peak: 9 to 12 by sprint rating. */
export function sprintHold(sprint: number): number {
  return clamp(9 + (sprint - 70) / 15, 9, 12);
}

/** Sprint power over time, in W/kg: 3 s ramp from the bunch effort, the hold, then a fade to 55% of the peak. */
export function sprintCurve(peak: number, base: number, t: number, hold: number, ramp = 3): number {
  if (t <= 0) return base;
  if (t < ramp) return base + (peak - base) * (t / ramp);
  if (t < ramp + hold) return peak;
  return peak * Math.max(0.55, 1 - 0.06 * (t - ramp - hold));
}

/** Metres to go where a sprinter jumps: 120-340 m by rating and luck. About one in eight goes too early, from 300-380 m. */
export function launchDistance(riderId: string, sprint: number, seed: number): number {
  const roll = hash01(`launch:${riderId}:${seed}`);
  if (roll > 0.88) return 300 + (roll - 0.88) / 0.12 * 80;
  return clamp(170 + (sprint - 75) * 3 + (roll - 0.5) * 140, 120, 340);
}

/** Bunch speed that closes `gapSec` of a break riding at vBreak within kmToCatch. */
export function chaseSpeedNeeded(vBreak: number, gapSec: number, kmToCatch: number): number {
  const rate = gapSec / Math.max(0.3, kmToCatch);
  const perKm = 1000 / Math.max(1, vBreak) - rate;
  return perKm <= 1000 / 30 ? 30 : 1000 / perKm;
}

/** Smallest multiple of the slider, from 1 to cap, whose solo speed reaches vTarget. */
export function factorForSpeed(vTarget: number, wkg: number, mass: number, grade: number, bike: BikeParams, alt: number, cap: number): number {
  if (cap <= 1 || steadySpeed(Math.max(0, wkg * mass), grade, bike, alt, 0) >= vTarget) return 1;
  if (steadySpeed(Math.max(0, wkg * cap * mass), grade, bike, alt, 0) <= vTarget) return cap;
  let lo = 1;
  let hi = cap;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (steadySpeed(Math.max(0, wkg * mid * mass), grade, bike, alt, 0) >= vTarget) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** How hard the chase may ride, as a multiple of the slider: 1.2 to 1.38 by commitment, less when the pullers are tired. */
export function chaseCap(commit: number, pullerEnergy: number, grade: number): number {
  if (grade >= 0.03) return 1.06;
  const base = 1.2 + 0.18 * clamp(commit, 0, 1);
  const fresh = clamp(pullerEnergy / 0.7, 0.6, 1);
  return 1 + (base - 1) * fresh;
}

/** Metres to go where the chase aims to catch the break. A sprint finish: about 2-3 km out. A climb finish: 40% of the way up the last climb. */
export function catchRemaining(span: number, finishKind: 'sprint' | 'hill' | 'mountain', lastClimbAlong: number | null): number {
  if (finishKind !== 'sprint' && lastClimbAlong != null) return Math.max(300, (span - lastClimbAlong) * 0.6);
  return clamp(span * 0.13, 1500, 3500);
}
