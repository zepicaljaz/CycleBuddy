import { describe, expect, it } from 'vitest';
import { makeBikeParams, steadySpeed } from '../physics/cycling';
import {
  brainFor, breakPace, catchRemaining, chaseCap, chaseSpeedNeeded, criticalRatio, dayForm, descentSkill, factorForSpeed,
  finaleStart, gapCap, kickPeakWkg, launchDistance, reserveBudget, sprintCurve, sprintHold, sprintPeakWkg, tickReserve,
} from './raceBrain';
import { roadPlaces } from './road';

describe('surge reserve', () => {
  it('lets the best rider in the field hold about 9% over the slider, and weaker riders less', () => {
    expect(criticalRatio(80, 80)).toBeCloseTo(1.09, 10);
    expect(criticalRatio(69, 80)).toBeCloseTo(1.0, 2);
    expect(criticalRatio(58, 80)).toBeLessThan(0.93);
    expect(criticalRatio(20, 80)).toBe(0.9);
  });

  it('measures a rider against today\'s field, so a slider suits every division', () => {
    expect(criticalRatio(70, 70)).toBeCloseTo(criticalRatio(90, 90), 10);
  });

  it('moves with day form', () => {
    expect(criticalRatio(75, 80, 1.06)).toBeGreaterThan(criticalRatio(75, 80, 1));
    expect(criticalRatio(75, 80, 0.94)).toBeLessThan(criticalRatio(75, 80, 1));
  });

  it('gives the best riders a bigger reserve', () => {
    expect(reserveBudget(80, 80)).toBeCloseTo(17.5, 10);
    expect(reserveBudget(50, 80)).toBe(10);
    expect(reserveBudget(65, 80)).toBeGreaterThan(reserveBudget(55, 80));
  });

  it('empties above the critical ratio in proportion to the excess', () => {
    let reserve = 1;
    for (let t = 0; t < 50; t++) reserve = tickReserve(reserve, 1.25, 1, 12.5, 70, 1);
    expect(reserve).toBeCloseTo(0, 6);
    expect(tickReserve(0.5, 1.5, 1, 10, 70, 1)).toBeCloseTo(0.45, 10);
  });

  it('refills below it, faster on an easy descent than in a steady bunch', () => {
    const bunch = tickReserve(0.2, 0.98, 1.02, 12, 70, 10);
    const descent = tickReserve(0.2, 0.3, 1.02, 12, 70, 10);
    expect(bunch).toBeGreaterThan(0.2);
    expect(descent).toBeGreaterThan(bunch);
    expect(tickReserve(0.2, 0.3, 1.02, 12, 90, 10)).toBeGreaterThan(descent);
  });
});

describe('break pace', () => {
  it('lets a group ride faster than a rider alone on the flat', () => {
    expect(breakPace(1, 0, 4)).toBeCloseTo(1.16, 10);
    expect(breakPace(1, 0, 1)).toBeCloseTo(1.1, 10);
  });

  it('rides close to the slider on a climb', () => {
    expect(breakPace(1, 0.06, 4)).toBeCloseTo(1.03, 10);
    expect(breakPace(1, 0.03, 4)).toBeLessThan(breakPace(1, 0, 4));
  });

  it('fades as the stamina bar empties', () => {
    expect(breakPace(0.1, 0, 4)).toBeCloseTo(1.16 * 0.86, 10);
    expect(breakPace(0.4, 0, 4)).toBeLessThan(breakPace(0.8, 0, 4));
  });
});

