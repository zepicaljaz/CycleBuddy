import { describe, expect, it } from 'vitest';
import type { RideSample, RideSummary } from '../storage/types';
import {
  CURVE_SECONDS,
  decoupling,
  estimateFtp,
  formBand,
  ftpTimeline,
  loadSeries,
  mergeCurves,
  powerData,
  rampRate,
  rideLoad,
  ridesBeforeRange,
  ridesInRange,
  zoneRanges,
} from './metrics';

function ride(partial: Partial<RideSummary> & Pick<RideSummary, 'id' | 'startedAt'>): RideSummary {
  return {
    createdAt: partial.startedAt,
    updatedAt: partial.startedAt,
    mode: 'free',
    title: 'Ride',
    routeId: 'alpine',
    routeName: 'Alpe',
    durationSec: 3600,
    movingSec: 3600,
    distanceM: 30000,
    ascentM: 300,
    avgPower: 200,
    maxPower: 500,
    normalizedPower: 200,
    avgCadence: 88,
    avgHeartRate: 140,
    maxHeartRate: 170,
    avgSpeedKmh: 30,
    hasFit: true,
    ...partial,
  };
}

function samples(watts: number[], hr: number[] | number = 0): RideSample[] {
  return watts.map((power, t) => ({
    t,
    power,
    cadence: 90,
    heartRate: Array.isArray(hr) ? hr[t] : hr,
    speed: 8,
    distance: t * 8,
    altitude: 100,
    grade: 0,
  }));
}

const at = (y: number, m: number, d: number) => new Date(y, m, d, 9).toISOString();

describe('ride load', () => {
  it('scores one hour at FTP as 100 and an hour at 70% as 49', () => {
    expect(rideLoad(ride({ id: 'a', startedAt: at(2026, 10, 1), normalizedPower: 250 }), 250).tss).toBeCloseTo(100);
    const easy = rideLoad(ride({ id: 'b', startedAt: at(2026, 10, 1), normalizedPower: 175, avgPower: 160 }), 250);
    expect(easy.intensity).toBeCloseTo(0.7);
    expect(easy.tss).toBeCloseTo(49);
    expect(easy.vi).toBeCloseTo(175 / 160);
    expect(easy.kj).toBeCloseTo(576);
    expect(easy.ef).toBeCloseTo(175 / 140);
  });

  it('falls back to average power when a ride has no NP, and skips EF without heart rate', () => {
    const load = rideLoad(ride({ id: 'c', startedAt: at(2026, 10, 1), normalizedPower: 0, avgHeartRate: 0 }), 200);
    expect(load.np).toBe(200);
    expect(load.ef).toBeNull();
  });
});

describe('FTP over time', () => {
  it('scores rides against the FTP that was set on that day', () => {
    const test = ride({
      id: 'test',
      mode: 'train',
      startedAt: at(2026, 9, 10),
      workout: { planId: 'p', workoutId: 'w', name: 'FTP test', compliance: null, ftpEstimate: 260, previousFtp: 240, completed: true },
    });
    const ftpOf = ftpTimeline([test], 270);
    expect(ftpOf({ startedAt: at(2026, 9, 1) })).toBe(240);
    expect(ftpOf({ startedAt: test.startedAt })).toBe(260);
    expect(ftpOf({ startedAt: at(2026, 10, 1) })).toBe(270);
    expect(ftpTimeline([], 0)({ startedAt: at(2026, 9, 1) })).toBe(200);
  });
});

describe('fitness, fatigue and form', () => {
  const now = new Date(2026, 10, 20, 18);
  const daily = Array.from({ length: 60 }, (_, i) => ride({ id: `d${i}`, startedAt: new Date(2026, 10, 20 - i, 9).toISOString() }));

  it('approaches the daily load and keeps form near zero for steady training', () => {
    const series = loadSeries(daily, () => 200, now);
    const today = series[series.length - 1];
    expect(series).toHaveLength(60);
    expect(today.tss).toBeCloseTo(100);
    expect(today.fatigue).toBeGreaterThan(99);
    expect(today.fitness).toBeGreaterThan(70);
    expect(today.fitness).toBeLessThan(today.fatigue);
    expect(rampRate(series)).toBeGreaterThan(0);
  });

  it('turns fresh after a few rest days', () => {
    const rested = loadSeries(daily.slice(5), () => 200, now);
    expect(rested[rested.length - 1].form).toBeGreaterThan(5);
    expect(formBand(rested[rested.length - 1].form).id).toBe('fresh');
  });

  it('reads form in the usual bands', () => {
    expect(formBand(30).id).toBe('transition');
    expect(formBand(0).id).toBe('neutral');
    expect(formBand(-20).id).toBe('optimal');
    expect(formBand(-40).id).toBe('risk');
    expect(loadSeries([], () => 200, now)).toEqual([]);
  });

  it('splits rides into the range and the same length of time before it', () => {
    const inside = ridesInRange(daily, '6w', now);
    expect(inside).toHaveLength(42);
    expect(ridesBeforeRange(daily, '6w', now)).toHaveLength(18);
    expect(ridesBeforeRange(daily, 'all', now)).toHaveLength(0);
  });
});

describe('power from samples', () => {
  it('finds the best average for each duration and the time in each zone', () => {
    const watts = [...new Array(600).fill(150), ...new Array(300).fill(300), ...new Array(300).fill(150)];
    const data = powerData(samples(watts), 250);
    expect(data.best[CURVE_SECONDS.indexOf(1)]).toBe(300);
    expect(data.best[CURVE_SECONDS.indexOf(300)]).toBe(300);
    expect(data.best[CURVE_SECONDS.indexOf(600)]).toBe(225);
    expect(data.best[CURVE_SECONDS.indexOf(3600)]).toBeNull();
    expect(data.zones[1]).toBe(900);
    expect(data.zones[5]).toBe(300);
    expect(data.zones.reduce((a, b) => a + b, 0)).toBe(1200);
  });

  it('merges curves across rides and estimates FTP from the best 20 minutes', () => {
    const a = ride({ id: 'a', startedAt: at(2026, 10, 1) });
    const b = ride({ id: 'b', startedAt: at(2026, 10, 2) });
    const map = new Map([
      ['a', powerData(samples(new Array(1200).fill(260)), 250)],
      ['b', powerData(samples(new Array(1200).fill(240)), 250)],
    ]);
    const curve = mergeCurves([a, b], map);
    const twenty = curve.find((point) => point.sec === 1200);
    expect(twenty?.watts).toBe(260);
    expect(twenty?.rideId).toBe('a');
    expect(estimateFtp(curve)).toBe(247);
  });

  it('measures power-to-heart-rate drift', () => {
    const watts = new Array(2400).fill(200);
    const steady = decoupling(samples(watts, 140));
    expect(steady).toBeCloseTo(0);
    const drift = decoupling(samples(watts, watts.map((_, i) => (i < 1200 ? 140 : 150))));
    expect(drift).toBeCloseTo(((200 / 140 - 200 / 150) / (200 / 140)) * 100);
    expect(decoupling(samples(new Array(600).fill(200), 140))).toBeNull();
  });

  it('lists the zone ranges in watts', () => {
    const zones = zoneRanges(200);
    expect(zones[0]).toMatchObject({ name: 'Recovery', from: 0, to: 109 });
    expect(zones[1].from).toBe(110);
    expect(zones[zones.length - 1].to).toBeNull();
  });
});
