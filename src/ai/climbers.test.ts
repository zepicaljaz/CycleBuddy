import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../util/math';
import { CLIMBERS, climbEffortWatts, climberName, hillClimbField, hillClimbWattsPerKilo } from './climbers';

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

  it('spreads the field evenly from the strongest W/kg to the slowest', () => {
    // Many riders share a rating, as the career climbers do.
    const scores = [1800, ...Array(18).fill(1720), ...Array(18).fill(1700), ...Array(38).fill(1660)];
    const efforts = hillClimbWattsPerKilo(scores, 1, 5, mulberry32(7));
    expect(efforts[0]).toBe(5);
    const sorted = [...efforts].sort((a, b) => b - a);
    const step = 4 / (scores.length - 1);
    expect(sorted.at(-1)).toBeCloseTo(1);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i - 1] - sorted[i];
      expect(gap).toBeGreaterThan(step * 0.35);
      expect(gap).toBeLessThan(step * 1.65);
    }
  });

  it('only swaps riders whose ratings are close', () => {
    // 90, 86, 85 and 70 mountain rating, scored the same way as the start list.
    const scores = [1800, 1720, 1700, 1400];
    let swapped = false;
    for (let seed = 1; seed <= 40; seed++) {
      const efforts = hillClimbWattsPerKilo(scores, 3, 4.5, mulberry32(seed));
      expect(efforts[0]).toBe(4.5);
      expect(efforts[3]).toBeCloseTo(3);
      if (efforts[2] > efforts[1]) swapped = true;
    }
    expect(swapped).toBe(true);
  });

  it('keeps the best climber strongest when the band is narrow or the watts round up', () => {
    const efforts = hillClimbWattsPerKilo([1800, 1720], 4.4, 4.4, () => 1);
    expect(efforts[0]).toBeCloseTo(4.4);
    expect(efforts[1]).toBeCloseTo(4.4);
    const leaderWatts = climbEffortWatts(4.4, 66, 4.4, 4.4, true);
    expect(leaderWatts).toBe(290);
    const leaderWkg = leaderWatts / 66;
    const chased = climbEffortWatts(4.4, 64, 4.4, leaderWkg, false);
    expect(chased / 64).toBeLessThan(leaderWkg);
  });
});