describe('sprint', () => {
  it('peaks at about 4.7 times the flat slider for the best sprinter of the day', () => {
    expect(sprintPeakWkg(2.8, 80, 80)).toBeCloseTo(2.8 * 4.7, 10);
    expect(sprintPeakWkg(2.8, 68, 80)).toBeCloseTo(2.8 * 3.7, 10);
    expect(sprintPeakWkg(2.8, 40, 80)).toBeCloseTo(2.8 * 3.2, 10);
  });

  it('follows the slider and never passes 16 W/kg', () => {
    expect(sprintPeakWkg(3.4, 75, 80)).toBeGreaterThan(sprintPeakWkg(2.8, 75, 80));
    expect(sprintPeakWkg(4, 90, 80)).toBe(16);
  });

  it('ramps for 3 s, holds the peak, then fades to no less than 55%', () => {
    const hold = sprintHold(80);
    expect(hold).toBeGreaterThanOrEqual(9);
    expect(hold).toBeLessThanOrEqual(12);
    expect(sprintCurve(12, 3, 0, hold)).toBe(3);
    expect(sprintCurve(12, 3, 1.5, hold)).toBeCloseTo(7.5, 10);
    expect(sprintCurve(12, 3, 3 + hold / 2, hold)).toBe(12);
    expect(sprintCurve(12, 3, 3 + hold + 2, hold)).toBeLessThan(12);
    expect(sprintCurve(12, 3, 60, hold)).toBeCloseTo(12 * 0.55, 10);
  });

  it('jumps at a distance of its own, the same every time for the same rider and seed', () => {
    for (let i = 0; i < 200; i++) {
      const d = launchDistance(`r${i}`, 60 + (i % 30), 7);
      expect(d).toBeGreaterThanOrEqual(120);
      expect(d).toBeLessThanOrEqual(380);
    }
    expect(launchDistance('a', 75, 3)).toBe(launchDistance('a', 75, 3));
    const early = Array.from({ length: 400 }, (_, i) => launchDistance(`x${i}`, 75, 1)).filter((d) => d >= 300).length;
    expect(early).toBeGreaterThan(20);
    expect(early).toBeLessThan(100);
  });

  it('kicks uphill at 1.5 to 2.6 times the slope slider, the best of the day hardest', () => {
    expect(kickPeakWkg(3.5, 80, 80)).toBeCloseTo(3.5 * 2.4, 10);
    expect(kickPeakWkg(3.5, 74, 80)).toBeCloseTo(3.5 * 2.0, 10);
    expect(kickPeakWkg(3.5, 30, 80)).toBeCloseTo(3.5 * 1.5, 10);
  });
});

describe('chase director', () => {
  it('chases at Chapatte\'s six seconds a kilometre from 42 km/h to about 45', () => {
    const v = chaseSpeedNeeded(42 / 3.6, 60, 10);
    expect(v * 3.6).toBeGreaterThan(44.5);
    expect(v * 3.6).toBeLessThan(45.6);
  });

  it('rides harder to close the same gap in fewer kilometres', () => {
    expect(chaseSpeedNeeded(11, 30, 2)).toBeGreaterThan(chaseSpeedNeeded(11, 30, 6));
  });

  it('finds the multiple of the slider that reaches a speed, within its cap', () => {
    const bike = makeBikeParams(70);
    const base = steadySpeed(2.8 * 70, 0, bike);
    const want = base * 1.05;
    const f = factorForSpeed(want, 2.8, 70, 0, bike, 0, 1.4);
    expect(f).toBeGreaterThan(1);
    expect(f).toBeLessThan(1.4);
    expect(steadySpeed(2.8 * f * 70, 0, bike)).toBeGreaterThanOrEqual(want - 0.01);
    expect(factorForSpeed(base * 2, 2.8, 70, 0, bike, 0, 1.3)).toBe(1.3);
    expect(factorForSpeed(base * 0.9, 2.8, 70, 0, bike, 0, 1.3)).toBe(1);
  });

  it('is capped by how much the sprint teams commit and how fresh their riders are', () => {
    expect(chaseCap(1, 1, 0)).toBeCloseTo(1.38, 10);
    expect(chaseCap(0, 1, 0)).toBeCloseTo(1.2, 10);
    expect(chaseCap(1, 0.2, 0)).toBeLessThan(chaseCap(1, 1, 0));
    expect(chaseCap(1, 1, 0.05)).toBe(1.06);
  });

  it('aims to catch 2-3 km out on a sprint stage, and on the last climb otherwise', () => {
    expect(catchRemaining(20000, 'sprint', null)).toBe(2600);
    expect(catchRemaining(5000, 'sprint', null)).toBe(1500);
    expect(catchRemaining(20000, 'mountain', 15000)).toBe(3000);
    expect(catchRemaining(20000, 'hill', null)).toBe(2600);
  });

  it('lets the break have about 2.2 s per kilometre of stage', () => {
    expect(gapCap(20, 0.5)).toBeCloseTo(44, 10);
    expect(gapCap(5, 0.5)).toBe(25);
    expect(gapCap(60, 0.5)).toBe(75);
    expect(gapCap(20, 0)).toBeLessThan(gapCap(20, 1));
  });
});

