import { DRIVETRAIN_EFFICIENCY, resistiveForce, type BikeParams } from '../physics/cycling';

/** The slice of a rider the meter reads. */
export interface MeteredRider {
  s: number;
  v: number;
  mass: number;
  bike: BikeParams;
  draft: number;
  direction: 1 | -1;
  /** The effort the AI has chosen. Road races only use it as a ceiling. */
  targetPower: number;
}

/** Like a head unit's 3-second power: quick enough to see an attack, calm enough to read. */
const SMOOTH_SEC = 1.5;
/** A real bike does not speed up faster than this. Anything quicker is a placement, not pedalling. */
const MAX_ACCEL = 3;
/** Speed is smoothed this much before it is differentiated, so one step's nudge is not an effort. */
const SPEED_SEC = 0.5;

/**
 * Watts at the pedals for a rider's actual motion: what it costs to hold
 * this speed on this grade, with this much shelter, plus what it took to
 * speed up. The same physics the riders move by, so a group riding together
 * on a climb reads nearly the same W/kg, whatever each rider weighs.
 *
 * Read from the motion, not from the AI's target, because in a road race the
 * bunch is often held to a shared speed and its target power is only a wish.
 */
export function pedalWatts(
  v: number,
  accel: number,
  grade: number,
  bike: BikeParams,
  altitude: number,
  draft: number,
): number {
  if (v < 0.3) return 0;
  // stepSpeed counts about 1 kg extra for the wheels spinning up.
  const push = resistiveForce(v, grade, bike, altitude, draft) + (bike.mass + 1) * accel;
  return Math.max(0, (push * v) / DRIVETRAIN_EFFICIENCY);
}

/**
 * Smoothed power for every rider in a ride, updated after each physics step.
 *
 * `paced` is for road races. There the race model sets the bunch speed, and
 * that speed is not always what the riders' power would give:
 * - Slowing is eased by the model, so it is not counted as soft-pedalling.
 *   A bunch at 32 km/h reads what holding 32 km/h costs.
 * - Speeding up counts, up to the effort the rider has chosen. An attack
 *   shows its watts; a bunch the model rolls faster than its power cannot
 *   show more than it is riding.
 * Everywhere else the riders move by their power alone and the full physics
 * applies, slowing included.
 */
export class PowerMeter {
  private speed: number[] = [];
  private watts: number[] = [];
  /** Physics time stepped since the last reading, see `defer`. */
  private pending = 0;

  /**
   * Note a physics step without reading the riders. `settle` reads them once for all the time noted.
   * Perf: the only reader is the hover tag, once per drawn frame, so reading every substep (and through a
   * hidden tab's catch-up of up to 75 s) was wasted work. Settled values are the same; see powerMeter.test.ts.
   */
  defer(dt: number): void {
    if (dt > 0) this.pending += dt;
  }

  /** Reads the riders once for all the time noted by `defer` since the last reading. */
  settle(
    riders: readonly MeteredRider[],
    gradeAt: (s: number) => number,
    elevationAt: (s: number) => number,
    paced = false,
  ): void {
    if (this.pending <= 0) return;
    const dt = this.pending;
    this.pending = 0;
    // After a gap longer than the smoothing window nothing of the old reading would be left, and a speed
    // change spread over a minute is no effort: start again from the current motion.
    if (dt >= SMOOTH_SEC) {
      this.speed.length = 0;
      this.watts.length = 0;
    }
    this.update(riders, dt, gradeAt, elevationAt, paced);
  }

  update(
    riders: readonly MeteredRider[],
    dt: number,
    gradeAt: (s: number) => number,
    elevationAt: (s: number) => number,
    paced = false,
  ): void {
    if (dt <= 0) return;
    const k = Math.min(1, dt / SMOOTH_SEC);
    const kv = Math.min(1, dt / SPEED_SEC);
    for (let i = 0; i < riders.length; i++) {
      const r = riders[i];
      const prev = this.speed[i];
      if (prev === undefined) {
        this.speed[i] = r.v;
        this.watts[i] = pedalWatts(r.v, 0, gradeAt(r.s) * r.direction, r.bike, elevationAt(r.s), r.draft);
        continue;
      }
      const smooth = prev + (r.v - prev) * kv;
      this.speed[i] = smooth;
      const accel = Math.max(paced ? 0 : -MAX_ACCEL, Math.min(MAX_ACCEL, (smooth - prev) / dt));
      const grade = gradeAt(r.s) * r.direction;
      const alt = elevationAt(r.s);
      let now = pedalWatts(smooth, accel, grade, r.bike, alt, r.draft);
      if (paced && accel > 0) now = Math.min(now, Math.max(pedalWatts(smooth, 0, grade, r.bike, alt, r.draft), r.targetPower));
      this.watts[i] += (now - this.watts[i]) * k;
    }
  }

  /** Smoothed watts for rider `index`, 0 before the first update. */
  wattsOf(index: number): number {
    return this.watts[index] ?? 0;
  }

  /** Smoothed W/kg for rider `index`, on body weight like a head unit shows it. */
  wkgOf(index: number, massKg: number): number {
    return massKg > 0 ? this.wattsOf(index) / massKg : 0;
  }
}
