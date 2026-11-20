import { describe, expect, it } from 'vitest';
import { distanceAhead, rideBar, type BarClimb } from './rideBar';

const climbs: BarClimb[] = [
  { name: 'Oak Ridge', start: 4300, end: 7800, length: 3500, startElevation: 200, summitElevation: 400 },
  { name: 'Chapel Wall', start: 14000, end: 16800, length: 2800, startElevation: 180, summitElevation: 360 },
  { name: 'Long Meadow', start: 23000, end: 28000, length: 5000, startElevation: 160, summitElevation: 410 },
];
const length = 39000;
const elevationAt = () => 220;

function bar(s: number, direction: 1 | -1, list: BarClimb[] = climbs) {
  return rideBar({ s, length, direction, name: 'Oakwood Hills', lap: 1, climbs: list, elevationAt });
}

describe('ride bar', () => {
  it('counts the next climb forward and fills the lap from the start', () => {
    const atStart = bar(0, 1);
    expect(atStart.title).toBe('Oakwood Hills · Lap 1');
    expect(atStart.frac).toBe(0);
    expect(atStart.detail).toBe('Next climb: Oak Ridge in 4.3 km');

    const closer = bar(2000, 1);
    expect(closer.frac).toBeCloseTo(2000 / length);
    expect(closer.detail).toBe('Next climb: Oak Ridge in 2.3 km');
  });

  it('follows the new direction after turning around', () => {
    const turned = bar(2000, -1);
    expect(turned.frac).toBeCloseTo((length - 2000) / length);
    expect(turned.detail).toBe('Next climb: Long Meadow in 18.0 km');

    const further = bar(1000, -1);
    expect(further.frac).toBeGreaterThan(turned.frac);
    expect(further.detail).toBe('Next climb: Long Meadow in 17.0 km');
    expect(distanceAhead(1000, 23000, length, -1)).toBe(17000);
  });

  it('climbs toward the summit going forward', () => {
    const on = bar(6000, 1);
    expect(on.title).toBe('Oak Ridge');
    expect(on.frac).toBeCloseTo(1700 / 3500);
    expect(on.detail).toBe('1.8 km to summit · 180 m to climb');
  });

  it('descends a climb when riding it the other way, and the bar still advances', () => {
    const high = bar(6000, -1);
    expect(high.title).toBe('Oak Ridge');
    expect(high.detail).toBe('1.7 km to the bottom · 20 m to descend');
    const lower = bar(5000, -1);
    expect(lower.frac).toBeGreaterThan(high.frac);
    expect(lower.detail).toBe('0.7 km to the bottom · 20 m to descend');

    const approach = bar(8000, -1);
    expect(approach.title).toBe('Oak Ridge in 200 m');
    expect(approach.frac).toBe(0);
    expect(approach.detail).toBe('3.7 km to the bottom · 20 m to descend');
  });

  it('measures the lap finish back to the start when there is no climb', () => {
    const flat = (s: number, direction: 1 | -1) => rideBar({
      s, length: 15000, direction, name: 'Mirror Lake', lap: 1, climbs: [], elevationAt,
    });
    expect(flat(1000, 1).detail).toBe('14.0 km to lap finish');
    const back = flat(1000, -1);
    expect(back.detail).toBe('1.0 km to lap finish');
    expect(back.frac).toBeCloseTo(14000 / 15000);
    expect(flat(0, -1).detail).toBe('15.0 km to lap finish');
  });
});
