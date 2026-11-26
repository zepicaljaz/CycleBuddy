import { clamp } from '../util/math';

export const GRAVITY = 9.80665;
export const DRIVETRAIN_EFFICIENCY = 0.976;
export const DEFAULT_BIKE_MASS = 8;
export const DEFAULT_CDA = 0.32;
export const DEFAULT_CRR = 0.004;
export const MAX_SPEED = 200 / 3.6; // 200 km/h, so a test ride can cover a route quickly
/** Extra deceleration while braking, in m/s². Stronger than a 16% descent (~1.6 m/s²), so holding the brake reaches a stop. From 40 km/h on the flat it takes about four seconds. */
export const BRAKE_DECEL = 2.8;
/** Below this speed (m/s) pedal force is no longer power over speed, so a standing start is not a catapult. */
const FORCE_FLOOR_SPEED = 1;
/**
 * In the bottom gear a slow rider can still push this hard (N), enough for the steepest ramps at
 * walking pace. Without it anyone under about 1.5 W/kg stops dead on 12% and never moves again.
 */
const BOTTOM_GEAR_FORCE = 250;
/** The slowest speed (m/s) the bottom gear turns power into force at. */
const BOTTOM_GEAR_SPEED = 0.1;

export interface BikeParams {
  /** Rider + bike mass in kg. */
  mass: number;
  cda: number;
  crr: number;
}

export function makeBikeParams(riderMassKg: number, bikeMassKg = DEFAULT_BIKE_MASS): BikeParams {
  return { mass: riderMassKg + bikeMassKg, cda: DEFAULT_CDA, crr: DEFAULT_CRR };
}

/** Air density in kg/m^3 at the given altitude (simple barometric model). */
export function airDensity(altitudeM: number): number {
  return 1.225 * Math.exp(-Math.max(0, altitudeM) / 8500);
}

/**
 * Total resistive force at speed v (m/s).
 * @param grade rise over run (0.08 = 8%)
 * @param draft fraction of aero drag saved by drafting (0..0.5)
 */
export function resistiveForce(
  v: number,
  grade: number,
  bike: BikeParams,
  altitude = 0,
  draft = 0,
): number {
  // sin and cos of atan(grade), without the trigonometry.
  const hyp = Math.sqrt(1 + grade * grade);
  const gravity = (bike.mass * GRAVITY * grade) / hyp;
  const rolling = v > 0.01 ? (bike.mass * GRAVITY * bike.crr) / hyp : 0;
  const aero = 0.5 * airDensity(altitude) * bike.cda * (1 - draft) * v * v;
  return gravity + rolling + aero;
}

/** Power at the pedals required to hold speed v steady. */
export function powerForSpeed(v: number, grade: number, bike: BikeParams, altitude = 0, draft = 0): number {
  return Math.max(0, (resistiveForce(v, grade, bike, altitude, draft) * v) / DRIVETRAIN_EFFICIENCY);
}

/**
 * Steady-state speed for a given power.
 * Holding speed v takes K·v³ + C·v = P·efficiency, with K the aero term and C the
 * gravity plus rolling force. That cubic is solved directly, then polished with
 * one Newton step. The AI calls this for every rider many times a second, so it
 * must stay cheap.
 */
export function steadySpeed(power: number, grade: number, bike: BikeParams, altitude = 0, draft = 0): number {
  const hyp = Math.sqrt(1 + grade * grade);
  const weight = bike.mass * GRAVITY;
  const c = (weight * (grade + bike.crr)) / hyp;
  const k = 0.5 * airDensity(altitude) * bike.cda * (1 - draft);
  // On steep descents even zero power gives a high speed: the coasting speed.
  const coast = c < 0 ? Math.min(MAX_SPEED, Math.sqrt(-c / k)) : 0;
  if (power <= 0) return coast;
  const q = (power * DRIVETRAIN_EFFICIENCY) / k;
  const p = c / k;
  // Largest real root of v³ + p·v − q = 0.
  const half = q / 2;
  const disc = half * half + (p * p * p) / 27;
  let v: number;
  if (disc >= 0) {
    const r = Math.sqrt(disc);
    v = Math.cbrt(half + r) + Math.cbrt(half - r);
  } else {
    // Three real roots (descents only, p < 0): the trigonometric form.
    const m = 2 * Math.sqrt(-p / 3);
    v = m * Math.cos(Math.acos(clamp((3 * -q) / (p * m), -1, 1)) / 3);
  }
  const slope = 3 * v * v + p;
  if (slope > 0) v -= (v * v * v + p * v - q) / slope;
  if (!(v > coast)) return coast;
  return Math.min(MAX_SPEED, v);
}

/**
 * Advance speed by dt seconds given pedal power. Returns the new speed.
 * `brake` is extra deceleration in m/s². While it is held the pedals no longer
 * drive the wheel, so a steep descent still comes to a stop.
 */
export function stepSpeed(
  v: number,
  power: number,
  grade: number,
  bike: BikeParams,
  dt: number,
  altitude = 0,
  draft = 0,
  brake = 0,
): number {
  const braking = brake > 0;
  const wheel = Math.max(0, power) * DRIVETRAIN_EFFICIENCY;
  let drive = braking ? 0 : wheel / Math.max(v, FORCE_FLOOR_SPEED);
  if (!braking && v < FORCE_FLOOR_SPEED) drive = Math.max(drive, Math.min(wheel / Math.max(v, BOTTOM_GEAR_SPEED), BOTTOM_GEAR_FORCE));
  const resist = resistiveForce(v, grade, bike, altitude, draft);
  // ~1 kg of extra effective mass for wheel rotational inertia
  const accel = (drive - resist) / (bike.mass + 1) - Math.max(0, brake);
  return clamp(v + accel * dt, 0, MAX_SPEED);
}

/** How far to the side a wheel can sit and still shelter the rider behind. A pair rides side by side, so the shelter is wider than one line. */
const DRAFT_LATERAL = 2.1;

/** Fraction of aero drag saved when following a wheel `gap` metres behind. */
export function draftFromGap(gap: number, lateralOffset: number): number {
  if (gap <= 0.2 || gap > 12 || Math.abs(lateralOffset) > DRAFT_LATERAL) return 0;
  const lateralFactor = 1 - Math.abs(lateralOffset) / DRAFT_LATERAL;
  const gapFactor = gap <= 1 ? 1 : Math.pow(Math.max(0, 1 - (gap - 1) / 11), 1.4);
  return 0.33 * gapFactor * lateralFactor;
}
