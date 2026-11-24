import { describe, expect, it } from 'vitest';
import { makeBikeParams, steadySpeed } from '../physics/cycling';
import { descentShare, descentWkg, overTheTop, paceWkgAt, prepareCrests, terrainWkg, type RoadPlan } from './road';

function plan(over: Partial<RoadPlan> = {}): RoadPlan {
  return {
    flatWkg: 2.8,
    hillWkg: 3.2,
    mountainWkg: 3.5,
    oneDay: true,
    timeTrial: false,
    startS: 0,
    finishS: 20000,
    lastClimbS: null,
    finishKind: 'sprint',
    tactic: 'control',
    features: [],
    ...over,
  };
}

/** Grades from `from` to `to` in small steps. */
function sweep(from: number, to: number, step = 0.0005): number[] {
  const out: number[] = [];
  const n = Math.round(Math.abs(to - from) / step);
  for (let i = 0; i <= n; i++) out.push(from + ((to - from) * i) / n);
  return out;
}

describe('descent pedalling', () => {
  it('rides the full flat effort on the flat and on the gentlest descents', () => {
    expect(descentShare(0)).toBe(1);
    expect(descentShare(-0.005)).toBe(1);
    expect(descentShare(-0.01)).toBe(1);
  });

  it('still pedals near the flat effort at -1.5%, not the old 1.15 W/kg', () => {
    expect(descentWkg(2.8, -0.015)).toBeCloseTo(2.52, 2);
    expect(descentWkg(2.8, -0.015)).toBeGreaterThan(2.3);
  });

  it('tapers to a tuck with no pedalling on the steepest slopes', () => {
    expect(descentShare(-0.1)).toBe(0);
    expect(descentShare(-0.15)).toBe(0);
    expect(descentWkg(2.8, -0.06)).toBeCloseTo(0.56, 2);
  });

  it('never pedals harder as the descent gets steeper', () => {
    let prev = Infinity;
    for (const g of sweep(0, -0.14)) {
      const share = descentShare(g);
      expect(share).toBeLessThanOrEqual(prev + 1e-12);
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
      prev = share;
    }
  });

  it('has no step anywhere along the descent', () => {
    let prev = descentShare(0);
    for (const g of sweep(0, -0.14, 0.0001)) {
      const share = descentShare(g);
      expect(Math.abs(share - prev)).toBeLessThan(0.02);
      prev = share;
    }
  });

  it('follows the flat slider', () => {
    expect(descentWkg(3.6, -0.03)).toBeCloseTo(3.6 * descentShare(-0.03), 10);
    expect(descentWkg(3.6, -0.03)).toBeGreaterThan(descentWkg(2.8, -0.03));
  });

  it('never makes the bunch slower on a steeper descent', () => {
    const bike = makeBikeParams(70);
    const p = plan();
    let prev = 0;
    for (const g of sweep(0, -0.12, 0.001)) {
      const v = steadySpeed(terrainWkg(p, g) * 70, g, bike);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = v;
    }
  });

  it('is not slower at -1.5% than at -1%, which the old cutoff caused', () => {
    const bike = makeBikeParams(70);
    const p = plan();
    const at = (g: number) => steadySpeed(terrainWkg(p, g) * 70, g, bike);
    expect(at(-0.015)).toBeGreaterThan(at(-0.01));
    expect(at(-0.02)).toBeGreaterThan(at(-0.015));
  });
});

