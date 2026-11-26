import { describe, expect, it } from 'vitest';
import { makeBikeParams, steadySpeed } from '../physics/cycling';
import { PowerMeter, pedalWatts, type MeteredRider } from './powerMeter';

const rider = (mass: number, v: number, draft = 0): MeteredRider => ({ s: 0, v, mass, bike: makeBikeParams(mass), draft, direction: 1, targetPower: 0 });

describe('pedalWatts', () => {
  it('gives back the power a steady speed was solved from', () => {
    const bike = makeBikeParams(68);
    for (const [watts, grade] of [[250, 0], [300, 0.07], [180, 0.03]]) {
      const v = steadySpeed(watts, grade, bike, 800, 0);
      expect(pedalWatts(v, 0, grade, bike, 800, 0)).toBeCloseTo(watts, 3);
    }
  });

  it('reads near-equal W/kg for a light and a heavy rider climbing together', () => {
    const v = steadySpeed(4.2 * 60, 0.08, makeBikeParams(60), 1200, 0);
    const light = pedalWatts(v, 0, 0.08, makeBikeParams(60), 1200, 0.02) / 60;
    const heavy = pedalWatts(v, 0, 0.08, makeBikeParams(78), 1200, 0.02) / 78;
    expect(Math.abs(light - heavy) / light).toBeLessThan(0.04);
  });

  it('reads less for a sheltered wheel on the flat, and nothing when coasting downhill', () => {
    const bike = makeBikeParams(70);
    expect(pedalWatts(12, 0, 0, bike, 0, 0.3)).toBeLessThan(pedalWatts(12, 0, 0, bike, 0, 0) * 0.8);
    expect(pedalWatts(14, 0, -0.08, bike, 0, 0)).toBe(0);
  });
});

describe('PowerMeter', () => {
  it('settles on the steady power and rises while a rider speeds up', () => {
    const meter = new PowerMeter();
    const r = rider(65, steadySpeed(260, 0.05, makeBikeParams(65), 0, 0));
    for (let i = 0; i < 200; i++) meter.update([r], 0.05, () => 0.05, () => 0);
    expect(meter.wattsOf(0)).toBeCloseTo(260, 0);
    expect(meter.wkgOf(0, 65)).toBeCloseTo(4, 1);
    for (let i = 0; i < 20; i++) {
      r.v += 0.05;
      meter.update([r], 0.05, () => 0.05, () => 0);
    }
    expect(meter.wattsOf(0)).toBeGreaterThan(320);
  });

  it('in a road race, reads holding power while the bunch is eased down, and caps surges at the chosen effort', () => {
    const meter = new PowerMeter();
    const r = rider(70, 9);
    const step = () => meter.update([r], 0.05, () => 0.01, () => 0, true);
    for (let i = 0; i < 100; i++) {
      r.v -= 0.01;
      step();
    }
    const holding = pedalWatts(r.v, 0, 0.01, r.bike, 0, 0);
    expect(meter.wattsOf(0)).toBeGreaterThan(holding * 0.95);
    r.targetPower = 400;
    for (let i = 0; i < 100; i++) {
      r.v += 0.03;
      step();
    }
    expect(meter.wattsOf(0)).toBeLessThanOrEqual(400.5);
    expect(meter.wattsOf(0)).toBeGreaterThan(pedalWatts(r.v, 0, 0.01, r.bike, 0, 0));
  });

  it('ignores a jump in speed that no bike could make', () => {
    const meter = new PowerMeter();
    const r = rider(70, 0);
    meter.update([r], 0.05, () => 0, () => 0);
    r.v = 12;
    meter.update([r], 0.05, () => 0, () => 0);
    expect(meter.wattsOf(0)).toBeLessThan(200);
  });
});

describe('PowerMeter deferred reads', () => {
  const grade = () => 0.04;
  const alt = () => 300;

  it('reads nothing until settled, then once for all the deferred time', () => {
    const deferred = new PowerMeter();
    const direct = new PowerMeter();
    const r = rider(68, 6);
    deferred.update([r], 0.05, grade, alt);
    direct.update([r], 0.05, grade, alt);
    r.v = 6.4;
    deferred.defer(0.05);
    deferred.defer(0.05);
    expect(deferred.wattsOf(0)).toBe(direct.wattsOf(0));
    deferred.settle([r], grade, alt);
    direct.update([r], 0.1, grade, alt);
    expect(deferred.wattsOf(0)).toBe(direct.wattsOf(0));
    // Nothing pending: a second settle changes nothing.
    deferred.settle([r], grade, alt);
    expect(deferred.wattsOf(0)).toBe(direct.wattsOf(0));
  });

  it('reads the same steady power once settled as a meter read every substep', () => {
    const every = new PowerMeter();
    const frames = new PowerMeter();
    const r = rider(72, steadySpeed(280, 0.04, makeBikeParams(72), 300, 0));
    for (let i = 0; i < 400; i++) {
      every.update([r], 0.05, grade, alt);
      frames.defer(0.05);
      if (i % 3 === 2) frames.settle([r], grade, alt);
    }
    frames.settle([r], grade, alt);
    expect(frames.wattsOf(0)).toBeCloseTo(every.wattsOf(0), 3);
    expect(frames.wattsOf(0)).toBeCloseTo(280, 0);
  });

  it('after a long hidden-tab catch-up, the first reading is the current effort, not a stale one', () => {
    const meter = new PowerMeter();
    const r = rider(70, steadySpeed(150, 0.04, makeBikeParams(70), 300, 0));
    for (let i = 0; i < 100; i++) meter.update([r], 0.05, grade, alt);
    // 60 s in a background tab: the steps are noted, nobody reads them.
    r.v = steadySpeed(320, 0.04, r.bike, 300, 0);
    for (let i = 0; i < 1200; i++) meter.defer(0.05);
    meter.settle([r], grade, alt);
    expect(meter.wattsOf(0)).toBeCloseTo(320, 0);
  });
});
