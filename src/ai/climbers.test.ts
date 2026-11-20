import { describe, expect, it } from 'vitest';
import { CLIMBERS, climbEffortWatts, climbWattsPerKilo, climberName, hillClimbField, hillClimbLeaderGap, hillClimbWattsPerKilo } from './climbers';

describe('climber ranking', () => {
  it('keeps 100 climbers in points order, shown as an initial and a last name', () => {
    expect(CLIMBERS).toHaveLength(100);
    expect(climberName(CLIMBERS[0])).toBe('T. Pogačnik');
    expect(CLIMBERS[0].points).toBe(1493);
    expect(climberName(CLIMBERS[1])).toBe('I. de Torres');
    expect(climberName(CLIMBERS[9])).toBe('F. Gallet');
    expect(CLIMBERS[9].points).toBe(927);
    expect(climberName(CLIMBERS[74])).toBe('W. van Aertsen');
    expect(climberName(CLIMBERS[84])).toBe('M. van der Poelen');
    expect(climberName(CLIMBERS[99])).toBe('P. Castrilho');
    expect(CLIMBERS[99].points).toBe(206);
    for (let i = 1; i < CLIMBERS.length; i++) expect(CLIMBERS[i].points).toBeLessThanOrEqual(CLIMBERS[i - 1].points);
    const names = CLIMBERS.map(climberName);
    expect(new Set(names).size).toBe(100);
    for (const name of names) expect(name).toMatch(/^[A-Z]\. .+/);
  });

  it('drops the lowest points when the field is shorter than 100', () => {
    expect(hillClimbField(75)).toHaveLength(75);
    expect(climberName(hillClimbField(75).at(-1)!)).toBe('W. van Aertsen');
    expect(hillClimbField(75).some((r) => climberName(r) === 'L. Plapps')).toBe(false);
    expect(hillClimbField(100)).toHaveLength(100);
    expect(hillClimbField(140)).toHaveLength(100);
  });

  it('maps points into the chosen W/kg band and only swaps riders who are close', () => {
    const low = () => 0;
    const high = () => 1;
    const top = climbWattsPerKilo(1493, 206, 1493, 2.5, 6, high);
    const gallWorst = climbWattsPerKilo(927, 206, 1493, 2.5, 6, low);
    const scaroniBest = climbWattsPerKilo(818, 206, 1493, 2.5, 6, high);
    const last = climbWattsPerKilo(206, 206, 1493, 2.5, 6, low);
    expect(top).toBeCloseTo(6);
    expect(last).toBeCloseTo(2.5);
    expect(gallWorst).toBeGreaterThan(scaroniBest);
    const evenepoelOff = climbWattsPerKilo(1274, 206, 1493, 2.5, 6, low);
    const seixasOn = climbWattsPerKilo(1247, 206, 1493, 2.5, 6, high);
    expect(seixasOn).toBeGreaterThan(evenepoelOff);
  });

  it('gives the best climber the strongest W/kg and bunches the rest just under him', () => {
    const steady = () => 0.5;
    // 90, 86, 80 and 70 mountain rating, scored the same way as the start list.
    const scores = [1800, 1720, 1600, 1400];
    const efforts = hillClimbWattsPerKilo(scores, 3, 4.5, steady);
    expect(hillClimbLeaderGap(3, 4.5)).toBeCloseTo(0.1);
    expect(efforts[0]).toBeCloseTo(4.5);
    expect(efforts[1]).toBeCloseTo(4.4);
    expect(efforts[2]).toBeCloseTo(3.875);
    expect(efforts[3]).toBeCloseTo(3);
    // A straight line from 70 up to 90 would leave the 86 rider at 4.2.
    const straight = climbWattsPerKilo(1720, 1400, 1800, 3, 4.5, steady);
    expect(efforts[1]).toBeGreaterThan(straight);
    const leaderWatts = climbEffortWatts(efforts[0], 66, 3, efforts[0], true);
    expect(leaderWatts).toBe(297);
    expect(leaderWatts / 66).toBeCloseTo(4.5);
    const leaderWkg = leaderWatts / 66;
    for (let i = 1; i < efforts.length; i++) {
      const watts = climbEffortWatts(efforts[i], 64, 3, leaderWkg, false);
      expect(watts / 64).toBeLessThan(leaderWkg);
      expect(watts / 64).toBeGreaterThanOrEqual(3 - 1e-6);
    }
  });

  it('keeps the best climber strongest when the band is narrow or the watts round up', () => {
    expect(hillClimbLeaderGap(4.4, 4.5)).toBeCloseTo(0.05);
    const efforts = hillClimbWattsPerKilo([1800, 1720], 4.4, 4.4, () => 1);
    expect(efforts[0]).toBeCloseTo(4.4);
    expect(efforts[1]).toBeCloseTo(4.4);
    const leaderWatts = climbEffortWatts(4.4, 66, 4.4, 4.4, true);
    const leaderWkg = leaderWatts / 66;
    const chased = climbEffortWatts(4.4, 64, 4.4, leaderWkg, false);
    expect(chased / 64).toBeLessThan(leaderWkg);
  });
});