describe('terrain W/kg', () => {
  const p = plan();

  it('holds each slider on its own stretch of road', () => {
    expect(terrainWkg(p, 0)).toBeCloseTo(2.8, 10);
    expect(terrainWkg(p, 0.02)).toBeCloseTo(2.8, 10);
    expect(terrainWkg(p, 0.04)).toBeCloseTo(3.2, 10);
    expect(terrainWkg(p, 0.06)).toBeCloseTo(3.35, 10);
    expect(terrainWkg(p, 0.09)).toBeCloseTo(3.5, 10);
  });

  it('moves between the sliders without a jump at 3%, 5% and 7%', () => {
    let prev = terrainWkg(p, 0);
    for (const g of sweep(0, 0.12, 0.0001)) {
      const wkg = terrainWkg(p, g);
      expect(Math.abs(wkg - prev)).toBeLessThan(0.01);
      prev = wkg;
    }
  });

  it('is exactly halfway at each threshold', () => {
    expect(terrainWkg(p, 0.03)).toBeCloseTo((2.8 + 3.2) / 2, 10);
    expect(terrainWkg(p, 0.05)).toBeCloseTo((3.2 + 3.35) / 2, 10);
    expect(terrainWkg(p, 0.07)).toBeCloseTo((3.35 + 3.5) / 2, 10);
  });

  it('stays between the two sliders it is blending', () => {
    for (const g of sweep(0.025, 0.035)) {
      const wkg = terrainWkg(p, g);
      expect(wkg).toBeGreaterThanOrEqual(2.8 - 1e-9);
      expect(wkg).toBeLessThanOrEqual(3.2 + 1e-9);
    }
  });

  it('works when a slider is set below the one before it', () => {
    const low = plan({ hillWkg: 2.4 });
    for (const g of sweep(0.02, 0.04)) {
      const wkg = terrainWkg(low, g);
      expect(wkg).toBeLessThanOrEqual(2.8 + 1e-9);
      expect(wkg).toBeGreaterThanOrEqual(2.4 - 1e-9);
    }
  });

  it('uses the hill slider on every climb in a punchy stage', () => {
    const punchy = plan({ punchy: true });
    expect(terrainWkg(punchy, 0.02)).toBeCloseTo(2.8, 10);
    expect(terrainWkg(punchy, 0.045)).toBeCloseTo(3.2, 10);
    expect(terrainWkg(punchy, 0.06)).toBeCloseTo(3.2, 10);
    expect(terrainWkg(punchy, 0.09)).toBeCloseTo(3.2, 10);
  });

  it('keeps the descent curve below the flat slider', () => {
    expect(terrainWkg(p, -0.03)).toBeCloseTo(descentWkg(2.8, -0.03), 10);
    expect(terrainWkg(p, -0.03)).toBeLessThan(terrainWkg(p, 0));
  });
});

describe('over the top of a climb', () => {
  // 1 km at 8%, 200 m of summit at 0.5%, 1 km of descent at -6%, then flat.
  const gradeAt = (s: number) => (s < 1000 ? 0.08 : s < 1200 ? 0.005 : s < 2200 ? -0.06 : 0);
  const course = () => {
    const p = plan({ startS: 0, finishS: 4000 });
    prepareCrests(p, gradeAt);
    return p;
  };

  it('carries the effort of the climb over the summit instead of dropping to the flat slider', () => {
    const p = course();
    const climb = terrainWkg(p, 0.08);
    expect(paceWkgAt(p, 1100, 0.005)).toBeCloseTo(climb, 5);
    expect(terrainWkg(p, 0.005)).toBeLessThan(climb);
  });

  it('eases the carried effort with the slope of the descent', () => {
    const p = course();
    expect(paceWkgAt(p, 1500, -0.06)).toBeCloseTo(terrainWkg(p, 0.08) * descentShare(-0.06), 5);
    expect(paceWkgAt(p, 1500, -0.06)).toBeLessThan(paceWkgAt(p, 1100, 0.005));
  });

  it('rides the flat slider again once the road has been level for a while after the descent', () => {
    const p = course();
    expect(overTheTop(p, 2300)).toBe(true);
    expect(overTheTop(p, 2700)).toBe(false);
    expect(paceWkgAt(p, 2700, 0)).toBeCloseTo(p.flatWkg, 5);
    expect(overTheTop(p, 500)).toBe(false);
  });
});
