import { describe, expect, it } from 'vitest';
import { chooseLane, type LaneOccupant } from './traffic';

const LEN = 10000;
const HOME = 2.25;

function car(over: Partial<LaneOccupant & { cruise: number }> = {}) {
  return { s: 1000, lat: HOME, speed: 14, dir: 1 as const, length: 4.4, cruise: 14, ...over };
}

function rider(over: Partial<LaneOccupant> = {}): LaneOccupant {
  return { s: 1012, lat: 2.2, speed: 8, dir: 1, length: 1.8, ...over };
}

describe('chooseLane', () => {
  it('stays in the right lane on a clear road', () => {
    expect(chooseLane(car(), HOME, LEN, [])).toBe(HOME);
  });

  it('passes in the other lane, clear of the centre line', () => {
    expect(chooseLane(car(), HOME, LEN, [rider()])).toBeLessThan(-1.2);
  });

  it('does not pull out for a rider who is still far ahead', () => {
    expect(chooseLane(car(), HOME, LEN, [rider({ s: 1040 })])).toBe(HOME);
  });

  it('returns to the right lane once the rider has been passed', () => {
    // Sitting near the centre line with the rider already behind used to count as still overtaking.
    expect(chooseLane(car({ s: 1020, lat: 0.4 }), HOME, LEN, [rider({ s: 1008 })])).toBe(HOME);
  });

  it('stays out only while the rider is still alongside', () => {
    expect(chooseLane(car({ s: 1012, lat: -1.9 }), HOME, LEN, [rider({ s: 1008 })])).toBeLessThan(-1.2);
  });

  it('waits in lane when an oncoming car would meet the pass', () => {
    const oncoming: LaneOccupant = { s: 1040, lat: -2.2, speed: 14, dir: -1, length: 4.4 };
    expect(chooseLane(car(), HOME, LEN, [rider(), oncoming])).toBe(HOME);
  });

  it('lets oncoming traffic pass on its own left', () => {
    const them = car({ lat: -2.2, dir: -1 });
    const ahead: LaneOccupant = { s: 988, lat: -2.1, speed: 8, dir: -1, length: 1.8 };
    expect(chooseLane(them, -2.2, LEN, [ahead])).toBeGreaterThan(1.2);
  });
});
