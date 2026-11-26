import { describe, expect, it } from 'vitest';
import { BRAKE_DECEL, DRIVETRAIN_EFFICIENCY, GRAVITY, MAX_SPEED, airDensity, makeBikeParams, powerForSpeed, steadySpeed, stepSpeed, draftFromGap, type BikeParams } from './cycling';

describe('cycling physics', () => {
  const bike = makeBikeParams(70);

  it('gives realistic flat speed at 200 W', () => {
    const kmh = steadySpeed(200, 0, bike) * 3.6;
    expect(kmh).toBeGreaterThan(30);
    expect(kmh).toBeLessThan(36);
  });

  it('gives realistic climbing speed: 3.5 W/kg on 8% is roughly 12-14 km/h', () => {
    const kmh = steadySpeed(245, 0.08, bike) * 3.6;
    expect(kmh).toBeGreaterThan(11.5);
    expect(kmh).toBeLessThan(14.5);
  });

  it('powerForSpeed and steadySpeed are inverses', () => {
    const v = steadySpeed(300, 0.05, bike, 1000);
    expect(powerForSpeed(v, 0.05, bike, 1000)).toBeCloseTo(300, 0);
  });

  it('coasts downhill without power', () => {
    expect(steadySpeed(0, -0.06, bike) * 3.6).toBeGreaterThan(50);
    expect(steadySpeed(0, 0.02, bike)).toBe(0);
  });

  it('keeps a weak rider moving up a steep ramp instead of stalling', () => {
    // 1 W/kg on 12.8%, the steepest stretch of Vršič.
    let v = 0;
    for (let i = 0; i < 2000; i++) v = stepSpeed(v, 70, 0.128, bike, 0.05);
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeCloseTo(steadySpeed(70, 0.128, bike), 1);
    // A rider at 1 W/kg who has lost half of it, on the 23.5 % of the Angliru.
    for (let i = 0; i < 2000; i++) v = stepSpeed(v, 35, 0.235, bike, 0.05);
    expect(v).toBeCloseTo(steadySpeed(35, 0.235, bike), 1);
    expect(v).toBeGreaterThan(0.15);
  });

  it('stepSpeed converges to steady speed', () => {
    let v = 0;
    for (let i = 0; i < 2000; i++) v = stepSpeed(v, 250, 0.03, bike, 0.05);
    expect(v).toBeCloseTo(steadySpeed(250, 0.03, bike), 1);
  });

  it('brakes a steep descent to a stop, gradually, even while pedalling', () => {
    let v = 12;
    const slowed = stepSpeed(v, 250, -0.12, bike, 0.5, 0, 0, BRAKE_DECEL);
    expect(slowed).toBeLessThan(v - 0.5);
    expect(slowed).toBeGreaterThan(8);
    for (let i = 0; i < 400; i++) v = stepSpeed(v, 250, -0.12, bike, 0.05, 0, 0, BRAKE_DECEL);
    expect(v).toBe(0);
    expect(stepSpeed(0, 250, -0.12, bike, 0.05, 0, 0, BRAKE_DECEL)).toBe(0);
    let coast = 12;
    for (let i = 0; i < 40; i++) coast = stepSpeed(coast, 0, -0.12, bike, 0.05);
    expect(coast).toBeGreaterThan(12);
  });

  it('drafting saves most when close and aligned', () => {
    expect(draftFromGap(0.8, 0)).toBeCloseTo(0.33);
    expect(draftFromGap(6, 0)).toBeLessThan(0.15);
    expect(draftFromGap(1, 1.5)).toBeGreaterThan(0.05);
    expect(draftFromGap(1, 1.5)).toBeLessThan(draftFromGap(1, 0));
    expect(draftFromGap(1, 2.4)).toBe(0);
    expect(draftFromGap(20, 0)).toBe(0);
  });
});

/** The original bisection solver, kept to check the closed-form one against it. */
function referenceSteadySpeed(power: number, grade: number, bike: BikeParams, altitude: number, draft: number): number {
  const force = (v: number) => {
    const theta = Math.atan(grade);
    const rolling = v > 0.01 ? bike.mass * GRAVITY * Math.cos(theta) * bike.crr : 0;
    return bike.mass * GRAVITY * Math.sin(theta) + rolling + 0.5 * airDensity(altitude) * bike.cda * (1 - draft) * v * v;
  };
  const pw = (v: number) => Math.max(0, (force(v) * v) / DRIVETRAIN_EFFICIENCY);
  const coasting = () => {
    if (force(0.1) >= 0) return 0;
    let lo = 0;
    let hi = MAX_SPEED;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (force(mid) < 0) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  let lo = 0;
  let hi = MAX_SPEED;
  if (pw(hi) < power) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (pw(mid) > power) hi = mid;
    else lo = mid;
  }
  if (power <= 0 || pw(lo) === 0) return coasting();
  return lo;
}

describe('steadySpeed solver', () => {
  it('matches the bisection solver within 0.05 m/s', () => {
    let worst = 0;
    for (const mass of [45, 63, 78, 95, 125]) {
      const bike = makeBikeParams(mass);
      for (let grade = -0.25; grade <= 0.25 + 1e-9; grade += 0.01) {
        for (const power of [0, 0.5, 5, 30, 80, 150, 220, 300, 420, 600, 900, 1400, 2500]) {
          for (const altitude of [0, 1200, 2600]) {
            for (const draft of [0, 0.15, 0.33]) {
              const a = steadySpeed(power, grade, bike, altitude, draft);
              const b = referenceSteadySpeed(power, grade, bike, altitude, draft);
              worst = Math.max(worst, Math.abs(a - b));
            }
          }
        }
      }
    }
    expect(worst).toBeLessThan(0.05);
  });
});