describe('form and skill', () => {
  it('keeps day form between 0.93 and 1.07, the same for a rider within a race', () => {
    for (let i = 0; i < 300; i++) {
      const f = dayForm(`r${i}`, 11);
      expect(f).toBeGreaterThanOrEqual(0.93);
      expect(f).toBeLessThanOrEqual(1.07);
    }
    expect(dayForm('a', 1)).toBe(dayForm('a', 1));
  });

  it('gives every rider a descending skill of about ±1.5%, the same in every race', () => {
    for (let i = 0; i < 300; i++) expect(Math.abs(descentSkill(`r${i}`))).toBeLessThanOrEqual(0.015);
    expect(descentSkill('x')).toBe(descentSkill('x'));
  });
});

describe('final ascent', () => {
  const profile = (parts: [number, number][]) => (along: number) => {
    let at = 0;
    for (const [len, grade] of parts) {
      if (along < at + len) return grade;
      at += len;
    }
    return parts[parts.length - 1][1];
  };

  it('finds no finale when the stage ends on the flat', () => {
    expect(finaleStart(20000, profile([[20000, 0]]))).toBeNull();
    expect(finaleStart(20000, profile([[15000, 0], [3000, 0.07], [2000, -0.03]]))).toBeNull();
  });

  it('starts the finale at the foot of a summit-finish climb', () => {
    const start = finaleStart(20000, profile([[16000, 0], [4000, 0.07]]))!;
    expect(start).toBeGreaterThan(15500);
    expect(start).toBeLessThan(16300);
  });

  it('counts a finish over short walls from the first wall', () => {
    const walls = profile([[18000, 0], [500, 0.1], [500, -0.08], [500, 0.1], [500, -0.08], [500, 0.1]]);
    const start = finaleStart(20500, walls)!;
    expect(start).toBeLessThan(18300);
    expect(start).toBeGreaterThan(17500);
  });
});

describe('race brain', () => {
  it('is one per field, and the same seed gives the same race plan', () => {
    const field = [{ phase: 12.5 }, { phase: 80.1 }];
    const brain = brainFor(field, 20000);
    expect(brainFor(field, 20000)).toBe(brain);
    const twin = brainFor([{ phase: 12.5 }, { phase: 80.1 }], 20000);
    expect(twin).not.toBe(brain);
    expect(twin.seed).toBe(brain.seed);
    expect(twin.breakTarget).toBe(brain.breakTarget);
    expect(twin.chaseCommit).toBe(brain.chaseCommit);
  });

  it('plans a break of 3 to 6 riders in the first quarter of the stage', () => {
    for (let i = 0; i < 50; i++) {
      const brain = brainFor([{ phase: i * 1.7 }, { phase: i * 3.1 + 5 }], 22000);
      expect(brain.breakTarget).toBeGreaterThanOrEqual(3);
      expect(brain.breakTarget).toBeLessThanOrEqual(6);
      expect(brain.breakFrom).toBeGreaterThanOrEqual(500);
      expect(brain.breakTo).toBeLessThanOrEqual(6000);
      expect(brain.breakTo).toBeGreaterThan(brain.breakFrom);
    }
  });
});

describe('places in the bunch', () => {
  it('leaves no empty place for a rider who is still coming up from further back', () => {
    // On the road from the front: a, b, c, d. d should be second (slot 1) but is still at the back.
    const slot = new Map([['a', 0], ['d', 1], ['b', 2], ['c', 3]]);
    const place = roadPlaces(['a', 'b', 'c', 'd'], slot);
    expect(place.get('a')).toBe(0);
    expect(place.get('b')).toBe(1);
    expect(place.get('c')).toBe(2);
    // d wants to be behind a only, so it comes forward past b and c.
    expect(place.get('d')).toBe(1);
  });

  it('moves a rider back one place once a rider who should be ahead has come past', () => {
    const slot = new Map([['a', 0], ['d', 1], ['b', 2], ['c', 3]]);
    const place = roadPlaces(['a', 'd', 'b', 'c'], slot);
    expect([place.get('a'), place.get('d'), place.get('b'), place.get('c')]).toEqual([0, 1, 2, 3]);
  });
});
